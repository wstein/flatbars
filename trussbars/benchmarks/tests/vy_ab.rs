//! A/B probe (docs/05 method) for the big-table gap vy exposed. vy reaches ~19µs via
//! an exact size pre-pass + an `unsafe` raw-pointer buffer. This isolates how much the
//! SAFE half (exact pre-sizing + plain-slice iteration) buys us, so we can attribute
//! the remaining gap to the `unsafe` buffer (the boundary Trussbars won't cross).
//!
//! Informational, release-only (self-skips in debug). `cargo test --release --test vy_ab`.

use std::hint::black_box;
use std::time::{Duration, Instant};

use trussbars_benchmarks::{
    big_table_data, trussbars_big_table, trussbars_big_table_safe_exact, vy_big_table,
};

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
fn big_table_ab() {
    if cfg!(debug_assertions) {
        eprintln!("vy A/B skipped in debug; run `cargo test --release --test vy_ab`");
        return;
    }
    let ctx = big_table_data();
    let n = 300;
    let base = min_time(n, || trussbars_big_table(&ctx));
    let safe_exact = min_time(n, || trussbars_big_table_safe_exact(&ctx));
    let vy = min_time(n, || vy_big_table(&ctx));
    eprintln!(
        "big-table A/B:  AOT(shipping)={base:?}  AOT(safe+exact-size+slice)={safe_exact:?}  vy(unsafe-buffer)={vy:?}"
    );
    // Sanity: all three render the same bytes.
    assert_eq!(trussbars_big_table(&ctx), trussbars_big_table_safe_exact(&ctx));
    assert_eq!(trussbars_big_table(&ctx), vy_big_table(&ctx));
}
