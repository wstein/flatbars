//! The `derive` feature re-exports `#[derive(Trussbars)]`, so a host can depend
//! on `trussbars-core` alone. Gated on the feature; runs under
//! `cargo test --features derive` (or `--all-features`).
#![cfg(feature = "derive")]
#![allow(dead_code)]

use trussbars_core::{Trussbars, truthy};

#[derive(Trussbars)]
struct Ctx {
    name: String,
}

#[test]
fn reexported_derive_generates_truthy() {
    // Reached only through the re-export path `trussbars_core::Trussbars`.
    assert!(truthy(&Ctx {
        name: String::new()
    }));
}
