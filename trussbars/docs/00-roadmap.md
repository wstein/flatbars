# Trussbars — Roadmap

The corrected work list, after the team review. It supersedes the earlier scratch
list; two of those items were wrong-framed and are fixed here.

## Status of the reviewed items

| # | Original item | Verdict | Status |
| --- | --- | --- | --- |
| 1 | Comprehensive example project (blog engine) | Keep — the information generator | **DONE** — `examples/blog/` (3 golden-pinned pages) + a second, differently-shaped dogfood `examples/changelog/` (this repo's own git log → markdown changelog). Together they found F1–F8 (docs/06); the changelog added **F7** (piped/applied condition needs parens) and **F8** (HTML-only escaping) and made the **F3 host-helper requirements** concrete (date/categorise/scope = host precompute). |
| 2 | ~~Profile generated code to find hotspots & optimize~~ | **STRUCK** | **DONE & closed.** Profiling (docs/05) proved the generated code is at the **safe-Rust ceiling** — every variant (frame elision, `Each` removal, `esc` specialization) ties the shipped code; the residual ~2× to Sailfish is its `unsafe` buffer, which we won't adopt. *Survivor:* add an escaping-heavy workload, then *maybe* SIMD-ize `escape_html` — a **runtime-crate** ticket, low priority, blocked on demand. **Not** a codegen task. |
| 3 | `no_std` library option | Keep — bounded | **DONE** — `trussbars-core` is `no_std + alloc`, proven on bare-metal `thumbv7em-none-eabi` (pure *and* perf). Bounded to core; `trussbars-std` stays std until a real embedded user appears. |
| 4 | ~~Make Trussbars a new FlatBars surface~~ | **REFRAMED** | Trussbars **is** MaxBars (the typed subset); `.truss` is a MaxBars extension. There is no 5th dialect. The real item underneath: a **host-binding / schema-declaration affordance** for `.truss` (declare the context type, `no_std`/feature intent) — **not** a parser/dialect. Downstream of #5; lives naturally in the proc-macro. |
| 5 | Migration to the idiomatic Rust macro | Keep — **the spine** | **NEXT, deferred until the freeze is ratified.** Spike done (docs/07). Justification corrected: **diagnostics + deleting the PureScript toolchain**, *not* speed (it buys none — docs/05). |

## Sequencing

```text
blog dogfood ─▶ feature freeze ─▶ v2 proc-macro ─▶ (escaping workload)
  (DONE)          (docs/06,         (span-mapping       (runtime-crate,
                   ratify F4)        first; docs/07)      on demand)
                      │
         no_std core split (DONE, parallel)
```

The ordering principle: **the example reveals the feature set; the freeze pins it;
v2 is built against a settled language, not a moving one.**

## Immediate next actions

1. **Ratify the freeze (docs/06).** One open call: `{{#let}}` (F4) — IN or OUT for v2.
   Collection literals (F5) stay deferred; F1 is wontfix.
2. **Start v2 in this order** (docs/07 §6): Class-A `compile_error!` with
   `path:line:col` first (cheap, biggest relief) → `truss!` with template-path-named
   locals + `quote_spanned!` → the `trybuild` diagnostic gate → the `path=` form.
3. **Defer** the host-binding affordance (reframed #4) and the escaping workload
   until v2 lands and a real need shows.

## Reference docs

- `01-subset-spec.md` — the language. `02-runtime-api.md` — the runtime surface
  (incl. `SizeHint`, `no_std`). `04-conformance.md` — the byte-identity harness.
- `05-codegen-optimization.md` — the profiling pass / safe-ceiling decision record.
- `06-feature-freeze.md` — the frozen v1 surface v2 targets.
- `07-v2-spike.md` — the diagnostic span-mapping plan for v2.
