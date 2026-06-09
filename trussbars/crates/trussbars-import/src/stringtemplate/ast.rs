//! The StringTemplate4 AST — both a template body (`.st`) and a group file (`.stg`).
//!
//! A template is a list of [`Element`]s (text, `<expr>` interpolations, `<if>`
//! conditionals, `<! comment !>`, and `<@region>` definitions). An expression
//! ([`Expr`]) covers attribute / property access, template includes, `:` map/apply
//! (with anonymous subtemplates and multiple targets), lists, string/bool literals,
//! and the conditional operators `!` / `&&` / `||`; trailing `; option=value`
//! settings are carried by [`ExprWithOptions`]. A group ([`Group`]) is the header
//! directives plus the named template / region / dictionary definitions.

use crate::Span;

/// A template element.
#[derive(Debug, Clone, PartialEq)]
pub enum Element {
    /// Literal text (escapes like `<\n>` / `\<` already decoded).
    Text {
        /// The source span.
        span: Span,
        /// The literal text.
        text: String,
    },
    /// An expression interpolation `<expr; options>`.
    Expr {
        /// The whole `<…>` span.
        span: Span,
        /// The expression and its options.
        value: ExprWithOptions,
    },
    /// A conditional `<if(c)>…<elseif(c)>…<else>…<endif>`.
    If {
        /// The whole construct span.
        span: Span,
        /// The `if` condition.
        condition: Expr,
        /// The `then` body.
        body: Vec<Element>,
        /// The `<elseif(c)>` arms, in order.
        elseifs: Vec<(Expr, Vec<Element>)>,
        /// The `<else>` body, if present.
        otherwise: Option<Vec<Element>>,
    },
    /// A comment `<! … !>`.
    Comment {
        /// The whole span.
        span: Span,
        /// The comment text.
        text: String,
    },
    /// An inline region definition `<@name>…<@end>`.
    Region {
        /// The whole construct span.
        span: Span,
        /// The region name.
        name: String,
        /// The region body.
        body: Vec<Element>,
    },
}

/// An expression plus its trailing `; key=value` option settings (separator, null,
/// wrap, anchor, format, …).
#[derive(Debug, Clone, PartialEq)]
pub struct ExprWithOptions {
    /// The core expression.
    pub expr: Expr,
    /// The option settings, in order.
    pub options: Vec<(String, Expr)>,
}

/// A property name following a `.` — a static name, or a dynamic `(expr)`.
#[derive(Debug, Clone, PartialEq)]
pub enum Prop {
    /// A static property name `.name`.
    Name(String),
    /// A dynamic property `.(expr)`.
    Dynamic(Box<Expr>),
}

/// The callee of an include or map application.
#[derive(Debug, Clone, PartialEq)]
pub enum Callee {
    /// A named template `t(args)`.
    Named(String),
    /// An indirect template `(expr)(args)`.
    Indirect(Box<Expr>),
}

/// An argument to an include / template application.
#[derive(Debug, Clone, PartialEq)]
pub enum Arg {
    /// A positional argument.
    Positional(Expr),
    /// A named argument `name=expr`.
    Named(String, Expr),
    /// The pass-through `...`.
    Ellipsis,
}

/// A map/apply target on the right of `:`.
#[derive(Debug, Clone, PartialEq)]
pub enum Mapper {
    /// Apply a (named or indirect) template.
    Template {
        /// The template callee.
        callee: Callee,
        /// The extra arguments.
        args: Vec<Arg>,
    },
    /// Apply an anonymous subtemplate `{x | …}`.
    Anon(Subtemplate),
}

/// An anonymous subtemplate `{params | body}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Subtemplate {
    /// The formal parameter names (empty for `{body}` with the implicit `it`).
    pub params: Vec<String>,
    /// The subtemplate body.
    pub body: Vec<Element>,
}

/// A StringTemplate expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// An attribute / template-name reference.
    Attr(String),
    /// A string literal.
    Str(String),
    /// `true` / `false`.
    Bool(bool),
    /// A property access `obj.prop`.
    Prop {
        /// The object expression.
        object: Box<Expr>,
        /// The property.
        prop: Prop,
    },
    /// An include / function call `t(args)` or `(expr)(args)`.
    Include {
        /// The callee.
        callee: Callee,
        /// The arguments.
        args: Vec<Arg>,
    },
    /// A `:` map/apply `targets : mappers`.
    Map {
        /// The mapped target expressions (`a, b : …`).
        targets: Vec<Expr>,
        /// The chain of applications.
        mappers: Vec<Mapper>,
    },
    /// An anonymous subtemplate used as a value.
    Anon(Subtemplate),
    /// A list literal `[a, b, …]`.
    List(Vec<Expr>),
    /// Negation `!expr` (conditionals).
    Not(Box<Expr>),
    /// Conjunction `a && b` (conditionals).
    And(Box<Expr>, Box<Expr>),
    /// Disjunction `a || b` (conditionals).
    Or(Box<Expr>, Box<Expr>),
}

/// A `.stg` group file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Group {
    /// The `group Name;` name, if declared.
    pub name: Option<String>,
    /// The `delimiters "<", ">"` override, if declared.
    pub delimiters: Option<(String, String)>,
    /// The `import "file"` directives.
    pub imports: Vec<String>,
    /// The template / region definitions.
    pub templates: Vec<TemplateDef>,
    /// The dictionary definitions.
    pub dicts: Vec<DictDef>,
}

/// A formal parameter of a group template definition.
#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    /// The parameter name.
    pub name: String,
    /// The default value expression, if any (`name=value`).
    pub default: Option<Expr>,
}

/// A template (or region) definition `name(params) ::= body`.
#[derive(Debug, Clone, PartialEq)]
pub struct TemplateDef {
    /// The whole definition span.
    pub span: Span,
    /// The template name (a region def's name includes its `@enclosing.region` form).
    pub name: String,
    /// The formal parameters.
    pub params: Vec<Param>,
    /// The parsed body.
    pub body: Vec<Element>,
}

/// A dictionary value.
#[derive(Debug, Clone, PartialEq)]
pub enum DictValue {
    /// A string value.
    Str(String),
    /// An expression value (e.g. an anonymous template or attribute).
    Expr(Expr),
    /// `key` with no value (the bare-key form) / an empty value.
    Empty,
}

/// A dictionary definition `name ::= [ "k": v, …, default: v ]`.
#[derive(Debug, Clone, PartialEq)]
pub struct DictDef {
    /// The whole definition span.
    pub span: Span,
    /// The dictionary name.
    pub name: String,
    /// The `(key, value)` entries, in order.
    pub entries: Vec<(String, DictValue)>,
    /// The `default:` value, if present.
    pub default: Option<DictValue>,
}
