//! End-to-end render benchmark (the perf debate's P1): the same template rendered
//! by the Trussbars-emitted Rust, handlebars-rust (dynamic interpreter baseline),
//! Askama (typed peer), and Sailfish (fastest reference). See the crate README.
//!
//! ```sh
//! cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
//! ```
#![allow(missing_docs)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use trussbars_benchmarks::{
    askama_render, handlebars_registry, handlebars_render, sailfish_render, sample,
    trussbars_render,
};

fn bench(c: &mut Criterion) {
    let ctx = sample();
    let hb = handlebars_registry();

    let mut g = c.benchmark_group("render-50-items");
    g.bench_function("trussbars", |b| {
        b.iter(|| trussbars_render(black_box(&ctx)))
    });
    g.bench_function("handlebars", |b| {
        b.iter(|| handlebars_render(&hb, black_box(&ctx)))
    });
    g.bench_function("askama", |b| b.iter(|| askama_render(black_box(&ctx))));
    g.bench_function("sailfish", |b| b.iter(|| sailfish_render(black_box(&ctx))));
    g.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
