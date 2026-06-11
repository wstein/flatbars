//! Doc-drift guard: the README's "The template" block mirrors `src/receipt.truss` (minus
//! the leading `{# … #}` comment line). Pin the body to the real file so the prose can't
//! rot back to a retired syntax; the `.truss` itself is parse/render-gated by the library
//! tests.

#[test]
fn readme_shows_the_real_receipt_template_body() {
    let template = include_str!("../src/receipt.truss");
    // Drop the leading comment line; the README excerpt shows only the rendered body.
    let body = template
        .split_once('\n')
        .map_or(template, |(_comment, rest)| rest)
        .trim_end();
    let readme = include_str!("../README.md");
    assert!(
        readme.contains(body),
        "README.md no longer shows the src/receipt.truss body verbatim — update the doc \
         snippet to match the file:\n{body}"
    );
}
