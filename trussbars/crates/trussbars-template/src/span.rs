//! Byte-offset source spans.

/// A half-open byte range `[start, end)` into the template source.
///
/// **Byte offsets, not chars.** They map directly onto `proc_macro2::Span` for the
/// v2 diagnostics (docs/07) and onto the provenance segments for inspect (docs/10),
/// and the delimiter scan only ever splits on ASCII bytes (`{ } # / > !`), so every
/// span boundary is a UTF-8 char boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// Inclusive start byte offset.
    pub start: usize,
    /// Exclusive end byte offset.
    pub end: usize,
}

impl Span {
    /// Construct a span from `[start, end)`.
    #[must_use]
    pub const fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }

    /// The number of bytes the span covers.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.end - self.start
    }

    /// Whether the span is empty (`start == end`).
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.start == self.end
    }

    /// The substring of `src` this span covers.
    #[must_use]
    pub fn of<'a>(&self, src: &'a str) -> &'a str {
        &src[self.start..self.end]
    }

    /// The 1-based `(line, column)` of the span's start within `src` (column in
    /// bytes from the start of the line) — the docs/07 breadcrumb coordinate.
    #[must_use]
    pub fn line_col(&self, src: &str) -> (usize, usize) {
        let before = &src[..self.start];
        let line = 1 + before.bytes().filter(|&b| b == b'\n').count();
        let line_start = before.rfind('\n').map_or(0, |i| i + 1);
        (line, self.start - line_start + 1)
    }
}
