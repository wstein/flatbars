//! `truss!` end-to-end: the macro must produce a render function that compiles and
//! runs (parse → desugar → emit → real Rust), over host types deriving the runtime
//! traits. This is the "happy path" companion to the `trybuild` diagnostic gate.

use trussbars_macros::truss;

#[derive(trussbars_core::Trussbars)]
struct Greeting {
    name: String,
    shout: bool,
}

truss!(greeting, Greeting, "Hello {{name}}{{#if shout}}!{{/if}}");

#[derive(trussbars_core::Trussbars)]
struct Cart {
    items: Vec<String>,
}

truss!(
    cart,
    Cart,
    "{{#each items}}- {{this}}\n{{else}}empty\n{{/each}}"
);

// F3: a declared host helper (`helpers = [..]`) compiles to a call to a host Rust
// fn of that name. Both the call form `{{exclaim name}}` and the pipe form
// `{{name | exclaim}}` desugar to the same `exclaim(&name)` host call.
fn exclaim(s: &str) -> String {
    format!("{s}!")
}
truss!(call_form, Greeting, "{{exclaim name}}", helpers = [exclaim]);
truss!(
    pipe_form,
    Greeting,
    "{{name | exclaim}}",
    helpers = [exclaim]
);

// A two-arg host helper with a string-literal argument — proves the uniform
// `&(expr)` arg convention (the literal's `&&str` deref-coerces to the host's `&str`).
fn wrap(s: &str, brace: &str) -> String {
    format!("{brace}{s}{brace}")
}
truss!(wrapped, Greeting, "{{wrap name \"*\"}}", helpers = [wrap]);

#[test]
fn declared_host_helper_is_called() {
    let g = Greeting {
        name: "hi".into(),
        shout: false,
    };
    assert_eq!(call_form(&g), "hi!");
    assert_eq!(pipe_form(&g), "hi!");
    assert_eq!(wrapped(&g), "*hi*");
}

// The `#[truss_helpers(..)]` attribute declares the allow-list once for a whole
// module of templates instead of repeating `helpers = [..]` on every call.
#[trussbars_macros::truss_helpers(exclaim)]
mod via_attr {
    use super::{Greeting, exclaim};
    use trussbars_macros::truss;
    truss!(attr_form, Greeting, "{{exclaim name}}");
}

#[test]
fn attribute_declares_the_allow_list() {
    let g = Greeting {
        name: "hi".into(),
        shout: false,
    };
    assert_eq!(via_attr::attr_form(&g), "hi!");
}

// The `path = …` form: read the template from a file (relative to the crate root)
// at macro-expansion time — same source as `cart`, so it must render identically.
truss!(cart_from_file, Cart, path = "tests/templates/cart.truss");

#[test]
fn renders_a_conditional() {
    let g = Greeting {
        name: "World".into(),
        shout: true,
    };
    assert_eq!(greeting(&g), "Hello World!");
    let q = Greeting {
        name: "World".into(),
        shout: false,
    };
    assert_eq!(greeting(&q), "Hello World");
}

#[test]
fn renders_an_each_with_else() {
    let full = Cart {
        items: vec!["a".into(), "b".into()],
    };
    assert_eq!(cart(&full), "- a\n- b\n");
    let empty = Cart { items: vec![] };
    assert_eq!(cart(&empty), "empty\n");
}

#[test]
fn path_form_matches_inline() {
    let full = Cart {
        items: vec!["a".into(), "b".into()],
    };
    assert_eq!(cart_from_file(&full), cart(&full));
    let empty = Cart { items: vec![] };
    assert_eq!(cart_from_file(&empty), cart(&empty));
}

#[test]
fn escapes_html_in_output() {
    let g = Greeting {
        name: "<b>".into(),
        shout: false,
    };
    assert_eq!(greeting(&g), "Hello &lt;b&gt;");
}

// `truthiness = Mode` selects a non-default policy (spec §7). Under Liquid an empty
// list is **truthy** (only `false`/`nil` are falsy), so `{{#if tags}}` fires where the
// default `nonEmpty` rule treats `[]` as falsy. The same source without the clause
// takes the default — a per-template, type-directed, loud choice.
#[derive(trussbars_core::Trussbars)]
struct Card {
    tags: Vec<String>,
}
truss!(
    card_liquid,
    Card,
    "{{#if tags}}has{{else}}none{{/if}}",
    truthiness = Liquid
);
truss!(card_default, Card, "{{#if tags}}has{{else}}none{{/if}}");

#[test]
fn truthiness_mode_governs_the_condition() {
    let empty = Card { tags: vec![] };
    // Liquid: [] is truthy → the positive arm.
    assert_eq!(card_liquid(&empty), "has");
    // NonEmpty (default): [] is falsy → the else arm. The divergence is opt-in.
    assert_eq!(card_default(&empty), "none");
    // A non-empty list is truthy under both.
    let full = Card {
        tags: vec!["x".into()],
    };
    assert_eq!(card_liquid(&full), "has");
    assert_eq!(card_default(&full), "has");
}

// F3 block helpers (docs/09): `{{#name args}}body{{/name}}` compiles to
// `name(args…, || -> String { <body> })`. The body closure renders the inner template in
// the enclosing scope; the helper drives it — once (wrap), or N times (repeat).
fn frame(body: impl Fn() -> String) -> trussbars_core::Safe {
    // Returns Safe → the `[…]` markup is emitted raw (a String return would be escaped).
    trussbars_core::Safe(format!("[{}]", body()))
}
fn repeat(n: &f64, body: impl Fn() -> String) -> String {
    (0..*n as usize).map(|_| body()).collect()
}
truss!(
    framed,
    Greeting,
    "{{#frame}}hi {{name}}{{/frame}}",
    helpers = [frame]
);
truss!(
    repeated,
    Greeting,
    "{{#repeat 3}}{{name}}{{/repeat}}",
    helpers = [repeat]
);

#[test]
fn block_host_helpers_drive_the_body() {
    let g = Greeting {
        name: "Ada".into(),
        shout: false,
    };
    // `frame` calls the body once and wraps it; the body renders in scope ({{name}}→Ada),
    // and the Safe return opts the markup out of escaping.
    assert_eq!(framed(&g), "[hi Ada]");
    // `repeat` drives the body closure 3× — the power a pre-rendered body wouldn't have.
    assert_eq!(repeated(&g), "AdaAdaAda");
}
