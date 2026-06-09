//! The Mustache AST (spec v1.4). A faithful, byte-spanned tree: every interpolation,
//! section, partial, comment, and set-delimiter directive is preserved so the future
//! lowering can translate each construct without losing structure.

use crate::Span;

/// A Mustache name reference: a dotted path, or the implicit iterator `{{.}}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Name {
    /// The implicit iterator `{{.}}` — the current context value itself.
    Implicit,
    /// A dotted path `a.b.c`, stored as its segments (always at least one).
    Dotted(Vec<String>),
}

impl Name {
    /// Parse a (already sigil-stripped, trimmed) name string into a [`Name`].
    #[must_use]
    pub fn parse(s: &str) -> Self {
        let s = s.trim();
        if s == "." {
            Name::Implicit
        } else {
            Name::Dotted(s.split('.').map(|seg| seg.trim().to_string()).collect())
        }
    }
}

/// A Mustache template node.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// Literal text (standalone-line whitespace already trimmed per spec).
    Text {
        /// The originating source span (covers the untrimmed run).
        span: Span,
        /// The (possibly standalone-trimmed) literal text.
        text: String,
    },
    /// A variable interpolation. `escaped` is `false` for `{{{x}}}` and `{{&x}}`.
    Variable {
        /// The whole tag span.
        span: Span,
        /// The referenced name.
        name: Name,
        /// Whether the value is HTML-escaped (`{{x}}`) vs raw (`{{{x}}}` / `{{&x}}`).
        escaped: bool,
    },
    /// A section `{{#name}}…{{/name}}` or inverted section `{{^name}}…{{/name}}`.
    Section {
        /// The span from the open tag's start to the close tag's end.
        span: Span,
        /// The section name.
        name: Name,
        /// Whether this is an inverted (`{{^}}`) section.
        inverted: bool,
        /// The section body.
        body: Vec<Node>,
    },
    /// A partial `{{> name}}` (or dynamic `{{>*name}}`).
    Partial {
        /// The whole tag span.
        span: Span,
        /// The partial name (the dynamic-name expression text when `dynamic`).
        name: String,
        /// Whether this is a dynamic partial `{{>*name}}` (inheritance module).
        dynamic: bool,
        /// The standalone-line indentation to prefix to each rendered line, if any.
        indent: String,
    },
    /// A parent `{{<name}}…{{/name}}` for template inheritance (overrides inside).
    Parent {
        /// The span from the open tag's start to the close tag's end.
        span: Span,
        /// The parent template name (the expression text when `dynamic`).
        name: String,
        /// Whether this is a dynamic parent `{{<*name}}`.
        dynamic: bool,
        /// The body, which may contain `{{$block}}` overrides.
        body: Vec<Node>,
    },
    /// A block placeholder `{{$name}}…{{/name}}` (inheritance default content).
    Block {
        /// The span from the open tag's start to the close tag's end.
        span: Span,
        /// The block name.
        name: String,
        /// The default body, used when no parent overrides it.
        body: Vec<Node>,
    },
    /// A comment `{{! … }}` (its text preserved verbatim, sigil stripped).
    Comment {
        /// The whole tag span.
        span: Span,
        /// The comment text (everything after the `!`).
        text: String,
    },
    /// A set-delimiter directive `{{=open close=}}` (kept for fidelity).
    SetDelimiter {
        /// The whole tag span.
        span: Span,
        /// The new opening delimiter.
        open: String,
        /// The new closing delimiter.
        close: String,
    },
}
