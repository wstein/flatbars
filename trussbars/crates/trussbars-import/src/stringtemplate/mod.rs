//! The **StringTemplate4** dialect (Terence Parr's StringTemplate): a strict
//! model/view template language with `<…>` interpolations. Two grammars share one
//! expression model:
//!
//! - [`parse_template`] parses a `.st` body — text, `<expr>`, `<if>`/`<elseif>`/
//!   `<else>`/`<endif>`, `<! comment !>`, and `<@region>` definitions; expressions
//!   cover attribute/property access (`a.b`, `a.(e)`), template includes (`t(args)`,
//!   `(e)(args)`), the `:` map/apply operator (with anonymous subtemplates `{x | …}`
//!   and multiple targets `a,b:t()`), lists, string/bool literals, the conditional
//!   operators `!`/`&&`/`||`, and `; option=value` settings.
//! - [`parse_group`] parses a `.stg` group file — the `delimiters`/`import`/`group`
//!   header directives, named template / region definitions
//!   (`name(params) ::= "…"` / `<<…>>` / `<%…%>`), and dictionaries.
//!
//! See `<https://www.stringtemplate.org/>`. Both default to the `<` / `>`
//! delimiters; a group's `delimiters` directive overrides them for its bodies.

pub mod ast;
pub mod group;
pub mod lex;
pub mod template;

pub use ast::{
    Arg, Callee, DictDef, DictValue, Element, Expr, ExprWithOptions, Group, Mapper, Param, Prop,
    Subtemplate, TemplateDef,
};
pub use group::parse as parse_group;

/// Parse a `.st` template body with the default `<` / `>` delimiters.
///
/// # Errors
/// Returns a [`crate::ParseError`] on a lex failure, an unclosed block, or a malformed
/// expression.
pub fn parse_template(src: &str) -> Result<Vec<Element>, crate::ParseError> {
    template::parse(src, '<', '>')
}
