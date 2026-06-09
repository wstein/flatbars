# i18n-data — unified i18n via compile-time helpers over a data catalog

The one place that answers "how do I do i18n that works the **same on AOT and the VM**?"

The pattern, in two sentences:

1. **The catalog is fetched data.** A `Catalog` = `locale → key → message` map, *fetched*
   at render time — here from [`catalog.yaml`](catalog.yaml) via serde (the order lives in
   [`data.yaml`](data.yaml)) — and carried on the context like any other data, *not* a
   separate helper registry. Swap the loader body for a `.ftl` import, a DB row, or an HTTP
   call and nothing else changes.
2. **Declared helpers fetch from it.** `t` / `plural` / `number` / `date` are plain Rust
   functions listed in `truss!(…, helpers = […])`; the template calls them by name and the
   dynamic catalog lookup happens *inside Rust*.

```sh
cargo run --release                          # render en/de/fr/pl from the embedded catalog.yaml
cargo run --release -- --catalog other.yaml  # fetch the catalog from disk at runtime instead
cargo test                                   # AOT renders + a VM-parity check (byte-identical)
```

`--catalog <path>` makes the "swap the source" claim literal — the messages come from that
file (`std::fs::read_to_string` + serde) instead of the embedded default, and nothing else
(template or helpers) changes.

## The data ([`catalog.yaml`](catalog.yaml) + [`data.yaml`](data.yaml))

The catalog and the order are authored as **YAML and decoded through serde** — not Rust
literals. `load_catalog` / `load_order` `include_str!` them (so the example is
CWD-independent) and `serde_yaml` deserializes; `page(locale)` composes the two plus the
chosen locale into the render `Page`. That separation is the point: the order file is
locale-agnostic, and the catalog source is swappable without touching the template or the
helpers.

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
  {{name}}: {{number price 2 root.locale}}
{{/each}}{{t catalog locale "total"}}: {{number total 2 locale}}  ({{count}} {{plural catalog locale "item" count}})
```

(`number` takes the locale too, so the total localizes — `root.locale` reaches it from
inside the `{{#each}}` loop, where `this` is the item.)

The format primitives come from [`trussbars-i18n`](../../crates/trussbars-i18n)
(`number`/`date`/`selectPlural`, incl. CLDR plural categories, localized month names, and
locale group/decimal separators); this crate is the **host** that owns the catalog and
wires the helpers. The total shows the separators flip per locale — `1,311.80` (en) ·
`1.311,80` (de) · `1 311,80` (fr/pl) — and Polish exercises the four-form plural
(`1 element`, `3 elementy`, `5 elementów`).

## Relationship to the other examples

`blog`/`changelog` show AOT host helpers in passing; the [`lab`](../lab) is the live VM
playground (the `receipt` sample registers the same helpers at runtime). **This** example is
the focused, dual-backend reference for the data-catalog pattern.
