//! Slice 3 — the block parser + desugar: the [`Lexeme`] stream → a desugared
//! [`Node`] tree (docs/08 §6.3). Matches block opens/closes, dispatches
//! if/unless/each/with/let/partials/raw, parses the Liquid `each` binding and the
//! `let` hash, threads a [`Scope`] for path rooting, and splits `{{else}}` /
//! `{{else if}}` clauses.

use crate::ast::{Cond, Each, Expr, HelperBlock, Node, With};
use crate::lex::{Lexeme, Sigil, lex};
use crate::parse_expr::{ParseError, Scope, parse_expr};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Parse a template source into a desugared [`Node`] tree.
///
/// # Errors
/// Returns a [`ParseError`] for a lex failure, an unclosed/mismatched block, or a
/// malformed expression. A non-built-in block head is *not* an error here — it parses
/// to a meaning-free [`Node::HelperBlock`] the emitter/VM resolve against the host
/// allow-list (an undeclared one becomes a located "unknown helper" there).
pub fn parse(src: &str) -> Result<Vec<Node>, ParseError> {
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
        Stop::Close(name) => err(format!("unexpected `{{{{/{name}}}}}` (no open block)"), 0),
        Stop::Else | Stop::ElseIf(_) => err("unexpected `{{else}}` outside a block".to_string(), 0),
    }
}

fn err<T>(message: impl Into<String>, at: usize) -> Result<T, ParseError> {
    Err(ParseError {
        message: message.into(),
        at,
    })
}

/// What stopped a body scan.
enum Stop {
    /// A `{{/name}}` close.
    Close(String),
    /// A `{{else}}`.
    Else,
    /// A `{{else if cond}}` (the raw condition source).
    ElseIf(String),
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
                Lexeme::Tag {
                    sigil: Sigil::Output,
                    interior,
                    span,
                } => {
                    let span = *span;
                    let text = interior.of(self.src).trim();
                    if text == "else" {
                        self.pos += 1;
                        return Ok((nodes, Stop::Else));
                    }
                    if let Some(c) = strip_else_if(text) {
                        self.pos += 1;
                        return Ok((nodes, Stop::ElseIf(c.to_string())));
                    }
                    if text == "yield" {
                        nodes.push(Node::Yield { span });
                        self.pos += 1;
                        continue;
                    }
                    let expr = parse_expr(text, scope)?;
                    nodes.push(Node::Output {
                        span,
                        expr,
                        raw: false,
                    });
                    self.pos += 1;
                }
                Lexeme::Tag {
                    sigil: Sigil::Raw,
                    interior,
                    span,
                } => {
                    let expr = parse_expr(interior.of(self.src).trim(), scope)?;
                    nodes.push(Node::Output {
                        span: *span,
                        expr,
                        raw: true,
                    });
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
                    let node = self.open_block(*span, interior.of(self.src), scope)?;
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

    /// Dispatch a `{{# … }}` block (called with `pos` at the open tag).
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
            "each" => self.each_block(span, rest, scope),
            "with" => self.with_block(span, rest, scope),
            "let" => self.let_block(span, rest, scope),
            "inline" => self.inline_block(span, rest, scope),
            "partial" => self.partial_block(span, rest, scope),
            // Any other head is a *host block helper* (docs/09): parse it meaning-free
            // into a generic node; the emitter/VM resolve it against the allow-list.
            other => self.helper_block(span, other, rest, scope),
        }
    }

    /// Parse a `{{#name args…}}body{{/name}}` host block helper. The parser attaches no
    /// meaning (it does not check the allow-list); `{{else}}` is unsupported (v1).
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
            Stop::Close(_) => Ok(Node::HelperBlock(HelperBlock {
                span,
                head: head.to_string(),
                args,
                body,
            })),
            Stop::Else | Stop::ElseIf(_) => err(
                format!("block helper `{head}` does not support `{{{{else}}}}`"),
                span.start,
            ),
            Stop::Eof => err(
                format!("unclosed block helper `{{{{#{head}}}}}`"),
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
                    expect_close(&s, span.start)?;
                    break;
                }
                Stop::Close(_) => break,
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

    fn each_block(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (subject, item, index, label) = parse_each_binding(rest, scope)?;
        let mut bound = Vec::new();
        bound.extend(item.clone());
        bound.extend(index.clone());
        bound.extend(label.clone());
        let child = scope.with_all(&bound);
        let (body, stop) = self.parse_until(&child)?;
        let otherwise = self.else_arm(stop, scope, span.start)?;
        Ok(Node::Each(Each {
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
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let subject = parse_expr(rest.trim(), scope)?;
        // `with` re-roots `this` to the subject but introduces no named binding.
        let (body, stop) = self.parse_until(scope)?;
        let otherwise = self.else_arm(stop, scope, span.start)?;
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
        expect_close(&stop, span.start)?;
        Ok(Node::Let {
            span,
            bindings,
            body,
        })
    }

    fn inline_block(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (name, _) = read_string_literal(rest).ok_or_else(|| ParseError {
            message: "{{#inline}} needs a quoted name".into(),
            at: span.start,
        })?;
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, span.start)?;
        Ok(Node::Inline { span, name, body })
    }

    fn partial_block(
        &mut self,
        span: crate::span::Span,
        rest: &str,
        scope: &Scope,
    ) -> Result<Node, ParseError> {
        let (name, after) = read_string_literal(rest).ok_or_else(|| ParseError {
            message: "{{#partial}} needs a quoted name".into(),
            at: span.start,
        })?;
        let ctx = parse_opt_ctx(after, scope)?;
        let (body, stop) = self.parse_until(scope)?;
        expect_close(&stop, span.start)?;
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
        let (name, after) = split_head(interior);
        if name.is_empty() {
            return err("{{> …}} needs a partial name", span.start);
        }
        let ctx = parse_opt_ctx(after, scope)?;
        Ok(Node::Partial {
            span,
            name: name.to_string(),
            ctx,
        })
    }

    /// After a body, consume a `{{else}}` arm (if any) and require the close.
    fn else_arm(&mut self, stop: Stop, scope: &Scope, at: usize) -> Result<Vec<Node>, ParseError> {
        match stop {
            Stop::Close(_) => Ok(Vec::new()),
            Stop::Else => {
                let (ebody, s) = self.parse_until(scope)?;
                expect_close(&s, at)?;
                Ok(ebody)
            }
            Stop::ElseIf(_) => err("`{{else if}}` is only valid in a conditional", at),
            Stop::Eof => err("unclosed block", at),
        }
    }
}

fn expect_close(stop: &Stop, at: usize) -> Result<(), ParseError> {
    match stop {
        Stop::Close(_) => Ok(()),
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

type EachBinding = (Expr, Option<String>, Option<String>, Option<String>);

/// Parse `item [i] in coll [label name]` (or a bare `coll`).
fn parse_each_binding(rest: &str, scope: &Scope) -> Result<EachBinding, ParseError> {
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

/// `else if <cond>` → `Some(cond)`.
fn strip_else_if(text: &str) -> Option<&str> {
    text.strip_prefix("else")
        .map(str::trim_start)
        .and_then(|r| r.strip_prefix("if"))
        .map(str::trim)
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
    fn raw_output() {
        let ns = parse("{{{html}}}").unwrap();
        assert!(matches!(&ns[0], Node::Output { raw: true, .. }));
    }

    #[test]
    fn if_else_chain() {
        let ns = parse("{{#if a}}A{{else if b}}B{{else}}C{{/if}}").unwrap();
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
    fn unless_is_negated() {
        let ns = parse("{{#unless done}}todo{{/unless}}").unwrap();
        assert!(matches!(&ns[0], Node::Cond(c) if c.negated));
    }

    #[test]
    fn each_liquid_binding_and_scope() {
        // `post` is a binding → it roots at itself, not `this`.
        let ns = parse("{{#each post i in posts}}{{post.title}}{{else}}none{{/each}}").unwrap();
        match &ns[0] {
            Node::Each(e) => {
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
        let ns = parse("{{#each row in rows label outer}}{{outer.index1}}{{/each}}").unwrap();
        match &ns[0] {
            Node::Each(e) => {
                assert_eq!(e.label.as_deref(), Some("outer"));
                assert_eq!(e.item.as_deref(), Some("row"));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn let_bindings_sequential_scope() {
        let ns = parse("{{#let a=(x) b=(a)}}{{a}}/{{b}}{{/let}}").unwrap();
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
            r#"{{#inline "card"}}<b>{{title}}</b>{{/inline}}{{#each posts}}{{> card}}{{/each}}"#,
        )
        .unwrap();
        assert!(matches!(&ns[0], Node::Inline { name, .. } if name == "card"));
        let y = parse(
            r#"{{#inline "c"}}<div>{{yield}}</div>{{/inline}}{{#partial "c"}}{{name}}{{/partial}}"#,
        )
        .unwrap();
        assert!(matches!(&y[1], Node::PartialBlock { name, .. } if name == "c"));
    }

    #[test]
    fn raw_block() {
        let ns = parse("{{{{#raw}}}}Literal {{x}}{{{{/raw}}}}").unwrap();
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
        let ns = parse("{{#frame 2}}hi {{name}}{{/frame}}").unwrap();
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
        // No `{{else}}` arm in v1 — a located, actionable error rather than a silent drop.
        let err = parse("{{#frame}}a{{else}}b{{/frame}}").unwrap_err();
        assert!(err.message.contains("does not support"), "{}", err.message);
    }
}
