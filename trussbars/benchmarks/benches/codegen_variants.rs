//! Codegen-strategy profiling (not a headline comparison — a decision tool).
//!
//! On macOS a no-sudo sampling flamegraph isn't available (dtrace/xctrace need
//! entitlements), so instead of sampling an obvious tight loop we **decompose**
//! the big-table hot path into A/B variants that each remove exactly one emitted
//! construct. The deltas answer the codegen questions directly and reproducibly:
//!
//!   B0  the shipped emitted code (Each + per-cell Loop::at + esc(&&i64))
//!   VA  B0 minus the per-cell `Loop::at`        → does the unused frame cost?
//!   VB  VA with `write_text(&i64)` not `esc(&&i64)` → escape-branch + double-ref?
//!   VE  direct slice iteration (no `Each`), no frame, write_text → the Each cost,
//!       and the safe-Rust *ceiling* for this template (compare to Sailfish ~17.9µs)
//!
//! Each line in the table below is then tagged for the v1 emitter or the v2
//! proc-macro in `trussbars/docs/05-codegen-optimization.md`.

#![allow(missing_docs)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use trussbars_benchmarks::{BigTable, big_table_data, trussbars_big_table};
use trussbars_core::ToText;

/// VA — B0 with the per-cell (and per-row) `Loop::at` removed. The template never
/// references `loop`, so the emitter *could* elide the frame; this measures whether
/// it matters (i.e. whether LLVM already drops the unused `__l`).
fn va_no_loop_frame(ctx: &BigTable) -> String {
    static CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(1175);
    let mut out = String::with_capacity(CAP.suggest());
    out.push_str("<table>");
    for (_, row) in trussbars_core::Each::each(&ctx.table) {
        out.push_str("<tr>");
        for (_, v) in trussbars_core::Each::each(&row) {
            out.push_str("<td>");
            trussbars_core::esc(&(v), &mut out);
            out.push_str("</td>");
        }
        out.push_str("</tr>");
    }
    out.push_str("</table>");
    CAP.record(out.len());
    out
}

/// VB — VA but the leaf writes `(&i64).write_text` directly instead of
/// `esc(&&i64)`. For integers `write_escaped == write_text` (no escapable bytes),
/// so any delta is the generic-`esc` dispatch + the extra `&`-layer.
fn vb_direct_write(ctx: &BigTable) -> String {
    static CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(1175);
    let mut out = String::with_capacity(CAP.suggest());
    out.push_str("<table>");
    for (_, row) in trussbars_core::Each::each(&ctx.table) {
        out.push_str("<tr>");
        for (_, v) in trussbars_core::Each::each(&row) {
            out.push_str("<td>");
            v.write_text(&mut out);
            out.push_str("</td>");
        }
        out.push_str("</tr>");
    }
    out.push_str("</table>");
    CAP.record(out.len());
    out
}

/// VE — the type-specialized ceiling a v2 proc-macro could emit: native slice
/// iteration (no `Each`), no loop frame, direct integer write. This is the same
/// shape Sailfish emits; its time is the safe-Rust floor for this template.
fn ve_specialized(ctx: &BigTable) -> String {
    static CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(1175);
    let mut out = String::with_capacity(CAP.suggest());
    out.push_str("<table>");
    for row in &ctx.table {
        out.push_str("<tr>");
        for v in row {
            out.push_str("<td>");
            v.write_text(&mut out);
            out.push_str("</td>");
        }
        out.push_str("</tr>");
    }
    out.push_str("</table>");
    CAP.record(out.len());
    out
}

fn variants(c: &mut Criterion) {
    let ctx = big_table_data();

    // Sanity: every variant must still produce identical bytes.
    let b0 = trussbars_big_table(&ctx);
    assert_eq!(va_no_loop_frame(&ctx), b0);
    assert_eq!(vb_direct_write(&ctx), b0);
    assert_eq!(ve_specialized(&ctx), b0);

    let mut g = c.benchmark_group("big-table-variants");
    g.bench_function("B0_shipped", |b| {
        b.iter(|| trussbars_big_table(black_box(&ctx)))
    });
    g.bench_function("VA_no_loop_frame", |b| {
        b.iter(|| va_no_loop_frame(black_box(&ctx)))
    });
    g.bench_function("VB_direct_write", |b| {
        b.iter(|| vb_direct_write(black_box(&ctx)))
    });
    g.bench_function("VE_specialized", |b| {
        b.iter(|| ve_specialized(black_box(&ctx)))
    });
    g.finish();
}

criterion_group!(benches, variants);
criterion_main!(benches);
