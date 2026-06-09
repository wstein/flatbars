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

## Pre-v2 gate — CLEARED

1. **Freeze ratified (docs/06).** The v1 surface is frozen — `{{#let}}`, list
   literals, collection filters (`where`/`reject`/`find`/`some`/`every`), and enum
   context types are all IN; `dict` literals + data-enum dispatch are the two
   type-aware items deliberately → v2.
2. **Corpus hardened (56/56).** `ctxgen` synthesizes enums (S4 conformance-gated);
   escaping-heavy + deep-nesting edges added.
3. **v2 decisions resolved (docs/07 §5):** stable-not-nightly, no type-descriptor
   initially, inline `truss!` first.
4. **The parser scoped (docs/08).** Named as v2's dominant task; recommended a
   fresh recursive-descent parser for the Trussbars subset + a port of the desugar
   rules, gated by the corpus.
5. **Host helpers shipped (docs/09).** The F3 convention, built as a *closed
   allow-list*: a declared head (`helpers = […]` / `#[truss_helpers(…)]`) emits a
   typed free-function call, an undeclared one is a located `unknown helper` error
   ("names static" preserved).

## Starting v2 (the build order)

Parser first (docs/08 §6: lexer → expr → blocks+desugar → emit → diagnostics), with
the 56-case corpus as the incremental gate; then the diagnostics (docs/07 §6:
class-A `compile_error!` → `truss!` + `quote_spanned!` → trybuild gate → `path=`);
then the host-helper convention (docs/09). The runtime crates and the emit logic
(`MaxBars/Rust.purs`) are unchanged inputs.

**Keep in mind — inspect/provenance (docs/10).** A Trussbars inspector (StringTemplate4
STViz-style; the FlatBars Lab is the UX blueprint) needs the emitter to support a
**provenance mode** producing output↔template tiling segments (and later a context
snapshot), mirroring the interpreter's ADR-035. So **thread byte-spans through
parse→desugar→emit** (already required for diagnostics) and **design the provenance
emit mode alongside clean/commented from the start** — don't bolt it on. Phase 1
(the source map) is a natural follow-on to the breadcrumb work and Lab-pluggable.

## Reference docs

- `01-subset-spec.md` — the language. `02-runtime-api.md` — the runtime surface
  (incl. `SizeHint`, `no_std`). `04-conformance.md` — the byte-identity harness.
- `05-codegen-optimization.md` — the profiling pass / safe-ceiling decision record.
- `06-feature-freeze.md` — the **ratified** v1 surface v2 targets.
- `07-v2-spike.md` — the diagnostic span-mapping plan (decisions resolved).
- `08-v2-parser.md` — the Rust parser/desugar scoping (v2's dominant task).
- `09-host-helpers.md` — the typed host-helper convention (F3; value + block helpers).
- `10-inspect.md` — the inspector / provenance design (STViz-style; Lab as blueprint).
- `11-vm-backend.md` — the dynamic VM backend (two-backends framing, conformance axes).
- `12-match-multiarm-blocks.md` — **proposed** `{{#match}}…{{when …}}…{{else}}` surface
  sugar (desugars to `Cond`; gated on a use case + MaxBars-spec ratification).
