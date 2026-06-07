# Trussbars — Conformance Harness (cross-language: interpreter ≡ emitted Rust)

> **Status:** Draft / design · **Depends on:** `01-subset-spec.md` (§11 conformance posture),
> `02-runtime-api.md`, `03-schema-inference.md` (per-case schema generation).
> **Models on:** the existing JS gate `packages/compile/conformance.mjs` (interpreter ≡
> compiled-JS, byte-identical, 338 cases) and the committed-`report.json` discipline of
> `gen:hbs-conformance` / `gen:mustache-conformance`.

Trussbars has **no interpreter** — so it has no in-language oracle. The PureScript MaxBars
**interpreter is the oracle**; the harness renders the same template+data through it and
through the **emitted Rust**, and asserts equal bytes on the admissible subset. This document
is how. It is also the **gate that governs the v2 cutover** (§10).

---

## 1. The oracle, and why this is harder than the JS gate

The existing gate (`packages/compile/conformance.mjs`) compares two *JavaScript* paths — the
interpreter and the compiled JS — in one process. Trussbars adds four difficulties:

1. **It crosses languages.** The candidate output comes from Rust that must be *compiled and
   run*, not called in-process.
2. **It needs a per-case schema.** `01` §8 requires a declared context type; each case must
   get a generated `Ctx` (Rust struct) so `rustc` can check the emitted accesses and serde
   can deserialize the data.
3. **It has negative cases.** Spec §4/§5 say some MaxBars constructs are *rejected* (compile
   error), not rendered. Conformance must assert those **fail to compile**, with the right
   diagnostic — a kind of case the JS gate never had.
4. **f64 stringification is out of scope** (`01` §10). The byte diff must **normalize
   numerics** and *track* what it masked.

The oracle is the interpreter (`renderMaxbars`). The proven-equal compiled-JS path is a free
**cross-check** (since `test:compile` already gates interpreter ≡ compiled-JS, any disagreement
between Rust and the interpreter can be triangulated against JS to localize the bug).

---

## 2. Case taxonomy

Every corpus case is classified (statically, from the template) into exactly one bucket. The
classifier *is* the spec's admissibility rule (`01` §3) made executable.

| Bucket | Definition | Harness action |
| --- | --- | --- |
| **positive-admissible** | data-derived-name-free, no bare-number condition, data fits a schema | emit → compile → run → **byte-match** vs oracle (§4) |
| **negative: injection-class** | computed partial `{{> (expr)}}`, `apply`, computed record `lookup` (§4) | assert the **Trussbars compiler rejects** it (§5) |
| **negative: changed-contract** | missing-key (§5.1) or bare-number condition (§5.3) | assert **`rustc` rejects** it with the expected error class (§5) |
| **numeric-masked** | admissible, but output contains an f64 whose stringification may differ (§10) | byte-match **after numeric normalization** (§7); *logged* |
| **coercion-divergent** | data shape the loose interpreter tolerates but strict serde rejects (`01` §8) | **excluded**, logged with reason |

Each case carries its bucket in the committed ledger (§9). "No failures" can never be read as
"covered everything" — the ledger states what was byte-matched, what was rejection-tested, and
what was excluded and why. This is `01` §11's anti-over-claim discipline, executable.

---

## 3. The corpus (reuse, don't re-author)

- The **MaxBars-relevant slice** of the existing `test:compile` corpus
  (`packages/compile/conformance/cases.mjs`) — already exercises core syntax, paths, blocks,
  operators, partials.
- The **golden examples** `examples/*/` (`template.hbs` + `data.json`).
- The **20 documented MaxBars examples** (`tutorials/src/maxbars.mjs`), whose dispositions are
  already classified in `01` Appendix §12 (17 positive · #3 negative/changed · #15
  negative/injection · #12 positive-via-map).

The classifier (§2) sorts the union into buckets automatically, so adding a case never requires
hand-labelling — the spec rule labels it.

---

## 4. Positive pipeline (byte-match)

For each positive-admissible case:

1. **Oracle.** `renderMaxbars(template, data)` → `expected` bytes.
2. **Schema.** Generate `Ctx` from the case (template usage + the data JSON) via the
   `03` inference (L1). For conformance, types must satisfy *both* the template's accesses and
   serde-deserialization of the data; numeric fields default to `f64` (the engine's model).
3. **Emit.** Drive the front-end (v1: PureScript `rustEmit`; v2: the proc-macro) bound to `Ctx`
   → a `render(&Ctx) -> String`.
4. **Assemble.** A tiny Rust unit: the emitted `render`, the `Ctx` struct (`#[derive(Deserialize,
   Trussbars)]`), and a driver that `serde_json`-deserializes the case data into `Ctx` and calls
   `render`.
5. **Run** → `actual` bytes.
6. **Normalize** numerics in both (§7), then **assert `actual == expected`**.

A serde deserialization failure at step 4–5 reclassifies the case as **coercion-divergent**
(§2) — logged, not a hard failure, because it reveals a *type-strictness* divergence (`01` §8),
not a rendering bug.

---

## 5. Negative pipeline (assert rejection)

Negative cases prove the subset boundary is *enforced*, not merely documented. Two sub-flows:

- **injection-class** (computed partials, `apply`, computed `lookup`): the **Trussbars
  front-end** must reject these *before* codegen, with a diagnostic naming the spec rule
  (`01` §4). Assert the rejection and its category.
- **changed-contract** (missing-key §5.1, bare-number condition §5.3): these reach codegen and
  must be rejected by **`rustc`** — "no field `nope` on `Ctx`" / "`Truthy` not implemented for
  `i64`". Use **`trybuild`** (the standard Rust compile-fail harness) with committed
  `.stderr` snapshots, asserting the *error class*, not the exact wording (rustc messages
  drift across versions — match on the category, e.g. "unknown field" / "trait not
  implemented").

Negative cases never byte-match (the oracle *would* render them — that's the whole point of the
divergence); they assert *that compilation fails in the expected way*.

---

## 6. Performance: one build, many runs

Compiling hundreds of tiny crates would dominate wall-clock. Design:

- **Positives batch into a single crate.** Each case becomes a module `case_NNNN` with its own
  `Ctx` and `render`; one `cargo build` compiles the whole corpus; the produced binary runs each
  case (reading its data JSON, printing its output) — **one compile, N runs.** This is the
  single most important performance decision; it turns "N cargo invocations" into one.
- **Negatives use `trybuild`**, which is built for compile-fail batches and caches aggressively.
  Negatives are the minority, so per-case compilation there is acceptable.
- Builds are `--release`-off (debug) for speed; output is identical (codegen is not
  optimization-sensitive — there is no runtime interpreter to optimize).

---

## 7. Numeric normalization (the f64 mask)

`01` §10 puts f64-byte-identity out of scope, so the diff must not fail on `1e21` vs
`1000000000000000000000`, `-0`, or `0.30000000000000004`. Approach:

- Tokenize both outputs into (text, number) runs; compare text runs exactly and number runs by
  **parsed numeric value** (with a tolerance for the float tail), not by spelling.
- A case whose match *depended* on normalization is flagged **numeric-masked** in the ledger
  (§9) — so the headline "byte-identical" count never silently absorbs numeric divergence.
- When a `number-format` lib lands later (`01` §10), masked cases graduate to strict
  byte-match; the ledger makes that progress measurable.

Non-numeric output stays a **strict byte diff** — escaping, whitespace, separators, `,`-joins
are all in scope and must match exactly.

---

## 8. Front-end agnostic

The harness drives a front-end through one seam: *(template, Ctx) → Rust source*. In **v1** that
seam is the PureScript `rustEmit` backend; in **v2** it is the Rust proc-macro. **Same corpus,
same buckets, same assertions.** Nothing else in the harness changes across the migration —
which is precisely what makes v2 a front-end swap rather than a rewrite.

---

## 9. The ledger (`report.json`, committed)

Like `conformance/handlebars/report.json` and the mustache report, the harness writes a
**committed** `report.json` so the score cannot silently drift. It records, per bucket:

```json
{
  "total": 0,
  "positive":  { "byte_matched": 0 },
  "numeric_masked": { "count": 0, "cases": [] },
  "negative":  { "injection_rejected": 0, "contract_rejected": 0 },
  "excluded":  { "coercion_divergent": 0, "cases": [] },
  "front_end": "rustEmit-v1 | procmacro-v2"
}
```

The human summary leads with a coverage line — *"Trussbars implements the
data-derived-name-free, statically-typed subset: P positive byte-matched (of which K
numeric-masked), N negatives correctly rejected, E excluded (coercion-divergent)"* — never a
bare case count (`01` §11).

---

## 10. The v2 cutover gate

This harness is the **kill-switch governance** from the project plan. v2 (the proc-macro)
ships, and the v1 PureScript `rustEmit` backend is **deleted**, only when:

1. the proc-macro front-end passes the **entire** harness — every positive byte-matched (modulo
   the same numeric mask), every negative rejected in the same category — with `front_end`
   flipped to `procmacro-v2`; and
2. the `report.json` deltas are zero against the v1 run (same buckets, same counts).

Until both hold, both front-ends coexist; after, `rustEmit` and the PureScript Rust backend go.
The harness is what makes that a *decision with evidence* rather than a leap.

---

## 11. Toolchain & CI placement

The harness needs a **Rust toolchain** (`cargo`, `rustc`) and `trybuild` — heavier than the
PureScript/Node gates. So, mirroring how the real-IDE editor tests run in
`.github/workflows/editors.yml` (path-filtered, out of the fast `npm test`):

- It runs in a **dedicated CI workflow** (`trussbars.yml`), path-filtered to `trussbars/**` and
  the compiler/runtime crates — **not** in the fast local `npm test`.
- A **fast local subset** (a dozen representative positives + the key negatives) can run under a
  `test:trussbars:smoke` script for quick feedback, with the full corpus reserved for CI.

---

## 12. Open questions

1. **Schema-inference maturity vs. the harness.** The harness is schema inference's (`03`)
   *first* consumer; immature inference (guessed scalars, §03 §4) will mislabel cases. Mitigation:
   for the corpus, allow a per-case **schema override** file (hand-pinned `Ctx`) where inference
   is ambiguous, so a conformance failure is never *just* an inference bug.
2. **Golden vs. live oracle.** Run the interpreter live each time, or commit golden `expected`
   outputs? Golden is faster and pins the oracle, but can stale; live always-current but slower.
   Lean **live for the interpreter** (it's fast, in-process) and **golden only for the emitted
   Rust** byte snapshots used in regression triage.
3. **`coercion-divergent` scope.** How large is the set of cases where MaxBars's loose value
   handling diverges from strict serde? If non-trivial, it deserves its own short doc — it is the
   sharpest empirical measure of the `01` §8 strictness trade.
4. **rustc-version drift in negative `.stderr`.** Pin a toolchain in CI and match error
   *categories*, not full text (§5), to keep negatives from breaking on compiler updates.
