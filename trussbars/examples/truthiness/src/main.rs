//! Print the truthiness-policy demos to stdout. `cargo run` from
//! `trussbars/examples/truthiness/`.

use trussbars_interp::TruthMode;
use truthiness_example::{
    Cart, Note, cart_default, cart_liquid, count_handlebars, count_liquid, empty_cart, non_blank,
    note_nonblank, vm_render,
};

fn main() {
    let empty = Cart {
        items: vec![],
        count: 0,
    };

    println!("== AOT: an empty list, same template, two policies ==");
    println!("  NonEmpty (default): {}", cart_default(&empty)); // empty
    println!("  Liquid:             {}", cart_liquid(&empty)); // filled  ([] is truthy)

    println!("\n== AOT: a bare-number condition (does not compile under NonEmpty) ==");
    println!("  Handlebars: {}", count_handlebars(&empty)); // none  (0 is falsy)
    println!("  Liquid:     {}", count_liquid(&empty)); // some  (0 is truthy)

    println!("\n== VM: the same policy choice, at runtime, over dynamic data ==");
    let src = "{% if items %}filled{% else %}empty{% endif %}";
    let data = empty_cart();
    println!("  NonEmpty: {}", vm_render(src, &data, TruthMode::NonEmpty));
    println!("  Liquid:   {}", vm_render(src, &data, TruthMode::Liquid));

    println!("\n== Library: a host-defined policy over a foreign type (str) ==");
    println!("  non_blank(\"hi\")  = {}", non_blank("hi")); // true
    println!("  non_blank(\"   \") = {}", non_blank("   ")); // false (whitespace-only)

    println!("\n== AOT: that same host policy, selected in the macro by its path ==");
    println!(
        "  truthiness = self::NonBlank, body=\"hi\"  -> {}",
        note_nonblank(&Note { body: "hi".into() })
    ); // content
    println!(
        "  truthiness = self::NonBlank, body=\"   \" -> {}",
        note_nonblank(&Note { body: "   ".into() })
    ); // blank (whitespace-only is falsy)
}
