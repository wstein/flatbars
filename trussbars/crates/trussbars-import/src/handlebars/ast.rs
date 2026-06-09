//! The Handlebars AST — a superset of Mustache: helper calls with positional and
//! hash arguments, subexpressions, rich paths (`../`, `@data`, segment literals),
//! block helpers with `{{else}}`-chains and block params, partials / partial blocks /
//! inline partials, decorators, and raw blocks.

use crate::Span;

/// A literal value in a Handlebars expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    /// A string literal (`"x"` or `'x'`), quotes stripped.
    Str(String),
    /// A number literal (the engine's `f64` model).
    Number(f64),
    /// `true` / `false`.
    Bool(bool),
    /// `null`.
    Null,
    /// `undefined`.
    Undefined,
}

/// A Handlebars path expression, e.g. `../foo.[bar baz].@index`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Path {
    /// The number of `../` parent hops.
    pub depth: usize,
    /// Whether the path is `@`-prefixed (a `@data` reference like `@index`/`@root`).
    pub data: bool,
    /// The resolved path segments (empty means the current context — `this` / `.`).
    pub segments: Vec<String>,
    /// The original path text, verbatim.
    pub original: String,
}

/// A Handlebars expression: a path, a literal, or a parenthesised subexpression.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// A path reference.
    Path(Path),
    /// A literal value.
    Literal(Literal),
    /// A subexpression `(helper args…)`.
    Sub {
        /// The helper path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash (named) arguments.
        hash: Vec<HashPair>,
    },
}

/// A hash (named) argument `key=value`.
#[derive(Debug, Clone, PartialEq)]
pub struct HashPair {
    /// The hash key.
    pub key: String,
    /// The value expression.
    pub value: Expr,
}

/// A partial name: a simple name, or a dynamic `(expr)` / `[seg]` lookup.
#[derive(Debug, Clone, PartialEq)]
pub enum PartialName {
    /// A literal partial name (`{{> nav}}`).
    Simple(String),
    /// A dynamic partial name `{{> (expr)}}`.
    Dynamic(Box<Expr>),
}

/// A Handlebars template node.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// Literal text (whitespace-control / standalone trimming already applied).
    Text {
        /// The originating span.
        span: Span,
        /// The (possibly trimmed) literal text.
        text: String,
    },
    /// A `{{expr}}` / `{{{expr}}}` interpolation or helper call.
    Mustache {
        /// The whole tag span.
        span: Span,
        /// The head path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// Whether HTML-escaped (`{{ }}`) vs raw (`{{{ }}}` / `&`).
        escaped: bool,
    },
    /// A block helper `{{#name …}}program{{else}}inverse{{/name}}`.
    Block {
        /// The span from the open tag start to the close tag end.
        span: Span,
        /// The block helper path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// Block params `as |a b|`.
        block_params: Vec<String>,
        /// Whether opened with `{{^name}}` (the inverted form).
        inverted: bool,
        /// The main program.
        program: Vec<Node>,
        /// The inverse (`{{else}}`) program, if any. An `{{else if}}` chain is a
        /// single nested [`Node::Block`] here.
        inverse: Option<Vec<Node>>,
    },
    /// A partial `{{> name args hash}}`.
    Partial {
        /// The whole tag span.
        span: Span,
        /// The partial name.
        name: PartialName,
        /// Positional arguments (the leading context argument, if any, is `params[0]`).
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// Standalone-line indentation, if any.
        indent: String,
    },
    /// A partial block `{{#> name}}program{{else}}inverse{{/name}}`.
    PartialBlock {
        /// The span from the open tag start to the close tag end.
        span: Span,
        /// The partial name.
        name: PartialName,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// The block program (the `@partial-block` content).
        program: Vec<Node>,
        /// The inverse program, if any.
        inverse: Option<Vec<Node>>,
    },
    /// An inline partial definition `{{#*inline "name"}}…{{/inline}}`.
    InlinePartial {
        /// The span from the open tag start to the close tag end.
        span: Span,
        /// The inline partial's name.
        name: String,
        /// The definition body.
        program: Vec<Node>,
    },
    /// A decorator `{{* decorator args}}`.
    Decorator {
        /// The whole tag span.
        span: Span,
        /// The decorator path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
    },
    /// A block decorator `{{#* decorator}}…{{/decorator}}`.
    BlockDecorator {
        /// The span from the open tag start to the close tag end.
        span: Span,
        /// The decorator path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// The decorated program.
        program: Vec<Node>,
    },
    /// A comment `{{! … }}` or `{{!-- … --}}`.
    Comment {
        /// The whole tag span.
        span: Span,
        /// The comment text.
        text: String,
    },
    /// A raw block `{{{{helper}}}}body{{{{/helper}}}}` — the body is verbatim.
    RawBlock {
        /// The whole construct span.
        span: Span,
        /// The helper path.
        path: Path,
        /// Positional arguments.
        params: Vec<Expr>,
        /// Hash arguments.
        hash: Vec<HashPair>,
        /// The verbatim body.
        content: String,
    },
}
