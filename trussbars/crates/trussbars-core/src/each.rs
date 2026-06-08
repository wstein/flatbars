//! `Each` — uniform `{{#each}}` iteration over either a sequence (array) or a map
//! (object). A sequence yields `(None, &item)`; a map yields `(Some(key), &value)`
//! in sorted-key order (matching the reference engine's object iteration). The
//! codegen emits `Each::each` / `Each::each_len`, so the same `{{#each x}}` works
//! whether `x` is a `Vec`/slice or a `BTreeMap` — `rustc` picks the impl, and
//! `loop.key` is `None` for a sequence and the key for a map.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

/// Uniform iteration for `{{#each}}` over a sequence or a map.
pub trait Each {
    /// The element (sequence) or value (map) type.
    type Item;
    /// The number of items.
    fn each_len(&self) -> usize;
    /// Iterate as `(key, value)`: `key` is `None` for a sequence, `Some(k)` for a
    /// map (in sorted-key order).
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &Self::Item)>;
}

impl<T> Each for [T] {
    type Item = T;
    #[inline]
    fn each_len(&self) -> usize {
        self.len()
    }
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &T)> {
        self.iter().map(|v| (None, v))
    }
}

impl<T> Each for Vec<T> {
    type Item = T;
    #[inline]
    fn each_len(&self) -> usize {
        self.len()
    }
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &T)> {
        self.as_slice().each()
    }
}

// A fixed-size array — for in-template list literals (`[1, 2, 3]`), which the
// codegen emits as a Rust array `[e, …]`. Delegates to the slice behaviour.
impl<const N: usize, T> Each for [T; N] {
    type Item = T;
    #[inline]
    fn each_len(&self) -> usize {
        N
    }
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &T)> {
        self.iter().map(|v| (None, v))
    }
}

impl<V> Each for BTreeMap<String, V> {
    type Item = V;
    #[inline]
    fn each_len(&self) -> usize {
        self.len()
    }
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &V)> {
        self.iter().map(|(k, v)| (Some(k.as_str()), v))
    }
}

// So a doubly-referenced subject (`&&Vec`, from a nested each over a block-param
// array) forwards cleanly under the fully-qualified `Each::each(__sub)` the codegen
// emits — no auto-deref needed, no `use`.
impl<T: Each + ?Sized> Each for &T {
    type Item = T::Item;
    #[inline]
    fn each_len(&self) -> usize {
        T::each_len(*self)
    }
    fn each(&self) -> impl Iterator<Item = (Option<&str>, &Self::Item)> {
        T::each(*self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_yields_no_keys() {
        let xs = vec![10, 20, 30];
        assert_eq!(xs.each_len(), 3);
        let got: Vec<(Option<&str>, &i32)> = xs.each().collect();
        assert_eq!(got, vec![(None, &10), (None, &20), (None, &30)]);
    }

    #[test]
    fn map_yields_keys_in_sorted_order() {
        let mut m = BTreeMap::new();
        m.insert("b".to_string(), 2);
        m.insert("a".to_string(), 1);
        assert_eq!(m.each_len(), 2);
        let got: Vec<(Option<&str>, &i32)> = m.each().collect();
        assert_eq!(got, vec![(Some("a"), &1), (Some("b"), &2)]);
    }
}
