//! String pack — subject-first transforms (helper-packs §4). Subjects and string
//! arguments are coerced via [`crate::text`] (the reference `stringify`); integer
//! arguments are `i64` (the reference `int`). Indexing is over Unicode scalar
//! values; see the crate docs for the UTF-16 divergence note.

use crate::text;
use trussbars_core::ToText;

/// Lowercase the subject (`lowercase`).
pub fn lowercase(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).to_lowercase()
}

/// Uppercase the subject (`uppercase`).
pub fn uppercase(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).to_uppercase()
}

/// Uppercase the first character and leave the rest unchanged (`capitalize`).
pub fn capitalize(subject: &(impl ToText + ?Sized)) -> String {
    let s = text(subject);
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// Trim leading and trailing whitespace (`trim`).
pub fn trim(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).trim().to_string()
}

/// Trim leading whitespace (`trimStart`).
pub fn trim_start(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).trim_start().to_string()
}

/// Trim trailing whitespace (`trimEnd`).
pub fn trim_end(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).trim_end().to_string()
}

/// Split the subject on a literal separator (`split`). An empty separator splits
/// into characters, matching JavaScript `String.prototype.split("")`.
pub fn split(subject: &(impl ToText + ?Sized), separator: &(impl ToText + ?Sized)) -> Vec<String> {
    let s = text(subject);
    let sep = text(separator);
    if sep.is_empty() {
        s.chars().map(|c| c.to_string()).collect()
    } else {
        s.split(sep.as_str()).map(str::to_string).collect()
    }
}

/// Replace every occurrence of a literal substring (`replace`).
pub fn replace(
    subject: &(impl ToText + ?Sized),
    find: &(impl ToText + ?Sized),
    with: &(impl ToText + ?Sized),
) -> String {
    text(subject).replace(text(find).as_str(), text(with).as_str())
}

/// The substring from `start` to the end (`slice` with two arguments). Negative
/// `start` counts from the end, JavaScript-style.
pub fn slice(subject: &(impl ToText + ?Sized), start: i64) -> String {
    js_slice(&text(subject), start, None)
}

/// The substring from `start` to `end` (`slice` with three arguments). Negative
/// indices count from the end; an empty range yields `""`.
pub fn slice_range(subject: &(impl ToText + ?Sized), start: i64, end: i64) -> String {
    js_slice(&text(subject), start, Some(end))
}

/// Whether the subject contains the needle (`includes`, string form).
pub fn includes(subject: &(impl ToText + ?Sized), needle: &(impl ToText + ?Sized)) -> bool {
    text(subject).contains(text(needle).as_str())
}

/// Whether the subject starts with the prefix (`startsWith`).
pub fn starts_with(subject: &(impl ToText + ?Sized), prefix: &(impl ToText + ?Sized)) -> bool {
    text(subject).starts_with(text(prefix).as_str())
}

/// Whether the subject ends with the suffix (`endsWith`).
pub fn ends_with(subject: &(impl ToText + ?Sized), suffix: &(impl ToText + ?Sized)) -> bool {
    text(subject).ends_with(text(suffix).as_str())
}

/// Shorten the subject to at most `n` characters, appending `…` when it was
/// truncated (`truncate` with two arguments).
pub fn truncate(subject: &(impl ToText + ?Sized), n: i64) -> String {
    truncate_with(subject, n, "…")
}

/// Like [`truncate`] but with an explicit suffix (`truncate` with three arguments).
pub fn truncate_with(
    subject: &(impl ToText + ?Sized),
    n: i64,
    suffix: &(impl ToText + ?Sized),
) -> String {
    let s = text(subject);
    if (s.chars().count() as i64) > n {
        js_slice(&s, 0, Some(n)) + &text(suffix)
    } else {
        s
    }
}

/// Concatenate `subject` followed by `other` (`append`).
pub fn append(subject: &(impl ToText + ?Sized), other: &(impl ToText + ?Sized)) -> String {
    let mut s = text(subject);
    other.write_text(&mut s);
    s
}

/// Concatenate `other` followed by `subject` (`prepend`).
pub fn prepend(subject: &(impl ToText + ?Sized), other: &(impl ToText + ?Sized)) -> String {
    let mut s = text(other);
    subject.write_text(&mut s);
    s
}

/// Reverse the subject's characters (`reverse`, string form).
pub fn reverse(subject: &(impl ToText + ?Sized)) -> String {
    text(subject).chars().rev().collect()
}

/// JavaScript `String.prototype.slice` over Unicode scalar values: negative
/// indices count from the end, indices clamp to `[0, len]`, and `start >= end`
/// yields the empty string.
fn js_slice(s: &str, start: i64, end: Option<i64>) -> String {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len() as i64;
    let norm = |i: i64| -> usize {
        if i < 0 {
            (len + i).max(0) as usize
        } else {
            i.min(len) as usize
        }
    };
    let from = norm(start);
    let to = end.map_or(len as usize, norm);
    if from >= to {
        String::new()
    } else {
        chars[from..to].iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_transforms() {
        assert_eq!(lowercase(&"AbC"), "abc");
        assert_eq!(uppercase(&"AbC"), "ABC");
        assert_eq!(capitalize(&"hello"), "Hello");
        assert_eq!(capitalize(&""), "");
        // Coerces a non-string subject via stringify, like the reference.
        assert_eq!(uppercase(&42_i64), "42");
    }

    #[test]
    fn trimming() {
        assert_eq!(trim(&"  hi \t"), "hi");
        assert_eq!(trim_start(&"  hi  "), "hi  ");
        assert_eq!(trim_end(&"  hi  "), "  hi");
    }

    #[test]
    fn split_and_replace() {
        assert_eq!(split(&"a,b,c", &","), vec!["a", "b", "c"]);
        assert_eq!(split(&"abc", &""), vec!["a", "b", "c"]);
        assert_eq!(split(&"", &""), Vec::<String>::new());
        assert_eq!(replace(&"a.b.c", &".", &"-"), "a-b-c");
    }

    #[test]
    fn slicing_matches_js() {
        assert_eq!(slice(&"hello", 1), "ello");
        assert_eq!(slice(&"hello", -2), "lo");
        assert_eq!(slice_range(&"hello", 1, 3), "el");
        assert_eq!(slice_range(&"hello", -3, -1), "ll");
        assert_eq!(slice_range(&"hello", 3, 1), ""); // start >= end
        assert_eq!(slice(&"hello", 99), ""); // clamps
    }

    #[test]
    fn membership_and_edges() {
        assert!(includes(&"hello", &"ell"));
        assert!(!includes(&"hello", &"xyz"));
        assert!(starts_with(&"hello", &"he"));
        assert!(ends_with(&"hello", &"lo"));
    }

    #[test]
    fn truncation() {
        assert_eq!(truncate(&"hello world", 5), "hello…");
        assert_eq!(truncate(&"hi", 5), "hi"); // not truncated
        assert_eq!(truncate_with(&"hello world", 5, "..."), "hello...");
    }

    #[test]
    fn concatenation_and_reverse() {
        assert_eq!(append(&"foo", &"bar"), "foobar");
        assert_eq!(prepend(&"foo", &"bar"), "barfoo");
        assert_eq!(reverse(&"abc"), "cba");
    }
}
