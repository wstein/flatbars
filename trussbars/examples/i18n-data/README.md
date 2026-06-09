# i18n-data — unified i18n via compile-time helpers over a data catalog

The one place that answers "how do I do i18n that works the **same on AOT and the VM**?"

The pattern, in two sentences:

1. **The catalog is data.** A `Catalog` = `locale → key → message` map, carried on the
   context like any other data (`data.yaml`, a `.ftl` import, a DB row) — *not* a separate
   helper registry.
2. **Declared helpers fetch from it.** `t` / `plural` / `number` / `date` are plain Rust
   functions listed in `truss!(…, helpers = […])`; the template calls them by name and the
   dynamic catalog lookup happens *inside Rust*.

```sh
cargo test   # AOT renders + a VM-parity check (same template + catalog → byte-identical)
```

## Why a helper, not `{{catalog.[locale].title}}`?

Direct field access compiles, in AOT, to a **static** path — `ctx.catalog.en.title`. A
**runtime** `locale` can't index a typed struct field, so dotted dynamic access is VM-only
(and `.[locale]` doesn't even parse). A declared helper is the fix:

```rust
pub fn t(catalog: &Catalog, locale: &str, key: &str) -> String {
    catalog.get(locale).and_then(|m| m.get(key)).cloned()
        .unwrap_or_else(|| trussbars_i18n::t(key).to_string())
}
```

`{{t catalog locale "title"}}` is a **static call site** (no data picks the helper → no
SSTI). AOT emits a typed call `t(&page.catalog, &page.locale, "title")`; the VM resolves
`t` against a registered `&[Value]` shim. The lookup body — `catalog.get(locale)` — is
ordinary Rust, so it runs the same on both backends. `tests/` renders
[`src/receipt.truss`](src/receipt.truss) through **both** paths and asserts the output is
byte-identical for en/de/fr/pl.

## The template ([`src/receipt.truss`](src/receipt.truss))

```handlebars
== {{t catalog locale "title"}} ==
{{t catalog locale "greeting"}}, {{customer}}!
{{t catalog locale "placed"}}: {{date placed "%d %B %Y" locale}}
{{#each items}}
  {{name}}: {{number price 2}}
{{/each}}{{t catalog locale "total"}}: {{number total 2}}  ({{count}} {{plural catalog locale "item" count}})
```

The format primitives come from [`trussbars-i18n`](../../crates/trussbars-i18n)
(`number`/`date`/`selectPlural`, incl. CLDR plural categories and localized month names);
this crate is the **host** that owns the catalog and wires the helpers. Polish exercises the
four-form plural (`1 element`, `3 elementy`, `5 elementów`).

## Relationship to the other examples

`blog`/`changelog` show AOT host helpers in passing; the [`lab`](../lab) is the live VM
playground (the `receipt` sample registers the same helpers at runtime). **This** example is
the focused, dual-backend reference for the data-catalog pattern.
