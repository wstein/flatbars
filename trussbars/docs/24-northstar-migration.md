# Trussbars — Northstar migration (a proof port)

> **Status:** **Exploration.** **Goal:** pick and build one *recognizable* migration that
> proves Trussbars in the wild — "app/tool X renders with Trussbars" as the headline.
> **Recommendation:** a **Zola theme → Trussbars** port (real speed win + showcases the new
> `{% extends %}`/`{% block %}` inheritance + Rust-native `.truss`), with an **Askama → Trussbars**
> app as the alternative *differentiation* play (typed-AOT head-to-head). The benchmark
> numbers below are the evidence; the candidate table is the decision.

## Why now

The original survey (session start) ruled the inheritance-heavy targets **out** — Django,
Zola/Tera, Askama all compose pages with `{% extends %}` + named `{% block %}`, which
Trussbars lacked. That gap is **closed**: ADR-040 shipped `{% extends %}` / `{% block %}` /
`{% super %}` (statically flattened across oracle / AOT / VM, conformance-gated), so those
targets are now viable. The product story also firmed up: templates are authored as `.truss`
files, which the **Trussbars-only editor plugins** highlight end-to-end.

## Candidates

Rated on five axes — **rating** (overall fit), **effort**, **speed win** (vs the target's
current engine), **practical benefit** for that ecosystem's users, and what it *demonstrates*.

| Candidate | Rating | Effort | Speed win | Practical benefit | Demonstrates |
| --- | --- | --- | --- | --- | --- |
| **Zola theme → Trussbars** | ~8 | Med-High — port theme templates + a Zola-compatible harness/fork; Tera→`{% %}` maps closely | **17–29× (AOT)**, **1.6–3.1× (VM)** vs Tera | **High** — faster builds, compile-time template type errors, `.truss` tooling | inheritance + speed, Rust-native SSG |
| **Askama app → Trussbars** | ~8.5 | High — real app port (typed structs, `#[derive(Template)]`, axum) | **~3× (AOT)** vs Askama | **High but different** — the **VM duality**: runtime / user-editable templates Askama (compile-only) can't do, + a Django/Liquid surface | beats the typed-templating incumbent on *speed and surface* |
| **mdBook renderer (`mdbook-trussbars`)** | ~8 | **Low-Med** — pluggable renderer crate (no fork), ~6 theme files + host helpers | 74× vs handlebars, but rendering isn't mdBook's bottleneck | **Low** — default renderer is fine | **recognizability** ("the Rust Book renders with Trussbars") |
| **Cobalt (liquid-rust swap)** | ~7.5 | Med — engine swap; reconcile Liquid filter parity | 64× vs liquid | **Med** — faster builds + typed safety, but Cobalt is niche | a clean Liquid drop-in |
| **Django app → Trussbars** | ~6 | **Very High** — Python↔Rust boundary (PyO3) + Django's tag/filter/context ecosystem | huge in theory | **Low in practice** — integration cost dwarfs it | logic-less philosophy alignment |

## Benchmark evidence

The repo's `trussbars/benchmarks/` runs the de-facto `djc/template-benchmarks-rs` workloads
(big-table = a 100×100 table; teams = a small page) across the Trussbars AOT + VM backends
and six peer engines, output **byte-identical** (asserted before any timing). Median render
times (a contributor machine; CI publishes canonical numbers):

| | Trussbars AOT | Trussbars VM | Tera (Zola) | liquid (cobalt) | handlebars (mdBook) | Askama |
| --- | --- | --- | --- | --- | --- | --- |
| big-table | **36 µs** | 392 µs | 617 µs | 2.34 ms | 2.68 ms | 129 µs |
| teams | **87 ns** | 824 ns | 2.54 µs | 4.23 µs | 4.13 µs | 241 ns |

Read off the speed-win column:

- **vs the interpreters** (Zola/Tera, cobalt/liquid, mdBook/handlebars): **AOT 17–74×**,
  and — apples-to-apples, both dynamic — the **VM is still 1.6–6×** faster than the
  interpreter you'd otherwise use. Tera is the *fastest* of the three (~4× over the other
  two), so the Zola comparison is the toughest, and AOT still wins **17× / 29×**.
- **vs Askama** (the typed, compiled peer): **~3× faster** — not parity. The preallocation
  + `itoa`/`dragonbox_ecma` formatting keeps Trussbars near the raw-Rust references
  (Sailfish/vy) while staying `#![forbid(unsafe_code)]`.

So a Rust-native northstar wins on **all three** of speed, the inheritance showcase, and
`.truss` authoring at once.

## Recommendation

**Zola theme → Trussbars** as the lead: every axis is strong (17–29× speed, real build-time
benefit, exercises `{% extends %}`/`{% block %}`, Rust-native), and the demo is self-contained
(a theme + a small SSG harness, no Python boundary). **Askama → Trussbars** is the sharpest
*flag-planting* alternative — same surface family, ~3× faster, plus the VM gives runtime
templates Askama structurally can't. **mdBook** stays the pure-recognizability play if a
famous logo outranks demonstrating the new capabilities.

## First slice (Zola)

1. Port a Zola **base theme** — `base.html` + 2–3 page templates — to `.truss`, using
   `{% extends "base" %}` / `{% block %}` / `{% super %}` and the existing `{% for %}` / `{% if %}`
   / filters. Keep it logic-light (StringTemplate model–view separation).
2. A **minimal SSG harness**: front-matter + Markdown → a typed context → Trussbars render
   (AOT via `truss!` / `#[derive(Template)]`, or the VM for hot-reload).
3. Wire the harness into `trussbars/benchmarks/` as a **build-time A/B vs Tera**, reproducing
   the 17–29× headline on a real theme rather than the synthetic workloads.

## Host helpers — the Tera-filter mapping (spike)

The theme's Tera filters/functions realize as **typed host helpers** (plain Rust fns,
declared once via `helpers = [..]` / `#[truss_helpers(..)]`) plus harness precompute —
the logic-less split: *logic in the host, the template only calls.* Proven end-to-end in
`trussbars/crates/trussbars-macros/tests/zola_helpers.rs` (compiles + renders, stubbed
bodies):

| Tera construct | Trussbars realization |
| --- | --- |
| `get_url(path)`, `date(format=…)` | value host helpers — `fn get_url(path: &str) -> String`, `fn date(value: &str, fmt: &str) -> String`; `{{ get_url "@/p.md" }}`, `{{ page.date \| date "%b %d, %Y" }}` compile to direct calls. Named args become positional/piped. |
| `markdown` (page body) | **harness precompute** — front-matter + Markdown → `Safe` HTML in the typed context, output `{{ body \| safe }}`. No template helper. |
| `markdown` (inline filter) | a value helper returning `trussbars_core::Safe` → spliced raw (the injection boundary stays explicit; only a `Safe` return bypasses `esc`). |
| shortcode **template** | `{% inline "youtube" (id, w=560) %}…{% endinline %}` — an ADR-042 typed signature (required `id`, defaulted `w`); a block shortcode is the `fn(body: impl Fn() -> String)` block-helper shape. |
| shortcode **invocation/splice** | **harness** (markdown preprocessing): detect the call, render the Trussbars shortcode template with parsed args, splice. Not a template helper. |

Two caveats to budget for: the AOT needs **typed host-helper declarations** (roadmap item 4 —
the `.truss` host-binding affordance, which building the harness drives), and site-wide
functions (`get_taxonomy`/`get_section`/pagination) need the host to *supply the index data*.
Pick a layout-heavy, logic-light theme to keep both small.

## Findings (the Hyde port)

The first theme ported is **Hyde** (`getzola/hyde`) — `trussbars/examples/ssg/`, its
`index.html` (base + post-list) and `page.html` (extends, overrides `content`) ported to
`.truss`, rendered by a `truss!` harness over a typed `Config`/`Section`/`Page` context
(deserialized from a real Zola `config.toml`). It exercises inheritance, nested config
access, the `{% for x in xs %}` loop, `get_url`/`date` host helpers, the feed conditional,
and markdown precompute — and renders faithfully.

One **engine gap** surfaced (the point of the exercise) and is now **closed**: a
**cross-file partial can serve as an `{% extends %}` base**. The inheritance flatten used to
run at parse time, before the cross-file partials were merged into the registry, so
`{% extends "name" %}` against a `partials = [name = "file"]` import failed (`names no base
template`) and the base had to be inlined into the extending template. The fix defers the
flatten in the AOT path: `parse()` gained a raw variant (`parse_raw`, no inherit/augment) and
`crate::inherit::resolve_inheritance_with` takes an external base registry, so
`emit_with_partials` now parses the main template raw, builds the base registry from the
imported partials (`{% block %}` slots intact), and *then* flattens against it. The
interpreter and VM (single-template, no cross-file partials) keep parsing through `parse()`
unchanged — conformance stays 87/87 across all four axes. Concretely, the Hyde port now shares
**one** `templates/hyde_base.truss`: `render_index` renders it directly and `render_page`
imports it as the `hyde` partial and `{% extends %}` it (no duplicated base).

## Non-goals (for the proof)

- Full Zola/Tera feature parity (every filter, `get_url`, shortcodes) — port what the theme
  uses; record the rest.
- Forking Zola itself — the proof is a theme + harness, not a Zola engine replacement.
- The Django target — deferred until there's a story for the Python↔Rust boundary.
