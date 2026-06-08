//! Shared engine setups for the render benchmark (`benches/render.rs`) and the
//! perf-regression gate (`tests/perf_gate.rs`). All four engines render the same
//! template and produce identical HTML.
#![allow(missing_docs)]

use askama::Template;
use sailfish::TemplateOnce;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Item {
    pub name: String,
    pub qty: i64,
}

#[derive(Serialize, Clone)]
pub struct Ctx {
    pub title: String,
    pub items: Vec<Item>,
}

pub fn sample() -> Ctx {
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

/// The Trussbars-emitted Rust (verbatim from `compileMaxRust`).
pub fn trussbars_render(ctx: &Ctx) -> String {
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

#[derive(Template)]
#[template(
    source = "<h1>{{ title }}</h1><ul>{% for item in items %}<li>{{ item.name }} x{{ item.qty }}</li>{% endfor %}</ul>",
    ext = "html"
)]
struct AskamaPage<'a> {
    title: &'a str,
    items: &'a [Item],
}

pub fn askama_render(ctx: &Ctx) -> String {
    AskamaPage {
        title: &ctx.title,
        items: &ctx.items,
    }
    .render()
    .unwrap()
}

#[derive(TemplateOnce)]
#[template(path = "items.stpl")]
struct SailfishPage<'a> {
    title: &'a str,
    items: &'a [Item],
}

pub fn sailfish_render(ctx: &Ctx) -> String {
    SailfishPage {
        title: &ctx.title,
        items: &ctx.items,
    }
    .render_once()
    .unwrap()
}

pub fn handlebars_registry() -> handlebars::Handlebars<'static> {
    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string(
        "items",
        "<h1>{{title}}</h1><ul>{{#each items}}<li>{{this.name}} x{{this.qty}}</li>{{/each}}</ul>",
    )
    .unwrap();
    hb
}

pub fn handlebars_render(hb: &handlebars::Handlebars, ctx: &Ctx) -> String {
    hb.render("items", ctx).unwrap()
}
