//! `cargo run --release` — render the receipt in every bundled locale.
//!
//! The catalog and the order are *fetched* (from `catalog.yaml` / `data.yaml` via serde),
//! not hard-coded; the declared helpers (`t`/`plural`/`number`/`date`) look messages up in
//! the catalog by key. The same template renders identically through the VM — see the
//! `vm_render_matches_aot` test in the library.

fn main() {
    for locale in ["en", "de", "fr", "pl"] {
        println!("───── {locale} ─────");
        print!("{}", i18n_data::render_receipt(&i18n_data::page(locale)));
        println!();
    }
}
