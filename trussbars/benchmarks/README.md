# trussbars-benchmarks

Comparative render benchmark across six engines on the **two canonical workloads**
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

The columns: **Trussbars** (verbatim `compileMaxRust` output), **Sailfish** (the
fastest reference), **Askama** (the typed safe peer), the dynamic interpreters
**handlebars** and **liquid** (the latter is the engine the Rust ecosystem reaches
for when templates are runtime/user-authored — the use case Trussbars deliberately
does *not* serve, included so the headline reads "vs. what you'd otherwise use"),
and **`write`** (a naive hand-written `write!` — see the note below).

## Results

Criterion medians on this machine (Rust 1.96, `--release`); reproduce with the
command above.

### big-table (100×100 = 10 000 cells)

| Engine | Time | vs Trussbars | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~17.8 µs | **0.49×** (≈2.0× faster) | raw Rust + `unsafe` buffer — no injection boundary |
| **Trussbars** | ~36.3 µs | 1.0× | typed + injection-safe codegen, `#![forbid(unsafe_code)]` |
| **Askama** | ~129.8 µs | 3.6× slower | typed, safe codegen |
| `write` | ~195.9 µs | 5.4× slower | naive hand-written `write!` |
| **liquid** | ~2.36 ms | **65× slower** | runtime interpreter (the runtime-template engine) |
| **handlebars** | ~2.70 ms | **75× slower** | runtime interpreter |

### teams (small page)

| Engine | Time | vs Trussbars | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~65.9 ns | **0.76×** (≈1.3× faster) | raw Rust + `unsafe` buffer |
| **Trussbars** | ~87.0 ns | 1.0× | typed + injection-safe codegen |
| `write` | ~223.8 ns | 2.6× slower | naive hand-written `write!` |
| **Askama** | ~245.6 ns | 2.8× slower | typed, safe codegen |
| **handlebars** | ~4.20 µs | **48× slower** | runtime interpreter |
| **liquid** | ~4.27 µs | **49× slower** | runtime interpreter (the runtime-template engine) |

## Takeaways

- **Beats Askama on both workloads (~2.8–3.7×)** — best-in-class among the
  *injection-safe* typed engines, from the lean codegen plus the `itoa` /
  `dragonbox_ecma` formatting backends (`dragonbox_ecma` is fast *and*
  ECMA-byte-identical) and `#[inline]` on the runtime hot path (so the per-cell
  `esc` / `ToText` / `Loop::at` calls inline into the host crate without LTO).
- **~48–75× over the dynamic interpreters** (handlebars and liquid): straight-line
  Rust vs parse-and-walk-an-AST per render. The bulk of the "fast template engine"
  story, by construction. **liquid** is the honest comparison here — it is the engine
  you'd reach for if you needed the runtime/user-authored templates Trussbars gives
  up; the order-of-magnitude gap is the price of that flexibility, and the latency
  the compiled model buys back. (On the tiny `teams` page the two interpreters are
  neck-and-neck; on `big-table`'s tight loop liquid pulls slightly ahead of
  handlebars — neither is within reach of compiled output.)
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
- **Output-equality gate:** `tests/output_equality.rs` asserts all six engines
  emit identical bytes for both workloads. Liquid does not auto-escape `{{ }}`, but
  the workloads carry no HTML-special data, so its output matches byte-for-byte.
- **Perf-regression gate:** `tests/perf_gate.rs` asserts the machine-independent
  relative invariants (Trussbars ≤ Askama, Trussbars × 5 ≤ handlebars) for both
  workloads, measured in one run so a slow CI box doesn't matter; meaningful only
  in release, so it self-skips in debug. Run both with `cargo +1.96.0 test
  --release --manifest-path trussbars/benchmarks/Cargo.toml`; CI runs them as the
  `benchmarks` job in `trussbars.yml`.
