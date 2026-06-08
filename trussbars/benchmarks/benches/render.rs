//! Comparative render benchmark: the two canonical `template-benchmarks-rs`
//! workloads (big-table, teams) rendered by the Trussbars-emitted Rust, a
//! hand-written `write!` baseline (the zero-overhead ceiling), Sailfish (fastest
//! reference), Askama (typed safe peer), and handlebars (dynamic interpreter).
//! All engines emit byte-identical output (see `tests/output_equality.rs`).
//!
//! ```sh
//! cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
//! ```
#![allow(missing_docs)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, sailfish_big_table,
    sailfish_teams, teams_data, trussbars_big_table, trussbars_teams, write_big_table, write_teams,
};

fn big_table(c: &mut Criterion) {
    let ctx = big_table_data();
    let hb = handlebars_big_table_registry();

    let mut g = c.benchmark_group("big-table");
    g.bench_function("trussbars", |b| {
        b.iter(|| trussbars_big_table(black_box(&ctx)))
    });
    g.bench_function("write", |b| b.iter(|| write_big_table(black_box(&ctx))));
    g.bench_function("sailfish", |b| {
        b.iter(|| sailfish_big_table(black_box(&ctx)))
    });
    g.bench_function("askama", |b| b.iter(|| askama_big_table(black_box(&ctx))));
    g.bench_function("handlebars", |b| {
        b.iter(|| handlebars_big_table(&hb, black_box(&ctx)))
    });
    g.finish();
}

fn teams(c: &mut Criterion) {
    let ctx = teams_data();
    let hb = handlebars_teams_registry();

    let mut g = c.benchmark_group("teams");
    g.bench_function("trussbars", |b| b.iter(|| trussbars_teams(black_box(&ctx))));
    g.bench_function("write", |b| b.iter(|| write_teams(black_box(&ctx))));
    g.bench_function("sailfish", |b| b.iter(|| sailfish_teams(black_box(&ctx))));
    g.bench_function("askama", |b| b.iter(|| askama_teams(black_box(&ctx))));
    g.bench_function("handlebars", |b| {
        b.iter(|| handlebars_teams(&hb, black_box(&ctx)))
    });
    g.finish();
}

criterion_group!(benches, big_table, teams);
criterion_main!(benches);
