//! The Handlebars lexer: source → a flat token stream of text runs and tags,
//! handling the `{{!-- … --}}` / `{{! … }}` comments, `{{{{raw}}}}…{{{{/raw}}}}`
//! raw blocks, `{{{ }}}` triple-stache, the `{{~ … ~}}` whitespace-control markers,
//! and the closing-`}}` scan that skips quoted strings and `(…)` / `[…]` nesting.

use crate::{ParseError, Span};

/// A lexed Handlebars token.
#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    /// Literal text between tags.
    Text {
        /// The source span.
        span: Span,
        /// The literal text (mutated by whitespace trimming).
        text: String,
    },
    /// A `{{ … }}` or `{{{ … }}}` tag.
    Tag {
        /// The whole tag span (delimiters included).
        span: Span,
        /// The interior, with the sigil(s) and `~` markers stripped, trimmed.
        interior: String,
        /// `true` for `{{{ }}}` (raw / unescaped).
        raw: bool,
        /// Leading `~` whitespace control.
        left_ws: bool,
        /// Trailing `~` whitespace control.
        right_ws: bool,
    },
    /// A comment (`{{! … }}` or `{{!-- … --}}`).
    Comment {
        /// The whole tag span.
        span: Span,
        /// The comment text.
        text: String,
        /// Leading `~` whitespace control.
        left_ws: bool,
        /// Trailing `~` whitespace control.
        right_ws: bool,
    },
    /// A raw block `{{{{head}}}}body{{{{/head}}}}`.
    RawBlock {
        /// The whole construct span.
        span: Span,
        /// The head interior (helper name + args).
        head: String,
        /// The verbatim body.
        content: String,
    },
}

/// Lex a Handlebars template into its token stream.
///
/// # Errors
/// Returns a [`ParseError`] on an unclosed tag, comment, or raw block.
pub fn lex(src: &str) -> Result<Vec<Tok>, ParseError> {
    let b = src.as_bytes();
    let mut toks = Vec::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while let Some(o) = find_from(src, i, "{{") {
        // Emit pending text.
        if text_start < o {
            toks.push(Tok::Text {
                span: Span::new(text_start, o),
                text: src[text_start..o].to_string(),
            });
        }

        // Raw block: `{{{{`.
        if src[o..].starts_with("{{{{") {
            let (tok, next) = lex_raw_block(src, o)?;
            toks.push(tok);
            i = next;
            text_start = next;
            continue;
        }

        // Comment: `{{!`.
        if src[o..].starts_with("{{!") {
            let (tok, next) = lex_comment(src, o)?;
            toks.push(tok);
            i = next;
            text_start = next;
            continue;
        }

        // Triple `{{{ }}}` vs normal `{{ }}`.
        let raw = src[o..].starts_with("{{{");
        let open_len = if raw { 3 } else { 2 };
        let close = if raw { "}}}" } else { "}}" };
        let content_start = o + open_len;
        let Some(c) = find_tag_close(src, content_start, close) else {
            return Err(ParseError::new("unclosed Handlebars tag", o));
        };
        let full_end = c + close.len();
        let mut interior = &src[content_start..c];

        // Whitespace control `~` at either end.
        let left_ws = interior.starts_with('~');
        if left_ws {
            interior = &interior[1..];
        }
        let right_ws = interior.ends_with('~');
        if right_ws {
            interior = &interior[..interior.len() - 1];
        }

        toks.push(Tok::Tag {
            span: Span::new(o, full_end),
            interior: interior.trim().to_string(),
            raw,
            left_ws,
            right_ws,
        });
        i = full_end;
        text_start = full_end;
        let _ = b; // silence unused in case of empty source
    }

    if text_start < src.len() {
        toks.push(Tok::Text {
            span: Span::new(text_start, src.len()),
            text: src[text_start..].to_string(),
        });
    }
    Ok(toks)
}

fn lex_comment(src: &str, o: usize) -> Result<(Tok, usize), ParseError> {
    // `{{!--` … `--}}` (can contain `}}`), else `{{!` … `}}`.
    let dashed = src[o..].starts_with("{{!--");
    let (open_len, close): (usize, &str) = if dashed { (5, "--}}") } else { (3, "}}") };
    let start = o + open_len;
    let Some(c) = find_from(src, start, close) else {
        return Err(ParseError::new("unclosed Handlebars comment", o));
    };
    let mut text = &src[start..c];
    let full_end = c + close.len();
    // A comment can also carry `~` control on the outer braces (`{{~! … ~}}`); the
    // common dashed form puts it inside: `{{~!-- --~}}`. Detect on the trimmed ends.
    let left_ws = text.starts_with('~');
    if left_ws {
        text = &text[1..];
    }
    let right_ws = text.ends_with('~');
    if right_ws {
        text = &text[..text.len() - 1];
    }
    Ok((
        Tok::Comment {
            span: Span::new(o, full_end),
            text: text.to_string(),
            left_ws,
            right_ws,
        },
        full_end,
    ))
}

fn lex_raw_block(src: &str, o: usize) -> Result<(Tok, usize), ParseError> {
    // `{{{{head}}}}` body `{{{{/head}}}}`.
    let head_start = o + 4;
    let Some(hc) = find_from(src, head_start, "}}}}") else {
        return Err(ParseError::new("unclosed raw-block head", o));
    };
    let head = src[head_start..hc].trim().to_string();
    let body_start = hc + 4;
    // The close repeats the head name: `{{{{/<name>}}}}`.
    let name = head.split_whitespace().next().unwrap_or("");
    let close = format!("{{{{{{{{/{name}}}}}}}}}"); // {{{{/name}}}}
    let Some(bc) = find_from(src, body_start, &close) else {
        return Err(ParseError::new(format!("unclosed raw block `{name}`"), o));
    };
    let content = src[body_start..bc].to_string();
    let full_end = bc + close.len();
    Ok((
        Tok::RawBlock {
            span: Span::new(o, full_end),
            head,
            content,
        },
        full_end,
    ))
}

fn find_from(src: &str, from: usize, needle: &str) -> Option<usize> {
    src[from..].find(needle).map(|i| from + i)
}

/// Find the tag close `needle`, skipping `"…"` / `'…'` strings and `(…)` / `[…]`
/// nesting so a `}}` inside a string or subexpression does not close the tag early.
fn find_tag_close(src: &str, from: usize, needle: &str) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut i = from;
    let mut string: Option<u8> = None;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    while i < bytes.len() {
        let ch = bytes[i];
        if let Some(q) = string {
            if ch == b'\\' {
                i += 2;
                continue;
            }
            if ch == q {
                string = None;
            }
            i += 1;
            continue;
        }
        match ch {
            b'"' | b'\'' => string = Some(ch),
            b'(' => paren += 1,
            b')' => paren -= 1,
            b'[' => bracket += 1,
            b']' => bracket -= 1,
            _ => {
                if paren == 0 && bracket == 0 && src[i..].starts_with(needle) {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_text_and_tags() {
        let t = lex("a{{b}}c").unwrap();
        assert_eq!(t.len(), 3);
        assert!(matches!(&t[1], Tok::Tag { interior, raw: false, .. } if interior == "b"));
    }

    #[test]
    fn triple_is_raw() {
        let t = lex("{{{x}}}").unwrap();
        assert!(matches!(&t[0], Tok::Tag { raw: true, interior, .. } if interior == "x"));
    }

    #[test]
    fn dashed_comment_can_hold_braces() {
        let t = lex("{{!-- a }} b --}}").unwrap();
        assert!(matches!(&t[0], Tok::Comment { text, .. } if text == " a }} b "));
    }

    #[test]
    fn raw_block_body_verbatim() {
        let t = lex("{{{{raw}}}}{{x}}{{{{/raw}}}}").unwrap();
        assert!(
            matches!(&t[0], Tok::RawBlock { head, content, .. } if head == "raw" && content == "{{x}}")
        );
    }

    #[test]
    fn close_skips_string_braces() {
        let t = lex(r#"{{f "}}" }}"#).unwrap();
        assert!(matches!(&t[0], Tok::Tag { interior, .. } if interior == r#"f "}}""#));
    }

    #[test]
    fn ws_control_recorded() {
        let t = lex("{{~ x ~}}").unwrap();
        assert!(
            matches!(&t[0], Tok::Tag { left_ws: true, right_ws: true, interior, .. } if interior == "x")
        );
    }
}
