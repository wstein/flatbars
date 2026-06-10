//! # trussbars-core
//!
//! The value-free runtime substrate that compiled **Trussbars** templates link
//! against. Trussbars is the statically-typed subset of MaxBars compiled
//! ahead-of-time to straight-line Rust — there is **no interpreter, no `Value`
//! enum, and no string-keyed dispatch table** at render time. The compiler emits
//! native field accesses, `if`/`for`, and calls into the small surface this crate
//! provides:
//!
//! - [`Safe`] / [`ToText`] / [`escape_html`] / [`esc`] — the output layer
//!   ([`text`]). Stringification mirrors the reference engine's `stringify`, and
//!   escaping mirrors its `escapeHtml`, byte-for-byte (one deliberate exception:
//!   f64 formatting, which is out of scope for v1 — see the module docs).
//! - [`TruthyIn`] / [`truthy`] / [`truthy_in`] — truthiness under a named policy
//!   ([`truthy`](mod@truthy)). The default is `nonEmpty` minus numbers (a bare-number
//!   condition does not compile); [`Liquid`] / [`Handlebars`] and host-defined policies
//!   are selectable per render.
//! - [`Loop`] — the borrowed-reference loop frame model ([`frame`]): per-iteration
//!   `{% for %}` metadata threaded by lexical nesting, no `Rc`, no heap frame.
//! - [`SizeHint`] — the adaptive output-capacity hint ([`capacity`]): a warm
//!   template reallocates at most once, however large the data.
//! - [`NumLit`] — the numeric-literal wrapper ([`numlit`]): a literal in
//!   comparison/arithmetic position coerces against any numeric field type (`i64`/`u32`/
//!   `f64`) by widening to the `f64` number model (docs/20, F2).
//!
//! The design contract is the `trussbars/docs/` set: `01-subset-spec.md` (the
//! language), `02-runtime-api.md` (this crate's surface), and `04-conformance.md`
//! (how it is checked byte-identical against the reference interpreter). Keep this
//! crate and `02-runtime-api.md` in lockstep.
//!
//! This crate is `#![forbid(unsafe_code)]` — a small, auditable substrate is part
//! of the point. It is **`no_std`-capable**: it needs only `alloc` (`String`,
//! `Vec`, `BTreeMap`), so compiled templates run in embedded contexts. The default
//! `std` feature is on purely for ergonomics (it gates nothing in the code); build
//! `--no-default-features` for the pure, `no_std`, dependency-free substrate.
//! Enabling the `derive` feature re-exports [`macro@Trussbars`]
//! (`#[derive(Trussbars)]`) so a host depends on this crate alone.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

extern crate alloc;

mod capacity;
mod each;
mod frame;
mod numlit;
mod text;
mod truthy;

pub use capacity::SizeHint;
pub use each::Each;
pub use frame::Loop;
pub use numlit::NumLit;
pub use text::{Safe, ToText, esc, escape_html};
pub use truthy::{Handlebars, Liquid, NonEmpty, TruthyIn, truthy, truthy_in};

/// `#[derive(Trussbars)]` — generates [`TruthyIn`] for a context struct or enum (and
/// [`ToText`] for a fieldless enum, writing the variant name). Available with the
/// `derive` feature; re-exported from `trussbars-derive`.
#[cfg(feature = "derive")]
pub use trussbars_derive::Trussbars;
