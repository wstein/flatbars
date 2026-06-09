//! # trussbars-i18n
//!
//! A reference-faithful **i18n host-helper pack** for Trussbars (docs/09 §5) — the
//! blessed localization operations (`t` / `number` / `date` / `selectPlural` /
//! `relative`, ADR-029) as compiled host functions. A template declares them with
//! the [`truss_helpers`](https://docs.rs/trussbars-macros) attribute and calls them
//! by name; this crate provides ready implementations so a host need not write its
//! own:
//!
//! ```ignore
//! use trussbars_i18n::{date, number};
//! #[trussbars_macros::truss_helpers(date, number)]
//! mod templates {
//!     use trussbars_macros::truss;
//!     truss!(receipt, Order, "{{date placed \"%d %B %Y\" lang}} — total {{number total 2 lang}}");
//! }
//! ```
//!
//! **Faithfulness.** The names, arities and *fallback* semantics mirror the
//! reference engine's i18n pack (ADR-029): `t` returns its key unchanged absent a
//! catalog (an explicit *fallback* — see [`t`]); `relative` falls back to a plain
//! English phrasing. `selectPlural` is **CLDR-accurate** (table-driven, per-language
//! cardinal categories). The formatters (`date`, `number`) are real,
//! dependency-free implementations — **byte-identity to a particular locale runtime
//! (JS `Intl`, ICU, …) stays the host's responsibility** (the reference i18n seam is
//! itself a documented non-byte-identical boundary; docs/09 §5). A host wanting exact
//! parity wraps its own locale library and declares that instead.
//!
//! Dependency-free and `forbid(unsafe_code)`, like `trussbars-std`.

#![forbid(unsafe_code)]

/// **Fallback `t`** — returns the message `key` unchanged. This crate is
/// dependency-free and so has no message catalog; echoing the key is the reference's
/// documented fallback (ADR-029: "returns the key unchanged when no translator is
/// registered"). It exists so a template that uses `{{t …}}` still compiles and runs.
///
/// **It is not translation.** For that, declare your *own* `t` over a catalog and
/// point `#[truss_helpers(t)]` at it — see the `examples/i18n-fluent` recipe (Project
/// Fluent via `i18n-embed`, runtime language negotiation). Re-exporting *this* `t`
/// only echoes keys.
#[must_use]
pub fn t(key: &str) -> &str {
    key
}

/// Format a `value` for display: rounded to `decimals` fractional digits, with the
/// integer part grouped in threes using the **locale-appropriate** group/decimal
/// separators for language `lang` (a BCP-47 tag; only the primary subtag is used).
/// `en` (and any unlisted tag) → `1,234.50`; `de` → `1.234,50`; `fr` → `1 234,50`
/// (narrow no-break space group); `pl`/`ru`/`cs`/`uk`/`sk` → `1 234,50` (no-break
/// space group). `decimals` is taken as a count (templates pass a numeric literal,
/// which is an `f64`). Dependency-free; byte-identity to a particular locale runtime
/// (JS `Intl`, ICU) stays the host's responsibility (docs/09 §5).
#[must_use]
pub fn number(value: &f64, decimals: &f64, lang: &str) -> String {
    let (group, decimal) = number_format(lang);
    let places = (*decimals).max(0.0).round() as usize;
    let negative = value.is_sign_negative() && *value != 0.0;
    let mag = value.abs();
    // Render the magnitude with the requested fixed decimals, then group the integer
    // part. Rust's float formatting rounds half-to-even on exact ties — fine for a
    // locale-agnostic fallback; a host needing a specific rounding mode wraps its own.
    let fixed = format!("{mag:.places$}");
    let (int_part, frac_part) = match fixed.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (fixed.as_str(), None),
    };
    let mut out = String::with_capacity(int_part.len() + int_part.len() / 3 + 4);
    if negative {
        out.push('-');
    }
    let digits: Vec<char> = int_part.chars().collect();
    for (idx, ch) in digits.iter().enumerate() {
        if idx > 0 && (digits.len() - idx).is_multiple_of(3) {
            out.push(group);
        }
        out.push(*ch);
    }
    if let Some(f) = frac_part {
        out.push(decimal);
        out.push_str(f);
    }
    out
}

/// The `(group, decimal)` separator pair for `lang` (primary subtag). en-US (`,`/`.`)
/// is the fallback for any unlisted tag; the listed set mirrors `selectPlural`'s
/// languages. Faithful to CLDR's `latn` separators for these locales (a documented
/// fallback, not an `Intl`/ICU byte-parity guarantee — docs/09 §5).
fn number_format(lang: &str) -> (char, char) {
    let lang = primary_subtag(lang);
    let is = |code: &str| lang.eq_ignore_ascii_case(code);
    if is("de") {
        ('.', ',')
    } else if is("fr") {
        ('\u{202f}', ',') // NARROW NO-BREAK SPACE
    } else if is("pl") || is("ru") || is("cs") || is("uk") || is("sk") {
        ('\u{a0}', ',') // NO-BREAK SPACE
    } else {
        (',', '.') // en-US fallback
    }
}

/// The CLDR cardinal plural **category** for `count` in language `lang` (a BCP-47
/// tag; only the primary subtag is used, so `pt-BR` → `pt`): one of `"zero"`,
/// `"one"`, `"two"`, `"few"`, `"many"`, `"other"`. Table-driven and dependency-free.
///
/// CLDR-accurate for the bundled rule shapes — the English/Germanic group (en, de,
/// es, it, nl, sv, …), French (fr/pt), the East-Slavic group (ru/uk), Polish (pl),
/// the Czech/Slovak group (cs/sk), Arabic (ar, all six categories), and the
/// no-plural group (ja, zh, ko, …). Any other tag falls back to the English rule.
/// Operands are read off `count` as an `f64`: `i` is its integer part and a non-zero
/// fraction counts as visible fraction digits (`v > 0`), which the cardinal rules
/// need; `NaN`/∞ → `"other"`. Returns the category, not a formatted string — pair it
/// with a `{{#with}}`/`select` over the result. `no_std`-clean (core ops only).
#[must_use]
#[allow(non_snake_case)] // mirrors the blessed template name `selectPlural`
pub fn selectPlural(count: &f64, lang: &str) -> &'static str {
    // Manual abs (keeps this `no_std`-clean — `f64::abs` is std-only).
    let n = if *count < 0.0 { -*count } else { *count };
    if !n.is_finite() {
        return "other";
    }
    let i = n as u64; // integer part (a saturating cast)
    let v0 = n == i as f64; // true ⇒ no visible fraction digits (v = 0)
    let (m10, m100) = (i % 10, i % 100);
    let lang = primary_subtag(lang);
    let is = |code: &str| lang.eq_ignore_ascii_case(code);

    if is("ja") || is("zh") || is("ko") || is("th") || is("vi") || is("id") || is("ms") {
        "other" // languages without a cardinal plural distinction
    } else if is("ar") {
        if n == 0.0 {
            "zero"
        } else if n == 1.0 {
            "one"
        } else if n == 2.0 {
            "two"
        } else if v0 && (3..=10).contains(&m100) {
            "few"
        } else if v0 && (11..=99).contains(&m100) {
            "many"
        } else {
            "other"
        }
    } else if is("pl") {
        if i == 1 && v0 {
            "one"
        } else if v0 && (2..=4).contains(&m10) && !(12..=14).contains(&m100) {
            "few"
        } else if v0 && i != 1 && (m10 <= 1 || (5..=9).contains(&m10) || (12..=14).contains(&m100))
        {
            "many"
        } else {
            "other"
        }
    } else if is("ru") || is("uk") {
        if v0 && m10 == 1 && m100 != 11 {
            "one"
        } else if v0 && (2..=4).contains(&m10) && !(12..=14).contains(&m100) {
            "few"
        } else if v0 && (m10 == 0 || (5..=9).contains(&m10) || (11..=14).contains(&m100)) {
            "many"
        } else {
            "other"
        }
    } else if is("cs") || is("sk") {
        if i == 1 && v0 {
            "one"
        } else if (2..=4).contains(&i) && v0 {
            "few"
        } else if !v0 {
            "many"
        } else {
            "other"
        }
    } else if is("fr") || is("pt") {
        // French/Portuguese: `one` for i ∈ {0, 1} (the compact-notation `many` omitted).
        if i == 0 || i == 1 { "one" } else { "other" }
    } else {
        // Default: the English/Germanic rule — `one` iff exactly 1 with no fraction.
        if i == 1 && v0 { "one" } else { "other" }
    }
}

/// The primary language subtag — the part before the first `-`/`_` (so `pt-BR` → `pt`).
fn primary_subtag(lang: &str) -> &str {
    let end = lang.find(['-', '_']).unwrap_or(lang.len());
    &lang[..end]
}

/// A plain-English **relative time** phrasing for a signed `value` of `unit`
/// (`"day"`, `"hour"`, …) — the reference fallback (ADR-029): `0` → `"now"`, a
/// positive value → `"in N unit(s)"`, a negative value → `"N unit(s) ago"`. The unit
/// is pluralized when `|value| != 1`.
#[must_use]
pub fn relative(value: &f64, unit: &str) -> String {
    let n = value.round();
    if n == 0.0 {
        return "now".to_string();
    }
    let mag = n.abs();
    let count = mag as i64;
    let unit = if (mag - 1.0).abs() < f64::EPSILON {
        unit.to_string()
    } else {
        format!("{unit}s")
    };
    if n > 0.0 {
        format!("in {count} {unit}")
    } else {
        format!("{count} {unit} ago")
    }
}

/// Format an ISO-8601 date/time string `value` (`YYYY-MM-DD` or
/// `YYYY-MM-DDTHH:MM:SS…`) with a `strftime`-style `pattern`, in language `lang`
/// (a BCP-47 tag; only the primary subtag is used). Supported fields:
/// `%Y` `%y` `%m` `%d` `%e` `%H` `%M` `%S` `%B` `%b` `%%`. The month-name fields
/// `%B`/`%b` are **localized** for `en`/`de`/`fr` and fall back to English for any
/// other tag; the numeric fields are language-independent. An unparseable input or an
/// unknown field is passed through unchanged (a forgiving fallback). Dependency-free.
#[must_use]
pub fn date(value: &str, pattern: &str, lang: &str) -> String {
    let Some(parts) = parse_iso(value) else {
        return value.to_string();
    };
    let mut out = String::with_capacity(pattern.len() + 8);
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('Y') => out.push_str(&format!("{:04}", parts.year)),
            Some('y') => out.push_str(&format!("{:02}", parts.year.rem_euclid(100))),
            Some('m') => out.push_str(&format!("{:02}", parts.month)),
            Some('d') => out.push_str(&format!("{:02}", parts.day)),
            Some('e') => out.push_str(&format!("{:2}", parts.day)),
            Some('H') => out.push_str(&format!("{:02}", parts.hour)),
            Some('M') => out.push_str(&format!("{:02}", parts.minute)),
            Some('S') => out.push_str(&format!("{:02}", parts.second)),
            Some('B') => out.push_str(month_name(parts.month, false, lang)),
            Some('b') => out.push_str(month_name(parts.month, true, lang)),
            Some('%') => out.push('%'),
            // Unknown field: emit it verbatim so nothing is silently dropped.
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    out
}

/// The parsed components of an ISO-8601 date/time (zero for absent time fields).
struct DateParts {
    year: i64,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
}

/// Parse the leading `YYYY-MM-DD` (and optional `THH:MM:SS`) of an ISO-8601 string.
/// Returns `None` if the date head is malformed.
fn parse_iso(s: &str) -> Option<DateParts> {
    let (date_part, time_part) = match s.split_once(['T', ' ']) {
        Some((d, t)) => (d, Some(t)),
        None => (s, None),
    };
    let mut d = date_part.splitn(3, '-');
    let year = d.next()?.parse::<i64>().ok()?;
    let month = d.next()?.parse::<u32>().ok()?;
    let day = d.next()?.parse::<u32>().ok()?;
    let (mut hour, mut minute, mut second) = (0, 0, 0);
    if let Some(t) = time_part {
        // Trim a trailing zone / fraction (`Z`, `+hh:mm`, `.sss`) before splitting.
        let core = t.trim_end_matches('Z');
        let core = core.split(['+', '.']).next().unwrap_or(core);
        let mut parts = core.splitn(3, ':');
        hour = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        minute = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        second = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    }
    Some(DateParts {
        year,
        month,
        day,
        hour,
        minute,
        second,
    })
}

/// The localized month name (full, or abbreviation) for `1..=12` in `lang`'s primary
/// subtag — `de`/`fr`/`pl` tables, English for any other tag; an out-of-range month
/// yields an empty string.
fn month_name(month: u32, abbrev: bool, lang: &str) -> &'static str {
    const EN_FULL: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const EN_ABBR: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const DE_FULL: [&str; 12] = [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ];
    const DE_ABBR: [&str; 12] = [
        "Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
    ];
    const FR_FULL: [&str; 12] = [
        "janvier",
        "février",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "août",
        "septembre",
        "octobre",
        "novembre",
        "décembre",
    ];
    const FR_ABBR: [&str; 12] = [
        "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.",
        "déc.",
    ];
    const PL_FULL: [&str; 12] = [
        "styczeń",
        "luty",
        "marzec",
        "kwiecień",
        "maj",
        "czerwiec",
        "lipiec",
        "sierpień",
        "wrzesień",
        "październik",
        "listopad",
        "grudzień",
    ];
    const PL_ABBR: [&str; 12] = [
        "sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru",
    ];
    let Some(i) = month
        .checked_sub(1)
        .and_then(|i| usize::try_from(i).ok())
        .filter(|i| *i < 12)
    else {
        return "";
    };
    let sub = primary_subtag(lang);
    let (full, abbr): (&[&str; 12], &[&str; 12]) = if sub.eq_ignore_ascii_case("de") {
        (&DE_FULL, &DE_ABBR)
    } else if sub.eq_ignore_ascii_case("fr") {
        (&FR_FULL, &FR_ABBR)
    } else if sub.eq_ignore_ascii_case("pl") {
        (&PL_FULL, &PL_ABBR)
    } else {
        (&EN_FULL, &EN_ABBR)
    };
    if abbrev { abbr[i] } else { full[i] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_is_identity_fallback() {
        assert_eq!(t("greeting"), "greeting");
    }

    #[test]
    fn number_groups_and_rounds() {
        assert_eq!(number(&1234.6, &0.0, "en"), "1,235");
        assert_eq!(number(&1234.4, &0.0, "en"), "1,234");
        assert_eq!(number(&1234.567, &2.0, "en"), "1,234.57");
        assert_eq!(number(&-1000000.0, &0.0, "en"), "-1,000,000");
        assert_eq!(number(&5.0, &2.0, "en"), "5.00");
    }

    #[test]
    fn number_uses_locale_separators() {
        // Same value, locale-appropriate group + decimal separators (CLDR `latn`).
        assert_eq!(number(&1234.5, &2.0, "en"), "1,234.50");
        assert_eq!(number(&1234.5, &2.0, "de"), "1.234,50");
        assert_eq!(number(&1234.5, &2.0, "fr"), "1\u{202f}234,50"); // narrow no-break space
        assert_eq!(number(&1234.5, &2.0, "pl"), "1\u{a0}234,50"); // no-break space
        // An unlisted tag falls back to en-US; the primary subtag is what counts.
        assert_eq!(number(&9.5, &1.0, "ja"), "9.5");
        assert_eq!(number(&1234.5, &2.0, "de-AT"), "1.234,50");
    }

    #[test]
    fn select_plural_cldr_categories() {
        // English/Germanic: `one` only for exactly 1.
        assert_eq!(selectPlural(&1.0, "en"), "one");
        assert_eq!(selectPlural(&0.0, "en"), "other");
        assert_eq!(selectPlural(&2.0, "en"), "other");
        assert_eq!(selectPlural(&1.5, "en"), "other");
        // German: same Germanic rule as English.
        assert_eq!(selectPlural(&1.0, "de"), "one");
        assert_eq!(selectPlural(&2.0, "de"), "other");
        // French: 0 and 1 are `one`.
        assert_eq!(selectPlural(&0.0, "fr"), "one");
        assert_eq!(selectPlural(&1.0, "fr"), "one");
        assert_eq!(selectPlural(&2.0, "fr"), "other");
        // Russian: one/few/many, with the 11→many and 21→one edges.
        assert_eq!(selectPlural(&1.0, "ru"), "one");
        assert_eq!(selectPlural(&21.0, "ru"), "one");
        assert_eq!(selectPlural(&2.0, "ru"), "few");
        assert_eq!(selectPlural(&5.0, "ru"), "many");
        assert_eq!(selectPlural(&11.0, "ru"), "many");
        assert_eq!(selectPlural(&1.5, "ru"), "other");
        // Polish.
        assert_eq!(selectPlural(&1.0, "pl"), "one");
        assert_eq!(selectPlural(&2.0, "pl"), "few");
        assert_eq!(selectPlural(&22.0, "pl"), "few");
        assert_eq!(selectPlural(&5.0, "pl"), "many");
        assert_eq!(selectPlural(&12.0, "pl"), "many");
        // Czech.
        assert_eq!(selectPlural(&1.0, "cs"), "one");
        assert_eq!(selectPlural(&3.0, "cs"), "few");
        assert_eq!(selectPlural(&5.0, "cs"), "other");
        assert_eq!(selectPlural(&1.5, "cs"), "many");
        // Arabic: all six categories.
        assert_eq!(selectPlural(&0.0, "ar"), "zero");
        assert_eq!(selectPlural(&1.0, "ar"), "one");
        assert_eq!(selectPlural(&2.0, "ar"), "two");
        assert_eq!(selectPlural(&3.0, "ar"), "few");
        assert_eq!(selectPlural(&11.0, "ar"), "many");
        assert_eq!(selectPlural(&100.0, "ar"), "other");
        // Japanese: no plural distinction.
        assert_eq!(selectPlural(&1.0, "ja"), "other");
        assert_eq!(selectPlural(&5.0, "ja"), "other");
        // Region subtag ignored; an unknown language falls back to the English rule.
        assert_eq!(selectPlural(&1.0, "pl-PL"), "one");
        assert_eq!(selectPlural(&1.0, "xx"), "one");
        assert_eq!(selectPlural(&2.0, "xx"), "other");
    }

    #[test]
    fn relative_phrasing() {
        assert_eq!(relative(&0.0, "day"), "now");
        assert_eq!(relative(&1.0, "day"), "in 1 day");
        assert_eq!(relative(&3.0, "hour"), "in 3 hours");
        assert_eq!(relative(&-1.0, "week"), "1 week ago");
        assert_eq!(relative(&-2.0, "month"), "2 months ago");
    }

    #[test]
    fn date_formats_iso() {
        assert_eq!(date("2026-06-09", "%Y-%m-%d", "en"), "2026-06-09");
        assert_eq!(
            date("2026-06-09T14:05:09Z", "%d %B %Y", "en"),
            "09 June 2026"
        );
        assert_eq!(date("2026-06-09T14:05:09+02:00", "%H:%M", "en"), "14:05");
        assert_eq!(date("2026-01-02", "%b %e", "en"), "Jan  2");
        // Unparseable → passthrough.
        assert_eq!(date("not-a-date", "%Y", "en"), "not-a-date");
    }

    #[test]
    fn date_localizes_month_names() {
        // `%B`/`%b` follow the language; numeric fields do not. Unknown tags → English.
        assert_eq!(date("2026-06-09", "%d. %B %Y", "de"), "09. Juni 2026");
        assert_eq!(date("2026-03-02", "%b", "de"), "Mär");
        assert_eq!(date("2026-06-09", "%e %B %Y", "fr"), " 9 juin 2026");
        assert_eq!(date("2026-08-01", "%b", "fr"), "août");
        assert_eq!(date("2026-01-09", "%d %B %Y", "pl"), "09 styczeń 2026");
        assert_eq!(date("2026-10-09", "%b", "pl"), "paź");
        assert_eq!(date("2026-06-09", "%B", "pt"), "June"); // fallback
        assert_eq!(date("2026-06-09", "%Y-%m-%d", "de"), "2026-06-09"); // numeric unaffected
    }
}
