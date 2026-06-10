//! Truthiness: the `nonEmpty` rule by default, selectable per render to another
//! template family's policy.
//!
//! [`TruthyIn<Mode>`] answers whether a value is truthy *under a named policy
//! `Mode`*. The default `Mode` is [`NonEmpty`] — the one fixed Trussbars rule
//! (`trussbars/docs/01-subset-spec.md` §7): falsy is `false`, `None`/`()`, `""`,
//! `[]`, `{}`; truthy is every other non-numeric value; and **numbers have no
//! [`NonEmpty`] impl**, so a bare-number condition (`{{#if count}}`) does not
//! compile — write the comparison (`{{#if count > 0}}`, §5.3).
//!
//! Two further built-in policies ship for hosts that want a different family's
//! semantics (selected with `truss!(…, truthiness = Liquid)`; out of conformance,
//! §11): [`Liquid`] (only `false`/`nil` are falsy — `0`, `""`, `[]`, `{}` are all
//! truthy) and [`Handlebars`] (`false`/`null`/`0`/`NaN`/`""`/`[]` falsy, `{}`
//! truthy). Because `Mode` is a *type parameter* of the trait, a host can define
//! its **own** policy over the standard library's types and its own newtypes alike
//! — `impl TruthyIn<MyMode> for str` is permitted even though `str` is foreign,
//! because the marker `MyMode` is local (the orphan rule's covered-parameter case;
//! `docs/15-truthiness-modes.md`). Every policy is monomorphized, so selecting one
//! costs nothing at runtime.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

/// Truthiness under a named policy `Mode` — the per-type half of the rule the
/// compiler emits for an `{{#if}}` / `{{#unless}}` condition and the `&&` / `||` /
/// `!` operators. A type that has no `TruthyIn<Mode>` impl cannot appear in a
/// boolean position under that policy: the condition is a compile error, not a
/// silent `false` (numbers under [`NonEmpty`], for example).
pub trait TruthyIn<Mode> {
    /// Whether `self` is truthy under `Mode`.
    fn truthy(&self) -> bool;
}

/// The default Trussbars policy (`nonEmpty`, minus numbers): `false`, `None`/`()`,
/// `""`, `[]`, `{}` are falsy; numbers have no impl (a bare-number condition does
/// not compile). The only policy the conformance corpus is checked against.
pub struct NonEmpty;

/// The Liquid policy: only `false` and `nil` (`None`/`()`) are falsy. `0`, `""`,
/// `[]`, and `{}` are all truthy. Out of conformance (`docs/15-truthiness-modes.md`).
pub struct Liquid;

/// The Handlebars policy: `false`, `null` (`None`/`()`), `0`, `NaN`, `""`, and `[]`
/// are falsy; a non-empty value and an (empty or non-empty) object `{}` are truthy.
/// Out of conformance (`docs/15-truthiness-modes.md`).
pub struct Handlebars;

/// Evaluate truthiness under the default [`NonEmpty`] policy.
///
/// ```
/// use trussbars_core::truthy;
/// assert!(truthy(&"x"));
/// assert!(!truthy(&""));
/// assert!(!truthy(&Option::<&str>::None));
/// ```
///
/// Numbers have no [`NonEmpty`] impl, so a bare-number condition does not compile —
/// write the comparison instead:
///
/// ```compile_fail
/// use trussbars_core::truthy;
/// let _ = truthy(&5_i64); // error[E0277]: `i64: TruthyIn<NonEmpty>` is not satisfied
/// ```
pub fn truthy<T: TruthyIn<NonEmpty> + ?Sized>(v: &T) -> bool {
    <T as TruthyIn<NonEmpty>>::truthy(v)
}

/// Evaluate truthiness under an explicit policy `Mode` — the emission for a template
/// compiled with a non-default `truss!(…, truthiness = Mode)`.
///
/// ```
/// use trussbars_core::{truthy_in, Liquid, Handlebars};
/// assert!(truthy_in::<Liquid, _>(&""));   // "" is truthy under Liquid
/// assert!(truthy_in::<Liquid, _>(&0_i64)); // 0 is truthy under Liquid
/// assert!(!truthy_in::<Handlebars, _>(&0_i64)); // 0 is falsy under Handlebars
/// assert!(!truthy_in::<Handlebars, _>(&""));    // "" is falsy under Handlebars
/// ```
pub fn truthy_in<Mode, T: TruthyIn<Mode> + ?Sized>(v: &T) -> bool {
    <T as TruthyIn<Mode>>::truthy(v)
}

// ── mode-invariant types ──────────────────────────────────────────────────────
// `bool`, `null`, `Option`, and references answer the same under every policy, so
// they impl `TruthyIn<Mode>` for *all* `Mode` (one impl, no per-policy repetition).

impl<Mode> TruthyIn<Mode> for bool {
    fn truthy(&self) -> bool {
        *self
    }
}

/// The `null` literal — falsy under every policy.
impl<Mode> TruthyIn<Mode> for () {
    fn truthy(&self) -> bool {
        false
    }
}

impl<Mode, T: TruthyIn<Mode>> TruthyIn<Mode> for Option<T> {
    // `None` is falsy; `Some(v)` defers to `v` under the same policy — so under
    // `NonEmpty` `Some("")` is falsy (absence and emptiness both fall through),
    // while under `Liquid` `Some("")` is truthy.
    fn truthy(&self) -> bool {
        self.as_ref().is_some_and(<T as TruthyIn<Mode>>::truthy)
    }
}

impl<Mode, T: TruthyIn<Mode> + ?Sized> TruthyIn<Mode> for &T {
    fn truthy(&self) -> bool {
        <T as TruthyIn<Mode>>::truthy(*self)
    }
}

// ── NonEmpty / Handlebars: emptiness types ────────────────────────────────────
// Both policies treat a string/sequence as truthy exactly when non-empty; they
// diverge only on maps (an empty `{}` is falsy under `NonEmpty`, truthy under
// Handlebars) and numbers (no impl vs. `!= 0`), handled below.

macro_rules! impl_emptiness {
    ($mode:ty) => {
        impl TruthyIn<$mode> for str {
            fn truthy(&self) -> bool {
                !self.is_empty()
            }
        }
        impl TruthyIn<$mode> for String {
            fn truthy(&self) -> bool {
                !self.is_empty()
            }
        }
        impl TruthyIn<$mode> for crate::Safe {
            fn truthy(&self) -> bool {
                !self.0.is_empty()
            }
        }
        impl<T> TruthyIn<$mode> for [T] {
            fn truthy(&self) -> bool {
                !self.is_empty()
            }
        }
        impl<T> TruthyIn<$mode> for Vec<T> {
            fn truthy(&self) -> bool {
                !self.is_empty()
            }
        }
    };
}
impl_emptiness!(NonEmpty);
impl_emptiness!(Handlebars);

/// `NonEmpty`: an empty map is falsy (the `{}`-falsy half of `nonEmpty`).
impl<K, V> TruthyIn<NonEmpty> for BTreeMap<K, V> {
    fn truthy(&self) -> bool {
        !self.is_empty()
    }
}

/// Handlebars: an object is always truthy — Handlebars special-cases only empty
/// *arrays*, never objects.
impl<K, V> TruthyIn<Handlebars> for BTreeMap<K, V> {
    fn truthy(&self) -> bool {
        true
    }
}

// ── Handlebars: numbers ───────────────────────────────────────────────────────
// `0` is falsy; `NaN` is falsy (the JS falsy set); every other number is truthy.

macro_rules! impl_handlebars_int {
    ($($t:ty),+ $(,)?) => {
        $(
            impl TruthyIn<Handlebars> for $t {
                fn truthy(&self) -> bool { *self != 0 }
            }
        )+
    };
}
impl_handlebars_int!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize
);

impl TruthyIn<Handlebars> for f32 {
    fn truthy(&self) -> bool {
        !self.is_nan() && *self != 0.0
    }
}
impl TruthyIn<Handlebars> for f64 {
    fn truthy(&self) -> bool {
        !self.is_nan() && *self != 0.0
    }
}

// ── Liquid: everything but `false`/`nil` is truthy ────────────────────────────
// Strings, sequences, maps, and numbers — including `""`, `[]`, `{}`, and `0` — are
// all truthy.

macro_rules! impl_liquid_true {
    ($($t:ty),+ $(,)?) => {
        $(
            impl TruthyIn<Liquid> for $t {
                fn truthy(&self) -> bool { true }
            }
        )+
    };
}
impl_liquid_true!(
    str,
    String,
    crate::Safe,
    i8,
    i16,
    i32,
    i64,
    i128,
    isize,
    u8,
    u16,
    u32,
    u64,
    u128,
    usize,
    f32,
    f64
);

impl<T> TruthyIn<Liquid> for [T] {
    fn truthy(&self) -> bool {
        true
    }
}
impl<T> TruthyIn<Liquid> for Vec<T> {
    fn truthy(&self) -> bool {
        true
    }
}
impl<K, V> TruthyIn<Liquid> for BTreeMap<K, V> {
    fn truthy(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{Handlebars, Liquid, TruthyIn, truthy, truthy_in};
    use crate::Safe;

    #[test]
    fn nonempty_booleans_and_null() {
        assert!(truthy(&true));
        assert!(!truthy(&false));
        assert!(!truthy(&()));
        assert!(!truthy(&Option::<&str>::None));
    }

    #[test]
    fn nonempty_strings_and_collections() {
        assert!(truthy(&"x"));
        assert!(!truthy(&""));
        assert!(truthy(&String::from("x")));
        assert!(!truthy(&String::new()));
        assert!(truthy(&Safe(String::from("x"))));
        assert!(!truthy(&Safe(String::new())));
        assert!(truthy(&vec![1]));
        assert!(!truthy(&Vec::<i32>::new()));
    }

    #[test]
    fn nonempty_option_defers_to_inner() {
        assert!(truthy(&Some("x")));
        // The key nonEmpty-through-Option case: Some("") is falsy.
        assert!(!truthy(&Some("")));
        assert!(truthy(&Some(vec![1])));
        assert!(!truthy(&Some(Vec::<i32>::new())));
    }

    #[test]
    fn liquid_only_false_and_nil_are_falsy() {
        // Everything present and non-false is truthy — including the empties.
        assert!(truthy_in::<Liquid, _>(&""));
        assert!(truthy_in::<Liquid, _>(&String::new()));
        assert!(truthy_in::<Liquid, _>(&Vec::<i32>::new()));
        assert!(truthy_in::<Liquid, _>(&0_i64));
        assert!(truthy_in::<Liquid, _>(&0.0_f64));
        assert!(truthy_in::<Liquid, _>(&Safe(String::new())));
        // …but `false` and `nil` stay falsy.
        assert!(!truthy_in::<Liquid, _>(&false));
        assert!(!truthy_in::<Liquid, _>(&()));
        assert!(!truthy_in::<Liquid, _>(&Option::<&str>::None));
        // Option defers under the same policy: Some("") is truthy under Liquid.
        assert!(truthy_in::<Liquid, _>(&Some("")));
        assert!(!truthy_in::<Liquid, _>(&Some(false)));
    }

    #[test]
    fn handlebars_zero_nan_and_empties_are_falsy() {
        assert!(!truthy_in::<Handlebars, _>(&0_i64));
        assert!(truthy_in::<Handlebars, _>(&5_i64));
        assert!(!truthy_in::<Handlebars, _>(&0.0_f64));
        assert!(truthy_in::<Handlebars, _>(&5.0_f64));
        assert!(!truthy_in::<Handlebars, _>(&f64::NAN));
        assert!(truthy_in::<Handlebars, _>(&f64::INFINITY));
        assert!(!truthy_in::<Handlebars, _>(&""));
        assert!(!truthy_in::<Handlebars, _>(&Vec::<i32>::new()));
    }

    #[test]
    fn handlebars_empty_object_is_truthy() {
        use alloc::collections::BTreeMap;
        // Handlebars special-cases empty arrays, not empty objects.
        let m: BTreeMap<&str, i32> = BTreeMap::new();
        assert!(truthy_in::<Handlebars, _>(&m));
    }

    // The extension point: a host defines its *own* policy for a foreign type. The
    // marker is local, so `impl TruthyIn<NonZero> for i64` is orphan-rule-legal even
    // though both `TruthyIn` and `i64` are foreign here — the mechanism Option A buys
    // (docs/15). A bare `i64` has no `NonEmpty` impl, yet gains one under `NonZero`.
    struct NonZero;
    impl TruthyIn<NonZero> for i64 {
        fn truthy(&self) -> bool {
            *self != 0
        }
    }
    impl TruthyIn<NonZero> for str {
        fn truthy(&self) -> bool {
            self != "skip"
        }
    }

    #[test]
    fn host_defined_policy_over_foreign_types() {
        assert!(truthy_in::<NonZero, _>(&7_i64));
        assert!(!truthy_in::<NonZero, _>(&0_i64));
        assert!(truthy_in::<NonZero, _>(&"go"));
        assert!(!truthy_in::<NonZero, _>(&"skip"));
        // The mode-invariant impls compose with the host policy for free.
        assert!(truthy_in::<NonZero, _>(&Some(7_i64)));
        assert!(!truthy_in::<NonZero, _>(&Option::<i64>::None));
    }
}
