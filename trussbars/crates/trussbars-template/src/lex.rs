//! The Trussbars lexer: a brace-aware scan of the template source into a flat
//! stream of [`Lexeme`]s (text runs and `{{ … }}` tags), each carrying byte
//! [`Span`]s. The lexemes **tile the source exactly** — concatenating their spans
//! reproduces the input — which the parser (and later the provenance map, docs/10)
//! rely on.
//!
//! Brace-aware: the closing `}}` is found at brace/bracket **depth 0**, skipping
//! quoted strings, so a dict/list literal needs no space before the close
//! (`{% for {a: 1} %}` lexes with interior `for {a: 1}`). The raw region
//! `{% raw %}…{% endraw %}` captures its body verbatim.

use crate::span::Span;
use alloc::string::String;
use alloc::vec::Vec;

/// One lexed surface token. Spans are byte offsets into the source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lexeme {
    /// Literal content between tags.
    Text(Span),
    /// A `{{ … }}` tag: the [`Sigil`] gives the form, `interior` is the content
    /// between the opening sigil and the closing braces, `span` covers the braces.
    Tag {
        /// Which `{{`-form this is.
        sigil: Sigil,
        /// The content between the sigil and the closing braces (untrimmed).
        interior: Span,
        /// The whole tag, opening and closing braces included.
        span: Span,
    },
    /// A raw region `{% raw %}body{% endraw %}` — `body` is captured verbatim.
    RawBlock {
        /// The head name (always `raw`).
        head: Span,
        /// The verbatim body between the open and close tags.
        body: Span,
        /// The whole construct, both `{% raw %}` / `{% endraw %}` tags included.
        span: Span,
    },
}

/// The form of a `{{ … }}` tag, distinguished by the opening sigil.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sigil {
    /// `{{ x }}` — escaped output, or a separator (`else`/`elif`); the parser decides.
    /// (Raw/unescaped output is `{{ x | safe }}`, not a separate sigil — ADR-039.)
    Output,
    /// `{%  …  %}` — a block open.
    Open,
    /// `{% end …  %}` — a block close.
    Close,
    /// `{{> … }}` — a partial reference.
    Partial,
    /// `{{! … }}` or `{{!-- … --}}` — a comment (the parser ignores it).
    Comment,
}

/// A lexing failure (an unterminated tag or raw block).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexError {
    /// Human-readable reason.
    pub message: String,
    /// Byte offset where the problem was detected.
    pub at: usize,
}

impl LexError {
    fn new(message: impl Into<String>, at: usize) -> Self {
        Self {
            message: message.into(),
            at,
        }
    }
}

/// Scan `src` into a flat lexeme stream whose spans tile the source exactly.
///
/// # Errors
/// Returns a [`LexError`] for an unterminated tag, comment, or raw block.
pub fn lex(src: &str) -> Result<Vec<Lexeme>, LexError> {
    let b = src.as_bytes();
    let n = b.len();
    let mut out = Vec::new();
    let mut i = 0;
    let mut text_start = 0;
    // Pending right-trim from the *previous* tag's trailing `-}}`/`-%}` marker: when
    // set, the next emitted `Text` has its leading whitespace (newlines included)
    // dropped. The Jinja/Liquid/Django explicit whitespace-control rule (ADR-039 item
    // 3) — see `apply_lead_trim`/`apply_trail_trim`. Composes with `trim_standalone`.
    let mut pending_trail_trim = false;

    while i < n {
        // A tag opens with `{{` (output/block/raw/comment/partial) or, in this native
        // Trussbars dialect, the Django-style statement tag `{%` (docs-19).
        let brace = b[i] == b'{' && i + 1 < n && b[i + 1] == b'{';
        let stmt = b[i] == b'{' && i + 1 < n && b[i + 1] == b'%';
        if !(brace || stmt) {
            i += 1;
            continue;
        }
        // A tag starts here; flush any pending text run first, applying any pending
        // right-trim from the previous tag's `-}}`/`-%}` to this run's start. (With no
        // intervening text the pending right-trim has nothing to trim; it is simply
        // overwritten by this tag's own marker below.)
        if i > text_start {
            let span = apply_trail_trim(b, Span::new(text_start, i), &mut pending_trail_trim);
            push_text(&mut out, span);
        }
        let lex = if stmt {
            lex_statement_tag(b, n, i)?
        } else {
            lex_tag(b, n, i)?
        };
        i = lex.next;
        text_start = i;
        // A leading `{{-`/`{%-` marker retroactively trims the END of the just-pushed
        // `Text` lexeme (drop trailing whitespace, newlines included).
        if lex.lead_trim {
            apply_lead_trim(b, &mut out);
        }
        pending_trail_trim = lex.trail_trim;
        out.push(lex.lexeme);
    }
    if n > text_start {
        let span = apply_trail_trim(b, Span::new(text_start, n), &mut pending_trail_trim);
        push_text(&mut out, span);
    }
    Ok(out)
}

/// Push a `Text` lexeme unless its span is empty (an all-trimmed run leaves nothing,
/// mirroring the PureScript `flush` which drops a now-empty content string).
fn push_text(out: &mut Vec<Lexeme>, span: Span) {
    if span.end > span.start {
        out.push(Lexeme::Text(span));
    }
}

/// Apply a pending trailing `-}}`/`-%}` trim to a text run's START: drop leading
/// whitespace (newlines included). Clears the pending flag. A span-only shrink to a
/// sub-span (like `trim_standalone`), safe on byte boundaries.
fn apply_trail_trim(b: &[u8], span: Span, pending: &mut bool) -> Span {
    if !*pending {
        return span;
    }
    *pending = false;
    let mut lo = span.start;
    while lo < span.end && b[lo].is_ascii_whitespace() {
        lo += 1;
    }
    Span::new(lo, span.end)
}

/// Apply a leading `{{-`/`{%-` trim to the END of the just-pushed `Text` lexeme (if
/// the last lexeme is `Text`): drop trailing whitespace (newlines included). If the
/// shrink empties the run, the `Text` lexeme is removed (mirroring `flush`).
fn apply_lead_trim(b: &[u8], out: &mut Vec<Lexeme>) {
    if let Some(&Lexeme::Text(span)) = out.last() {
        let mut hi = span.end;
        while hi > span.start && b[hi - 1].is_ascii_whitespace() {
            hi -= 1;
        }
        if hi > span.start {
            *out.last_mut().unwrap() = Lexeme::Text(Span::new(span.start, hi));
        } else {
            out.pop();
        }
    }
}

struct Lexed {
    lexeme: Lexeme,
    next: usize,
    /// A `-` glued to the opening sigil (`{{-`/`{%-`): trim the preceding text's end.
    lead_trim: bool,
    /// A `-` glued to the closing braces (`-}}`/`-%}`): trim the following text's start.
    trail_trim: bool,
}

// ── Standalone-line whitespace trimming (Handlebars/MaxBars) ──────────────────

/// Strip the line a "standalone" tag sits on: when a block open/close, a comment,
/// or a clause separator (`else`/`elif`) is alone on its line (only whitespace from
/// the previous newline up to it, and only whitespace after it to the next newline),
/// remove that indentation and the trailing newline so the tag leaves no blank line.
///
/// A faithful port of the PureScript `FlatBars.Lexer.trimStandalone` (Lexer.purs):
/// block opens/closes (`{% … %}` / `{% end… %}`) and comments are always eligible; output
/// tags (`{{ }}`, incl. `{{ x | safe }}`) and partials never are; a `{{ }}` tag is eligible only
/// when its head word is `else`/`elif` (a clause marker — so `{% else %}` strips but an
/// arbitrary `{{ x }}` does not). It only adjusts `Text` spans (shrinking off the
/// leading line after a standalone tag and the trailing indent before one), so the
/// result is still a sub-span of the source — output stays byte-identical to v1.
pub fn trim_standalone(src: &str, lexemes: &mut [Lexeme]) {
    let n = lexemes.len();
    // Precompute per-index standalone-ness so the scan is a simple lookup.
    let standalone: Vec<bool> = (0..n).map(|i| standalone_at(src, lexemes, i)).collect();
    for j in 0..n {
        let Lexeme::Text(span) = lexemes[j] else {
            continue;
        };
        let (mut lo, hi) = (span.start, span.end);
        let mut end = hi;
        // The tag *before* this text is standalone ⇒ drop this text's leading line.
        if j > 0 && standalone[j - 1] {
            lo = match src[lo..hi].find('\n') {
                Some(k) => lo + k + 1,
                None => hi, // no newline ⇒ trailing EOF whitespace, dropped whole
            };
        }
        // The tag *after* this text is standalone ⇒ drop this text's trailing indent.
        if j + 1 < n && standalone[j + 1] {
            end = match src[lo..end].rfind('\n') {
                Some(k) => lo + k + 1, // keep up to and including the newline
                None => lo,            // all indentation on the first line, dropped whole
            };
        }
        lexemes[j] = Lexeme::Text(Span::new(lo, end));
    }
}

/// Whether the lexeme at `i` is a standalone tag: eligible AND its line is blank on
/// both sides (scanning through wholly-blank text runs, stopping at any other tag).
fn standalone_at(src: &str, lexemes: &[Lexeme], i: usize) -> bool {
    eligible(src, &lexemes[i]) && left_blank(src, lexemes, i) && right_blank(src, lexemes, i)
}

/// Standalone-eligible: a block open/close, a comment, or a `{{ }}` tag whose head
/// word is a clause separator (`else`/`elif`). Partials and real output never are.
fn eligible(src: &str, l: &Lexeme) -> bool {
    match l {
        Lexeme::Tag {
            sigil: Sigil::Open | Sigil::Close | Sigil::Comment,
            ..
        } => true,
        Lexeme::Tag {
            sigil: Sigil::Output,
            interior,
            ..
        } => {
            let head = interior.of(src).trim_start();
            let head = head.split(|c: char| c.is_whitespace()).next().unwrap_or("");
            // `else`/`elif` split an `if`; `when` splits a `{% case %}` (docs/12).
            head == "else" || head == "elif" || head == "when"
        }
        _ => false,
    }
}

/// Everything from the previous newline (or start of input) up to the tag at `i` is
/// blank. Scans *through* wholly-blank text runs but stops at any other tag.
fn left_blank(src: &str, lexemes: &[Lexeme], i: usize) -> bool {
    let mut k = i;
    while k > 0 {
        k -= 1;
        match &lexemes[k] {
            Lexeme::Text(span) => {
                let s = span.of(src);
                if let Some(idx) = s.rfind('\n') {
                    return s[idx + 1..].chars().all(char::is_whitespace); // reached this line's start
                } else if s.chars().all(char::is_whitespace) {
                    continue; // a wholly-blank run; keep scanning left
                } else {
                    return false; // visible text on this line
                }
            }
            _ => return false, // another tag on this line ⇒ not standalone
        }
    }
    true // start of input
}

/// Everything from the tag at `i` to the next newline (or end of input) is blank.
/// Scans *through* wholly-blank text runs but stops at any other tag.
fn right_blank(src: &str, lexemes: &[Lexeme], i: usize) -> bool {
    let mut k = i + 1;
    while k < lexemes.len() {
        match &lexemes[k] {
            Lexeme::Text(span) => {
                let s = span.of(src);
                if let Some(idx) = s.find('\n') {
                    return s[..idx].chars().all(char::is_whitespace); // reached this line's end
                } else if s.chars().all(char::is_whitespace) {
                    k += 1; // a wholly-blank run; keep scanning right
                } else {
                    return false; // visible text on this line
                }
            }
            _ => return false, // another tag on this line ⇒ not standalone
        }
    }
    true // end of input
}

/// Detect and strip explicit whitespace-control `-` markers from a tag's raw content
/// range `[inner, close)` (just past the sigil, up to the closing braces). A `-`
/// **glued** to the opening sigil (`b[inner] == '-'`) is a lead-trim; a `-` glued to
/// the closing braces (`b[close-1] == '-'`, still inside the content) is a trail-trim
/// — the Jinja/Liquid/Django rule (ADR-039 item 3). Returns the inner range with the
/// marker bytes excluded, plus `(lead_trim, trail_trim)`, so the subsequent
/// `trim_span` never sees the `-` (`{%- if x -%}` ⇒ interior `if x`). A spaced `-`
/// (`{{ a - b }}`, `{{ -x }}`) is NOT glued and never trims — it stays in the
/// interior as an operator. Mirrors the PureScript `splitTrims`/`leadTrimAt`.
fn strip_trim_markers(b: &[u8], inner: usize, close: usize) -> (usize, usize, bool, bool) {
    let mut lo = inner;
    let mut hi = close;
    let lead = lo < hi && b[lo] == b'-';
    if lead {
        lo += 1;
    }
    // The trailing `-` must still be inside the (possibly lead-stripped) content, so a
    // single `-` interior cannot count as both a lead and a trail marker.
    let trail = hi > lo && b[hi - 1] == b'-';
    if trail {
        hi -= 1;
    }
    (lo, hi, lead, trail)
}

/// Lex one tag beginning at `i` (where `b[i..i+2] == "{{"`).
fn lex_tag(b: &[u8], n: usize, i: usize) -> Result<Lexed, LexError> {
    // PURE grammar (ADR-039): the four-brace raw block `{{{{#raw}}}}…{{{{/raw}}}}` is NOT
    // recognized — a verbatim region is `{% raw %}…{% endraw %}` (lexed in
    // `lex_statement_tag`). A stray `{{{{` falls through to the two-brace handling below.
    // PURE grammar (ADR-039): the three-brace raw-output sigil `{{{ … }}}` is NOT
    // recognized — raw (un-escaped) output is the `safe` filter, `{{ x | safe }}`. A
    // stray `{{{` falls through to the two-brace handling below and fails as a plain
    // parse error; there is no compat mapping.
    // Two-brace tag: the byte after `{{` selects the sigil. PURE native dialect
    // (ADR-039): `{{ … }}` is OUTPUT-ONLY. No Handlebars holdovers — the legacy
    // block-open/close (`{{#`/`{{/`) AND the partial reference `{{> name}}` are NOT
    // recognized here (a partial include is `{% include "name" %}`); such a tag falls
    // through to an ordinary (and invalid) output expression — a plain parse error, no
    // compat mapping. Only `{{! … }}` (comment) remains a two-brace metadata sigil.
    let c = b.get(i + 2).copied();
    let (sigil, sig_len) = match c {
        Some(b'!') => (Sigil::Comment, 1),
        _ => (Sigil::Output, 0),
    };
    // Long comment `{{!-- … --}}` ends at `--}}`. Comments do not take `-` trim markers
    // (the `--` close would falsely trip the detector), so no trimming here.
    if sigil == Sigil::Comment && at(b, i + 2, b"!--") {
        let inner = i + 5;
        let close = find_seq(b, n, inner, b"--}}")
            .ok_or_else(|| LexError::new("unterminated `{{!-- … --}}` comment", i))?;
        return Ok(Lexed {
            lexeme: Lexeme::Tag {
                sigil: Sigil::Comment,
                interior: Span::new(inner, close),
                span: Span::new(i, close + 4),
            },
            next: close + 4,
            lead_trim: false,
            trail_trim: false,
        });
    }
    let inner = i + 2 + sig_len;
    let close = find_close(b, n, inner, 2)?;
    // Explicit whitespace control `{{- … -}}` (output / partial / short comment). The
    // marker is the `-` glued to the inner braces; a spaced `-` stays an operator.
    let (ts, te, lead_trim, trail_trim) = strip_trim_markers(b, inner, close);
    Ok(Lexed {
        lexeme: Lexeme::Tag {
            sigil,
            interior: Span::new(ts, te),
            span: Span::new(i, close + 2),
        },
        next: close + 2,
        lead_trim,
        trail_trim,
    })
}

/// Lex a Django-style statement tag `{% head args %}` (docs-19) into the SAME
/// [`Lexeme::Tag`] its `{{ … }}` counterpart yields, so the parser, desugar, emitter,
/// and VM never see `{% %}` — a faithful port of `FlatBars.Lexer.readStatementTag`:
///
/// * `{% endX %}` → [`Sigil::Close`] naming `X` (the interior is the substring *after*
///   the `end` prefix — e.g. `endfor` carries the `for` it spans).
/// * `{% else %}` / `{% elif … %}` / `{% when … %}` → [`Sigil::Output`], which the parser
///   already splits into a clause (`Stop::Else` / `ElseIf` / `When`), exactly as `{% else %}`.
/// * anything else (`{% if … %}`, `{% for … %}`, `{% local … %}`, host block heads) →
///   [`Sigil::Open`].
///
/// The `%}` close is found brace-aware (depth 0, strings skipped), like `{{ }}`.
fn lex_statement_tag(b: &[u8], n: usize, i: usize) -> Result<Lexed, LexError> {
    let inner = i + 2; // past `{%`
    let close = find_stmt_close(b, n, inner)?; // index of `%` in the closing `%}`
    let end = close + 2; // past `%}`
    let span = Span::new(i, end);
    // Explicit whitespace control `{%- … -%}` (ADR-039 item 3): strip the glued `-`
    // markers from the raw content BEFORE trimming whitespace, so `{%- if x -%}` parses
    // as `if x`, not `- if x -`. A spaced `-` (`{% set n = a - b %}`) is not glued and
    // stays an operator.
    let (cs, ce, lead_trim, trail_trim) = strip_trim_markers(b, inner, close);
    // The non-whitespace content bounds and its leading head word.
    let (ts, te) = trim_span(b, cs, ce);
    if ts == te {
        return Err(LexError::new("empty statement tag `{% %}`", i));
    }
    let hw_end = (ts..te).find(|&k| b[k].is_ascii_whitespace()).unwrap_or(te);
    let head = &b[ts..hw_end];
    // `{% endX %}` — a close whose name is the `X` after `end` (length > 3, so a bare
    // `{% end %}` is an ordinary head, matching the PureScript `isStmtClose`).
    if head.len() > 3 && &head[..3] == b"end" {
        return Ok(Lexed {
            lexeme: Lexeme::Tag {
                sigil: Sigil::Close,
                interior: Span::new(ts + 3, hw_end),
                span,
            },
            next: end,
            lead_trim,
            trail_trim,
        });
    }
    // `{% raw %}…{% endraw %}` — a verbatim region (ADR-039 item 2): capture the body
    // untouched into a `RawBlock` (the only raw-region form — there is no `{{{{ }}}}`
    // quad-stache). Only the bare head `raw` (no args) opens a region; `{% raw … %}`
    // with args is not one.
    if &b[ts..te] == b"raw" {
        let body_start = end;
        let (body_end, close_end) = find_endraw(b, n, body_start)
            .ok_or_else(|| LexError::new("unterminated `{% raw %}` (no `{% endraw %}`)", i))?;
        return Ok(Lexed {
            lexeme: Lexeme::RawBlock {
                head: Span::new(ts, te),
                body: Span::new(body_start, body_end),
                span: Span::new(i, close_end),
            },
            next: close_end,
            // `{%- raw %}` trims preceding whitespace; the body is verbatim and the
            // trailing edge is not trimmed — matching the PureScript `readRawBody`
            // (`trimL` from the opening, `trimR = false`) so interpreter ≡ compiled.
            lead_trim,
            trail_trim: false,
        });
    }
    // `{% include "name" [ctx] %}` → a partial reference (ADR-039 item 5): the same
    // `Node::Partial` the retired `{{> name …}}` produced. The interior is the args
    // after `include` (the quoted name + optional context/hash).
    if head == b"include" {
        let args_start = (hw_end..te)
            .find(|&k| !b[k].is_ascii_whitespace())
            .unwrap_or(te);
        return Ok(Lexed {
            lexeme: Lexeme::Tag {
                sigil: Sigil::Partial,
                interior: Span::new(args_start, te),
                span,
            },
            next: end,
            lead_trim,
            trail_trim,
        });
    }
    // A clause separator — and the block-partial slot `{% yield %}` (ADR-039 item 5,
    // the parser maps the bare `yield` to `Node::Yield`) — lexes to `Output`; every
    // other head opens a block.
    let sigil = if head == b"else" || head == b"elif" || head == b"when" || head == b"yield" {
        Sigil::Output
    } else {
        Sigil::Open
    };
    Ok(Lexed {
        lexeme: Lexeme::Tag {
            sigil,
            interior: Span::new(ts, te),
            span,
        },
        next: end,
        lead_trim,
        trail_trim,
    })
}

/// Scan for the first `{% endraw %}` from `start`. Returns `(body_end, close_end)`:
/// `body_end` is the `{%` of the endraw tag, `close_end` is just past its `%}`. A
/// `{% … %}` that is not `endraw` (and a `{%` with no `%}`) is verbatim body, scanned
/// past — `{% raw %}` does not nest (the first `{% endraw %}` closes it, like Liquid).
fn find_endraw(b: &[u8], n: usize, start: usize) -> Option<(usize, usize)> {
    let mut j = start;
    while j < n {
        if b[j] == b'{'
            && j + 1 < n
            && b[j + 1] == b'%'
            && let Ok(q) = find_stmt_close(b, n, j + 2)
        {
            let (ts, te) = trim_span(b, j + 2, q);
            if &b[ts..te] == b"endraw" {
                return Some((j, q + 2));
            }
            j = q + 2;
            continue;
        }
        j += 1;
    }
    None
}

/// The non-whitespace sub-range of `b[lo..hi]` (ASCII-whitespace trimmed both ends).
fn trim_span(b: &[u8], lo: usize, hi: usize) -> (usize, usize) {
    let mut s = lo;
    let mut e = hi;
    while s < e && b[s].is_ascii_whitespace() {
        s += 1;
    }
    while e > s && b[e - 1].is_ascii_whitespace() {
        e -= 1;
    }
    (s, e)
}

/// Find the closing `%}` of a statement tag at brace/bracket depth 0, skipping quoted
/// strings — so a dict/list literal's own `}`/`]` (`{% scope {a: {b: 1}} %}`) and a `%}`
/// inside a string never end the tag. Returns the index of the `%`.
fn find_stmt_close(b: &[u8], n: usize, start: usize) -> Result<usize, LexError> {
    let mut depth: i32 = 0;
    let mut j = start;
    while j < n {
        if depth == 0 && b[j] == b'%' && j + 1 < n && b[j + 1] == b'}' {
            return Ok(j);
        }
        match b[j] {
            b'"' | b'\'' => j = skip_string(b, n, j),
            b'{' | b'[' => {
                depth += 1;
                j += 1;
            }
            b'}' | b']' if depth > 0 => {
                depth -= 1;
                j += 1;
            }
            _ => j += 1,
        }
    }
    Err(LexError::new("unterminated statement tag `{% … %}`", start))
}

/// Find the closing run of `n_braces` `}` at brace/bracket depth 0, starting at
/// `start`, skipping quoted strings. Returns the index of the first close brace.
fn find_close(b: &[u8], n: usize, start: usize, n_braces: usize) -> Result<usize, LexError> {
    let mut depth: i32 = 0;
    let mut j = start;
    while j < n {
        if depth == 0 && is_run(b, n, j, b'}', n_braces) {
            return Ok(j);
        }
        match b[j] {
            b'"' | b'\'' => j = skip_string(b, n, j),
            b'{' | b'[' => {
                depth += 1;
                j += 1;
            }
            b'}' | b']' if depth > 0 => {
                depth -= 1;
                j += 1;
            }
            _ => j += 1,
        }
    }
    Err(LexError::new("unterminated tag (no closing braces)", start))
}

/// Skip a quoted string starting at `j` (a `"` or `'`), honoring `\` escapes.
/// Returns the index just past the closing quote (or `n` if unterminated).
fn skip_string(b: &[u8], n: usize, j: usize) -> usize {
    let quote = b[j];
    let mut k = j + 1;
    while k < n {
        match b[k] {
            b'\\' => k += 2,
            c if c == quote => return k + 1,
            _ => k += 1,
        }
    }
    n
}

/// Whether `b[at..]` begins with `n` copies of byte `c`.
fn is_run(b: &[u8], n: usize, at: usize, c: u8, count: usize) -> bool {
    at + count <= n && (0..count).all(|k| b[at + k] == c)
}

/// Whether `b[at..]` begins with `pat`.
fn at(b: &[u8], at: usize, pat: &[u8]) -> bool {
    b.len() >= at + pat.len() && &b[at..at + pat.len()] == pat
}

/// Find `pat` in `b[start..]`, returning its start index.
fn find_seq(b: &[u8], n: usize, start: usize, pat: &[u8]) -> Option<usize> {
    if pat.is_empty() || start + pat.len() > n {
        return None;
    }
    (start..=n - pat.len()).find(|&k| &b[k..k + pat.len()] == pat)
}

#[cfg(test)]
mod tests {
    use super::{Lexeme, Sigil, lex};

    /// Concatenating every lexeme's span must reproduce the source exactly.
    fn assert_round_trip(src: &str) {
        let lexemes = lex(src).expect("lex");
        let mut s = String::new();
        for l in &lexemes {
            let span = match l {
                Lexeme::Text(sp)
                | Lexeme::Tag { span: sp, .. }
                | Lexeme::RawBlock { span: sp, .. } => *sp,
            };
            s.push_str(span.of(src));
        }
        assert_eq!(s, src, "lexemes must tile the source");
    }

    fn sigils(src: &str) -> Vec<Sigil> {
        lex(src)
            .unwrap()
            .into_iter()
            .filter_map(|l| match l {
                Lexeme::Tag { sigil, .. } => Some(sigil),
                _ => None,
            })
            .collect()
    }

    fn interiors(src: &str) -> Vec<String> {
        lex(src)
            .unwrap()
            .into_iter()
            .filter_map(|l| match l {
                Lexeme::Tag { interior, .. } => Some(interior.of(src).to_string()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn plain_output_and_text() {
        assert_eq!(sigils("Hi {{name}}!"), vec![Sigil::Output]);
        assert_eq!(interiors("Hi {{name}}!"), vec!["name"]);
        assert_round_trip("Hi {{name}}!");
    }

    #[test]
    fn all_two_brace_sigils() {
        let s = "{{x}}{% for xs %}{% endfor %}{{! c }}";
        assert_eq!(
            sigils(s),
            vec![Sigil::Output, Sigil::Open, Sigil::Close, Sigil::Comment]
        );
        assert_round_trip(s);
    }

    #[test]
    fn raw_output_is_the_safe_filter() {
        // PURE grammar (ADR-039): raw/unescaped output is `{{ x | safe }}`, an ordinary
        // `Output` tag whose interior carries the `| safe` pipe — there is no `{{{ }}}`
        // raw sigil. (`safe` marks the value; the escaper passes it through.)
        assert_eq!(sigils("{{ html | safe }}"), vec![Sigil::Output]);
        assert_eq!(interiors("{{ html | safe }}"), vec![" html | safe "]);
        assert_round_trip("{{ html | safe }}");
    }

    #[test]
    fn brace_aware_dict_needs_no_space() {
        // The dict's `}` must not be mistaken for the tag close.
        let s = "{% for {a: 1, b: 2} %}{{this}}{% endfor %}";
        assert_eq!(interiors(s)[0], "for {a: 1, b: 2}");
        assert_round_trip(s);
    }

    #[test]
    fn list_literal_brackets() {
        let s = "{% for [1, 2, 3] %}{{this}}{% endfor %}";
        assert_eq!(interiors(s)[0], "for [1, 2, 3]");
        assert_round_trip(s);
    }

    #[test]
    fn close_inside_string_is_skipped() {
        let s = r#"{{replace x "}}" "_"}}"#;
        assert_eq!(interiors(s), vec![r#"replace x "}}" "_""#]);
        assert_round_trip(s);
    }

    #[test]
    fn long_comment() {
        let s = "a {{!-- a }} comment --}} b";
        assert_eq!(sigils(s), vec![Sigil::Comment]);
        assert_eq!(interiors(s), vec![" a }} comment "]);
        assert_round_trip(s);
    }

    #[test]
    fn liquid_loop_and_let_round_trip() {
        assert_round_trip("{% for post i in posts label outer %}{{post.title}}{% endfor %}");
        assert_round_trip("{% let a=(multiply x y) b=(add a 1) %}{{a}}/{{b}}{% endlet %}");
    }

    #[test]
    fn unterminated_tag_errors() {
        assert!(lex("ok {{oops").is_err());
        assert!(lex("{% raw %}no close").is_err());
    }

    // ── Django-style statement tags `{% … %}` (docs-19) ──────────────────────────

    /// The (sigil, interior) of every `Tag` lexeme — the structural projection the
    /// parser consumes. `{% %}` and `{{ }}` must reduce to the same pairs.
    fn tags(src: &str) -> Vec<(Sigil, String)> {
        lex(src)
            .unwrap()
            .into_iter()
            .filter_map(|l| match l {
                Lexeme::Tag {
                    sigil, interior, ..
                } => Some((sigil, interior.of(src).to_string())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn statement_tag_open_close_sigils() {
        // `{% for xs %}` opens (interior = the trimmed head+args), `{% endfor %}` closes
        // naming `for` (the substring after `end`).
        assert_eq!(
            tags("{% for xs %}{{this}}{% endfor %}"),
            vec![
                (Sigil::Open, "for xs".to_string()),
                (Sigil::Output, "this".to_string()),
                (Sigil::Close, "for".to_string()),
            ]
        );
        assert_round_trip("{% for xs %}{{this}}{% endfor %}");
    }

    #[test]
    fn statement_tag_clause_separators_are_output() {
        // `else`/`elif`/`when` lex to `Output` (the parser splits the clause), like `{% else %}`.
        // (The `A`/`B`/`C` bodies are `Text`, filtered out by `tags`.)
        assert_eq!(
            tags("{% if a %}A{% elif b %}B{% else %}C{% endif %}"),
            vec![
                (Sigil::Open, "if a".to_string()),
                (Sigil::Output, "elif b".to_string()),
                (Sigil::Output, "else".to_string()),
                (Sigil::Close, "if".to_string()),
            ]
        );
    }

    #[test]
    fn statement_tag_reduces_like_brace_tag() {
        // The structural token stream of the `{% %}` and `{%   %}` spellings is identical
        // (modulo the `let`→`local` head rename), so the parser/engine are unchanged.
        let pct = tags("{% for x in xs %}{{x}}{% endfor %}");
        let brace = tags("{% for x in xs %}{{x}}{% endfor %}");
        assert_eq!(pct, brace);
    }

    #[test]
    fn statement_tag_brace_aware_close() {
        // A dict literal's own `}` (and a `%}` inside a string) must not end the tag.
        assert_eq!(
            tags("{% scope {a: {b: 1}} %}{{a.b}}{% endscope %}")[0],
            (Sigil::Open, "scope {a: {b: 1}}".to_string())
        );
        assert_eq!(
            tags(r#"{% if (eq s "%}") %}x{% endif %}"#)[0],
            (Sigil::Open, r#"if (eq s "%}")"#.to_string())
        );
        assert_round_trip("{% scope {a: {b: 1}} %}{{a.b}}{% endscope %}");
    }

    #[test]
    fn statement_tag_standalone_lines_trim() {
        // A `{% for %}`/`{% endfor %}` alone on its line leaves no blank line — the
        // same standalone rule as `{% for %}` (the sigils drive `trim_standalone`).
        assert_eq!(
            trimmed_text("a\n{% for xs %}\n-\n{% endfor %}\nb\n"),
            "a\n-\nb\n"
        );
    }

    #[test]
    fn empty_or_unterminated_statement_tag_errors() {
        assert!(lex("{%  %}").is_err()); // empty
        assert!(lex("ok {% for xs no close").is_err()); // no `%}`
    }

    #[test]
    fn include_and_yield_statement_tags() {
        // `{% include "name" [ctx] %}` → a `Partial` sigil (interior = the args after
        // `include`); `{% yield %}` → `Output "yield"` (the parser makes it `Node::Yield`).
        // ADR-039 item 5 — the same nodes the retired `{{> name}}` / `{{yield}}` produced.
        assert_eq!(
            tags(r#"{% include "card" sec %}"#),
            vec![(Sigil::Partial, r#""card" sec"#.to_string())]
        );
        assert_eq!(
            tags("{% include \"row\" %}"),
            vec![(Sigil::Partial, "\"row\"".to_string())]
        );
        assert_eq!(
            tags("{% yield %}"),
            vec![(Sigil::Output, "yield".to_string())]
        );
        // PURE grammar (ADR-039): the legacy partial sigil `{{> }}` is NOT recognized —
        // it lexes as an ordinary (and invalid) output, a plain parse error downstream.
        // A partial include is `{% include "name" %}` only.
        assert_eq!(
            tags("{{> row}}"),
            vec![(Sigil::Output, "> row".to_string())]
        );
    }

    #[test]
    fn raw_region_captures_body_verbatim() {
        // `{% raw %}…{% endraw %}` (ADR-039 item 2) is a `RawBlock` whose body is
        // verbatim — a nested `{{x}}` / `{% if %}` is literal text, not a tag.
        let s = "A{% raw %}Literal {{x}} {% if z %}b{% endif %}{% endraw %}B";
        let ls = lex(s).unwrap();
        let raw = ls
            .iter()
            .find_map(|l| match l {
                Lexeme::RawBlock { head, body, .. } => Some((head.of(s), body.of(s))),
                _ => None,
            })
            .expect("a RawBlock lexeme");
        assert_eq!(raw.0, "raw");
        assert_eq!(raw.1, "Literal {{x}} {% if z %}b{% endif %}");
        assert_round_trip(s);
        // whitespace-tolerant open/close; an unterminated region errors.
        assert!(matches!(
            lex("{%  raw  %}x{%  endraw  %}").unwrap()[0],
            Lexeme::RawBlock { .. }
        ));
        assert!(lex("{% raw %}no close").is_err());
    }

    /// The text payload after `trim_standalone`, concatenated (tags render nothing).
    fn trimmed_text(src: &str) -> String {
        let mut ls = lex(src).unwrap();
        super::trim_standalone(src, &mut ls);
        ls.iter()
            .filter_map(|l| match l {
                Lexeme::Text(sp) => Some(sp.of(src)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn standalone_block_tags_leave_no_blank_line() {
        // The `{% for %}` / `{% endfor %}` lines (alone on their line) are stripped whole.
        assert_eq!(
            trimmed_text("a\n{% for xs %}\n-\n{% endfor %}\nb\n"),
            "a\n-\nb\n"
        );
        // Indentation before a standalone tag goes too (the `  ` on the each line).
        assert_eq!(
            trimmed_text("<ul>\n  {% for xs %}\n  x\n  {% endfor %}\n</ul>\n"),
            "<ul>\n  x\n</ul>\n"
        );
    }

    #[test]
    fn interpolation_is_never_standalone() {
        // A lone `{{x}}` on its line keeps its surrounding whitespace (output, not a block).
        assert_eq!(trimmed_text("a\n{{x}}\nb\n"), "a\n\nb\n");
        // An inline block (text on the same line) is not standalone — the space stays.
        assert_eq!(trimmed_text("{% for xs %}{{this}} {% endfor %}\n"), " \n");
    }

    // ── Explicit whitespace control `{{- … -}}` / `{%- … -%}` (ADR-039 item 3) ────

    /// The text payload after BOTH passes (`-` markers in `lex`, then `trim_standalone`),
    /// concatenated — the rendered whitespace a template would emit between tags.
    fn marked_text(src: &str) -> String {
        let mut ls = lex(src).unwrap();
        super::trim_standalone(src, &mut ls);
        ls.iter()
            .filter_map(|l| match l {
                Lexeme::Text(sp) => Some(sp.of(src)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn trim_markers_are_stripped_from_interior() {
        // The `-` markers are excluded from the interior: `{%- if x -%}` carries `if x`
        // (statement tags `trim_span` the interior), `{{- y -}}` carries ` y ` (output
        // tags do NOT whitespace-trim — the parser does — so only the `-` is removed,
        // matching the PureScript `splitTrims`).
        assert_eq!(
            tags("{%- if x -%}{{- y -}}{%- endif -%}"),
            vec![
                (Sigil::Open, "if x".to_string()),
                (Sigil::Output, " y ".to_string()),
                (Sigil::Close, "if".to_string()),
            ]
        );
    }

    #[test]
    fn trim_markers_drop_adjacent_whitespace() {
        // Both-trim: all whitespace each side of the marked tag is dropped (newlines too).
        assert_eq!(marked_text("a   {{- x -}}   b"), "ab");
        // Left-only: leading side trimmed, trailing side kept.
        assert_eq!(marked_text("a   {{- x }} b"), "a b");
        // Right-only: trailing side trimmed, leading side kept.
        assert_eq!(marked_text("a {{ x -}}   b"), "a b");
    }

    #[test]
    fn trim_markers_eat_newlines() {
        // The `-` markers eat ALL adjacent whitespace, newlines included: every gap
        // around the marked block collapses, leaving just the bodies abutting.
        assert_eq!(
            marked_text("a\n  {%- if on -%}  \nB\n  {%- endif -%}  \nc"),
            "aBc"
        );
    }

    #[test]
    fn spaced_dash_is_not_a_trim_marker() {
        // A `-` NOT glued to the brace stays an operator and trims nothing (interior
        // keeps the spaced `- `, and no adjacent whitespace is removed).
        assert_eq!(
            tags("[ {{ a - b }} ]"),
            vec![(Sigil::Output, " a - b ".to_string())]
        );
        assert_eq!(marked_text("[ {{ a - b }} ]"), "[  ]");
    }

    #[test]
    fn raw_output_takes_trim_markers() {
        // Raw output is `{{ z | safe }}` (no `{{{ }}}`); the `-` trim markers glue to the
        // two-brace tag like any output. The interior keeps its inner spaces.
        assert_eq!(
            tags("x  {{- z | safe -}}  y"),
            vec![(Sigil::Output, " z | safe ".to_string())]
        );
        assert_eq!(marked_text("x  {{- z | safe -}}  y"), "xy");
    }
}
