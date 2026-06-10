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
2. **Corpus hardened (56/56 at freeze; now 71/71 — `conformance/report.json`).** `ctxgen`
   synthesizes enums (S4 conformance-gated); escaping-heavy + deep-nesting edges added. The
   corpus has since grown to 71 cases (dict-nested et al. added during v2); the gate score
   is the committed `report.json`, not this freeze-time milestone.
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
the corpus as the incremental gate (56 cases at v2 start, 71 now); then the diagnostics (docs/07 §6:
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

## Open-ADR triage (2026-06-10)

Snapshot of every open/Draft/Proposed/Postponed ADR across both trees (Trussbars `docs/` + spec
`adr/`) and what closes each. Priority is relative to the product goals (`docs/13` Part I: Trussbars =
production Rust engine; sharpen editors; the **(C) versioned-artifact** path). **Repo-split
implementation is deferred** (user); decision/tracking lives here, not in scratch notes.

| ADR | Status | What closes it | Priority |
| --- | --- | --- | --- |
| **22** `#[derive(Template)]` | **Accepted** (decisions ratified 2026-06-10) | Implement the derive: `render_into` primitive + defaulted `render` + zero-alloc `Display`; full `truss!` clause parity; infallible trait. **Now depends on docs/23** (emit→`fmt::Write`) — build that first | **P1 → ready to build** (after docs/23) |
| **17 / 18 / 19** `{% %}` surface (set·local / capture / statement-tags) | Proposed — *surface frozen* | Oracle-first impl: `statementTags` `LexConfig` knob + `set`/`local`/`capture` in `Kernel.Prelude`; conformance cases; then Trussbars; the §19.6 **atomic cutover** | **P2** — design done; large breaking impl, sequence via docs/19 §6 |
| **03** schema inference (G2) | Draft — *built nowhere* | Finish design + first Rust impl (analyse→report→schema→data scaffold) | **P2/P3** — critical-path for **(C)/Phase-0** (deferred with the split); also a DX win (removes the declare-`T` cost) |
| **01** subset spec → normative | Draft / normative-intent | RFC-2119 grading, conformance levels, self-containment (`docs/13 §5`) | **P3** — part of the **(C)** Phase-0 contract work |
| spec **0027** cross-template scope graph | Proposed — *gated* | Build the scope graph → unlocks `definition`/references/rename | **P3** — editor future; **re-scope under the Rust-LSP direction** (`docs/13 §I.5`) |
| spec **0028** hybrid template LSP | Proposed — *gated* | The HTML+template hybrid LSP | **P3** — editor future; **re-scope under the Rust-LSP direction** |
| **14** typed `{{#match}}` | Postponed | Revive only on a concrete consumer needing compile-time variant coverage | **Parked** |
| **02** runtime-api | Draft (living) | Update as the runtime evolves | **Living** — not an open decision |

**Recommended order to "go further":** status reconciliation (below, done) → **22** (decision) → **17/18/19**
implementation behind the docs/19 §6 cutover → **03 + 01** as the (C)/Phase-0 contract work → **0027/0028**
re-scoped when the editor phase starts. **14** stays parked.

**Status reconciliations (this pass):**

- spec **ADR-0021** (maxbars-variable-model): `Proposed` → **Accepted** (its own text says shipped 2026-06-07; referenced as live throughout CLAUDE.md). ✅ fixed.
- spec **ADR-0026** (editor-capability-matrix): *no status line* — descriptive/settled; stamp `Accepted` on next edit.
- `docs/13` own status is **not** stale (the survey's "Draft" hit was §5 quoting *docs/01*'s header); its Decision was amended to the ratified **(C)**.
- Residual (noted `docs/13 §3`): `docs/08`/`docs/11` still carry freeze-era "56/56"/"64/64" — normalize on next touch.

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
- `12-case-multiarm-blocks.md` — `{{#case}}…{{when …}}…{{else}}` multi-arm conditional: a
  first-class node lowered to a Rust `match` (subject evaluated once), `caseH` in the oracle.
  Implemented in RawBars/MaxBars and Trussbars.
- `13-independence.md` — **decision doc**, now two parts. **Part I (2026-06-10):** ecosystem
  product & repo organization — three products (PureScript *learning platform* / *Trussbars* Rust
  engine / *editors*), product-aligned repo split gated on a versioned-artifact Phase 0, BOM-not-
  submodules umbrella, the editor strategy (IDE = MaxBars/Trussbars only; Rust LSP via a recovering
  parser; tree-sitter reach), and — key — it carries the **RATIFIED** sever decision: **(C) conform-to-
  versioned is the destination** (Trussbars splits but conforms to the platform's versioned spec+corpus;
  live oracle survives), **(A) sever is the escape hatch**. Under (C): G1+G3-deletion are only-if-(A),
  G2/G5/§5-grading required either way. **Part II:** the original (A) oracle-sever playbook, retained.
- `14-typed-match.md` — **proposed** `{{#match SUBJECT "Type"}}` — the typed-exhaustive sibling
  of `{{#case}}`: variant dispatch lowered to a Rust `match` whose exhaustiveness rustc enforces
  (no schema inference needed). Surface-freezing ADR; not yet implemented.
- `15-migration-import.md` — the migration-tool **read half**: foreign-dialect parsers
  (`crates/trussbars-import`; Mustache / Handlebars / Liquid / StringTemplate4). Implemented;
  the lowering to the Trussbars AST is the next deliverable.
- `16-truthiness-modes.md` — **SHIPPED** selectable truthiness policies: `TruthyIn<Mode>` with
  `NonEmpty` (default, conformance-checked), `Liquid`, `Handlebars`, and host-defined policies
  over foreign types; `truss!(…, truthiness = Mode)`. Zero-cost (monomorphized); the
  non-default policies are out of conformance by construction.
- `17-set-local-bindings.md` — **PROPOSED** scope-named bindings: `{% set name = expr %}` (forward,
  current scope, Jinja precedent) + `{% local … %}…{% endlocal %}` (bounded — the renamed block-`let`).
  `let` retired (block-`let` was backwards from convention). Both reuse one binding node + the
  `let`-emit; stricter than Liquid/Jinja (no leak, no loop accumulators). nonEmpty-family; oracle-first.
- `18-capture-blocks.md` — **PROPOSED** `{% capture name %}…{% endcapture %}` — renders its body
  once into a pre-escaped `safe` string and binds it forward (the `{% set %}` scope, docs/17): a
  first-class, pipeable value. The one intentional intermediate buffer (docs/05); `safe` type
  prevents double-escaping. nonEmpty-family surface; oracle-first.
- `19-statement-tags.md` — **PROPOSED** Django-style `{% %}` for control flow + separators +
  statements (RawBars/MaxBars/Trussbars only; ClassicBars/MinBars stay `{{ }}`-only). `{{ }}` becomes
  output-only; a `LexConfig` knob (`statementTags`) re-delimits the **existing** `Block`/`Sep`
  nodes, so engine/desugar/compiler are untouched and rendered bytes are identical. Deletes the
  `{{else}}`/`{{when}}`/`{{elif}}` separator-ambiguity machinery (docs/12 §2); re-spells docs/17/18.
  Breaking — `flatbars migrate` codemod + located rejection of the old `{{#…}}` form.
- `20-numeric-literal-coercion.md` — **DONE** (F2). A numeric literal in operator position emits
  as `trussbars_core::NumLit`, coercing against any numeric field type (`views: i64` works with
  `> 100`) by widening to the f64 model; string ordering untouched, string-vs-number a compile
  error. v2-conformance 71/71, 0 drift.
- `21-cross-file-partials.md` — **DONE** (#4). `truss!(…, partials = [name = "file.truss"])`
  imports partials from other files (shared header/footer, sub-context partials, `{{yield}}`
  layouts), resolved by the inline mechanism. Per-source error spans (`(in partial 'name')`);
  duplicate name = compile error. v2-conformance 71/71, 0 drift.
- `22-derive-template.md` — **PROPOSED** (#5) `#[derive(Template)]` — a struct owns its template
  (`#[template(source|path=…, helpers/truthiness/partials=…)]`), fields are the context; generates
  the `Template` trait (`render`/`render_into`) + `Display`. Reuses the emitter; surface-agnostic.
  Depends on docs/23.
- `23-emit-targets-writer.md` — **PROPOSED** (enabler for docs/22) the emitter targets a generic
  `fmt::Write` (zero-alloc `render_into`) instead of `String`: `esc`/`ToText` → `fmt::Result`,
  uniform `?`, host-block-helper bodies become `Fn() -> Result<String, fmt::Error>`. `truss!`
  stays `String`-only public; SizeHint kept on the `String` path. Atomic; conformance-re-gated.
