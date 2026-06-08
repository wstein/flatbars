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
//! Number formatting is a **pluggable backend** (the substrate stays auditable):
//! with the default `perf` features, integers use `itoa` (`fast-int`, byte-identical
//! to `Display`, just faster) and `f64` uses `dragonbox_ecma` (`ecma-float`), which
//! is **ECMA-262 byte-identical** to the reference's JavaScript `String(n)` —
//! including `-0` → `"0"`, `1e21` → `"1e+21"`, `Infinity`, `NaN`. With
//! `--no-default-features` the pure path uses Rust `Display`, whose `f64` output
//! diverges from `String(n)` for that long tail (docs/01 §10; masked only on the
//! pure profile by the conformance harness, docs/04 §7). `f32` is outside the JS
//! number model and always uses `Display`.

use alloc::string::String;
use alloc::vec::Vec;

/// A string already safe to emit unescaped — the output of markup-producing
/// helpers (`escapeHtml`, `safe`, partials). [`esc`] writes it through verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Safe(
    /// The raw, already-safe markup. Never re-escaped on output.
    pub String,
);

/// Append the HTML-escaped form of `s` to `out`.
///
/// Matches the reference `escapeHtml` character set exactly (`&  <  >  "  '`).
/// Scans the bytes and copies the clean runs between escapable characters in bulk
/// (`push_str`), so only the five escapable bytes do per-character work — much
/// faster than a char-by-char loop on typical, mostly-clean text, with no
/// dependency and no `unsafe`. The five escapable bytes are all ASCII, so the run
/// boundaries are always UTF-8 char boundaries.
#[inline]
pub fn escape_html(s: &str, out: &mut String) {
    let mut start = 0;
    for (i, &b) in s.as_bytes().iter().enumerate() {
        let entity = match b {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' => "&quot;",
            b'\'' => "&#x27;",
            _ => continue,
        };
        out.push_str(&s[start..i]);
        out.push_str(entity);
        start = i + 1;
    }
    out.push_str(&s[start..]);
}

/// Append the HTML-escaped output of `v` to `out` — the emission for a `{{ x }}`
/// tag. [`Safe`] values pass through unescaped; everything else is escaped.
#[inline]
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
    #[inline]
    fn write_text(&self, out: &mut String) {
        out.push_str(self);
    }
    #[inline]
    fn write_escaped(&self, out: &mut String) {
        escape_html(self, out);
    }
}

impl ToText for String {
    #[inline]
    fn write_text(&self, out: &mut String) {
        out.push_str(self);
    }
    #[inline]
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

// Integers: `itoa` under `fast-int` (byte-identical to `Display`, faster), else
// `Display`. Numbers carry no escapable characters, so `write_escaped` writes
// directly (the default would allocate a temporary).
macro_rules! impl_to_text_int {
    ($($t:ty),* $(,)?) => {$(
        impl ToText for $t {
            #[inline]
            fn write_text(&self, out: &mut String) {
                #[cfg(feature = "fast-int")]
                {
                    let mut buf = itoa::Buffer::new();
                    out.push_str(buf.format(*self));
                }
                #[cfg(not(feature = "fast-int"))]
                {
                    use core::fmt::Write as _;
                    let _ = write!(out, "{self}");
                }
            }
            #[inline]
            fn write_escaped(&self, out: &mut String) {
                self.write_text(out);
            }
        }
    )*};
}

impl_to_text_int!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize
);

impl ToText for f64 {
    fn write_text(&self, out: &mut String) {
        #[cfg(feature = "ecma-float")]
        {
            write_ecma_f64(*self, out);
        }
        #[cfg(not(feature = "ecma-float"))]
        {
            use core::fmt::Write as _;
            let _ = write!(out, "{self}");
        }
    }
    fn write_escaped(&self, out: &mut String) {
        self.write_text(out);
    }
}

// f32 is outside the JS number model (JavaScript has only f64), so there is no
// `String(n)` to match — it always uses `Display`.
impl ToText for f32 {
    fn write_text(&self, out: &mut String) {
        use core::fmt::Write as _;
        let _ = write!(out, "{self}");
    }
    fn write_escaped(&self, out: &mut String) {
        self.write_text(out);
    }
}

/// Format an `f64` as ECMA-262 `Number::toString` (JavaScript `String(n)`):
/// `dragonbox_ecma` for finite values, the spec spellings for the rest.
#[cfg(feature = "ecma-float")]
fn write_ecma_f64(n: f64, out: &mut String) {
    if n.is_nan() {
        out.push_str("NaN");
    } else if n.is_infinite() {
        out.push_str(if n < 0.0 { "-Infinity" } else { "Infinity" });
    } else {
        let mut buf = dragonbox_ecma::Buffer::new();
        out.push_str(buf.format(n));
    }
}

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
    #[inline]
    fn write_text(&self, out: &mut String) {
        (**self).write_text(out);
    }
    #[inline]
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
    fn floats_stringify_the_common_cases_under_either_backend() {
        // These agree whether `f64` uses dragonbox_ecma or Display.
        assert_eq!(text(1.5_f64), "1.5");
        assert_eq!(text(0.0_f64), "0");
        assert_eq!(text(42.0_f64), "42");
    }

    // With `ecma-float`, f64 output is byte-identical to JavaScript `String(n)`.
    #[cfg(feature = "ecma-float")]
    #[test]
    fn ecma_float_matches_javascript_string() {
        assert_eq!(text(-0.0_f64), "0"); // Display would give "-0"
        assert_eq!(text(1e21_f64), "1e+21"); // Display: a 22-digit integer
        assert_eq!(text(1e-7_f64), "1e-7"); // Display: "0.0000001"
        assert_eq!(text(f64::INFINITY), "Infinity"); // Display: "inf"
        assert_eq!(text(f64::NEG_INFINITY), "-Infinity");
        assert_eq!(text(f64::NAN), "NaN");
    }

    // The pure (zero-dependency) profile falls back to Rust `Display`.
    #[cfg(not(feature = "ecma-float"))]
    #[test]
    fn pure_float_uses_rust_display() {
        assert_eq!(text(-0.0_f64), "-0"); // the documented divergence
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
