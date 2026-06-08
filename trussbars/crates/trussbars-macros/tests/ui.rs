//! The docs/07 §4.4 diagnostic gate: a `trybuild` compile-fail suite pinning the
//! exact located `compile_error!` text for class-A (Trussbars-owned) failures, so
//! the DX is a tested contract, not a hope. Regenerate the `.stderr` golden after a
//! deliberate message change with `TRYBUILD=overwrite cargo test -p trussbars-macros`.

#[test]
fn class_a_diagnostics_are_located() {
    trybuild::TestCases::new().compile_fail("tests/ui/*.rs");
}
