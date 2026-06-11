# trussbars-benchmarks

Comparative render benchmark — the Trussbars **AOT** and **VM** backends against six peer
engines — on the **two canonical workloads**
of [`djc/template-benchmarks-rs`](https://github.com/djc/template-benchmarks-rs) —
the de-facto Rust suite that **Askama and Sailfish both report from** (Sailfish
[deleted its own benches](https://github.com/rust-sailfish/sailfish/blob/main/benches/README.md)
"in favour of" it, and the suite is maintained by Askama's author). Using the same
workloads means our numbers line up cell-for-cell with their published charts.

Every engine renders to **byte-identical** output, asserted by
`tests/output_equality.rs` before any timing is trusted — so this measures speed,
not output shape. (The upstream suite skips this check; we add it.)

```sh
cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
```

## Workloads

- **big-table** — a 100×100 `<table>` of integers (`{{#each}}` nested in
  `{{#each}}`): a tight loop + integer formatting + raw write throughput.
- **teams** — a small fixed HTML page (4 teams) with a `{{#each}}` and a
  first-item `{{#if loop.first}}` branch: control flow + escaping + fixed
  per-render overhead.

The columns: **Trussbars (AOT)** (verbatim `compileMaxRust` output) and **Trussbars (VM)**
(the *same* MaxBars language run through the dynamic tree-walk interpreter, docs/11);
**Sailfish** and **vy** (the fastest references — raw-Rust / macro DSLs); **Askama** (the
typed safe peer); and the dynamic interpreters **Tera**, **liquid**, and **handlebars** —
the engines the Rust ecosystem reaches for when templates are runtime / user-authored, and
the named incumbents of the northstar targets (**Tera** is Zola's, **liquid** is cobalt's,
**handlebars** is mdBook's). They are included so the headline reads "vs. what you'd
otherwise use," and so the VM column gives the apples-to-apples *dynamic* comparison the AOT
column can't. **`write`** is a naive hand-written `write!` baseline (see the note below).

## Results

Criterion medians from a **contributor machine** (Rust 1.96, `--release`); reproduce
with the command above. These are a snapshot for orientation — the **canonical,
machine-stamped** medians come from the `benchmarks` job of the Trussbars CI workflow
(`.github/workflows/trussbars.yml`), which runs `cargo bench --bench render` on a
consistent runner class each push and publishes them to the run's **job summary** and a
`trussbars-bench-render-medians` artifact. Trust the CI numbers for cross-run
comparison; the table below for the *shape* of the result.

### big-table (100×100 = 10 000 cells)

| Engine | Time | vs Trussbars AOT | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~17.8 µs | **0.49×** (≈2.0× faster) | raw Rust + `unsafe` buffer — no injection boundary |
| **vy** | ~20.0 µs | **0.55×** (≈1.8× faster) | compile-time HTML macro DSL, pre-sized |
| **Trussbars (AOT)** | ~36.3 µs | 1.0× | typed + injection-safe codegen, `#![forbid(unsafe_code)]` |
| **Askama** | ~129 µs | 3.6× slower | typed, safe codegen |
| `write` | ~187 µs | 5.1× slower | naive hand-written `write!` |
| **Trussbars (VM)** | ~392 µs | 10.8× slower | the SAME language, dynamic tree-walk (runtime templates) |
| **Tera** | ~617 µs | **17× slower** | runtime interpreter (Zola's engine) |
| **liquid** | ~2.34 ms | **64× slower** | runtime interpreter (cobalt's engine) |
| **handlebars** | ~2.68 ms | **74× slower** | runtime interpreter (mdBook's engine) |

### teams (small page)

| Engine | Time | vs Trussbars AOT | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~64.8 ns | **0.75×** (≈1.3× faster) | raw Rust + `unsafe` buffer |
| **Trussbars (AOT)** | ~86.9 ns | 1.0× | typed + injection-safe codegen |
| **vy** | ~143 ns | 1.6× slower | compile-time HTML macro DSL |
| `write` | ~219 ns | 2.5× slower | naive hand-written `write!` |
| **Askama** | ~241 ns | 2.8× slower | typed, safe codegen |
| **Trussbars (VM)** | ~824 ns | 9.5× slower | the SAME language, dynamic tree-walk |
| **Tera** | ~2.54 µs | **29× slower** | runtime interpreter (Zola's engine) |
| **handlebars** | ~4.13 µs | **47× slower** | runtime interpreter (mdBook's engine) |
| **liquid** | ~4.23 µs | **49× slower** | runtime interpreter (cobalt's engine) |

## Takeaways

- **Beats Askama on both workloads (~2.8–3.7×)** — best-in-class among the
  *injection-safe* typed engines, from the lean codegen plus the `itoa` /
  `dragonbox_ecma` formatting backends (`dragonbox_ecma` is fast *and*
  ECMA-byte-identical) and `#[inline]` on the runtime hot path (so the per-cell
  `esc` / `ToText` / `Loop::at` calls inline into the host crate without LTO).
- **~17–74× over the dynamic interpreters** (Tera, liquid, handlebars): straight-line
  Rust vs parse-and-walk-an-AST per render. The bulk of the "fast template engine"
  story, by construction, and the headline for the northstar targets — **Tera** is
  Zola's engine (17× / 29× on big-table / teams), **liquid** cobalt's (64× / 49×),
  **handlebars** mdBook's (74× / 47×). Tera is the *fastest* of the three (~4× ahead of
  the other two), so it is the toughest interpreter comparison, and Trussbars still wins
  by an order of magnitude. These are the engines you'd reach for if you needed the
  runtime / user-authored templates the AOT model gives up.
- **Even the VM beats the interpreters.** The Trussbars **VM** (the same language, dynamic
  tree-walk — the runtime/user-authored use case) renders ~**1.6–3.1× faster than Tera**
  and ~5–6× faster than liquid/handlebars. So you get the runtime flexibility of an
  interpreter *and* beat the interpreter you'd otherwise use — with the AOT backend a
  further ~11× below the VM when you can compile.
- **Beats the naive `write!` baseline.** Surprising but well-known (and visible in
  the upstream suite too): `core::fmt` integer formatting plus per-call
  format-argument parsing is slower than emitting `itoa`-class digits and
  `push_str`-ing static literals — which is exactly what Trussbars codegen does.
  So the "obvious" hand-written floor is *not* the ceiling.
- **Within ~1.3–2.1× of Sailfish** — the absolute fastest. Inlining the runtime
  hot path closed big-table from ~2.8× to ~2.1×; the residual gap is Sailfish's
  **`unsafe` buffer** (unchecked writes) and its embedding of arbitrary Rust
  (`<%= expr %>`). Both are exactly the boundaries Trussbars refuses to cross —
  it stays `#![forbid(unsafe_code)]` and lets no data choose code — so closing the
  last ~2× would mean giving up the safety story that is its reason to exist.

## Notes

- The engine setups live in `src/lib.rs` (shared by the bench, the perf gate, and
  the equality test); the Trussbars columns are the **verbatim** output of
  `compileMaxRust`, only the `render` fn header renamed.
- **Two perf changes drove the latest numbers** (both shipped in the engine, not
  the bench): `#[inline]` on the `trussbars-core` hot path — `esc` / `ToText` /
  `escape_html` / `Loop::at` / `Each` — so they inline into the host crate even
  without LTO (the big-table win, ~49→37 µs); and an adaptive per-template
  `SizeHint` (`trussbars_core::SizeHint`, a fn-local `static` the emitter seeds and
  updates with each render's length) so a warm, data-heavy template reallocates at
  most once. The `SizeHint` is semantically inert — the conformance harness stays
  byte-identical.
- Sailfish needs `self.`-qualified fields in its `.stpl`
  (`templates/big-table.stpl`, `templates/teams.stpl`); handlebars and liquid each
  parse/register their template **once**, outside the timed loop (only render is
  measured — and, like handlebars, liquid marshals the `Serialize` context into its
  own `Object` per render, so the dynamic columns are measured on equal footing).
- **Output-equality gate:** `tests/output_equality.rs` asserts every engine emits
  identical bytes for both workloads. Liquid does not auto-escape `{{ }}`, and Tera's
  suffix-gated auto-escape is off for the un-suffixed template names — but the workloads
  carry no HTML-special data, so all outputs match byte-for-byte.
- **Perf-regression gate:** `tests/perf_gate.rs` asserts the machine-independent
  relative invariants (Trussbars ≤ Askama, Trussbars × 5 ≤ handlebars) for both
  workloads, measured in one run so a slow CI box doesn't matter; meaningful only
  in release, so it self-skips in debug. Run both with `cargo +1.96.0 test
  --release --manifest-path trussbars/benchmarks/Cargo.toml`; CI runs them as the
  `benchmarks` job in `trussbars.yml`.
