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
use trussbars_template::ast::{Case, Cond, Each, Expr, HelperBlock, Node, Value, With};

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
            print_top_expr(expr, out);
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
        Node::Let {
            span,
            bindings,
            body,
        } => {
            emit_notes(*span, notes, out);
            out.push_str("{{#let");
            for (name, value) in bindings {
                out.push(' ');
                out.push_str(name);
                out.push_str("=(");
                print_expr(value, out);
                out.push(')');
            }
            out.push_str("}}");
            print_nodes(body, notes, out);
            out.push_str("{{/let}}");
        }
        Node::Case(c) => print_case(c, notes, out),
        Node::Inline { span, name, body } => {
            emit_notes(*span, notes, out);
            out.push_str("{{#inline ");
            quote(name, out);
            out.push_str("}}");
            print_nodes(body, notes, out);
            out.push_str("{{/inline}}");
        }
        Node::PartialBlock {
            span,
            name,
            ctx,
            body,
        } => {
            emit_notes(*span, notes, out);
            out.push_str("{{#partial ");
            quote(name, out);
            if let Some(ctx) = ctx {
                out.push(' ');
                print_expr(ctx, out);
            }
            out.push_str("}}");
            print_nodes(body, notes, out);
            out.push_str("{{/partial}}");
        }
        Node::Yield { span } => {
            emit_notes(*span, notes, out);
            out.push_str("{{yield}}");
        }
        Node::RawBlock { span, body } => {
            emit_notes(*span, notes, out);
            out.push_str("{{{{raw}}}}");
            out.push_str(body);
            out.push_str("{{{{/raw}}}}");
        }
        Node::HelperBlock(b) => print_helper_block(b, notes, out),
    }
}

fn print_case(c: &Case, notes: &Notes, out: &mut String) {
    emit_notes(c.span, notes, out);
    out.push_str("{{#case ");
    print_expr(&c.subject, out);
    out.push_str("}}");
    for (values, body) in &c.arms {
        out.push_str("{{when");
        for v in values {
            out.push(' ');
            print_expr(v, out);
        }
        out.push_str("}}");
        print_nodes(body, notes, out);
    }
    if !c.otherwise.is_empty() {
        out.push_str("{{else}}");
        print_nodes(&c.otherwise, notes, out);
    }
    out.push_str("{{/case}}");
}

fn print_helper_block(b: &HelperBlock, notes: &Notes, out: &mut String) {
    emit_notes(b.span, notes, out);
    out.push_str("{{#");
    out.push_str(&b.head);
    for a in &b.args {
        out.push(' ');
        print_expr(a, out);
    }
    out.push_str("}}");
    print_nodes(&b.body, notes, out);
    out.push_str("{{/");
    out.push_str(&b.head);
    out.push_str("}}");
}

/// Append `s` to `out` as a quoted, escaped string literal.
fn quote(s: &str, out: &mut String) {
    print_lit(&Value::Str(s.to_string()), out);
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

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

fn print_expr(e: &Expr, out: &mut String) {
    match e {
        Expr::Lit(v) => print_lit(v, out),
        Expr::App(name, args) => print_app(name, args, out),
    }
}

/// Print a top-level expression (a tag's whole content): a bare helper application
/// `helper a b` needs no surrounding parens here, unlike when nested as an operand.
fn print_top_expr(e: &Expr, out: &mut String) {
    match e {
        Expr::App(name, args)
            if !args.is_empty()
                && infix_op(name).is_none()
                && !matches!(
                    name.as_str(),
                    "lookup"
                        | "this"
                        | "root"
                        | "loop"
                        | "@parentchain"
                        | "ternary"
                        | "not"
                        | "range"
                ) =>
        {
            out.push_str(name);
            for a in args {
                out.push(' ');
                print_expr(a, out);
            }
        }
        _ => print_expr(e, out),
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
        // Re-sugar the desugared operators back to idiomatic infix / prefix / ternary.
        ("ternary", [c, a, b]) => {
            print_operand(c, out);
            out.push_str(" ? ");
            print_operand(a, out);
            out.push_str(" : ");
            print_operand(b, out);
        }
        ("not", [a]) => {
            out.push('!');
            print_operand(a, out);
        }
        // The range operator is idiomatically unspaced (`1..5`).
        ("range", [a, b]) => {
            print_operand(a, out);
            out.push_str("..");
            print_operand(b, out);
        }
        (n, [a, b]) if infix_op(n).is_some() => {
            print_operand(a, out);
            out.push(' ');
            out.push_str(infix_op(n).expect("checked"));
            out.push(' ');
            print_operand(b, out);
        }
        (n, []) => out.push_str(n),
        (n, args) => {
            // A helper application: juxtaposition is application; parens group.
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

/// The infix spelling of a desugared binary-operator head, if it is one.
fn infix_op(name: &str) -> Option<&'static str> {
    Some(match name {
        "eq" => "==",
        "ne" => "!=",
        "lte" => "<=",
        "gte" => ">=",
        "lt" => "<",
        "gt" => ">",
        "and" => "&&",
        "or" => "||",
        "coalesce" => "??",
        "firstTruthy" => "?:",
        "add" => "+",
        "subtract" => "-",
        "range" => "..",
        "multiply" => "*",
        "divide" => "/",
        "modulo" => "%",
        _ => return None,
    })
}

/// Whether an expression must be parenthesised when used as an operator/ternary operand
/// (any compound operator application; leaves and calls bind tightly enough already).
fn needs_parens(e: &Expr) -> bool {
    match e {
        Expr::App(n, args) => {
            (n == "ternary" && args.len() == 3)
                || (n == "not" && args.len() == 1)
                || (args.len() == 2 && infix_op(n).is_some())
        }
        Expr::Lit(_) => false,
    }
}

/// Print an operand, wrapping a compound operator application in parens for clarity.
fn print_operand(e: &Expr, out: &mut String) {
    if needs_parens(e) {
        out.push('(');
        print_expr(e, out);
        out.push(')');
    } else {
        print_expr(e, out);
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
        assert_eq!(to_truss(&[out(app, false)]), "{{x == \"a\\\"b\"}}");
    }

    #[test]
    fn ternary_resugars_to_infix() {
        let t = Expr::App(
            "ternary".into(),
            vec![path(&["ok"]), path(&["yes"]), Expr::str("no")],
        );
        assert_eq!(to_truss(&[out(t, false)]), "{{ok ? yes : \"no\"}}");
    }

    #[test]
    fn operators_resugar_and_parenthesise() {
        // `and(eq(a, "x"), b)` → `(a == "x") && b`.
        let e = Expr::App(
            "and".into(),
            vec![
                Expr::App("eq".into(), vec![path(&["a"]), Expr::str("x")]),
                path(&["b"]),
            ],
        );
        assert_eq!(to_truss(&[out(e, false)]), "{{(a == \"x\") && b}}");
    }

    #[test]
    fn not_resugars_to_prefix() {
        let e = Expr::App("not".into(), vec![path(&["done"])]);
        assert_eq!(to_truss(&[out(e, false)]), "{{!done}}");
    }

    #[test]
    fn coalesce_and_elvis() {
        let c = Expr::App("coalesce".into(), vec![path(&["name"]), Expr::str("anon")]);
        assert_eq!(to_truss(&[out(c, false)]), "{{name ?? \"anon\"}}");
    }

    #[test]
    fn let_block() {
        let n = Node::Let {
            span: span(),
            bindings: vec![("x".into(), path(&["a", "b"]))],
            body: vec![out(path(&["x"]), false)],
        };
        assert_eq!(to_truss(&[n]), "{{#let x=(a.b)}}{{x}}{{/let}}");
    }

    #[test]
    fn case_block() {
        let n = Node::Case(trussbars_template::ast::Case {
            span: span(),
            subject: path(&["status"]),
            arms: vec![
                (
                    vec![Expr::str("a"), Expr::str("b")],
                    vec![Node::Text("AB".into())],
                ),
                (vec![Expr::str("c")], vec![Node::Text("C".into())]),
            ],
            otherwise: vec![Node::Text("else".into())],
        });
        assert_eq!(
            to_truss(&[n]),
            "{{#case status}}{{when \"a\" \"b\"}}AB{{when \"c\"}}C{{else}}else{{/case}}"
        );
    }

    #[test]
    fn helper_block() {
        let n = Node::HelperBlock(trussbars_template::ast::HelperBlock {
            span: span(),
            head: "bold".into(),
            args: vec![path(&["x"])],
            body: vec![Node::Text("hi".into())],
        });
        assert_eq!(to_truss(&[n]), "{{#bold x}}hi{{/bold}}");
    }

    #[test]
    fn inline_partial_block_and_yield() {
        let inline = Node::Inline {
            span: span(),
            name: "card".into(),
            body: vec![Node::Yield { span: span() }],
        };
        assert_eq!(
            to_truss(&[inline]),
            "{{#inline \"card\"}}{{yield}}{{/inline}}"
        );
        let pblock = Node::PartialBlock {
            span: span(),
            name: "layout".into(),
            ctx: None,
            body: vec![Node::Text("body".into())],
        };
        assert_eq!(
            to_truss(&[pblock]),
            "{{#partial \"layout\"}}body{{/partial}}"
        );
    }

    #[test]
    fn raw_block() {
        let n = Node::RawBlock {
            span: span(),
            body: "{{x}}".into(),
        };
        assert_eq!(to_truss(&[n]), "{{{{raw}}}}{{x}}{{{{/raw}}}}");
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
