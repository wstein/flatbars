//! i18n integration for the VM lab.
//!
//! The VM resolves an unknown helper head against a [`Helpers`] registry whose entries
//! are `Fn(&[Value]) -> Result<Value, String>` (the runtime's calling convention). The
//! blessed [`trussbars_i18n`] pack is *typed* (`number(&f64, &f64)`, …) and lives below
//! the VM, so it cannot — and must not — speak `&[Value]` itself (that would invert the
//! layering). The thin `&[Value]` shims therefore live here, in the host.
//!
//! This also draws the documented i18n boundary (`docs/09 §5`): [`trussbars_i18n`] owns
//! the *format primitives* (`number`/`date`/`selectPlural`/`relative`), while the **host
//! owns the message catalog** for `t`. Here the catalog is live-editable YAML (the i18n
//! pane), parsed into a [`Catalog`]. The module is self-contained so it can be lifted into
//! a future `trussbars-vm-i18n` bridge crate.

use std::collections::BTreeMap;
use std::rc::Rc;

use trussbars_vm::{Helpers, Value};

use crate::Locale;

/// A message catalog: locale code → message key → message.
pub type Catalog = BTreeMap<String, BTreeMap<String, String>>;

/// Parse the i18n pane (YAML) into a [`Catalog`], or a human-readable reason.
///
/// # Errors
/// The `serde_yaml` parse error, prefixed `invalid i18n catalog:`.
pub fn parse_catalog(src: &str) -> Result<Catalog, String> {
    serde_yaml::from_str(src).map_err(|e| format!("invalid i18n catalog: {e}"))
}

/// Register the i18n host-helper pack on `helpers`, bound to `locale` and `catalog`. The
/// lab's selected locale (not a data field) is the language: each shim captures it, so
/// cycling the locale (or editing the catalog) and re-registering re-renders.
pub fn register(helpers: &mut Helpers, locale: Locale, catalog: &Rc<Catalog>) {
    let lang = locale.code();
    let code = locale.code().to_string();

    // `t key` — host catalog lookup; `trussbars_i18n::t` (key echoed) covers a miss.
    let cat = Rc::clone(catalog);
    let t_code = code.clone();
    helpers.register("t", move |args| {
        let key = str_arg(args, 0, "t")?;
        Ok(vstr(
            lookup(&cat, &t_code, key).unwrap_or_else(|| trussbars_i18n::t(key).to_string()),
        ))
    });

    // `number value decimals` — fixed-decimals + thousands grouping (en-US fallback).
    helpers.register("number", |args| {
        let value = num_arg(args, 0, "number")?;
        let decimals = num_arg(args, 1, "number")?;
        Ok(vstr(trussbars_i18n::number(&value, &decimals)))
    });

    // `plural count noun` — compose the CLDR category (in the lab's language) with the
    // catalog: `{{plural count "item"}}` → `item.<category>` → localized noun.
    let cat = Rc::clone(catalog);
    helpers.register("plural", move |args| {
        let count = num_arg(args, 0, "plural")?;
        let noun = str_arg(args, 1, "plural")?;
        let category = trussbars_i18n::selectPlural(&count, lang);
        let key = format!("{noun}.{category}");
        Ok(vstr(
            lookup(&cat, &code, &key).unwrap_or_else(|| noun.to_string()),
        ))
    });

    // `selectPlural count` — the raw CLDR cardinal category (lab's language).
    helpers.register("selectPlural", move |args| {
        let count = num_arg(args, 0, "selectPlural")?;
        Ok(vstr(trussbars_i18n::selectPlural(&count, lang).to_string()))
    });

    // `date iso pattern` — strftime formatting; `%B`/`%b` localize to the lab's language.
    helpers.register("date", move |args| {
        let value = str_arg(args, 0, "date")?;
        let pattern = str_arg(args, 1, "date")?;
        Ok(vstr(trussbars_i18n::date(value, pattern, lang)))
    });

    // `relative value unit` — "in 3 days" / "2 hours ago" (English phrasing fallback).
    helpers.register("relative", |args| {
        let value = num_arg(args, 0, "relative")?;
        let unit = str_arg(args, 1, "relative")?;
        Ok(vstr(trussbars_i18n::relative(&value, unit)))
    });
}

fn lookup(catalog: &Catalog, code: &str, key: &str) -> Option<String> {
    catalog.get(code).and_then(|m| m.get(key)).cloned()
}

/// The default i18n catalog seeded into the pane. The host owns it — `trussbars_i18n`
/// ships none. Single-sourced from the sibling `i18n-data` example's `catalog.yaml`
/// (embedded at build time) so the two examples can't drift on the message data; Polish
/// carries CLDR's four cardinal forms (one/few/many/other), the others one/other.
pub const CATALOG_SEED: &str = include_str!("../../i18n-data/catalog.yaml");

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
