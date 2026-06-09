//! Integration coverage for the Mustache dialect through the public dispatch API.

use trussbars_import::mustache::{Name, Node};
use trussbars_import::{Ast, Dialect, parse};

const SAMPLE: &str = include_str!("fixtures/sample.mustache");

fn nodes(ast: Ast) -> Vec<Node> {
    match ast {
        Ast::Mustache(n) => n,
        other => panic!("expected Mustache, got {other:?}"),
    }
}

#[test]
fn dispatch_by_extension() {
    assert_eq!(Dialect::from_extension("mustache"), Some(Dialect::Mustache));
    assert_eq!(
        Dialect::from_path(std::path::Path::new("a/b.mustache")),
        Some(Dialect::Mustache)
    );
}

#[test]
fn fixture_parses_to_expected_shape() {
    let ast = parse(Dialect::Mustache, SAMPLE).expect("fixture parses");
    let n = nodes(ast);
    // The comment, the section and inverted section, the partial, and the
    // set-delimiter directive should all be present.
    assert!(n.iter().any(|x| matches!(x, Node::Comment { .. })));
    assert!(n.iter().any(|x| matches!(
        x,
        Node::Section {
            inverted: false,
            ..
        }
    )));
    assert!(
        n.iter()
            .any(|x| matches!(x, Node::Section { inverted: true, .. }))
    );
    assert!(n.iter().any(|x| matches!(x, Node::Partial { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::SetDelimiter { .. })));
    // After the set-delimiter, `<%greeting%>` parses as a variable.
    assert!(
        n.iter().any(
            |x| matches!(x, Node::Variable { name: Name::Dotted(s), .. } if s == &["greeting"])
        )
    );
}

#[test]
fn spans_point_into_source() {
    let ast = parse(Dialect::Mustache, "abc{{x}}").unwrap();
    let n = nodes(ast);
    let Node::Variable { span, .. } = n[1] else {
        panic!("{n:?}")
    };
    assert_eq!(span.of("abc{{x}}"), "{{x}}");
}
