//! Slice 3 — the block parser + desugar: the [`Lexeme`] stream → a desugared
//! [`Node`] tree (docs/08 §6.3). Matches block opens/closes, dispatches
//! if/unless/each/with/let/partials/raw, parses the Liquid `each` binding and the
//! `let` hash, threads a [`Scope`] for path rooting, and splits the `{% %}`-only
//! `{% else %}` / `{% elif %}` / `{% when %}` clauses.

use crate::ast::{Case, Cond, Expr, For, HelperBlock, Node, Value, With};
use crate::lex::{Lexeme, Sigil, lex};
use crate::parse_expr::{ParseError, Scope, parse_expr};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// An include's `key=value` hash arguments (ADR-042 §8).
type PartialHash = Vec<(String, Expr)>;

/// Parse a template source into a desugared [`Node`] tree.
///
/// # Errors
/// Returns a [`ParseError`] for a lex failure, an unclosed/mismatched block, or a
/// malformed expression. A non-built-in block head is *not* an error here — it parses
/// to a meaning-free [`Node::HelperBlock`] the emitter/VM resolve against the host
/// allow-list (an undeclared one becomes a located "unknown helper" there).
pub fn parse(src: &str) -> Result<Vec<Node>, ParseError> {
    let nodes = parse_raw(src)?;
    // ADR-040: flatten `{% extends %}`/`{% block %}`/`{% super %}` into a plain tree before the
    // emitter/VM ever see it (`crate::inherit`). Then ADR-042 §8: fill omitted optional
    // inline-parameter defaults into each include's hash, after inheritance flattening.
    crate::inherit::resolve_inheritance(nodes).map(crate::sig::augment_signatures)
}

/// Parse to the raw [`Node`] tree **without** the ADR-040 inheritance flatten or the ADR-042 §8
/// signature augmentation that [`parse`] applies. The AOT path
/// ([`crate::emit::emit_with_partials`]) needs this so it can defer the inheritance flatten until
/// after the cross-file-partial base registry is built — a `{% extends "name" %}` whose base is a
/// `partials = [name = "file"]` import can only resolve once that file is known. The interpreter
/// and VM (single-template, no cross-file partials) keep using [`parse`], so their inheritance
/// still resolves at parse time exactly as before.
pub(crate) fn parse_raw(src: &str) -> Result<Vec<Node>, ParseError> {
    let mut lexemes = lex(src).map_err(|e| ParseError {
        message: e.message,
        at: e.at,
    })?;
    // Standalone-line whitespace trimming (the Handlebars/MaxBars rule): a block
    // open/close, comment, or clause separator (`else`/`elif`) alone on its line
    // leaves no blank line. Run on the lexeme stream before parsing, matching the
    // PureScript `FlatBars.Lexer.trimStandalone` — so v2 is byte-identical to v1.
    crate::lex::trim_standalone(src, &mut lexemes);
    let mut p = Blocks {
        lexemes: &lexemes,
        src,
        pos: 0,
    };
    let scope = Scope::new();
    let (nodes, stop) = p.parse_until(&scope)?;
    match stop {
        Stop::Eof => Ok(nodes),
        Stop::Close(name) => err(format!("unexpected `{{% end{name} %}}` (no open block)"), 0),
        Stop::Else | Stop::ElseIf(_) => {
            err("unexpected `{% else %}` outside a block".to_string(), 0)
        }
        Stop::When(_) => err(
            "unexpected `{% when %}` outside a `{% case %}`".to_string(),
            0,
        ),
    }
}

fn err<T>(message: impl Into<String>, at: usize) -> Result<T, ParseError> {
    Err(ParseError {
        message: message.into(),
        at,
    })
}

/// The built-in block heads `open_block` dispatches — reserved, so a host cannot declare a
/// block helper with one of these names (docs/12 §5.2). Keep in sync with `open_block`.
pub const RESERVED_BLOCK_HEADS: &[&str] = &[
    "if", "unless", "for", "scope", "local", "case", "inline", "partial", "yield", "block",
    "extends", "super",
];

/// What stopped a body scan.
enum Stop {
    /// A `{% endname %}` close.
    Close(String),
    /// A `{% else %}`.
    Else,
    /// A `{% elif cond %}` (the raw condition source). The two-word `else if` is gone.
    ElseIf(String),
    /// A `{% when V … %}` arm of a `{% case %}` (the raw value-expression source).
    When(String),
    /// End of input.
    Eof,
}

struct Blocks<'a> {
    lexemes: &'a [Lexeme],
    src: &'a str,
    pos: usize,
}

impl Blocks<'_> {
    /// Parse nodes until a close tag, a separator, or EOF.
    fn parse_until(&mut self, scope: &Scope) -> Result<(Vec<Node>, Stop), ParseError> {
        let mut nodes = Vec::new();
        loop {
            let Some(lex) = self.lexemes.get(self.pos) else {
                return Ok((nodes, Stop::Eof));
            };
            match lex {
                Lexeme::Text(span) => {
                    nodes.push(Node::Text(span.of(self.src).to_string()));
                    self.pos += 1;
                }
                Lexeme::Tag {
                    sigil: Sigil::Comment,
                    ..
                } => self.pos += 1,
                Lexeme::Tag {
                    sigil: Sigil::Close,
                    interior,
                    ..
                } => {
                    let name = head_word(interior.of(self.src)).to_string();
                    self.pos += 1;
                    return Ok((nodes, Stop::Close(name)));
                }
                // A `{% else %}` / `{% elif … %}` / `{% when … %}` clause separator. The
                // lexer tags ONLY the `{% %}` form as `Clause`, so a brace-form `{{else}}`
                // never reaches here — it is plain output (PURE grammar).
                Lexeme::Tag {
                    sigil: Sigil::Clause,
                    interior,
                    ..
                } => {
                    let text = interior.of(self.src).trim();
                    self.pos += 1;
                    if text == "else" {
                        return Ok((nodes, Stop::Else));
                    }
                    // `elif` is the sole chained-conditional spelling — the two-word
                    // `else if` sugar is gone (PURE grammar), so `{% else if … %}` falls
                    // through to the "unexpected clause" error below.
                    if let Some(c) = strip_elif(text) {
                        return Ok((nodes, Stop::ElseIf(c.to_string())));
                    }
                    if let Some(vals) = strip_when(text) {
                        return Ok((nodes, Stop::When(vals.to_string())));
                    }
                    // Unreachable: the lexer only tags `else`/`elif`/`when` as `Clause`.
                    return err(format!("unexpected clause `{{% {text} %}}`"), 0);
                }
                Lexeme::Tag {
                    sigil: Sigil::Output,
                    interior,
                    span,
                } => {
                    let span = *span;
                    let text = interior.of(self.src).trim();
                    let expr = parse_expr(text, scope)?;
                    // PURE grammar (ADR-039): raw (un-escaped) output is `{{ E | safe }}`,
                    // not a `{{{ }}}` sigil. A `safe` *final* pipe desugars to the raw-output
                    // flag, reusing the same raw path the AOT (`write_text`) and VM
                    // (`raw_text`) already have — so no `{{{ }}}` and no VM `Safe` value.
                    // (Host helpers that return a `Safe` value, e.g. `markdown`, keep the
                    // runtime SafeString mechanism; only the bare `safe` filter desugars.)
                    let (expr, raw) = match expr {
                        Expr::App(name, mut a) if name == "safe" && a.len() == 1 => {
                            (a.remove(0), true)
                        }
                        other => (other, false),
                    };
                    nodes.push(Node::Output { span, expr, raw });
                    self.pos += 1;
                }
                Lexeme::Tag {
                    sigil: Sigil::Partial,
                    interior,
                    span,
                } => {
                    let node = self.partial_use(*span, interior.of(self.src), scope)?;
                    nodes.push(node);
                    self.pos += 1;
                }
                Lexeme::Tag {
                    sigil: Sigil::Open,
                    interior,
                    span,
                } => {
                    let interior_str = interior.of(self.src);
                    // `{% capture NAME %}` (ADR-25 / docs/18) is a *tail-wrapping* desugar: the
                    // rest of this sibling list becomes the body of a forward `{% local %}`, so
                    // NAME binds forward to the enclosing block's close. Handled here, not in
                    // `open_block`, because it emits two nodes and consumes the sibling tail.
                    if head_word(interior_str) == "capture" {
                        let stop = self.capture_desugar(*span, interior_str, scope, &mut nodes)?;
                        return Ok((nodes, stop));
                    }
                    // `{% apply PIPELINE %}BODY{% endapply %}` (ADR-25): output the body piped
                    // through PIPELINE (the body is its leading subject). Unlike capture it does
                    // not wrap the tail — it emits an inline + an Output, then parsing continues.
                    if head_word(interior_str) == "apply" {
                        self.apply_desugar(*span, interior_str, scope, &mut nodes)?;
                        continue;
                    }
                    let node = self.open_block(*span, interior_str, scope)?;
                    nodes.push(node);
                }
                Lexeme::RawBlock { body, span, .. } => {
                    nodes.push(Node::RawBlock {
                        span: *span,
                        body: body.of(self.src).to_string(),
                    });
                    self.pos += 1;
                }
            }
        }
    }

    /// Dispatch a `{%  …  %}` block (called with `pos` at the open tag). The built-in
    /// heads matched here are [`RESERVED_BLOCK_HEADS`] — they cannot name a host helper.
    fn open_block(
        &mut self,
        span: crate::span::Span,
        interior: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        self.pos += 1; // consume the open tag
        let (head, rest) = split_head(interior);
        match head {
            "if" => self.cond_block(span, rest, false, scope),
            "unless" => self.cond_block(span, rest, true, scope),
            // ADR-039 item 4: the loop keyword is `for` (renamed from `each`),
            // binding Liquid-style `for x in xs` or bare `for xs`; `each` is rejected.
            "for" => self.for_block(span, "for", rest, scope),
            "each" => err(
                "the loop keyword is renamed `for` (ADR-039) — write `{% for x in xs %}` (or bare `{% for xs %}`) … `{% endfor %}`",
                span.start,
            ),
            // ADR-039 item 9: the context re-root is spelled `scope` (renamed from
            // `with`); `with` is rejected with a located fix-it.
            "scope" => self.with_block(span, "scope", rest, scope),
            "with" => err(
                "the context re-root is renamed `scope` (ADR-039) — write `{% scope … %}` … `{% endscope %}`",
                span.start,
            ),
            // ADR-25: the block filter is `apply`, not `filter` (which collides with the
            // collection filter / value pipes — Twig's correction).
            "filter" => err(
                "the block filter is `apply` (ADR-25) — write `{% apply upper | truncate 50 %}` … `{% endapply %}` to pipe the body",
                span.start,
            ),
            // `{% local … %}` is the bounded block binding (docs-17). The retired `let`
            // head is NOT recognized — it falls through to `helper_block` and fails as a
            // plain "unknown helper" error (no compat mapping).
            "local" => self.let_block(span, head, rest, scope),
            "case" => self.case_block(span, rest, scope),
            "inline" => self.inline_block(span, rest, scope),
            "partial" => self.partial_block(span, rest, scope),
            // The block-partial slot `{% yield %}` (ADR-039: control, no longer the
            // `{% yield %}` output form) — a standalone tag with no body and no arguments.
            "yield" => {
                if !rest.trim().is_empty() {
                    return err("`{% yield %}` takes no arguments", span.start);
                }
                Ok(Node::Yield { span })
            }
            // ADR-040 inheritance, all consumed by the `inherit` flatten pass:
            // `{% block name %}…{% endblock %}` (a named slot), `{% extends "base" %}`
            // (a block-less directive), and `{% super %}` (a block-less parent splice).
            "block" => self.block_def(span, rest, scope),
            "extends" => self.extends_directive(span, rest),
            "super" => {
                if !rest.trim().is_empty() {
                    return err("`{% super %}` takes no arguments", span.start);
                }
                Ok(Node::Super { span })
            }
            // Any other head is a *host block helper* (docs/09): parse it meaning-free
            // into a generic node; the emitter/VM resolve it against the allow-list.
            other => self.helper_block(span, other, rest, scope),
        }
    }

    /// Parse a `{% name args… %}body{% endname %}` host block helper. The parser attaches no
    /// meaning (it does not check the allow-list); `{% else %}` is unsupported (v1).
    fn helper_block(
        &mut self,
        span: crate::span::Span,
        head: &str,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        // Args are the expressions after the head — parse `head rest` as an application and
        // take its arguments (the same arg grammar as a value call).
        let args = if rest.trim().is_empty() {
            Vec::new()
        } else {
            match parse_expr(&format!("{head} {rest}"), scope)? {
                Expr::App(_, a) => a,
                other => vec![other],
            }
        };
        let (body, stop) = self.parse_until(scope)?;
        match stop {
            Stop::Close(name) if close_matches(&name, head) => Ok(Node::HelperBlock(HelperBlock {
                span,
                head: head.to_string(),
                args,
                body,
            })),
            Stop::Close(name) => err(mismatched_close(&name, head), span.start),
            Stop::Else | Stop::ElseIf(_) => err(
                // Forward-looking: the inverse-arm convention is frozen but not yet built
                // (docs/09 §3.1, "Planned"). Until a consumer needs it, this is a located
                // reject rather than a silent drop.
                format!("block helper `{head}`: `{{% else %}}` is not yet supported"),
                span.start,
            ),
            Stop::When(_) => err(
                format!("block helper `{head}`: `{{% when %}}` is only valid in a `{{% case %}}`"),
                span.start,
            ),
            Stop::Eof => err(
                format!("unclosed block helper `{{% {head} %}}`"),
                span.start,
            ),
        }
    }

    fn cond_block(
        &mut self,
        span: crate::span::Span,
        cond_src: &str,
        negated: bool,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let open = if negated { "unless" } else { "if" };
        let cond = parse_expr(cond_src.trim(), scope)?;
        let (body, mut stop) = self.parse_until(scope)?;
        let mut elifs = Vec::new();
        let mut otherwise = Vec::new();
        loop {
            match stop {
                Stop::ElseIf(c) => {
                    let econd = parse_expr(c.trim(), scope)?;
                    let (ebody, s) = self.parse_until(scope)?;
                    elifs.push((econd, ebody));
                    stop = s;
                }
                Stop::Else => {
                    let (ebody, s) = self.parse_until(scope)?;
                    otherwise = ebody;
                    expect_close(&s, open, span.start)?;
                    break;
                }
                Stop::Close(name) if close_matches(&name, open) => break,
                Stop::Close(name) => return err(mismatched_close(&name, open), span.start),
                Stop::When(_) => {
                    return err(
                        "unexpected `{% when %}` outside a `{% case %}` block",
                        span.start,
                    );
                }
                Stop::Eof => return err("unclosed conditional block", span.start),
            }
        }
        Ok(Node::Cond(Cond {
            span,
            negated,
            cond,
            body,
            elifs,
            otherwise,
        }))
    }

    /// `{% case SUBJECT %}{% when V … %}…{% else %}…{% endcase %}` — the multi-arm conditional
    /// (docs/12). First-class [`Case`]: the subject and each arm's raw value(s) are kept so
    /// the emitter can lower it to a Rust `match` (the subject evaluated once) rather than a
    /// repeated-`eq` `if`-chain.
    fn case_block(
        &mut self,
        span: crate::span::Span,
        subject_src: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let subject = parse_expr(subject_src.trim(), scope)?;
        // Only whitespace may precede the first `{% when %}` (no Liquid-style fall-through).
        let (leading, mut stop) = self.parse_until(scope)?;
        if leading.iter().any(|n| !is_blank_text(n)) {
            return err(
                "only whitespace may precede the first `{% when %}` in a `{% case %}`",
                span.start,
            );
        }
        let mut arms: Vec<(Vec<Expr>, Vec<Node>)> = Vec::new();
        let mut otherwise: Vec<Node> = Vec::new();
        loop {
            match stop {
                Stop::When(vals) => {
                    let values = when_values(&vals, scope)?;
                    let (body, s) = self.parse_until(scope)?;
                    arms.push((values, body));
                    stop = s;
                }
                Stop::Else => {
                    let (ebody, s) = self.parse_until(scope)?;
                    otherwise = ebody;
                    expect_close(&s, "case", span.start)?;
                    break;
                }
                Stop::Close(name) if close_matches(&name, "case") => break,
                Stop::Close(name) => return err(mismatched_close(&name, "case"), span.start),
                Stop::ElseIf(_) => {
                    return err(
                        "`{% elif %}` is not valid in a `{% case %}` (use `{% when %}`)",
                        span.start,
                    );
                }
                Stop::Eof => return err("unclosed `{% case %}` block", span.start),
            }
        }
        Ok(Node::Case(Case {
            span,
            subject,
            arms,
            otherwise,
        }))
    }

    fn for_block(
        &mut self,
        span: crate::span::Span,
        head: &str,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (subject, item, index, label) = parse_for_binding(rest, scope)?;
        let mut bound = Vec::new();
        bound.extend(item.clone());
        bound.extend(index.clone());
        bound.extend(label.clone());
        let child = scope.with_all(&bound);
        let (body, stop) = self.parse_until(&child)?;
        let otherwise = self.else_arm(stop, scope, head, span.start)?;
        Ok(Node::For(For {
            span,
            subject,
            item,
            index,
            label,
            body,
            otherwise,
        }))
    }

    fn with_block(
        &mut self,
        span: crate::span::Span,
        head: &str,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let subject = parse_expr(rest.trim(), scope)?;
        // `scope` re-roots `this` to the subject but introduces no named binding.
        let (body, stop) = self.parse_until(scope)?;
        let otherwise = self.else_arm(stop, scope, head, span.start)?;
        Ok(Node::With(With {
            span,
            subject,
            body,
            otherwise,
        }))
    }

    fn let_block(
        &mut self,
        span: crate::span::Span,
        head: &str,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let mut bindings = Vec::new();
        let mut cur = scope.clone();
        let mut s = rest.trim();
        while !s.is_empty() {
            let (name, after) = read_ident(s).ok_or_else(|| ParseError {
                message: "expected a `let` binding name".into(),
                at: span.start,
            })?;
            let after = after.trim_start();
            let after = after.strip_prefix('=').ok_or_else(|| ParseError {
                message: "expected `=` in a `let` binding".into(),
                at: span.start,
            })?;
            // The value is either a parenthesised expression `=(…)` or a bare dict
            // literal `={…}` (the brace group is passed whole to the expr parser).
            let after = after.trim_start();
            let (value_src, tail) = if after.starts_with('{') {
                read_braces(after, span.start)?
            } else {
                read_paren(after, span.start)?
            };
            let value = parse_expr(value_src.trim(), &cur)?;
            cur = cur.with(name);
            bindings.push((name.to_string(), value));
            s = tail.trim_start();
        }
        let (body, stop) = self.parse_until(&cur)?;
        expect_close(&stop, head, span.start)?;
        Ok(Node::Let {
            span,
            bindings,
            body,
        })
    }

    /// `{% capture NAME %}BODY{% endcapture %}TAIL` → an inline def holding BODY + a forward
    /// `{% local NAME = (render "@cap$k") %}TAIL{% endlocal %}` (ADR-25 / docs/18, mirroring the
    /// oracle's `Kernel.SetSugar.liftSet`). The sibling tail becomes the local's body (forward
    /// scope); `(render "@cap$k")` renders BODY to a `Safe` value in the surrounding context.
    /// Pushes the two nodes onto `nodes` and returns the tail's `Stop` (the enclosing close).
    fn capture_desugar(
        &mut self,
        span: crate::span::Span,
        interior: &str,
        scope: &Scope,
        nodes: &mut Vec<Node>,
    ) -> Result<Stop, ParseError> {
        let rest = interior[head_word(interior).len()..].trim();
        let (name, _) = read_ident(rest).ok_or_else(|| ParseError {
            message: "{% capture %} needs a binding name".into(),
            at: span.start,
        })?;
        let name = name.to_string();
        self.pos += 1; // consume the `{% capture %}` open tag
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, "capture", span.start)?;
        // A hygienic, collision-free synthetic partial name (the source offset) — `@`-prefixed
        // so it is unreachable from author syntax and `render` stays internal (ADR-25 §4).
        let cap = format!("@cap${}", span.start);
        nodes.push(Node::Inline {
            span,
            name: cap.clone(),
            params: Vec::new(),
            body,
        });
        let (tail, tail_stop) = self.parse_until(&scope.with(name.as_str()))?;
        nodes.push(Node::Let {
            span,
            bindings: vec![(name, Expr::App("render".to_string(), vec![Expr::str(&cap)]))],
            body: tail,
        });
        Ok(tail_stop)
    }

    /// `{% apply PIPELINE %}BODY{% endapply %}` → an inline def holding BODY + an `Output` of
    /// `(render "@app$k") | PIPELINE` (ADR-25): the rendered body is the pipeline's implicit
    /// leading subject. The interior is parsed with the *full* expression parser (not the
    /// block-head grammar, which forbids `|`), with the `render` call prepended as the subject —
    /// so `{% apply upper | truncate 50 %}` becomes `truncate(upper(render "@app$k"), 50)`.
    /// Pushes the two nodes; parsing of the sibling tail continues normally (apply outputs, it
    /// does not bind).
    fn apply_desugar(
        &mut self,
        span: crate::span::Span,
        interior: &str,
        scope: &Scope,
        nodes: &mut Vec<Node>,
    ) -> Result<(), ParseError> {
        let pipeline = interior[head_word(interior).len()..].trim();
        if pipeline.is_empty() {
            return Err(ParseError {
                message: "{% apply %} needs a filter pipeline (e.g. `{% apply upper %}`)".into(),
                at: span.start,
            });
        }
        self.pos += 1; // consume the `{% apply %}` open tag
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, "apply", span.start)?;
        let app = format!("@app${}", span.start);
        // Parse `(render "@app$k") | <pipeline>` with the value-expression parser (pipes allowed).
        let expr = parse_expr(&format!("(render \"{app}\") | {pipeline}"), scope)?;
        nodes.push(Node::Inline {
            span,
            name: app,
            params: Vec::new(),
            body,
        });
        nodes.push(Node::Output {
            span,
            expr,
            raw: false,
        });
        Ok(())
    }

    fn inline_block(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (name, after) = read_string_literal(rest).ok_or_else(|| ParseError {
            message: "{% inline %} needs a quoted name".into(),
            at: span.start,
        })?;
        // ADR-042 §8: an optional `(p, q=default)` parameter signature. The parameter
        // names enter the body scope, so a bare `{{p}}` is a scoped reference the
        // include-site binding resolves.
        let params = parse_signature(after, span.start)?;
        let mut body_scope = scope.clone();
        for (p, _) in &params {
            body_scope = body_scope.with(p);
        }
        let (body, stop) = self.parse_until(&body_scope)?;
        expect_close(&stop, "inline", span.start)?;
        Ok(Node::Inline {
            span,
            name,
            params,
            body,
        })
    }

    /// `{% block name %}…{% endblock %}` (ADR-040) — a named inheritance slot. The name is
    /// a bare identifier; the body is the default (base) or override (child).
    fn block_def(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (name, _) = split_head(rest);
        if name.is_empty() {
            return err("`{% block %}` needs a name", span.start);
        }
        let name = name.to_string();
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, "block", span.start)?;
        Ok(Node::Block { span, name, body })
    }

    /// `{% extends "base" %}` (ADR-040) — a block-less inheritance directive (a quoted base
    /// name). No body: it is the first node of a child template.
    fn extends_directive(
        &mut self,
        span: crate::span::Span,
        rest: &str,
    ) -> Result<Node, ParseError> {
        let (name, _) = read_string_literal(rest.trim_start()).ok_or_else(|| ParseError {
            message: "`{% extends %}` needs a quoted base name".into(),
            at: span.start,
        })?;
        Ok(Node::Extends { span, name })
    }

    fn partial_block(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (name, after) = read_string_literal(rest).ok_or_else(|| ParseError {
            message: "{% partial %} needs a quoted name".into(),
            at: span.start,
        })?;
        let ctx = parse_opt_ctx(after, scope)?;
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, "partial", span.start)?;
        Ok(Node::PartialBlock {
            span,
            name,
            ctx,
            body,
        })
    }

    fn partial_use(
        &self,
        span: crate::span::Span,
        interior: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        // `{% include "name" %}` quotes the name; a bare head `{% include name %}` is a
        // (static) variable name. Accept either; a parenthesised/computed name is rejected
        // by `read_string_literal`/`split_head` returning no clean name.
        let (name, after) = match read_string_literal(interior.trim_start()) {
            Some((n, rest)) => (n, rest),
            None => {
                let (n, rest) = split_head(interior);
                (n.to_string(), rest)
            }
        };
        if name.is_empty() {
            return err(
                "a partial reference (`{% include \"name\" %}`) needs a name",
                span.start,
            );
        }
        let (ctx, hash) = parse_partial_args(after, scope, span.start)?;
        Ok(Node::Partial {
            span,
            name,
            ctx,
            hash,
        })
    }

    /// After a body, consume a `{% else %}` arm (if any) and require the close — which
    /// must name `open` (`each` / `with`).
    fn else_arm(
        &mut self,
        stop: Stop,
        scope: &Scope,
        open: &str,
        at: usize,
    ) -> Result<Vec<Node>, ParseError> {
        match stop {
            Stop::Close(name) if close_matches(&name, open) => Ok(Vec::new()),
            Stop::Close(name) => err(mismatched_close(&name, open), at),
            Stop::Else => {
                let (ebody, s) = self.parse_until(scope)?;
                expect_close(&s, open, at)?;
                Ok(ebody)
            }
            Stop::ElseIf(_) => err("`{% elif %}` is only valid in a conditional", at),
            Stop::When(_) => err("`{% when %}` is only valid in a `{% case %}`", at),
            Stop::Eof => err("unclosed block", at),
        }
    }
}

/// Whether a `{% endX %}` tag may close a `{% X %}` block. A *named* close must match the
/// open exactly. There is no bare `{% end %}` wildcard — `end` with no suffix lexes as an
/// *open* of a block named `end`, so `close` is never empty in practice (the guard is kept
/// defensively, and never tightens what already parsed).
fn close_matches(close: &str, open: &str) -> bool {
    close.is_empty() || close == open
}

/// The located message for a close tag that names the wrong block.
fn mismatched_close(close: &str, open: &str) -> String {
    format!("mismatched closing tag `{{% end{close} %}}` (expected `{{% end{open} %}}`)")
}

fn expect_close(stop: &Stop, open: &str, at: usize) -> Result<(), ParseError> {
    match stop {
        Stop::Close(name) if close_matches(name, open) => Ok(()),
        Stop::Close(name) => err(mismatched_close(name, open), at),
        _ => err("expected a closing tag", at),
    }
}

fn parse_opt_ctx(rest: &str, scope: &Scope) -> Result<Option<Expr>, ParseError> {
    let r = rest.trim();
    if r.is_empty() {
        Ok(None)
    } else {
        Ok(Some(parse_expr(r, scope)?))
    }
}

// ── the Liquid `each` binding ─────────────────────────────────────────────────

type ForBinding = (Expr, Option<String>, Option<String>, Option<String>);

/// Parse `item [i] in coll [label name]` (or a bare `coll`).
fn parse_for_binding(rest: &str, scope: &Scope) -> Result<ForBinding, ParseError> {
    if let Some((before, after)) = split_kw(rest, "in") {
        let names: Vec<&str> = before.split_whitespace().collect();
        let item = names.first().map(|s| (*s).to_string());
        let index = names.get(1).map(|s| (*s).to_string());
        let (coll_src, label) = match split_kw(&after, "label") {
            Some((c, l)) => (c, Some(l.trim().to_string())),
            None => (after.clone(), None),
        };
        let subject = parse_expr(coll_src.trim(), scope)?;
        Ok((subject, item, index, label))
    } else {
        // No binding: the whole rest is the collection.
        Ok((parse_expr(rest.trim(), scope)?, None, None, None))
    }
}

// ── small string helpers ──────────────────────────────────────────────────────

/// The leading identifier of a tag interior (the block/partial head word).
fn head_word(interior: &str) -> &str {
    split_head(interior).0
}

/// Split a tag interior into `(head_ident, rest)`.
fn split_head(interior: &str) -> (&str, &str) {
    let t = interior.trim_start();
    let end = t.find(|c: char| !is_word_char(c)).unwrap_or(t.len());
    (&t[..end], t[end..].trim())
}

/// `when <values…>` → `Some(values)` (a `{% case %}` arm). Requires a word boundary, so
/// `whenever` is not read as `when ever`.
fn strip_when(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("when")?;
    if rest.is_empty() || rest.starts_with(char::is_whitespace) {
        Some(rest.trim())
    } else {
        None
    }
}

/// `elif COND` (the sole chained-conditional spelling) → the raw condition source. The
/// head word must be exactly `elif` (a bare `elif` or `elif…` identifier is not a clause).
fn strip_elif(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("elif")?;
    if rest.is_empty() || rest.starts_with(char::is_whitespace) {
        Some(rest.trim())
    } else {
        None
    }
}

/// The match value expressions of a `{% when V … %}` arm. Parsed as the arguments of a
/// throwaway `when` application (the same arg grammar as a value call); an empty `{% when %}`
/// has no values (it never matches).
fn when_values(vals_src: &str, scope: &Scope) -> Result<Vec<Expr>, ParseError> {
    if vals_src.trim().is_empty() {
        Ok(Vec::new())
    } else {
        match parse_expr(&format!("when {vals_src}"), scope)? {
            Expr::App(_, a) => Ok(a),
            other => Ok(vec![other]),
        }
    }
}

/// A whitespace-only text node — what may legally precede the first `{% when %}` arm.
fn is_blank_text(node: &Node) -> bool {
    matches!(node, Node::Text(s) if s.trim().is_empty())
}

/// Read a leading identifier: `(name, rest)`.
fn read_ident(s: &str) -> Option<(&str, &str)> {
    let t = s.trim_start();
    let end = t.find(|c: char| !is_word_char(c)).unwrap_or(t.len());
    if end == 0 {
        None
    } else {
        Some((&t[..end], &t[end..]))
    }
}

/// Read a leading quoted string literal: `(content, rest)`.
fn read_string_literal(s: &str) -> Option<(String, &str)> {
    let t = s.trim_start();
    let q = t.chars().next()?;
    if q != '"' && q != '\'' {
        return None;
    }
    let body = &t[1..];
    let close = body.find(q)?;
    Some((
        body[..close].to_string(),
        &body[close + 1 + q.len_utf8() - 1..],
    ))
}

/// Read a parenthesised group `( … )` → `(inner, rest)`, brace/string-aware.
/// Read a balanced brace group `{ … }` (a dict literal value), returning the whole
/// group *including* its braces (so the expression parser sees the dict literal) and
/// the tail. Skips quoted strings so a `}` inside a string does not close it early.
fn read_braces(s: &str, at: usize) -> Result<(&str, &str), ParseError> {
    let t = s.trim_start();
    let b = t.as_bytes();
    let n = b.len();
    let mut depth = 0i32;
    let mut i = 0;
    while i < n {
        match b[i] {
            b'"' | b'\'' => {
                i = skip_str(b, n, i);
                continue;
            }
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Ok((&t[..=i], &t[i + 1..]));
                }
            }
            _ => {}
        }
        i += 1;
    }
    err("unterminated `{ … }`", at)
}

fn read_paren(s: &str, at: usize) -> Result<(&str, &str), ParseError> {
    let t = s.trim_start();
    if !t.starts_with('(') {
        return err("expected `(` to open a `let` binding value", at);
    }
    let b = t.as_bytes();
    let n = b.len();
    let mut depth = 0i32;
    let mut i = 0;
    while i < n {
        match b[i] {
            b'"' | b'\'' => {
                i = skip_str(b, n, i);
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Ok((&t[1..i], &t[i + 1..]));
                }
            }
            _ => {}
        }
        i += 1;
    }
    err("unterminated `( … )`", at)
}

// ── ADR-042 §8: inline signatures + include hash arguments ──────────────────────

/// Parse an optional `(p, q=default)` inline parameter signature. Each parameter is
/// a name with an optional *literal* default; `[]` when there is no `(`.
fn parse_signature(rest: &str, at: usize) -> Result<Vec<(String, Option<Expr>)>, ParseError> {
    let r = rest.trim_start();
    if !r.starts_with('(') {
        return Ok(Vec::new());
    }
    let (inner, _) = read_paren(r, at)?;
    let mut params = Vec::new();
    for part in split_top_on(inner, |c| c == b',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (pname, after) = read_ident(part).ok_or_else(|| ParseError {
            message: "expected an inline parameter name".into(),
            at,
        })?;
        let after = after.trim_start();
        if let Some(def) = after.strip_prefix('=') {
            params.push((pname.to_string(), Some(literal_default(def.trim(), at)?)));
        } else if after.is_empty() {
            params.push((pname.to_string(), None));
        } else {
            return err(
                "malformed inline parameter (expected `name` or `name=literal`)",
                at,
            );
        }
    }
    Ok(params)
}

/// A literal default value: a quoted string, a number, or `true`/`false`/`null`.
fn literal_default(s: &str, at: usize) -> Result<Expr, ParseError> {
    if let Some((v, rest)) = read_string_literal(s)
        && rest.trim().is_empty()
    {
        return Ok(Expr::str(&v));
    }
    match s {
        "true" => Ok(Expr::Lit(Value::Bool(true))),
        "false" => Ok(Expr::Lit(Value::Bool(false))),
        "null" => Ok(Expr::Lit(Value::Null)),
        _ => s
            .parse::<f64>()
            .map(|n| Expr::Lit(Value::Num(n)))
            .map_err(|_| ParseError {
                message: "inline parameter default must be a literal (quote a string)".into(),
                at,
            }),
    }
}

/// Parse an include's arguments: an optional positional context expression, then
/// `key=value` hash arguments (ADR-042 §8 — the glued `key=value` form). A bare
/// chunk is the positional context; a `key=value` chunk is a hash pair.
fn parse_partial_args(
    rest: &str,
    scope: &Scope,
    at: usize,
) -> Result<(Option<Expr>, PartialHash), ParseError> {
    let mut ctx = None;
    let mut hash = Vec::new();
    for chunk in split_top_on(rest, |c| c.is_ascii_whitespace()) {
        let chunk = chunk.trim();
        if chunk.is_empty() {
            continue;
        }
        match hash_pair(chunk) {
            Some((k, v)) => hash.push((k.to_string(), parse_expr(v.trim(), scope)?)),
            None if ctx.is_none() => ctx = Some(parse_expr(chunk, scope)?),
            None => return err("unexpected include argument (a context is given once)", at),
        }
    }
    Ok((ctx, hash))
}

/// A glued `key=value` hash chunk → `(key, value)`; `None` for a positional chunk
/// (no `=`, a comparison `==`, or a non-identifier head).
fn hash_pair(chunk: &str) -> Option<(&str, &str)> {
    let (id, after) = read_ident(chunk)?;
    let after = after.trim_start();
    let val = after.strip_prefix('=')?;
    if val.starts_with('=') {
        return None; // `==` is a comparison, not a hash pair
    }
    Some((id, val))
}

/// Split `s` into top-level chunks on a separator predicate, respecting quotes and
/// `()`/`[]`/`{}` nesting.
fn split_top_on(s: &str, is_sep: impl Fn(u8) -> bool) -> Vec<&str> {
    let b = s.as_bytes();
    let n = b.len();
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    let mut i = 0;
    while i < n {
        match b[i] {
            b'"' | b'\'' => {
                i = skip_str(b, n, i);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            c if depth == 0 && is_sep(c) => {
                out.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    out.push(&s[start..]);
    out
}

/// Split `s` at the first standalone word `kw` at brace/paren/bracket depth 0.
fn split_kw(s: &str, kw: &str) -> Option<(String, String)> {
    let b = s.as_bytes();
    let n = b.len();
    let mut depth = 0i32;
    let mut i = 0;
    while i < n {
        match b[i] {
            b'"' | b'\'' => {
                i = skip_str(b, n, i);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
        if depth == 0 && word_at(b, n, i, kw) {
            return Some((s[..i].to_string(), s[i + kw.len()..].to_string()));
        }
        i += 1;
    }
    None
}

fn word_at(b: &[u8], n: usize, i: usize, kw: &str) -> bool {
    let len = kw.len();
    if i + len > n || &b[i..i + len] != kw.as_bytes() {
        return false;
    }
    let before_ok = i == 0 || !is_word_byte(b[i - 1]);
    let after_ok = i + len == n || !is_word_byte(b[i + len]);
    before_ok && after_ok
}

fn skip_str(b: &[u8], n: usize, i: usize) -> usize {
    let quote = b[i];
    let mut k = i + 1;
    while k < n {
        match b[k] {
            b'\\' => k += 2,
            c if c == quote => return k + 1,
            _ => k += 1,
        }
    }
    n
}

const fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}
const fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

#[cfg(test)]
mod tests {
    use super::parse;
    use crate::ast::{Expr, Node, Value};

    #[test]
    fn text_and_output() {
        let ns = parse("Hi {{name}}!").unwrap();
        assert_eq!(ns.len(), 3);
        assert_eq!(ns[0], Node::Text("Hi ".into()));
        match &ns[1] {
            Node::Output { expr, raw, .. } => {
                assert!(!raw);
                assert_eq!(
                    *expr,
                    Expr::App(
                        "lookup".into(),
                        vec![Expr::nullary("this"), Expr::str("name")]
                    )
                );
            }
            o => panic!("{o:?}"),
        }
        assert_eq!(ns[2], Node::Text("!".into()));
    }

    #[test]
    fn raw_output_via_safe_filter() {
        // PURE grammar (ADR-039): raw output is `{{ x | safe }}` (no `{{{ }}}` raw sigil);
        // the `safe` final pipe desugars to `Output { raw: true }` with `safe` stripped.
        let ns = parse("{{ html | safe }}").unwrap();
        assert!(matches!(&ns[0], Node::Output { raw: true, .. }));
    }

    #[test]
    fn if_else_chain() {
        // PURE grammar: clauses are `{% %}`-only — `{% elif %}` / `{% else %}`.
        let ns = parse("{% if a %}A{% elif b %}B{% else %}C{% endif %}").unwrap();
        match &ns[0] {
            Node::Cond(c) => {
                assert!(!c.negated);
                assert_eq!(c.body, vec![Node::Text("A".into())]);
                assert_eq!(c.elifs.len(), 1);
                assert_eq!(c.elifs[0].1, vec![Node::Text("B".into())]);
                assert_eq!(c.otherwise, vec![Node::Text("C".into())]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn brace_clause_words_are_plain_output() {
        // A brace-form `{{else}}` is NOT a clause separator (PURE grammar): it is output of
        // a variable named `else`, so a `{% if %}` containing it has no else branch.
        let ns = parse("{% if a %}x{{else}}y{% endif %}").unwrap();
        match &ns[0] {
            Node::Cond(c) => {
                assert!(c.elifs.is_empty());
                assert!(c.otherwise.is_empty());
                // body is `x`, output(`else`), `y` — the `{{else}}` rendered as output.
                assert!(matches!(c.body[1], Node::Output { .. }));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn legacy_handlebars_forms_are_rejected() {
        // PURE grammar — no Handlebars holdovers. Each legacy form fails to parse (a plain
        // syntax error; no compat mapping to its `{% %}` replacement).
        for src in [
            "{{#each xs}}{{this}}{{/each}}", // block open/close
            "{{#if a}}x{{/if}}",
            "{{> partial}}",               // partial reference
            "{{^inverted}}x{{/inverted}}", // inverted section
            "{{{ raw }}}",                 // triple-stache
            "{{{{#raw}}}}v{{{{/raw}}}}",   // quad-stache raw block
        ] {
            assert!(parse(src).is_err(), "expected reject: {src:?}");
        }
    }

    #[test]
    fn unless_is_negated() {
        let ns = parse("{% unless done %}todo{% endunless %}").unwrap();
        assert!(matches!(&ns[0], Node::Cond(c) if c.negated));
    }

    #[test]
    fn mismatched_close_is_a_located_error() {
        // A close tag naming the wrong block is rejected here (a class-A parse
        // error), not left to rustc as a downstream "unknown field" — across each
        // block kind: each/scope (else_arm), if (cond), case, let, and host helpers.
        for src in [
            "{% for items %}{{this}}{% endwith %}",
            "{% scope user %}{{name}}{% endfor %}",
            "{% if a %}A{% endunless %}",
            "{% case s %}{% when \"a\" %}A{% endif %}",
            "{% local x=(1) %}{{x}}{% endfor %}",
            "{% bold %}hi{% enditalic %}",
        ] {
            let e = parse(src).unwrap_err();
            assert!(
                e.message.starts_with("mismatched closing tag"),
                "expected a mismatch error for {src:?}, got {:?}",
                e.message
            );
        }
    }

    #[test]
    fn named_close_parses() {
        // The strict native dialect closes a block with a *named* `{% endX %}`. The
        // legacy Handlebars bare wildcard close (`{{/}}`) is gone — there is no
        // `{% end %}` wildcard (it would lex as an *open* of a block named `end`).
        assert!(parse("{% for items %}{{this}}{% endfor %}").is_ok());
    }

    #[test]
    fn case_is_first_class_with_raw_arm_values() {
        let ns =
            parse("{% case s %}{% when \"a\" %}A{% when \"b\" \"c\" %}BC{% else %}E{% endcase %}")
                .unwrap();
        match &ns[0] {
            Node::Case(c) => {
                assert_eq!(c.arms.len(), 2);
                // first arm: one value, body "A".
                assert_eq!(c.arms[0].0, vec![Expr::str("a")]);
                assert_eq!(c.arms[0].1, vec![Node::Text("A".into())]);
                // second arm: two raw values (kept for the `match`), body "BC".
                assert_eq!(c.arms[1].0, vec![Expr::str("b"), Expr::str("c")]);
                assert_eq!(c.arms[1].1, vec![Node::Text("BC".into())]);
                assert_eq!(c.otherwise, vec![Node::Text("E".into())]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn case_without_else_has_empty_otherwise() {
        let ns = parse("{% case s %}{% when 1 %}one{% when 2 %}two{% endcase %}").unwrap();
        match &ns[0] {
            Node::Case(c) => {
                assert_eq!(c.arms.len(), 2);
                assert_eq!(c.arms[0].1, vec![Node::Text("one".into())]);
                assert!(c.otherwise.is_empty());
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn case_content_before_first_when_is_rejected() {
        assert!(parse("{% case s %}junk{% when 1 %}x{% endcase %}").is_err());
    }

    #[test]
    fn when_outside_case_is_rejected() {
        assert!(parse("{% when 1 %}x").is_err());
    }

    #[test]
    fn each_liquid_binding_and_scope() {
        // `post` is a binding → it roots at itself, not `this`.
        let ns =
            parse("{% for post i in posts %}{{post.title}}{% else %}none{% endfor %}").unwrap();
        match &ns[0] {
            Node::For(e) => {
                assert_eq!(e.item.as_deref(), Some("post"));
                assert_eq!(e.index.as_deref(), Some("i"));
                assert_eq!(
                    e.subject,
                    Expr::App(
                        "lookup".into(),
                        vec![Expr::nullary("this"), Expr::str("posts")]
                    )
                );
                assert_eq!(
                    e.body,
                    vec![Node::Output {
                        span: match &e.body[0] {
                            Node::Output { span, .. } => *span,
                            _ => unreachable!(),
                        },
                        expr: Expr::App(
                            "lookup".into(),
                            vec![Expr::nullary("post"), Expr::str("title")]
                        ),
                        raw: false,
                    }]
                );
                assert_eq!(e.otherwise, vec![Node::Text("none".into())]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn each_with_label() {
        let ns = parse("{% for row in rows label outer %}{{outer.index1}}{% endfor %}").unwrap();
        match &ns[0] {
            Node::For(e) => {
                assert_eq!(e.label.as_deref(), Some("outer"));
                assert_eq!(e.item.as_deref(), Some("row"));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn let_bindings_sequential_scope() {
        let ns = parse("{% local a=(x) b=(a) %}{{a}}/{{b}}{% endlocal %}").unwrap();
        match &ns[0] {
            Node::Let { bindings, .. } => {
                assert_eq!(bindings.len(), 2);
                assert_eq!(bindings[0].0, "a");
                // a's value: x → lookup(this, x)
                assert_eq!(
                    bindings[0].1,
                    Expr::App("lookup".into(), vec![Expr::nullary("this"), Expr::str("x")])
                );
                // b's value references a → roots at the alias `a`
                assert_eq!(bindings[1].0, "b");
                assert_eq!(bindings[1].1, Expr::nullary("a"));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn partials_inline_and_use_and_yield() {
        let ns = parse(
            r#"{% inline "card" %}<b>{{title}}</b>{% endinline %}{% for posts %}{% include "card" %}{% endfor %}"#,
        )
        .unwrap();
        assert!(matches!(&ns[0], Node::Inline { name, .. } if name == "card"));
        let y = parse(
            r#"{% inline "c" %}<div>{% yield %}</div>{% endinline %}{% partial "c" %}{{name}}{% endpartial %}"#,
        )
        .unwrap();
        assert!(matches!(&y[1], Node::PartialBlock { name, .. } if name == "c"));
    }

    #[test]
    fn inline_signature_and_hash_include() {
        // ADR-042 §8: a `(title, badge="")` signature + a `{% include … k=v %}` hash;
        // the augment pass fills the omitted optional `badge=""` into the include hash.
        let ns = parse(
            r#"{% inline "card" (title, badge="") %}{{title}}{% endinline %}{% include "card" title=name %}"#,
        )
        .unwrap();
        match &ns[0] {
            Node::Inline { params, .. } => {
                assert_eq!(params.len(), 2);
                assert_eq!(params[0], ("title".to_string(), None));
                assert_eq!(params[1].0, "badge");
                assert!(params[1].1.is_some());
            }
            other => panic!("expected an Inline, got {other:?}"),
        }
        match &ns[1] {
            Node::Partial { hash, .. } => {
                // provided `title` + augmented default `badge`.
                let keys: Vec<&str> = hash.iter().map(|(k, _)| k.as_str()).collect();
                assert_eq!(keys, vec!["title", "badge"]);
            }
            other => panic!("expected a Partial, got {other:?}"),
        }
        // a bare (non-literal) default is a located error.
        assert!(parse(r#"{% inline "r" (s=foo) %}{{s}}{% endinline %}"#).is_err());
    }

    #[test]
    fn raw_block() {
        let ns = parse("{% raw %}Literal {{x}}{% endraw %}").unwrap();
        assert_eq!(
            ns[0],
            Node::RawBlock {
                span: match &ns[0] {
                    Node::RawBlock { span, .. } => *span,
                    _ => unreachable!(),
                },
                body: "Literal {{x}}".into()
            }
        );
    }

    #[test]
    fn negative_literal_value() {
        let ns = parse("{{nums | at -1}}").unwrap();
        match &ns[0] {
            Node::Output { expr, .. } => assert_eq!(
                *expr,
                Expr::App(
                    "at".into(),
                    vec![
                        Expr::App(
                            "lookup".into(),
                            vec![Expr::nullary("this"), Expr::str("nums")]
                        ),
                        Expr::Lit(Value::Num(-1.0))
                    ]
                )
            ),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn block_helper_parses_meaning_free() {
        // A non-built-in block head is no longer a parse error: it becomes a `HelperBlock`
        // carrying its args + body, to be resolved against the host allow-list at emit time.
        let ns = parse("{% frame 2 %}hi {{name}}{% endframe %}").unwrap();
        match &ns[0] {
            Node::HelperBlock(b) => {
                assert_eq!(b.head, "frame");
                assert_eq!(b.args, vec![Expr::Lit(Value::Num(2.0))]);
                assert_eq!(b.body.len(), 2); // "hi " text + {{name}} output
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn block_helper_rejects_else() {
        // No `{% else %}` arm yet — a located, forward-looking reject (not a silent drop);
        // the inverse-arm convention is frozen but unbuilt (docs/09 §3.1, "Planned").
        let err = parse("{% frame %}a{% else %}b{% endframe %}").unwrap_err();
        assert!(err.message.contains("not yet supported"), "{}", err.message);
    }

    // ── Django-style statement tags `{% … %}` (docs-19) ──────────────────────────

    #[test]
    fn statement_each_parses_like_brace_each() {
        // `{% for … %}…{% endfor %}` desugars to the same `Node::For` as `{% for %}`.
        let ns = parse("{% for item in xs %}{{item}}{% endfor %}").unwrap();
        match &ns[0] {
            Node::For(e) => {
                assert_eq!(e.item.as_deref(), Some("item"));
                assert_eq!(e.body.len(), 1);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn statement_local_is_the_let_block() {
        // `{% local … %}` is the bounded binding (docs-17), the `let` block renamed; its
        // close is `{% endlocal %}`.
        let ns = parse("{% local x=(add 1 2) y=(add x 1) %}{{x}}/{{y}}{% endlocal %}").unwrap();
        match &ns[0] {
            Node::Let { bindings, .. } => {
                let names: Vec<&str> = bindings.iter().map(|(n, _)| n.as_str()).collect();
                assert_eq!(names, vec!["x", "y"]);
            }
            o => panic!("{o:?}"),
        }
        // `{% local %}` is the bounded binding (the AST node is still `Node::Let`).
        assert!(matches!(
            parse("{% local x=(add 1 2) %}{{x}}{% endlocal %}").unwrap()[0],
            Node::Let { .. }
        ));
        // PURE grammar (ADR-039 / docs-17): the retired `let` head is rejected.
        assert!(parse("{% let x=(1) %}{{x}}{% endlet %}").is_err());
    }

    #[test]
    fn statement_elif_is_the_chained_conditional() {
        // `{% elif … %}` is the sole chained-conditional clause.
        let ns = parse("{% if a %}A{% elif b %}B{% else %}C{% endif %}").unwrap();
        match &ns[0] {
            Node::Cond(c) => {
                assert_eq!(c.elifs.len(), 1);
                assert_eq!(c.otherwise.len(), 1);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn two_word_else_if_is_rejected() {
        // The two-word `else if` sugar is gone — only `{% elif %}` chains (PURE grammar).
        assert!(parse("{% if a %}A{% else if b %}B{% endif %}").is_err());
    }

    // ADR-040 template inheritance: `parse` flattens `{% extends %}`/`{% block %}`/
    // `{% super %}` into a plain tree (`crate::inherit`). These assert the rendered text.
    fn top_text(nodes: &[Node]) -> String {
        nodes
            .iter()
            .filter_map(|n| match n {
                Node::Text(s) => Some(s.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn inheritance_single_level_fills_blocks() {
        let t = "{% inline \"base\" %}<h>{% block t %}D{% endblock %}</h><b>{% block c %}{% endblock %}</b>{% endinline %}{% extends \"base\" %}{% block c %}Hi{% endblock %}";
        // override `c`, inherit the `t` default → the inline def is kept (hoisted later).
        assert_eq!(top_text(&parse(t).unwrap()), "<h>D</h><b>Hi</b>");
    }

    #[test]
    fn inheritance_super_splices_parent() {
        let t = "{% inline \"b\" %}{% block t %}Base{% endblock %}{% endinline %}{% extends \"b\" %}{% block t %}[{% super %}]{% endblock %}";
        assert_eq!(top_text(&parse(t).unwrap()), "[Base]");
    }

    #[test]
    fn inheritance_multilevel_leaf_wins() {
        let t = "{% inline \"base\" %}<b>{% block c %}base{% endblock %}</b>{% endinline %}{% inline \"mid\" %}{% extends \"base\" %}{% block c %}mid{% endblock %}{% endinline %}{% extends \"mid\" %}{% block c %}leaf{% endblock %}";
        assert_eq!(top_text(&parse(t).unwrap()), "<b>leaf</b>");
    }

    #[test]
    fn inheritance_rejects_stray_child_content_and_unknown_base() {
        assert!(parse("{% extends \"b\" %}oops{% block t %}x{% endblock %}").is_err());
        assert!(parse("{% extends \"ghost\" %}{% block t %}x{% endblock %}").is_err());
    }

    #[test]
    fn statement_case_when_parses() {
        let ns =
            parse(r#"{% case s %}{% when "a" %}A{% when "b" "c" %}BC{% else %}Z{% endcase %}"#)
                .unwrap();
        match &ns[0] {
            Node::Case(c) => {
                assert_eq!(c.arms.len(), 2);
                assert_eq!(c.otherwise.len(), 1);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn statement_mismatched_close_is_located_error() {
        // `{% endfor %}` cannot close a `{% if %}` — the same check as `{% endfor %}` vs `{% if %}`.
        let err = parse("{% if a %}x{% endfor %}").unwrap_err();
        assert!(err.message.contains("mismatched"), "{}", err.message);
    }
}
