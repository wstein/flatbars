//! The docs/07 §4.4 diagnostic gate: a `trybuild` compile-fail suite pinning the
//! exact located `compile_error!` text for class-A (Trussbars-owned) failures, so
//! the DX is a tested contract, not a hope. Once external crates depend on
//! Trussbars these messages and spans are public API; this corpus is their
//! regression net. Regenerate the `.stderr` golden after a deliberate message
//! change with `TRYBUILD=overwrite cargo test -p trussbars-macros`.
//!
//! Coverage (`tests/ui/*.rs`):
//!   * parse-class — `unclosed_block`, `mismatched_block` (a close tag naming the
//!     wrong block);
//!   * resolution-class — `unknown_helper`, `unknown_partial`,
//!     `yield_outside_partial`;
//!   * arity-class — `arity_wrong` (a fixed-arity stdlib op, wrong arg count);
//!   * dict-literal-class — `dict_literal_iterated` (a `{k: v}` literal cannot be
//!     iterated);
//!   * loop-metadata-class — `loop_outside_each` (`loop` outside an `{% each %}`),
//!     `loop_unknown_field` (an unknown field on the loop frame);
//!   * policy-class — `unknown_truthiness` (an unknown `truss!(…, truthiness = …)`
//!     mode; §7.1);
//!   * **injection-class (§4)** — the security boundary, all three constructs:
//!     `computed_partial` (§4.1), `apply_meta_helper` (§4.2), and
//!     `computed_lookup` (§4.3). Each is rejected with a located, owned message,
//!     so "data cannot become a name" is a *tested* contract, not just prose.

#[test]
fn class_a_diagnostics_are_located() {
    trybuild::TestCases::new().compile_fail("tests/ui/*.rs");
}
