//! The two starting samples: each seeds the editable Template and Data (YAML) panes.
//!
//! `Receipt` exercises the full i18n **host-helper pack** (`t`/`number`/`plural`/`date`/
//! `relative`); `Greeting` is a minimal one — just `{{t}}` over the catalog, with only the
//! name in its data. Both localize live as the lab's locale (or the catalog) changes, and
//! both are VM-only (the compat proxy rejects host helpers). Everything is editable at
//! runtime.

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
            Sample::Receipt => "receipt — full i18n host-helper pack (VM-only)",
            Sample::Greeting => "greeting — minimal i18n via the catalog (VM-only)",
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

// Host helpers throughout — VM-only. `%B` shows the localized month name; `plural`/`date`
// take the language from the lab's locale, not the data. `count` is 1 by default so the
// singular shows — bump it (or add items) to watch the plural switch. Block and comment
// tags sit on their own lines (standalone-trimmed, so they add no output).
const RECEIPT_TMPL: &str = r#"{{! receipt — i18n host helpers from the catalog pane (VM-only) }}
== {{t "title"}} ==
{{t "hello"}}, {{customer}}!
{{! one line per item; `number` formats the price }}
{{#each items}}
  - {{name}}: {{number price 2}}
{{/each}}
{{! `plural count "item"` picks the CLDR form (en items / pl elementy / …) }}
{{t "total"}}: {{number total 2}}  ({{count}} {{plural count "item"}})
{{! `date` localizes the month (%B); `relative` is English-fallback phrasing }}
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

// A minimal i18n sample: the message comes from the catalog via `t`, so only the name
// lives in the data. Cycling the locale re-localizes it (and, like any host-helper
// template, it is VM-only — the compat proxy rejects `t`).
const GREETING_TMPL: &str = r#"{{! greeting — localized through the i18n catalog (the t helper) }}
{{t "hello"}}, {{customer}}!
{{t "note"}}
"#;

const GREETING_DATA: &str = r#"customer: Ada
"#;
