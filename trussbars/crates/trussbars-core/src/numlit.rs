//! `NumLit` — the coercing wrapper for a *numeric literal operand* (docs/20, F2).
//!
//! The emitter wraps a numeric literal that sits in comparison/arithmetic position — the
//! `100` in `{% if views > 100 %}` — as [`NumLit`] rather than a bare `f64`. `NumLit`
//! compares and does arithmetic against **any** numeric field type (`i64`, `u32`, `f64`, …)
//! by widening that operand to `f64`, the engine's number model (spec §8). So
//! `{% if views > 100 %}` compiles whether the host declares `views: i64` or `views: f64`,
//! instead of forcing `f64`.
//!
//! It is emitted **only** in operator-operand position, so:
//! - non-numeric operands are untouched — `{% if name < "m" %}` keeps native string ordering;
//! - a string-vs-number comparison (`{% if name > 100 %}`) has no impl and is a **compile
//!   error**, the §5.1/§5.3 "footgun → caught" discipline (the interpreter would render it
//!   as a silent `false`);
//! - arithmetic yields `f64` (the number model), so `i64_field + 1` is `f64` — a deliberate
//!   consequence, not integer arithmetic.
//!
//! `NumLit` is intentionally **not** `Truthy`/`TruthyIn`, so a bare-number condition
//! (`{% if 1 %}`) stays the §5.3 compile error.

use core::cmp::Ordering;
use core::ops::{Add, Div, Mul, Sub};

/// A numeric literal carried as `f64`, coercing against any numeric type in operator
/// position. See the module docs (docs/20).
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct NumLit(pub f64);

/// Generate the comparison + arithmetic impls between `NumLit` and each numeric type, both
/// directions, widening the numeric operand to `f64`.
macro_rules! impl_numlit {
    ($($t:ty),+ $(,)?) => {$(
        impl PartialEq<NumLit> for $t {
            #[inline]
            fn eq(&self, other: &NumLit) -> bool { (*self as f64) == other.0 }
        }
        impl PartialEq<$t> for NumLit {
            #[inline]
            fn eq(&self, other: &$t) -> bool { self.0 == (*other as f64) }
        }
        impl PartialOrd<NumLit> for $t {
            #[inline]
            fn partial_cmp(&self, other: &NumLit) -> Option<Ordering> {
                (*self as f64).partial_cmp(&other.0)
            }
        }
        impl PartialOrd<$t> for NumLit {
            #[inline]
            fn partial_cmp(&self, other: &$t) -> Option<Ordering> {
                self.0.partial_cmp(&(*other as f64))
            }
        }
        impl Add<NumLit> for $t {
            type Output = f64;
            #[inline]
            fn add(self, r: NumLit) -> f64 { (self as f64) + r.0 }
        }
        impl Add<$t> for NumLit {
            type Output = f64;
            #[inline]
            fn add(self, r: $t) -> f64 { self.0 + (r as f64) }
        }
        impl Sub<NumLit> for $t {
            type Output = f64;
            #[inline]
            fn sub(self, r: NumLit) -> f64 { (self as f64) - r.0 }
        }
        impl Sub<$t> for NumLit {
            type Output = f64;
            #[inline]
            fn sub(self, r: $t) -> f64 { self.0 - (r as f64) }
        }
        impl Mul<NumLit> for $t {
            type Output = f64;
            #[inline]
            fn mul(self, r: NumLit) -> f64 { (self as f64) * r.0 }
        }
        impl Mul<$t> for NumLit {
            type Output = f64;
            #[inline]
            fn mul(self, r: $t) -> f64 { self.0 * (r as f64) }
        }
        impl Div<NumLit> for $t {
            type Output = f64;
            #[inline]
            fn div(self, r: NumLit) -> f64 { (self as f64) / r.0 }
        }
        impl Div<$t> for NumLit {
            type Output = f64;
            #[inline]
            fn div(self, r: $t) -> f64 { self.0 / (r as f64) }
        }
    )+};
}

impl_numlit!(
    i8, i16, i32, i64, i128, u8, u16, u32, u64, u128, isize, usize, f32, f64
);

// Two literals (`{{add 1 2}}`, `{% if 1 < 2 %}`): arithmetic yields `f64`; ordering/equality
// come from the derived `PartialOrd`/`PartialEq` above.
impl Add for NumLit {
    type Output = f64;
    #[inline]
    fn add(self, r: NumLit) -> f64 {
        self.0 + r.0
    }
}
impl Sub for NumLit {
    type Output = f64;
    #[inline]
    fn sub(self, r: NumLit) -> f64 {
        self.0 - r.0
    }
}
impl Mul for NumLit {
    type Output = f64;
    #[inline]
    fn mul(self, r: NumLit) -> f64 {
        self.0 * r.0
    }
}
impl Div for NumLit {
    type Output = f64;
    #[inline]
    fn div(self, r: NumLit) -> f64 {
        self.0 / r.0
    }
}

#[cfg(test)]
mod tests {
    use super::NumLit;

    #[test]
    fn compares_against_integer_and_float_fields() {
        // The F2 case: a literal vs an i64 field, both directions.
        let views_i64: i64 = 150;
        assert!(views_i64 > NumLit(100.0));
        assert!(NumLit(100.0) < views_i64);
        assert!(views_i64 != NumLit(100.0));
        // …and the same literal vs an f64 field stays exact.
        let ratio_f64: f64 = 0.5;
        assert!(ratio_f64 < NumLit(1.0));
        assert!(NumLit(0.5) == ratio_f64);
    }

    #[test]
    fn arithmetic_widens_to_f64() {
        let n: i64 = 41;
        let r: f64 = n + NumLit(1.0);
        assert_eq!(r, 42.0);
        assert_eq!(NumLit(2.0) * NumLit(3.0), 6.0);
        assert_eq!(10u32 / NumLit(4.0), 2.5); // float division under the f64 model
    }
}
