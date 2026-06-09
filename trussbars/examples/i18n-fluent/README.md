# i18n-fluent-example — a real Fluent `t` host helper (recipe)

The base [`trussbars-i18n`](../../crates/trussbars-i18n) crate ships a *fallback*
`t` (it returns the key unchanged) — deliberately zero-dependency and `no_std`-clean.
**Real translation is a host concern.** This example is the recipe for wiring
[`i18n-embed`](https://crates.io/crates/i18n-embed) (Project Fluent + runtime language
negotiation) into a Trussbars `t` host helper, so a template's `{{t "key"}}` renders
the active language.

It lives in its own Cargo workspace, so the Fluent dependency graph never reaches the
`no_std`-capable trussbars crates.

```sh
cargo +1.96.0 run     # renders the cart in en, de, pl (runtime language switch)
cargo +1.96.0 test    # asserts all three translations
```
```
[en] Your cart: 3
[de] Dein Warenkorb: 3
[pl] Twój koszyk: 3
fl! title = Twój koszyk
```

## The pieces

| File | Role |
| --- | --- |
| `i18n.toml` | i18n-embed config — `fallback_language = "en"`, `assets_dir = "i18n"`. |
| `i18n/<lang>/i18n_fluent_example.ftl` | the Fluent catalogs (the file is named after the crate — that's the `fl!` convention). |
| `src/lib.rs` | a `RustEmbed` over `i18n/`, a process-wide `FluentLanguageLoader`, `set_language`, and the `t` helper. |
| `src/templates.rs` | `truss!(render_cart, Cart, path = "…", helpers = [t])` — declares `t` for the template. |
| `templates/cart.truss` | `{{t "cart-title"}}: {{#if item_count > 0}}{{item_count}}{{else}}{{t "cart-empty"}}{{/if}}` |

## The one thing worth understanding: `get` vs `fl!`

`i18n-embed-fl`'s `fl!(LOADER, "cart-title")` is **compile-time checked** — a typo'd
message id is a *build* error. But it needs a **literal** id. The Trussbars `t` helper
receives its key as a **runtime `&str`** (`{{t "cart-title"}}` compiles to
`t(&"cart-title")`), so it can't use `fl!` — it uses the loader's runtime lookup:

```rust
static LOADER: Lazy<FluentLanguageLoader> = Lazy::new(|| {
    let loader = fluent_language_loader!();
    loader.load_fallback_language(&Localizations).expect("en loads");
    loader
});

// The Trussbars host helper — runtime key, runtime lookup.
pub fn t(key: &str) -> String { LOADER.get(key) }

// Host-side Rust can still use the compile-time-checked form (literal id):
pub fn cart_title() -> String { fl!(LOADER, "cart-title") }
```

So you trade `fl!`'s compile-time id checking for a dynamic key. (Recovering it —
validating `{{t "id"}}` literals against the catalog at the Trussbars **macro** layer —
is a possible future extension; see `trussbars/docs/09-host-helpers.md`.)

The shared `&'static` loader works with the fixed `t(&str) -> String` signature because
`FluentLanguageLoader` has interior mutability: `set_language` switches the active
language at runtime without a `mut` loader or a per-render argument — keeping the
"names are static, no per-call dispatch object" host-helper shape (docs/09).

## When to use this vs the base crate

- **`trussbars-i18n`** — you want `date`/`number`/`selectPlural` formatters and a
  no-crash `t` fallback, with zero dependencies and `no_std`. Most apps.
- **This recipe** — you need a real message catalog, runtime language negotiation,
  plurals/selects/BiDi from Fluent. Copy this wiring; declare your own `t`.
