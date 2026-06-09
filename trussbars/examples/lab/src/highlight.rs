//! Lexer-driven highlighting for the Template pane and bolding for the Output pane.
//!
//! Both use the engine's own [`trussbars_template::lex`] — never an approximation. The
//! Template pane colours each `{{ … }}` tag by its sigil. The Output pane bolds the runs
//! produced by *value interpolation*: since the VM emits no source map, the lab inserts
//! sentinel markers around interpolation tags in the source, renders that, and splits the
//! marked output back into (text, interpolated?) runs.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span as TSpan};
use trussbars_template::{Lexeme, Sigil, lex};

/// Marker inserted at the start of an interpolated run (an ASCII control char that
/// cannot occur in a template literal a user would type for output).
const MARK_OPEN: char = '\u{1}';
/// Marker inserted at the end of an interpolated run.
const MARK_CLOSE: char = '\u{2}';

// ── Template-pane highlighting ───────────────────────────────────────────────

/// The template source as styled `ratatui` lines: each `{{ … }}` tag coloured by sigil,
/// literal text left default. A lex error falls back to plain text.
#[must_use]
pub fn template_lines(src: &str) -> Vec<Line<'static>> {
    let Ok(lexemes) = lex(src) else {
        return plain_lines(src);
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

fn plain_lines(src: &str) -> Vec<Line<'static>> {
    segments_to_lines(vec![(src.to_string(), Style::new())])
}

// ── Output-pane bolding (sentinel provenance) ────────────────────────────────

/// The byte spans of value-interpolation tags — `{{ x }}` (excluding the `else`/`elif`
/// separators) and `{{{ x }}}`. Block opens/closes, partials, and comments are skipped.
#[must_use]
pub fn interpolation_spans(src: &str) -> Vec<(usize, usize)> {
    let Ok(lexemes) = lex(src) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for lx in lexemes {
        if let Lexeme::Tag {
            sigil,
            interior,
            span,
        } = lx
        {
            let interp = match sigil {
                Sigil::Raw => true,
                Sigil::Output => {
                    let inner = src.get(interior.start..interior.end).unwrap_or("").trim();
                    inner != "else" && !inner.starts_with("elif")
                }
                _ => false,
            };
            if interp {
                out.push((span.start, span.end));
            }
        }
    }
    out
}

/// Insert the sentinel markers around each interpolation tag (processed back-to-front so
/// earlier byte offsets stay valid). Tag boundaries are ASCII `{`/`}`, so the offsets are
/// always char boundaries.
#[must_use]
pub fn wrap_interpolations(src: &str, spans: &[(usize, usize)]) -> String {
    let mut spans = spans.to_vec();
    spans.sort_unstable_by_key(|&(start, _)| std::cmp::Reverse(start));
    let mut s = src.to_string();
    for (start, end) in spans {
        s.insert(end, MARK_CLOSE);
        s.insert(start, MARK_OPEN);
    }
    s
}

/// Split marked output into `(text, interpolated?)` runs, stripping the markers.
#[must_use]
pub fn split_runs(marked: &str) -> Vec<(String, bool)> {
    let mut runs = Vec::new();
    let mut cur = String::new();
    let mut interp = false;
    for ch in marked.chars() {
        match ch {
            MARK_OPEN | MARK_CLOSE => {
                if !cur.is_empty() {
                    runs.push((std::mem::take(&mut cur), interp));
                }
                interp = ch == MARK_OPEN;
            }
            _ => cur.push(ch),
        }
    }
    if !cur.is_empty() {
        runs.push((cur, interp));
    }
    runs
}

/// Render `(text, interpolated?)` runs as styled lines: interpolated runs **bold**, an
/// `⟂` rejection line yellow, literal text default.
#[must_use]
pub fn output_lines(runs: &[(String, bool)]) -> Vec<Line<'static>> {
    let segs: Vec<(String, Style)> = runs
        .iter()
        .map(|(text, interp)| {
            let style = if text.starts_with('⟂') {
                Style::new().fg(Color::Yellow)
            } else if *interp {
                Style::new().add_modifier(Modifier::BOLD)
            } else {
                Style::new()
            };
            (text.clone(), style)
        })
        .collect();
    segments_to_lines(segs)
}

// ── shared ───────────────────────────────────────────────────────────────────

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
    fn spans_pick_interpolations_only() {
        let src = "{{t \"x\"}}{{#each xs}}{{name}}{{else}}{{/each}}{{! c }}{{{raw}}}";
        let spans = interpolation_spans(src);
        // {{t "x"}}, {{name}}, {{{raw}}} are interpolations; #each, else, /each, comment not.
        let picked: Vec<&str> = spans.iter().map(|(a, b)| &src[*a..*b]).collect();
        assert_eq!(picked, vec!["{{t \"x\"}}", "{{name}}", "{{{raw}}}"]);
    }

    #[test]
    fn wrap_then_split_roundtrips() {
        let src = "Hi {{name}}!";
        let wrapped = wrap_interpolations(src, &interpolation_spans(src));
        // Pretend the engine rendered it (here the tag passes through verbatim).
        let runs = split_runs(&wrapped);
        assert_eq!(
            runs,
            vec![
                ("Hi ".to_string(), false),
                ("{{name}}".to_string(), true),
                ("!".to_string(), false),
            ]
        );
    }

    #[test]
    fn template_lines_split_on_newlines() {
        let lines = template_lines("a\n{{x}}\n");
        assert_eq!(lines.len(), 3); // "a", "{{x}}", ""
    }
}
