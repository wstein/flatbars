//! End-to-end migration coverage for the Handlebars / Liquid / StringTemplate4
//! dialects through the public `migrate` API over the representative fixtures.

use trussbars_import::lower::{LowerOptions, NoShapes};
use trussbars_import::migrate;

#[test]
fn handlebars_fixture_migrates() {
    let src = include_str!("fixtures/sample.hbs");
    let m = migrate::handlebars(src, &NoShapes, &LowerOptions::default()).unwrap();
    assert!(
        m.truss.contains("{{#each item index in items}}"),
        "{}",
        m.truss
    );
    assert!(m.truss.contains("{{#if user.admin}}"), "{}", m.truss);
    assert!(m.truss.contains("{{else if user.editor}}"), "{}", m.truss);
    assert!(m.truss.contains("{{> nav}}"), "{}", m.truss);
    // The truthiness delta is flagged.
    assert!(m.report.iter().any(|n| n.message.contains("truthiness")));
}

#[test]
fn liquid_fixture_migrates() {
    let src = include_str!("fixtures/sample.liquid");
    let m = migrate::liquid(src, &NoShapes, &LowerOptions::default()).unwrap();
    assert!(
        m.truss.contains("{{#each product in featured}}"),
        "{}",
        m.truss
    );
    assert!(m.truss.contains("{{#case product.kind}}"), "{}", m.truss);
    assert!(m.truss.contains("{{#if "), "{}", m.truss);
    // `assign` is a residual with an actionable note.
    assert!(
        m.report
            .iter()
            .any(|n| n.message.contains("assign featured"))
    );
}

#[test]
fn stringtemplate_fixture_migrates() {
    let src = include_str!("fixtures/sample.st");
    let m = migrate::stringtemplate(src, &NoShapes, &LowerOptions::default()).unwrap();
    assert!(m.truss.contains("{{{page.title}}}"), "{}", m.truss); // raw (ST4 not auto-escaped)
    assert!(m.truss.contains("{{#if items}}"), "{}", m.truss);
    assert!(m.truss.contains("{{else if loading}}"), "{}", m.truss);
}

#[test]
fn stringtemplate_group_fixture_migrates() {
    let src = include_str!("fixtures/sample.stg");
    let m = migrate::stringtemplate_group(src, &NoShapes, &LowerOptions::default()).unwrap();
    assert!(m.truss.contains("{{#inline \"page\"}}"), "{}", m.truss);
    assert!(m.truss.contains("{{#inline \"row\"}}"), "{}", m.truss);
    // The `row(item, …)` parameters are flagged for a context declaration.
    assert!(m.report.iter().any(|n| n.message.contains("parameters")));
}
