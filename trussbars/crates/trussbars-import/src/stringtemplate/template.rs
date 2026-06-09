//! The StringTemplate4 `.st` body parser: the [`Tok`] stream → an [`Element`] tree
//! (text, `<expr>`, `<if>`/`<elseif>`/`<else>`/`<endif>`, `<! comment !>`, and
//! `<@region>` definitions), plus the expression parser it relies on (attribute /
//! property access, includes, `:` map/apply with anonymous subtemplates and multiple
//! targets, lists, literals, `!`/`&&`/`||`, and `; option=value` settings).

use super::ast::{Arg, Callee, Element, Expr, ExprWithOptions, Mapper, Prop, Subtemplate};
use super::lex::{Tok, lex};
use crate::{ParseError, Span};

/// Parse a StringTemplate body with the given delimiters into its element tree.
///
/// # Errors
/// Returns a [`ParseError`] on a lex failure, an unclosed `if`/region, or a malformed
/// expression.
pub fn parse(src: &str, open: char, close: char) -> Result<Vec<Element>, ParseError> {
    let toks = lex(src, open, close)?;
    let mut p = ElemParser {
        toks: &toks,
        pos: 0,
        open,
        close,
    };
    let (els, stop) = p.parse_elements()?;
    match stop {
        Stop::Eof => Ok(els),
        Stop::Endif(s) | Stop::Else(s) | Stop::Elseif(_, s) | Stop::RegionEnd(s) => Err(
            ParseError::new("unexpected directive outside a block", s.start),
        ),
    }
}

enum Stop {
    Eof,
    Endif(Span),
    Else(Span),
    Elseif(String, Span),
    RegionEnd(Span),
}

struct ElemParser<'a> {
    toks: &'a [Tok],
    pos: usize,
    open: char,
    close: char,
}

impl ElemParser<'_> {
    fn parse_elements(&mut self) -> Result<(Vec<Element>, Stop), ParseError> {
        let mut els = Vec::new();
        while self.pos < self.toks.len() {
            match &self.toks[self.pos] {
                Tok::Text { span, text } => {
                    els.push(Element::Text {
                        span: *span,
                        text: text.clone(),
                    });
                    self.pos += 1;
                }
                Tok::Comment { span, text } => {
                    els.push(Element::Comment {
                        span: *span,
                        text: text.clone(),
                    });
                    self.pos += 1;
                }
                Tok::Tag { span, interior } => {
                    let span = *span;
                    let interior = interior.clone();
                    let t = interior.trim();
                    if t == "endif" {
                        self.pos += 1;
                        return Ok((els, Stop::Endif(span)));
                    }
                    if t == "else" {
                        self.pos += 1;
                        return Ok((els, Stop::Else(span)));
                    }
                    if let Some(rest) = t.strip_prefix("elseif") {
                        self.pos += 1;
                        return Ok((els, Stop::Elseif(paren_inner(rest), span)));
                    }
                    if t == "@end" {
                        self.pos += 1;
                        return Ok((els, Stop::RegionEnd(span)));
                    }
                    if let Some(cond) = if_condition(t) {
                        self.pos += 1;
                        els.push(self.parse_if(span, &cond)?);
                        continue;
                    }
                    // `<@name>` region open (but `<@name()>` is a region *include*).
                    if let Some(name) = t.strip_prefix('@')
                        && !name.contains('(')
                    {
                        self.pos += 1;
                        els.push(self.parse_region(span, name.trim())?);
                        continue;
                    }
                    self.pos += 1;
                    els.push(Element::Expr {
                        span,
                        value: parse_expr_with_options(&interior, self.open, self.close)?,
                    });
                }
            }
        }
        Ok((els, Stop::Eof))
    }

    fn parse_if(&mut self, open: Span, cond_src: &str) -> Result<Element, ParseError> {
        let condition = parse_condition(cond_src, self.open, self.close)?;
        let (body, mut stop) = self.parse_elements()?;
        let mut elseifs = Vec::new();
        let mut otherwise = None;
        loop {
            match stop {
                Stop::Elseif(c, _) => {
                    let cond = parse_condition(&c, self.open, self.close)?;
                    let (b, next) = self.parse_elements()?;
                    elseifs.push((cond, b));
                    stop = next;
                }
                Stop::Else(_) => {
                    let (b, next) = self.parse_elements()?;
                    otherwise = Some(b);
                    stop = next;
                }
                Stop::Endif(s) => {
                    return Ok(Element::If {
                        span: Span::new(open.start, s.end),
                        condition,
                        body,
                        elseifs,
                        otherwise,
                    });
                }
                Stop::Eof | Stop::RegionEnd(_) => {
                    return Err(ParseError::new("unclosed `<if>`", open.start));
                }
            }
        }
    }

    fn parse_region(&mut self, open: Span, name: &str) -> Result<Element, ParseError> {
        let (body, stop) = self.parse_elements()?;
        match stop {
            Stop::RegionEnd(s) => Ok(Element::Region {
                span: Span::new(open.start, s.end),
                name: name.to_string(),
                body,
            }),
            _ => Err(ParseError::new(
                format!("unclosed region `<@{name}>`"),
                open.start,
            )),
        }
    }
}

/// Extract `cond` from a leading `if(cond)` directive (else `None`).
fn if_condition(t: &str) -> Option<String> {
    let rest = t.strip_prefix("if")?;
    let rest = rest.trim_start();
    if rest.starts_with('(') {
        Some(paren_inner(rest))
    } else {
        None
    }
}

/// Take the content between the first `(` and its matching `)`.
fn paren_inner(s: &str) -> String {
    let s = s.trim_start();
    let Some(start) = s.find('(') else {
        return String::new();
    };
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => in_str = true,
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return s[start + 1..i].to_string();
                }
            }
            _ => {}
        }
        i += 1;
    }
    s[start + 1..].to_string()
}

// ===========================================================================
// Expression parser
// ===========================================================================

struct Cur<'a> {
    s: &'a str,
    i: usize,
    open: char,
    close: char,
}

impl<'a> Cur<'a> {
    fn new(s: &'a str, open: char, close: char) -> Self {
        Cur {
            s,
            i: 0,
            open,
            close,
        }
    }

    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }

    fn skip_ws(&mut self) {
        let t = self.rest().trim_start();
        self.i = self.s.len() - t.len();
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn eat(&mut self, p: &str) -> bool {
        self.skip_ws();
        if self.rest().starts_with(p) {
            self.i += p.len();
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
            } else if !(ch.is_alphanumeric() || ch == '_') {
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
        if !r.starts_with('"') {
            return None;
        }
        let bytes = r.as_bytes();
        let mut i = 1;
        let mut out = String::new();
        while i < bytes.len() {
            match bytes[i] {
                b'\\' if i + 1 < bytes.len() => {
                    let c = bytes[i + 1];
                    out.push(match c {
                        b'n' => '\n',
                        b't' => '\t',
                        b'r' => '\r',
                        other => other as char,
                    });
                    i += 2;
                }
                b'"' => {
                    self.i += i + 1;
                    return Some(out);
                }
                _ => {
                    let ch = r[i..].chars().next().unwrap();
                    out.push(ch);
                    i += ch.len_utf8();
                }
            }
        }
        None
    }
}

/// Parse a tag interior into an expression plus its `; option=value` settings.
fn parse_expr_with_options(
    interior: &str,
    open: char,
    close: char,
) -> Result<ExprWithOptions, ParseError> {
    let mut c = Cur::new(interior, open, close);
    let expr = parse_top(&mut c)?;
    let mut options = Vec::new();
    if c.eat(";") {
        while let Some(name) = c.read_ident() {
            let value = if c.eat("=") {
                parse_expr(&mut c)?
            } else {
                Expr::Bool(true)
            };
            options.push((name, value));
            if !c.eat(",") {
                break;
            }
        }
    }
    Ok(ExprWithOptions { expr, options })
}

/// Parse a single StringTemplate value expression (used for group dictionary values
/// and template-parameter defaults).
///
/// # Errors
/// Returns a [`ParseError`] on a malformed expression.
pub fn parse_value(src: &str, open: char, close: char) -> Result<Expr, ParseError> {
    let mut c = Cur::new(src, open, close);
    parse_expr(&mut c)
}

/// Parse a conditional expression (`!a && b.c || d`).
fn parse_condition(src: &str, open: char, close: char) -> Result<Expr, ParseError> {
    let mut c = Cur::new(src, open, close);
    parse_or(&mut c)
}

fn parse_or(c: &mut Cur) -> Result<Expr, ParseError> {
    let mut left = parse_and(c)?;
    while c.eat("||") {
        let right = parse_and(c)?;
        left = Expr::Or(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_and(c: &mut Cur) -> Result<Expr, ParseError> {
    let mut left = parse_unary(c)?;
    while c.eat("&&") {
        let right = parse_unary(c)?;
        left = Expr::And(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_unary(c: &mut Cur) -> Result<Expr, ParseError> {
    if c.eat("!") {
        Ok(Expr::Not(Box::new(parse_unary(c)?)))
    } else {
        parse_member(c)
    }
}

/// A value expression usable anywhere (arg, list element, option value): a single
/// target with an optional `:` map chain. The comma multi-target form is *not*
/// accepted here (commas there separate args/elements), only in [`parse_top`].
fn parse_expr(c: &mut Cur) -> Result<Expr, ParseError> {
    let first = parse_member(c)?;
    let mut mappers = Vec::new();
    while c.eat(":") {
        mappers.push(parse_mapper(c)?);
    }
    if mappers.is_empty() {
        Ok(first)
    } else {
        Ok(Expr::Map {
            targets: vec![first],
            mappers,
        })
    }
}

/// The top-level `<…>` expression: a single value, or the multi-target map form
/// `a, b : t() : u()`.
fn parse_top(c: &mut Cur) -> Result<Expr, ParseError> {
    let first = parse_member(c)?;
    c.skip_ws();
    if c.peek() == Some(',') {
        let mut targets = vec![first];
        while c.eat(",") {
            targets.push(parse_member(c)?);
        }
        if !c.eat(":") {
            return Err(ParseError::new("expected `:` after map targets", c.i));
        }
        let mut mappers = vec![parse_mapper(c)?];
        while c.eat(":") {
            mappers.push(parse_mapper(c)?);
        }
        Ok(Expr::Map { targets, mappers })
    } else {
        let mut mappers = Vec::new();
        while c.eat(":") {
            mappers.push(parse_mapper(c)?);
        }
        if mappers.is_empty() {
            Ok(first)
        } else {
            Ok(Expr::Map {
                targets: vec![first],
                mappers,
            })
        }
    }
}

fn parse_member(c: &mut Cur) -> Result<Expr, ParseError> {
    let mut e = parse_atom(c)?;
    loop {
        c.skip_ws();
        if c.eat(".") {
            c.skip_ws();
            if c.peek() == Some('(') {
                c.eat("(");
                let inner = parse_expr(c)?;
                c.eat(")");
                e = Expr::Prop {
                    object: Box::new(e),
                    prop: Prop::Dynamic(Box::new(inner)),
                };
            } else {
                let name = c
                    .read_ident()
                    .ok_or_else(|| ParseError::new("expected a property name after `.`", c.i))?;
                e = Expr::Prop {
                    object: Box::new(e),
                    prop: Prop::Name(name),
                };
            }
        } else {
            break;
        }
    }
    Ok(e)
}

fn parse_atom(c: &mut Cur) -> Result<Expr, ParseError> {
    c.skip_ws();
    match c.peek() {
        None => Err(ParseError::new("expected an expression", c.i)),
        Some('(') => {
            c.eat("(");
            let inner = parse_expr(c)?;
            c.eat(")");
            c.skip_ws();
            if c.peek() == Some('(') {
                let args = parse_call_args(c)?;
                Ok(Expr::Include {
                    callee: Callee::Indirect(Box::new(inner)),
                    args,
                })
            } else {
                Ok(inner)
            }
        }
        Some('{') => Ok(Expr::Anon(parse_anon(c)?)),
        Some('[') => parse_list(c),
        Some('"') => Ok(Expr::Str(c.read_string().expect("string"))),
        Some(_) => {
            let id = c
                .read_ident()
                .ok_or_else(|| ParseError::new("expected an expression", c.i))?;
            match id.as_str() {
                "true" => Ok(Expr::Bool(true)),
                "false" => Ok(Expr::Bool(false)),
                _ => {
                    c.skip_ws();
                    if c.peek() == Some('(') {
                        let args = parse_call_args(c)?;
                        Ok(Expr::Include {
                            callee: Callee::Named(id),
                            args,
                        })
                    } else {
                        Ok(Expr::Attr(id))
                    }
                }
            }
        }
    }
}

fn parse_mapper(c: &mut Cur) -> Result<Mapper, ParseError> {
    c.skip_ws();
    match c.peek() {
        Some('{') => Ok(Mapper::Anon(parse_anon(c)?)),
        Some('(') => {
            c.eat("(");
            let inner = parse_expr(c)?;
            c.eat(")");
            let args = if c.peek() == Some('(') {
                parse_call_args(c)?
            } else {
                Vec::new()
            };
            Ok(Mapper::Template {
                callee: Callee::Indirect(Box::new(inner)),
                args,
            })
        }
        _ => {
            let id = c
                .read_ident()
                .ok_or_else(|| ParseError::new("expected a template name after `:`", c.i))?;
            c.skip_ws();
            let args = if c.peek() == Some('(') {
                parse_call_args(c)?
            } else {
                Vec::new()
            };
            Ok(Mapper::Template {
                callee: Callee::Named(id),
                args,
            })
        }
    }
}

fn parse_call_args(c: &mut Cur) -> Result<Vec<Arg>, ParseError> {
    c.eat("(");
    let mut args = Vec::new();
    c.skip_ws();
    if c.peek() == Some(')') {
        c.eat(")");
        return Ok(args);
    }
    loop {
        if c.eat("...") {
            args.push(Arg::Ellipsis);
        } else {
            let save = c.i;
            let mut named = None;
            if let Some(id) = c.read_ident() {
                if c.eat("=") {
                    named = Some(id);
                } else {
                    c.i = save;
                }
            }
            match named {
                Some(name) => args.push(Arg::Named(name, parse_expr(c)?)),
                None => args.push(Arg::Positional(parse_expr(c)?)),
            }
        }
        if !c.eat(",") {
            break;
        }
    }
    c.eat(")");
    Ok(args)
}

fn parse_list(c: &mut Cur) -> Result<Expr, ParseError> {
    c.eat("[");
    let mut items = Vec::new();
    c.skip_ws();
    if c.peek() == Some(']') {
        c.eat("]");
        return Ok(Expr::List(items));
    }
    loop {
        items.push(parse_expr(c)?);
        if !c.eat(",") {
            break;
        }
    }
    c.eat("]");
    Ok(Expr::List(items))
}

/// Parse an anonymous subtemplate `{ params | body }` (the body is itself a template).
fn parse_anon(c: &mut Cur) -> Result<Subtemplate, ParseError> {
    c.skip_ws();
    let brace = c.i; // points at '{'
    let Some(close) = matching_brace(c.s, brace) else {
        return Err(ParseError::new("unclosed `{` subtemplate", brace));
    };
    let inner = &c.s[brace + 1..close];
    c.i = close + 1;
    let (params, body_src) = split_params(inner);
    let body = parse(body_src, c.open, c.close)?;
    Ok(Subtemplate { params, body })
}

/// Find the `}` matching the `{` at `from`.
fn matching_brace(s: &str, from: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Split a subtemplate's `params |` prefix off its body, if the prefix is a clean
/// identifier list.
fn split_params(inner: &str) -> (Vec<String>, &str) {
    let b = inner.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => in_str = true,
            b'{' | b'(' | b'[' => depth += 1,
            b'}' | b')' | b']' => depth -= 1,
            b'|' if depth == 0 && b.get(i + 1) != Some(&b'|') && (i == 0 || b[i - 1] != b'|') => {
                let prefix = inner[..i].trim();
                let names: Vec<String> = prefix
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect();
                let clean = !names.is_empty()
                    && names.iter().all(|n| {
                        n.chars().all(|c| c.is_alphanumeric() || c == '_')
                            && n.chars()
                                .next()
                                .is_some_and(|c| c.is_alphabetic() || c == '_')
                    });
                if clean {
                    return (names, &inner[i + 1..]);
                }
                return (Vec::new(), inner);
            }
            _ => {}
        }
        i += 1;
    }
    (Vec::new(), inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn els(src: &str) -> Vec<Element> {
        parse(src, '<', '>').unwrap_or_else(|e| panic!("parse `{src}`: {e}"))
    }

    fn expr(src: &str) -> Expr {
        let e = els(&format!("<{src}>"));
        match &e[0] {
            Element::Expr { value, .. } => value.expr.clone(),
            other => panic!("not an expr: {other:?}"),
        }
    }

    #[test]
    fn text_and_attr() {
        let e = els("Hi <name>.");
        assert!(matches!(&e[0], Element::Text { text, .. } if text == "Hi "));
        assert!(matches!(&e[1], Element::Expr { .. }));
    }

    #[test]
    fn property_chain_and_dynamic() {
        assert!(matches!(expr("a.b.c"), Expr::Prop { .. }));
        let e = expr("a.(b)");
        let Expr::Prop {
            prop: Prop::Dynamic(_),
            ..
        } = e
        else {
            panic!("{e:?}")
        };
    }

    #[test]
    fn include_with_named_args() {
        let e = expr("page(title=t, x)");
        let Expr::Include {
            callee: Callee::Named(n),
            args,
        } = e
        else {
            panic!("{e:?}")
        };
        assert_eq!(n, "page");
        assert!(matches!(&args[0], Arg::Named(k, _) if k == "title"));
        assert!(matches!(&args[1], Arg::Positional(_)));
    }

    #[test]
    fn map_with_anon_and_template() {
        let e = expr("users:{u | <u.name>}");
        let Expr::Map { targets, mappers } = e else {
            panic!("{e:?}")
        };
        assert_eq!(targets.len(), 1);
        assert!(matches!(&mappers[0], Mapper::Anon(s) if s.params == ["u"]));
    }

    #[test]
    fn multi_target_map_chain() {
        let e = expr("a,b:t():u()");
        let Expr::Map { targets, mappers } = e else {
            panic!("{e:?}")
        };
        assert_eq!(targets.len(), 2);
        assert_eq!(mappers.len(), 2);
    }

    #[test]
    fn indirect_include() {
        let e = expr("(name)(x)");
        assert!(matches!(
            e,
            Expr::Include {
                callee: Callee::Indirect(_),
                ..
            }
        ));
    }

    #[test]
    fn list_and_literals() {
        assert!(matches!(expr("[a, b, c]"), Expr::List(v) if v.len() == 3));
        assert!(matches!(expr("true"), Expr::Bool(true)));
        assert!(matches!(expr(r#""hi""#), Expr::Str(s) if s == "hi"));
    }

    #[test]
    fn options() {
        let e = els("<items; separator=\", \", null=\"n/a\">");
        let Element::Expr { value, .. } = &e[0] else {
            panic!()
        };
        assert_eq!(value.options.len(), 2);
        assert_eq!(value.options[0].0, "separator");
    }

    #[test]
    fn conditional_chain() {
        let e = els("<if(a)>A<elseif(!b)>B<else>C<endif>");
        let Element::If {
            elseifs, otherwise, ..
        } = &e[0]
        else {
            panic!("{e:?}")
        };
        assert_eq!(elseifs.len(), 1);
        assert!(matches!(&elseifs[0].0, Expr::Not(_)));
        assert!(otherwise.is_some());
    }

    #[test]
    fn conditional_boolean_ops() {
        let e = els("<if(a && b || c)>x<endif>");
        let Element::If { condition, .. } = &e[0] else {
            panic!()
        };
        assert!(matches!(condition, Expr::Or(_, _)));
    }

    #[test]
    fn region_definition() {
        let e = els("<@header>default<@end>");
        let Element::Region { name, body, .. } = &e[0] else {
            panic!("{e:?}")
        };
        assert_eq!(name, "header");
        assert_eq!(body.len(), 1);
    }

    #[test]
    fn comment_element() {
        let e = els("a<! c !>b");
        assert!(matches!(&e[1], Element::Comment { text, .. } if text == " c "));
    }

    #[test]
    fn nested_anon_template_with_inner_tags() {
        let e = expr("rows:{r | <r.cells:{c | <c>}>}");
        assert!(matches!(e, Expr::Map { .. }));
    }

    #[test]
    fn unclosed_if_errors() {
        assert!(parse("<if(a)>x", '<', '>').is_err());
        assert!(parse("<@r>x", '<', '>').is_err());
    }
}
