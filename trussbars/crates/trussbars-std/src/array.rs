//! Array pack — value helpers over slices. The key-path helpers (`sort_by`,
//! `pluck`, `group_by`) are emitted by the codegen as field-access closures and
//! are not here (see the crate docs). Returned slices/`Vec<&T>` borrow the input,
//! so no element is cloned.

use crate::text;
use trussbars_core::ToText;

/// Join the elements with a separator, stringifying each (`join`).
pub fn join<T: ToText>(items: &[T], separator: &(impl ToText + ?Sized)) -> String {
    let sep = text(separator);
    let mut out = String::new();
    for (i, v) in items.iter().enumerate() {
        if i > 0 {
            out.push_str(&sep);
        }
        v.write_text(&mut out);
    }
    out
}

/// The number of elements (`count` / `size`).
pub fn count<T>(items: &[T]) -> usize {
    items.len()
}

/// The element at `index` (`at`); negative indices count from the end, and an
/// out-of-range index yields `None`.
pub fn at<T>(items: &[T], index: i64) -> Option<&T> {
    let len = items.len() as i64;
    let idx = if index < 0 { len + index } else { index };
    if (0..len).contains(&idx) {
        Some(&items[idx as usize])
    } else {
        None
    }
}

/// The first `n` elements (`take`); `n` is clamped to `[0, len]`.
pub fn take<T>(items: &[T], n: i64) -> &[T] {
    let n = (n.max(0) as usize).min(items.len());
    &items[..n]
}

/// The last `n` elements (`takeRight`); `n` is clamped to `[0, len]`.
pub fn take_right<T>(items: &[T], n: i64) -> &[T] {
    let n = (n.max(0) as usize).min(items.len());
    &items[items.len() - n..]
}

/// The elements in reverse order (`reverse`, array form).
pub fn reverse_slice<T>(items: &[T]) -> Vec<&T> {
    items.iter().rev().collect()
}

/// The elements with duplicates removed, preserving first-seen order (`unique`).
pub fn unique<T: PartialEq>(items: &[T]) -> Vec<&T> {
    let mut out: Vec<&T> = Vec::new();
    for v in items {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

/// Whether the slice contains an element equal to `needle` (`includes`, array form).
pub fn slice_includes<T: PartialEq>(items: &[T], needle: &T) -> bool {
    items.iter().any(|v| v == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_stringifies_and_separates() {
        assert_eq!(join(&[1_i64, 2, 3], &", "), "1, 2, 3");
        assert_eq!(join(&["a", "b"], &"-"), "a-b");
        assert_eq!(join::<i64>(&[], &","), "");
    }

    #[test]
    fn count_is_length() {
        assert_eq!(count(&[1, 2, 3]), 3);
        assert_eq!(count::<i32>(&[]), 0);
    }

    #[test]
    fn at_handles_negative_and_out_of_range() {
        let xs = [10, 20, 30];
        assert_eq!(at(&xs, 0), Some(&10));
        assert_eq!(at(&xs, -1), Some(&30));
        assert_eq!(at(&xs, 3), None);
        assert_eq!(at(&xs, -4), None);
    }

    #[test]
    fn take_and_take_right_clamp() {
        let xs = [1, 2, 3, 4];
        assert_eq!(take(&xs, 2), &[1, 2]);
        assert_eq!(take(&xs, 99), &[1, 2, 3, 4]);
        assert_eq!(take(&xs, 0), &[] as &[i32]);
        assert_eq!(take_right(&xs, 2), &[3, 4]);
        assert_eq!(take_right(&xs, 99), &[1, 2, 3, 4]);
        assert_eq!(take_right(&xs, 0), &[] as &[i32]);
    }

    #[test]
    fn reverse_and_unique() {
        let xs = [1, 2, 3];
        assert_eq!(reverse_slice(&xs), vec![&3, &2, &1]);
        let dup = [1, 2, 2, 3, 1, 3];
        assert_eq!(unique(&dup), vec![&1, &2, &3]);
    }

    #[test]
    fn slice_membership() {
        assert!(slice_includes(&[1, 2, 3], &2));
        assert!(!slice_includes(&[1, 2, 3], &9));
    }
}
