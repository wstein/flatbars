//! The StringTemplate4 group-file (`.stg`) parser: the header directives
//! (`delimiters`, `import`, `group`), the named template / region definitions
//! (`name(params) ::= "…"` / `<<…>>` / `<%…%>`), and dictionaries
//! (`name ::= ["k": v, …, default: v]`). Each template body is parsed with the
//! [`super::template`] parser using the group's configured delimiters.

use super::ast::{DictDef, DictValue, Group, Param, TemplateDef};
use super::template;
use crate::{ParseError, Span};

/// The body of a dictionary definition: its `(key, value)` entries and optional
/// `default:` value.
type DictBody = (Vec<(String, DictValue)>, Option<DictValue>);

/// Parse a `.stg` group file.
///
/// # Errors
/// Returns a [`ParseError`] on a malformed directive, definition, or body.
pub fn parse(src: &str) -> Result<Group, ParseError> {
    let mut g = Group::default();
    let mut c = Cur { s: src, i: 0 };
    loop {
        c.skip_trivia();
        if c.eof() {
            break;
        }
        if c.eat_word("delimiters") {
            let o = c.read_string()?;
            c.eat(",");
            let cl = c.read_string()?;
            g.delimiters = Some((o, cl));
            c.eat(";");
            continue;
        }
        if c.eat_word("import") {
            g.imports.push(c.read_string()?);
            c.eat(";");
            continue;
        }
        if c.eat_word("group") {
            g.name = Some(c.read_def_name()?);
            // Skip the optional `: super`, `implements …`, up to the `;`.
            c.skip_to(b';');
            c.eat(";");
            continue;
        }
        parse_def(&mut c, &mut g)?;
    }
    Ok(g)
}

fn parse_def(c: &mut Cur, g: &mut Group) -> Result<(), ParseError> {
    let start = {
        c.skip_trivia();
        c.i
    };
    let name = c.read_def_name()?;
    c.skip_trivia();
    let params = if c.peek() == Some('(') {
        parse_params(c, g)?
    } else {
        Vec::new()
    };
    c.skip_trivia();
    if !c.eat("::=") {
        return Err(ParseError::new(
            format!("expected `::=` after `{name}`"),
            c.i,
        ));
    }
    c.skip_trivia();
    if c.peek() == Some('[') {
        let (entries, default) = parse_dict(c, g)?;
        g.dicts.push(DictDef {
            span: Span::new(start, c.i),
            name,
            entries,
            default,
        });
    } else {
        let body_src = c.read_body()?;
        let (open, close) = delims(g);
        let body = template::parse(&body_src, open, close)?;
        g.templates.push(TemplateDef {
            span: Span::new(start, c.i),
            name,
            params,
            body,
        });
    }
    Ok(())
}

fn parse_params(c: &mut Cur, g: &Group) -> Result<Vec<Param>, ParseError> {
    c.eat("(");
    let mut params = Vec::new();
    let (open, close) = delims(g);
    loop {
        c.skip_trivia();
        if c.peek() == Some(')') {
            break;
        }
        let Some(name) = c.read_ident() else { break };
        let default = if c.eat("=") {
            let raw = c.read_until(b",)");
            Some(template::parse_value(raw.trim(), open, close)?)
        } else {
            None
        };
        params.push(Param { name, default });
        if !c.eat(",") {
            break;
        }
    }
    c.eat(")");
    Ok(params)
}

fn parse_dict(c: &mut Cur, g: &Group) -> Result<DictBody, ParseError> {
    c.eat("[");
    let (open, close) = delims(g);
    let mut entries = Vec::new();
    let mut default = None;
    loop {
        c.skip_trivia();
        if c.peek() == Some(']') {
            break;
        }
        let key = if c.peek() == Some('"') {
            c.read_string()?
        } else {
            c.read_ident()
                .ok_or_else(|| ParseError::new("expected a dictionary key", c.i))?
        };
        c.skip_trivia();
        let value = if c.eat(":") {
            c.skip_trivia();
            if matches!(c.peek(), Some(',') | Some(']')) {
                DictValue::Empty
            } else {
                let raw = c.read_until(b",]");
                let raw = raw.trim();
                if raw.starts_with('"') {
                    DictValue::Str(strip_quotes(raw))
                } else {
                    DictValue::Expr(template::parse_value(raw, open, close)?)
                }
            }
        } else {
            DictValue::Empty
        };
        if key == "default" {
            default = Some(value);
        } else {
            entries.push((key, value));
        }
        if !c.eat(",") {
            break;
        }
    }
    c.eat("]");
    Ok((entries, default))
}

fn delims(g: &Group) -> (char, char) {
    match &g.delimiters {
        Some((o, c)) => {
            let oc = o.chars().next().unwrap_or('<');
            let cc = c.chars().next().unwrap_or('>');
            (oc, cc)
        }
        None => ('<', '>'),
    }
}

fn strip_quotes(s: &str) -> String {
    s.trim()
        .trim_start_matches('"')
        .trim_end_matches('"')
        .to_string()
}

// ---------------------------------------------------------------------------

struct Cur<'a> {
    s: &'a str,
    i: usize,
}

impl<'a> Cur<'a> {
    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }

    fn eof(&self) -> bool {
        self.i >= self.s.len()
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    /// Skip whitespace and `//` / `/* … */` comments.
    fn skip_trivia(&mut self) {
        loop {
            let before = self.i;
            let t = self.rest().trim_start();
            self.i = self.s.len() - t.len();
            if self.rest().starts_with("//") {
                if let Some(nl) = self.rest().find('\n') {
                    self.i += nl + 1;
                } else {
                    self.i = self.s.len();
                }
            } else if self.rest().starts_with("/*") {
                if let Some(end) = self.rest()[2..].find("*/") {
                    self.i += 2 + end + 2;
                } else {
                    self.i = self.s.len();
                }
            }
            if self.i == before {
                break;
            }
        }
    }

    fn eat(&mut self, p: &str) -> bool {
        self.skip_trivia();
        if self.rest().starts_with(p) {
            self.i += p.len();
            true
        } else {
            false
        }
    }

    fn eat_word(&mut self, w: &str) -> bool {
        self.skip_trivia();
        let r = self.rest();
        if r.starts_with(w)
            && r[w.len()..]
                .chars()
                .next()
                .is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
        {
            self.i += w.len();
            true
        } else {
            false
        }
    }

    fn read_ident(&mut self) -> Option<String> {
        self.skip_trivia();
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

    /// A definition name: an identifier, optionally a region name (`@enclosing.region`).
    fn read_def_name(&mut self) -> Result<String, ParseError> {
        self.skip_trivia();
        let r = self.rest();
        let mut end = 0;
        for (idx, ch) in r.char_indices() {
            if ch.is_alphanumeric() || ch == '_' || ch == '@' || ch == '.' || ch == '/' {
                end = idx + ch.len_utf8();
            } else {
                break;
            }
        }
        if end == 0 {
            return Err(ParseError::new("expected a definition name", self.i));
        }
        let id = r[..end].to_string();
        self.i += end;
        Ok(id)
    }

    fn read_string(&mut self) -> Result<String, ParseError> {
        self.skip_trivia();
        let r = self.rest();
        if !r.starts_with('"') {
            return Err(ParseError::new("expected a string", self.i));
        }
        let bytes = r.as_bytes();
        let mut i = 1;
        let mut out = String::new();
        while i < bytes.len() {
            match bytes[i] {
                b'\\' if i + 1 < bytes.len() => {
                    out.push(bytes[i + 1] as char);
                    i += 2;
                }
                b'"' => {
                    self.i += i + 1;
                    return Ok(out);
                }
                _ => {
                    let ch = r[i..].chars().next().unwrap();
                    out.push(ch);
                    i += ch.len_utf8();
                }
            }
        }
        Err(ParseError::new("unterminated string", self.i))
    }

    /// Read a template body: `"…"`, `<<…>>`, or `<%…%>`.
    fn read_body(&mut self) -> Result<String, ParseError> {
        self.skip_trivia();
        let r = self.rest();
        if r.starts_with("<<") {
            let inner_start = self.i + 2;
            let Some(end) = self.s[inner_start..].find(">>") else {
                return Err(ParseError::new("unterminated `<<…>>` body", self.i));
            };
            let raw = &self.s[inner_start..inner_start + end];
            self.i = inner_start + end + 2;
            Ok(trim_block(raw).to_string())
        } else if r.starts_with("<%") {
            let inner_start = self.i + 2;
            let Some(end) = self.s[inner_start..].find("%>") else {
                return Err(ParseError::new("unterminated `<%…%>` body", self.i));
            };
            let raw = &self.s[inner_start..inner_start + end];
            self.i = inner_start + end + 2;
            Ok(trim_block(raw).to_string())
        } else if r.starts_with('"') {
            self.read_string()
        } else {
            Err(ParseError::new(
                "expected a template body (`\"…\"`, `<<…>>`, or `<%…%>`)",
                self.i,
            ))
        }
    }

    /// Read raw text up to (not consuming) the first top-level byte in `stops`,
    /// honoring strings and `( ) [ ] { }` nesting.
    fn read_until(&mut self, stops: &[u8]) -> &'a str {
        let b = self.s.as_bytes();
        let start = self.i;
        let mut depth = 0i32;
        let mut in_str = false;
        let mut i = self.i;
        while i < b.len() {
            let ch = b[i];
            if in_str {
                if ch == b'\\' {
                    i += 2;
                    continue;
                }
                if ch == b'"' {
                    in_str = false;
                }
                i += 1;
                continue;
            }
            // Check terminators first: a top-level `)` / `]` is a stop, not a
            // bracket close to descend through.
            if depth == 0 && stops.contains(&ch) {
                break;
            }
            match ch {
                b'"' => in_str = true,
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        self.i = i;
        &self.s[start..i]
    }

    fn skip_to(&mut self, byte: u8) {
        if let Some(p) = self.rest().bytes().position(|b| b == byte) {
            self.i += p;
        } else {
            self.i = self.s.len();
        }
    }
}

/// Trim one leading and one trailing newline from a `<<…>>` / `<%…%>` body
/// (the ST4 rule).
fn trim_block(s: &str) -> &str {
    let s = s
        .strip_prefix("\r\n")
        .or_else(|| s.strip_prefix('\n'))
        .unwrap_or(s);
    s.strip_suffix("\r\n")
        .or_else(|| s.strip_suffix('\n'))
        .unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::super::ast::{Callee, DictValue, Element, Expr};
    use super::*;

    #[test]
    fn header_and_simple_def() {
        let g = parse(
            r#"delimiters "<", ">"
            import "common.stg"
            group MyGroup;
            greeting(name) ::= "Hello, <name>!"
        "#,
        )
        .unwrap();
        assert_eq!(g.delimiters, Some(("<".into(), ">".into())));
        assert_eq!(g.imports, vec!["common.stg".to_string()]);
        assert_eq!(g.name.as_deref(), Some("MyGroup"));
        assert_eq!(g.templates.len(), 1);
        assert_eq!(g.templates[0].name, "greeting");
        assert_eq!(g.templates[0].params[0].name, "name");
    }

    #[test]
    fn multiline_body() {
        let g = parse("page(title, body) ::= <<\n<title>\n<body>\n>>\n").unwrap();
        let t = &g.templates[0];
        assert_eq!(t.params.len(), 2);
        // Leading/trailing newline trimmed; the two interpolations survive.
        assert!(t.body.iter().any(|e| matches!(e, Element::Expr { .. })));
    }

    #[test]
    fn param_with_default() {
        let g = parse(r#"row(x, sep=", ") ::= "<x><sep>""#).unwrap();
        let p = &g.templates[0].params[1];
        assert_eq!(p.name, "sep");
        assert!(matches!(&p.default, Some(Expr::Str(s)) if s == ", "));
    }

    #[test]
    fn dictionary() {
        let g = parse(r#"typeNames ::= ["int": "Integer", "bool": "Boolean", default: "Object"]"#)
            .unwrap();
        let d = &g.dicts[0];
        assert_eq!(d.name, "typeNames");
        assert_eq!(d.entries.len(), 2);
        assert!(matches!(&d.entries[0].1, DictValue::Str(s) if s == "Integer"));
        assert!(matches!(&d.default, Some(DictValue::Str(s)) if s == "Object"));
    }

    #[test]
    fn comments_and_anon_template_body() {
        let g = parse("// a comment\n/* block */\nlist(xs) ::= <<\n<xs:{x | <x>\n}>\n>>").unwrap();
        assert_eq!(g.templates.len(), 1);
        assert_eq!(g.templates[0].name, "list");
    }

    #[test]
    fn region_definition() {
        let g = parse(r#"@page.header() ::= "Default header""#).unwrap();
        assert_eq!(g.templates[0].name, "@page.header");
    }

    #[test]
    fn percent_body_and_indirect_call() {
        let g = parse("dispatch(x) ::= <%<(x.kind)()>%>").unwrap();
        let Element::Expr { value, .. } = &g.templates[0].body[0] else {
            panic!("{:?}", g.templates[0].body)
        };
        assert!(matches!(
            &value.expr,
            Expr::Include {
                callee: Callee::Indirect(_),
                ..
            }
        ));
    }

    #[test]
    fn missing_assign_errors() {
        assert!(parse("foo(x) = \"bad\"").is_err());
    }
}
