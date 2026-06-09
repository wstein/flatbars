//! The **Handlebars** dialect — a superset of Mustache. Adds helper calls with
//! positional and hash arguments, parenthesised subexpressions, rich paths (`../`,
//! `@data`, `this`, segment literals `[a b]`), block helpers with `{{else}}` /
//! `{{else if}}` chains and `as |x|` block params, partials / partial blocks /
//! inline partials, decorators, raw blocks, comments, and whitespace control.
//!
//! See `<https://handlebarsjs.com/>`. Helper *semantics* are a runtime concern; the
//! parser records names, arguments, and structure only.

pub mod ast;
pub mod lex;
pub mod parse;

pub use ast::{Expr, HashPair, Literal, Node, PartialName, Path};
pub use lex::{Tok, lex};
pub use parse::parse;
