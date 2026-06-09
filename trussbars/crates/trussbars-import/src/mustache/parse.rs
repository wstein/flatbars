//! The Mustache parser (spec v1.4): a delimiter-aware scanner into a flat token
//! stream, the spec's standalone-line whitespace trimming, then a stack-based nest
//! into the [`Node`] tree.
//!
//! Delimiters default to `{{`/`}}` and are re-set by `{{=open close=}}`. Triple-stache
//! `{{{x}}}` is recognised only under the default delimiters (per spec). The standalone
//! rule: a section/inverted/close/comment/partial/parent/block/set-delimiter tag that
//! is the only non-whitespace on its line has the surrounding whitespace and one line
//! ending removed; for a standalone partial the stripped indentation is preserved.

use super::ast::{Name, Node};
use crate::{ParseError, Span};

/// Parse a Mustache template into its node tree.
///
/// # Errors
/// Returns a [`ParseError`] on an unclosed tag, a malformed set-delimiter directive,
/// or a mismatched/unclosed section.
pub fn parse(src: &str) -> Result<Vec<Node>, ParseError> {
    let mut toks = scan(src)?;
    trim_standalone(src, &mut toks);
    build(toks)
}

/// One scanned token (pre-nesting).
#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Text {
        span: Span,
        text: String,
    },
    Var {
        span: Span,
        name: Name,
        escaped: bool,
    },
    Open {
        span: Span,
        name: Name,
        inverted: bool,
    },
    Close {
        span: Span,
        name: String,
    },
    Partial {
        span: Span,
        name: String,
        dynamic: bool,
        indent: String,
    },
    ParentOpen {
        span: Span,
        name: String,
        dynamic: bool,
    },
    BlockOpen {
        span: Span,
        name: String,
    },
    Comment {
        span: Span,
        text: String,
    },
    SetDelim {
        span: Span,
        open: String,
        close: String,
    },
}

impl Tok {
    /// Whether this token participates in standalone-line trimming (interpolations
    /// — `Var` — never do; everything else does).
    fn standalone_eligible(&self) -> bool {
        !matches!(self, Tok::Text { .. } | Tok::Var { .. })
    }

    fn span(&self) -> Span {
        match self {
            Tok::Text { span, .. }
            | Tok::Var { span, .. }
            | Tok::Open { span, .. }
            | Tok::Close { span, .. }
            | Tok::Partial { span, .. }
            | Tok::ParentOpen { span, .. }
            | Tok::BlockOpen { span, .. }
            | Tok::Comment { span, .. }
            | Tok::SetDelim { span, .. } => *span,
        }
    }
}

/// Find the byte offset of `needle` in `src` at or after `from`.
fn find_from(src: &str, from: usize, needle: &str) -> Option<usize> {
    src[from..].find(needle).map(|i| from + i)
}

fn scan(src: &str) -> Result<Vec<Tok>, ParseError> {
    let mut open = String::from("{{");
    let mut close = String::from("}}");
    let mut toks: Vec<Tok> = Vec::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while let Some(o) = find_from(src, i, &open) {
        // Triple-stache only under the default delimiters.
        let triple = open == "{{" && close == "}}" && src[o..].starts_with("{{{");
        let (tag_open, tag_close): (&str, &str) = if triple {
            ("{{{", "}}}")
        } else {
            (open.as_str(), close.as_str())
        };
        let content_start = o + tag_open.len();
        let Some(c) = find_from(src, content_start, tag_close) else {
            return Err(ParseError::new("unclosed Mustache tag", o));
        };
        let content = &src[content_start..c];
        let full_end = c + tag_close.len();
        let span = Span::new(o, full_end);

        // Emit the pending text run.
        if text_start < o {
            toks.push(Tok::Text {
                span: Span::new(text_start, o),
                text: src[text_start..o].to_string(),
            });
        }

        if triple {
            toks.push(Tok::Var {
                span,
                name: Name::parse(content),
                escaped: false,
            });
        } else {
            classify(content, span, &mut toks, &mut open, &mut close)?;
        }

        i = full_end;
        text_start = full_end;
    }

    if text_start < src.len() {
        toks.push(Tok::Text {
            span: Span::new(text_start, src.len()),
            text: src[text_start..].to_string(),
        });
    }
    Ok(toks)
}

/// Classify a non-triple tag's content (between the delimiters) into a [`Tok`],
/// updating the active delimiters on a set-delimiter directive.
fn classify(
    content: &str,
    span: Span,
    toks: &mut Vec<Tok>,
    open: &mut String,
    close: &mut String,
) -> Result<(), ParseError> {
    let trimmed = content.trim();
    // Set-delimiter `{{=<% %>=}}`: content is `=<% %>=`.
    if let Some(inner) = trimmed.strip_prefix('=').and_then(|s| s.strip_suffix('=')) {
        let mut parts = inner.split_whitespace();
        let (Some(no), Some(nc)) = (parts.next(), parts.next()) else {
            return Err(ParseError::new("malformed set-delimiter tag", span.start));
        };
        if parts.next().is_some() {
            return Err(ParseError::new("malformed set-delimiter tag", span.start));
        }
        *open = no.to_string();
        *close = nc.to_string();
        toks.push(Tok::SetDelim {
            span,
            open: no.to_string(),
            close: nc.to_string(),
        });
        return Ok(());
    }

    let first = trimmed.chars().next();
    match first {
        Some('&') => toks.push(Tok::Var {
            span,
            name: Name::parse(&trimmed[1..]),
            escaped: false,
        }),
        Some('#') => toks.push(Tok::Open {
            span,
            name: Name::parse(&trimmed[1..]),
            inverted: false,
        }),
        Some('^') => toks.push(Tok::Open {
            span,
            name: Name::parse(&trimmed[1..]),
            inverted: true,
        }),
        Some('/') => toks.push(Tok::Close {
            span,
            name: trimmed[1..].trim().to_string(),
        }),
        Some('>') => {
            let (name, dynamic) = strip_dynamic(&trimmed[1..]);
            toks.push(Tok::Partial {
                span,
                name,
                dynamic,
                indent: String::new(),
            });
        }
        Some('<') => {
            let (name, dynamic) = strip_dynamic(&trimmed[1..]);
            toks.push(Tok::ParentOpen {
                span,
                name,
                dynamic,
            });
        }
        Some('$') => toks.push(Tok::BlockOpen {
            span,
            name: trimmed[1..].trim().to_string(),
        }),
        Some('!') => toks.push(Tok::Comment {
            // Comment text keeps interior spacing; only the sigil is stripped.
            span,
            text: content.trim_start()[1..].to_string(),
        }),
        _ => toks.push(Tok::Var {
            span,
            name: Name::parse(trimmed),
            escaped: true,
        }),
    }
    Ok(())
}

/// Split an optional dynamic-name `*` sigil off a partial/parent name.
fn strip_dynamic(s: &str) -> (String, bool) {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix('*') {
        (rest.trim().to_string(), true)
    } else {
        (s.to_string(), false)
    }
}

/// Apply the spec's standalone-line trimming to the token stream: each
/// standalone-eligible tag that is alone (modulo whitespace) on its line has the
/// surrounding whitespace and one line ending removed; a standalone partial keeps
/// its stripped indentation.
fn trim_standalone(src: &str, toks: &mut [Tok]) {
    // (text_tok_index, trim_front_bytes, trim_back_bytes)
    let mut front_trims: Vec<(usize, usize)> = Vec::new();
    let mut back_trims: Vec<(usize, usize)> = Vec::new();
    let mut indents: Vec<(usize, String)> = Vec::new();

    for k in 0..toks.len() {
        if !toks[k].standalone_eligible() {
            continue;
        }
        let span = toks[k].span();
        // Left: everything from the byte after the previous '\n' up to the tag start.
        let nl_before = src[..span.start].rfind('\n').map_or(0, |i| i + 1);
        let left_ws = &src[nl_before..span.start];
        if !left_ws.bytes().all(is_inline_ws) {
            continue;
        }
        // Right: everything from the tag end up to (and including) the next '\n' or EOF.
        let after = &src[span.end..];
        let (right_ws, nl_len) = match after.find('\n') {
            Some(n) => (&after[..n], 1),
            None => (after, 0),
        };
        if !right_ws.bytes().all(is_inline_ws) {
            continue;
        }

        // Standalone. Trim the preceding text token's tail (the indentation) and the
        // following text token's head (the trailing whitespace + line ending).
        if !left_ws.is_empty()
            && k > 0
            && let Tok::Text { .. } = toks[k - 1]
        {
            back_trims.push((k - 1, left_ws.len()));
        }
        if let Tok::Partial { .. } = toks[k] {
            indents.push((k, left_ws.to_string()));
        }
        let drop = right_ws.len() + nl_len;
        if drop > 0
            && k + 1 < toks.len()
            && let Tok::Text { .. } = toks[k + 1]
        {
            front_trims.push((k + 1, drop));
        }
    }

    for (k, indent) in indents {
        if let Tok::Partial { indent: slot, .. } = &mut toks[k] {
            *slot = indent;
        }
    }
    for (k, n) in back_trims {
        if let Tok::Text { text, .. } = &mut toks[k] {
            let keep = text.len().saturating_sub(n);
            text.truncate(keep);
        }
    }
    for (k, n) in front_trims {
        if let Tok::Text { text, .. } = &mut toks[k] {
            let n = n.min(text.len());
            text.drain(..n);
        }
    }
}

fn is_inline_ws(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\r'
}

/// Nest the flat token stream into the [`Node`] tree, matching section/parent/block
/// opens against their closes.
fn build(toks: Vec<Tok>) -> Result<Vec<Node>, ParseError> {
    // A stack frame: the open token's kind/name/start and its accumulated children.
    enum Frame {
        Section {
            start: usize,
            name: Name,
            close_name: String,
            inverted: bool,
        },
        Parent {
            start: usize,
            name: String,
            close_name: String,
            dynamic: bool,
        },
        Block {
            start: usize,
            name: String,
        },
    }

    let mut stack: Vec<(Frame, Vec<Node>)> = Vec::new();
    let mut root: Vec<Node> = Vec::new();

    for tok in toks {
        let leaf = match tok {
            Tok::Text { span, text } => {
                // A fully-trimmed standalone line can leave an empty text token; drop it.
                if text.is_empty() {
                    None
                } else {
                    Some(Node::Text { span, text })
                }
            }
            Tok::Var {
                span,
                name,
                escaped,
            } => Some(Node::Variable {
                span,
                name,
                escaped,
            }),
            Tok::Partial {
                span,
                name,
                dynamic,
                indent,
            } => Some(Node::Partial {
                span,
                name,
                dynamic,
                indent,
            }),
            Tok::Comment { span, text } => Some(Node::Comment { span, text }),
            Tok::SetDelim { span, open, close } => Some(Node::SetDelimiter { span, open, close }),
            Tok::Open {
                span,
                name,
                inverted,
            } => {
                let close_name = name_text(&name);
                stack.push((
                    Frame::Section {
                        start: span.start,
                        name,
                        close_name,
                        inverted,
                    },
                    Vec::new(),
                ));
                None
            }
            Tok::ParentOpen {
                span,
                name,
                dynamic,
            } => {
                let close_name = name.clone();
                stack.push((
                    Frame::Parent {
                        start: span.start,
                        name,
                        close_name,
                        dynamic,
                    },
                    Vec::new(),
                ));
                None
            }
            Tok::BlockOpen { span, name } => {
                stack.push((
                    Frame::Block {
                        start: span.start,
                        name,
                    },
                    Vec::new(),
                ));
                None
            }
            Tok::Close { span, name } => {
                let Some((frame, body)) = stack.pop() else {
                    return Err(ParseError::new(
                        format!("unexpected closing `{{{{/{name}}}}}` (no open section)"),
                        span.start,
                    ));
                };
                let node = match frame {
                    Frame::Section {
                        start,
                        name: open_name,
                        close_name,
                        inverted,
                    } => {
                        if close_name != name {
                            return Err(ParseError::new(
                                format!("section `{close_name}` closed by `{name}`"),
                                span.start,
                            ));
                        }
                        Node::Section {
                            span: Span::new(start, span.end),
                            name: open_name,
                            inverted,
                            body,
                        }
                    }
                    Frame::Parent {
                        start,
                        name: open_name,
                        close_name,
                        dynamic,
                    } => {
                        if close_name != name {
                            return Err(ParseError::new(
                                format!("parent `{close_name}` closed by `{name}`"),
                                span.start,
                            ));
                        }
                        Node::Parent {
                            span: Span::new(start, span.end),
                            name: open_name,
                            dynamic,
                            body,
                        }
                    }
                    Frame::Block {
                        start,
                        name: open_name,
                    } => {
                        if open_name != name {
                            return Err(ParseError::new(
                                format!("block `{open_name}` closed by `{name}`"),
                                span.start,
                            ));
                        }
                        Node::Block {
                            span: Span::new(start, span.end),
                            name: open_name,
                            body,
                        }
                    }
                };
                Some(node)
            }
        };

        if let Some(node) = leaf {
            match stack.last_mut() {
                Some((_, body)) => body.push(node),
                None => root.push(node),
            }
        }
    }

    if let Some((frame, _)) = stack.last() {
        let (kind, name, start) = match frame {
            Frame::Section { name, start, .. } => ("section", name_text(name), *start),
            Frame::Parent { name, start, .. } => ("parent", name.clone(), *start),
            Frame::Block { name, start, .. } => ("block", name.clone(), *start),
        };
        return Err(ParseError::new(format!("unclosed {kind} `{name}`"), start));
    }
    Ok(root)
}

/// The dotted-name text used to match a section close (`.` for the implicit iterator).
fn name_text(name: &Name) -> String {
    match name {
        Name::Implicit => ".".to_string(),
        Name::Dotted(segs) => segs.join("."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nodes(src: &str) -> Vec<Node> {
        parse(src).expect("parse")
    }

    #[test]
    fn variable_escaped_and_raw() {
        let n = nodes("{{a}} {{{b}}} {{&c}}");
        assert!(matches!(&n[0], Node::Variable { escaped: true, .. }));
        assert!(matches!(&n[2], Node::Variable { escaped: false, .. }));
        assert!(matches!(&n[4], Node::Variable { escaped: false, .. }));
    }

    #[test]
    fn dotted_and_implicit_names() {
        let n = nodes("{{a.b.c}}{{.}}");
        let Node::Variable { name, .. } = &n[0] else {
            panic!()
        };
        assert_eq!(
            *name,
            Name::Dotted(vec!["a".into(), "b".into(), "c".into()])
        );
        assert!(matches!(
            &n[1],
            Node::Variable {
                name: Name::Implicit,
                ..
            }
        ));
    }

    #[test]
    fn section_and_inverted() {
        let n = nodes("{{#a}}x{{/a}}{{^b}}y{{/b}}");
        assert!(matches!(
            &n[0],
            Node::Section {
                inverted: false,
                ..
            }
        ));
        assert!(matches!(&n[1], Node::Section { inverted: true, .. }));
    }

    #[test]
    fn nested_sections() {
        let n = nodes("{{#a}}{{#b}}z{{/b}}{{/a}}");
        let Node::Section { body, .. } = &n[0] else {
            panic!()
        };
        assert!(matches!(&body[0], Node::Section { .. }));
    }

    #[test]
    fn mismatched_section_is_error() {
        assert!(parse("{{#a}}{{/b}}").is_err());
        assert!(parse("{{#a}}").is_err());
        assert!(parse("{{/a}}").is_err());
    }

    #[test]
    fn comment_preserved() {
        let n = nodes("{{! hello world }}x");
        let Node::Comment { text, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert_eq!(text, " hello world ");
    }

    #[test]
    fn set_delimiter_switches_and_records() {
        let n = nodes("{{=<% %>=}}<%x%>");
        assert!(
            matches!(&n[0], Node::SetDelimiter { open, close, .. } if open == "<%" && close == "%>")
        );
        assert!(matches!(&n[1], Node::Variable { .. }));
    }

    #[test]
    fn partial_dynamic_flag() {
        let n = nodes("{{> foo}}{{>*bar}}");
        assert!(matches!(&n[0], Node::Partial { dynamic: false, name, .. } if name == "foo"));
        assert!(matches!(&n[1], Node::Partial { dynamic: true, name, .. } if name == "bar"));
    }

    #[test]
    fn inheritance_parent_and_block() {
        let n = nodes("{{<base}}{{$title}}def{{/title}}{{/base}}");
        let Node::Parent { body, name, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert_eq!(name, "base");
        assert!(matches!(&body[0], Node::Block { name, .. } if name == "title"));
    }

    #[test]
    fn standalone_section_lines_are_trimmed() {
        // The lines holding `{{#a}}` and `{{/a}}` should vanish, leaving "x\n".
        let n = nodes("{{#a}}\nx\n{{/a}}\n");
        let Node::Section { body, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert_eq!(body.len(), 1);
        assert!(matches!(&body[0], Node::Text { text, .. } if text == "x\n"));
        // No trailing empty text node after the section.
        assert_eq!(n.len(), 1);
    }

    #[test]
    fn standalone_comment_is_trimmed() {
        let n = nodes("a\n  {{! c }}  \nb");
        assert!(matches!(&n[0], Node::Text { text, .. } if text == "a\n"));
        assert!(matches!(&n[1], Node::Comment { .. }));
        assert!(matches!(&n[2], Node::Text { text, .. } if text == "b"));
    }

    #[test]
    fn standalone_partial_keeps_indent() {
        let n = nodes("  {{> p }}\n");
        let Node::Partial { indent, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert_eq!(indent, "  ");
    }

    #[test]
    fn unclosed_tag_is_error() {
        assert!(parse("{{ a ").is_err());
    }
}
