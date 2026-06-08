//! Perf-regression gate (the ratchet). Asserts the machine-INDEPENDENT relative
//! invariants — measured in the same run, so a slow CI box doesn't matter — for
//! BOTH canonical workloads (big-table, teams):
//!
//!   * Trussbars ≤ Askama        — we beat the safe typed peer;
//!   * Trussbars × 5 ≤ handlebars — we stay far below the dynamic interpreter.
//!
//! Observed margins are comfortable (Trussbars is ~2.5–2.8× Askama and ~8–55×
//! handlebars), so the thresholds won't flake. We deliberately do NOT gate
//! against Sailfish (faster — it embeds raw Rust, the boundary we won't cross)
//! nor the naive `write!` baseline (the codegen engines beat it, but `core::fmt`
//! timing is too variable to ratchet on).
//!
//! Meaningful only optimized, so it self-skips in debug. CI runs it with
//! `--release`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, big_table_value, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, teams_data,
    teams_value, trussbars_big_table, trussbars_teams, vm_big_table, vm_big_table_template,
    vm_teams, vm_teams_template,
};

/// The minimum render time over `n` runs (the min is the most noise-stable metric).
fn min_time(n: u32, f: impl Fn() -> String) -> Duration {
    for _ in 0..200 {
        black_box(f());
    }
    let mut best = Duration::MAX;
    for _ in 0..n {
        let t = Instant::now();
        black_box(f());
        best = best.min(t.elapsed());
    }
    best
}

fn assert_invariants(name: &str, tb: Duration, vm: Duration, ak: Duration, hb: Duration) {
    eprintln!("{name}: trussbars(AOT)={tb:?}  trussbars-vm={vm:?}  askama={ak:?}  handlebars={hb:?}");
    assert!(
        tb <= ak,
        "[{name}] perf regression: trussbars {tb:?} should be <= askama {ak:?}"
    );
    assert!(
        tb * 5 <= hb,
        "[{name}] perf regression: trussbars {tb:?} ×5 should be <= handlebars {hb:?}"
    );
    // The AOT backend must stay faster than the dynamic VM (compiled beats tree-walk);
    // and the lean VM must stay at or below the heavier handlebars interpreter.
    assert!(
        tb <= vm,
        "[{name}] perf regression: trussbars AOT {tb:?} should be <= the VM {vm:?}"
    );
    assert!(
        vm <= hb,
        "[{name}] perf regression: trussbars-vm {vm:?} should be <= handlebars {hb:?}"
    );
}

#[test]
fn trussbars_beats_askama_and_crushes_handlebars() {
    if cfg!(debug_assertions) {
        eprintln!("perf gate skipped in debug; run `cargo test --release`");
        return;
    }

    // big-table — each render is ~50 µs, so a smaller sample count suffices.
    {
        let ctx = big_table_data();
        let hb = handlebars_big_table_registry();
        let vm_tmpl = vm_big_table_template();
        let vm_data = big_table_value(&ctx);
        let n = 200;
        let tb = min_time(n, || trussbars_big_table(&ctx));
        let vm = min_time(n, || vm_big_table(&vm_tmpl, &vm_data));
        let ak = min_time(n, || askama_big_table(&ctx));
        let hbt = min_time(n, || handlebars_big_table(&hb, &ctx));
        assert_invariants("big-table", tb, vm, ak, hbt);
    }

    // teams — each render is ~100 ns, so use many samples.
    {
        let ctx = teams_data();
        let hb = handlebars_teams_registry();
        let vm_tmpl = vm_teams_template();
        let vm_data = teams_value(&ctx);
        let n = 5000;
        let tb = min_time(n, || trussbars_teams(&ctx));
        let vm = min_time(n, || vm_teams(&vm_tmpl, &vm_data));
        let ak = min_time(n, || askama_teams(&ctx));
        let hbt = min_time(n, || handlebars_teams(&hb, &ctx));
        assert_invariants("teams", tb, vm, ak, hbt);
    }
}
