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
//! The dynamic interpreters are represented by **handlebars** and **liquid** —
//! the latter being the engine the Rust ecosystem reaches for when templates are
//! runtime/user-authored (cobalt), i.e. the use case Trussbars deliberately does
//! not serve. Including it keeps the perf headline honest: "vs. the runtime engine
//! you'd otherwise use," not just vs. the typed/compiled peers.
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
// vy's element macros can expand to braced function arguments; harmless in bench code.
#![allow(unused_braces)]

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
    // Regenerated with the CURRENT emitter (G2 frame elision): `{{this}}` uses no loop
    // metadata, so there is no `Loop::at` and no `.enumerate()` — the stale paste had
    // both (dead, but it made the bench look obsolete).
    static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(1175);
    let __root = ctx;
    let mut out = String::with_capacity(__CAP.suggest());
    out.push_str("<table>");
    {
        let __sub1 = &(ctx.table);
        let __len1 = trussbars_core::Each::each_len(__sub1);
        if __len1 == 0 {
        } else {
            for (__k1, __c1) in trussbars_core::Each::each(__sub1) {
                out.push_str("<tr>");
                {
                    let __sub2 = &(__c1);
                    let __len2 = trussbars_core::Each::each_len(__sub2);
                    if __len2 == 0 {
                    } else {
                        for (__k2, __c2) in trussbars_core::Each::each(__sub2) {
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

// ─── 1b. Trussbars AOT — A/B variants isolating the vy gap (SAFE only) ─────────
// vy hits ~19µs on big-table via (a) an EXACT size pre-pass + (b) an `unsafe`
// raw-pointer buffer (itoap::write_to_ptr, String::from_raw_parts — no bounds
// checks). (b) is the boundary Trussbars refuses (docs/05). These variants test how
// much (a) — exact pre-sizing, plain-slice iteration — buys us *within* safe Rust.

/// Decimal digit count of an `i64` (for the exact size pre-pass).
fn dig(v: i64) -> usize {
    v.unsigned_abs()
        .checked_ilog10()
        .map_or(1, |l| l as usize + 1)
        + usize::from(v < 0)
}

/// Safe + exact pre-size + plain-slice iteration, but our `esc` (itoa) per cell.
pub fn trussbars_big_table_safe_exact(ctx: &BigTable) -> String {
    let mut size = "<table></table>".len();
    for row in &ctx.table {
        size += "<tr></tr>".len();
        for &v in row {
            size += "<td></td>".len() + dig(v);
        }
    }
    let mut out = String::with_capacity(size);
    out.push_str("<table>");
    for row in &ctx.table {
        out.push_str("<tr>");
        for &v in row {
            out.push_str("<td>");
            trussbars_core::esc(&v, &mut out);
            out.push_str("</td>");
        }
        out.push_str("</tr>");
    }
    out.push_str("</table>");
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

// ─── 5b. liquid (the runtime engine the Rust ecosystem reaches for) ───────────
// Liquid's home turf is the use case Trussbars deliberately *doesn't* serve:
// runtime/user-authored templates (cobalt builds sites with it). Including it
// makes the comparison honest — the perf headline is "vs the runtime engines you'd
// otherwise reach for," and liquid-rust is the named one. Like handlebars, the
// template is parsed ONCE (out of the timed loop) and the `Serialize` context is
// turned into liquid's `Object` per render (handlebars serializes per render too),
// so both dynamic columns measure parse-free render incl. their data marshalling.
// Liquid does not auto-escape `{{ }}`; the workloads have no HTML-special data
// (integers; CSL team names), so output stays byte-identical to the escaping peers.

pub fn liquid_parser() -> liquid::Parser {
    liquid::ParserBuilder::with_stdlib()
        .build()
        .expect("liquid stdlib parser builds")
}

pub fn liquid_big_table_template() -> liquid::Template {
    liquid_parser()
        .parse(
            "<table>{% for row in table %}<tr>{% for v in row %}<td>{{ v }}</td>{% endfor %}</tr>{% endfor %}</table>",
        )
        .expect("liquid big-table parses")
}

pub fn liquid_big_table(tmpl: &liquid::Template, ctx: &BigTable) -> String {
    let globals = liquid::to_object(ctx).expect("big-table → liquid object");
    tmpl.render(&globals).expect("liquid big-table renders")
}

pub fn liquid_teams_template() -> liquid::Template {
    liquid_parser()
        .parse(
            "<html><head><title>{{ year }}</title></head><body><h1>CSL {{ year }}</h1><ul>\
             {% for team in teams %}<li class=\"{% if forloop.first %}champion{% endif %}\"><b>{{ team.name }}</b>: {{ team.score }}</li>{% endfor %}\
             </ul></body></html>",
        )
        .expect("liquid teams parses")
}

pub fn liquid_teams(tmpl: &liquid::Template, ctx: &Teams) -> String {
    let globals = liquid::to_object(ctx).expect("teams → liquid object");
    tmpl.render(&globals).expect("liquid teams renders")
}

// ─── 5c. Tera (Jinja2-like interpreter; the engine Zola's SSG renders with) ───
// The other runtime engine the Rust ecosystem reaches for, and the closest dynamic
// surface peer to MaxBars (`{% for %}` / `{{ }}` / `loop.first`). Like handlebars and
// liquid, the templates are added ONCE (out of the timed loop) and the `Serialize`
// context is marshalled into a `tera::Context` per render. Templates are named without
// an `.html`/`.htm`/`.xml` suffix so Tera's suffix-gated auto-escape stays off — and the
// workloads have no HTML-special data anyway, so output is byte-identical to the peers.

pub fn tera_engine() -> tera::Tera {
    let mut tera = tera::Tera::default();
    tera.add_raw_template(
        "big_table",
        "<table>{% for row in table %}<tr>{% for v in row %}<td>{{ v }}</td>{% endfor %}</tr>{% endfor %}</table>",
    )
    .expect("tera big-table parses");
    tera.add_raw_template(
        "teams",
        "<html><head><title>{{ year }}</title></head><body><h1>CSL {{ year }}</h1><ul>\
         {% for team in teams %}<li class=\"{% if loop.first %}champion{% endif %}\"><b>{{ team.name }}</b>: {{ team.score }}</li>{% endfor %}\
         </ul></body></html>",
    )
    .expect("tera teams parses");
    // A Hyde-shaped blog index (sidebar nav loop + a post list) — the northstar theme
    // (docs/24), whitespace-flat so Trussbars (escapes `{{ }}`) and Tera (auto-escape
    // off for this unsuffixed name) render byte-identical over HTML-special-free data.
    tera.add_raw_template("hyde", HYDE_TPL)
        .expect("tera hyde parses");
    tera
}

pub fn tera_hyde(tera: &tera::Tera, ctx: &HydeIndex) -> String {
    let c = tera::Context::from_serialize(ctx).expect("hyde → tera context");
    tera.render("hyde", &c).expect("tera hyde renders")
}

pub fn tera_big_table(tera: &tera::Tera, ctx: &BigTable) -> String {
    let c = tera::Context::from_serialize(ctx).expect("big-table → tera context");
    tera.render("big_table", &c)
        .expect("tera big-table renders")
}

pub fn tera_teams(tera: &tera::Tera, ctx: &Teams) -> String {
    let c = tera::Context::from_serialize(ctx).expect("teams → tera context");
    tera.render("teams", &c).expect("tera teams renders")
}

// ─── 6. Trussbars interpreter (dynamic backend, docs/11) ──────────────────────
// The SAME MaxBars language as the AOT column, run through the dynamic tree-walk
// INTERPRETER instead of compiled to Rust. Like handlebars, the template is parsed
// ONCE (out of the timed loop) and the data is a pre-built `Value`, so the bench
// measures the interpret loop — the dynamic peer to handlebars, the AOT peer to the
// `trussbars` column above. The interpreter is the always-correct dynamic backend; the
// bytecode VM in §6b optimizes against it (its target: ≥2× this column).

use std::rc::Rc;

use trussbars_interp::{Template as VmTemplate, Value as VmValue};

fn vm_num(n: i64) -> VmValue {
    VmValue::Num(n as f64)
}

/// `BigTable` → the dynamic `Value` (`{ table: [[i64]] }`), shared by both dynamic
/// backends (interpreter + VM) so they render identical input.
pub fn big_table_value(ctx: &BigTable) -> VmValue {
    let table: Vec<VmValue> = ctx
        .table
        .iter()
        .map(|row| VmValue::Array(row.iter().map(|&v| vm_num(v)).collect::<Vec<_>>().into()))
        .collect();
    VmValue::Object(Rc::new(
        [("table".to_string(), VmValue::Array(table.into()))]
            .into_iter()
            .collect(),
    ))
}

/// `Teams` → the VM's dynamic `Value` (`{ year, teams: [{ name, score }] }`).
pub fn teams_value(ctx: &Teams) -> VmValue {
    let teams: Vec<VmValue> = ctx
        .teams
        .iter()
        .map(|t| {
            VmValue::Object(Rc::new(
                [
                    ("name".to_string(), VmValue::Str(Rc::from(t.name.as_str()))),
                    ("score".to_string(), vm_num(t.score)),
                ]
                .into_iter()
                .collect(),
            ))
        })
        .collect();
    VmValue::Object(Rc::new(
        [
            ("year".to_string(), vm_num(ctx.year)),
            ("teams".to_string(), VmValue::Array(teams.into())),
        ]
        .into_iter()
        .collect(),
    ))
}

/// The big-table template in current MaxBars surface, parsed once (interpreter).
pub fn interp_big_table_template() -> VmTemplate {
    VmTemplate::parse(
        "<table>{% for table %}<tr>{% for this %}<td>{{this}}</td>{% endfor %}</tr>{% endfor %}</table>",
    )
    .expect("interp big-table parses")
}

pub fn interp_big_table(tmpl: &VmTemplate, data: &VmValue) -> String {
    tmpl.render(data).expect("interp big-table renders")
}

/// The teams template in current MaxBars surface, parsed once (interpreter).
pub fn interp_teams_template() -> VmTemplate {
    VmTemplate::parse(
        "<html><head><title>{{year}}</title></head><body><h1>CSL {{year}}</h1><ul>\
         {% for teams %}<li class=\"{% if loop.first %}champion{% endif %}\"><b>{{this.name}}</b>: {{this.score}}</li>{% endfor %}\
         </ul></body></html>",
    )
    .expect("interp teams parses")
}

pub fn interp_teams(tmpl: &VmTemplate, data: &VmValue) -> String {
    tmpl.render(data).expect("interp teams renders")
}

// ── 6b. Trussbars VM — the BYTECODE backend (docs/11 §4) ───────────────────────
// The same workloads compiled to bytecode (the separate `trussbars-vm` crate) and run
// by the borrow-based machine, to measure the VM vs the tree-walk interpreter above.
// Compiled once (out of the timed loop), like the others. Goal: ≥2× the interpreter.

use trussbars_vm::Program;

pub fn vm_big_table_program() -> Program {
    Program::compile(
        "<table>{% for table %}<tr>{% for this %}<td>{{this}}</td>{% endfor %}</tr>{% endfor %}</table>",
    )
    .expect("vm big-table compiles")
}

pub fn vm_big_table(p: &Program, data: &VmValue) -> String {
    p.render(data).expect("vm big-table renders")
}

pub fn vm_teams_program() -> Program {
    Program::compile(
        "<html><head><title>{{year}}</title></head><body><h1>CSL {{year}}</h1><ul>\
         {% for teams %}<li class=\"{% if loop.first %}champion{% endif %}\"><b>{{this.name}}</b>: {{this.score}}</li>{% endfor %}\
         </ul></body></html>",
    )
    .expect("vm teams compiles")
}

pub fn vm_teams(p: &Program, data: &VmValue) -> String {
    p.render(data).expect("vm teams renders")
}

// ─── 7. vy (compile-time HTML macro DSL) ──────────────────────────────────────
// An embedded-Rust HTML DSL whose element macros expand to tuple-typed `IntoHtml`
// values (no closures), pre-sized and single-allocation. Not a separate-language
// compiler like Trussbars — a different shape, included to test the "vy practices"
// claims (docs/11 review). Same two canonical workloads, byte-identical output.

use vy::prelude::*;

pub fn vy_big_table(ctx: &BigTable) -> String {
    table!(ctx.table.iter().map(|row| tr!(row.iter().map(|v| td!(*v))))).into_string()
}

pub fn vy_teams(ctx: &Teams) -> String {
    html!(
        head!(title!(ctx.year)),
        body!(
            h1!("CSL ", ctx.year),
            ul!(ctx.teams.iter().enumerate().map(|(i, team)| li!(
                class = if i == 0 { "champion" } else { "" },
                b!(team.name.as_str()),
                ": ",
                team.score
            )))
        )
    )
    .into_string()
}

// ─── 5d. Hyde theme (northstar, docs/24) — a real theme: Trussbars AOT vs Tera ───
//
// A Hyde-shaped blog index — the sidebar nav loop + a 50-post list (the render hot
// path). One whitespace-flat template file feeds BOTH engines (`truss! path=` and
// `include_str!`), so the AOT (which escapes `{{ }}`) and Tera (auto-escape off for the
// unsuffixed name) emit byte-identical bytes over HTML-special-free data — asserted in
// `tests/output_equality.rs`. The faithful, full Hyde port (inheritance, config
// conditionals, markdown) lives in `examples/ssg/`; this is its render-speed twin.

const HYDE_TPL: &str = include_str!("../templates/hyde.truss");

#[derive(Serialize, Clone, trussbars_core::Trussbars)]
pub struct HydeLink {
    pub url: String,
    pub name: String,
}
#[derive(Serialize, Clone, trussbars_core::Trussbars)]
pub struct HydeExtra {
    pub hyde_theme: String,
    pub hyde_links: Vec<HydeLink>,
}
#[derive(Serialize, Clone, trussbars_core::Trussbars)]
pub struct HydeConfig {
    pub title: String,
    pub base_url: String,
    pub extra: HydeExtra,
}
#[derive(Serialize, Clone, trussbars_core::Trussbars)]
pub struct HydePage {
    pub permalink: String,
    pub title: String,
    pub date: String,
}
#[derive(Serialize, Clone, trussbars_core::Trussbars)]
pub struct HydeIndex {
    pub lang: String,
    pub config: HydeConfig,
    pub pages: Vec<HydePage>,
}

/// A blog index — 5 nav links + 50 posts — the loop-bound render hot path.
pub fn hyde_data() -> HydeIndex {
    HydeIndex {
        lang: "en".into(),
        config: HydeConfig {
            title: "Trussbars Blog".into(),
            base_url: "https://example.com".into(),
            extra: HydeExtra {
                hyde_theme: "theme-base-08".into(),
                hyde_links: (1..=5)
                    .map(|i| HydeLink {
                        url: format!("/nav-{i}/"),
                        name: format!("Section {i}"),
                    })
                    .collect(),
            },
        },
        pages: (1..=50)
            .map(|i| HydePage {
                permalink: format!("/post-{i}/"),
                title: format!("Post number {i}"),
                date: format!("2026-06-{:02}", (i % 28) + 1),
            })
            .collect(),
    }
}

trussbars_macros::truss!(trussbars_hyde, HydeIndex, path = "templates/hyde.truss");
