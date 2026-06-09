//! The **Lift**: pretty-print the Trussbars IR ([`trussbars_template::ast::Node`])
//! back to idiomatic `.truss` (MaxBars) surface text — the `IR → idiomatic .truss`
//! step of the migration pipeline (`docs/15`).
//!
//! It is a *faithful serializer*, not a reformatter: literal [`Node::Text`] is emitted
//! verbatim (the source's own whitespace, already standalone-trimmed by the dialect
//! parser), so the migrated file keeps the author's layout. Paths re-sugar from their
//! desugared `App("lookup", …)` chains to dotted form (`a.b`), dropping the implicit
//! `this` root.
//!
//! A [`Notes`] map (keyed by a node's source-`Span` start) lets the migrator weave
//! inline `{{! migrate: … }}` annotations next to the node they concern; an empty map
//! prints clean output.

use std::collections::HashMap;

use trussbars_template::Span;
use trussbars_template::ast::{Cond, Each, Expr, Node, Value, With};

/// Inline migration notes to weave into the output, keyed by a node's source-span
/// start offset. Each note is emitted as a `{{! migrate: <note> }}` comment
/// immediately before its node.
pub type Notes = HashMap<usize, Vec<String>>;

/// Pretty-print an IR node list to idiomatic `.truss`, with no annotations.
#[must_use]
pub fn to_truss(nodes: &[Node]) -> String {
    to_truss_annotated(nodes, &Notes::new())
}

/// Pretty-print an IR node list to idiomatic `.truss`, weaving `notes` as inline
/// `{{! migrate: … }}` comments.
#[must_use]
pub fn to_truss_annotated(nodes: &[Node], notes: &Notes) -> String {
    let mut out = String::new();
    print_nodes(nodes, notes, &mut out);
    out
}

fn print_nodes(nodes: &[Node], notes: &Notes, out: &mut String) {
    for n in nodes {
        print_node(n, notes, out);
    }
}

/// Emit any migration notes attached to `span` as `{{! migrate: … }}` comments.
fn emit_notes(span: Span, notes: &Notes, out: &mut String) {
    if let Some(msgs) = notes.get(&span.start) {
        for m in msgs {
            out.push_str("{{! migrate: ");
            out.push_str(m);
            out.push_str(" }}");
        }
    }
}

fn print_node(n: &Node, notes: &Notes, out: &mut String) {
    match n {
        Node::Text(s) => out.push_str(s),
        Node::Output { span, expr, raw } => {
            emit_notes(*span, notes, out);
            out.push_str(if *raw { "{{{" } else { "{{" });
            print_expr(expr, out);
            out.push_str(if *raw { "}}}" } else { "}}" });
        }
        Node::Each(e) => print_each(e, notes, out),
        Node::Cond(c) => print_cond(c, notes, out),
        Node::With(w) => print_with(w, notes, out),
        Node::Partial { span, name, ctx } => {
            emit_notes(*span, notes, out);
            out.push_str("{{> ");
            out.push_str(name);
            if let Some(ctx) = ctx {
                out.push(' ');
                print_expr(ctx, out);
            }
            out.push_str("}}");
        }
        // The remaining IR variants are not produced by the Mustache lowering; they are
        // serialized when a later dialect needs them. Until then a faithful fallback
        // keeps the printer total without inventing surface for untested shapes.
        other => print_unsupported(other, out),
    }
}

fn print_each(e: &Each, notes: &Notes, out: &mut String) {
    emit_notes(e.span, notes, out);
    out.push_str("{{#each ");
    // `item [index] in coll [label name]`, or a bare `coll` (which re-roots `this`).
    if let Some(item) = &e.item {
        out.push_str(item);
        if let Some(index) = &e.index {
            out.push(' ');
            out.push_str(index);
        }
        out.push_str(" in ");
    }
    print_expr(&e.subject, out);
    if let Some(label) = &e.label {
        out.push_str(" label ");
        out.push_str(label);
    }
    out.push_str("}}");
    print_nodes(&e.body, notes, out);
    if !e.otherwise.is_empty() {
        out.push_str("{{else}}");
        print_nodes(&e.otherwise, notes, out);
    }
    out.push_str("{{/each}}");
}

fn print_cond(c: &Cond, notes: &Notes, out: &mut String) {
    emit_notes(c.span, notes, out);
    // A plain negation with no `else if` arms is idiomatic `{{#unless}}`.
    let unless = c.negated && c.elifs.is_empty();
    if unless {
        out.push_str("{{#unless ");
        print_expr(&c.cond, out);
    } else {
        out.push_str("{{#if ");
        if c.negated {
            // Negation with `else if` arms cannot be `unless`; guard the head instead.
            out.push_str("(not ");
            print_expr(&c.cond, out);
            out.push(')');
        } else {
            print_expr(&c.cond, out);
        }
    }
    out.push_str("}}");
    print_nodes(&c.body, notes, out);
    for (cond, body) in &c.elifs {
        out.push_str("{{else if ");
        print_expr(cond, out);
        out.push_str("}}");
        print_nodes(body, notes, out);
    }
    if !c.otherwise.is_empty() {
        out.push_str("{{else}}");
        print_nodes(&c.otherwise, notes, out);
    }
    out.push_str(if unless { "{{/unless}}" } else { "{{/if}}" });
}

fn print_with(w: &With, notes: &Notes, out: &mut String) {
    emit_notes(w.span, notes, out);
    out.push_str("{{#with ");
    print_expr(&w.subject, out);
    out.push_str("}}");
    print_nodes(&w.body, notes, out);
    if !w.otherwise.is_empty() {
        out.push_str("{{else}}");
        print_nodes(&w.otherwise, notes, out);
    }
    out.push_str("{{/with}}");
}

/// A faithful fallback for IR variants the Mustache lowering never emits.
fn print_unsupported(n: &Node, out: &mut String) {
    out.push_str("{{! migrate: unsupported node ");
    out.push_str(node_kind(n));
    out.push_str(" }}");
}

fn node_kind(n: &Node) -> &'static str {
    match n {
        Node::Text(_) => "text",
        Node::Output { .. } => "output",
        Node::Each(_) => "each",
        Node::Cond(_) => "cond",
        Node::Case(_) => "case",
        Node::With(_) => "with",
        Node::Let { .. } => "let",
        Node::Partial { .. } => "partial",
        Node::Inline { .. } => "inline",
        Node::PartialBlock { .. } => "partial-block",
        Node::Yield { .. } => "yield",
        Node::RawBlock { .. } => "raw-block",
        Node::HelperBlock(_) => "helper-block",
    }
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

fn print_expr(e: &Expr, out: &mut String) {
    match e {
        Expr::Lit(v) => print_lit(v, out),
        Expr::App(name, args) => print_app(name, args, out),
    }
}

fn print_lit(v: &Value, out: &mut String) {
    match v {
        Value::Str(s) => {
            out.push('"');
            for ch in s.chars() {
                if ch == '"' || ch == '\\' {
                    out.push('\\');
                }
                out.push(ch);
            }
            out.push('"');
        }
        Value::Num(n) => out.push_str(&fmt_num(*n)),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Null => out.push_str("null"),
    }
}

fn fmt_num(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn print_app(name: &str, args: &[Expr], out: &mut String) {
    match (name, args) {
        ("this", []) => out.push_str("this"),
        ("root", []) => out.push_str("@root"),
        ("loop", []) => out.push_str("loop"),
        ("lookup", [root, keys @ ..]) => print_path(root, keys, out),
        (n, []) => out.push_str(n),
        (n, args) => {
            // A helper / operator application; the parenthesised prefix form is valid
            // surface (juxtaposition is application, parens group).
            out.push('(');
            out.push_str(n);
            for a in args {
                out.push(' ');
                print_expr(a, out);
            }
            out.push(')');
        }
    }
}

/// Re-sugar a `lookup` chain to a dotted path, dropping the implicit `this` root.
fn print_path(root: &Expr, keys: &[Expr], out: &mut String) {
    // The base: implicit (`this`) prints nothing; a bound name / reserved root prints
    // itself; anything else is parenthesised.
    let mut first_written = false;
    match root {
        Expr::App(r, ra) if r == "this" && ra.is_empty() => {}
        Expr::App(r, ra) if ra.is_empty() => {
            out.push_str(if r == "root" { "@root" } else { r });
            first_written = true;
        }
        other => {
            print_expr(other, out);
            first_written = true;
        }
    }
    for key in keys {
        match key {
            Expr::Lit(Value::Str(s)) if is_ident(s) => {
                if first_written {
                    out.push('.');
                }
                out.push_str(s);
            }
            Expr::Lit(Value::Str(s)) => {
                // A non-identifier segment uses the bracket form `a.[seg]`.
                if first_written {
                    out.push('.');
                }
                out.push('[');
                out.push_str(s);
                out.push(']');
            }
            other => {
                out.push_str(".[");
                print_expr(other, out);
                out.push(']');
            }
        }
        first_written = true;
    }
    if !first_written {
        out.push_str("this");
    }
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span() -> Span {
        Span::new(0, 0)
    }

    fn this() -> Expr {
        Expr::nullary("this")
    }

    /// `lookup(this, keys…)` — a bare dotted path.
    fn path(keys: &[&str]) -> Expr {
        let mut args = vec![this()];
        args.extend(keys.iter().map(|k| Expr::str(k)));
        Expr::App("lookup".into(), args)
    }

    fn out(e: Expr, raw: bool) -> Node {
        Node::Output {
            span: span(),
            expr: e,
            raw,
        }
    }

    #[test]
    fn text_and_variable() {
        let n = vec![Node::Text("Hi ".into()), out(path(&["name"]), false)];
        assert_eq!(to_truss(&n), "Hi {{name}}");
    }

    #[test]
    fn raw_and_dotted_and_this() {
        assert_eq!(to_truss(&[out(path(&["html"]), true)]), "{{{html}}}");
        assert_eq!(to_truss(&[out(path(&["a", "b"]), false)]), "{{a.b}}");
        assert_eq!(to_truss(&[out(this(), false)]), "{{this}}");
    }

    #[test]
    fn bracket_segment_for_non_ident() {
        assert_eq!(to_truss(&[out(path(&["a", "b c"]), false)]), "{{a.[b c]}}");
    }

    #[test]
    fn each_bare_reroots() {
        let e = Each {
            span: span(),
            subject: path(&["items"]),
            item: None,
            index: None,
            label: None,
            body: vec![out(path(&["name"]), false)],
            otherwise: vec![],
        };
        assert_eq!(
            to_truss(&[Node::Each(e)]),
            "{{#each items}}{{name}}{{/each}}"
        );
    }

    #[test]
    fn each_with_binding_index_and_else() {
        let e = Each {
            span: span(),
            subject: path(&["rows"]),
            item: Some("row".into()),
            index: Some("i".into()),
            label: None,
            body: vec![Node::Text("x".into())],
            otherwise: vec![Node::Text("none".into())],
        };
        assert_eq!(
            to_truss(&[Node::Each(e)]),
            "{{#each row i in rows}}x{{else}}none{{/each}}"
        );
    }

    #[test]
    fn cond_if_and_unless() {
        let mk = |negated| {
            Node::Cond(Cond {
                span: span(),
                negated,
                cond: path(&["ok"]),
                body: vec![Node::Text("y".into())],
                elifs: vec![],
                otherwise: vec![],
            })
        };
        assert_eq!(to_truss(&[mk(false)]), "{{#if ok}}y{{/if}}");
        assert_eq!(to_truss(&[mk(true)]), "{{#unless ok}}y{{/unless}}");
    }

    #[test]
    fn cond_with_else() {
        let c = Cond {
            span: span(),
            negated: false,
            cond: path(&["ok"]),
            body: vec![Node::Text("y".into())],
            elifs: vec![],
            otherwise: vec![Node::Text("n".into())],
        };
        assert_eq!(to_truss(&[Node::Cond(c)]), "{{#if ok}}y{{else}}n{{/if}}");
    }

    #[test]
    fn with_block() {
        let w = With {
            span: span(),
            subject: path(&["user"]),
            body: vec![out(path(&["name"]), false)],
            otherwise: vec![],
        };
        assert_eq!(
            to_truss(&[Node::With(w)]),
            "{{#with user}}{{name}}{{/with}}"
        );
    }

    #[test]
    fn partial_with_and_without_ctx() {
        assert_eq!(
            to_truss(&[Node::Partial {
                span: span(),
                name: "footer".into(),
                ctx: None
            }]),
            "{{> footer}}"
        );
        assert_eq!(
            to_truss(&[Node::Partial {
                span: span(),
                name: "card".into(),
                ctx: Some(path(&["post"])),
            }]),
            "{{> card post}}"
        );
    }

    #[test]
    fn string_literal_escaping() {
        let app = Expr::App("eq".into(), vec![path(&["x"]), Expr::str("a\"b")]);
        assert_eq!(to_truss(&[out(app, false)]), "{{(eq x \"a\\\"b\")}}");
    }

    #[test]
    fn notes_are_woven_inline() {
        let mut notes = Notes::new();
        notes.insert(0, vec!["assumed iteration; verify".into()]);
        let e = Each {
            span: Span::new(0, 5),
            subject: path(&["items"]),
            item: None,
            index: None,
            label: None,
            body: vec![],
            otherwise: vec![],
        };
        assert_eq!(
            to_truss_annotated(&[Node::Each(e)], &notes),
            "{{! migrate: assumed iteration; verify }}{{#each items}}{{/each}}"
        );
    }
}
