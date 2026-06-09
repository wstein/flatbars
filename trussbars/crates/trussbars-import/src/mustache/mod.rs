//! The **Mustache** dialect (spec v1.4, including the optional inheritance and
//! dynamic-names modules): variables, (inverted) sections, comments, partials,
//! set-delimiters, dotted names, the implicit iterator, and standalone-line
//! whitespace handling.
//!
//! See `<https://github.com/mustache/spec>`. Lambdas are a *runtime* concern — the
//! parser records the section/variable name and leaves evaluation to the host.

pub mod ast;
pub mod parse;

pub use ast::{Name, Node};
pub use parse::parse;
