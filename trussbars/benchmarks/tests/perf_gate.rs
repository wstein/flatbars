//! Perf-regression gate (the ratchet). Asserts the machine-INDEPENDENT relative
//! invariants — measured in the same run, so a slow CI box doesn't matter:
//!
//!   * Trussbars ≤ Askama   — we beat the safe typed peer;
//!   * Trussbars × 5 ≤ handlebars — we stay far below the dynamic interpreter
//!     (the real ratio is ~20–30×; ×5 is a deliberately safe, non-flaky margin).
//!
//! Meaningful only optimized, so it self-skips in debug. CI runs it with
//! `--release`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use trussbars_benchmarks::{
    askama_render, handlebars_registry, handlebars_render, sample, trussbars_render,
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

#[test]
fn trussbars_beats_askama_and_crushes_handlebars() {
    if cfg!(debug_assertions) {
        eprintln!("perf gate skipped in debug; run `cargo test --release`");
        return;
    }
    let ctx = sample();
    let hb = handlebars_registry();
    let n = 5000;

    let tb = min_time(n, || trussbars_render(&ctx));
    let ak = min_time(n, || askama_render(&ctx));
    let hbt = min_time(n, || handlebars_render(&hb, &ctx));
    eprintln!("trussbars={tb:?}  askama={ak:?}  handlebars={hbt:?}");

    assert!(
        tb <= ak,
        "perf regression: trussbars {tb:?} should be <= askama {ak:?}"
    );
    assert!(
        tb * 5 <= hbt,
        "perf regression: trussbars {tb:?} ×5 should be <= handlebars {hbt:?}"
    );
}
