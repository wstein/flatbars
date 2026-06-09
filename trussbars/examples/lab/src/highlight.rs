//! Syntax highlighting for the Template pane.
//!
//! tui-textarea has no token-highlight API of its own, but it does expose
//! `custom_highlight(range, style, priority)` — so highlighting is *applied to the editor*
//! (scroll- and selection-correct, drawn by the widget) rather than faked with a separate
//! widget that post-processes the buffer. [`apply`] lexes the template with the engine's
//! own [`trussbars_template::lex`] and colours each `{{ … }}` tag by its sigil.

use ratatui::style::{Color, Style};
use trussbars_template::{Lexeme, Sigil, lex};
use tui_textarea::TextArea;

/// Re-apply syntax highlights to `ta` from its current `text` (clears the previous set).
/// A lex error leaves the editor un-highlighted (no panic).
pub fn apply(ta: &mut TextArea<'static>, text: &str) {
    ta.clear_custom_highlight();
    let Ok(lexemes) = lex(text) else { return };
    for lx in lexemes {
        let (span, style) = match lx {
            Lexeme::Tag { sigil, span, .. } => (span, sigil_style(sigil)),
            Lexeme::RawBlock { span, .. } => (span, Style::new().fg(Color::Magenta)),
            Lexeme::Text(_) => continue,
        };
        ta.custom_highlight((pos(text, span.start), pos(text, span.end)), style, 1);
    }
}

fn sigil_style(sigil: Sigil) -> Style {
    match sigil {
        Sigil::Output | Sigil::Raw => Style::new().fg(Color::Cyan),
        Sigil::Open | Sigil::Close => Style::new().fg(Color::Magenta),
        Sigil::Partial => Style::new().fg(Color::Blue),
        Sigil::Comment => Style::new().fg(Color::DarkGray),
    }
}

/// The `(row, char-column)` of a byte offset into `text` — the coordinate space
/// `TextArea::custom_highlight` expects.
fn pos(text: &str, byte: usize) -> (usize, usize) {
    let mut row = 0;
    let mut col = 0;
    for (i, ch) in text.char_indices() {
        if i >= byte {
            break;
        }
        if ch == '\n' {
            row += 1;
            col = 0;
        } else {
            col += 1;
        }
    }
    (row, col)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pos_maps_bytes_to_row_col() {
        let t = "ab\n{{x}}";
        assert_eq!(pos(t, 0), (0, 0));
        assert_eq!(pos(t, 3), (1, 0)); // start of line 2 ('{')
        assert_eq!(pos(t, 5), (1, 2)); // inside the tag
    }

    #[test]
    fn apply_highlights_without_panicking() {
        // Multibyte content + a recovered lex are both fine.
        let mut ta = TextArea::new(vec![
            "== {{t \"x\"}} ==".into(),
            "{{#each xs}}{{/each}}".into(),
        ]);
        let text = ta.lines().join("\n");
        apply(&mut ta, &text);
        apply(&mut ta, "{{ unterminated");
    }
}
