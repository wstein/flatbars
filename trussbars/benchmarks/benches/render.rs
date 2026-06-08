//! End-to-end render benchmark (the perf debate's P1): the same template rendered
//! by the Trussbars-emitted Rust, handlebars-rust (dynamic interpreter baseline),
//! Askama (typed peer), and Sailfish (fastest reference). All four produce the
//! same HTML, so this measures rendering, not output shape.
//!
//! ```sh
//! cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
//! ```
#![allow(missing_docs)]

use std::hint::black_box;

use askama::Template;
use criterion::{Criterion, criterion_group, criterion_main};
use sailfish::TemplateOnce;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct Item {
    name: String,
    qty: i64,
}

#[derive(Serialize, Clone)]
struct Ctx {
    title: String,
    items: Vec<Item>,
}

fn sample() -> Ctx {
    Ctx {
        title: "Cart".to_string(),
        items: (0..50)
            .map(|i| Item {
                name: format!("Item {i}"),
                qty: i,
            })
            .collect(),
    }
}

// ── Trussbars: the emitted Rust (verbatim from `compileMaxRust`) ──────────────
fn trussbars_render(ctx: &Ctx) -> String {
    let __root = ctx;
    let mut out = String::new();
    out.push_str("<h1>");
    trussbars_core::esc(&(ctx.title), &mut out);
    out.push_str("</h1><ul>");
    {
        let __sub1 = &(ctx.items);
        let __len1 = __sub1.len();
        if __len1 == 0 {
        } else {
            for (__i1, __c1) in __sub1.iter().enumerate() {
                let __l1 = trussbars_core::Loop::at(__i1, __len1, None, None);
                out.push_str("<li>");
                trussbars_core::esc(&(__c1.name), &mut out);
                out.push_str(" x");
                trussbars_core::esc(&(__c1.qty), &mut out);
                out.push_str("</li>");
            }
        }
    }
    out.push_str("</ul>");
    out
}

// ── Askama (typed peer) ───────────────────────────────────────────────────────
#[derive(Template)]
#[template(
    source = "<h1>{{ title }}</h1><ul>{% for item in items %}<li>{{ item.name }} x{{ item.qty }}</li>{% endfor %}</ul>",
    ext = "html"
)]
struct AskamaPage<'a> {
    title: &'a str,
    items: &'a [Item],
}

// ── Sailfish (fastest reference) ──────────────────────────────────────────────
#[derive(TemplateOnce)]
#[template(path = "items.stpl")]
struct SailfishPage<'a> {
    title: &'a str,
    items: &'a [Item],
}

fn bench(c: &mut Criterion) {
    let ctx = sample();

    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string(
        "items",
        "<h1>{{title}}</h1><ul>{{#each items}}<li>{{this.name}} x{{this.qty}}</li>{{/each}}</ul>",
    )
    .unwrap();

    let mut g = c.benchmark_group("render-50-items");
    g.bench_function("trussbars", |b| b.iter(|| trussbars_render(black_box(&ctx))));
    g.bench_function("handlebars", |b| {
        b.iter(|| hb.render("items", black_box(&ctx)).unwrap())
    });
    g.bench_function("askama", |b| {
        b.iter(|| {
            AskamaPage {
                title: &ctx.title,
                items: &ctx.items,
            }
            .render()
            .unwrap()
        })
    });
    g.bench_function("sailfish", |b| {
        b.iter(|| {
            SailfishPage {
                title: &ctx.title,
                items: &ctx.items,
            }
            .render_once()
            .unwrap()
        })
    });
    g.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
