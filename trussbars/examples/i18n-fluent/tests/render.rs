//! The Fluent-backed `t` host helper renders the same template in two languages.
use i18n_fluent_example::templates::render_cart;
use i18n_fluent_example::{sample, set_language};

#[test]
fn renders_in_both_languages() {
    let cart = sample();
    set_language("en");
    assert_eq!(render_cart(&cart), "Your cart: 3");
    set_language("de");
    assert_eq!(render_cart(&cart), "Dein Warenkorb: 3");
    set_language("pl");
    assert_eq!(render_cart(&cart), "Twój koszyk: 3");
}
