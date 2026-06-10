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
/// truss!(card, Card, "{{#if tags}}…{{/if}}", truthiness = Liquid); // Liquid policy
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
/// host-helper allow-list (F3, below), and `truthiness = Mode` selects the
/// truthiness policy — `NonEmpty` (default, conformance-checked), `Liquid`, or
/// `Handlebars` (spec §7, `docs/15-truthiness-modes.md`). A Trussbars-owned
/// (class-A) error expands to a `compile_error!` located at `line:col`.
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
            "truss! expects `name, CtxType, \"template\"` (optionally `, helpers = [..]` \
             and/or `, truthiness = Mode`) ({} comma-separated parts given)",
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
    let ctx_type = groups[1]
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ");

    // The third argument is either an inline string literal or `path = "file"`.
    let (template, dep) = template_arg(&groups[2])?;

    // The optional trailing clauses — `helpers = [a, b]` (F3) and `truthiness = Mode`
    // (spec §7) — in any order.
    let mut helpers = Vec::new();
    let mut mode = trussbars_template::TruthMode::NonEmpty;
    for group in &groups[3..] {
        match clause_key(group).as_deref() {
            Some("helpers") => helpers = parse_helpers(group)?,
            Some("truthiness") => mode = parse_truthiness(group)?,
            _ => {
                return Err(
                    "truss!: trailing arguments must be `helpers = [name, …]` or \
                     `truthiness = Mode`"
                        .into(),
                );
            }
        }
    }

    let rust = trussbars_template::emit_named(&name, &ctx_type, &template, &helpers, mode)?;
    // The `path` form appends an anonymous `include_bytes!` so cargo tracks the
    // `.truss` file as a source dependency (an edit re-triggers the build). It uses
    // an absolute path via `CARGO_MANIFEST_DIR` so it resolves regardless of which
    // module the macro is invoked from.
    let source = match dep {
        Some(rel) => format!(
            "{rust}\nconst _: &[u8] = include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/\", {rel}));\n"
        ),
        None => rust,
    };
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
            let root = std::env::var("CARGO_MANIFEST_DIR").map_err(|_| {
                "truss!: CARGO_MANIFEST_DIR is unset (cannot resolve `path`)".to_string()
            })?;
            let full = std::path::Path::new(&root).join(&rel);
            let text = std::fs::read_to_string(&full)
                .map_err(|e| format!("truss!: cannot read template `{}`: {e}", full.display()))?;
            Ok((text, Some(lit.to_string())))
        }
        _ => Err(
            "truss!: the third argument must be a string literal or `path = \"file.truss\"`".into(),
        ),
    }
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

/// Parse the optional `truthiness = Mode` clause (spec §7) into the policy marker.
/// `Mode` is a single ident — `NonEmpty` (default), `Liquid`, or `Handlebars`.
fn parse_truthiness(group: &[TokenTree]) -> Result<trussbars_template::TruthMode, String> {
    match group {
        [
            TokenTree::Ident(kw),
            TokenTree::Punct(eq),
            TokenTree::Ident(mode),
        ] if kw.to_string() == "truthiness" && eq.as_char() == '=' => {
            let name = mode.to_string();
            trussbars_template::TruthMode::from_ident(&name).ok_or_else(|| {
                format!(
                    "truss!: unknown truthiness mode `{name}` (expected NonEmpty, Liquid, or Handlebars)"
                )
            })
        }
        _ => Err("truss!: `truthiness = Mode` needs a single mode identifier".into()),
    }
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
