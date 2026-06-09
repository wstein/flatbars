//! Integration coverage for the StringTemplate4 dialects (template + group) through
//! the public dispatch API.

use trussbars_import::stringtemplate::{DictValue, Element, Group};
use trussbars_import::{Ast, Dialect, parse};

const SAMPLE_ST: &str = include_str!("fixtures/sample.st");
const SAMPLE_STG: &str = include_str!("fixtures/sample.stg");

fn elements(ast: Ast) -> Vec<Element> {
    match ast {
        Ast::StringTemplate(e) => e,
        other => panic!("expected StringTemplate, got {other:?}"),
    }
}

fn group(ast: Ast) -> Group {
    match ast {
        Ast::StringTemplateGroup(g) => g,
        other => panic!("expected StringTemplateGroup, got {other:?}"),
    }
}

#[test]
fn dispatch_by_extension() {
    assert_eq!(
        Dialect::from_extension("st"),
        Some(Dialect::StringTemplateText)
    );
    assert_eq!(
        Dialect::from_extension("stg"),
        Some(Dialect::StringTemplateGroup)
    );
}

#[test]
fn template_fixture_parses() {
    let e = elements(parse(Dialect::StringTemplateText, SAMPLE_ST).expect("st parses"));
    assert!(e.iter().any(|x| matches!(x, Element::Comment { .. })));
    assert!(
        e.iter()
            .any(|x| matches!(x, Element::If { elseifs, otherwise, .. } if elseifs.len() == 1 && otherwise.is_some()))
    );
    assert!(
        e.iter()
            .any(|x| matches!(x, Element::Region { name, .. } if name == "footer"))
    );
}

#[test]
fn group_fixture_parses() {
    let g = group(parse(Dialect::StringTemplateGroup, SAMPLE_STG).expect("stg parses"));
    assert_eq!(g.delimiters, Some(("<".into(), ">".into())));
    assert_eq!(g.imports, vec!["common.stg".to_string()]);
    assert_eq!(g.name.as_deref(), Some("Page"));
    assert!(g.templates.iter().any(|t| t.name == "page"));
    assert!(g.templates.iter().any(|t| t.name == "row"));
    assert!(g.templates.iter().any(|t| t.name == "@page.header"));
    let dict = g
        .dicts
        .iter()
        .find(|d| d.name == "typeNames")
        .expect("dict");
    assert!(matches!(&dict.default, Some(DictValue::Str(s)) if s == "Object"));
}
