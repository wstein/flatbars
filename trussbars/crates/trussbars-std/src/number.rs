//! Number pack — numeric subjects are `f64` (the reference coerces via `num`).
//! Results are numbers (`f64`) or strings; `to_fixed`'s formatting and the f64
//! string tail are in the conformance harness's numeric-masked bucket.

use crate::text;
use trussbars_core::ToText;

/// The `%` operator helper: the truncated-division remainder
/// (`a - b * (a / b).trunc()`), matching the reference's `x - y * Math.trunc(x / y)`.
/// The sign follows the dividend.
pub fn modulo(a: f64, b: f64) -> f64 {
    a - b * (a / b).trunc()
}

/// Absolute value (`abs`).
pub fn abs(n: f64) -> f64 {
    n.abs()
}

/// Round toward negative infinity (`floor`).
pub fn floor(n: f64) -> f64 {
    n.floor()
}

/// Round toward positive infinity (`ceil`).
pub fn ceil(n: f64) -> f64 {
    n.ceil()
}

/// Round to the nearest integer, half toward positive infinity (`round`).
///
/// This is JavaScript `Math.round` (`(n + 0.5).floor()`), which differs from
/// Rust's `f64::round` (half away from zero) for negative halves —
/// `round(-2.5) == -2.0`, not `-3.0`.
pub fn round(n: f64) -> f64 {
    (n + 0.5).floor()
}

/// Format with a fixed number of decimal places (`toFixed`). Negative `places`
/// is clamped to zero.
pub fn to_fixed(n: f64, places: i64) -> String {
    let places = places.max(0) as usize;
    format!("{n:.places$}")
}

/// Parse the subject's text and truncate to an integer (`toInt`); `None` when the
/// text is not a finite number.
pub fn to_int(subject: &(impl ToText + ?Sized)) -> Option<i64> {
    parse_finite(subject).map(|n| n.trunc() as i64)
}

/// Parse the subject's text as a floating-point number (`toFloat`); `None` when
/// the text is not a finite number.
pub fn to_float(subject: &(impl ToText + ?Sized)) -> Option<f64> {
    parse_finite(subject)
}

fn parse_finite(subject: &(impl ToText + ?Sized)) -> Option<f64> {
    text(subject)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modulo_is_truncated_remainder() {
        assert_eq!(modulo(7.0, 3.0), 1.0);
        // Truncated division: the sign follows the dividend (matches JS `%`).
        assert_eq!(modulo(-7.0, 3.0), -1.0);
        assert_eq!(modulo(7.0, -3.0), 1.0);
    }

    #[test]
    fn rounding_family() {
        assert_eq!(abs(-3.5), 3.5);
        assert_eq!(floor(2.9), 2.0);
        assert_eq!(ceil(2.1), 3.0);
    }

    #[test]
    fn round_uses_js_half_to_positive_infinity() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(2.4), 2.0);
        // The JS divergence from Rust's f64::round: half-negative rounds toward +∞.
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-2.6), -3.0);
    }

    #[test]
    fn to_fixed_formats() {
        assert_eq!(to_fixed(3.456, 2), "3.46");
        assert_eq!(to_fixed(2.0, 0), "2");
        assert_eq!(to_fixed(1.5, -1), "2"); // negative places clamps to 0
    }

    #[test]
    fn parsing_to_numbers() {
        assert_eq!(to_int(&"12"), Some(12));
        assert_eq!(to_int(&"12.9"), Some(12));
        assert_eq!(to_int(&"nope"), None);
        assert_eq!(to_float(&"3.5"), Some(3.5));
        assert_eq!(to_float(&""), None);
    }
}
