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
    // Lexeme spans are in source order, so one forward `LineCol` pass maps every byte
    // boundary to `(row, col)` — O(chars) total, not O(lexemes × chars).
    let mut lc = LineCol::new(text);
    for lx in lexemes {
        let (span, style) = match lx {
            Lexeme::Tag { sigil, span, .. } => (span, sigil_style(sigil)),
            Lexeme::RawBlock { span, .. } => (span, Style::new().fg(Color::Magenta)),
            Lexeme::Text(_) => continue,
        };
        let (start, end) = (lc.at(span.start), lc.at(span.end));
        ta.custom_highlight((start, end), style, 1);
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

/// Maps **non-decreasing** byte offsets into `text` to the `(row, char-column)` coordinate
/// `TextArea::custom_highlight` expects, in one forward pass. Call [`LineCol::at`] with
/// non-decreasing `byte` values (highlight spans are in source order); it advances the
/// shared char cursor instead of rescanning from the start each time.
struct LineCol<'a> {
    chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    row: usize,
    col: usize,
}

impl<'a> LineCol<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            chars: text.char_indices().peekable(),
            row: 0,
            col: 0,
        }
    }

    /// Advance to `byte` and return the `(row, col)` there.
    fn at(&mut self, byte: usize) -> (usize, usize) {
        while let Some(&(i, ch)) = self.chars.peek() {
            if i >= byte {
                break;
            }
            self.chars.next();
            if ch == '\n' {
                self.row += 1;
                self.col = 0;
            } else {
                self.col += 1;
            }
        }
        (self.row, self.col)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linecol_maps_increasing_bytes_to_row_col() {
        // One forward cursor: `at` must be called with non-decreasing offsets.
        let mut lc = LineCol::new("ab\n{{x}}");
        assert_eq!(lc.at(0), (0, 0));
        assert_eq!(lc.at(3), (1, 0)); // start of line 2 ('{')
        assert_eq!(lc.at(5), (1, 2)); // inside the tag
    }

    #[test]
    fn each_sigil_keeps_its_colour() {
        // The per-sigil contract (a colour regression would otherwise pass silently).
        assert_eq!(sigil_style(Sigil::Output).fg, Some(Color::Cyan));
        assert_eq!(sigil_style(Sigil::Raw).fg, Some(Color::Cyan));
        assert_eq!(sigil_style(Sigil::Open).fg, Some(Color::Magenta));
        assert_eq!(sigil_style(Sigil::Close).fg, Some(Color::Magenta));
        assert_eq!(sigil_style(Sigil::Partial).fg, Some(Color::Blue));
        assert_eq!(sigil_style(Sigil::Comment).fg, Some(Color::DarkGray));
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
