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
//! Status: **complete** — lexer → parser → desugar → emit, gated 56/56
//! byte-identical to v1 (`conformance/harness.mjs --v2`). The `trussbars-macros`
//! proc-macro (`truss!`) drives this with located class-A diagnostics; class-B
//! exact spans (nightly `proc_macro_span`) and the `path=` form are follow-ups.
//!
//! **`no_std`-capable**: the front-end (lexer → parser → desugar → emit) needs only
//! `alloc`, so it builds for bare-metal/WASM targets. `--no-default-features` drops
//! the (code-inert) `std` feature. The dev CLIs in `src/bin/` stay `std` (host only).

#![cfg_attr(not(feature = "std"), no_std)]

#[macro_use]
extern crate alloc;

pub mod ast;
#[cfg(feature = "std")]
pub mod emit;
pub mod inherit;
pub mod lex;
pub mod parse;
pub mod parse_expr;
pub mod span;

pub use ast::{Case, Cond, Expr, For, Node, TruthMode, TruthPolicy, Value, With};
#[cfg(feature = "std")]
pub use emit::{emit, emit_named, emit_with_partials};
pub use lex::{Lexeme, Sigil, lex};
pub use parse::parse;
pub use parse_expr::{ParseError, Scope, parse_expr};
pub use span::Span;
