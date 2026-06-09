//! The StringTemplate4 template lexer: source → text / `<…>` tag / `<! … !>`
//! comment tokens, parameterised by the delimiter pair (default `<` / `>`). It
//! decodes the text escapes (`\<`, `\>`, and the `<\n>` / `<\ >` / `<\uXXXX>` escape
//! tags) into literal text, and finds the matching close delimiter while skipping
//! strings and `{ } ( ) [ ]` nesting so anonymous subtemplates (which contain their
//! own `<…>` and `>`) do not close the outer tag early.

use crate::{ParseError, Span};

/// A lexed StringTemplate token.
#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    /// Literal text (escapes already decoded).
    Text {
        /// The source span (over the original, un-decoded run).
        span: Span,
        /// The decoded literal text.
        text: String,
    },
    /// An expression / directive tag `<…>` — `interior` is the content between the
    /// delimiters.
    Tag {
        /// The whole span.
        span: Span,
        /// The interior content.
        interior: String,
    },
    /// A comment `<! … !>`.
    Comment {
        /// The whole span.
        span: Span,
        /// The comment text.
        text: String,
    },
}

/// Lex a StringTemplate body using the given delimiters (ASCII).
///
/// # Errors
/// Returns a [`ParseError`] on an unclosed tag or comment.
pub fn lex(src: &str, open: char, close: char) -> Result<Vec<Tok>, ParseError> {
    let b = src.as_bytes();
    let openb = open as u8;
    let closeb = close as u8;
    let mut toks = Vec::new();
    let mut text = String::new();
    let mut text_start = 0usize;
    let mut i = 0usize;

    let comment_close = format!("!{close}");

    while i < b.len() {
        // An escaped delimiter in text (`\<` / `\>`).
        if b[i] == b'\\' && i + 1 < b.len() && (b[i + 1] == openb || b[i + 1] == closeb) {
            if text.is_empty() {
                text_start = i;
            }
            text.push(b[i + 1] as char);
            i += 2;
            continue;
        }
        if b[i] == openb {
            // Comment `<! … !>`.
            if b.get(i + 1) == Some(&b'!') {
                let cstart = i + 2;
                let Some(end) = find_from(src, cstart, &comment_close) else {
                    return Err(ParseError::new("unclosed StringTemplate comment", i));
                };
                flush(&mut toks, &mut text, text_start, i);
                let full_end = end + comment_close.len();
                toks.push(Tok::Comment {
                    span: Span::new(i, full_end),
                    text: src[cstart..end].to_string(),
                });
                i = full_end;
                continue;
            }
            // Escape tag `<\n>` / `<\ >` / `<\uXXXX>`.
            if b.get(i + 1) == Some(&b'\\') {
                let Some(end) = find_from(src, i + 1, &close.to_string()) else {
                    return Err(ParseError::new("unclosed StringTemplate escape", i));
                };
                if text.is_empty() {
                    text_start = i;
                }
                text.push_str(&decode_escape(&src[i + 2..end]));
                i = end + 1;
                continue;
            }
            // An expression / directive tag.
            let Some(end) = find_close(src, i + 1, closeb) else {
                return Err(ParseError::new("unclosed StringTemplate tag", i));
            };
            flush(&mut toks, &mut text, text_start, i);
            toks.push(Tok::Tag {
                span: Span::new(i, end + 1),
                interior: src[i + 1..end].to_string(),
            });
            i = end + 1;
            continue;
        }
        // Ordinary text — copy one char.
        let ch = src[i..]
            .chars()
            .next()
            .expect("byte index on char boundary");
        if text.is_empty() {
            text_start = i;
        }
        text.push(ch);
        i += ch.len_utf8();
    }
    flush(&mut toks, &mut text, text_start, b.len());
    Ok(toks)
}

fn flush(toks: &mut Vec<Tok>, text: &mut String, start: usize, end: usize) {
    if !text.is_empty() {
        toks.push(Tok::Text {
            span: Span::new(start, end),
            text: std::mem::take(text),
        });
    }
}

/// Decode an escape-tag interior (the part after `<\`): `n`, `t`, `r`, a space,
/// `\`, `<`, `>`, or `uXXXX`.
fn decode_escape(inner: &str) -> String {
    match inner {
        "n" => "\n".to_string(),
        "t" => "\t".to_string(),
        "r" => "\r".to_string(),
        " " => " ".to_string(),
        "\\" => "\\".to_string(),
        "<" => "<".to_string(),
        ">" => ">".to_string(),
        _ => {
            if let Some(hex) = inner.strip_prefix('u')
                && let Ok(cp) = u32::from_str_radix(hex, 16)
                && let Some(ch) = char::from_u32(cp)
            {
                return ch.to_string();
            }
            inner.to_string()
        }
    }
}

/// Find the matching close delimiter, skipping `"…"` strings and `{ } ( ) [ ]`
/// nesting (so a `>` inside an anonymous subtemplate does not close the tag).
fn find_close(src: &str, from: usize, closeb: u8) -> Option<usize> {
    let b = src.as_bytes();
    let mut i = from;
    let mut brace = 0i32;
    let mut paren = 0i32;
    let mut brack = 0i32;
    let mut in_str = false;
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
            b'{' => brace += 1,
            b'}' => brace -= 1,
            b'(' => paren += 1,
            b')' => paren -= 1,
            b'[' => brack += 1,
            b']' => brack -= 1,
            _ if c == closeb && brace == 0 && paren == 0 && brack == 0 => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_from(src: &str, from: usize, needle: &str) -> Option<usize> {
    src[from..].find(needle).map(|i| from + i)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lx(s: &str) -> Vec<Tok> {
        lex(s, '<', '>').unwrap()
    }

    #[test]
    fn text_and_expr() {
        let t = lx("Hello <name>!");
        assert!(matches!(&t[0], Tok::Text { text, .. } if text == "Hello "));
        assert!(matches!(&t[1], Tok::Tag { interior, .. } if interior == "name"));
        assert!(matches!(&t[2], Tok::Text { text, .. } if text == "!"));
    }

    #[test]
    fn comment() {
        let t = lx("a<! note > here !>b");
        assert!(matches!(&t[1], Tok::Comment { text, .. } if text == " note > here "));
    }

    #[test]
    fn escapes_in_text() {
        let t = lx(r"a\<b\>c<\n><\ >");
        // `\<` `\>` literalised, `<\n>` → newline, `<\ >` → space, all one text run.
        assert!(matches!(&t[0], Tok::Text { text, .. } if text == "a<b>c\n "));
    }

    #[test]
    fn anon_subtemplate_does_not_close_early() {
        let t = lx("<names:{n | <n.first> }>");
        assert_eq!(t.len(), 1);
        assert!(matches!(&t[0], Tok::Tag { interior, .. } if interior == "names:{n | <n.first> }"));
    }

    #[test]
    fn string_braces_skipped() {
        let t = lx(r#"<f("a>b")>"#);
        assert!(matches!(&t[0], Tok::Tag { interior, .. } if interior == r#"f("a>b")"#));
    }

    #[test]
    fn unclosed_errors() {
        assert!(lex("<name", '<', '>').is_err());
        assert!(lex("<! x", '<', '>').is_err());
    }
}
