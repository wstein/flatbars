# Trussbars — Codegen Optimization: Profiling Pass & v2 Catalog

> **Status:** Decision record · **Audience:** the v1 `rustEmit` backend and the v2
> proc-macro. **TL;DR: the emitted code is already at the safe-Rust ceiling for the
> hot path; the residual gap to Sailfish is its `unsafe` buffer, which Trussbars
> will not adopt. Do not invest further in codegen-shape optimization — migrate to
> v2 for maintainability and features, not speed.**

## Why this pass, and why now

Before migrating the emitter from the v1 PureScript string-builder to the v2 Rust
proc-macro, we wanted to know which performance work is *portable* (the shared
runtime crates, and the codegen *strategy* both emitters share) versus *throwaway*
(the v1 string-builder itself). The question that triggered this: "is now the time
to profile/optimize the generated code before the v2 migration?" This pass answers
it with measurements.

## Method (and why not a flamegraph)

On macOS a no-sudo sampling flamegraph isn't available — `dtrace`/`xctrace` need
SIP entitlements. More importantly, a flamegraph of an obvious tight loop
(`push_str` + `itoa`, 10 000 cells) would mostly confirm the obvious. The sharper
tool is **differential A/B micro-benchmarks**: take the shipped emitted code and
remove exactly one construct at a time, so each delta attributes cost to one
decision. This is reproducible and committed as
`trussbars/benchmarks/benches/codegen_variants.rs`:

```sh
cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml --bench codegen_variants
```

All variants assert byte-identical output before timing.

## Results (big-table, 100×100; Apple M2 Pro, Rust 1.96 `--release`)

| Variant | Median | Removes vs shipped | Reading |
| --- | --- | --- | --- |
| **B0** shipped | ~39 µs | — (Each + per-cell `Loop::at` + `esc(&&i64)`) | the baseline |
| **VA** no loop frame | ~39 µs | the unused per-cell `Loop::at` | **no change** |
| **VB** direct write | ~40 µs | `esc(&&i64)` → `(&i64).write_text` | **no change** |
| **VE** specialized | ~40 µs | `Each` → native slice iteration (Sailfish's shape) | **no change** |
| *Sailfish* (ref) | ~18 µs | — (`unsafe` unchecked buffer) | the unsafe floor |

The four safe-Rust variants are **all within measurement noise of each other**
(~38–42 µs, fully overlapping CIs). The machine was not perfectly quiet, but that
only weakens claims of *difference* — and we are claiming *no* difference, which a
large real delta would have punched through. None did.

## Findings

1. **The unused `Loop::at` is free (LLVM DCEs it).** `{% for %}` bodies that never
   reference `loop` still emit `let __l = Loop::at(...)`, but VA (frame removed) ties
   B0. The `__`-prefixed unused binding is dead-code-eliminated. → **No emitter
   change needed**; a "skip the frame when `loop` is unused" pass would add emitter
   complexity for zero runtime gain.
2. **`esc` on integers costs nothing.** For an integer `write_escaped == write_text`
   (no escapable bytes), and the generic `esc` + the `&&i64` double-ref inline away:
   VB ties B0. → The escape path is already a no-op for non-escapable types; no v2
   type-specialization needed here.
3. **`Each` is genuinely zero-cost.** VE (native slice iteration, no trait) ties B0,
   confirming the `Each` abstraction compiles to the same machine code as a raw
   `for`. → Keep `Each`; it buys Vec/Map uniformity for free.
4. **VE is the safe-Rust ceiling — and Trussbars already emits it.** The
   hand-written ideal (no `Each`, no frame, direct write — i.e. Sailfish's exact
   shape, in safe Rust) is **~40 µs, still ~2.2× Sailfish's ~18 µs**. So the gap is
   **not** codegen shape. It is the buffer: `String::push_str` does a bounds/capacity
   check per append; Sailfish's `Buffer` does unchecked `unsafe` writes after a
   single reserve. The `#[inline]` + `SizeHint` work (commit f7e2f2d) already took
   B0 from ~50 µs to the ~40 µs safe floor.

## Conclusion

**The generated code is at the safe-Rust performance ceiling for the hot path.** No
codegen-strategy change — loop-frame elision, `Each` removal, `esc` specialization,
buffer-type swap — yields a measurable win, because inlining + LLVM already collapse
the abstractions to the ideal. The remaining ~2× to Sailfish is exactly the two
boundaries Trussbars exists to refuse:

- **`unsafe` unchecked buffer writes** — Trussbars is `#![forbid(unsafe_code)]`.
- **embedded raw Rust** (`<%= expr %>`) — Trussbars lets no data choose code.

Closing the last 2× would mean giving up the safety story that is the project's
reason to exist. So the honest stop is: **best-in-class among safe, injection-safe
engines (3.7× Askama, 73× handlebars), ~2× from the unsafe absolute.**

## Optimization catalog (tagged for disposition)

| # | Idea | Disposition |
| --- | --- | --- |
| 1 | Elide `Loop::at` when `loop`/`outer` unused in the body | **Won't do** — measured zero-cost (LLVM DCE); pure emitter complexity. |
| 2 | Emit `write_text` directly instead of `esc` for provably-non-escapable types | **Won't do (perf)** — measured zero-cost. (May still be worth it in v2 *only* if it simplifies the emitter, not for speed.) |
| 3 | Replace `Each`/`Loop` traits with monomorphic native iteration | **Won't do** — `Each` is zero-cost; the traits buy Vec/Map uniformity and `loop.*`. |
| 4 | Coalesce adjacent static literals into one `push_str` | **v2, low priority** — not applicable to big-table's hot loop (value always sits between literals); helps only literal-dense templates, and the proc-macro can const-concat at expansion time for free. |
| 5 | `unsafe` unchecked buffer (à la Sailfish `Buffer`) | **Rejected — permanent.** Violates `#![forbid(unsafe_code)]`; it is the boundary, not an optimization to take. |
| 6 | Data-aware capacity (sum of runtime collection lengths) instead of the adaptive `SizeHint` | **Won't do** — `SizeHint` already makes a warm template realloc-free; reallocs measured at <2% here. |
| 7 | `SIMD`/`memchr` HTML escaping | **v2 candidate, runtime-crate** — only helps escaping-heavy text (not big-table); would live in `trussbars-core::escape_html`, shared by both emitters. Gate behind a feature like the other backends. Revisit if an escaping-heavy workload shows it. |

Only #7 is a live perf lever, it is a *runtime-crate* change (portable, not emitter
work), and it targets a workload we don't yet benchmark. Everything emitter-shaped
is settled.

## Recommendation on sequencing

- **Runtime crates** (`trussbars-core`/`std`): already optimized to the safe ceiling
  for the measured workloads. Further work only on evidence (e.g. add an
  escaping-heavy workload, then reconsider #7). Portable to v2 regardless.
- **Codegen strategy:** settled by this pass — nothing to carry but this document.
- **v1 emitter implementation:** do **not** polish it; it is the throwaway bridge.
- **Migrate to v2** for the reasons that actually motivate it — a single-language
  toolchain, type-aware diagnostics at macro-expansion, and feature headroom — **not**
  for speed, which is already maxed for safe Rust.

## Cross-check: vy (2026-06)

vy 0.2 was added to the suite (`trussbars/benchmarks`). It renders big-table in ~20µs
vs our AOT's ~50µs — but an A/B (`tests/vy_ab.rs`) attributes the **entire** gap to
vy's `unsafe` raw-pointer buffer (`itoap::write_to_ptr` + `String::from_raw_parts`, no
bounds checks). A maximally-optimized **safe** variant (exact size pre-pass +
plain-slice iteration) measured *slower* than the shipping code (62µs vs 54µs),
empirically confirming **#5** (the `unsafe` buffer is the boundary, not an optimization
to take) and **#6** (the adaptive `SizeHint` already beats a data-aware exact pre-pass
when warm — the pre-pass is pure overhead). vy is an `unsafe`-buffer engine like
Sailfish; **the safe-Rust ceiling holds**, and the gap is not closeable without crossing
the boundary Trussbars exists to keep.
