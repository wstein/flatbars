//! Micro-benchmarks for the pluggable formatting/escaping backends. Compare the
//! fast path against the pure path by toggling features:
//!
//! ```sh
//! cargo bench -p trussbars-core                      # default: itoa + dragonbox_ecma
//! cargo bench -p trussbars-core --no-default-features # pure: Display, char scan
//! ```
// criterion_group!/criterion_main! generate undocumented public items.
#![allow(missing_docs)]

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use trussbars_core::{ToText, escape_html};

fn escaping(c: &mut Criterion) {
    let clean = "The quick brown fox jumps over the lazy dog. ".repeat(32);
    let dirty = "<a href=\"/x\">Tom & Jerry's 'show' < > </a>\n".repeat(32);
    c.bench_function("escape/clean", |b| {
        b.iter(|| {
            let mut out = String::new();
            escape_html(black_box(&clean), &mut out);
            out
        })
    });
    c.bench_function("escape/dirty", |b| {
        b.iter(|| {
            let mut out = String::new();
            escape_html(black_box(&dirty), &mut out);
            out
        })
    });
}

fn formatting(c: &mut Criterion) {
    let ints: Vec<i64> = (-500..500).collect();
    let floats: Vec<f64> = (0..1000).map(|i| f64::from(i) * 1.5 - 250.0).collect();
    c.bench_function("format/ints", |b| {
        b.iter(|| {
            let mut out = String::new();
            for n in black_box(&ints) {
                n.write_text(&mut out);
                out.push(',');
            }
            out
        })
    });
    c.bench_function("format/floats", |b| {
        b.iter(|| {
            let mut out = String::new();
            for n in black_box(&floats) {
                n.write_text(&mut out);
                out.push(',');
            }
            out
        })
    });
}

criterion_group!(benches, escaping, formatting);
criterion_main!(benches);
