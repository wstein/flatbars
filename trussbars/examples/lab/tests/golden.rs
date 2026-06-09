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
    // #2: the seed is count=1 (singular); bumping the data to count=3 must flip the
    // noun per CLDR — en item→items, fr article→articles; de "Artikel" is invariant
    // (correct German), so only the count changes there.
    const COUNT_3: &str = r#"{ "customer": "Ada", "count": 3, "total": 899,
        "placed": "2026-06-09", "eta": 3, "items": [{ "name": "Keyboard", "price": 899 }] }"#;
    let cases = [
        (Locale::En, "1 item", "3 items"),
        (Locale::De, "1 Artikel", "3 Artikel"),
        (Locale::Fr, "1 article", "3 articles"),
    ];
    for (locale, singular, plural) in cases {
        let lab = seeded(Sample::Receipt, locale, Mode::Render);
        let out = lab.render_or_reject();
        assert!(
            out.contains(singular),
            "{locale:?} expected {singular:?} in:\n{out}"
        );

        let mut lab3 = seeded(Sample::Receipt, locale, Mode::Render);
        lab3.data = TextBuffer::from_text(COUNT_3);
        let out3 = lab3.render_or_reject();
        assert!(
            out3.contains(plural),
            "{locale:?} expected {plural:?} in:\n{out3}"
        );
    }
}

#[test]
fn invalid_data_json_is_reported_not_panicked() {
    let mut lab = seeded(Sample::Greeting, Locale::En, Mode::Render);
    lab.data = TextBuffer::from_text("{ not json");
    assert!(lab.render_or_reject().starts_with("⟂ invalid JSON:"));
}
