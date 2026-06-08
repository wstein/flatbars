//! The docs/08 §6 step-1 gate: the lexer must round-trip **every** conformance
//! corpus template (its lexemes tile the source). The fixture is generated from
//! `conformance/cases.mjs` by `tests/extract-corpus.mjs` (NUL-separated); regenerate
//! it after editing the corpus.

use trussbars_template::{Lexeme, lex};

const CORPUS: &str = include_str!("fixtures/corpus-templates.txt");

fn round_trips(src: &str) -> bool {
    let Ok(lexemes) = lex(src) else { return false };
    let mut out = String::new();
    for l in &lexemes {
        let span = match l {
            Lexeme::Text(sp) | Lexeme::Tag { span: sp, .. } | Lexeme::RawBlock { span: sp, .. } => {
                sp
            }
        };
        out.push_str(span.of(src));
    }
    out == src
}

#[test]
fn lexer_round_trips_the_whole_corpus() {
    let templates: Vec<&str> = CORPUS.split('\0').collect();
    assert!(
        templates.len() > 50,
        "fixture looks empty — run extract-corpus.mjs"
    );
    let failures: Vec<&str> = templates
        .iter()
        .copied()
        .filter(|t| !round_trips(t))
        .collect();
    assert!(
        failures.is_empty(),
        "{} corpus template(s) did not round-trip through the lexer: {:?}",
        failures.len(),
        failures,
    );
}
