//! # i18n-data — unified i18n via compile-time helpers over a data catalog
//!
//! How to do i18n that renders **identically on AOT and the VM**: keep the message catalog
//! as ordinary **data** (like `data.yaml`) and look it up through **declared custom
//! helpers**.
//!
//! ## The two pieces
//!
//! 1. **The catalog is data.** It's a `Catalog` (`locale → key → message`) field on the
//!    context — not a separate registry. It is *fetched* and deserialized at render time:
//!    here from [`catalog.yaml`](../catalog.yaml) (the order data lives in
//!    [`data.yaml`](../data.yaml)), but swap `load_catalog` for a `.ftl` import, a DB row,
//!    or an HTTP call and nothing else changes.
//!
//! 2. **Helpers fetch from it.** `t` / `plural` / `number` / `date` are plain Rust
//!    functions declared with `truss!(…, helpers = […])`. The template calls them **by
//!    name** — a *static* call site (no data chooses which helper runs, so no SSTI) — and
//!    the dynamic catalog lookup happens *inside Rust*, over the map.
//!
//! ## Why not `{{catalog.[locale].title}}` (direct field access)?
//!
//! AOT compiles field access to a *static* path — `ctx.catalog.en.title`. A **runtime**
//! `locale` can't index a typed struct field, so direct dynamic field access is VM-only
//! (and the `.[locale]` syntax doesn't even parse). A declared helper sidesteps it:
//! `t(&catalog, &locale, "title")` is a typed call whose **body** does `catalog.get(locale)`
//! at runtime — fine in plain Rust regardless of AOT's type-blindness. Same template, both
//! backends.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use trussbars_macros::truss;

/// A message catalog: `locale code → message key → translated message`. Plain data —
/// fetch it from a file (as [`load_catalog`] does), a DB, or a `.ftl` import; the helpers
/// don't care where it comes from.
pub type Catalog = BTreeMap<String, BTreeMap<String, String>>;

/// The (locale-agnostic) order, mirroring [`data.yaml`](../data.yaml). The locale and the
/// catalog are fetched separately and composed onto this to build a [`Page`].
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Order {
    pub customer: String,
    pub total: f64,
    pub count: f64,
    pub placed: String,
    pub items: Vec<Item>,
}

/// The render context: the chosen `locale`, the fetched `catalog`, and the fetched order
/// (flattened in so the template's paths stay `{{customer}}`, not `{{order.customer}}` —
/// AOT compiles each to a typed field access).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Page {
    pub locale: String,
    pub catalog: Catalog,
    pub customer: String,
    pub total: f64,
    pub count: f64,
    pub placed: String,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Item {
    pub name: String,
    pub price: f64,
}

// ── Custom helpers ───────────────────────────────────────────────────────────
// Plain functions, declared in `helpers = […]`, called by name from the template. The
// catalog/locale arrive as ordinary *arguments*, so a helper is reusable across any context
// that carries a catalog — it isn't coupled to `Page`, and it works in nested scopes.

/// `{{t catalog locale "key"}}` — fetch a message from the data catalog; the
/// `trussbars_i18n::t` identity fallback (key echoed) covers a miss.
#[must_use]
pub fn t(catalog: &Catalog, locale: &str, key: &str) -> String {
    catalog
        .get(locale)
        .and_then(|m| m.get(key))
        .cloned()
        .unwrap_or_else(|| trussbars_i18n::t(key).to_string())
}

/// `{{plural catalog locale "item" count}}` — pick the CLDR cardinal category and read
/// `"item.<category>"` from the catalog (falls back to the bare noun).
#[must_use]
pub fn plural(catalog: &Catalog, locale: &str, noun: &str, count: &f64) -> String {
    let category = trussbars_i18n::selectPlural(count, locale);
    let key = format!("{noun}.{category}");
    catalog
        .get(locale)
        .and_then(|m| m.get(&key))
        .cloned()
        .unwrap_or_else(|| noun.to_string())
}

/// `{{number value 2}}` — fixed-decimals + thousands grouping (en-US fallback).
#[must_use]
pub fn number(value: &f64, decimals: &f64) -> String {
    trussbars_i18n::number(value, decimals)
}

/// `{{date iso "%d %B %Y" locale}}` — strftime formatting with localized month names.
#[must_use]
pub fn date(iso: &str, pattern: &str, locale: &str) -> String {
    trussbars_i18n::date(iso, pattern, locale)
}

// ── AOT: the truss! macro compiles the template to a typed `fn(&Page) -> String` ─────
// Each helper call is emitted as a direct, type-checked Rust call (e.g.
// `t(&page.catalog, &page.locale, "title")`); there is no runtime helper dispatch.

truss!(
    render_receipt,
    Page,
    path = "src/receipt.truss",
    helpers = [t, plural, number, date]
);

// ── fetching the data ──────────────────────────────────────────────────────────
// The catalog and the order are *data*, authored as YAML and decoded through serde —
// not Rust literals. They're embedded with `include_str!` to keep the example
// CWD-independent; a real host swaps these bodies for `std::fs::read_to_string`, a DB
// query, or a `.ftl` import without touching the template or the helpers.

/// Fetch the en/de/fr/pl message catalog from [`catalog.yaml`](../catalog.yaml). Polish
/// carries CLDR's `few`/`many` forms.
#[must_use]
pub fn load_catalog() -> Catalog {
    serde_yaml::from_str(include_str!("../catalog.yaml")).expect("catalog.yaml is valid YAML")
}

/// Fetch the (locale-agnostic) order from [`data.yaml`](../data.yaml).
#[must_use]
pub fn load_order() -> Order {
    serde_yaml::from_str(include_str!("../data.yaml")).expect("data.yaml is valid YAML")
}

/// Compose the render context for `locale` from the embedded catalog + order.
#[must_use]
pub fn page(locale: &str) -> Page {
    page_with_catalog(locale, load_catalog())
}

/// Compose the render context from an explicitly-supplied `catalog` (e.g. one fetched from
/// a file at runtime — see the bin's `--catalog`) plus the embedded order. This is the
/// "swap the source" seam: the template and helpers are identical regardless of where the
/// catalog came from.
#[must_use]
pub fn page_with_catalog(locale: &str, catalog: Catalog) -> Page {
    let order = load_order();
    Page {
        locale: locale.to_string(),
        catalog,
        customer: order.customer,
        total: order.total,
        count: order.count,
        placed: order.placed,
        items: order.items,
    }
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use trussbars_vm::{Helpers, Template, Value};

    use super::*;

    #[test]
    fn aot_localizes_through_the_catalog() {
        let en = render_receipt(&page("en"));
        assert!(en.contains("== Receipt =="), "{en}");
        assert!(en.contains("Total: 1,311.80"), "{en}");
        assert!(en.contains("(3 items)"), "{en}");
        assert!(en.contains("Placed: 09 June 2026"), "{en}");

        let de = render_receipt(&page("de"));
        assert!(de.contains("== Beleg =="), "{de}");
        assert!(de.contains("(3 Artikel)"), "{de}");
        assert!(de.contains("09 Juni 2026"), "{de}");

        // Polish exercises the CLDR `few` form (3 → elementy) + the Polish month name.
        let pl = render_receipt(&page("pl"));
        assert!(pl.contains("== Paragon =="), "{pl}");
        assert!(pl.contains("(3 elementy)"), "{pl}");
        assert!(pl.contains("09 czerwiec 2026"), "{pl}");
    }

    // ── The unification proof: the SAME template + catalog data, rendered through the VM
    //    with `&[Value]` helper shims, must be byte-identical to the AOT output. ──

    #[test]
    fn vm_render_matches_aot() {
        for locale in ["en", "de", "fr", "pl"] {
            let ctx = page(locale);
            // The same context as dynamic data (a YAML round-trip — catalog and order are
            // just data the VM doesn't know the shape of).
            let yaml = serde_yaml::to_string(&ctx).unwrap();
            let data = to_vm(&serde_yaml::from_str(&yaml).unwrap());

            let mut helpers = Helpers::new();
            helpers.register("t", |a| {
                Ok(vstr(
                    cat_get(&a[0], str_(&a[1]), str_(&a[2]))
                        .unwrap_or_else(|| str_(&a[2]).to_string()),
                ))
            });
            helpers.register("plural", |a| {
                let key = format!(
                    "{}.{}",
                    str_(&a[2]),
                    trussbars_i18n::selectPlural(&num_(&a[3]), str_(&a[1]))
                );
                Ok(vstr(
                    cat_get(&a[0], str_(&a[1]), &key).unwrap_or_else(|| str_(&a[2]).to_string()),
                ))
            });
            helpers.register("number", |a| {
                Ok(vstr(trussbars_i18n::number(&num_(&a[0]), &num_(&a[1]))))
            });
            helpers.register("date", |a| {
                Ok(vstr(trussbars_i18n::date(
                    str_(&a[0]),
                    str_(&a[1]),
                    str_(&a[2]),
                )))
            });

            let tmpl = Template::parse(include_str!("receipt.truss")).unwrap();
            let vm = tmpl.render_with(&data, &Rc::new(helpers)).unwrap();
            assert_eq!(vm, render_receipt(&ctx), "VM ≠ AOT for {locale}");
        }
    }

    fn str_(v: &Value) -> &str {
        match v {
            Value::Str(s) => s,
            _ => "",
        }
    }

    fn num_(v: &Value) -> f64 {
        match v {
            Value::Num(n) => *n,
            _ => 0.0,
        }
    }

    fn vstr(s: String) -> Value {
        Value::Str(Rc::from(s))
    }

    /// `catalog[locale][key]` over a dynamic `Value` catalog.
    fn cat_get(catalog: &Value, locale: &str, key: &str) -> Option<String> {
        let Value::Object(by_locale) = catalog else {
            return None;
        };
        let Value::Object(messages) = by_locale.get(locale)? else {
            return None;
        };
        match messages.get(key)? {
            Value::Str(s) => Some(s.to_string()),
            _ => None,
        }
    }

    fn to_vm(y: &serde_yaml::Value) -> Value {
        match y {
            serde_yaml::Value::Null => Value::Null,
            serde_yaml::Value::Bool(b) => Value::Bool(*b),
            serde_yaml::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
            serde_yaml::Value::String(s) => Value::Str(Rc::from(s.as_str())),
            serde_yaml::Value::Sequence(a) => {
                Value::Array(Rc::from(a.iter().map(to_vm).collect::<Vec<_>>()))
            }
            serde_yaml::Value::Mapping(m) => Value::Object(Rc::new(
                m.iter()
                    .filter_map(|(k, v)| k.as_str().map(|k| (k.to_string(), to_vm(v))))
                    .collect(),
            )),
            serde_yaml::Value::Tagged(t) => to_vm(&t.value),
        }
    }
}
