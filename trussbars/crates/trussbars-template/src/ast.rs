//! The **desugared core AST** the emitter walks — the same shape the v1 PureScript
//! emitter (`MaxBars/Rust.purs`) consumes, so slice 4 (emit) is a transcription:
//! every expression is an `App`/`Lit`, paths are `lookup` chains, operators and
//! pipes are `App` calls. Nodes are a clean structured tree (the v1 marker/
//! `splitBlockArgs` plumbing is replaced by typed fields).

use crate::span::Span;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// The truthiness policy a template compiles/renders under (runtime API §3, spec §7,
/// `docs/16-truthiness-modes.md`). The default [`TruthMode::NonEmpty`] is the one fixed
/// Trussbars rule and the only one the conformance corpus is checked against; the others
/// are opt-in (AOT: `truss!(…, truthiness = Liquid)`; VM: `Template::with_truthiness`) and
/// out of conformance. It lives here (not in the std-only `emit` module) so the
/// `no_std` VM can name it too; the emitter adds the codegen half.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum TruthMode {
    /// `nonEmpty` minus numbers — the default; a bare-number condition is a compile error.
    #[default]
    NonEmpty,
    /// Liquid: only `false`/`nil` are falsy.
    Liquid,
    /// Handlebars: `false`/`null`/`0`/`NaN`/`""`/`[]` falsy, `{}` truthy.
    Handlebars,
}

impl TruthMode {
    /// Parse the `truss!(…, truthiness = <ident>)` / `--truthiness=<ident>` marker name.
    /// `None` for an unrecognized name (the caller reports it as a located error).
    #[must_use]
    pub fn from_ident(name: &str) -> Option<Self> {
        match name {
            "NonEmpty" => Some(Self::NonEmpty),
            "Liquid" => Some(Self::Liquid),
            "Handlebars" => Some(Self::Handlebars),
            _ => None,
        }
    }
}

/// The truthiness policy the **AOT emitter** compiles a template under: either a built-in
/// [`TruthMode`] marker, or a *host-defined* policy named by its Rust type path
/// (`truss!(…, truthiness = self::MyMode)`), emitted verbatim as the type argument of
/// `truthy_in::<Path, _>`. This richer form is AOT-only — a host `TruthyIn<Mode>` impl is
/// resolved at compile time, so the dynamic VM keeps the closed [`TruthMode`] enum
/// (`docs/16-truthiness-modes.md`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TruthPolicy {
    /// One of the three built-in, `trussbars-core`-provided policy markers.
    Builtin(TruthMode),
    /// A host-defined marker, named by its Rust type path (e.g. `self::NonBlank`).
    Custom(String),
}

impl Default for TruthPolicy {
    fn default() -> Self {
        Self::Builtin(TruthMode::NonEmpty)
    }
}

impl From<TruthMode> for TruthPolicy {
    fn from(mode: TruthMode) -> Self {
        Self::Builtin(mode)
    }
}

/// A literal value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// A string literal.
    Str(String),
    /// A number (the engine's `f64` model).
    Num(f64),
    /// `true` / `false`.
    Bool(bool),
    /// `null`.
    Null,
}

/// A desugared expression: a literal, or a named application (`head args…`).
///
/// Paths are `App("lookup", [root, Lit(Str key)…])`; operators are
/// `App("add"/"eq"/…, [a, b])`; reserved roots are `App("this"/"root"/"loop"/
/// "@parentchain", [])`; helpers/host calls are `App(name, args)`.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// A literal value.
    Lit(Value),
    /// A named application: the head name and its argument expressions.
    App(String, Vec<Expr>),
}

impl Expr {
    /// A nullary application `App(name, [])` (a reserved root or a bare binding).
    #[must_use]
    pub fn nullary(name: &str) -> Self {
        Expr::App(name.to_string(), Vec::new())
    }

    /// A string literal.
    #[must_use]
    pub fn str(s: &str) -> Self {
        Expr::Lit(Value::Str(s.to_string()))
    }
}

/// A template node (the parsed, desugared tree).
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// Literal content.
    Text(String),
    /// `{{ expr }}` (escaped) or `{{{ expr }}}` (raw, `raw = true`).
    Output {
        /// The originating tag span.
        span: Span,
        /// The desugared expression.
        expr: Expr,
        /// Whether this is raw (`{{{ }}}`) output (no HTML escaping).
        raw: bool,
    },
    /// `{% for item [i] in coll [label name] %}…{% else %}…{% endfor %}`.
    For(For),
    /// `{% if %}` / `{% unless %}` (`negated`) with `{{else if}}` / `{% else %}` arms.
    Cond(Cond),
    /// `{% case subject %}{% when V… %}…{% else %}…{% endcase %}` — the multi-arm conditional.
    Case(Case),
    /// `{% with subject %}…{% else %}…{% endwith %}` (re-root).
    With(With),
    /// `{% let a=(e) b=(e)… %}…{% endlet %}` — sequential block-scoped aliases.
    Let {
        /// The tag span.
        span: Span,
        /// The `(name, value)` bindings in order (a later value sees an earlier name).
        bindings: Vec<(String, Expr)>,
        /// The body, rendered with the aliases in scope.
        body: Vec<Node>,
    },
    /// `{{> name [ctx]}}` — a partial reference.
    Partial {
        /// The tag span.
        span: Span,
        /// The partial name.
        name: String,
        /// An explicit context expression, if given.
        ctx: Option<Expr>,
    },
    /// `{% inline "name" %}…{% endinline %}` — a partial definition (hoisted at emit).
    Inline {
        /// The tag span.
        span: Span,
        /// The partial name.
        name: String,
        /// The definition body.
        body: Vec<Node>,
    },
    /// `{% partial "name" [ctx] %}…{% endpartial %}` — render the body in the caller
    /// frame and splice it at the named partial's `{{yield}}`.
    PartialBlock {
        /// The tag span.
        span: Span,
        /// The partial name.
        name: String,
        /// An explicit context expression, if given.
        ctx: Option<Expr>,
        /// The body to render as the yield.
        body: Vec<Node>,
    },
    /// `{{yield}}` — splice the block partial's pre-rendered body.
    Yield {
        /// The tag span.
        span: Span,
    },
    /// `{{{{#raw}}}}body{{{{/raw}}}}` — verbatim body.
    RawBlock {
        /// The tag span.
        span: Span,
        /// The verbatim body text.
        body: String,
    },
    /// `{% name args… %}body{% endname %}` — a host **block** helper (docs/09). The parser is
    /// meaning-free: any block head that is not a built-in becomes this, and the emitter /
    /// VM resolve `head` against the declared allow-list (an undeclared head is a located
    /// "unknown helper"). The helper is `fn name(args…, body: impl Fn() -> String) -> R`
    /// (`R`: `String`/`Safe`); the body renders the inner nodes in the enclosing scope.
    HelperBlock(HelperBlock),
}

/// `{% name args… %}body{% endname %}` data — a host block-helper invocation.
#[derive(Debug, Clone, PartialEq)]
pub struct HelperBlock {
    /// The tag span.
    pub span: Span,
    /// The helper name (the block head).
    pub head: String,
    /// The positional arguments after the head.
    pub args: Vec<Expr>,
    /// The block body, rendered (in the enclosing scope) by the helper's closure.
    pub body: Vec<Node>,
}

impl Node {
    /// The originating tag span (for diagnostics / provenance).
    #[must_use]
    pub fn span(&self) -> Span {
        match self {
            Node::Text(_) => Span::new(0, 0),
            Node::Output { span, .. }
            | Node::Let { span, .. }
            | Node::Partial { span, .. }
            | Node::Inline { span, .. }
            | Node::PartialBlock { span, .. }
            | Node::Yield { span }
            | Node::RawBlock { span, .. } => *span,
            Node::For(e) => e.span,
            Node::Cond(c) => c.span,
            Node::Case(c) => c.span,
            Node::With(w) => w.span,
            Node::HelperBlock(b) => b.span,
        }
    }
}

/// `{% for item [i] in coll %}` data.
#[derive(Debug, Clone, PartialEq)]
pub struct For {
    /// The tag span.
    pub span: Span,
    /// The collection expression.
    pub subject: Expr,
    /// The element binding name, if any.
    pub item: Option<String>,
    /// The 0-based index binding name, if any.
    pub index: Option<String>,
    /// A `label NAME` (the `outer` labelled loop), if any.
    pub label: Option<String>,
    /// The loop body.
    pub body: Vec<Node>,
    /// The `{% else %}` (empty-collection) arm.
    pub otherwise: Vec<Node>,
}

/// `{% if %}` / `{% unless %}` data.
#[derive(Debug, Clone, PartialEq)]
pub struct Cond {
    /// The tag span.
    pub span: Span,
    /// Whether this is `{% unless %}` (the condition is inverted).
    pub negated: bool,
    /// The condition.
    pub cond: Expr,
    /// The `then` body.
    pub body: Vec<Node>,
    /// `{{else if cond}}` arms, in order.
    pub elifs: Vec<(Expr, Vec<Node>)>,
    /// The trailing `{% else %}` body.
    pub otherwise: Vec<Node>,
}

/// `{% case subject %}{% when V… %}…{% else %}…{% endcase %}` data — the multi-arm conditional
/// (docs/12). First-class so the emitter lowers it to a Rust `match` (the subject evaluated
/// once as the scrutinee) rather than a repeated-`eq` `if`-chain.
#[derive(Debug, Clone, PartialEq)]
pub struct Case {
    /// The tag span.
    pub span: Span,
    /// The subject, evaluated once and compared against each arm's value(s).
    pub subject: Expr,
    /// The `{% when V… %}` arms in order: each arm's match value(s) and its body.
    pub arms: Vec<(Vec<Expr>, Vec<Node>)>,
    /// The trailing `{% else %}` body (empty when absent).
    pub otherwise: Vec<Node>,
}

/// `{% scope subject %}` data (the context re-root; renamed from `with`, ADR-039).
#[derive(Debug, Clone, PartialEq)]
pub struct With {
    /// The tag span.
    pub span: Span,
    /// The subject to re-root onto (and test for truthiness).
    pub subject: Expr,
    /// The body, rendered in the subject's scope when truthy.
    pub body: Vec<Node>,
    /// The `{% else %}` (falsy) body.
    pub otherwise: Vec<Node>,
}
