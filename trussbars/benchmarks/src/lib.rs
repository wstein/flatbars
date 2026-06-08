//! Shared engine setups for the comparative render benchmark (`benches/render.rs`),
//! the perf-regression gate (`tests/perf_gate.rs`), and the cross-engine
//! output-equality test (`tests/output_equality.rs`).
//!
//! Two workloads, adopted verbatim from the de-facto standard Rust suite
//! `djc/template-benchmarks-rs` — the one Askama and Sailfish both report from
//! (Sailfish deleted its own benches "in favour of" it, and the suite is
//! maintained by Askama's author), so our columns line up with their charts:
//!
//!   * **big-table** — a 100×100 `<table>` of integers: a tight nested loop +
//!     integer formatting + raw write throughput (no escaping on the hot path).
//!   * **teams** — a small fixed HTML page with a `{{#each}}` and a first-item
//!     branch: control flow + escaping + fixed per-render overhead.
//!
//! Every engine renders to **byte-identical** output (asserted by the equality
//! test), so the comparison measures speed, not output shape. The **`write`**
//! column is a naive hand-written `write!` reference — note the codegen engines
//! *beat* it on big-table, because `core::fmt` integer formatting plus per-call
//! format-argument parsing is slower than `itoa`-class digits + `push_str` of
//! static literals (the same reason it isn't the fastest in the upstream suite).
//! The **Trussbars** columns are the VERBATIM output of `compileMaxRust` (the
//! emitted function body pasted under a bench-local name), so the bench measures
//! the shipped codegen, capacity hint and all.
#![allow(missing_docs)]

use std::fmt::Write as _;

use askama::Template;
use sailfish::TemplateOnce;
use serde::Serialize;

// ─── shared data ──────────────────────────────────────────────────────────────

/// Both dimensions of the `big-table` workload (the canonical suite uses 100).
pub const TABLE_SIZE: usize = 100;

#[derive(Serialize, Clone)]
pub struct BigTable {
    pub table: Vec<Vec<i64>>,
}

/// A `TABLE_SIZE`×`TABLE_SIZE` table whose every row is `[0, 1, …, TABLE_SIZE-1]`
/// (matches the canonical suite's `for i in 0..size { inner.push(i) }`).
pub fn big_table_data() -> BigTable {
    let row: Vec<i64> = (0..TABLE_SIZE as i64).collect();
    BigTable {
        table: vec![row; TABLE_SIZE],
    }
}

#[derive(Serialize, Clone)]
pub struct Team {
    pub name: String,
    pub score: i64,
}

#[derive(Serialize, Clone)]
pub struct Teams {
    pub year: i64,
    pub teams: Vec<Team>,
}

/// The canonical `teams` fixture (CSL 2015, four teams).
pub fn teams_data() -> Teams {
    Teams {
        year: 2015,
        teams: vec![
            Team {
                name: "Jiangsu".into(),
                score: 43,
            },
            Team {
                name: "Beijing".into(),
                score: 27,
            },
            Team {
                name: "Guangzhou".into(),
                score: 22,
            },
            Team {
                name: "Shandong".into(),
                score: 12,
            },
        ],
    }
}

// ─── 1. Trussbars (VERBATIM `compileMaxRust` output) ──────────────────────────
// Source templates (MaxBars), emitted by the v1 PureScript backend:
//   big-table: <table>{{#each table as |row|}}<tr>{{#each row as |v|}}<td>{{v}}</td>{{/each}}</tr>{{/each}}</table>
//   teams:     <html>…<ul>{{#each teams as |team|}}<li class="{{#if loop.first}}champion{{/if}}"><b>{{team.name}}</b>: {{team.score}}</li>{{/each}}</ul>…</html>
// Only the `pub fn render(ctx: &T)` header was renamed; the body is untouched.

pub fn trussbars_big_table(ctx: &BigTable) -> String {
    static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(1175);
    let __root = ctx;
    let mut out = String::with_capacity(__CAP.suggest());
    out.push_str("<table>");
    {
        let __sub1 = &(ctx.table);
        let __len1 = trussbars_core::Each::each_len(__sub1);
        if __len1 == 0 {
        } else {
            for (__i1, (__k1, __c1)) in trussbars_core::Each::each(__sub1).enumerate() {
                let __l1 = trussbars_core::Loop::at(__i1, __len1, __k1, None);
                out.push_str("<tr>");
                {
                    let __sub2 = &(__c1);
                    let __len2 = trussbars_core::Each::each_len(__sub2);
                    if __len2 == 0 {
                    } else {
                        for (__i2, (__k2, __c2)) in trussbars_core::Each::each(__sub2).enumerate() {
                            let __l2 = trussbars_core::Loop::at(__i2, __len2, __k2, Some(&__l1));
                            out.push_str("<td>");
                            trussbars_core::esc(&(__c2), &mut out);
                            out.push_str("</td>");
                        }
                    }
                }
                out.push_str("</tr>");
            }
        }
    }
    out.push_str("</table>");
    __CAP.record(out.len());
    out
}

pub fn trussbars_teams(ctx: &Teams) -> String {
    static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(500);
    let __root = ctx;
    let mut out = String::with_capacity(__CAP.suggest());
    out.push_str("<html><head><title>");
    trussbars_core::esc(&(ctx.year), &mut out);
    out.push_str("</title></head><body><h1>CSL ");
    trussbars_core::esc(&(ctx.year), &mut out);
    out.push_str("</h1><ul>");
    {
        let __sub1 = &(ctx.teams);
        let __len1 = trussbars_core::Each::each_len(__sub1);
        if __len1 == 0 {
        } else {
            for (__i1, (__k1, __c1)) in trussbars_core::Each::each(__sub1).enumerate() {
                let __l1 = trussbars_core::Loop::at(__i1, __len1, __k1, None);
                out.push_str("<li class=\"");
                if trussbars_core::truthy(&(__l1.first)) {
                    out.push_str("champion");
                }
                out.push_str("\"><b>");
                trussbars_core::esc(&(__c1.name), &mut out);
                out.push_str("</b>: ");
                trussbars_core::esc(&(__c1.score), &mut out);
                out.push_str("</li>");
            }
        }
    }
    out.push_str("</ul></body></html>");
    __CAP.record(out.len());
    out
}

// ─── 2. `write` baseline — hand-written `write!`, the zero-overhead ceiling ────

pub fn write_big_table(ctx: &BigTable) -> String {
    let mut out = String::with_capacity(1175);
    out.push_str("<table>");
    for row in &ctx.table {
        out.push_str("<tr>");
        for v in row {
            write!(out, "<td>{v}</td>").unwrap();
        }
        out.push_str("</tr>");
    }
    out.push_str("</table>");
    out
}

pub fn write_teams(ctx: &Teams) -> String {
    let mut out = String::with_capacity(500);
    write!(
        out,
        "<html><head><title>{year}</title></head><body><h1>CSL {year}</h1><ul>",
        year = ctx.year
    )
    .unwrap();
    for (i, team) in ctx.teams.iter().enumerate() {
        let champion = if i == 0 { "champion" } else { "" };
        write!(
            out,
            "<li class=\"{champion}\"><b>{name}</b>: {score}</li>",
            name = team.name,
            score = team.score
        )
        .unwrap();
    }
    out.push_str("</ul></body></html>");
    out
}

// ─── 3. Askama (typed, safe peer) ─────────────────────────────────────────────

#[derive(Template)]
#[template(
    source = "<table>{% for row in table %}<tr>{% for v in row %}<td>{{ v }}</td>{% endfor %}</tr>{% endfor %}</table>",
    ext = "html"
)]
struct AskamaBigTable<'a> {
    table: &'a [Vec<i64>],
}

pub fn askama_big_table(ctx: &BigTable) -> String {
    AskamaBigTable { table: &ctx.table }.render().unwrap()
}

#[derive(Template)]
#[template(
    source = "<html><head><title>{{ year }}</title></head><body><h1>CSL {{ year }}</h1><ul>{% for team in teams %}<li class=\"{% if loop.first %}champion{% endif %}\"><b>{{ team.name }}</b>: {{ team.score }}</li>{% endfor %}</ul></body></html>",
    ext = "html"
)]
struct AskamaTeams<'a> {
    year: i64,
    teams: &'a [Team],
}

pub fn askama_teams(ctx: &Teams) -> String {
    AskamaTeams {
        year: ctx.year,
        teams: &ctx.teams,
    }
    .render()
    .unwrap()
}

// ─── 4. Sailfish (fastest reference; embeds raw Rust, no injection boundary) ───

#[derive(TemplateOnce)]
#[template(path = "big-table.stpl")]
struct SailfishBigTable<'a> {
    table: &'a [Vec<i64>],
}

pub fn sailfish_big_table(ctx: &BigTable) -> String {
    SailfishBigTable { table: &ctx.table }
        .render_once()
        .unwrap()
}

#[derive(TemplateOnce)]
#[template(path = "teams.stpl")]
struct SailfishTeams<'a> {
    year: i64,
    teams: &'a [Team],
}

pub fn sailfish_teams(ctx: &Teams) -> String {
    SailfishTeams {
        year: ctx.year,
        teams: &ctx.teams,
    }
    .render_once()
    .unwrap()
}

// ─── 5. handlebars (dynamic interpreter baseline) ─────────────────────────────
// Templates are registered ONCE (out of the timed loop); only render is measured.

pub fn handlebars_big_table_registry() -> handlebars::Handlebars<'static> {
    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string(
        "big-table",
        "<table>{{#each table}}<tr>{{#each this}}<td>{{this}}</td>{{/each}}</tr>{{/each}}</table>",
    )
    .unwrap();
    hb
}

pub fn handlebars_big_table(hb: &handlebars::Handlebars, ctx: &BigTable) -> String {
    hb.render("big-table", ctx).unwrap()
}

pub fn handlebars_teams_registry() -> handlebars::Handlebars<'static> {
    let mut hb = handlebars::Handlebars::new();
    hb.register_template_string(
        "teams",
        "<html><head><title>{{year}}</title></head><body><h1>CSL {{year}}</h1><ul>{{#each teams}}<li class=\"{{#if @first}}champion{{/if}}\"><b>{{name}}</b>: {{score}}</li>{{/each}}</ul></body></html>",
    )
    .unwrap();
    hb
}

pub fn handlebars_teams(hb: &handlebars::Handlebars, ctx: &Teams) -> String {
    hb.render("teams", ctx).unwrap()
}

// ─── 6. Trussbars VM (dynamic backend, docs/11) ───────────────────────────────
// The SAME MaxBars language as the AOT column, run through the dynamic tree-walk
// interpreter instead of compiled to Rust. Like handlebars, the template is parsed
// ONCE (out of the timed loop) and the data is a pre-built `Value`, so the bench
// measures the interpret loop — the dynamic peer to handlebars, the AOT peer to the
// `trussbars` column above. (The VM spike is lenient; these templates are within its
// covered subset.)

use std::rc::Rc;

use trussbars_vm::{Template as VmTemplate, Value as VmValue};

fn vm_num(n: i64) -> VmValue {
    VmValue::Num(n as f64)
}

/// `BigTable` → the VM's dynamic `Value` (`{ table: [[i64]] }`).
pub fn big_table_value(ctx: &BigTable) -> VmValue {
    let table: Vec<VmValue> = ctx
        .table
        .iter()
        .map(|row| VmValue::Array(row.iter().map(|&v| vm_num(v)).collect::<Vec<_>>().into()))
        .collect();
    VmValue::Object(Rc::new([("table".to_string(), VmValue::Array(table.into()))].into_iter().collect()))
}

/// `Teams` → the VM's dynamic `Value` (`{ year, teams: [{ name, score }] }`).
pub fn teams_value(ctx: &Teams) -> VmValue {
    let teams: Vec<VmValue> = ctx
        .teams
        .iter()
        .map(|t| {
            VmValue::Object(Rc::new(
                [("name".to_string(), VmValue::Str(Rc::from(t.name.as_str()))), ("score".to_string(), vm_num(t.score))]
                    .into_iter()
                    .collect(),
            ))
        })
        .collect();
    VmValue::Object(Rc::new(
        [("year".to_string(), vm_num(ctx.year)), ("teams".to_string(), VmValue::Array(teams.into()))]
            .into_iter()
            .collect(),
    ))
}

/// The big-table template in current MaxBars surface, parsed once.
pub fn vm_big_table_template() -> VmTemplate {
    VmTemplate::parse("<table>{{#each table}}<tr>{{#each this}}<td>{{this}}</td>{{/each}}</tr>{{/each}}</table>")
        .expect("vm big-table parses")
}

pub fn vm_big_table(tmpl: &VmTemplate, data: &VmValue) -> String {
    tmpl.render(data).expect("vm big-table renders")
}

/// The teams template in current MaxBars surface, parsed once.
pub fn vm_teams_template() -> VmTemplate {
    VmTemplate::parse(
        "<html><head><title>{{year}}</title></head><body><h1>CSL {{year}}</h1><ul>\
         {{#each teams}}<li class=\"{{#if loop.first}}champion{{/if}}\"><b>{{this.name}}</b>: {{this.score}}</li>{{/each}}\
         </ul></body></html>",
    )
    .expect("vm teams parses")
}

pub fn vm_teams(tmpl: &VmTemplate, data: &VmValue) -> String {
    tmpl.render(data).expect("vm teams renders")
}
