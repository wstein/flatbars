//! The Liquid AST: objects `{{ expr | filter }}` and tags `{% … %}` (control flow,
//! iteration, variable, theme, and utility tags), with filters, conditions, and
//! ranges preserved faithfully.

use crate::Span;

/// A Liquid literal value.
#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    /// A string literal (quotes stripped).
    Str(String),
    /// A number (Liquid integers and floats share the `f64` model here).
    Number(f64),
    /// `true` / `false`.
    Bool(bool),
    /// `nil` / `null`.
    Nil,
    /// `empty`.
    Empty,
    /// `blank`.
    Blank,
}

/// A path accessor on a Liquid variable (`a.b`, `a[0]`, `a["k"]`, `a[var]`).
#[derive(Debug, Clone, PartialEq)]
pub enum Access {
    /// A dotted field access `.name`.
    Field(String),
    /// A subscript access `[expr]`.
    Index(Box<Expr>),
}

/// A Liquid variable lookup: a base name plus a chain of accessors.
#[derive(Debug, Clone, PartialEq)]
pub struct VarPath {
    /// The base variable name.
    pub name: String,
    /// The accessor chain.
    pub access: Vec<Access>,
}

/// A Liquid value expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// A literal value.
    Literal(Literal),
    /// A variable lookup.
    Var(VarPath),
    /// A range `(start..end)`.
    Range {
        /// The start expression.
        start: Box<Expr>,
        /// The end expression.
        end: Box<Expr>,
    },
}

/// A filter argument: positional, or named (`key: value`).
#[derive(Debug, Clone, PartialEq)]
pub enum FilterArg {
    /// A positional argument.
    Positional(Expr),
    /// A named argument `key: value`.
    Named(String, Expr),
}

/// A filter application `| name: arg, …`.
#[derive(Debug, Clone, PartialEq)]
pub struct Filter {
    /// The filter name.
    pub name: String,
    /// The filter arguments.
    pub args: Vec<FilterArg>,
}

/// A comparison operator in a Liquid condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpOp {
    /// `==`
    Eq,
    /// `!=` / `<>`
    Ne,
    /// `>`
    Gt,
    /// `<`
    Lt,
    /// `>=`
    Ge,
    /// `<=`
    Le,
    /// `contains`
    Contains,
}

/// A Liquid condition (used by `if` / `unless` / `elsif`).
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// A comparison, or (when `op` is `None`) a bare truthiness test.
    Compare {
        /// The left operand.
        left: Expr,
        /// The operator, or `None` for a truthiness test.
        op: Option<CmpOp>,
        /// The right operand (present iff `op` is `Some`).
        right: Option<Expr>,
    },
    /// `a and b`.
    And(Box<Condition>, Box<Condition>),
    /// `a or b`.
    Or(Box<Condition>, Box<Condition>),
}

/// Iteration parameters on a `for` / `tablerow` tag.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ForParams {
    /// `limit: n`.
    pub limit: Option<Expr>,
    /// `offset: n` (or `offset: continue`, recorded as a `continue` variable).
    pub offset: Option<Expr>,
    /// `cols: n` (tablerow only).
    pub cols: Option<Expr>,
    /// `reversed`.
    pub reversed: bool,
}

/// A `when` clause's value(s) plus its body.
#[derive(Debug, Clone, PartialEq)]
pub struct WhenArm {
    /// The matched values (`when a or b` / `when a, b`).
    pub values: Vec<Expr>,
    /// The arm body.
    pub body: Vec<Node>,
}

/// A theme-tag parameter (`include`/`render`/`section` markup beyond the target).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ThemeArgs {
    /// `with expr` — bind the target's default variable.
    pub with: Option<Expr>,
    /// `for expr` — iterate the target over a collection.
    pub for_each: Option<Expr>,
    /// `as alias` — the bound variable name for `with`/`for`.
    pub alias: Option<String>,
    /// Trailing `key: value` parameters.
    pub params: Vec<(String, Expr)>,
}

/// A Liquid template node.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// Literal text.
    Text {
        /// The source span.
        span: Span,
        /// The literal text (mutated by whitespace control).
        text: String,
    },
    /// An object output `{{ expr | filters }}`.
    Output {
        /// The whole `{{ }}` span.
        span: Span,
        /// The value expression.
        expr: Expr,
        /// The applied filters, in order.
        filters: Vec<Filter>,
    },
    /// `{% if %}` / `{% elsif %}` / `{% else %}` / `{% endif %}`.
    If {
        /// The whole construct span.
        span: Span,
        /// The `if`/`elsif` branches, in order, each a condition + body.
        branches: Vec<(Condition, Vec<Node>)>,
        /// The `else` body, if present.
        otherwise: Option<Vec<Node>>,
    },
    /// `{% unless %}…{% else %}…{% endunless %}`.
    Unless {
        /// The whole construct span.
        span: Span,
        /// The guard condition.
        condition: Condition,
        /// The body rendered when the condition is falsy.
        body: Vec<Node>,
        /// The `else` body, if present.
        otherwise: Option<Vec<Node>>,
    },
    /// `{% case %}{% when %}…{% else %}{% endcase %}`.
    Case {
        /// The whole construct span.
        span: Span,
        /// The subject expression.
        subject: Expr,
        /// The `when` arms.
        whens: Vec<WhenArm>,
        /// The `else` body, if present.
        otherwise: Option<Vec<Node>>,
    },
    /// `{% for x in coll … %}…{% else %}…{% endfor %}`.
    For {
        /// The whole construct span.
        span: Span,
        /// The loop variable.
        var: String,
        /// The iterated collection or range.
        iterable: Expr,
        /// Iteration parameters.
        params: ForParams,
        /// The loop body.
        body: Vec<Node>,
        /// The `else` body (rendered when the collection is empty), if present.
        otherwise: Option<Vec<Node>>,
    },
    /// `{% tablerow x in coll … %}…{% endtablerow %}`.
    TableRow {
        /// The whole construct span.
        span: Span,
        /// The loop variable.
        var: String,
        /// The iterated collection or range.
        iterable: Expr,
        /// Iteration parameters.
        params: ForParams,
        /// The row body.
        body: Vec<Node>,
    },
    /// `{% break %}`.
    Break {
        /// The tag span.
        span: Span,
    },
    /// `{% continue %}`.
    Continue {
        /// The tag span.
        span: Span,
    },
    /// `{% assign x = expr | filters %}`.
    Assign {
        /// The tag span.
        span: Span,
        /// The assigned variable name.
        target: String,
        /// The value expression.
        value: Expr,
        /// Filters applied to the value.
        filters: Vec<Filter>,
    },
    /// `{% capture x %}…{% endcapture %}`.
    Capture {
        /// The whole construct span.
        span: Span,
        /// The captured variable name.
        target: String,
        /// The captured body.
        body: Vec<Node>,
    },
    /// `{% increment x %}`.
    Increment {
        /// The tag span.
        span: Span,
        /// The counter name.
        target: String,
    },
    /// `{% decrement x %}`.
    Decrement {
        /// The tag span.
        span: Span,
        /// The counter name.
        target: String,
    },
    /// `{% cycle "a", "b" %}` or `{% cycle group: "a", "b" %}`.
    Cycle {
        /// The tag span.
        span: Span,
        /// The optional cycle group name.
        group: Option<Expr>,
        /// The cycle values.
        values: Vec<Expr>,
    },
    /// `{% include target … %}` (the legacy include).
    Include {
        /// The tag span.
        span: Span,
        /// The included template name expression.
        target: Expr,
        /// Theme-tag arguments.
        args: ThemeArgs,
    },
    /// `{% render target … %}` (the isolated-scope include).
    Render {
        /// The tag span.
        span: Span,
        /// The rendered template name expression.
        target: Expr,
        /// Theme-tag arguments.
        args: ThemeArgs,
    },
    /// `{% section "name" %}` (Shopify).
    Section {
        /// The tag span.
        span: Span,
        /// The section name expression.
        name: Expr,
    },
    /// `{% echo expr | filters %}` (the `liquid`-tag output form).
    Echo {
        /// The tag span.
        span: Span,
        /// The value expression.
        expr: Expr,
        /// The applied filters.
        filters: Vec<Filter>,
    },
    /// `{% liquid … %}` — a sequence of newline-separated tag statements.
    Liquid {
        /// The tag span.
        span: Span,
        /// The parsed inner statements.
        body: Vec<Node>,
    },
    /// `{% ifchanged %}…{% endifchanged %}`.
    IfChanged {
        /// The whole construct span.
        span: Span,
        /// The guarded body.
        body: Vec<Node>,
    },
    /// `{% raw %}…{% endraw %}` — verbatim content.
    Raw {
        /// The whole construct span.
        span: Span,
        /// The verbatim content.
        content: String,
    },
    /// `{% comment %}…{% endcomment %}` — discarded content (kept for fidelity).
    Comment {
        /// The whole construct span.
        span: Span,
        /// The comment content.
        content: String,
    },
    /// An inline comment `{% # … %}` (the shorthand comment).
    InlineComment {
        /// The tag span.
        span: Span,
        /// The comment text.
        text: String,
    },
    /// An unrecognised (custom / host-defined) inline tag, preserved verbatim.
    Unknown {
        /// The tag span.
        span: Span,
        /// The tag name.
        name: String,
        /// The raw markup after the tag name.
        markup: String,
    },
}
