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

The columns. The **three Trussbars execution strategies** for the *same* MaxBars language
(docs/11), fastest to slowest: **Trussbars (AOT)** (verbatim `compileMaxRust` output —
compiled straight-line Rust), **Trussbars (VM)** (the **bytecode VM**, `trussbars-vm` — a
flat instruction array run by a borrow-based machine; covers a subset), and **Trussbars
(interpreter)** (the **tree-walk interpreter**, `trussbars-interp` — the always-correct
dynamic backend the VM optimizes against). Then the peers: **Sailfish** and **vy** (the
fastest references — raw-Rust / macro DSLs); **Askama** (the typed safe peer); and the
dynamic interpreters **Tera**, **liquid**, and **handlebars** — the engines the Rust
ecosystem reaches for when templates are runtime / user-authored, and the named incumbents
of the northstar targets (**Tera** is Zola's, **liquid** is cobalt's, **handlebars** is
mdBook's). They are included so the headline reads "vs. what you'd otherwise use," and so
the dynamic columns give the apples-to-apples comparison the AOT column can't. **`write`**
is a naive hand-written `write!` baseline (see the note below).

> **Honesty note (the dynamic columns).** The interpreter's `Template` used to silently run
> the bytecode fast path for the covered subset, so the old single "VM" column was secretly
> *bytecode* — and a tree-walk row measured against it came out tied. That fast path is
> **removed**: `trussbars-interp` is a pure tree-walker, and the two dynamic columns now
> measure what they say. After removing the interpreter's per-cell allocations (one reused
> loop frame + parent node per loop *entry* instead of two heap allocations per iteration —
> big-table dropped from 20 304 allocations per render to 306), the tree-walk is ~2.4×
> faster and now clears Tera; the bytecode VM leads it by ~1.5× (big-table) to ~2.9×
> (teams). The perf gate (`tests/perf_gate.rs`) ratchets the *ordering*
> `AOT ≤ VM ≤ interpreter ≤ handlebars`, not a fixed multiple.

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
| **Askama** | ~136 µs | 3.8× slower | typed, safe codegen |
| `write` | ~198 µs | 5.5× slower | naive hand-written `write!` |
| **Trussbars (VM)** | ~329 µs | 9.2× slower | the SAME language, **bytecode VM** (runtime templates) |
| **Trussbars (interpreter)** | ~502 µs | 14× slower | the SAME language, **tree-walk** (the VM's always-correct fallback; ~1.5× the VM) — now beats Tera |
| **Tera** | ~585 µs | **16× slower** | runtime interpreter (Zola's engine) |
| **liquid** | ~2.35 ms | **65× slower** | runtime interpreter (cobalt's engine) |
| **handlebars** | ~2.67 ms | **74× slower** | runtime interpreter (mdBook's engine) |

### teams (small page)

| Engine | Time | vs Trussbars AOT | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~63.2 ns | **0.72×** (≈1.4× faster) | raw Rust + `unsafe` buffer |
| **Trussbars (AOT)** | ~88.0 ns | 1.0× | typed + injection-safe codegen |
| **vy** | ~137 ns | 1.6× slower | compile-time HTML macro DSL |
| **Askama** | ~242 ns | 2.7× slower | typed, safe codegen |
| `write` | ~233 ns | 2.6× slower | naive hand-written `write!` |
| **Trussbars (VM)** | ~420 ns | 4.6× slower | the SAME language, **bytecode VM** |
| **Trussbars (interpreter)** | ~1.20 µs | 13× slower | the SAME language, **tree-walk** (~2.9× the VM) |
| **Tera** | ~2.50 µs | **28× slower** | runtime interpreter (Zola's engine) |
| **handlebars** | ~4.03 µs | **46× slower** | runtime interpreter (mdBook's engine) |
| **liquid** | ~4.17 µs | **47× slower** | runtime interpreter (cobalt's engine) |

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
- **Both dynamic backends now beat every peer interpreter.** The Trussbars **VM** (the same
  language, bytecode — the runtime/user-authored use case) renders ~**1.8× faster than
  Tera** (the fastest peer interpreter) and ~6–10× faster than liquid/handlebars on
  big-table. The **tree-walk interpreter** — the always-correct backend the VM optimizes
  against and falls back to outside its subset — now also **clears Tera** (~502 µs vs
  ~585 µs on big-table), after its per-cell allocations were removed: one reused loop frame
  + parent-chain node per loop *entry* with interior-mutable iteration fields, instead of
  two heap allocations per iteration (big-table: 20 304 → 306 allocations per render, a
  ~2.4× speed-up). The VM still leads the tree-walk by ~1.5× (big-table) to ~2.9× (teams) —
  flat dispatch and a borrow-based, zero-clone hot loop — but the gap narrowed from the
  original ~3.5× because the interpreter caught up. The lesson is the ordering: compile
  (AOT) when you can; run the VM for dynamic templates in its subset; the tree-walk
  guarantees a correct render for everything else. The perf gate ratchets
  `AOT ≤ VM ≤ interpreter ≤ handlebars`.
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
  the equality test); the Trussbars **AOT** column is the **verbatim** output of
  `compileMaxRust`, only the `render` fn header renamed. The **VM** (`trussbars-vm`) and
  **interpreter** (`trussbars-interp`) columns parse/compile the template **once** outside
  the timed loop (like the dynamic peers) and render a pre-built `Value`, so only the
  render is measured — the apples-to-apples dynamic comparison.
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
  relative invariants for both workloads, measured in one run so a slow CI box doesn't
  matter: Trussbars (AOT) ≤ Askama; Trussbars (AOT) × 5 ≤ handlebars; and the three
  Trussbars backends stay ordered `AOT ≤ VM ≤ interpreter ≤ handlebars` (a fixed VM-vs-
  interpreter multiple is no longer gated — the interpreter's per-cell-allocation fix
  narrowed the VM's lead to ~1.5–2.9×, docs/11 §4). Meaningful only in release, so it
  self-skips in debug. Run both with `cargo +1.96.0 test --release
  --manifest-path trussbars/benchmarks/Cargo.toml`; CI runs them as the `benchmarks` job in
  `trussbars.yml`.
