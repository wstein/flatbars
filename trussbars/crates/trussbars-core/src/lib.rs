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
//!
//! The design contract is the `trussbars/docs/` set: `01-subset-spec.md` (the
//! language), `02-runtime-api.md` (this crate's surface), and `04-conformance.md`
//! (how it is checked byte-identical against the reference interpreter). Keep this
//! crate and `02-runtime-api.md` in lockstep.
//!
//! This crate is std-only and `#![forbid(unsafe_code)]` — a small, auditable
//! substrate is part of the point.

mod text;

pub use text::{Safe, ToText, esc, escape_html};
