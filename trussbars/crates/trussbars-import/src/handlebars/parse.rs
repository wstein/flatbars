//! The Handlebars parser: the [`Tok`] stream → the [`Node`] tree. Classifies each
//! tag by its sigil (`#`, `/`, `^`, `>`, `#>`, `#*`, `*`, `&`), parses the interior
//! into a head [`Path`] plus positional / hash arguments and `as |…|` block params,
//! matches block opens to closes, threads `{{else}}` (and `{{else if}}`) chains, and
//! applies whitespace control (`~`) plus standalone-line trimming.

use super::ast::{Expr, HashPair, Literal, Node, PartialName, Path};
use super::lex::{Tok, lex};
use crate::{ParseError, Span};

/// Parse a Handlebars template into its node tree.
///
/// # Errors
/// Returns a [`ParseError`] on a lex failure, an unclosed/mismatched block, an
/// empty subexpression, or other malformed expression.
pub fn parse(src: &str) -> Result<Vec<Node>, ParseError> {
    let mut toks = lex(src)?;
    trim_whitespace(src, &mut toks);
    let mut p = Parser {
        toks: &toks,
        pos: 0,
    };
    let (nodes, stop) = p.parse_nodes()?;
    match stop {
        Stop::Eof => Ok(nodes),
        Stop::Close { name, span } => Err(ParseError::new(
            format!("unexpected `{{{{/{name}}}}}` (no open block)"),
            span.start,
        )),
        Stop::Else { span, .. } => Err(ParseError::new(
            "unexpected `{{else}}` outside a block",
            span.start,
        )),
    }
}

// ---------------------------------------------------------------------------
// Expression / interior parsing
// ---------------------------------------------------------------------------

/// A parsed tag interior: a head path with its arguments and any block params.
struct Call {
    path: Path,
    params: Vec<Expr>,
    hash: Vec<HashPair>,
    block_params: Vec<String>,
}

/// Split a tag interior into whitespace-separated atoms, keeping `"…"` / `'…'`
/// strings, `(…)` subexpressions, and `[…]` segment literals intact.
fn split_atoms(s: &str) -> Vec<String> {
    let mut atoms = Vec::new();
    let mut start = 0usize;
    let mut in_atom = false;
    let mut string: Option<char> = None;
    let mut escaped = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    for (i, ch) in s.char_indices() {
        if let Some(q) = string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == q {
                string = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => {
                if !in_atom {
                    start = i;
                    in_atom = true;
                }
                string = Some(ch);
            }
            '(' => {
                if !in_atom {
                    start = i;
                    in_atom = true;
                }
                paren += 1;
            }
            ')' => paren -= 1,
            '[' => {
                if !in_atom {
                    start = i;
                    in_atom = true;
                }
                bracket += 1;
            }
            ']' => bracket -= 1,
            c if c.is_whitespace() && paren == 0 && bracket == 0 => {
                if in_atom {
                    atoms.push(s[start..i].to_string());
                    in_atom = false;
                }
            }
            _ => {
                if !in_atom {
                    start = i;
                    in_atom = true;
                }
            }
        }
    }
    if in_atom {
        atoms.push(s[start..].to_string());
    }
    atoms
}

/// Parse a Handlebars path string (`../a.[b c].@index`).
fn parse_path(raw: &str) -> Path {
    let original = raw.to_string();
    let mut rest = raw;
    let mut depth = 0usize;
    // `../` parent hops (and a leading `./`, which is depth 0).
    while let Some(r) = rest.strip_prefix("../") {
        depth += 1;
        rest = r;
    }
    if let Some(r) = rest.strip_prefix("./") {
        rest = r;
    }
    let data = rest.starts_with('@');
    if data {
        rest = &rest[1..];
    }
    // `this` / `.` → the current context (no segments).
    let segments = if rest == "." || rest == "this" || rest.is_empty() {
        Vec::new()
    } else {
        split_path_segments(rest)
    };
    Path {
        depth,
        data,
        segments,
        original,
    }
}

/// Split a path body into segments on `.` / `/`, honoring `[literal]` segments.
fn split_path_segments(s: &str) -> Vec<String> {
    let mut segs = Vec::new();
    let mut buf = String::new();
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '[' => {
                // A bracketed literal segment runs to the next `]`.
                let mut lit = String::new();
                for c in chars.by_ref() {
                    if c == ']' {
                        break;
                    }
                    lit.push(c);
                }
                buf = lit;
            }
            '.' | '/' => {
                if !buf.is_empty() || !segs.is_empty() {
                    segs.push(std::mem::take(&mut buf));
                }
            }
            c => buf.push(c),
        }
    }
    if !buf.is_empty() {
        segs.push(buf);
    }
    segs.retain(|s| !s.is_empty());
    segs
}

/// Parse a literal atom, if it is one.
fn parse_literal(a: &str) -> Option<Literal> {
    if (a.starts_with('"') && a.ends_with('"') && a.len() >= 2)
        || (a.starts_with('\'') && a.ends_with('\'') && a.len() >= 2)
    {
        return Some(Literal::Str(unquote(a)));
    }
    match a {
        "true" => return Some(Literal::Bool(true)),
        "false" => return Some(Literal::Bool(false)),
        "null" => return Some(Literal::Null),
        "undefined" => return Some(Literal::Undefined),
        _ => {}
    }
    // A number — only if the whole atom parses (so `1abc` stays a path).
    if a.chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit() || c == '-')
        && let Ok(n) = a.parse::<f64>()
    {
        return Some(Literal::Number(n));
    }
    None
}

/// Strip the surrounding quotes from a string literal and unescape `\"`/`\'`/`\\`.
fn unquote(a: &str) -> String {
    let inner = &a[1..a.len() - 1];
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(n) => out.push(n),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse one argument atom into an [`Expr`].
fn parse_atom(a: &str) -> Result<Expr, ParseError> {
    let a = a.trim();
    if let Some(inner) = a.strip_prefix('(').and_then(|x| x.strip_suffix(')')) {
        let atoms = split_atoms(inner);
        let Some((head, rest)) = atoms.split_first() else {
            return Err(ParseError::new("empty subexpression", 0));
        };
        let (params, hash) = parse_args(rest)?;
        return Ok(Expr::Sub {
            path: parse_path(head),
            params,
            hash,
        });
    }
    if let Some(lit) = parse_literal(a) {
        return Ok(Expr::Literal(lit));
    }
    Ok(Expr::Path(parse_path(a)))
}

/// Split `key=value` at the top-level `=`, if the atom is a hash pair.
fn split_hash(atom: &str) -> Option<(&str, &str)> {
    let bytes = atom.as_bytes();
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut string: Option<u8> = None;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate() {
        if let Some(q) = string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == q {
                string = None;
            }
            continue;
        }
        match b {
            b'"' | b'\'' => string = Some(b),
            b'(' => paren += 1,
            b')' => paren -= 1,
            b'[' => bracket += 1,
            b']' => bracket -= 1,
            b'=' if paren == 0 && bracket == 0 && i > 0 => {
                let key = &atom[..i];
                if key
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
                {
                    return Some((key, &atom[i + 1..]));
                }
                return None;
            }
            _ => {}
        }
    }
    None
}

/// Parse argument atoms into positional params and hash pairs.
fn parse_args(atoms: &[String]) -> Result<(Vec<Expr>, Vec<HashPair>), ParseError> {
    let mut params = Vec::new();
    let mut hash = Vec::new();
    for atom in atoms {
        if let Some((key, val)) = split_hash(atom) {
            hash.push(HashPair {
                key: key.to_string(),
                value: parse_atom(val)?,
            });
        } else {
            params.push(parse_atom(atom)?);
        }
    }
    Ok((params, hash))
}

/// Parse a full tag interior (sigil already stripped) into a [`Call`].
fn parse_call(interior: &str) -> Result<Call, ParseError> {
    let atoms = split_atoms(interior);
    let Some((head, rest)) = atoms.split_first() else {
        return Err(ParseError::new("empty tag", 0));
    };
    // Split off a trailing `as |a b|` block-parameter clause.
    let mut block_params = Vec::new();
    let mut arg_atoms: Vec<String> = Vec::new();
    let mut it = rest.iter();
    while let Some(atom) = it.next() {
        if atom == "as" {
            let joined: String = it.cloned().collect::<Vec<_>>().join(" ");
            block_params = joined
                .trim()
                .trim_matches('|')
                .split_whitespace()
                .map(str::to_string)
                .collect();
            break;
        }
        arg_atoms.push(atom.clone());
    }
    let (params, hash) = parse_args(&arg_atoms)?;
    Ok(Call {
        path: parse_path(head),
        params,
        hash,
        block_params,
    })
}

/// Parse a partial head (`name`/`(expr)`/`[seg]` + args) into its name and args.
fn parse_partial_head(
    interior: &str,
) -> Result<(PartialName, Vec<Expr>, Vec<HashPair>), ParseError> {
    let atoms = split_atoms(interior);
    let Some((head, rest)) = atoms.split_first() else {
        return Err(ParseError::new("empty partial reference", 0));
    };
    let name = if head.starts_with('(') {
        PartialName::Dynamic(Box::new(parse_atom(head)?))
    } else if head.starts_with('[') && head.ends_with(']') {
        PartialName::Simple(head[1..head.len() - 1].to_string())
    } else {
        PartialName::Simple(head.clone())
    };
    let (params, hash) = parse_args(rest)?;
    Ok((name, params, hash))
}

// ---------------------------------------------------------------------------
// Node tree
// ---------------------------------------------------------------------------

/// What stopped a node-list parse.
enum Stop {
    Eof,
    Close { name: String, span: Span },
    Else { rest: String, span: Span },
}

struct Parser<'a> {
    toks: &'a [Tok],
    pos: usize,
}

impl Parser<'_> {
    fn parse_nodes(&mut self) -> Result<(Vec<Node>, Stop), ParseError> {
        let mut nodes = Vec::new();
        while self.pos < self.toks.len() {
            let tok = &self.toks[self.pos];
            match tok {
                Tok::Text { span, text } => {
                    if !text.is_empty() {
                        nodes.push(Node::Text {
                            span: *span,
                            text: text.clone(),
                        });
                    }
                    self.pos += 1;
                }
                Tok::Comment { span, text, .. } => {
                    nodes.push(Node::Comment {
                        span: *span,
                        text: text.clone(),
                    });
                    self.pos += 1;
                }
                Tok::RawBlock {
                    span,
                    head,
                    content,
                } => {
                    let call = parse_call(head)?;
                    nodes.push(Node::RawBlock {
                        span: *span,
                        path: call.path,
                        params: call.params,
                        hash: call.hash,
                        content: content.clone(),
                    });
                    self.pos += 1;
                }
                Tok::Tag {
                    span,
                    interior,
                    raw,
                    ..
                } => {
                    let span = *span;
                    let raw = *raw;
                    let interior = interior.clone();
                    // Separators terminate the current node list.
                    if interior == "else" || interior.starts_with("else ") {
                        let rest = interior["else".len()..].trim().to_string();
                        self.pos += 1;
                        return Ok((nodes, Stop::Else { rest, span }));
                    }
                    if interior == "^" {
                        self.pos += 1;
                        return Ok((
                            nodes,
                            Stop::Else {
                                rest: String::new(),
                                span,
                            },
                        ));
                    }
                    if let Some(name) = interior.strip_prefix('/') {
                        self.pos += 1;
                        return Ok((
                            nodes,
                            Stop::Close {
                                name: name.trim().to_string(),
                                span,
                            },
                        ));
                    }
                    let node = self.parse_tag(span, &interior, raw)?;
                    nodes.push(node);
                }
            }
        }
        Ok((nodes, Stop::Eof))
    }

    /// Parse a non-separator, non-close tag at `self.pos` (which it advances past).
    fn parse_tag(&mut self, span: Span, interior: &str, raw: bool) -> Result<Node, ParseError> {
        if let Some(rest) = interior.strip_prefix("#>") {
            self.pos += 1;
            return self.parse_partial_block(span, rest.trim());
        }
        if let Some(rest) = interior.strip_prefix("#*") {
            self.pos += 1;
            return self.parse_block_decorator(span, rest.trim());
        }
        if let Some(rest) = interior.strip_prefix('#') {
            self.pos += 1;
            return self.parse_block(span, rest.trim(), false);
        }
        if let Some(rest) = interior.strip_prefix('^') {
            // `{{^name}}` — an inverted block open (bare `^` was handled as a separator).
            self.pos += 1;
            return self.parse_block(span, rest.trim(), true);
        }
        if let Some(rest) = interior.strip_prefix('>') {
            self.pos += 1;
            let (name, params, hash) = parse_partial_head(rest.trim())?;
            return Ok(Node::Partial {
                span,
                name,
                params,
                hash,
                indent: String::new(),
            });
        }
        if let Some(rest) = interior.strip_prefix('*') {
            self.pos += 1;
            let call = parse_call(rest.trim())?;
            return Ok(Node::Decorator {
                span,
                path: call.path,
                params: call.params,
                hash: call.hash,
            });
        }
        // A `{{&x}}` unescaped mustache, or a plain `{{expr}}`.
        let (interior, escaped) = match interior.strip_prefix('&') {
            Some(rest) => (rest.trim(), false),
            None => (interior, !raw),
        };
        self.pos += 1;
        let call = parse_call(interior)?;
        Ok(Node::Mustache {
            span,
            path: call.path,
            params: call.params,
            hash: call.hash,
            escaped,
        })
    }

    /// Parse a `{{#name}}…{{/name}}` block (after the open tag is consumed),
    /// threading any `{{else}}` / `{{else if}}` chain. `inverted` flags the
    /// top-level node only.
    fn parse_block(&mut self, open: Span, head: &str, inverted: bool) -> Result<Node, ParseError> {
        let call = parse_call(head)?;
        let open_name = call.path.original.clone();
        let (program, stop) = self.parse_nodes()?;
        match stop {
            Stop::Eof => Err(ParseError::new(
                format!("unclosed block `{open_name}`"),
                open.start,
            )),
            Stop::Close { name, span } => {
                check_close(&open_name, &name, span.start)?;
                Ok(Node::Block {
                    span: Span::new(open.start, span.end),
                    path: call.path,
                    params: call.params,
                    hash: call.hash,
                    block_params: call.block_params,
                    inverted,
                    program,
                    inverse: None,
                })
            }
            Stop::Else { rest, span } => {
                if rest.is_empty() {
                    let (inverse, stop2) = self.parse_nodes()?;
                    let Stop::Close { name, span: cspan } = stop2 else {
                        return Err(ParseError::new(
                            format!("unclosed block `{open_name}`"),
                            open.start,
                        ));
                    };
                    check_close(&open_name, &name, cspan.start)?;
                    Ok(Node::Block {
                        span: Span::new(open.start, cspan.end),
                        path: call.path,
                        params: call.params,
                        hash: call.hash,
                        block_params: call.block_params,
                        inverted,
                        program,
                        inverse: Some(inverse),
                    })
                } else {
                    // `{{else if …}}` — the inverse is a single nested block, closed by
                    // this block's own `{{/name}}`.
                    let child = self.parse_block_chained(span, &rest, &open_name)?;
                    let end = node_end(&child);
                    Ok(Node::Block {
                        span: Span::new(open.start, end),
                        path: call.path,
                        params: call.params,
                        hash: call.hash,
                        block_params: call.block_params,
                        inverted,
                        program,
                        inverse: Some(vec![child]),
                    })
                }
            }
        }
    }

    /// Parse a chained `{{else <head>}}` arm as a nested block sharing the outer
    /// close tag.
    fn parse_block_chained(
        &mut self,
        open: Span,
        head: &str,
        close_name: &str,
    ) -> Result<Node, ParseError> {
        let call = parse_call(head)?;
        let (program, stop) = self.parse_nodes()?;
        match stop {
            Stop::Eof => Err(ParseError::new(
                format!("unclosed block `{close_name}`"),
                open.start,
            )),
            Stop::Close { name, span } => {
                check_close(close_name, &name, span.start)?;
                Ok(Node::Block {
                    span: Span::new(open.start, span.end),
                    path: call.path,
                    params: call.params,
                    hash: call.hash,
                    block_params: call.block_params,
                    inverted: false,
                    program,
                    inverse: None,
                })
            }
            Stop::Else { rest, span } => {
                if rest.is_empty() {
                    let (inverse, stop2) = self.parse_nodes()?;
                    let Stop::Close { name, span: cspan } = stop2 else {
                        return Err(ParseError::new(
                            format!("unclosed block `{close_name}`"),
                            open.start,
                        ));
                    };
                    check_close(close_name, &name, cspan.start)?;
                    Ok(Node::Block {
                        span: Span::new(open.start, cspan.end),
                        path: call.path,
                        params: call.params,
                        hash: call.hash,
                        block_params: call.block_params,
                        inverted: false,
                        program,
                        inverse: Some(inverse),
                    })
                } else {
                    let child = self.parse_block_chained(span, &rest, close_name)?;
                    let end = node_end(&child);
                    Ok(Node::Block {
                        span: Span::new(open.start, end),
                        path: call.path,
                        params: call.params,
                        hash: call.hash,
                        block_params: call.block_params,
                        inverted: false,
                        program,
                        inverse: Some(vec![child]),
                    })
                }
            }
        }
    }

    fn parse_partial_block(&mut self, open: Span, head: &str) -> Result<Node, ParseError> {
        let (name, params, hash) = parse_partial_head(head)?;
        let close_name = match &name {
            PartialName::Simple(s) => s.clone(),
            PartialName::Dynamic(_) => String::new(),
        };
        let (program, stop) = self.parse_nodes()?;
        let (inverse, end) = self.finish_block_close(stop, &close_name, open.start)?;
        Ok(Node::PartialBlock {
            span: Span::new(open.start, end),
            name,
            params,
            hash,
            program,
            inverse,
        })
    }

    fn parse_block_decorator(&mut self, open: Span, head: &str) -> Result<Node, ParseError> {
        let call = parse_call(head)?;
        // `{{#*inline "name"}}…{{/inline}}` is the inline-partial form.
        if call.path.original == "inline" {
            let name = match call.params.first() {
                Some(Expr::Literal(Literal::Str(s))) => s.clone(),
                _ => String::new(),
            };
            let (program, stop) = self.parse_nodes()?;
            let (_inv, end) = self.finish_block_close(stop, "inline", open.start)?;
            return Ok(Node::InlinePartial {
                span: Span::new(open.start, end),
                name,
                program,
            });
        }
        let close_name = call.path.original.clone();
        let (program, stop) = self.parse_nodes()?;
        let (_inv, end) = self.finish_block_close(stop, &close_name, open.start)?;
        Ok(Node::BlockDecorator {
            span: Span::new(open.start, end),
            path: call.path,
            params: call.params,
            hash: call.hash,
            program,
        })
    }

    /// Resolve a block terminator into its optional inverse program and close-end
    /// offset, for the simpler block forms (partial block / decorators) that take a
    /// single optional `{{else}}` arm.
    fn finish_block_close(
        &mut self,
        stop: Stop,
        close_name: &str,
        open_start: usize,
    ) -> Result<(Option<Vec<Node>>, usize), ParseError> {
        match stop {
            Stop::Eof => Err(ParseError::new(
                format!("unclosed block `{close_name}`"),
                open_start,
            )),
            Stop::Close { name, span } => {
                check_close(close_name, &name, span.start)?;
                Ok((None, span.end))
            }
            Stop::Else { .. } => {
                let (inverse, stop2) = self.parse_nodes()?;
                let Stop::Close { name, span } = stop2 else {
                    return Err(ParseError::new(
                        format!("unclosed block `{close_name}`"),
                        open_start,
                    ));
                };
                check_close(close_name, &name, span.start)?;
                Ok((Some(inverse), span.end))
            }
        }
    }
}

/// The end offset of a node's span (used to span an else-chained block to its close).
fn node_end(node: &Node) -> usize {
    match node {
        Node::Text { span, .. }
        | Node::Mustache { span, .. }
        | Node::Block { span, .. }
        | Node::Partial { span, .. }
        | Node::PartialBlock { span, .. }
        | Node::InlinePartial { span, .. }
        | Node::Decorator { span, .. }
        | Node::BlockDecorator { span, .. }
        | Node::Comment { span, .. }
        | Node::RawBlock { span, .. } => span.end,
    }
}

/// Verify a block close name matches its open (an empty close `{{/}}` is accepted).
fn check_close(open: &str, close: &str, at: usize) -> Result<(), ParseError> {
    if close.is_empty() || open == close {
        Ok(())
    } else {
        Err(ParseError::new(
            format!("block `{open}` closed by `{{{{/{close}}}}}`"),
            at,
        ))
    }
}

// ---------------------------------------------------------------------------
// Whitespace control
// ---------------------------------------------------------------------------

/// Whether a tag participates in standalone-line trimming.
fn is_block_like(interior: &str) -> bool {
    interior.starts_with('#')
        || interior.starts_with('/')
        || interior.starts_with('^')
        || interior.starts_with('>')
        || interior.starts_with('*')
        || interior == "else"
        || interior.starts_with("else ")
}

/// Apply standalone-line trimming (for block-like tags & comments) and explicit
/// `~` whitespace control to the token stream.
fn trim_whitespace(src: &str, toks: &mut [Tok]) {
    // Standalone-line trimming (position-based, like Mustache). Block-like tags and
    // comments alone on their line shed the surrounding whitespace + line ending.
    let mut back: Vec<(usize, usize)> = Vec::new();
    let mut front: Vec<(usize, usize)> = Vec::new();
    for k in 0..toks.len() {
        let (span, eligible) = match &toks[k] {
            Tok::Comment { span, .. } => (*span, true),
            Tok::Tag { span, interior, .. } => (*span, is_block_like(interior)),
            _ => continue,
        };
        if !eligible {
            continue;
        }
        let nl_before = src[..span.start].rfind('\n').map_or(0, |i| i + 1);
        let left_ws = &src[nl_before..span.start];
        if !left_ws.bytes().all(is_inline_ws) {
            continue;
        }
        let after = &src[span.end..];
        let (right_ws, nl_len) = match after.find('\n') {
            Some(n) => (&after[..n], 1),
            None => (after, 0),
        };
        if !right_ws.bytes().all(is_inline_ws) {
            continue;
        }
        if !left_ws.is_empty() && k > 0 && matches!(toks[k - 1], Tok::Text { .. }) {
            back.push((k - 1, left_ws.len()));
        }
        let drop = right_ws.len() + nl_len;
        if drop > 0 && k + 1 < toks.len() && matches!(toks[k + 1], Tok::Text { .. }) {
            front.push((k + 1, drop));
        }
    }
    for (k, n) in back {
        if let Tok::Text { text, .. } = &mut toks[k] {
            text.truncate(text.len().saturating_sub(n));
        }
    }
    for (k, n) in front {
        if let Tok::Text { text, .. } = &mut toks[k] {
            let n = n.min(text.len());
            text.drain(..n);
        }
    }

    // Explicit `~` control: trim all whitespace on the marked side.
    let mut ltrim_next = false;
    for k in 0..toks.len() {
        let (left, right) = match &toks[k] {
            Tok::Tag {
                left_ws, right_ws, ..
            }
            | Tok::Comment {
                left_ws, right_ws, ..
            } => (*left_ws, *right_ws),
            _ => (false, false),
        };
        if ltrim_next && let Tok::Text { text, .. } = &mut toks[k] {
            let t = text.trim_start().to_string();
            *text = t;
        }
        ltrim_next = false;
        if left
            && k > 0
            && let Tok::Text { text, .. } = &mut toks[k - 1]
        {
            let t = text.trim_end().to_string();
            *text = t;
        }
        if right {
            ltrim_next = true;
        }
    }
}

fn is_inline_ws(b: u8) -> bool {
    b == b' ' || b == b'\t' || b == b'\r'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nodes(src: &str) -> Vec<Node> {
        parse(src).unwrap_or_else(|e| panic!("parse `{src}`: {e}"))
    }

    #[test]
    fn mustache_escaped_vs_raw() {
        let n = nodes("{{a}}{{{b}}}{{&c}}");
        assert!(matches!(&n[0], Node::Mustache { escaped: true, .. }));
        assert!(matches!(&n[1], Node::Mustache { escaped: false, .. }));
        assert!(matches!(&n[2], Node::Mustache { escaped: false, .. }));
    }

    #[test]
    fn helper_with_params_and_hash() {
        let n = nodes(r#"{{link "Home" url=page.url class="nav"}}"#);
        let Node::Mustache {
            path, params, hash, ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(path.original, "link");
        assert_eq!(params.len(), 1);
        assert_eq!(hash.len(), 2);
        assert_eq!(hash[0].key, "url");
    }

    #[test]
    fn subexpression() {
        let n = nodes("{{outer (inner a b) c}}");
        let Node::Mustache { params, .. } = &n[0] else {
            panic!()
        };
        assert!(matches!(&params[0], Expr::Sub { .. }));
        assert!(matches!(&params[1], Expr::Path(_)));
    }

    #[test]
    fn path_depth_and_segments() {
        let n = nodes("{{../../a.[b c].d}}");
        let Node::Mustache { path, .. } = &n[0] else {
            panic!()
        };
        assert_eq!(path.depth, 2);
        assert!(!path.data);
        assert_eq!(path.segments, vec!["a", "b c", "d"]);
    }

    #[test]
    fn data_path() {
        let n = nodes("{{@root.user}}");
        let Node::Mustache { path, .. } = &n[0] else {
            panic!()
        };
        assert!(path.data);
        assert_eq!(path.segments, vec!["root", "user"]);
    }

    #[test]
    fn block_with_params_and_else() {
        let n = nodes("{{#each items as |item i|}}{{item}}{{else}}none{{/each}}");
        let Node::Block {
            path,
            block_params,
            inverse,
            program,
            ..
        } = &n[0]
        else {
            panic!("{n:?}")
        };
        assert_eq!(path.original, "each");
        assert_eq!(block_params, &vec!["item".to_string(), "i".to_string()]);
        assert!(inverse.is_some());
        assert_eq!(program.len(), 1);
    }

    #[test]
    fn inverted_block() {
        let n = nodes("{{^empty}}has{{/empty}}");
        assert!(matches!(&n[0], Node::Block { inverted: true, .. }));
    }

    #[test]
    fn else_if_chain() {
        let n = nodes("{{#if a}}A{{else if b}}B{{else}}C{{/if}}");
        let Node::Block { inverse, .. } = &n[0] else {
            panic!()
        };
        let inv = inverse.as_ref().unwrap();
        let Node::Block {
            path,
            inverse: inner,
            ..
        } = &inv[0]
        else {
            panic!("{inv:?}")
        };
        assert_eq!(path.original, "if");
        assert!(inner.is_some()); // the trailing {{else}}C
    }

    #[test]
    fn partial_and_dynamic_partial() {
        let n = nodes("{{> nav x=1}}{{> (lookup . 'p')}}");
        assert!(matches!(&n[0], Node::Partial { name: PartialName::Simple(s), .. } if s == "nav"));
        assert!(matches!(
            &n[1],
            Node::Partial {
                name: PartialName::Dynamic(_),
                ..
            }
        ));
    }

    #[test]
    fn partial_block() {
        let n = nodes("{{#> layout}}body{{/layout}}");
        assert!(matches!(&n[0], Node::PartialBlock { .. }));
    }

    #[test]
    fn inline_partial() {
        let n = nodes(r#"{{#*inline "nav"}}x{{/inline}}"#);
        assert!(matches!(&n[0], Node::InlinePartial { name, .. } if name == "nav"));
    }

    #[test]
    fn decorator() {
        let n = nodes("{{* myDecorator}}");
        assert!(matches!(&n[0], Node::Decorator { .. }));
    }

    #[test]
    fn raw_block() {
        let n = nodes("{{{{md}}}}{{x}}{{{{/md}}}}");
        let Node::RawBlock { path, content, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert_eq!(path.original, "md");
        assert_eq!(content, "{{x}}");
    }

    #[test]
    fn comments() {
        let n = nodes("{{! one }}{{!-- two }} --}}");
        assert!(matches!(&n[0], Node::Comment { text, .. } if text == " one "));
        assert!(matches!(&n[1], Node::Comment { text, .. } if text == " two }} "));
    }

    #[test]
    fn literals_in_args() {
        let n = nodes("{{f 1 -2.5 true false null undefined}}");
        let Node::Mustache { params, .. } = &n[0] else {
            panic!()
        };
        assert_eq!(params.len(), 6);
        assert!(matches!(&params[0], Expr::Literal(Literal::Number(_))));
        assert!(matches!(&params[2], Expr::Literal(Literal::Bool(true))));
        assert!(matches!(&params[4], Expr::Literal(Literal::Null)));
        assert!(matches!(&params[5], Expr::Literal(Literal::Undefined)));
    }

    #[test]
    fn whitespace_control_tilde() {
        let n = nodes("a  {{~x~}}  b");
        assert!(matches!(&n[0], Node::Text { text, .. } if text == "a"));
        assert!(matches!(&n[2], Node::Text { text, .. } if text == "b"));
    }

    #[test]
    fn standalone_block_lines_trimmed() {
        let n = nodes("{{#if a}}\nx\n{{/if}}\n");
        let Node::Block { program, .. } = &n[0] else {
            panic!("{n:?}")
        };
        assert!(matches!(&program[0], Node::Text { text, .. } if text == "x\n"));
        assert_eq!(n.len(), 1);
    }

    #[test]
    fn unclosed_and_mismatched_errors() {
        assert!(parse("{{#if a}}x").is_err());
        assert!(parse("{{#if a}}x{{/each}}").is_err());
        assert!(parse("{{/if}}").is_err());
    }
}
