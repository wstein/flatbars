//! Comparative render benchmark: the two canonical `template-benchmarks-rs`
//! workloads (big-table, teams) rendered by the Trussbars-emitted Rust (AOT), a
//! hand-written `write!` baseline (the zero-overhead ceiling), Sailfish (fastest
//! reference), Askama (typed safe peer), and the dynamic interpreters handlebars
//! and liquid (the runtime engine the Rust ecosystem reaches for — the honest
//! "vs. what you'd otherwise use" column).
//!
//! The three **Trussbars** columns are the three execution strategies, fastest to
//! slowest: `trussbars` (AOT — compiled straight-line Rust), `trussbars-vm` (the
//! bytecode VM), and `trussbars-interp` (the always-correct tree-walk interpreter the
//! VM optimizes against — its target is ≥2× this column).
//! All engines emit byte-identical output (see `tests/output_equality.rs`).
//!
//! ```sh
//! cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
//! ```
#![allow(missing_docs)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use trussbars_benchmarks::{
    askama_big_table, askama_teams, big_table_data, big_table_value, handlebars_big_table,
    handlebars_big_table_registry, handlebars_teams, handlebars_teams_registry, hyde_data,
    interp_big_table, interp_big_table_template, interp_teams, interp_teams_template,
    liquid_big_table, liquid_big_table_template, liquid_teams, liquid_teams_template,
    sailfish_big_table, sailfish_teams, teams_data, teams_value, tera_big_table, tera_engine,
    tera_hyde, tera_teams, trussbars_big_table, trussbars_hyde, trussbars_teams, vm_big_table,
    vm_big_table_program, vm_teams, vm_teams_program, vy_big_table, vy_teams, write_big_table,
    write_teams,
};

fn big_table(c: &mut Criterion) {
    let ctx = big_table_data();
    let hb = handlebars_big_table_registry();
    let lq = liquid_big_table_template();
    let tera = tera_engine();
    let interp_tmpl = interp_big_table_template();
    let vm_prog = vm_big_table_program();
    let vm_data = big_table_value(&ctx);

    let mut g = c.benchmark_group("big-table");
    g.bench_function("trussbars", |b| {
        b.iter(|| trussbars_big_table(black_box(&ctx)))
    });
    g.bench_function("trussbars-vm", |b| {
        b.iter(|| vm_big_table(&vm_prog, black_box(&vm_data)))
    });
    g.bench_function("trussbars-interp", |b| {
        b.iter(|| interp_big_table(&interp_tmpl, black_box(&vm_data)))
    });
    g.bench_function("write", |b| b.iter(|| write_big_table(black_box(&ctx))));
    g.bench_function("sailfish", |b| {
        b.iter(|| sailfish_big_table(black_box(&ctx)))
    });
    g.bench_function("vy", |b| b.iter(|| vy_big_table(black_box(&ctx))));
    g.bench_function("askama", |b| b.iter(|| askama_big_table(black_box(&ctx))));
    g.bench_function("handlebars", |b| {
        b.iter(|| handlebars_big_table(&hb, black_box(&ctx)))
    });
    g.bench_function("liquid", |b| {
        b.iter(|| liquid_big_table(&lq, black_box(&ctx)))
    });
    g.bench_function("tera", |b| {
        b.iter(|| tera_big_table(&tera, black_box(&ctx)))
    });
    g.finish();
}

fn teams(c: &mut Criterion) {
    let ctx = teams_data();
    let hb = handlebars_teams_registry();
    let lq = liquid_teams_template();
    let tera = tera_engine();

    let interp_tmpl = interp_teams_template();
    let vm_prog = vm_teams_program();
    let vm_data = teams_value(&ctx);

    let mut g = c.benchmark_group("teams");
    g.bench_function("trussbars", |b| b.iter(|| trussbars_teams(black_box(&ctx))));
    g.bench_function("trussbars-vm", |b| {
        b.iter(|| vm_teams(&vm_prog, black_box(&vm_data)))
    });
    g.bench_function("trussbars-interp", |b| {
        b.iter(|| interp_teams(&interp_tmpl, black_box(&vm_data)))
    });
    g.bench_function("write", |b| b.iter(|| write_teams(black_box(&ctx))));
    g.bench_function("sailfish", |b| b.iter(|| sailfish_teams(black_box(&ctx))));
    g.bench_function("vy", |b| b.iter(|| vy_teams(black_box(&ctx))));
    g.bench_function("askama", |b| b.iter(|| askama_teams(black_box(&ctx))));
    g.bench_function("handlebars", |b| {
        b.iter(|| handlebars_teams(&hb, black_box(&ctx)))
    });
    g.bench_function("liquid", |b| b.iter(|| liquid_teams(&lq, black_box(&ctx))));
    g.bench_function("tera", |b| b.iter(|| tera_teams(&tera, black_box(&ctx))));
    g.finish();
}

// The Hyde theme index (northstar, docs/24) — the typed AOT vs Tera (the engine Zola's
// SSG renders with) on a real theme's render hot path (sidebar nav loop + a 50-post
// list). Byte-identical output (output_equality.rs); this measures the speed gap.
fn hyde(c: &mut Criterion) {
    let ctx = hyde_data();
    let tera = tera_engine();
    assert_eq!(trussbars_hyde(&ctx), tera_hyde(&tera, &ctx));

    let mut g = c.benchmark_group("hyde");
    g.bench_function("trussbars", |b| b.iter(|| trussbars_hyde(black_box(&ctx))));
    g.bench_function("tera", |b| b.iter(|| tera_hyde(&tera, black_box(&ctx))));
    g.finish();
}

criterion_group!(benches, big_table, teams, hyde);
criterion_main!(benches);
