//! Golden snapshots of the render core across the full {sample × locale × mode} matrix
//! — the headless gate over the VM Lab (the interactive `main.rs` is just I/O).
//!
//! Regenerate after an intentional change with:
//!   cargo run --bin lab -- --bless tests/golden

use std::fs;

use trussbars_lab::{Lab, Locale, Mode, samples::Sample};

#[test]
fn golden_matrix() {
    let mut missing = Vec::new();
    for sample in Sample::ALL {
        for locale in Locale::ALL {
            for mode in Mode::ALL {
                let lab = Lab {
                    sample,
                    locale,
                    mode,
                };
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
