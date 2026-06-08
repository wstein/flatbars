//! # trussbars-template
//!
//! The **Trussbars v2** compile pipeline as a library: a byte-span lexer, parser,
//! and desugar for the MaxBars subset, plus the Rust emitter. The `trussbars-macros`
//! proc-macro drives it at compile time; the *runtime* a compiled template links
//! against stays `trussbars-core` / `trussbars-std`.
//!
//! Design: `trussbars/docs/08-v2-parser.md`. The v1 PureScript emitter
//! (`MaxBars/Rust.purs`) is the **emit reference**, and the 56-case conformance
//! corpus pins the whole pipeline byte-for-byte — so each stage is built test-first
//! against it (docs/08 §6: lexer → expr → blocks+desugar → emit → diagnostics).
//!
//! Spans are **load-bearing twice**: for diagnostics (docs/07) and for the
//! inspect/provenance map (docs/10). Every node carries byte [`span::Span`]s from
//! the lexer down, so both consumers get exact template coordinates.
//!
//! Status: **lexer landed** (the first slice). Parser, desugar, and emit follow.

pub mod ast;
pub mod lex;
pub mod parse_expr;
pub mod span;

pub use ast::{Cond, Each, Expr, Node, Value, With};
pub use lex::{Lexeme, Sigil, lex};
pub use parse_expr::{ParseError, Scope, parse_expr};
pub use span::Span;
