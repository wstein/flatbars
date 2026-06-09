//! The **Liquid** dialect (Shopify/Jekyll family): object outputs `{{ expr | filter }}`
//! with chained, named-argument filters; the full core tag set — control flow
//! (`if`/`elsif`/`else`/`unless`/`case`/`when`), iteration (`for`/`tablerow` with
//! `limit`/`offset`/`reversed`, `break`/`continue`), variable (`assign`, `capture`,
//! `increment`/`decrement`), theme (`include`/`render`/`section`), and utility
//! (`raw`, `comment`, `liquid`, `echo`, `cycle`, `ifchanged`) tags — plus ranges,
//! conditions, and `{{- -}}` / `{%- -%}` whitespace control. Unknown tags are
//! preserved verbatim as [`ast::Node::Unknown`].
//!
//! See `<https://shopify.github.io/liquid/>`. Filter and tag *semantics* are a
//! runtime concern; the parser records names, arguments, and structure only.

pub mod ast;
pub mod lex;
pub mod parse;

pub use ast::{
    Access, CmpOp, Condition, Expr, Filter, FilterArg, ForParams, Literal, Node, ThemeArgs,
    VarPath, WhenArm,
};
pub use lex::{Tok, lex};
pub use parse::parse;
