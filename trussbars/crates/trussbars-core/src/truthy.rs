//! Truthiness: the `nonEmpty` rule, minus numbers.
//!
//! Trussbars has one fixed truthiness rule (see `trussbars/docs/01-subset-spec.md`
//! §7), applied to **non-numeric** types only. Falsy: `false`, `None`/`()`, `""`,
//! `[]`, `{}`. Truthy: every other non-numeric value.
//!
//! **Numbers deliberately have no [`Truthy`] impl.** A bare-number condition such
//! as `{{#if count}}` therefore fails to compile, forcing an explicit comparison
//! (`{{#if count > 0}}`). This is the typed escape from the `0`-truthy (MaxBars)
//! / `0`-falsy (Handlebars) dilemma — rather than pick a rule, the coercion is
//! rejected (subset spec §5.3).

use std::collections::BTreeMap;

/// The `nonEmpty` truthiness predicate. Implemented for the non-numeric types a
/// template can place in a boolean position; **not** for numbers (see the module
/// docs) or context structs.
pub trait Truthy {
    /// Whether `self` is truthy under the `nonEmpty` rule.
    fn truthy(&self) -> bool;
}

/// Evaluate the `nonEmpty` truthiness of `v` — the emission for an `{{#if}}` /
/// `{{#unless}}` condition and the `&&` / `||` / `!` operators.
///
/// ```
/// use trussbars_core::truthy;
/// assert!(truthy(&"x"));
/// assert!(!truthy(&""));
/// assert!(!truthy(&Option::<&str>::None));
/// ```
///
/// Numbers have no [`Truthy`] impl, so a bare-number condition does not compile —
/// write the comparison instead:
///
/// ```compile_fail
/// use trussbars_core::truthy;
/// let _ = truthy(&5_i64); // error[E0277]: `i64: Truthy` is not satisfied
/// ```
pub fn truthy<T: Truthy + ?Sized>(v: &T) -> bool {
    v.truthy()
}

impl Truthy for bool {
    fn truthy(&self) -> bool {
        *self
    }
}

impl Truthy for str {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

impl Truthy for String {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

impl Truthy for crate::Safe {
    fn truthy(&self) -> bool {
        !self.0.is_empty()
    }
}

/// The `null` literal — falsy.
impl Truthy for () {
    fn truthy(&self) -> bool {
        false
    }
}

impl<T> Truthy for [T] {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

impl<T> Truthy for Vec<T> {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

impl<K, V> Truthy for BTreeMap<K, V> {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

impl<T: Truthy> Truthy for Option<T> {
    // `None` is falsy; `Some(v)` defers to `v` — so `Some("")` is falsy too,
    // matching the interpreter (absence and emptiness both fall through).
    fn truthy(&self) -> bool {
        self.as_ref().is_some_and(Truthy::truthy)
    }
}

impl<T: Truthy + ?Sized> Truthy for &T {
    fn truthy(&self) -> bool {
        (**self).truthy()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Safe;

    #[test]
    fn booleans_are_themselves() {
        assert!(truthy(&true));
        assert!(!truthy(&false));
    }

    #[test]
    fn strings_are_truthy_when_non_empty() {
        assert!(truthy(&"x"));
        assert!(!truthy(&""));
        assert!(truthy(&String::from("x")));
        assert!(!truthy(&String::new()));
    }

    #[test]
    fn safe_tests_its_content() {
        assert!(truthy(&Safe(String::from("x"))));
        assert!(!truthy(&Safe(String::new())));
    }

    #[test]
    fn collections_are_truthy_when_non_empty() {
        assert!(truthy(&vec![1]));
        assert!(!truthy(&Vec::<i32>::new()));
        let mut m = BTreeMap::new();
        assert!(!truthy(&m));
        m.insert("k", 1);
        assert!(truthy(&m));
    }

    #[test]
    fn null_and_none_are_falsy() {
        assert!(!truthy(&()));
        assert!(!truthy(&Option::<&str>::None));
    }

    #[test]
    fn option_defers_to_its_inner_value() {
        assert!(truthy(&Some("x")));
        // The key nonEmpty-through-Option case: Some("") is falsy.
        assert!(!truthy(&Some("")));
        assert!(truthy(&Some(vec![1])));
        assert!(!truthy(&Some(Vec::<i32>::new())));
    }

    #[test]
    fn references_delegate() {
        let s = String::from("x");
        let r = &s;
        assert!(truthy(r));
    }
}
