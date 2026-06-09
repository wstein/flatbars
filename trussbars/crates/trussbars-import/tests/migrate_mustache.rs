//! Integration coverage for the Mustache → idiomatic `.truss` migration, driving the
//! public `metrics` / `migrate` API over the representative fixture.

use trussbars_import::lower::{LowerOptions, NoShapes, Severity, Shape, ShapeOracle};
use trussbars_import::{metrics, migrate, mustache};

const SAMPLE: &str = include_str!("fixtures/sample.mustache");

#[test]
fn metrics_find_the_complementary_pair() {
    let nodes = mustache::parse(SAMPLE).unwrap();
    let m = metrics::mustache(&nodes);
    assert_eq!(m.complementary_pairs, 1);
    assert_eq!(m.set_delimiters, 1);
    assert_eq!(m.residuals(), 0);
}

#[test]
fn migrate_collapses_and_annotates() {
    let m = migrate::mustache(SAMPLE, &NoShapes, &LowerOptions::default()).unwrap();
    // The complementary {{#items}}/{{^items}} collapses to a single if/else.
    assert!(m.truss.contains("{{#if items}}"), "{}", m.truss);
    assert!(m.truss.contains("{{else}}"), "{}", m.truss);
    // The comment is preserved, the post-set-delimiter variable survives.
    assert!(m.truss.contains("{{! a small"), "{}", m.truss);
    assert!(m.truss.contains("{{greeting}}"), "{}", m.truss);
    // Notes: a truthiness caveat, a "could be a list" hint, and the dropped set-delim.
    assert!(m.report.iter().any(|n| n.message.contains("truthiness")));
    assert!(m.report.iter().any(|n| n.message.contains("is a list")));
    assert!(
        m.report
            .iter()
            .any(|n| n.severity == Severity::Info && n.message.contains("set-delimiter"))
    );
}

/// A data sample that knows `items` is a list resolves the pair to each-with-else.
struct ItemsList;
impl ShapeOracle for ItemsList {
    fn shape_at(&self, path: &[String]) -> Shape {
        if path == ["items"] {
            Shape::Array
        } else {
            Shape::Unknown
        }
    }
}

#[test]
fn data_sample_resolves_list_to_each() {
    let m = migrate::mustache(SAMPLE, &ItemsList, &LowerOptions::default()).unwrap();
    assert!(m.truss.contains("{{#each items}}"), "{}", m.truss);
    assert!(m.truss.contains("{{else}}"), "{}", m.truss);
    // With a known shape, the "could be a list" hint is gone.
    assert!(!m.report.iter().any(|n| n.message.contains("is a list")));
}

#[test]
fn report_json_is_wellformed() {
    let m = migrate::mustache(SAMPLE, &NoShapes, &LowerOptions::default()).unwrap();
    let json = migrate::report_json(&m.report, SAMPLE);
    assert!(json.starts_with('['));
    assert!(json.contains("\"severity\":"));
    assert!(json.contains("\"line\":"));
}
