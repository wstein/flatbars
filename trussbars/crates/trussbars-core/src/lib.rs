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
//! - [`Truthy`] / [`truthy`] — the `nonEmpty` truthiness rule, minus numbers
//!   ([`truthy`](mod@truthy)). A bare-number condition does not compile.
//! - [`Loop`] — the borrowed-reference loop frame model ([`frame`]): per-iteration
//!   `{{#each}}` metadata threaded by lexical nesting, no `Rc`, no heap frame.
//! - [`SizeHint`] — the adaptive output-capacity hint ([`capacity`]): a warm
//!   template reallocates at most once, however large the data.
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
mod text;
mod truthy;

pub use capacity::SizeHint;
pub use each::Each;
pub use frame::Loop;
pub use text::{Safe, ToText, esc, escape_html};
pub use truthy::{Truthy, truthy};

/// `#[derive(Trussbars)]` — generates the [`Truthy`] impl for a context struct.
/// Available with the `derive` feature; re-exported from `trussbars-derive`.
#[cfg(feature = "derive")]
pub use trussbars_derive::Trussbars;
