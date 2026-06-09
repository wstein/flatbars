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
