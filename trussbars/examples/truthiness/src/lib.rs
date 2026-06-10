//! Selectable truthiness policies (`docs/16-truthiness-modes.md`), demonstrated across
//! the three layers they live at:
//!
//! 1. **AOT** — `truss!(…, truthiness = Mode)` picks a built-in policy per template.
//! 2. **VM** — `Template::with_truthiness(mode)` picks one at load time, over dynamic data.
//! 3. **Library** — a *host-defined* policy: because `Mode` is a type parameter of
//!    `TruthyIn`, a local marker lets you `impl` the rule even for the standard library's
//!    types (the orphan rule's covered-parameter case).
//!
//! The thesis: only `NonEmpty` (the default) is conformance-checked; the others are loud,
//! opt-in, and zero-cost (every policy is a monomorphized zero-sized marker).

use trussbars_core::{TruthyIn, truthy_in};
use trussbars_macros::truss;
use trussbars_vm::{Template, TruthMode, Value};

/// A tiny context: a list (to show the empty-collection divergence) and a number (to show
/// numeric truthiness — which only *exists* under a policy that defines it). No
/// `#[derive(Trussbars)]` is needed — the struct itself never sits in a boolean position
/// here (the conditions test its *fields*).
pub struct Cart {
    /// The cart's lines.
    pub items: Vec<String>,
    /// A quantity — a bare number.
    pub count: i64,
}

// ── 1. AOT: built-in policies via the macro clause ───────────────────────────────────
// The *same* template, compiled under two policies. An empty list is **falsy** under the
// default `NonEmpty` but **truthy** under `Liquid` (only `false`/`nil` are falsy there).

truss!(
    cart_default,
    Cart,
    "{{#if items}}filled{{else}}empty{{/if}}"
);
truss!(
    cart_liquid,
    Cart,
    "{{#if items}}filled{{else}}empty{{/if}}",
    truthiness = Liquid
);

// A *bare number* in a condition does not compile under `NonEmpty` — that is the §5.3
// footgun-as-compile-error, so there is deliberately no `count_default`. It is only
// expressible under a policy that gives numbers a truthiness: `0` is **falsy** under
// `Handlebars`, **truthy** under `Liquid`.
truss!(
    count_handlebars,
    Cart,
    "{{#if count}}some{{else}}none{{/if}}",
    truthiness = Handlebars
);
truss!(
    count_liquid,
    Cart,
    "{{#if count}}some{{else}}none{{/if}}",
    truthiness = Liquid
);

// ── 2. VM: a runtime-selectable policy over dynamic data ──────────────────────────────

/// Parse `src` once and render `data` under `mode` (the dynamic backend's load-time
/// policy setting — the natural home for a *runtime*-swappable rule).
///
/// # Panics
/// On a parse or render error (the templates here are valid).
#[must_use]
pub fn vm_render(src: &str, data: &Value, mode: TruthMode) -> String {
    Template::parse(src)
        .expect("valid template")
        .with_truthiness(mode)
        .render(data)
        .expect("valid render")
}

/// An object `{ items: [] }` — an empty list under one key — for the VM demo.
#[must_use]
pub fn empty_cart() -> Value {
    use std::collections::BTreeMap;
    use std::rc::Rc;
    let mut m = BTreeMap::new();
    m.insert("items".to_string(), Value::Array(Rc::from(Vec::new())));
    Value::Object(Rc::new(m))
}

// ── 3. A host-defined policy over a foreign type (the orphan-rule extension) ───────────
// `NonBlank` is a *local* marker, so impl'ing the foreign trait `TruthyIn` for foreign
// types (`str`/`String`) is allowed — a policy the built-ins don't offer: a whitespace-only
// string is falsy. This is the "define your own rule, even for std types" capability, and
// it is usable at every layer: the library `truthy_in` (below) *and* — selected by its type
// path — the `truss!(…, truthiness = self::NonBlank)` AOT clause.

/// A host policy in which a string is truthy only when it has non-whitespace content.
pub struct NonBlank;

impl TruthyIn<NonBlank> for str {
    fn truthy(&self) -> bool {
        !self.trim().is_empty()
    }
}

// The owned-`String` impl too, so a context *field* (serde deserializes strings as `String`)
// can sit in a boolean position under this policy via the macro.
impl TruthyIn<NonBlank> for String {
    fn truthy(&self) -> bool {
        !self.trim().is_empty()
    }
}

/// Whether `s` is truthy under the [`NonBlank`] host policy (`"   "` is falsy, unlike the
/// built-in policies where any non-empty string is truthy).
#[must_use]
pub fn non_blank(s: &str) -> bool {
    truthy_in::<NonBlank, _>(&s)
}

/// A one-field context, to show the host policy governing a real template condition.
pub struct Note {
    /// The note body — blank (empty *or* whitespace-only) takes the `{{else}}` arm under
    /// [`NonBlank`], where any non-empty string would be truthy under the built-ins.
    pub body: String,
}

// The host policy selected through the macro by its type path — the capability the AOT
// `truthiness` clause gained: not just the three built-in idents, but any `TruthyIn<Mode>`
// a host defines. A lone unknown ident still gets the located "expected NonEmpty, …" hint.
truss!(
    note_nonblank,
    Note,
    "{{#if body}}content{{else}}blank{{/if}}",
    truthiness = self::NonBlank
);
