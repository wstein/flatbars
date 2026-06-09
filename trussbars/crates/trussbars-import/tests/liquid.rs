//! Integration coverage for the Liquid dialect through the public dispatch API.

use trussbars_import::liquid::Node;
use trussbars_import::{Ast, Dialect, parse};

const SAMPLE: &str = include_str!("fixtures/sample.liquid");

fn nodes(ast: Ast) -> Vec<Node> {
    match ast {
        Ast::Liquid(n) => n,
        other => panic!("expected Liquid, got {other:?}"),
    }
}

#[test]
fn dispatch_by_extension() {
    assert_eq!(Dialect::from_extension(".liquid"), Some(Dialect::Liquid));
}

#[test]
fn fixture_parses_to_expected_shape() {
    let ast = parse(Dialect::Liquid, SAMPLE).expect("fixture parses");
    let n = nodes(ast);
    assert!(n.iter().any(|x| matches!(x, Node::Output { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::Assign { .. })));
    assert!(n.iter().any(|x| matches!(
        x,
        Node::For {
            otherwise: Some(_),
            ..
        }
    )));
    assert!(n.iter().any(|x| matches!(x, Node::Case { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::If { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::Render { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::Raw { .. })));
}

#[test]
fn unknown_tag_is_preserved_not_an_error() {
    let ast = parse(Dialect::Liquid, "{% paginate x by 5 %}{{ x }}").unwrap();
    let n = nodes(ast);
    assert!(matches!(&n[0], Node::Unknown { name, .. } if name == "paginate"));
}
