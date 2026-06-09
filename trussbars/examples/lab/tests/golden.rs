//! Golden snapshots of the render core across the full {sample × locale × mode} matrix
//! — the headless gate over the VM Lab (the interactive `main.rs` is just I/O).
//!
//! Regenerate after an intentional change with:
//!   cargo run --bin lab -- --bless tests/golden

use std::fs;

use trussbars_lab::{Lab, Locale, Mode, editor::TextBuffer, samples::Sample};

fn seeded(sample: Sample, locale: Locale, mode: Mode) -> Lab {
    let mut lab = Lab::from_sample(sample);
    lab.locale = locale;
    lab.mode = mode;
    lab
}

fn receipt_data(count: u32) -> String {
    format!(
        "customer: Ada\ncount: {count}\ntotal: 899\nplaced: \"2026-06-09\"\neta: 3\n\
         items:\n  - name: Keyboard\n    price: 899\n"
    )
}

#[test]
fn golden_matrix() {
    let mut missing = Vec::new();
    for sample in Sample::ALL {
        for locale in Locale::ALL {
            for mode in Mode::ALL {
                let lab = seeded(sample, locale, mode);
                let path = format!(
                    "tests/golden/{}_{}_{}.txt",
                    sample.key(),
                    locale.code(),
                    mode.key()
                );
                let got = lab.render_or_reject();
                match fs::read_to_string(&path) {
                    Ok(want) => assert_eq!(
                        got, want,
                        "drift in {path} — re-bless with `cargo run --bin lab -- --bless tests/golden`"
                    ),
                    Err(_) => missing.push(path),
                }
            }
        }
    }
    assert!(
        missing.is_empty(),
        "missing golden snapshots {missing:?} — run `cargo run --bin lab -- --bless tests/golden`"
    );
}

#[test]
fn plural_switches_with_count() {
    // CLDR cardinal categories drive the noun: en/de/fr have one/other; Polish has
    // one/few/many — 1 element, 3 elementy, 5 elementów (German Artikel is invariant).
    let cases = [
        (Locale::En, 1, "1 item"),
        (Locale::En, 3, "3 items"),
        (Locale::De, 1, "1 Artikel"),
        (Locale::De, 3, "3 Artikel"),
        (Locale::Fr, 1, "1 article"),
        (Locale::Fr, 3, "3 articles"),
        (Locale::Pl, 1, "1 element"),
        (Locale::Pl, 3, "3 elementy"),
        (Locale::Pl, 5, "5 elementów"),
    ];
    for (locale, count, expected) in cases {
        let mut lab = seeded(Sample::Receipt, locale, Mode::Render);
        lab.data = TextBuffer::from_text(&receipt_data(count));
        let out = lab.render_or_reject();
        assert!(
            out.contains(expected),
            "{locale:?} count={count} expected {expected:?} in:\n{out}"
        );
    }
}

#[test]
fn edited_catalog_changes_output() {
    // The i18n pane is live: overriding the en title flows straight into the render.
    let mut lab = seeded(Sample::Receipt, Locale::En, Mode::Render);
    lab.i18n = TextBuffer::from_text("en:\n  title: INVOICE\n");
    assert!(lab.render_or_reject().contains("== INVOICE =="));
}

#[test]
fn invalid_data_is_reported_not_panicked() {
    let mut lab = seeded(Sample::Greeting, Locale::En, Mode::Render);
    lab.data = TextBuffer::from_text("a: [1, 2\nb: oops");
    assert!(lab.render_or_reject().starts_with("⟂ invalid data YAML:"));
}

#[test]
fn invalid_catalog_is_reported() {
    let mut lab = seeded(Sample::Receipt, Locale::En, Mode::Render);
    lab.i18n = TextBuffer::from_text("en: [not, a, map]");
    assert!(
        lab.render_or_reject()
            .starts_with("⟂ invalid i18n catalog:")
    );
}
