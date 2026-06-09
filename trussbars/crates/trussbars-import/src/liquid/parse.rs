//! The Liquid parser: the [`Tok`] stream → the [`Node`] tree. A small recursive
//! cursor parses value expressions (variables with `.`/`[]` accessors, literals,
//! `(a..b)` ranges), filter chains, and conditions; the node builder dispatches the
//! full core tag set (control flow, iteration, variable, theme, utility) and matches
//! block tags to their `end…` closers. Explicit `{{- -}}` / `{%- -%}` whitespace
//! control is applied as a post-pass.

use super::ast::{
    Access, CmpOp, Condition, Expr, Filter, FilterArg, ForParams, Literal, Node, ThemeArgs,
    VarPath, WhenArm,
};
use super::lex::{Tok, lex};
use crate::{ParseError, Span};

/// Parse a Liquid template into its node tree.
///
/// # Errors
/// Returns a [`ParseError`] on a lex failure, an unclosed/mismatched block, or a
/// malformed expression.
pub fn parse(src: &str) -> Result<Vec<Node>, ParseError> {
    let mut toks = lex(src)?;
    trim_whitespace(&mut toks);
    let mut p = Parser {
        toks: &toks,
        pos: 0,
    };
    let (nodes, stop) = p.parse_nodes()?;
    match stop {
        Stop::Eof => Ok(nodes),
        Stop::Ctrl { name, span, .. } => Err(ParseError::new(
            format!("unexpected `{{% {name} %}}`"),
            span.start,
        )),
    }
}

// ===========================================================================
// Expression cursor
// ===========================================================================

struct Cursor<'a> {
    s: &'a str,
    i: usize,
}

impl<'a> Cursor<'a> {
    fn new(s: &'a str) -> Self {
        Cursor { s, i: 0 }
    }

    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }

    fn skip_ws(&mut self) {
        let trimmed = self.rest().trim_start();
        self.i = self.s.len() - trimmed.len();
    }

    fn done(&mut self) -> bool {
        self.skip_ws();
        self.rest().is_empty()
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    /// Consume `p` if `rest` (after skipping whitespace) starts with it.
    fn eat(&mut self, p: &str) -> bool {
        self.skip_ws();
        if self.rest().starts_with(p) {
            self.i += p.len();
            true
        } else {
            false
        }
    }

    /// Consume the keyword `w` if present as a whole word.
    fn eat_word(&mut self, w: &str) -> bool {
        self.skip_ws();
        let r = self.rest();
        if r.starts_with(w)
            && r[w.len()..]
                .chars()
                .next()
                .is_none_or(|c| !is_ident_char(c))
        {
            self.i += w.len();
            true
        } else {
            false
        }
    }

    fn read_ident(&mut self) -> Option<String> {
        self.skip_ws();
        let r = self.rest();
        let mut end = 0;
        for (idx, ch) in r.char_indices() {
            if idx == 0 {
                if !(ch.is_alphabetic() || ch == '_') {
                    return None;
                }
            } else if !is_ident_char(ch) {
                break;
            }
            end = idx + ch.len_utf8();
        }
        if end == 0 {
            return None;
        }
        let id = r[..end].to_string();
        self.i += end;
        Some(id)
    }

    fn read_string(&mut self) -> Option<String> {
        self.skip_ws();
        let r = self.rest();
        let q = r.chars().next()?;
        if q != '\'' && q != '"' {
            return None;
        }
        let after = &r[1..];
        let close = after.find(q)?;
        let s = after[..close].to_string();
        self.i += 1 + close + 1;
        Some(s)
    }

    fn read_number(&mut self) -> Option<f64> {
        self.skip_ws();
        let r = self.rest();
        let mut end = 0;
        let mut seen_dot = false;
        for (idx, ch) in r.char_indices() {
            if ch == '-' && idx == 0 {
                // leading sign
            } else if ch.is_ascii_digit() {
                // digit
            } else if ch == '.' && !seen_dot && !r[idx + 1..].starts_with('.') {
                seen_dot = true;
            } else {
                break;
            }
            end = idx + ch.len_utf8();
        }
        if end == 0 {
            return None;
        }
        let n = r[..end].parse::<f64>().ok()?;
        self.i += end;
        Some(n)
    }
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// Parse a primary value expression.
fn value(c: &mut Cursor) -> Result<Expr, ParseError> {
    c.skip_ws();
    match c.peek() {
        None => Err(ParseError::new("expected a value", c.i)),
        Some('(') => {
            c.i += 1;
            let start = value(c)?;
            if c.eat("..") {
                let end = value(c)?;
                c.eat(")");
                Ok(Expr::Range {
                    start: Box::new(start),
                    end: Box::new(end),
                })
            } else {
                c.eat(")");
                Ok(start)
            }
        }
        Some('\'') | Some('"') => {
            let s = c.read_string().expect("quote present");
            Ok(Expr::Literal(Literal::Str(s)))
        }
        Some(ch) if ch == '-' || ch.is_ascii_digit() => {
            let n = c
                .read_number()
                .ok_or_else(|| ParseError::new("malformed number", c.i))?;
            Ok(Expr::Literal(Literal::Number(n)))
        }
        Some(_) => {
            let id = c
                .read_ident()
                .ok_or_else(|| ParseError::new("expected a value", c.i))?;
            match id.as_str() {
                "true" => Ok(Expr::Literal(Literal::Bool(true))),
                "false" => Ok(Expr::Literal(Literal::Bool(false))),
                "nil" | "null" => Ok(Expr::Literal(Literal::Nil)),
                "empty" => Ok(Expr::Literal(Literal::Empty)),
                "blank" => Ok(Expr::Literal(Literal::Blank)),
                _ => Ok(Expr::Var(var_path(c, id)?)),
            }
        }
    }
}

/// Parse the accessor chain after a base variable name.
fn var_path(c: &mut Cursor, name: String) -> Result<VarPath, ParseError> {
    let mut access = Vec::new();
    loop {
        let r = c.rest();
        if let Some(after) = r.strip_prefix('.') {
            // Not the `..` range operator.
            if after.starts_with('.') {
                break;
            }
            c.i += 1;
            let Some(field) = c.read_ident() else { break };
            access.push(Access::Field(field));
        } else if r.starts_with('[') {
            c.i += 1;
            let idx = value(c)?;
            c.eat("]");
            access.push(Access::Index(Box::new(idx)));
        } else {
            break;
        }
    }
    Ok(VarPath { name, access })
}

/// Parse a chain of `| filter: args` after a value.
fn filters(c: &mut Cursor) -> Result<Vec<Filter>, ParseError> {
    let mut out = Vec::new();
    while c.eat("|") {
        let name = c
            .read_ident()
            .ok_or_else(|| ParseError::new("expected a filter name after `|`", c.i))?;
        let mut args = Vec::new();
        if c.eat(":") {
            loop {
                args.push(filter_arg(c)?);
                if !c.eat(",") {
                    break;
                }
            }
        }
        out.push(Filter { name, args });
    }
    Ok(out)
}

/// Parse one filter argument (positional, or `key: value`).
fn filter_arg(c: &mut Cursor) -> Result<FilterArg, ParseError> {
    let save = c.i;
    if let Some(id) = c.read_ident() {
        if c.eat(":") {
            let v = value(c)?;
            return Ok(FilterArg::Named(id, v));
        }
        c.i = save;
    }
    Ok(FilterArg::Positional(value(c)?))
}

/// Parse a value and its trailing filter chain (the `{{ … }}` / `echo` / `assign` form).
fn output(markup: &str) -> Result<(Expr, Vec<Filter>), ParseError> {
    let mut c = Cursor::new(markup);
    let e = value(&mut c)?;
    let f = filters(&mut c)?;
    Ok((e, f))
}

/// Parse a condition (`a == b and c contains d`).
fn condition(markup: &str) -> Result<Condition, ParseError> {
    let mut c = Cursor::new(markup);
    parse_or(&mut c)
}

fn parse_or(c: &mut Cursor) -> Result<Condition, ParseError> {
    let mut left = parse_and(c)?;
    while c.eat_word("or") {
        let right = parse_and(c)?;
        left = Condition::Or(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_and(c: &mut Cursor) -> Result<Condition, ParseError> {
    let mut left = parse_cmp(c)?;
    while c.eat_word("and") {
        let right = parse_cmp(c)?;
        left = Condition::And(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_cmp(c: &mut Cursor) -> Result<Condition, ParseError> {
    let left = value(c)?;
    let op = if c.eat("==") {
        Some(CmpOp::Eq)
    } else if c.eat("!=") || c.eat("<>") {
        Some(CmpOp::Ne)
    } else if c.eat(">=") {
        Some(CmpOp::Ge)
    } else if c.eat("<=") {
        Some(CmpOp::Le)
    } else if c.eat(">") {
        Some(CmpOp::Gt)
    } else if c.eat("<") {
        Some(CmpOp::Lt)
    } else if c.eat_word("contains") {
        Some(CmpOp::Contains)
    } else {
        None
    };
    let right = match op {
        Some(_) => Some(value(c)?),
        None => None,
    };
    Ok(Condition::Compare { left, op, right })
}

// ===========================================================================
// Node tree
// ===========================================================================

enum Stop {
    Eof,
    Ctrl {
        name: String,
        markup: String,
        span: Span,
    },
}

const STOP_KEYWORDS: &[&str] = &[
    "else",
    "elsif",
    "when",
    "endif",
    "endunless",
    "endcase",
    "endfor",
    "endtablerow",
    "endcapture",
    "endifchanged",
];

struct Parser<'a> {
    toks: &'a [Tok],
    pos: usize,
}

impl Parser<'_> {
    fn parse_nodes(&mut self) -> Result<(Vec<Node>, Stop), ParseError> {
        let mut nodes = Vec::new();
        while self.pos < self.toks.len() {
            match &self.toks[self.pos] {
                Tok::Text { span, text } => {
                    if !text.is_empty() {
                        nodes.push(Node::Text {
                            span: *span,
                            text: text.clone(),
                        });
                    }
                    self.pos += 1;
                }
                Tok::Output { span, markup, .. } => {
                    let (expr, filters) = output(markup)?;
                    nodes.push(Node::Output {
                        span: *span,
                        expr,
                        filters,
                    });
                    self.pos += 1;
                }
                Tok::Raw { span, content } => {
                    nodes.push(Node::Raw {
                        span: *span,
                        content: content.clone(),
                    });
                    self.pos += 1;
                }
                Tok::Comment { span, content } => {
                    nodes.push(Node::Comment {
                        span: *span,
                        content: content.clone(),
                    });
                    self.pos += 1;
                }
                Tok::Tag {
                    span, name, markup, ..
                } => {
                    if STOP_KEYWORDS.contains(&name.as_str()) {
                        let stop = Stop::Ctrl {
                            name: name.clone(),
                            markup: markup.clone(),
                            span: *span,
                        };
                        self.pos += 1;
                        return Ok((nodes, stop));
                    }
                    let span = *span;
                    let name = name.clone();
                    let markup = markup.clone();
                    self.pos += 1;
                    let node = self.parse_tag(&name, &markup, span)?;
                    nodes.push(node);
                }
            }
        }
        Ok((nodes, Stop::Eof))
    }

    fn parse_tag(&mut self, name: &str, markup: &str, span: Span) -> Result<Node, ParseError> {
        match name {
            "if" => self.parse_if(span, markup),
            "unless" => self.parse_unless(span, markup),
            "case" => self.parse_case(span, markup),
            "for" => self.parse_for(span, markup),
            "tablerow" => self.parse_tablerow(span, markup),
            "capture" => self.parse_capture(span, markup),
            "ifchanged" => self.parse_ifchanged(span),
            "assign" => parse_assign(span, markup),
            "increment" => Ok(Node::Increment {
                span,
                target: markup.trim().to_string(),
            }),
            "decrement" => Ok(Node::Decrement {
                span,
                target: markup.trim().to_string(),
            }),
            "break" => Ok(Node::Break { span }),
            "continue" => Ok(Node::Continue { span }),
            "cycle" => parse_cycle(span, markup),
            "include" => {
                let (target, args) = parse_theme(markup)?;
                Ok(Node::Include { span, target, args })
            }
            "render" => {
                let (target, args) = parse_theme(markup)?;
                Ok(Node::Render { span, target, args })
            }
            "section" => {
                let mut c = Cursor::new(markup);
                Ok(Node::Section {
                    span,
                    name: value(&mut c)?,
                })
            }
            "echo" => {
                let (expr, filters) = output(markup)?;
                Ok(Node::Echo {
                    span,
                    expr,
                    filters,
                })
            }
            "liquid" => Ok(Node::Liquid {
                span,
                body: parse_liquid_body(markup)?,
            }),
            "#" => Ok(Node::InlineComment {
                span,
                text: markup.to_string(),
            }),
            _ => Ok(Node::Unknown {
                span,
                name: name.to_string(),
                markup: markup.to_string(),
            }),
        }
    }

    fn parse_if(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let mut branches = Vec::new();
        let mut cond = condition(markup)?;
        loop {
            let (body, stop) = self.parse_nodes()?;
            let Stop::Ctrl {
                name,
                markup: m,
                span,
            } = stop
            else {
                return Err(ParseError::new("unclosed `{% if %}`", open.start));
            };
            branches.push((cond, body));
            match name.as_str() {
                "elsif" => cond = condition(&m)?,
                "else" => {
                    let (els, end_span) = self.parse_block_body("endif", open.start)?;
                    return Ok(Node::If {
                        span: Span::new(open.start, end_span),
                        branches,
                        otherwise: Some(els),
                    });
                }
                "endif" => {
                    return Ok(Node::If {
                        span: Span::new(open.start, span.end),
                        branches,
                        otherwise: None,
                    });
                }
                other => {
                    return Err(ParseError::new(
                        format!("unexpected `{{% {other} %}}` in `if`"),
                        span.start,
                    ));
                }
            }
        }
    }

    fn parse_unless(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let condition = condition(markup)?;
        let (body, stop) = self.parse_nodes()?;
        let Stop::Ctrl { name, span, .. } = stop else {
            return Err(ParseError::new("unclosed `{% unless %}`", open.start));
        };
        match name.as_str() {
            "else" => {
                let (els, end) = self.parse_block_body("endunless", open.start)?;
                Ok(Node::Unless {
                    span: Span::new(open.start, end),
                    condition,
                    body,
                    otherwise: Some(els),
                })
            }
            "endunless" => Ok(Node::Unless {
                span: Span::new(open.start, span.end),
                condition,
                body,
                otherwise: None,
            }),
            other => Err(ParseError::new(
                format!("unexpected `{{% {other} %}}` in `unless`"),
                span.start,
            )),
        }
    }

    fn parse_case(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let mut c = Cursor::new(markup);
        let subject = value(&mut c)?;
        // Content before the first `when` is discarded (matches Liquid).
        let (_pre, mut stop) = self.parse_nodes()?;
        let mut whens = Vec::new();
        let mut otherwise = None;
        loop {
            let Stop::Ctrl {
                name,
                markup: m,
                span,
            } = stop
            else {
                return Err(ParseError::new("unclosed `{% case %}`", open.start));
            };
            match name.as_str() {
                "when" => {
                    let values = parse_when_values(&m)?;
                    let (body, next) = self.parse_nodes()?;
                    whens.push(WhenArm { values, body });
                    stop = next;
                }
                "else" => {
                    let (body, next) = self.parse_nodes()?;
                    otherwise = Some(body);
                    stop = next;
                }
                "endcase" => {
                    return Ok(Node::Case {
                        span: Span::new(open.start, span.end),
                        subject,
                        whens,
                        otherwise,
                    });
                }
                other => {
                    return Err(ParseError::new(
                        format!("unexpected `{{% {other} %}}` in `case`"),
                        span.start,
                    ));
                }
            }
        }
    }

    fn parse_for(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let (var, iterable, params) = parse_for_header(markup)?;
        let (body, stop) = self.parse_nodes()?;
        let Stop::Ctrl { name, span, .. } = stop else {
            return Err(ParseError::new("unclosed `{% for %}`", open.start));
        };
        match name.as_str() {
            "else" => {
                let (els, end) = self.parse_block_body("endfor", open.start)?;
                Ok(Node::For {
                    span: Span::new(open.start, end),
                    var,
                    iterable,
                    params,
                    body,
                    otherwise: Some(els),
                })
            }
            "endfor" => Ok(Node::For {
                span: Span::new(open.start, span.end),
                var,
                iterable,
                params,
                body,
                otherwise: None,
            }),
            other => Err(ParseError::new(
                format!("unexpected `{{% {other} %}}` in `for`"),
                span.start,
            )),
        }
    }

    fn parse_tablerow(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let (var, iterable, params) = parse_for_header(markup)?;
        let (body, end) = self.parse_block_body("endtablerow", open.start)?;
        Ok(Node::TableRow {
            span: Span::new(open.start, end),
            var,
            iterable,
            params,
            body,
        })
    }

    fn parse_capture(&mut self, open: Span, markup: &str) -> Result<Node, ParseError> {
        let target = markup.trim().to_string();
        let (body, end) = self.parse_block_body("endcapture", open.start)?;
        Ok(Node::Capture {
            span: Span::new(open.start, end),
            target,
            body,
        })
    }

    fn parse_ifchanged(&mut self, open: Span) -> Result<Node, ParseError> {
        let (body, end) = self.parse_block_body("endifchanged", open.start)?;
        Ok(Node::IfChanged {
            span: Span::new(open.start, end),
            body,
        })
    }

    /// Parse a node list expected to terminate at exactly `end_name`, returning the
    /// body and the close tag's end offset.
    fn parse_block_body(
        &mut self,
        end_name: &str,
        open_start: usize,
    ) -> Result<(Vec<Node>, usize), ParseError> {
        let (body, stop) = self.parse_nodes()?;
        match stop {
            Stop::Ctrl { name, span, .. } if name == end_name => Ok((body, span.end)),
            Stop::Ctrl { name, span, .. } => Err(ParseError::new(
                format!("expected `{{% {end_name} %}}`, found `{{% {name} %}}`"),
                span.start,
            )),
            Stop::Eof => Err(ParseError::new(
                format!("unclosed block (expected `{{% {end_name} %}}`)"),
                open_start,
            )),
        }
    }
}

fn parse_assign(span: Span, markup: &str) -> Result<Node, ParseError> {
    let mut c = Cursor::new(markup);
    let target = c
        .read_ident()
        .ok_or_else(|| ParseError::new("expected a variable name in `assign`", span.start))?;
    if !c.eat("=") {
        return Err(ParseError::new("expected `=` in `assign`", span.start));
    }
    let value = value(&mut c)?;
    let filters = filters(&mut c)?;
    Ok(Node::Assign {
        span,
        target,
        value,
        filters,
    })
}

fn parse_cycle(span: Span, markup: &str) -> Result<Node, ParseError> {
    let mut c = Cursor::new(markup);
    let first = value(&mut c)?;
    let (group, mut values) = if c.eat(":") {
        (Some(first), Vec::new())
    } else {
        (None, vec![first])
    };
    if group.is_some() {
        loop {
            values.push(value(&mut c)?);
            if !c.eat(",") {
                break;
            }
        }
    } else {
        while c.eat(",") {
            values.push(value(&mut c)?);
        }
    }
    Ok(Node::Cycle {
        span,
        group,
        values,
    })
}

fn parse_theme(markup: &str) -> Result<(Expr, ThemeArgs), ParseError> {
    let mut c = Cursor::new(markup);
    let target = value(&mut c)?;
    let mut args = ThemeArgs::default();
    loop {
        c.eat(",");
        if c.done() {
            break;
        }
        if c.eat_word("with") {
            args.with = Some(value(&mut c)?);
            if c.eat_word("as") {
                args.alias = c.read_ident();
            }
        } else if c.eat_word("for") {
            args.for_each = Some(value(&mut c)?);
            if c.eat_word("as") {
                args.alias = c.read_ident();
            }
        } else {
            let Some(key) = c.read_ident() else { break };
            if c.eat(":") {
                args.params.push((key, value(&mut c)?));
            } else {
                break;
            }
        }
    }
    Ok((target, args))
}

fn parse_for_header(markup: &str) -> Result<(String, Expr, ForParams), ParseError> {
    let mut c = Cursor::new(markup);
    let var = c
        .read_ident()
        .ok_or_else(|| ParseError::new("expected a loop variable", c.i))?;
    if !c.eat_word("in") {
        return Err(ParseError::new("expected `in` in `for`", c.i));
    }
    let iterable = value(&mut c)?;
    let mut params = ForParams::default();
    while !c.done() {
        let Some(word) = c.read_ident() else { break };
        match word.as_str() {
            "reversed" => params.reversed = true,
            "limit" => {
                c.eat(":");
                params.limit = Some(value(&mut c)?);
            }
            "offset" => {
                c.eat(":");
                if c.eat_word("continue") {
                    params.offset = Some(Expr::Var(VarPath {
                        name: "continue".to_string(),
                        access: Vec::new(),
                    }));
                } else {
                    params.offset = Some(value(&mut c)?);
                }
            }
            "cols" => {
                c.eat(":");
                params.cols = Some(value(&mut c)?);
            }
            _ => break,
        }
    }
    Ok((var, iterable, params))
}

fn parse_when_values(markup: &str) -> Result<Vec<Expr>, ParseError> {
    let mut c = Cursor::new(markup);
    let mut values = vec![value(&mut c)?];
    loop {
        if c.eat(",") || c.eat_word("or") {
            values.push(value(&mut c)?);
        } else {
            break;
        }
    }
    Ok(values)
}

/// Parse a `{% liquid %}` body: each non-empty line is a tag statement, re-wrapped in
/// `{% … %}` and run through the normal parser (so inline blocks still nest).
fn parse_liquid_body(markup: &str) -> Result<Vec<Node>, ParseError> {
    let mut reconstructed = String::new();
    for line in markup.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        reconstructed.push_str("{% ");
        reconstructed.push_str(line);
        reconstructed.push_str(" %}");
    }
    parse(&reconstructed)
}

// ===========================================================================
// Whitespace control
// ===========================================================================

fn trim_whitespace(toks: &mut [Tok]) {
    let mut ltrim_next = false;
    for k in 0..toks.len() {
        let (lstrip, rstrip) = match &toks[k] {
            Tok::Output { lstrip, rstrip, .. } | Tok::Tag { lstrip, rstrip, .. } => {
                (*lstrip, *rstrip)
            }
            _ => (false, false),
        };
        if ltrim_next && let Tok::Text { text, .. } = &mut toks[k] {
            *text = text.trim_start().to_string();
        }
        ltrim_next = false;
        if lstrip
            && k > 0
            && let Tok::Text { text, .. } = &mut toks[k - 1]
        {
            *text = text.trim_end().to_string();
        }
        if rstrip {
            ltrim_next = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nodes(src: &str) -> Vec<Node> {
        parse(src).unwrap_or_else(|e| panic!("parse `{src}`: {e}"))
    }

    #[test]
    fn output_with_filters() {
        let n = nodes("{{ user.name | upcase | truncate: 5, '…' }}");
        let Node::Output { expr, filters, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert!(matches!(expr, Expr::Var(v) if v.name == "user" && v.access.len() == 1));
        assert_eq!(filters.len(), 2);
        assert_eq!(filters[1].name, "truncate");
        assert_eq!(filters[1].args.len(), 2);
    }

    #[test]
    fn index_and_subscript_access() {
        let n = nodes(r#"{{ a[0].b["k"][i] }}"#);
        let Node::Output {
            expr: Expr::Var(v), ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(v.name, "a");
        assert_eq!(v.access.len(), 4);
        assert!(matches!(&v.access[0], Access::Index(_)));
        assert!(matches!(&v.access[1], Access::Field(f) if f == "b"));
    }

    #[test]
    fn named_filter_args() {
        let n = nodes("{{ x | default: 'n/a', allow_false: true }}");
        let Node::Output { filters, .. } = &n[0] else {
            panic!()
        };
        assert!(matches!(&filters[0].args[1], FilterArg::Named(k, _) if k == "allow_false"));
    }

    #[test]
    fn if_elsif_else() {
        let n = nodes("{% if a > 1 %}A{% elsif b %}B{% else %}C{% endif %}");
        let Node::If {
            branches,
            otherwise,
            ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(branches.len(), 2);
        assert!(otherwise.is_some());
        assert!(matches!(
            &branches[0].0,
            Condition::Compare {
                op: Some(CmpOp::Gt),
                ..
            }
        ));
    }

    #[test]
    fn condition_and_or_contains() {
        let n = nodes("{% if a and b or c contains 'x' %}y{% endif %}");
        let Node::If { branches, .. } = &n[0] else {
            panic!()
        };
        assert!(matches!(&branches[0].0, Condition::Or(_, _)));
    }

    #[test]
    fn unless_block() {
        let n = nodes("{% unless ok %}no{% endunless %}");
        assert!(matches!(
            &n[0],
            Node::Unless {
                otherwise: None,
                ..
            }
        ));
    }

    #[test]
    fn case_when() {
        let n = nodes("{% case x %}{% when 1, 2 %}a{% when 3 %}b{% else %}c{% endcase %}");
        let Node::Case {
            whens, otherwise, ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(whens.len(), 2);
        assert_eq!(whens[0].values.len(), 2);
        assert!(otherwise.is_some());
    }

    #[test]
    fn for_with_params_and_else() {
        let n = nodes("{% for i in items limit: 3 reversed %}{{ i }}{% else %}none{% endfor %}");
        let Node::For {
            var,
            params,
            otherwise,
            ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(var, "i");
        assert!(params.reversed);
        assert!(params.limit.is_some());
        assert!(otherwise.is_some());
    }

    #[test]
    fn for_over_range() {
        let n = nodes("{% for i in (1..5) %}x{% endfor %}");
        let Node::For { iterable, .. } = &n[0] else {
            panic!()
        };
        assert!(matches!(iterable, Expr::Range { .. }));
    }

    #[test]
    fn assign_and_capture() {
        let n = nodes("{% assign x = y | upcase %}{% capture z %}hi{% endcapture %}");
        assert!(
            matches!(&n[0], Node::Assign { target, filters, .. } if target == "x" && filters.len() == 1)
        );
        assert!(matches!(&n[1], Node::Capture { target, .. } if target == "z"));
    }

    #[test]
    fn increment_cycle() {
        let n = nodes(r#"{% increment c %}{% cycle 'odd', 'even' %}{% cycle g: 'a', 'b' %}"#);
        assert!(matches!(&n[0], Node::Increment { target, .. } if target == "c"));
        assert!(matches!(&n[1], Node::Cycle { group: None, values, .. } if values.len() == 2));
        assert!(matches!(&n[2], Node::Cycle { group: Some(_), values, .. } if values.len() == 2));
    }

    #[test]
    fn include_and_render() {
        let n =
            nodes(r#"{% include 'card' with product as item, featured: true %}{% render 'b' %}"#);
        let Node::Include { args, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert!(args.with.is_some());
        assert_eq!(args.alias.as_deref(), Some("item"));
        assert_eq!(args.params.len(), 1);
        assert!(matches!(&n[1], Node::Render { .. }));
    }

    #[test]
    fn raw_and_comment_blocks() {
        let n = nodes("{% raw %}{{ x }}{% endraw %}{% comment %}c{% endcomment %}");
        assert!(matches!(&n[0], Node::Raw { content, .. } if content == "{{ x }}"));
        assert!(matches!(&n[1], Node::Comment { content, .. } if content == "c"));
    }

    #[test]
    fn liquid_inline_tag() {
        let n = nodes("{% liquid\n  assign x = 1\n  echo x\n%}");
        let Node::Liquid { body, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert!(matches!(&body[0], Node::Assign { .. }));
        assert!(matches!(&body[1], Node::Echo { .. }));
    }

    #[test]
    fn whitespace_control() {
        let n = nodes("a  {{- x -}}  b");
        assert!(matches!(&n[0], Node::Text { text, .. } if text == "a"));
        assert!(matches!(&n[2], Node::Text { text, .. } if text == "b"));
    }

    #[test]
    fn unknown_tag_preserved() {
        let n = nodes("{% paginate items by 5 %}");
        assert!(matches!(&n[0], Node::Unknown { name, .. } if name == "paginate"));
    }

    #[test]
    fn unclosed_block_errors() {
        assert!(parse("{% if a %}x").is_err());
        assert!(parse("{% for i in xs %}x{% endif %}").is_err());
    }
}
