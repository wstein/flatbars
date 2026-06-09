//! i18n integration for the VM lab.
//!
//! The VM resolves an unknown helper head against a [`Helpers`] registry whose entries
//! are `Fn(&[Value]) -> Result<Value, String>` (the runtime's calling convention). The
//! blessed [`trussbars_i18n`] pack is *typed* (`number(&f64, &f64)`, …) and lives below
//! the VM, so it cannot — and must not — speak `&[Value]` itself (that would invert the
//! layering; see the design notes). The thin `&[Value]` shims therefore live here, in
//! the host.
//!
//! This also draws the documented i18n boundary (`docs/09 §5`): [`trussbars_i18n`] owns
//! the *format primitives* (`number` / `date` / `selectPlural`), while the **host owns
//! the message catalog** for `t`. The whole module is self-contained so it can be lifted
//! verbatim into a future `trussbars-vm-i18n` bridge crate the day a second VM host wants it.

use std::rc::Rc;

use trussbars_vm::{Helpers, Value};

use crate::Locale;

/// Register the i18n host-helper pack on `helpers`, bound to `locale`:
/// `t` (catalog lookup, identity fallback), `number`, `plural` (selectPlural + catalog),
/// `selectPlural` (raw CLDR category), `date`, and `relative`.
pub fn register(helpers: &mut Helpers, locale: Locale) {
    // `t key` — host-owned catalog lookup; the `trussbars_i18n::t` identity fallback
    // (key echoed) covers a miss, exactly as the reference seam documents.
    helpers.register("t", move |args| {
        let key = str_arg(args, 0, "t")?;
        Ok(vstr(
            catalog_lookup(locale, key).unwrap_or_else(|| trussbars_i18n::t(key).to_string()),
        ))
    });

    // `number value decimals` — fixed-decimals + thousands grouping (en-US fallback).
    helpers.register("number", |args| {
        let value = num_arg(args, 0, "number")?;
        let decimals = num_arg(args, 1, "number")?;
        Ok(vstr(trussbars_i18n::number(&value, &decimals)))
    });

    // `plural count noun lang` — compose the CLDR category with the catalog:
    // `{{plural count "item" locale}}` → `item.<category>` → localized noun.
    helpers.register("plural", move |args| {
        let count = num_arg(args, 0, "plural")?;
        let noun = str_arg(args, 1, "plural")?;
        let lang = str_arg(args, 2, "plural")?;
        let category = trussbars_i18n::selectPlural(&count, lang);
        let key = format!("{noun}.{category}");
        Ok(vstr(
            catalog_lookup(locale, &key).unwrap_or_else(|| noun.to_string()),
        ))
    });

    // `selectPlural count lang` — the raw CLDR cardinal category, for templates that
    // want to drive their own selection.
    helpers.register("selectPlural", |args| {
        let count = num_arg(args, 0, "selectPlural")?;
        let lang = str_arg(args, 1, "selectPlural")?;
        Ok(vstr(trussbars_i18n::selectPlural(&count, lang).to_string()))
    });

    // `date iso pattern` — strftime-style formatting of an ISO-8601 string.
    helpers.register("date", |args| {
        let value = str_arg(args, 0, "date")?;
        let pattern = str_arg(args, 1, "date")?;
        Ok(vstr(trussbars_i18n::date(value, pattern)))
    });

    // `relative value unit` — "in 3 days" / "2 hours ago" (English phrasing fallback).
    helpers.register("relative", |args| {
        let value = num_arg(args, 0, "relative")?;
        let unit = str_arg(args, 1, "relative")?;
        Ok(vstr(trussbars_i18n::relative(&value, unit)))
    });
}

/// The host message catalog for `t`, keyed by locale. The lab *is* the host, so it owns
/// these — `trussbars_i18n` deliberately ships none (its `t` only echoes keys).
/// `samples` reads it too, to bake localized strings into the AOT-friendly greeting.
pub(crate) fn catalog_lookup(locale: Locale, key: &str) -> Option<String> {
    catalog(locale)
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| (*v).to_string())
}

fn catalog(locale: Locale) -> &'static [(&'static str, &'static str)] {
    match locale {
        Locale::En => &[
            ("title", "Receipt"),
            ("hello", "Hello"),
            ("total", "Total"),
            ("placed", "Placed"),
            ("item.one", "item"),
            ("item.other", "items"),
            ("note", "Thanks for your order."),
        ],
        Locale::De => &[
            ("title", "Beleg"),
            ("hello", "Hallo"),
            ("total", "Summe"),
            ("placed", "Erstellt"),
            ("item.one", "Artikel"),
            ("item.other", "Artikel"),
            ("note", "Danke für Ihre Bestellung."),
        ],
        Locale::Fr => &[
            ("title", "Reçu"),
            ("hello", "Bonjour"),
            ("total", "Total"),
            ("placed", "Établi"),
            ("item.one", "article"),
            ("item.other", "articles"),
            ("note", "Merci pour votre commande."),
        ],
    }
}

// ── `&[Value]` argument shims ────────────────────────────────────────────────

fn vstr(s: String) -> Value {
    Value::Str(Rc::from(s))
}

fn num_arg(args: &[Value], i: usize, who: &str) -> Result<f64, String> {
    match args.get(i) {
        Some(Value::Num(n)) => Ok(*n),
        _ => Err(format!("{who}: argument {i} must be a number")),
    }
}

fn str_arg<'a>(args: &'a [Value], i: usize, who: &str) -> Result<&'a str, String> {
    match args.get(i) {
        Some(Value::Str(s)) => Ok(s.as_ref()),
        _ => Err(format!("{who}: argument {i} must be a string")),
    }
}
