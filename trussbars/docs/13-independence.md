# Trussbars — Spin-Out to an Independent Project (spec-owning)

> **Status:** Decision doc / **DECIDED destination, GATED trigger** — *paper first, no
> spin-out commit yet*. **Audience:** whoever pulls the oracle-sever and stands Trussbars
> up as its own project. **Decision:** path **(A) spec-owning independence** (own the
> normative spec, freeze the live PureScript oracle, the MaxBars interpreter becomes a
> historical reference). **Tooling priority:** the **type-aware LSP** and the
> **Mustache/Handlebars→`.truss` migration tool** lead the post-severance build-out.
> **Companion docs:** amends `docs/00` (roadmap), `docs/01` (the subset spec → becomes
> the normative spec), `docs/04` (conformance — the oracle this severs), `docs/08` (the
> v2 front-end whose default-cutover is a precondition), and `docs/03` (schema inference —
> the critical-path blocker).
>
> **This doc is the product of a team review** (six repo-grounded fact-checks + four
> independent critique lenses). Its central correction: the decision (A) is sound, but
> the proposal's stated *enabling event* — "the v2 cutover, complete and green" — **is
> not the real trigger and is not yet met.** The irreversible step is gated behind
> preconditions §4 enumerates, all verified unmet as of 2026-06-09.

## 1. The decision

Trussbars spins out as **its own project with its own normative spec** (path A). It stops
being "the statically-typed subset of MaxBars adjudicated by the PureScript interpreter"
and becomes **"a statically-typed Handlebars/Mustache-family template compiler"** whose
correctness is defined by its own spec + conformance corpus. The relationship to FlatBars
becomes **lineage, not dependency.**

Why (A) and not (B) "stay tracking": `docs/01` literally defines Trussbars as *the subset
of MaxBars*, and the harness defines *correct* as *byte-identical to `renderMaxbars`*
(`conformance/harness.mjs:36,249`). You cannot ship an "independent project" whose
definition of correct lives in another repo's build output. (B) is a permanent sync tax
against a *moving* oracle — `FullBars/Surface.purs` was edited **2026-06-09, hours after**
the v2 Rust parser landed 2026-06-08. Independence and oracle-tracking are mutually
exclusive; (A) is the only coherent reading of the goal.

## 2. What is already severable — and what is not

Verified against the repo (team review, ground-truth pass):

| Boundary | State | Evidence |
| --- | --- | --- |
| **Rust workspace** | **Clean.** No path dep escapes `trussbars/`; 7 crates; MSRV 1.96 / edition 2024 pinned in both `Cargo.toml` and `rust-toolchain.toml`. | every `crates/*/Cargo.toml` path dep targets a sibling |
| **Oracle (correctness)** | **Attached.** Harness imports `renderMaxbars` from `output/FullBars.JS`; runs the interpreter **live** per case; `snapshots.json` is a drift-detector both the live oracle *and* the Rust output are checked against. | `harness.mjs:36,249`; `docs/04 §12 Q2` |
| **Default emitter** | **Attached.** `--v2` is opt-in; the **default** path still emits via `compileMaxRust` = the PureScript `MaxBars.Rust.purs`, which still exists. | `harness.mjs:215,257`; `packages/maxbars/src/MaxBars/Rust.purs` |
| **Desugar source-of-truth** | **Attached (by reference).** The Rust port re-derived the *rules*; `parse.rs`/`parse_expr.rs` cite `FullBars/Surface.purs` + `MaxBars/Expr.purs`/`FlatBars.Lexer` as the authority. Those modules remain the spec. | `docs/08:66`; `parse_expr.rs:1-8` |
| **Schema inference** | **Designed-only, built nowhere.** `docs/03` is `Status: Draft`; the designed L1 (`schemaScaffold`/`dataScaffold` atop `Kernel.Analyse`) exists in **no language** — only a JS data-only `ctxgen.mjs`. It is on the harness's **critical path** (per-case `Ctx` generation). | `docs/03:3`; `ctxgen.mjs`; `harness.mjs:267` |
| **Editor / LSP** | **Attached.** `.truss` is a pure `maxbars` alias → shared `source.flatbars` grammar; nothing type-aware. The LSP's value flows through the committed `lab/vendor/flatbars-engine.mjs` PureScript bundle. | `editors/shared/sync.mjs:67`; `editors/lsp/src/tokens.mjs:71` |

**The code boundary is clean; the *governance* boundary (oracle + spec authority +
default emitter + the inference the harness needs) is not.** Spin-out is those four
severances plus owning the spec — not a directory move.

## 3. Corrections the review forced (do not carry the proposal's claims forward)

1. **"v2 cutover complete + green" is false as a trigger.** v2 is opt-in; the default
   emitter is still PureScript. The cutover (`docs/04 §10`) requires the default flipped
   to procmacro-v2 with **zero `report.json` deltas** — that flip has not happened.
2. **The score is 65/65, not 64/64** (`report.json`, commit `f1a5d29a`). Minor, but it is
   evidence the proposal's numbers are stale.
3. **Schema inference is a *first implementation*, not a port.** There is no reference
   implementation to differentially test against. It is strictly larger and riskier than
   "sneaky-large but designed" — and the harness cannot run oracle-free until it exists.
4. **The spec already drifts from its own gate.** `docs/04` header still claims "16/16",
   `docs/00` says "56/56", the gate says "65/65". A project that cannot keep one counter
   synced inside the monorepo cannot yet defend two normative surfaces. **Fix this first.**

## 4. Preconditions for the irreversible step (the real enabling event)

The oracle-sever is a **one-way door.** After it, `snapshots.json` is the contract, the
interpreter is gone, and any semantic question a frozen case doesn't cover has **no live
arbiter.** These gates must ALL be green *while the live oracle still exists to catch a
divergence* — the last act before deletion:

- **G1 — Default cutover.** Flip the default emitter to v2 (procmacro), delete the
  opt-in `--v2` split, and re-prove **65/65 with `MaxBars.Rust.purs` deleted**, so a
  v2-only regression is caught by the *live* PureScript oracle, not by a frozen photograph
  of it. (`docs/04 §10`.)
- **G2 — Schema inference, Rust-native.** Port `docs/03` L1+L2 into Rust so the harness's
  `Ctx` generation runs without `ctxgen.mjs`/spago. This is on the critical path: until it
  exists the harness is *not* oracle-free regardless of what else is done.
- **G3 — Desugar transcribed to normative prose.** Lift the rules out of
  `FullBars/Surface.purs` + `MaxBars/Expr.purs` into a self-contained grammar section of
  the spec (§5), **byte-checked against the still-live oracle** as the acceptance gate,
  *before* those `.purs` modules are deleted. This is the single highest-risk step and it
  needs its own gate, not a comment.
- **G4 — Counter reconciliation.** `docs/04` header, `docs/00` roadmap, and `report.json`
  agree on one number. No promotion of a spec that contradicts its own gate.
- **G5 — Negative/injection parity.** v2 holds the `--compat-parity 71/71` and the
  reject/injection-boundary classes (`docs/04 §2` buckets) that the JS gate never tested,
  so severing-with-v2 does not strand the rejection contract.

Only when G1–G5 are green is the oracle safe to cut. **The v2 spike is not the trigger; G2
(inference Rust-native, harness green without `spago build`) is.**

## 5. What "normative" requires (promotion is a rewrite, not a status-line edit)

`docs/01` is headed `Status: Draft / normative-intent`. "Normative-intent" is a posture,
not a contract. To become the spec it must add what it lacks:

- **RFC-2119 graded language** (MUST/SHOULD/MAY) replacing prose "is a compile error".
- **Conformance levels.** Declare the §5.1 missing-key, §5.3 numeric-truthiness, and the
  §10 `ecma-float` profile split as **core-conformance** (a Trussbars-conformant compiler
  MUST reject) vs. **profile-conditional** (what "byte-identical" means depends on the
  float profile). Today "conformant" silently means "the data-derived-name-free subset on
  ecma-float" — asserted, not graded.
- **Self-containment.** No load-bearing clause may delegate to a FlatBars ADR
  (`ADR-021`/`ADR-022`) or a `.purs` file. The desugar grammar (G3) lives *in* the spec.
- **The frozen contract is the versioned CASE→CLAUSE ledger**, not the raw `snapshots.json`
  bytes. Each corpus case is tagged with the spec clause it witnesses and a spec-revision
  stamp; add `spec-version` + `profile` fields to `snapshots.json`. Otherwise the first
  `ecma-float` edge or rustc-stderr drift forces a "spec change" to fix a snapshot refresh.
- **A named errata owner + process.** Post-sever there is no MaxBars consensus to defer to.
  A versioned `ERRATA`/`CHANGELOG`, the rule that **spec edits and corpus edits land
  together**, and the rule that a new construct requires a **hand-authored expected-output
  + rationale** (since no oracle can adjudicate it). This is the mechanism that prevents
  the half-built stranding; the proposal lacked it entirely.

## 6. Tooling ledger — priority: type-aware LSP + migration tool

The language is done *modulo §3/§4*; tooling is ~30%. The two prioritized items, re-sized
by the review:

| Capability | Reality | Build note |
| --- | --- | --- |
| **Type-aware LSP** *(priority)* | **Additive overlay, not greenfield.** `editors/lsp/src/server.mjs` already ships semantic tokens, hover, completion, code-actions, folding, documentSymbol, formatting, ADR-023 diagnostics, all via one engine seam (`engine.mjs`). | **Repoint `engine.mjs` at a Rust-WASM `tokenize`+`diagnostics` export**, then overlay schema/type diagnostics + `Ctx`-aware completion + hover-types. Keep `server.mjs`, the vocabulary, the `operations.json` projection. Prerequisite: the Rust core must expose lexer/parser/diagnostics as a **library API** *before* any editor work — an earlier, separate deliverable the proposal buried inside "step 3". |
| **Migration tool** *(priority)* | **A port, not net-new.** `packages/linter/src/Linter/{Lower,Migrate,Aliases,Print}.purs` already implements cross-dialect lowering + migration; `check:tutorial-tooling` gates it. | Port to Rust; conformance-test the Rust output against the PureScript reference *while it still exists*. The idiom linter shares this one suggestion/rewrite engine. Its "this is AOT-compatible" verdict loses the `--vm-compat` PS cross-check on severance (`harness.mjs:151`) — needs a Rust-native replacement. |
| Compiler diagnostics | class-A `compile_error!` shipped (`docs/07/08`) — but **no message/span stability gate exists**; all 65 cases are *positive* byte-match. | **Add a trybuild/insta UI-snapshot gate** for class-A text+span *before* "language DONE" is credible. Once external crates depend on Trussbars, error messages are a public API with no regression net. **This is the cheapest, highest-leverage adoption work and the proposal omitted it.** |
| `dragonbox_ecma` float formatting | the load-bearing semantic that makes byte-identity work (chosen to match JS `String(n)`). | Pin as a **named, separately-tested frozen invariant** — one regression breaks every conformance case at once. |
| crates.io publish | `0.1.0`, unpublished. | **The single highest adoption lever for a Rust library; do it early, not last.** A typed compiler nobody can `cargo add` is not independent in any practical sense. |

**Minimum-credible cut line** (independence is honest at this point; the rest is polish):
crates.io publish of derive-macro + core · a golden diagnostics corpus · a quickstart doc ·
`trussbars infer` (L2 schema scaffold). The full LSP and migration tool are post-credibility
polish gated by conformance against the PureScript reference — they lead the *post-severance*
build-out, but they do not gate the declaration.

## 7. Sequence

```text
G4 reconcile counters ─▶ G1 default-cutover (delete MaxBars.Rust.purs, re-prove 65/65)
        │                        │
        │                G2 schema inference → Rust  ─────────┐  (critical path)
        │                        │                            │
        └────────────────────────┴─▶ G3 transcribe desugar normative (oracle byte-checks)
                                                  │
                                          G5 negative/injection parity
                                                  │
                                   ┌──────────────┴───────────────┐
                                   ▼                               ▼
                       §5 promote docs/01 normative        crates.io + diagnostics
                       (RFC-2119, levels, ledger,           golden corpus + quickstart
                        errata owner)                       + `trussbars infer`  ← credible here
                                   │                               │
                                   └───────────────┬───────────────┘
                                       SEVER THE ORACLE  ← one-way door, only now
                                                   │
                          type-aware LSP (overlay)  +  migration tool (port packages/linter)
                                                   │
                                  spec site · CLI · playground · packaging polish
```

## 8. Risks & the failure mode this sequencing avoids

- **The amputation.** Sever before G2 and the harness cannot run oracle-free; freeze
  `snapshots.json` against a deleted interpreter and you can never validate a *new*
  construct. Named failure: *"language done, tooling 30%, oracle amputated"* — independent
  in name, unable to adjudicate anything the frozen corpus doesn't already cover, with no
  fallback to the interpreter just retired. G1–G5 + the §5 errata rule exist to prevent
  exactly this.
- **Self-referential snapshots.** `snapshots.json` is *generated by the PS oracle* under the
  `ecma-float`/dragonbox profile. Freezing it photographs PS MaxBars's behavior (float
  quirks included), not an independent semantics. After severance the Rust engine is
  "conformant to a photograph"; G3's transcription + §5's graded clauses are what convert
  the photo into a defensible spec.
- **Inherited divergences become yours to defend.** §5.1/§5.3 and the v2 additions (dict
  literals, data-enum dispatch) have no MaxBars consensus to defer to once severed — hence
  the §5 conformance-level grading and a written defense-of-divergence policy.
- **MSRV 1.96 + edition 2024 as a consumer floor** is aggressive for broad adoption; state
  it as a deliberate floor in the README and add an MSRV CI note.
- **Identity at the editor layer.** "Lineage not dependency" is violated exactly where the
  proposal spends a bullet: `.truss → maxbars/source.flatbars` is a live cross-project
  dependency. Independence requires Trussbars ship its **own** grammar/extension (or remain
  editor-dependent on FlatBars and say so).

## 9. Reversible fallbacks considered (and why the gates, not the door, are the work)

Two middle paths capture most of the user-facing benefit at zero divergence cost and are
fully reversible; both are **subsumed** by doing G1–G5 *before* the door:

- **M1 — publish from inside the monorepo.** crates.io artifacts + a spec *site* + `.truss`
  tooling, keeping the live oracle and PS desugar spec, declaring no independence.
- **M2 — promote the spec, keep the home.** Make `docs/01` normative and document the
  desugar normative, but keep the monorepo home and the live oracle as a *second*
  cross-check rather than severing.

The decision is (A), so the door **will** be walked — but G1–G5 *are* M1+M2 done in order.
Everything valuable and reversible happens before the irreversible step; the sever is the
last, smallest act, not the first.
