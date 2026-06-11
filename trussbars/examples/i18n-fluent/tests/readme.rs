//! Doc-drift guard: the README inlines `templates/cart.truss` in its layout table. Pin
//! that snippet to the real file so the prose can't rot back to a retired syntax (the
//! `.truss` itself is already parse/render-gated by `tests/render.rs`).

#[test]
fn readme_inlines_the_real_cart_template() {
    let template = include_str!("../templates/cart.truss");
    let readme = include_str!("../README.md");
    assert!(
        readme.contains(template.trim()),
        "README.md no longer shows templates/cart.truss verbatim — update the doc snippet \
         to match the file:\n{template}"
    );
}
