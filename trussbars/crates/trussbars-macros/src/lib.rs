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
//! This is a deliberately thin, dependency-light driver: it hand-parses its three
//! arguments from the token stream (no `syn`/`quote`) and re-parses the emitted Rust
//! string back into tokens.

use proc_macro::{TokenStream, TokenTree};

/// Compile a MaxBars template into a render function.
///
/// ```ignore
/// truss!(greeting, Greeting, "Hello {{name}}!");           // inline source
/// truss!(index, IndexCtx, path = "templates/index.truss"); // load from a file
/// // each expands to: pub fn name(ctx: &CtxType) -> String { … }
/// ```
///
/// The arguments are `name` (the generated function's identifier), `CtxType` (the
/// context type the template renders against — a single ident or a path/generic
/// type), and the template source — either a **string literal** (inline) or the
/// **`path = "…"`** form, which reads the file at macro-expansion time relative to
/// the crate root (`CARGO_MANIFEST_DIR`, the Askama convention). The `path` form
/// also emits an `include_bytes!` of that file, so a template edit re-triggers the
/// build (cargo tracks it as a source dependency). A Trussbars-owned (class-A)
/// error expands to a `compile_error!` located at `line:col`.
#[proc_macro]
pub fn truss(input: TokenStream) -> TokenStream {
    match expand(input) {
        Ok(ts) => ts,
        Err(msg) => compile_error(&msg),
    }
}

fn expand(input: TokenStream) -> Result<TokenStream, String> {
    // Split the arguments on top-level commas into [name, CtxType, "template"].
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
    if groups.len() != 3 {
        return Err(format!(
            "truss! expects `name, CtxType, \"template\"` ({} comma-separated parts given)",
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

    let rust = trussbars_template::emit_named(&name, &ctx_type, &template)?;
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
