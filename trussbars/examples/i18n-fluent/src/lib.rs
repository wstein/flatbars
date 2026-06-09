//! Recipe: a real Fluent (`i18n-embed`) `t` host helper for Trussbars.
//!
//! The base [`trussbars-i18n`] crate ships a dependency-free *fallback* `t` (it
//! returns the key). A host that wants real translation declares **its own** `t` over
//! a message catalog and points `#[truss_helpers(t)]` at it. This crate is that
//! recipe — Fluent `.ftl` catalogs embedded with `rust-embed`, a process-wide
//! [`FluentLanguageLoader`] with runtime language negotiation, and a `t(&str) ->
//! String` the template calls by name. See the README for the walk-through.
//!
//! Two ways to read a message, and *why the template uses the second*:
//!   * [`cart_title`] uses the **compile-time-checked** `fl!(LOADER, "cart-title")` —
//!     a typo'd id is a *build* error. But `fl!` needs a **literal** id.
//!   * [`t`] is the Trussbars host helper. The template passes the key as a runtime
//!     `&str` (`{{t "cart-title"}}` → `t(&"cart-title")`), so `fl!` can't apply — it
//!     uses the loader's runtime [`FluentLanguageLoader::get`] instead. (You trade
//!     `fl!`'s compile-time id check for a dynamic key; catalog-aware key checking at
//!     the Trussbars macro layer is a possible future extension — see docs/09.)

use i18n_embed::LanguageLoader;
use i18n_embed::fluent::{FluentLanguageLoader, fluent_language_loader};
use i18n_embed_fl::fl;
use once_cell::sync::Lazy;
use rust_embed::RustEmbed;
use unic_langid::LanguageIdentifier;

pub mod templates;

/// The embedded Fluent catalogs (`i18n/<lang>/*.ftl`).
#[derive(RustEmbed)]
#[folder = "i18n"]
struct Localizations;

/// The process-wide Fluent loader — one catalog, runtime-switchable active language.
/// `FluentLanguageLoader` has interior mutability, so a `&'static` shared loader can
/// still change language (no `mut`, no per-render argument — which is what lets the
/// fixed `t(&str)` host-helper signature work).
static LOADER: Lazy<FluentLanguageLoader> = Lazy::new(|| {
    let loader = fluent_language_loader!();
    loader
        .load_fallback_language(&Localizations)
        .expect("the fallback (en) catalog loads");
    loader
});

/// Negotiate and activate `tag` (a BCP-47 language) against the bundled catalogs.
///
/// # Panics
/// If `tag` is not a valid language identifier.
pub fn set_language(tag: &str) {
    let requested: LanguageIdentifier = tag.parse().expect("a valid BCP-47 language tag");
    let _ = i18n_embed::select(&*LOADER, &Localizations, &[requested]);
}

/// The Trussbars `t` host helper: a **runtime** catalog lookup in the active language.
#[must_use]
pub fn t(key: &str) -> String {
    LOADER.get(key)
}

/// A host-side message read via the compile-time-checked `fl!` (literal id).
#[must_use]
pub fn cart_title() -> String {
    fl!(LOADER, "cart-title")
}

/// The template's typed context.
pub struct Cart {
    /// How many items are in the cart.
    pub item_count: f64,
}

/// A sample cart.
#[must_use]
pub fn sample() -> Cart {
    Cart { item_count: 3.0 }
}
