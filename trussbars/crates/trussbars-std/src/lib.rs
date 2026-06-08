//! # trussbars-std
//!
//! The Trussbars standard helper library — the monomorphized value helpers the
//! codegen calls for the homogeneous (uniform-typed) prelude operations. The
//! heterogeneous and short-circuiting operators (`&& || ! == ?? ?:`, arithmetic,
//! control flow) are emitted inline by the compiler and are **not** here; see
//! `trussbars/docs/02-runtime-api.md` §9/§11.
//!
//! Each helper mirrors the reference engine's behaviour: subjects and string
//! arguments are coerced with the reference `stringify` (the crate-internal
//! [`text`]); integer arguments are `i64` (the reference `int`/`Math.trunc`).
//! Operations on text are over Unicode scalar values (`char`), which matches the
//! reference's UTF-16 code units for ASCII/BMP input; the astral-plane tail, like
//! f64 formatting, is a documented divergence masked by the conformance harness.
//!
//! Deferred (not yet here, by design): `json`/`escape_json` (a serializer
//! dependency), the i18n pack (`t`/`number`/`date`/… — a host `Translator` seam),
//! and `sort_by`/`pluck`/`group_by` (the codegen emits field-access closures).

mod array;
mod number;
mod string;

pub use array::{
    at, count, join, reverse_slice, slice_includes, sort_by, take, take_right, unique,
};
pub use number::{abs, ceil, floor, modulo, round, to_fixed, to_float, to_int};
pub use string::{
    append, capitalize, ends_with, includes, lowercase, prepend, replace, reverse, slice,
    slice_range, split, starts_with, trim, trim_end, trim_start, truncate, truncate_with,
    uppercase,
};

use trussbars_core::{Safe, ToText};

/// Stringify a value to its raw text form — the in-crate equivalent of the
/// reference `stringify`, used to coerce helper subjects and string arguments.
pub(crate) fn text(v: &(impl ToText + ?Sized)) -> String {
    let mut s = String::new();
    v.write_text(&mut s);
    s
}

/// Mark a value's text form as already-safe markup (the `safe` helper) — the
/// result is emitted unescaped.
pub fn safe(v: &(impl ToText + ?Sized)) -> Safe {
    Safe(text(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_wraps_the_stringified_value() {
        assert_eq!(safe(&"a<b").0, "a<b");
        assert_eq!(safe(&42_i64).0, "42");
    }
}
