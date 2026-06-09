//! Integration coverage for the Handlebars dialect through the public dispatch API.

use trussbars_import::handlebars::Node;
use trussbars_import::{Ast, Dialect, parse};

const SAMPLE: &str = include_str!("fixtures/sample.hbs");

fn nodes(ast: Ast) -> Vec<Node> {
    match ast {
        Ast::Handlebars(n) => n,
        other => panic!("expected Handlebars, got {other:?}"),
    }
}

#[test]
fn dispatch_by_extension() {
    assert_eq!(Dialect::from_extension("hbs"), Some(Dialect::Handlebars));
    assert_eq!(
        Dialect::from_extension("handlebars"),
        Some(Dialect::Handlebars)
    );
}

#[test]
fn fixture_parses_to_expected_shape() {
    let ast = parse(Dialect::Handlebars, SAMPLE).expect("fixture parses");
    let n = nodes(ast);
    // The `each` block (with block params + else) and the if/else-if chain.
    let each = n
        .iter()
        .find(|x| matches!(x, Node::Block { path, .. } if path.original == "each"))
        .expect("each block");
    let Node::Block {
        block_params,
        inverse,
        ..
    } = each
    else {
        unreachable!()
    };
    assert_eq!(block_params, &["item".to_string(), "index".to_string()]);
    assert!(inverse.is_some());

    // The if/else-if chain nests a block in the inverse.
    assert!(n.iter().any(|x| matches!(
        x,
        Node::Block { path, inverse: Some(_), .. } if path.original == "if"
    )));

    // The partial and the partial block.
    assert!(n.iter().any(|x| matches!(x, Node::Partial { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::PartialBlock { .. })));
    assert!(n.iter().any(|x| matches!(x, Node::Comment { .. })));
}
