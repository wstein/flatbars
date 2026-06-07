//! Output layer: the [`Safe`] newtype, the [`ToText`] stringification trait, and
//! HTML [`escape_html`]ing.
//!
//! Stringification mirrors the reference engine's `stringify` (see
//! `trussbars/docs/02-runtime-api.md` §2): `None`/`()` → `""`, `bool` →
//! `"true"`/`"false"`, an array → its elements joined with `,`. A context
//! object/struct has **no** [`ToText`] impl, so `{{struct}}` is a compile error —
//! the typed form of the interpreter's runtime "cannot stringify an object".
//!
//! Escaping mirrors the reference `escapeHtml` exactly: `&` `<` `>` `"` `'` →
//! `&amp;` `&lt;` `&gt;` `&quot;` `&#x27;`.
//!
//! One deliberate divergence: `f64`/`f32` use Rust's `Display`, which is **not**
//! byte-identical to the reference's JavaScript `String(n)` for the long tail
//! (`1e21`, `-0`, …). This is out of scope for v1 and masked by the conformance
//! harness (`docs/04-conformance.md` §7).

/// A string already safe to emit unescaped — the output of markup-producing
/// helpers (`escapeHtml`, `safe`, partials). [`esc`] writes it through verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Safe(
    /// The raw, already-safe markup. Never re-escaped on output.
    pub String,
);

/// Append the HTML-escaped form of `s` to `out`.
///
/// Matches the reference `escapeHtml` character set exactly. Escaping
/// character-by-character (rather than the reference's chained `&`-first
/// replace) is equivalent and avoids any double-encoding hazard.
pub fn escape_html(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            _ => out.push(c),
        }
    }
}

/// Append the HTML-escaped output of `v` to `out` — the emission for a `{{ x }}`
/// tag. [`Safe`] values pass through unescaped; everything else is escaped.
pub fn esc<T: ToText + ?Sized>(v: &T, out: &mut String) {
    v.write_escaped(out);
}

/// Stringification to output text. Implemented for the scalar and container types
/// a template can place in output position; **not** for context structs, so
/// `{{struct}}` fails to compile.
pub trait ToText {
    /// Append the raw (unescaped) text form of `self` to `out` — the emission for
    /// a `{{{ x }}}` (raw) tag.
    fn write_text(&self, out: &mut String);

    /// Append the HTML-escaped text form of `self` to `out`.
    ///
    /// The default stringifies via [`ToText::write_text`] and escapes the result;
    /// [`Safe`] overrides it to write through unescaped, and `&str`/`String`
    /// override it to escape in place (no intermediate allocation).
    fn write_escaped(&self, out: &mut String) {
        let mut raw = String::new();
        self.write_text(&mut raw);
        escape_html(&raw, out);
    }
}

impl ToText for str {
    fn write_text(&self, out: &mut String) {
        out.push_str(self);
    }
    fn write_escaped(&self, out: &mut String) {
        escape_html(self, out);
    }
}

impl ToText for String {
    fn write_text(&self, out: &mut String) {
        out.push_str(self);
    }
    fn write_escaped(&self, out: &mut String) {
        escape_html(self, out);
    }
}

impl ToText for Safe {
    fn write_text(&self, out: &mut String) {
        out.push_str(&self.0);
    }
    // Already safe: write through, never escape.
    fn write_escaped(&self, out: &mut String) {
        out.push_str(&self.0);
    }
}

impl ToText for bool {
    fn write_text(&self, out: &mut String) {
        out.push_str(if *self { "true" } else { "false" });
    }
}

/// The `null` literal — stringifies to the empty string.
impl ToText for () {
    fn write_text(&self, _out: &mut String) {}
}

macro_rules! impl_to_text_display {
    ($($t:ty),* $(,)?) => {$(
        // Numbers carry no escapable characters, so the default escaped path
        // (which would allocate a temporary) is overridden to write directly.
        // NOTE: `f32`/`f64` use Rust `Display`, not byte-identical to the
        // reference `String(n)` — out of scope for v1 (see module docs).
        impl ToText for $t {
            fn write_text(&self, out: &mut String) {
                use core::fmt::Write as _;
                let _ = write!(out, "{self}");
            }
            fn write_escaped(&self, out: &mut String) {
                self.write_text(out);
            }
        }
    )*};
}

impl_to_text_display!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64,
);

impl<T: ToText> ToText for Option<T> {
    fn write_text(&self, out: &mut String) {
        if let Some(v) = self {
            v.write_text(out);
        }
    }
    // Delegate to the inner value's escaped path so a `Some(Safe(..))` still
    // writes through unescaped.
    fn write_escaped(&self, out: &mut String) {
        if let Some(v) = self {
            v.write_escaped(out);
        }
    }
}

impl<T: ToText> ToText for [T] {
    fn write_text(&self, out: &mut String) {
        for (i, v) in self.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            v.write_text(out);
        }
    }
    // No escaped override on purpose: matching the reference, an array is
    // stringified raw (elements joined with `,`, any inner `Safe`-ness lost) and
    // the whole result is then escaped — exactly the default behaviour.
}

impl<T: ToText> ToText for Vec<T> {
    fn write_text(&self, out: &mut String) {
        self.as_slice().write_text(out);
    }
}

impl<T: ToText + ?Sized> ToText for &T {
    fn write_text(&self, out: &mut String) {
        (**self).write_text(out);
    }
    fn write_escaped(&self, out: &mut String) {
        (**self).write_escaped(out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text<T: ToText>(v: T) -> String {
        let mut s = String::new();
        v.write_text(&mut s);
        s
    }

    fn escaped<T: ToText>(v: T) -> String {
        let mut s = String::new();
        v.write_escaped(&mut s);
        s
    }

    #[test]
    fn escapes_the_five_reference_characters() {
        let mut out = String::new();
        escape_html(r#"a<b>&"'z"#, &mut out);
        assert_eq!(out, "a&lt;b&gt;&amp;&quot;&#x27;z");
    }

    #[test]
    fn escaping_does_not_double_encode_an_ampersand() {
        let mut out = String::new();
        escape_html("&lt;", &mut out);
        assert_eq!(out, "&amp;lt;");
    }

    #[test]
    fn passes_non_special_text_through_including_unicode() {
        let mut out = String::new();
        escape_html("héllo · wörld", &mut out);
        assert_eq!(out, "héllo · wörld");
    }

    #[test]
    fn strings_stringify_and_escape() {
        assert_eq!(text("a<b"), "a<b");
        assert_eq!(escaped("a<b"), "a&lt;b");
        assert_eq!(text(String::from("x&y")), "x&y");
        assert_eq!(escaped(String::from("x&y")), "x&amp;y");
    }

    #[test]
    fn booleans_stringify_to_words() {
        assert_eq!(text(true), "true");
        assert_eq!(text(false), "false");
        assert_eq!(escaped(true), "true");
    }

    #[test]
    fn integers_stringify() {
        assert_eq!(text(0_i64), "0");
        assert_eq!(text(-5_i32), "-5");
        assert_eq!(text(42_u8), "42");
    }

    #[test]
    fn floats_stringify_for_the_in_scope_cases() {
        // f64 byte-identity with the reference is out of scope; the common,
        // representable cases still agree.
        assert_eq!(text(1.5_f64), "1.5");
        assert_eq!(text(0.0_f64), "0");
    }

    #[test]
    fn null_and_none_stringify_to_empty() {
        assert_eq!(text(()), "");
        assert_eq!(text(Option::<&str>::None), "");
        assert_eq!(text(Some("hi")), "hi");
        assert_eq!(escaped(Some("a<b")), "a&lt;b");
    }

    #[test]
    fn arrays_join_with_commas() {
        assert_eq!(text(vec![1_i64, 2, 3]), "1,2,3");
        assert_eq!(text(vec!["a", "b"]), "a,b");
        // Nested: matches `map(stringify).join(",")` recursively.
        assert_eq!(text(vec![vec![1_i64, 2], vec![3]]), "1,2,3");
    }

    #[test]
    fn array_output_escapes_the_whole_joined_string() {
        assert_eq!(escaped(vec!["a", "b<c"]), "a,b&lt;c");
    }

    #[test]
    fn safe_writes_through_unescaped() {
        let s = Safe(String::from("x<y>"));
        assert_eq!(text(&s), "x<y>");
        assert_eq!(escaped(&s), "x<y>");
    }

    #[test]
    fn safe_inside_option_still_writes_through() {
        // Exercises the Option::write_escaped delegation.
        assert_eq!(escaped(Some(Safe(String::from("<b>")))), "<b>");
    }

    #[test]
    fn esc_helper_matches_write_escaped() {
        let mut a = String::new();
        esc("a<b", &mut a);
        assert_eq!(a, "a&lt;b");

        let s = Safe(String::from("<i>"));
        let mut b = String::new();
        esc(&s, &mut b);
        assert_eq!(b, "<i>");
    }

    #[test]
    fn references_delegate() {
        let owned = String::from("a&b");
        assert_eq!(escaped(&owned), "a&amp;b");
        // A `&&str` exercises the blanket `&T` impl delegating twice.
        let inner = "deep";
        let double: &&str = &inner;
        assert_eq!(text(double), "deep");
    }
}
