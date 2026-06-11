//! Perf-regression gate (the ratchet). Asserts the machine-INDEPENDENT relative
//! invariants — measured in the same run, so a slow CI box doesn't matter — for
//! BOTH canonical workloads (big-table, teams):
//!
//!   * Trussbars (AOT) ≤ Askama        — we beat the safe typed peer;
//!   * Trussbars (AOT) × 5 ≤ handlebars — we stay far below the dynamic interpreter;
//!   * AOT ≤ VM ≤ interpreter ≤ handlebars — the three Trussbars backends stay ordered
//!     (compiled fastest, then bytecode VM, then the tree-walk interpreter), and even
//!     the slowest of them clears handlebars;
//!   * **VM × 2 ≤ interpreter** — the bytecode VM's reason to exist: at least 2× the
//!     tree-walk it optimizes against (docs/11 §4).
//!
//! Observed margins are comfortable, so the thresholds won't flake. We deliberately do
//! NOT gate against Sailfish (faster — it embeds raw Rust, the boundary we won't cross)
//! nor the naive `write!` baseline (the codegen engines beat it, but `core::fmt`
//! timing is too variable to ratchet on).
//!
//! Meaningful only optimized, so it self-skips in debug. CI runs it with
//! `--release`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, big_table_value, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, interp_big_table,
    interp_big_table_template, interp_teams, interp_teams_template, teams_data, teams_value,
    trussbars_big_table, trussbars_teams, vm_big_table, vm_big_table_program, vm_teams,
    vm_teams_program, vy_big_table, vy_teams,
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

#[allow(clippy::too_many_arguments)]
fn assert_invariants(
    name: &str,
    tb: Duration,
    vm: Duration,
    interp: Duration,
    vy: Duration,
    ak: Duration,
    hb: Duration,
) {
    eprintln!(
        "{name}: trussbars(AOT)={tb:?}  vm-bytecode={vm:?}  interpreter={interp:?}  vy={vy:?}  askama={ak:?}  handlebars={hb:?}  (VM is {:.1}× the interpreter)",
        interp.as_secs_f64() / vm.as_secs_f64()
    );
    assert!(
        tb <= ak,
        "[{name}] perf regression: trussbars {tb:?} should be <= askama {ak:?}"
    );
    assert!(
        tb * 5 <= hb,
        "[{name}] perf regression: trussbars {tb:?} ×5 should be <= handlebars {hb:?}"
    );
    // The three Trussbars backends stay ordered: AOT (compiled) ≤ the bytecode VM ≤ the
    // tree-walk interpreter, and the slowest of them still clears handlebars.
    assert!(
        tb <= vm,
        "[{name}] perf regression: trussbars AOT {tb:?} should be <= the VM {vm:?}"
    );
    assert!(
        vm <= interp,
        "[{name}] perf regression: the bytecode VM {vm:?} should be <= the interpreter {interp:?}"
    );
    assert!(
        interp <= hb,
        "[{name}] perf regression: the interpreter {interp:?} should be <= handlebars {hb:?}"
    );
    // The headline: the bytecode VM must be at least 2× the tree-walk interpreter — its
    // whole reason to exist (docs/11 §4). The observed margin is wider, so 2× won't flake.
    assert!(
        vm * 2 <= interp,
        "[{name}] perf regression: the bytecode VM {vm:?} ×2 should be <= the interpreter {interp:?} (the ≥2× goal)"
    );
}

#[test]
fn trussbars_backends_ordered_and_vm_doubles_interpreter() {
    if cfg!(debug_assertions) {
        eprintln!("perf gate skipped in debug; run `cargo test --release`");
        return;
    }

    // big-table — each render is ~50 µs, so a smaller sample count suffices.
    {
        let ctx = big_table_data();
        let hb = handlebars_big_table_registry();
        let interp_tmpl = interp_big_table_template();
        let vm_data = big_table_value(&ctx);
        let n = 200;
        let vm_prog = vm_big_table_program();
        let tb = min_time(n, || trussbars_big_table(&ctx));
        let vm = min_time(n, || vm_big_table(&vm_prog, &vm_data));
        let interp = min_time(n, || interp_big_table(&interp_tmpl, &vm_data));
        let vy = min_time(n, || vy_big_table(&ctx));
        let ak = min_time(n, || askama_big_table(&ctx));
        let hbt = min_time(n, || handlebars_big_table(&hb, &ctx));
        assert_invariants("big-table", tb, vm, interp, vy, ak, hbt);
    }

    // teams — each render is ~100 ns, so use many samples.
    {
        let ctx = teams_data();
        let hb = handlebars_teams_registry();
        let interp_tmpl = interp_teams_template();
        let vm_data = teams_value(&ctx);
        let n = 5000;
        let vm_prog = vm_teams_program();
        let tb = min_time(n, || trussbars_teams(&ctx));
        let vm = min_time(n, || vm_teams(&vm_prog, &vm_data));
        let interp = min_time(n, || interp_teams(&interp_tmpl, &vm_data));
        let vy = min_time(n, || vy_teams(&ctx));
        let ak = min_time(n, || askama_teams(&ctx));
        let hbt = min_time(n, || handlebars_teams(&hb, &ctx));
        assert_invariants("teams", tb, vm, interp, vy, ak, hbt);
    }
}
