//! The two starting samples: each seeds the editable Template and Data (JSON) panes.
//!
//! `Receipt` exercises the i18n **host helpers** (`t`/`number`/`plural`/`date`/`relative`)
//! — VM-only (AOT rejects host helpers), and it localizes live as the lab's locale
//! changes. `Greeting` localizes the other way — the (editable) data already holds the
//! translated strings — so it needs no helpers and renders identically under the
//! AOT-compat proxy. Both are just seeds: everything is editable at runtime.

/// Which starting sample is loaded.
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

    /// The seed template source.
    #[must_use]
    pub fn template(self) -> &'static str {
        match self {
            Sample::Receipt => RECEIPT_TMPL,
            Sample::Greeting => GREETING_TMPL,
        }
    }

    /// The seed data, as YAML text (edited live in the Data pane).
    #[must_use]
    pub fn data_yaml(self) -> &'static str {
        match self {
            Sample::Receipt => RECEIPT_DATA,
            Sample::Greeting => GREETING_DATA,
        }
    }
}

// Host helpers throughout — VM-only. `%B` shows the localized month name (Phase 1);
// `plural`/`date` take the language from the lab's locale, not the data. `count` is 1
// by default so the singular shows — bump it (or add items) to watch the plural switch.
const RECEIPT_TMPL: &str = r#"== {{t "title"}} ==
{{t "hello"}}, {{customer}}!
{{#each items}}  - {{name}}: {{number price 2}}
{{/each}}{{t "total"}}: {{number total 2}}  ({{count}} {{plural count "item"}})
{{t "placed"}}: {{date placed "%d %B %Y"}}
{{t "eta"}}: {{relative eta "day"}}
"#;

const RECEIPT_DATA: &str = r#"customer: Ada
count: 1
total: 899
placed: "2026-06-09"
eta: 3
items:
  - name: Keyboard
    price: 899
"#;

// Plain interpolation — the data already holds the localized strings, so the template
// carries no helpers and renders identically under the AOT-compat proxy.
const GREETING_TMPL: &str = r#"{{greeting}}, {{customer}}!
{{note}}
"#;

const GREETING_DATA: &str = r#"customer: Ada
greeting: Hello
note: Thanks for your order.
"#;
