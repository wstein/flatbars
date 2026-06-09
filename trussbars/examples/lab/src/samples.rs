//! The two demo samples and their runtime data.
//!
//! `Receipt` exercises the i18n **host helpers** (`t`/`number`/`plural`/`date`) — it is
//! VM-only (AOT rejects host helpers). `Greeting` localizes the other way: the host bakes
//! already-translated strings into the data, so it needs no helpers and compiles under AOT
//! — the contrast `render_compat` makes visible.

use std::collections::BTreeMap;
use std::rc::Rc;

use trussbars_vm::Value;

use crate::Locale;
use crate::i18n::catalog_lookup;

/// Which demo template is loaded.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Sample {
    Receipt,
    Greeting,
}

impl Sample {
    /// Every sample, for the golden matrix and the UI cycle.
    pub const ALL: [Sample; 2] = [Sample::Receipt, Sample::Greeting];

    /// A short, stable key used in golden filenames.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Sample::Receipt => "receipt",
            Sample::Greeting => "greeting",
        }
    }

    /// The human-facing description shown in the status bar.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Sample::Receipt => "receipt — i18n host helpers (VM-only)",
            Sample::Greeting => "greeting — localized via data (AOT-compatible)",
        }
    }

    /// The next sample in the UI cycle.
    #[must_use]
    pub fn next(self) -> Sample {
        match self {
            Sample::Receipt => Sample::Greeting,
            Sample::Greeting => Sample::Receipt,
        }
    }

    /// The template source.
    #[must_use]
    pub fn template(self) -> &'static str {
        match self {
            Sample::Receipt => RECEIPT_TMPL,
            Sample::Greeting => GREETING_TMPL,
        }
    }

    /// The runtime data for this sample at `locale`.
    #[must_use]
    pub fn data(self, locale: Locale) -> Value {
        match self {
            Sample::Receipt => receipt_data(locale),
            Sample::Greeting => greeting_data(locale),
        }
    }
}

// Host helpers throughout (`t`/`number`/`plural`/`date`) — VM-only by construction.
const RECEIPT_TMPL: &str = r#"== {{t "title"}} ==
{{t "hello"}}, {{customer}}!
{{#each items}}  - {{name}}: {{number price 2}}
{{/each}}{{t "total"}}: {{number total 2}}  ({{count}} {{plural count "item" locale}})
{{t "placed"}}: {{date placed dateFmt}}
"#;

// Plain interpolation — the host pre-localized `greeting`/`note` into the data, so the
// template carries no helpers and renders identically under the AOT-compat proxy.
const GREETING_TMPL: &str = r#"{{greeting}}, {{customer}}!
{{note}}
"#;

fn receipt_data(locale: Locale) -> Value {
    obj([
        ("customer", vstr("Ada")),
        ("count", Value::Num(3.0)),
        ("total", Value::Num(1311.80)),
        ("placed", vstr("2026-06-09")),
        ("locale", vstr(locale.code())),
        ("dateFmt", vstr(date_fmt(locale))),
        (
            "items",
            Value::Array(Rc::from(vec![
                item("Keyboard", 899.0),
                item("Mouse", 400.5),
                item("Cable", 12.3),
            ])),
        ),
    ])
}

fn greeting_data(locale: Locale) -> Value {
    obj([
        ("customer", vstr("Ada")),
        ("greeting", vstr(&loc(locale, "hello"))),
        ("note", vstr(&loc(locale, "note"))),
    ])
}

/// A locale-appropriate `strftime` pattern (the crate's `%b` month names are English,
/// so `de`/`fr` use numeric patterns).
fn date_fmt(locale: Locale) -> &'static str {
    match locale {
        Locale::En => "%b %d, %Y",
        Locale::De => "%d.%m.%Y",
        Locale::Fr => "%d/%m/%Y",
    }
}

fn loc(locale: Locale, key: &str) -> String {
    catalog_lookup(locale, key).unwrap_or_else(|| key.to_string())
}

fn item(name: &str, price: f64) -> Value {
    obj([("name", vstr(name)), ("price", Value::Num(price))])
}

fn vstr(s: &str) -> Value {
    Value::Str(Rc::from(s))
}

fn obj<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    let map: BTreeMap<String, Value> = pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    Value::Object(Rc::new(map))
}
