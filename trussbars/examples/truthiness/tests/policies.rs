//! The example is a tested contract: each policy's divergence is asserted, so the demo
//! cannot silently rot.

use trussbars_interp::TruthMode;
use truthiness_example::{
    Cart, Note, cart_default, cart_liquid, count_handlebars, count_liquid, empty_cart, non_blank,
    note_nonblank, vm_render,
};

fn empty() -> Cart {
    Cart {
        items: vec![],
        count: 0,
    }
}

#[test]
fn aot_empty_list_diverges_by_policy() {
    // [] is falsy under NonEmpty, truthy under Liquid — same template.
    assert_eq!(cart_default(&empty()), "empty");
    assert_eq!(cart_liquid(&empty()), "filled");
    // A non-empty list is truthy under both.
    let full = Cart {
        items: vec!["x".into()],
        count: 0,
    };
    assert_eq!(cart_default(&full), "filled");
    assert_eq!(cart_liquid(&full), "filled");
}

#[test]
fn aot_numeric_truthiness_only_exists_under_a_policy() {
    // 0 is falsy under Handlebars, truthy under Liquid. (There is no NonEmpty variant —
    // `{% if count %}` does not compile under NonEmpty, §5.3.)
    assert_eq!(count_handlebars(&empty()), "none");
    assert_eq!(count_liquid(&empty()), "some");
    let one = Cart {
        items: vec![],
        count: 1,
    };
    assert_eq!(count_handlebars(&one), "some");
    assert_eq!(count_liquid(&one), "some");
}

#[test]
fn vm_selects_policy_at_runtime() {
    let src = "{% if items %}filled{% else %}empty{% endif %}";
    let data = empty_cart();
    assert_eq!(vm_render(src, &data, TruthMode::NonEmpty), "empty");
    assert_eq!(vm_render(src, &data, TruthMode::Liquid), "filled");
}

#[test]
fn host_defined_policy_over_a_foreign_type() {
    // The built-ins treat any non-empty string as truthy; NonBlank trims first.
    assert!(non_blank("hi"));
    assert!(!non_blank("   "));
    assert!(!non_blank(""));
}

#[test]
fn host_defined_policy_selected_through_the_macro() {
    // The same policy, chosen by its path in the `truss!` clause (not just a built-in ident).
    assert_eq!(note_nonblank(&Note { body: "hi".into() }), "content");
    assert_eq!(note_nonblank(&Note { body: "   ".into() }), "blank");
    assert_eq!(
        note_nonblank(&Note {
            body: String::new()
        }),
        "blank"
    );
}
