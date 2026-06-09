//! The Liquid lexer: source → a token stream of text, object outputs `{{ … }}`, and
//! tags `{% … %}`, honoring the `{{- -}}` / `{%- -%}` whitespace-control markers.
//! `{% raw %}` and `{% comment %}` bodies are captured verbatim here (their content
//! is never parsed as Liquid).

use crate::{ParseError, Span};

/// A lexed Liquid token.
#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    /// Literal text between tags.
    Text {
        /// The source span.
        span: Span,
        /// The literal text.
        text: String,
    },
    /// An object output `{{ markup }}`.
    Output {
        /// The whole span.
        span: Span,
        /// The interior markup (trimmed).
        markup: String,
        /// Leading `{{-` control.
        lstrip: bool,
        /// Trailing `-}}` control.
        rstrip: bool,
    },
    /// A tag `{% name markup %}`.
    Tag {
        /// The whole span.
        span: Span,
        /// The tag name (the first word).
        name: String,
        /// The markup after the tag name (trimmed).
        markup: String,
        /// Leading `{%-` control.
        lstrip: bool,
        /// Trailing `-%}` control.
        rstrip: bool,
    },
    /// A verbatim `{% raw %}…{% endraw %}` block.
    Raw {
        /// The whole span (both tags included).
        span: Span,
        /// The verbatim content.
        content: String,
    },
    /// A `{% comment %}…{% endcomment %}` block.
    Comment {
        /// The whole span (both tags included).
        span: Span,
        /// The content.
        content: String,
    },
}

/// Lex a Liquid template into its token stream.
///
/// # Errors
/// Returns a [`ParseError`] on an unclosed output/tag or an unterminated
/// `raw`/`comment` block.
pub fn lex(src: &str) -> Result<Vec<Tok>, ParseError> {
    let mut toks = Vec::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    loop {
        let next_obj = find_from(src, i, "{{");
        let next_tag = find_from(src, i, "{%");
        let o = match (next_obj, next_tag) {
            (None, None) => break,
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (Some(a), Some(b)) => a.min(b),
        };
        if text_start < o {
            toks.push(Tok::Text {
                span: Span::new(text_start, o),
                text: src[text_start..o].to_string(),
            });
        }

        if src[o..].starts_with("{{") {
            let Some(c) = find_from(src, o + 2, "}}") else {
                return Err(ParseError::new("unclosed Liquid output `{{`", o));
            };
            let full_end = c + 2;
            let (markup, lstrip, rstrip) = strip_controls(&src[o + 2..c]);
            toks.push(Tok::Output {
                span: Span::new(o, full_end),
                markup: markup.to_string(),
                lstrip,
                rstrip,
            });
            i = full_end;
            text_start = full_end;
        } else {
            // A `{% … %}` tag.
            let Some(c) = find_from(src, o + 2, "%}") else {
                return Err(ParseError::new("unclosed Liquid tag `{%`", o));
            };
            let full_end = c + 2;
            let (markup, lstrip, rstrip) = strip_controls(&src[o + 2..c]);
            let (name, rest) = split_name(markup);

            if name == "raw" {
                let (content, span) = take_block(src, o, full_end, "endraw")?;
                let end = span.end;
                toks.push(Tok::Raw { span, content });
                i = end;
                text_start = end;
            } else if name == "comment" {
                let (content, span) = take_block(src, o, full_end, "endcomment")?;
                let end = span.end;
                toks.push(Tok::Comment { span, content });
                i = end;
                text_start = end;
            } else {
                toks.push(Tok::Tag {
                    span: Span::new(o, full_end),
                    name: name.to_string(),
                    markup: rest.to_string(),
                    lstrip,
                    rstrip,
                });
                i = full_end;
                text_start = full_end;
            }
        }
    }

    if text_start < src.len() {
        toks.push(Tok::Text {
            span: Span::new(text_start, src.len()),
            text: src[text_start..].to_string(),
        });
    }
    Ok(toks)
}

/// Capture a verbatim block body from after an opening tag (`open_end`) to the next
/// `{% <end_name> %}`, returning the content and the full construct span.
fn take_block(
    src: &str,
    open_start: usize,
    open_end: usize,
    end_name: &str,
) -> Result<(String, Span), ParseError> {
    let mut scan = open_end;
    while let Some(t) = find_from(src, scan, "{%") {
        let Some(c) = find_from(src, t + 2, "%}") else {
            return Err(ParseError::new("unclosed Liquid tag `{%`", t));
        };
        let (markup, _, _) = strip_controls(&src[t + 2..c]);
        let (name, _) = split_name(markup);
        if name == end_name {
            let content = src[open_end..t].to_string();
            return Ok((content, Span::new(open_start, c + 2)));
        }
        scan = c + 2;
    }
    Err(ParseError::new(
        format!("unterminated `{{% {} %}}` block", &end_name[3..]),
        open_start,
    ))
}

/// Strip the `-` whitespace-control markers off an interior, returning the trimmed
/// interior and the two control flags.
fn strip_controls(interior: &str) -> (&str, bool, bool) {
    let mut s = interior;
    let lstrip = s.starts_with('-');
    if lstrip {
        s = &s[1..];
    }
    let rstrip = s.ends_with('-');
    if rstrip {
        s = &s[..s.len() - 1];
    }
    (s.trim(), lstrip, rstrip)
}

/// Split a tag markup into its leading name and the remaining markup.
fn split_name(markup: &str) -> (&str, &str) {
    let markup = markup.trim_start();
    // The inline-comment shorthand `{% # … %}`.
    if let Some(rest) = markup.strip_prefix('#') {
        return ("#", rest.trim());
    }
    match markup.find(|c: char| c.is_whitespace()) {
        Some(i) => (&markup[..i], markup[i..].trim()),
        None => (markup, ""),
    }
}

fn find_from(src: &str, from: usize, needle: &str) -> Option<usize> {
    src[from..].find(needle).map(|i| from + i)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_and_tag() {
        let t = lex("a{{ x }}b{% assign y = 1 %}").unwrap();
        assert!(matches!(&t[0], Tok::Text { text, .. } if text == "a"));
        assert!(matches!(&t[1], Tok::Output { markup, .. } if markup == "x"));
        assert!(
            matches!(&t[3], Tok::Tag { name, markup, .. } if name == "assign" && markup == "y = 1")
        );
    }

    #[test]
    fn whitespace_controls() {
        let t = lex("{{- x -}}{%- if y -%}").unwrap();
        assert!(matches!(
            &t[0],
            Tok::Output {
                lstrip: true,
                rstrip: true,
                ..
            }
        ));
        assert!(matches!(&t[1], Tok::Tag { lstrip: true, rstrip: true, name, .. } if name == "if"));
    }

    #[test]
    fn raw_is_verbatim() {
        let t = lex("{% raw %}{{ x }}{% endraw %}").unwrap();
        assert!(matches!(&t[0], Tok::Raw { content, .. } if content == "{{ x }}"));
    }

    #[test]
    fn comment_block() {
        let t = lex("{% comment %}hi {% if %}{% endcomment %}").unwrap();
        assert!(matches!(&t[0], Tok::Comment { content, .. } if content == "hi {% if %}"));
    }

    #[test]
    fn inline_comment_shorthand() {
        let t = lex("{% # note %}").unwrap();
        assert!(matches!(&t[0], Tok::Tag { name, markup, .. } if name == "#" && markup == "note"));
    }

    #[test]
    fn unclosed_is_error() {
        assert!(lex("{{ x ").is_err());
        assert!(lex("{% if ").is_err());
        assert!(lex("{% raw %}x").is_err());
    }
}
