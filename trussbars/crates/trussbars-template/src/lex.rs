//! The Trussbars lexer: a brace-aware scan of the template source into a flat
//! stream of [`Lexeme`]s (text runs and `{{ … }}` tags), each carrying byte
//! [`Span`]s. The lexemes **tile the source exactly** — concatenating their spans
//! reproduces the input — which the parser (and later the provenance map, docs/10)
//! rely on.
//!
//! Brace-aware: the closing `}}` is found at brace/bracket **depth 0**, skipping
//! quoted strings, so a dict/list literal needs no space before the close
//! (`{% each {a: 1} %}` lexes with interior `each {a: 1}`). The four-brace raw block
//! `{{{{#raw}}}}…{{{{/raw}}}}` captures its body verbatim.

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
    /// A raw block `{{{{#head}}}}body{{{{/head}}}}` — `body` is captured verbatim.
    RawBlock {
        /// The head name after `{{{{#` (and repeated in the close).
        head: Span,
        /// The verbatim body between the open and close tags.
        body: Span,
        /// The whole construct, both four-brace tags included.
        span: Span,
    },
}

/// The form of a `{{ … }}` tag, distinguished by the opening sigil.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sigil {
    /// `{{ x }}` — escaped output, or a separator (`else`/`elif`); the parser decides.
    Output,
    /// `{{{ x }}}` — unescaped (raw) output.
    Raw,
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

    while i < n {
        // A tag opens with `{{` (output/block/raw/comment/partial) or, in this native
        // Trussbars dialect, the Django-style statement tag `{%` (docs-19).
        let brace = b[i] == b'{' && i + 1 < n && b[i + 1] == b'{';
        let stmt = b[i] == b'{' && i + 1 < n && b[i + 1] == b'%';
        if !(brace || stmt) {
            i += 1;
            continue;
        }
        // A tag starts here; flush any pending text run first.
        if i > text_start {
            out.push(Lexeme::Text(Span::new(text_start, i)));
        }
        let lex = if stmt {
            lex_statement_tag(b, n, i)?
        } else {
            lex_tag(b, n, i)?
        };
        i = lex.next;
        text_start = i;
        out.push(lex.lexeme);
    }
    if n > text_start {
        out.push(Lexeme::Text(Span::new(text_start, n)));
    }
    Ok(out)
}

struct Lexed {
    lexeme: Lexeme,
    next: usize,
}

// ── Standalone-line whitespace trimming (Handlebars/MaxBars) ──────────────────

/// Strip the line a "standalone" tag sits on: when a block open/close, a comment,
/// or a clause separator (`else`/`elif`) is alone on its line (only whitespace from
/// the previous newline up to it, and only whitespace after it to the next newline),
/// remove that indentation and the trailing newline so the tag leaves no blank line.
///
/// A faithful port of the PureScript `FlatBars.Lexer.trimStandalone` (Lexer.purs):
/// block opens/closes (`{% … %}` / `{% end… %}`) and comments are always eligible; output
/// tags (`{{ }}` / `{{{ }}}`) and partials never are; a `{{ }}` tag is eligible only
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

/// Lex one tag beginning at `i` (where `b[i..i+2] == "{{"`).
fn lex_tag(b: &[u8], n: usize, i: usize) -> Result<Lexed, LexError> {
    // Four-brace raw block: `{{{{`.
    if at(b, i, b"{{{{") {
        return lex_raw_block(b, n, i);
    }
    // Three-brace raw output: `{{{ … }}}`.
    if at(b, i, b"{{{") {
        let inner = i + 3;
        let close = find_close(b, n, inner, 3)?;
        return Ok(Lexed {
            lexeme: Lexeme::Tag {
                sigil: Sigil::Raw,
                interior: Span::new(inner, close),
                span: Span::new(i, close + 3),
            },
            next: close + 3,
        });
    }
    // Two-brace tag: the byte after `{{` selects the sigil. Strict native dialect
    // (docs-19): `{{ … }}` is OUTPUT-ONLY — control flow is the Django-style `{% … %}`
    // statement tag (`lex_statement_tag`). The legacy Handlebars block-open/close
    // sigils (a `#` or `/` right after the `{{`) are deliberately NOT recognized here
    // — such a tag just falls through to an ordinary (and invalid) output expression.
    // `{{> }}`
    // (partial inclusion) and `{{! }}` (comment) stay; they are output / metadata,
    // not control.
    let c = b.get(i + 2).copied();
    let (sigil, sig_len) = match c {
        Some(b'>') => (Sigil::Partial, 1),
        Some(b'!') => (Sigil::Comment, 1),
        _ => (Sigil::Output, 0),
    };
    // Long comment `{{!-- … --}}` ends at `--}}`.
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
        });
    }
    let inner = i + 2 + sig_len;
    let close = find_close(b, n, inner, 2)?;
    Ok(Lexed {
        lexeme: Lexeme::Tag {
            sigil,
            interior: Span::new(inner, close),
            span: Span::new(i, close + 2),
        },
        next: close + 2,
    })
}

/// Lex a Django-style statement tag `{% head args %}` (docs-19) into the SAME
/// [`Lexeme::Tag`] its `{{ … }}` counterpart yields, so the parser, desugar, emitter,
/// and VM never see `{% %}` — a faithful port of `FlatBars.Lexer.readStatementTag`:
///
/// * `{% endX %}` → [`Sigil::Close`] naming `X` (the interior is the substring *after*
///   the `end` prefix — e.g. `endeach` carries the `each` it spans).
/// * `{% else %}` / `{% elif … %}` / `{% when … %}` → [`Sigil::Output`], which the parser
///   already splits into a clause (`Stop::Else` / `ElseIf` / `When`), exactly as `{% else %}`.
/// * anything else (`{% if … %}`, `{% each … %}`, `{% local … %}`, host block heads) →
///   [`Sigil::Open`].
///
/// The `%}` close is found brace-aware (depth 0, strings skipped), like `{{ }}`.
fn lex_statement_tag(b: &[u8], n: usize, i: usize) -> Result<Lexed, LexError> {
    let inner = i + 2; // past `{%`
    let close = find_stmt_close(b, n, inner)?; // index of `%` in the closing `%}`
    let end = close + 2; // past `%}`
    let span = Span::new(i, end);
    // The non-whitespace content bounds and its leading head word.
    let (ts, te) = trim_span(b, inner, close);
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
        });
    }
    // A clause separator lexes to `Output` (the parser's `else`/`elif`/`when` split);
    // every other head opens a block.
    let sigil = if head == b"else" || head == b"elif" || head == b"when" {
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
    })
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
/// strings — so a dict/list literal's own `}`/`]` (`{% with {a: {b: 1}} %}`) and a `%}`
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

/// Lex a `{{{{#head}}}}body{{{{/head}}}}` raw block beginning at `i`.
fn lex_raw_block(b: &[u8], n: usize, i: usize) -> Result<Lexed, LexError> {
    // Open: `{{{{#head}}}}` (allow an optional `#`).
    let mut h = i + 4;
    if b.get(h) == Some(&b'#') {
        h += 1;
    }
    let open_close = find_seq(b, n, h, b"}}}}")
        .ok_or_else(|| LexError::new("unterminated raw-block open `{{{{#…}}}}`", i))?;
    let head = Span::new(h, open_close);
    let body_start = open_close + 4;
    // Body runs verbatim until the matching `{{{{/`.
    let body_close = find_seq(b, n, body_start, b"{{{{/")
        .ok_or_else(|| LexError::new("unterminated raw block (no `{{{{/…}}}}`)", i))?;
    let body = Span::new(body_start, body_close);
    // Close: `{{{{/head}}}}`.
    let close_end = find_seq(b, n, body_close, b"}}}}")
        .ok_or_else(|| LexError::new("malformed raw-block close `{{{{/…}}}}`", body_close))?
        + 4;
    Ok(Lexed {
        lexeme: Lexeme::RawBlock {
            head,
            body,
            span: Span::new(i, close_end),
        },
        next: close_end,
    })
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
        let s = "{{x}}{{{y}}}{% each xs %}{% endeach %}{{> card}}{{! c }}";
        assert_eq!(
            sigils(s),
            vec![
                Sigil::Output,
                Sigil::Raw,
                Sigil::Open,
                Sigil::Close,
                Sigil::Partial,
                Sigil::Comment
            ]
        );
        assert_round_trip(s);
    }

    #[test]
    fn raw_output_triple() {
        assert_eq!(sigils("{{{ html }}}"), vec![Sigil::Raw]);
        assert_eq!(interiors("{{{ html }}}"), vec![" html "]);
        assert_round_trip("{{{ html }}}");
    }

    #[test]
    fn brace_aware_dict_needs_no_space() {
        // The dict's `}` must not be mistaken for the tag close.
        let s = "{% each {a: 1, b: 2} %}{{this}}{% endeach %}";
        assert_eq!(interiors(s)[0], "each {a: 1, b: 2}");
        assert_round_trip(s);
    }

    #[test]
    fn list_literal_brackets() {
        let s = "{% each [1, 2, 3] %}{{this}}{% endeach %}";
        assert_eq!(interiors(s)[0], "each [1, 2, 3]");
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
    fn raw_block_body_verbatim() {
        let s = "{{{{#raw}}}}Literal {{x}} & <b>{{{{/raw}}}}";
        let ls = lex(s).unwrap();
        match &ls[0] {
            Lexeme::RawBlock { head, body, .. } => {
                assert_eq!(head.of(s), "raw");
                assert_eq!(body.of(s), "Literal {{x}} & <b>");
            }
            other => panic!("expected RawBlock, got {other:?}"),
        }
        assert_round_trip(s);
    }

    #[test]
    fn liquid_loop_and_let_round_trip() {
        assert_round_trip("{% each post i in posts label outer %}{{post.title}}{% endeach %}");
        assert_round_trip("{% let a=(multiply x y) b=(add a 1) %}{{a}}/{{b}}{% endlet %}");
    }

    #[test]
    fn unterminated_tag_errors() {
        assert!(lex("ok {{oops").is_err());
        assert!(lex("{{{{#raw}}}}no close").is_err());
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
        // `{% each xs %}` opens (interior = the trimmed head+args), `{% endeach %}` closes
        // naming `each` (the substring after `end`).
        assert_eq!(
            tags("{% each xs %}{{this}}{% endeach %}"),
            vec![
                (Sigil::Open, "each xs".to_string()),
                (Sigil::Output, "this".to_string()),
                (Sigil::Close, "each".to_string()),
            ]
        );
        assert_round_trip("{% each xs %}{{this}}{% endeach %}");
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
        let pct = tags("{% each x in xs %}{{x}}{% endeach %}");
        let brace = tags("{% each x in xs %}{{x}}{% endeach %}");
        assert_eq!(pct, brace);
    }

    #[test]
    fn statement_tag_brace_aware_close() {
        // A dict literal's own `}` (and a `%}` inside a string) must not end the tag.
        assert_eq!(
            tags("{% with {a: {b: 1}} %}{{a.b}}{% endwith %}")[0],
            (Sigil::Open, "with {a: {b: 1}}".to_string())
        );
        assert_eq!(
            tags(r#"{% if (eq s "%}") %}x{% endif %}"#)[0],
            (Sigil::Open, r#"if (eq s "%}")"#.to_string())
        );
        assert_round_trip("{% with {a: {b: 1}} %}{{a.b}}{% endwith %}");
    }

    #[test]
    fn statement_tag_standalone_lines_trim() {
        // A `{% each %}`/`{% endeach %}` alone on its line leaves no blank line — the
        // same standalone rule as `{% each %}` (the sigils drive `trim_standalone`).
        assert_eq!(
            trimmed_text("a\n{% each xs %}\n-\n{% endeach %}\nb\n"),
            "a\n-\nb\n"
        );
    }

    #[test]
    fn empty_or_unterminated_statement_tag_errors() {
        assert!(lex("{%  %}").is_err()); // empty
        assert!(lex("ok {% each xs no close").is_err()); // no `%}`
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
        // The `{% each %}` / `{% endeach %}` lines (alone on their line) are stripped whole.
        assert_eq!(
            trimmed_text("a\n{% each xs %}\n-\n{% endeach %}\nb\n"),
            "a\n-\nb\n"
        );
        // Indentation before a standalone tag goes too (the `  ` on the each line).
        assert_eq!(
            trimmed_text("<ul>\n  {% each xs %}\n  x\n  {% endeach %}\n</ul>\n"),
            "<ul>\n  x\n</ul>\n"
        );
    }

    #[test]
    fn interpolation_is_never_standalone() {
        // A lone `{{x}}` on its line keeps its surrounding whitespace (output, not a block).
        assert_eq!(trimmed_text("a\n{{x}}\nb\n"), "a\n\nb\n");
        // An inline block (text on the same line) is not standalone — the space stays.
        assert_eq!(trimmed_text("{% each xs %}{{this}} {% endeach %}\n"), " \n");
    }
}
