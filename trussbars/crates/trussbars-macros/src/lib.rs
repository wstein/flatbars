//! # trussbars-macros
//!
//! The **Trussbars v2** proc-macro — `truss!(name, CtxType, "template")` compiles a
//! MaxBars template into a typed Rust render function (`pub fn name(ctx: &CtxType)
//! -> String`) at macro-expansion time, by driving [`trussbars_template`]
//! (lexer → parser → desugar → emit, docs/08).
//!
//! **Diagnostics (docs/07).** *Class A* errors — ones Trussbars owns (parse errors,
//! unknown helpers, unsupported constructs) — are detected here and reported as a
//! `compile_error!` whose message carries the template's `line:col`. On stable Rust
//! the macro cannot span *into* the string literal (`proc_macro_span` is nightly),
//! so the located message is the contract — and it is pinned by the `trybuild`
//! gate (`tests/ui`). *Class B* errors (unknown field, type mismatch) stay with
//! rustc against the host's types.
//!
//! **Host helpers (F3, docs/09).** A template may call host-provided Rust functions
//! (`{{date x "%Y"}}`, `{{body | markdown}}`) when their names are declared in a
//! compile-time allow-list — `truss!(…, helpers = [date, markdown])` or the
//! [`macro@truss_helpers`] module attribute. Only declared names resolve to a host
//! call; an undeclared head stays a located `unknown helper` error. Names are static,
//! so this never lets data choose a function.
//!
//! This is a deliberately thin, dependency-light driver: it hand-parses its
//! arguments from the token stream (no `syn`/`quote`) and re-parses the emitted Rust
//! string back into tokens.

use proc_macro::{Delimiter, Group, Ident, Punct, Spacing, Span, TokenStream, TokenTree};

/// Compile a MaxBars template into a render function.
///
/// ```ignore
/// truss!(greeting, Greeting, "Hello {{name}}!");           // inline source
/// truss!(index, IndexCtx, path = "templates/index.truss"); // load from a file
/// truss!(card, Card, "{% if tags %}…{% endif %}", truthiness = Liquid); // Liquid policy
/// // each expands to: pub fn name(ctx: &CtxType) -> String { … }
/// ```
///
/// The arguments are `name` (the generated function's identifier), `CtxType` (the
/// context type the template renders against — a single ident or a path/generic
/// type), and the template source — either a **string literal** (inline) or the
/// **`path = "…"`** form, which reads the file at macro-expansion time relative to
/// the crate root (`CARGO_MANIFEST_DIR`, the Askama convention). The `path` form
/// also emits an `include_bytes!` of that file, so a template edit re-triggers the
/// build (cargo tracks it as a source dependency).
///
/// Trailing clauses, in any order, tune compilation: `helpers = [a, b]` is the
/// host-helper allow-list (F3, below); `truthiness = Mode` selects the truthiness
/// policy — `NonEmpty` (default, conformance-checked), `Liquid`, `Handlebars`, or a
/// host policy path (spec §7, `docs/16-truthiness-modes.md`); and
/// `partials = [name = "file.truss"]` imports partials from other files, resolved by
/// `{{> name}}` / `{% partial "name" %}` (cross-file layouts and sub-context partials,
/// `docs/21-cross-file-partials.md`). A Trussbars-owned (class-A) error expands to a
/// `compile_error!` located at `line:col`.
#[proc_macro]
pub fn truss(input: TokenStream) -> TokenStream {
    match expand(input) {
        Ok(ts) => ts,
        Err(msg) => compile_error(&msg),
    }
}

/// Declare the host-helper allow-list once for a module of templates (F3).
///
/// ```ignore
/// #[truss_helpers(date, markdown)]
/// mod templates {
///     use trussbars_macros::truss;
///     truss!(render_post, PostCtx, path = "templates/post.truss");
///     // … more truss! calls, all may now call host fns `date` / `markdown`
/// }
/// ```
///
/// It rewrites every `truss!(…)` invocation inside the annotated item to carry
/// `helpers = [date, markdown]`, so the allow-list is declared in one place instead
/// of repeated on each call. Resolution stays fully compile-time and the names stay
/// static — exactly the per-call `helpers = […]` clause, threaded for you.
#[proc_macro_attribute]
pub fn truss_helpers(attr: TokenStream, item: TokenStream) -> TokenStream {
    inject_helpers(item, &attr)
}

/// Rewrite every `truss ! ( … )` call within `ts` to append `, helpers = [<attr>]`,
/// recursing into nested groups (a `mod { … }` body) so the calls inside are reached.
/// A call that already carries a `helpers` clause is left as-is (no double-append).
fn inject_helpers(ts: TokenStream, attr: &TokenStream) -> TokenStream {
    // First recurse into every group so inner `truss!` calls (e.g. inside `mod {}`)
    // are rewritten too.
    let toks: Vec<TokenTree> = ts
        .into_iter()
        .map(|t| match t {
            TokenTree::Group(g) => {
                TokenTree::Group(Group::new(g.delimiter(), inject_helpers(g.stream(), attr)))
            }
            other => other,
        })
        .collect();
    // Then, at this level, find the `truss ! (group)` triples and augment the group.
    let mut out: Vec<TokenTree> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        if let (
            Some(TokenTree::Ident(id)),
            Some(TokenTree::Punct(bang)),
            Some(TokenTree::Group(call)),
        ) = (toks.get(i), toks.get(i + 1), toks.get(i + 2))
            && id.to_string() == "truss"
            && bang.as_char() == '!'
            && call.delimiter() == Delimiter::Parenthesis
            && !mentions_helpers(&call.stream())
        {
            let mut stream = call.stream();
            stream.extend(helpers_suffix(attr));
            out.push(toks[i].clone());
            out.push(toks[i + 1].clone());
            out.push(TokenTree::Group(Group::new(Delimiter::Parenthesis, stream)));
            i += 3;
            continue;
        }
        out.push(toks[i].clone());
        i += 1;
    }
    out.into_iter().collect()
}

/// `, helpers = [ <attr> ]` as a token stream (the clause appended to a `truss!` call).
fn helpers_suffix(attr: &TokenStream) -> Vec<TokenTree> {
    vec![
        TokenTree::Punct(Punct::new(',', Spacing::Alone)),
        TokenTree::Ident(Ident::new("helpers", Span::call_site())),
        TokenTree::Punct(Punct::new('=', Spacing::Alone)),
        TokenTree::Group(Group::new(Delimiter::Bracket, attr.clone())),
    ]
}

/// Whether a `truss!` argument stream already has a top-level `helpers` clause.
fn mentions_helpers(stream: &TokenStream) -> bool {
    stream
        .clone()
        .into_iter()
        .any(|t| matches!(t, TokenTree::Ident(id) if id.to_string() == "helpers"))
}

fn expand(input: TokenStream) -> Result<TokenStream, String> {
    // Split the arguments on top-level commas into [name, CtxType, template[, helpers]].
    // A `[a, b]` helper list is a single bracket `Group` token, so its inner commas
    // are not at top level and never split here.
    let mut groups: Vec<Vec<TokenTree>> = vec![Vec::new()];
    for tt in input {
        if let TokenTree::Punct(ref p) = tt
            && p.as_char() == ','
        {
            groups.push(Vec::new());
            continue;
        }
        groups.last_mut().expect("at least one group").push(tt);
    }
    if groups.len() < 3 {
        return Err(format!(
            "truss! expects `name, CtxType, \"template\"` (optionally `, helpers = [..]`, \
             `, truthiness = Mode`, and/or `, partials = [name = \"file\"]`) \
             ({} comma-separated parts given)",
            groups.len()
        ));
    }

    let name = match groups[0].as_slice() {
        [TokenTree::Ident(id)] => id.to_string(),
        _ => {
            return Err(
                "truss!: the first argument must be a function name (an identifier)".into(),
            );
        }
    };

    if groups[1].is_empty() {
        return Err("truss!: the second argument must be the context type".into());
    }
    // Reconstruct via a `TokenStream` (its `Display` respects `Punct` spacing), not a
    // token-wise `join(" ")` — the latter splits `::` into `: :` and breaks a path or
    // generic context type (`crate::Page`, `Wrapper<u8>`).
    let ctx_type = groups[1]
        .iter()
        .cloned()
        .collect::<TokenStream>()
        .to_string();

    // The third argument is either an inline string literal or `path = "file"`.
    let (template, dep) = template_arg(&groups[2])?;

    // The optional trailing clauses — `helpers = [a, b]` (F3), `truthiness = Mode` (spec §7),
    // and `partials = [name = "file"]` (cross-file partials, docs/21) — in any order.
    let mut helpers = Vec::new();
    let mut mode = trussbars_template::TruthPolicy::default();
    let mut partials: Vec<(String, String)> = Vec::new(); // (name, relpath)
    for group in &groups[3..] {
        match clause_key(group).as_deref() {
            Some("helpers") => helpers = parse_helpers(group)?,
            Some("truthiness") => mode = parse_truthiness(group)?,
            Some("partials") => partials = parse_partials(group)?,
            _ => {
                return Err("truss!: trailing arguments must be `helpers = [name, …]`, \
                     `truthiness = Mode`, or `partials = [name = \"file\", …]`"
                    .into());
            }
        }
    }

    // Read each declared partial file at expansion time (the file paths are static; the engine
    // stays file-IO-free and just receives the sources).
    let file_partials: Vec<(String, String)> = partials
        .iter()
        .map(|(name, rel)| Ok((name.clone(), read_manifest_relative(rel)?)))
        .collect::<Result<_, String>>()?;

    let rust = trussbars_template::emit_with_partials(
        &name,
        &ctx_type,
        &template,
        &helpers,
        mode,
        &file_partials,
    )?;

    // Append an anonymous `include_bytes!` per file (the main `path` template and every partial
    // file) so cargo tracks each as a source dependency — an edit re-triggers the build. The
    // absolute `CARGO_MANIFEST_DIR` path resolves regardless of the invoking module.
    let mut source = rust;
    let deps = dep
        .into_iter()
        .chain(partials.iter().map(|(_, rel)| format!("{rel:?}")));
    for rel in deps {
        source.push_str(&format!(
            "\nconst _: &[u8] = include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/\", {rel}));\n"
        ));
    }
    source
        .parse()
        .map_err(|e| format!("truss!: internal error re-tokenizing generated Rust: {e}"))
}

/// Resolve the third `truss!` argument to `(template source, dependency relpath)`.
/// An inline string literal yields the source with no dependency; the `path = "…"`
/// form reads the file (relative to `CARGO_MANIFEST_DIR`) and returns the relpath
/// (a quoted Rust string-literal token) so the caller can emit dep-tracking.
fn template_arg(group: &[TokenTree]) -> Result<(String, Option<String>), String> {
    match group {
        [TokenTree::Literal(lit)] => {
            let text = string_literal_text(&lit.to_string())
                .ok_or_else(|| "truss!: the third argument must be a string literal".to_string())?;
            Ok((text, None))
        }
        // `path = "file.truss"` — read it relative to the crate root.
        [
            TokenTree::Ident(id),
            TokenTree::Punct(eq),
            TokenTree::Literal(lit),
        ] if id.to_string() == "path" && eq.as_char() == '=' => {
            let rel = string_literal_text(&lit.to_string())
                .ok_or_else(|| "truss!: `path = …` needs a string-literal file path".to_string())?;
            let text = read_manifest_relative(&rel)?;
            Ok((text, Some(lit.to_string())))
        }
        _ => Err(
            "truss!: the third argument must be a string literal or `path = \"file.truss\"`".into(),
        ),
    }
}

/// Read a file relative to the crate root (`CARGO_MANIFEST_DIR`, the Askama convention), so it
/// resolves regardless of which module the macro is invoked from. Shared by the `path = …`
/// template form and `partials = [name = "file"]`.
fn read_manifest_relative(rel: &str) -> Result<String, String> {
    let root = std::env::var("CARGO_MANIFEST_DIR").map_err(|_| {
        "truss!: CARGO_MANIFEST_DIR is unset (cannot resolve a file path)".to_string()
    })?;
    let full = std::path::Path::new(&root).join(rel);
    std::fs::read_to_string(&full)
        .map_err(|e| format!("truss!: cannot read template `{}`: {e}", full.display()))
}

/// Parse the optional `partials = [name = "file", …]` clause (docs/21) into `(name, relpath)`
/// pairs. Each entry is `Ident = "string"`; the bracket's inner commas separate entries.
fn parse_partials(group: &[TokenTree]) -> Result<Vec<(String, String)>, String> {
    let list = match group {
        [
            TokenTree::Ident(kw),
            TokenTree::Punct(eq),
            TokenTree::Group(list),
        ] if kw.to_string() == "partials"
            && eq.as_char() == '='
            && list.delimiter() == Delimiter::Bracket =>
        {
            list
        }
        _ => return Err("truss!: `partials = [name = \"file\", …]` needs a bracketed list".into()),
    };
    // Split the bracket stream on top-level commas, then each entry must be `name = "file"`.
    let mut entries: Vec<Vec<TokenTree>> = vec![Vec::new()];
    for tt in list.stream() {
        if let TokenTree::Punct(ref p) = tt
            && p.as_char() == ','
        {
            entries.push(Vec::new());
            continue;
        }
        entries.last_mut().expect("at least one entry").push(tt);
    }
    let mut out = Vec::new();
    for entry in entries {
        if entry.is_empty() {
            continue; // trailing / doubled comma
        }
        match entry.as_slice() {
            [
                TokenTree::Ident(name),
                TokenTree::Punct(eq),
                TokenTree::Literal(lit),
            ] if eq.as_char() == '=' => {
                let rel = string_literal_text(&lit.to_string()).ok_or_else(|| {
                    format!(
                        "truss!: partial '{}' needs a string-literal file path",
                        name
                    )
                })?;
                out.push((name.to_string(), rel));
            }
            _ => {
                return Err(
                    "truss!: each partial entry must be `name = \"file\"` (a name and a \
                     string-literal path)"
                        .into(),
                );
            }
        }
    }
    Ok(out)
}

/// The leading `key` of a `key = …` trailing clause (e.g. `helpers`, `truthiness`),
/// or `None` if the group does not start with `ident =`.
fn clause_key(group: &[TokenTree]) -> Option<String> {
    match group {
        [TokenTree::Ident(id), TokenTree::Punct(eq), ..] if eq.as_char() == '=' => {
            Some(id.to_string())
        }
        _ => None,
    }
}

/// Parse the optional `truthiness = Mode` clause (spec §7, `docs/16`) into the policy.
/// `Mode` is either a built-in policy ident — `NonEmpty` (default), `Liquid`, or
/// `Handlebars` — or a *host-defined* policy named by a Rust type path (`self::MyMode`,
/// `crate::policies::Foo`), emitted as the marker of `truthy_in::<Path, _>`. A lone
/// unknown ident is reported as a typo of a built-in (the common case); anything longer
/// than one identifier is taken as a host policy path.
fn parse_truthiness(group: &[TokenTree]) -> Result<trussbars_template::TruthPolicy, String> {
    use trussbars_template::{TruthMode, TruthPolicy};
    let rest = match group {
        [TokenTree::Ident(kw), TokenTree::Punct(eq), rest @ ..]
            if kw.to_string() == "truthiness" && eq.as_char() == '=' && !rest.is_empty() =>
        {
            rest
        }
        _ => {
            return Err(
                "truss!: `truthiness = Mode` needs a built-in mode ident or a host policy path"
                    .into(),
            );
        }
    };
    // A lone identifier selects a built-in policy — and a wrong one gets the located
    // "expected …" hint rather than a confusing downstream trait error. Anything longer
    // (a `::`-qualified path or generics) is a host-defined marker, emitted verbatim.
    if let [TokenTree::Ident(mode)] = rest {
        let name = mode.to_string();
        return TruthMode::from_ident(&name)
            .map(TruthPolicy::Builtin)
            .ok_or_else(|| {
                format!(
                    "truss!: unknown truthiness mode `{name}` (expected NonEmpty, Liquid, or \
                     Handlebars; write a host-defined policy as a path, e.g. `self::MyMode`)"
                )
            });
    }
    // Reconstruct the path via a `TokenStream` rather than `join(" ")`: token-wise
    // joining would split `::` into `: :` (each colon is a separate `Punct`), so the
    // stream's own `Display` — which respects `Punct` spacing/jointness — is the correct
    // way to render a path/generic back to valid Rust.
    let path = rest.iter().cloned().collect::<TokenStream>().to_string();
    Ok(TruthPolicy::Custom(path))
}

/// Parse the optional `helpers = [name, name, …]` clause into the allow-list of
/// host-helper names (F3). The bracket list is a single `Group` token; its inner
/// idents are the declared names (commas are skipped).
fn parse_helpers(group: &[TokenTree]) -> Result<Vec<String>, String> {
    match group {
        [
            TokenTree::Ident(kw),
            TokenTree::Punct(eq),
            TokenTree::Group(list),
        ] if kw.to_string() == "helpers"
            && eq.as_char() == '='
            && list.delimiter() == Delimiter::Bracket =>
        {
            Ok(list
                .stream()
                .into_iter()
                .filter_map(|t| match t {
                    TokenTree::Ident(id) => Some(id.to_string()),
                    _ => None, // the separating commas
                })
                .collect())
        }
        _ => Err("truss!: the fourth argument must be `helpers = [name, …]`".into()),
    }
}

/// `::core::compile_error!("msg")` as a token stream.
fn compile_error(msg: &str) -> TokenStream {
    let escaped = msg
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("::core::compile_error!(\"{escaped}\");")
        .parse()
        .expect("compile_error! literal is always valid Rust")
}

/// The text value of a Rust string literal token — both cooked (`"…"`, with the
/// common escapes) and raw (`r"…"` / `r#"…"#`). Returns `None` if `s` is not a
/// string literal.
fn string_literal_text(s: &str) -> Option<String> {
    if let Some(rest) = s.strip_prefix('r') {
        // Raw string: r, then N `#`, then `"`, the body, `"`, N `#`.
        let hashes = rest.bytes().take_while(|&b| b == b'#').count();
        let open = 1 + hashes + 1;
        let close = s.len().checked_sub(hashes + 1)?;
        if open > close {
            return None;
        }
        return Some(s.get(open..close)?.to_string());
    }
    let inner = s.strip_prefix('"')?.strip_suffix('"')?;
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next()? {
            'n' => out.push('\n'),
            't' => out.push('\t'),
            'r' => out.push('\r'),
            '0' => out.push('\0'),
            '"' => out.push('"'),
            '\'' => out.push('\''),
            '\\' => out.push('\\'),
            // Uncommon escapes (\xNN, \u{…}) are left verbatim — templates use the
            // common set, and a passthrough keeps this driver dependency-free.
            other => {
                out.push('\\');
                out.push(other);
            }
        }
    }
    Some(out)
}
