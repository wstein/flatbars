//! A minimal, pure multiline text buffer with a char cursor — the editable model
//! behind the Template and Data panes. Lines are `Vec<char>` so the cursor is a clean
//! char index (correct over the localized output's accented bytes). Pure and
//! unit-tested; the TUI only maps key events onto these operations.

/// An editable text buffer with a `(row, col)` char cursor.
#[derive(Clone, Debug)]
pub struct TextBuffer {
    lines: Vec<Vec<char>>,
    cx: usize, // column, in chars, within the current line
    cy: usize, // row
}

impl TextBuffer {
    /// Seed a buffer from text, cursor at the start. An empty string is one empty line.
    #[must_use]
    pub fn from_text(s: &str) -> Self {
        let mut lines: Vec<Vec<char>> = s.split('\n').map(|l| l.chars().collect()).collect();
        if lines.is_empty() {
            lines.push(Vec::new());
        }
        TextBuffer {
            lines,
            cx: 0,
            cy: 0,
        }
    }

    /// The buffer contents as a single `\n`-joined string.
    #[must_use]
    pub fn text(&self) -> String {
        let mut out = String::new();
        for (i, line) in self.lines.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            out.extend(line.iter());
        }
        out
    }

    /// Each line as an owned `String` (for rendering).
    pub fn rows(&self) -> impl Iterator<Item = String> + '_ {
        self.lines.iter().map(|l| l.iter().collect())
    }

    /// The cursor as `(row, col)`, both char-indexed.
    #[must_use]
    pub fn cursor(&self) -> (usize, usize) {
        (self.cy, self.cx)
    }

    /// Number of lines.
    #[must_use]
    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    pub fn insert_char(&mut self, c: char) {
        self.lines[self.cy].insert(self.cx, c);
        self.cx += 1;
    }

    pub fn insert_newline(&mut self) {
        let tail = self.lines[self.cy].split_off(self.cx);
        self.lines.insert(self.cy + 1, tail);
        self.cy += 1;
        self.cx = 0;
    }

    pub fn backspace(&mut self) {
        if self.cx > 0 {
            self.lines[self.cy].remove(self.cx - 1);
            self.cx -= 1;
        } else if self.cy > 0 {
            let cur = self.lines.remove(self.cy);
            self.cy -= 1;
            self.cx = self.lines[self.cy].len();
            self.lines[self.cy].extend(cur);
        }
    }

    pub fn move_left(&mut self) {
        if self.cx > 0 {
            self.cx -= 1;
        } else if self.cy > 0 {
            self.cy -= 1;
            self.cx = self.lines[self.cy].len();
        }
    }

    pub fn move_right(&mut self) {
        if self.cx < self.lines[self.cy].len() {
            self.cx += 1;
        } else if self.cy + 1 < self.lines.len() {
            self.cy += 1;
            self.cx = 0;
        }
    }

    pub fn move_up(&mut self) {
        if self.cy > 0 {
            self.cy -= 1;
            self.cx = self.cx.min(self.lines[self.cy].len());
        }
    }

    pub fn move_down(&mut self) {
        if self.cy + 1 < self.lines.len() {
            self.cy += 1;
            self.cx = self.cx.min(self.lines[self.cy].len());
        }
    }

    pub fn home(&mut self) {
        self.cx = 0;
    }

    pub fn end(&mut self) {
        self.cx = self.lines[self.cy].len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_text() {
        let b = TextBuffer::from_text("a\nbc\n");
        assert_eq!(b.text(), "a\nbc\n");
        assert_eq!(b.line_count(), 3); // "a", "bc", ""
    }

    #[test]
    fn inserts_and_splits() {
        let mut b = TextBuffer::from_text("ac");
        b.move_right(); // between a and c
        b.insert_char('b');
        assert_eq!(b.text(), "abc");
        assert_eq!(b.cursor(), (0, 2));
        b.insert_newline();
        assert_eq!(b.text(), "ab\nc");
        assert_eq!(b.cursor(), (1, 0));
    }

    #[test]
    fn backspace_merges_lines() {
        let mut b = TextBuffer::from_text("ab\ncd");
        // move to start of line 2
        b.move_down();
        b.home();
        assert_eq!(b.cursor(), (1, 0));
        b.backspace(); // merge
        assert_eq!(b.text(), "abcd");
        assert_eq!(b.cursor(), (0, 2));
    }

    #[test]
    fn cursor_clamps_on_vertical_move() {
        let mut b = TextBuffer::from_text("long line\nx");
        b.end(); // (0, 9)
        b.move_down(); // shorter line → clamp
        assert_eq!(b.cursor(), (1, 1));
    }

    #[test]
    fn handles_multibyte_chars() {
        let mut b = TextBuffer::from_text("Juni");
        b.end();
        b.insert_char('ä');
        assert_eq!(b.text(), "Juniä");
        assert_eq!(b.cursor(), (0, 5));
        b.backspace();
        assert_eq!(b.text(), "Juni");
    }
}
