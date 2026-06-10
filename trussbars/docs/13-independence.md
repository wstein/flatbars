# Trussbars — Project & Repo Organization (and the Trussbars spin-out within it)

> **2026-06-10 expansion (Part I).** This doc began as the Trussbars *oracle-sever* decision
> (§1–§9, below, unchanged). It is broadened here into the **ecosystem's product & repo strategy**,
> because the spin-out is one move inside a larger picture: the work is **three products** (a
> PureScript *learning platform*, the *Trussbars* Rust engine, the *editors*), and how they split
> into repos governs the sever. **Part I** (new) frames that strategy and — importantly —
> **reopened the §1 path-(A) decision** in light of it (a versioned, frozen conformance artifact is
> not the "moving oracle" §1 rejected) and — **RATIFIED 2026-06-10** — resolves it: **(C)
> conform-to-versioned is the destination; (A) sever is the escape hatch** (§I.4). **Part II** is the
> original, team-reviewed deep-dive, retained in full as the **(A) escape-hatch playbook**.

> **Status:** Decision doc / **DECIDED destination, GATED trigger** — *paper first, no
> spin-out commit yet*. **Audience:** whoever pulls the oracle-sever and stands Trussbars
> up as its own project. **Decision (amended by §I.4, 2026-06-10):** the destination is
> **(C) conform-to-versioned** (Trussbars splits but conforms to the platform's versioned
> spec+corpus; the live oracle survives). Path **(A) spec-owning independence** below (own the
> normative spec, freeze the live PureScript oracle, the MaxBars interpreter becomes a
> historical reference) is the **escape hatch** — walked only if Trussbars must diverge from
> MaxBars unilaterally. **Tooling priority:** the **type-aware LSP** and the
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

## Part I — Product & repo organization (2026-06-10)

## I.1 Three products, not one codebase

The work is **three products** with different audiences, vehicles, and success metrics. This is the
frame everything below hangs on:

| Product | Audience | Vehicle | Success metric |
| --- | --- | --- | --- |
| **Learning platform** — the PureScript project (engine + Min/Raw/Classic/Max dialects + spec + tutorials + Lab + conformance + `trussbars-import` foreign parsers) | Learners; people comparing/evaluating template engines | Web (spec/tutorials/Lab) | Clarity, dialect breadth, interactive proof |
| **Trussbars** — the Rust engine | Rust devs shipping production software | crates.io | Perf, type-safety, DX, adoption |
| **Editors** — VS Code + JetBrains (+ later Neovim/Helix/Zed) | Anyone authoring templates in an IDE | Marketplaces / grammar registries | Highlighting / diagnostics / completion quality |

**MaxBars is the language; Trussbars is its flagship implementation** (ECMAScript : V8). The learning
platform *owns the reference/spec* (the oracle); Trussbars is the production engine of that language.
This settles the earlier "rename MaxBars → Trussbars" question: **no** — you do not rename the
language after the engine.

## I.2 Repo map and the split criterion

**Split criterion:** split a component into its own repo **only when it has both (a) an independent
release vehicle and (b) a thin, *versioned* interface to the rest.** Until the interface is thin, the
monorepo is the *better* compatibility guarantee — it certifies a known-good combination on **every
commit**; a split + umbrella certifies only at **bumps**. So split for product/audience/vehicle
divergence (which now exists), never for "compatibility" alone.

| Repo | Contents | Vehicle | Interface | Verdict |
| --- | --- | --- | --- | --- |
| **A — learning platform** | core/kernel/dialects/compile/json/js/cli/linter + spec + tutorials + Lab + conformance + import | Web | Owns the spec/oracle; *publishes* versioned artifacts | **Stays a monorepo** (dense intra-product invariants: `test:compile`, `check:parity`, catalog/tokens/vocab single-sources) |
| **B — Trussbars** | the Rust workspace (`trussbars/`) | crates.io | Conforms to a **versioned** corpus/spec from A | Split — **gated** (see I.3, I.4) |
| **C — editors** | LSP + VS Code + JetBrains + grammars | Marketplaces | Consumes A's **committed artifacts** (bundle, `token-vocabulary.json`, `operations.json`) | Cleanest split (thinnest interface) |

**Umbrella = a thin BOM / conformance repo** (pins versions, runs cross-repo conformance), **not** a
git-submodule source aggregation (submodule pain, two-step commits, lag). Its job is "this combination
is certified compatible," validated by the gates.

## I.3 The prerequisite that unblocks every split — versioned artifacts (Phase 0)

Turn the *implicit* contracts into **published, versioned artifacts**: the conformance corpus, the
catalog, the token vocabulary, the design tokens, the JS bundle. Do this **in-repo, now** — it is the
universal unlock and is valuable even if nothing ever splits:

- It lets **B (Trussbars)** depend on `corpus@vX` instead of the live oracle — independent release
  with a stable contract.
- It lets **C (editors)** split *while being actively sharpened* — engine-side improvements ship as new
  artifact versions; editor-side UX ships independently.
- It makes the oracle↔impl contract **explicit and testable**.

**This is the same work Part II's G1–G5 already describe, viewed from the repo angle.** Part II's
versioned `CASE→CLAUSE` ledger (§5), the `spec-version`+`profile` stamps on `snapshots.json`, and G3
(transcribe the desugar to normative prose) *are* the act of turning the conformance contract into a
versioned artifact. Phase 0 is G1–G5 **minus the final interpreter deletion.**

## I.4 The decision the three-product frame reopens: (A) sever vs (C) conform-to-versioned

Part II §1 chose **(A) full spec-owning independence** and rejected **(B) stay tracking** because (B)
is "a permanent sync tax against a *moving* oracle." That reasoning is sound **for a live oracle** — but
Phase 0 (I.3) removes the premise: a **frozen, versioned** corpus+spec is *not* a moving oracle. That
yields a third option Part II did not isolate:

- **(A) Sever** — Trussbars owns its own normative spec; the interpreter is deleted; relationship to
  FlatBars becomes *lineage, not dependency*. (Part II's existing decision.)
- **(C) Conform-to-versioned** — Trussbars is its own repo/crate, releases independently, and **conforms
  to the learning platform's *versioned, published* spec+corpus** (`spec@vX`/`corpus@vX`), **not** the
  live oracle. The platform keeps spec ownership; the live interpreter survives (in Repo A) to adjudicate
  *new* cases. This is Part II §9's **M1+M2 made the destination, not a way-station.**

**Why the three-product frame now favors (C):**

1. **Trussbars's value proposition *is* provable conformance** — "the production Rust engine that
   provably matches the Handlebars/Mustache/MaxBars reference family." (A) deletes the oracle and throws
   that story away; (C) keeps it as a *feature*.
2. **The learning platform *wants* to own the reference** — owning the normative spec + the live oracle
   is literally its product purpose. (A) forces a *second* normative surface to maintain; (C) keeps one.
3. **(C) eliminates the amputation risk** Part II §8 spends its first bullet on: the live interpreter
   stays in Repo A, so a new construct still has an arbiter. (A)'s one-way door has no fallback.
4. **The "moving oracle" objection dissolves** under Phase 0: Trussbars pins `corpus@vX`; the platform's
   oracle moving to `vX+1` is a *deliberate, reviewed bump*, not a daily sync tax.

**(A) remains the right call only if** Trussbars must evolve its surface **unilaterally / faster than the
platform will bless** — a real but **not-yet-present** need (today Trussbars *is* the typed subset of
MaxBars and wants to stay conformant).

**RATIFIED (2026-06-10): (C) conform-to-versioned is the destination; (A) sever is the escape hatch.**
Trussbars splits to its own repo/crate and conforms to the learning platform's **versioned** `spec@vX`/
`corpus@vX`; the platform keeps spec ownership and the **live oracle survives** in Repo A. (A) is held in
reserve, to be walked **only if** Trussbars's surface must diverge from MaxBars unilaterally. Concretely
this **supersedes Part II §1's "path (A)" destination**: the irreversible **G1 (default cutover with
`MaxBars.Rust.purs` deleted)** and **G3-deletion (delete the `.purs` after transcription)** demote from
*required* to **only-if-(A)**; **G2 (Rust-native inference), G5 (negative/injection parity), and the §5
normative-grading remain required for *either* path** (they are what make the contract a versioned
artifact, which (C) needs too). (C) is Part II §9's **M1+M2 made the destination, not a way-station.**

## I.5 Editor strategy

- **IDE scope = MaxBars/Trussbars only** (user decision). Don't ship IDE support for ClassicBars/MinBars
  — mature Handlebars/Mustache extensions already serve them (don't compete), and the learning dialects
  live in the **Lab** (web highlighting), not the IDE. *Lab = learn all dialects; IDE = author the
  flagship.* Consequence: the ADR-017 TextMate grammar stops being "Handlebars re-skinned for 4 dialects"
  and becomes its own `{% %}`+infix+pipe grammar.
- **Write the LSP in Rust** (`tower-lsp`). It is the *only* path to Trussbars's production diagnostics
  in-editor (AOT type errors, injection-boundary rejections, typed-truthiness — they live in the Rust
  toolchain; the PureScript-bundle LSP cannot produce them). **Prerequisite: make the Rust parser
  *recovering* first** — today it is fail-fast (`parse → Result<Vec<Node>, ParseError>`, bails on the
  first error; `crates/trussbars-template/src/parse.rs:20`). Port ADR-023's model (one recovering parser;
  fail-fast `parse` is its projection; serves both the proc-macro and the LSP). This **supersedes Part II
  §6's "repoint `engine.mjs` at a Rust-WASM export"** plan with a native Rust server.
- **Consolidation:** because the IDE is MaxBars/Trussbars-only and Trussbars parses that surface, **one
  Rust LSP can own the whole IDE** — diagnostic depth scaling with whether a typed context is declared.
  The PureScript-bundle LSP then **retires from the IDE** and remains only as the **Lab's** web engine.
  Caveat: the recovering Rust parser must cover the full MaxBars *grammar* (parse everything) even where
  the AOT can't *compile* it — non-subset constructs become *diagnostics*, not parse failures.
- **Tree-sitter — yes, scoped to `{% %}`/Trussbars, as a reach play (not a 4th casual sync).** It reaches
  a *different* editor family (Neovim/Helix/Zed/Emacs + GitHub web highlighting) that overlaps heavily
  with Rust devs. Subject it to the same anti-drift discipline as TextMate — a `check:treesitter` gate
  asserting its token boundaries agree with the engine `tokenize`; single-source the highlight *queries*
  from `token-vocabulary.json` (the `grammar.js` is hand-written, the same honest boundary TextMate has).
  Own repo `tree-sitter-trussbars`. **Sequence after** sharpening VS Code/JetBrains.

  Editor coverage matrix: VS Code / JetBrains = **TextMate floor + LSP**; Neovim / Helix / Zed / Emacs /
  GitHub = **tree-sitter floor + LSP-where-supported**.

## I.6 Org-level sequence

```text
Phase 0  publish versioned artifacts (corpus/catalog/vocab/tokens/bundle)   ← in-repo, the unlock
   │       (= Part II G1–G5 minus the interpreter deletion)
   ├─▶ ratify (C) vs (A)  ── I.4, user decision
   │
   ├─▶ Phase 1  split EDITORS (Repo C) — thinnest interface, serves "sharpen the plugins"
   │              · sharpen VS Code/JetBrains (TextMate + LSP) FIRST
   │              · make the Rust parser RECOVERING (ADR-023 port)   ← unlocks the Rust LSP
   │              · Rust LSP (tower-lsp) owns the IDE; PS LSP → Lab only
   │              · tree-sitter-trussbars (reach)
   │
   ├─▶ Phase 2  split TRUSSBARS (Repo B) → crates.io, conforming to corpus@vX
   │              · if (C): keep the live oracle in Repo A; no sever
   │              · if (A): then and only then walk Part II's G1+G3-deletion one-way door
   │
   └─▶ Repo A (learning platform) stays the home monorepo; publishes the artifacts the others pin
```

---

## Part II — The Trussbars oracle-sever (original team-reviewed deep-dive)

> §1–§9 below are unchanged from the pre-expansion doc. **Per the ratified §I.4, (C) conform-to-
> versioned is the destination and (A) sever is the escape hatch** — so read §1's "path (A) … DECIDED"
> as **the escape-hatch playbook**, walked only if Trussbars must diverge from MaxBars unilaterally.
> Under (C): **G1 (default cutover deleting `MaxBars.Rust.purs`) and G3-deletion are only-if-(A)**;
> **G2 (Rust-native inference), G5 (negative/injection parity), and §5 normative-grading are required
> either way** (they make the contract a versioned artifact, which (C) also needs). The severability
> audit (§2), corrections (§3), normative requirements (§5), and failure modes (§8) stand for both.

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
against a *moving* oracle — `ClassicBars/Surface.purs` was edited **2026-06-09, hours after**
the v2 Rust parser landed 2026-06-08. Independence and oracle-tracking are mutually
exclusive; (A) is the only coherent reading of the goal.

## 2. What is already severable — and what is not

Verified against the repo (team review, ground-truth pass):

| Boundary | State | Evidence |
| --- | --- | --- |
| **Rust workspace** | **Clean.** No path dep escapes `trussbars/`; 7 crates; MSRV 1.96 / edition 2024 pinned in both `Cargo.toml` and `rust-toolchain.toml`. | every `crates/*/Cargo.toml` path dep targets a sibling |
| **Oracle (correctness)** | **Attached.** Harness imports `renderMaxbars` from `output/ClassicBars.JS`; runs the interpreter **live** per case; `snapshots.json` is a drift-detector both the live oracle *and* the Rust output are checked against. | `harness.mjs:36,249`; `docs/04 §12 Q2` |
| **Default emitter** | **Attached.** `--v2` is opt-in; the **default** path still emits via `compileMaxRust` = the PureScript `MaxBars.Rust.purs`, which still exists. | `harness.mjs:215,257`; `packages/maxbars/src/MaxBars/Rust.purs` |
| **Desugar source-of-truth** | **Attached (by reference).** The Rust port re-derived the *rules*; `parse.rs`/`parse_expr.rs` cite `ClassicBars/Surface.purs` + `MaxBars/Expr.purs`/`FlatBars.Lexer` as the authority. Those modules remain the spec. | `docs/08:66`; `parse_expr.rs:1-8` |
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
4. **The spec drifted from its own gate** (now reconciled — see G4). At review time the
   `docs/04` header claimed "16/16", `docs/00` said "56/56", the gate said "65/65". A
   project that cannot keep one counter synced inside the monorepo cannot defend two
   normative surfaces — so this was fixed first: `docs/04` + `docs/00` now read **71/71**
   against `report.json` (reconciled to 65/65 at review time; re-synced as the corpus grew
   to 71). *Residual:* `docs/08`/`docs/11` still carry "56/56"/"64/64" in
   historical/design context (56 was true at freeze) — normalize when those docs are next
   touched.

## 4. Preconditions for the irreversible step (the real enabling event)

The oracle-sever is a **one-way door.** After it, `snapshots.json` is the contract, the
interpreter is gone, and any semantic question a frozen case doesn't cover has **no live
arbiter.** These gates must ALL be green *while the live oracle still exists to catch a
divergence* — the last act before deletion:

- **G1 — Default cutover.** Flip the default emitter to v2 (procmacro), delete the
  opt-in `--v2` split, and re-prove **71/71 with `MaxBars.Rust.purs` deleted**, so a
  v2-only regression is caught by the *live* PureScript oracle, not by a frozen photograph
  of it. (`docs/04 §10`.)
- **G2 — Schema inference, Rust-native.** Port `docs/03` L1+L2 into Rust so the harness's
  `Ctx` generation runs without `ctxgen.mjs`/spago. This is on the critical path: until it
  exists the harness is *not* oracle-free regardless of what else is done.
- **G3 — Desugar transcribed to normative prose.** Lift the rules out of
  `ClassicBars/Surface.purs` + `MaxBars/Expr.purs` into a self-contained grammar section of
  the spec (§5), **byte-checked against the still-live oracle** as the acceptance gate,
  *before* those `.purs` modules are deleted. This is the single highest-risk step and it
  needs its own gate, not a comment.
- **G4 — Counter reconciliation. ✅ DONE (2026-06-09; re-synced 2026-06-10 as the corpus
  grew 65→71).** `docs/04` header, `docs/00` roadmap, and `report.json` now agree on
  **71/71, 0 excluded, 0 oracle drift** (`report.json` is the single source). No promotion
  of a spec that contradicts its own gate. *Residual:*
  `docs/08`/`docs/11` carry the freeze-era "56/56"/"64/64" in historical context — normalize
  on next edit; not a live status contradiction.
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
| **Migration tool** *(priority)* | **A port, not net-new** — *for the cross-MaxBars-dialect half.* `packages/linter/src/Linter/{Lower,Migrate,Aliases,Print}.purs` already implements cross-dialect lowering + migration; `check:tutorial-tooling` gates it. The **foreign-engine half** (Mustache/Handlebars/Liquid/StringTemplate4 → `.truss`) has no PureScript precedent. **Read half SHIPPED** — `crates/trussbars-import` parses all four foreign dialects to faithful, byte-spanned ASTs (`docs/15`). | Port the cross-dialect rewrite to Rust; conformance-test the Rust output against the PureScript reference *while it still exists*. The idiom linter shares this one suggestion/rewrite engine. Its "this is AOT-compatible" verdict loses the `--vm-compat` PS cross-check on severance (`harness.mjs:151`) — needs a Rust-native replacement. **Next on the foreign half:** the lowering `trussbars-import` AST → `trussbars-template::ast` (`docs/15 §6`). |
| Compiler diagnostics | class-A `compile_error!` shipped (`docs/07/08`); the **`trybuild` UI-snapshot gate now exists** (`crates/trussbars-macros/tests/ui`) and pins located text+span for parse-, resolution-, and **all three injection-class** constructs (computed partial §4.1, `apply` §4.2, computed lookup §4.3). Conformance (the separate `report.json` gate) is 71/71 positive byte-match. | **Broaden the corpus** toward the remaining owned-error vocabulary (arity, dict-literal, loop-metadata) as the message set settles; consider an `insta` overlay if richer snapshots are wanted. The injection boundary — the security headline — is now a *tested* contract, not prose. Once external crates depend on Trussbars these messages are public API; the net is in place. |
| `dragonbox_ecma` float formatting | the load-bearing semantic that makes byte-identity work (chosen to match JS `String(n)`). | Pin as a **named, separately-tested frozen invariant** — one regression breaks every conformance case at once. |
| crates.io publish | `0.1.0`, unpublished. | **The single highest adoption lever for a Rust library; do it early, not last.** A typed compiler nobody can `cargo add` is not independent in any practical sense. |

**Minimum-credible cut line** (independence is honest at this point; the rest is polish):
crates.io publish of derive-macro + core · a golden diagnostics corpus · a quickstart doc ·
`trussbars infer` (L2 schema scaffold). The full LSP and migration tool are post-credibility
polish gated by conformance against the PureScript reference — they lead the *post-severance*
build-out, but they do not gate the declaration.

## 7. Sequence

```text
G4 reconcile counters ─▶ G1 default-cutover (delete MaxBars.Rust.purs, re-prove 71/71)
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
