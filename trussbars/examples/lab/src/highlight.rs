//! Lexer-driven syntax highlighting for the Template pane.
//!
//! Uses the engine's own [`trussbars_template::lex`] — never an approximation — to colour
//! each `{{ … }}` tag by its sigil; literal text is left default.

use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span as TSpan};
use trussbars_template::{Lexeme, Sigil, lex};

/// The template source as styled `ratatui` lines, each tag coloured by sigil. A lex error
/// falls back to plain text.
#[must_use]
pub fn template_lines(src: &str) -> Vec<Line<'static>> {
    let Ok(lexemes) = lex(src) else {
        return segments_to_lines(vec![(src.to_string(), Style::new())]);
    };
    let mut segs: Vec<(String, Style)> = Vec::new();
    for lx in lexemes {
        let (span, style) = match lx {
            Lexeme::Text(s) => (s, Style::new()),
            Lexeme::Tag { sigil, span, .. } => (span, sigil_style(sigil)),
            Lexeme::RawBlock { span, .. } => (span, Style::new().fg(Color::Magenta)),
        };
        if let Some(text) = src.get(span.start..span.end) {
            segs.push((text.to_string(), style));
        }
    }
    segments_to_lines(segs)
}

fn sigil_style(sigil: Sigil) -> Style {
    match sigil {
        Sigil::Output | Sigil::Raw => Style::new().fg(Color::Cyan),
        Sigil::Open | Sigil::Close => Style::new().fg(Color::Magenta),
        Sigil::Partial => Style::new().fg(Color::Blue),
        Sigil::Comment => Style::new().fg(Color::DarkGray),
    }
}

/// Flatten styled segments (which may contain `\n`) into lines, preserving each
/// segment's style.
fn segments_to_lines(segs: Vec<(String, Style)>) -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = vec![Line::default()];
    for (text, style) in segs {
        let mut first = true;
        for part in text.split('\n') {
            if !first {
                lines.push(Line::default());
            }
            first = false;
            if !part.is_empty() {
                lines
                    .last_mut()
                    .unwrap()
                    .spans
                    .push(TSpan::styled(part.to_string(), style));
            }
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_lines_split_on_newlines() {
        let lines = template_lines("a\n{{x}}\n");
        assert_eq!(lines.len(), 3); // "a", "{{x}}", ""
    }

    #[test]
    fn tags_are_styled_distinctly_from_text() {
        // "a" (default) then "{{x}}" (cyan) on one line → two spans, the tag coloured.
        let lines = template_lines("a{{x}}");
        assert_eq!(lines[0].spans.len(), 2);
        assert_eq!(lines[0].spans[1].style.fg, Some(Color::Cyan));
    }
}
