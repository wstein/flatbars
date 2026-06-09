//! Render the cart in two languages, switching the active Fluent language at runtime.
use i18n_fluent_example::templates::render_cart;
use i18n_fluent_example::{cart_title, sample, set_language};

fn main() {
    let cart = sample();
    for lang in ["en", "de", "pl"] {
        set_language(lang);
        println!("[{lang}] {}", render_cart(&cart));
    }
    // `fl!` (compile-time-checked) reads a host-side message in the active language.
    set_language("pl");
    println!("fl! title = {}", cart_title());
}
