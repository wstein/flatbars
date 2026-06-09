# Trussbars — Typed-exhaustive `{{#match}}` blocks

> **Status:** **POSTPONED** (not scheduled) — paper only, **no code**. Typed-exhaustive
> pattern matching is an ML/Rust construct, *not* an idiom of the Handlebars/Mustache/Liquid
> family Trussbars descends from — value dispatch (`{{#case}}`, shipped) covers the common
> need. The design below is kept on record; revive it only if a concrete consumer needs
> compile-time variant-coverage. **If revived, the team-agreed contract is uniform *runtime*
> exhaustiveness** (an unhandled variant ⇒ an error on *all four* surfaces — AOT, interpreter,
> bytecode VM, and the PureScript Lab), with `"Type"` an *optional, output-preserving* AOT
> refinement (a real Rust `match` + rustc's static check). That supersedes §3's earlier
> "AOT-only, runtime-ignored" wording, which broke the spirit of the `--vm-compat` gate
> (the AOT would reject what the VM accepts). See the deferral note at the end of §6.
>
> This is the typed sibling of `{{#case}}` (`docs/12`); it builds on the first-class `Case`
> seam `docs/12` established. **Audience:** whoever revives the typed dispatch. Companion to
> `docs/01` (subset spec), `docs/03` (schema inference — a *later* enabler, **not** a
> prerequisite, see §4), `docs/04` (conformance), `docs/07` (diagnostics), and `docs/12`.
>
> **Why a separate construct.** `{{#case}}` is **value** dispatch: any subject, arms are value
> literals compared by `==`, no exhaustiveness (a miss → `{{else}}`/empty). `{{#match}}` is
> **variant** dispatch over a **closed enum** with **compile-time exhaustiveness**. The two
> share the `Case`/arm shape but differ in guarantee, so they are distinct keywords (`docs/12`
> reserved `match` for exactly this).

## 1. The shape

```handlebars
{{#match order "Order"}}
{{when Shipped}}On its way
{{when Pending Queued}}Waiting
{{when Cancelled}}Cancelled
{{else}}—
{{/match}}
```

A subject, a `"Type"` string naming the closed Rust enum, one or more `{{when …}}` arms
carrying **variant names** (space-separated for an or-pattern, mirroring `{{case}}`'s
multi-value arms), and an optional trailing `{{else}}`.

## 2. Decision (frozen surface)

- **`{{#match SUBJECT "TYPE"}}`** opens the block. `SUBJECT` is a required expression; `"TYPE"`
  is a **string literal** naming a closed enum path **in scope in the host module** (where
  `truss!` expands), e.g. `"Order"` or `"crate::model::Order"`.
- **`{{when V1 [V2 …]}}`** arms carry one or more **bare variant identifiers** (an or-pattern
  is space-separated — `{{when Pending Queued}}`, *not* `Pending | Queued`, because `|` is the
  MaxBars pipe operator). The arm is taken when the subject is any of those variants.
- An optional trailing **`{{else}}`** — the catch-all. Its presence emits a Rust `_` arm and
  therefore **disables** exhaustiveness checking (the author opted out).
- **`{{/match}}`** closes it. `when`/`else` are the same context-sensitive separators
  `{{#case}}` uses (their standalone lines are trimmed); only whitespace may precede the first
  `{{when}}` — leading content is a located error.
- `match` becomes a **reserved built-in block head** (joining `if`/`each`/`case`/… in
  `open_block`); it can no longer name a host block helper.

**The `"TYPE"` literal is required in v1.** It is the one piece of type information the
compiler cannot get otherwise (see §4) and the only template↔Rust coupling. Schema inference
(`docs/03`) would later let it be *omitted* for an inferred subject; until then it is explicit.

### 2.1 Why a *string* type, not `as Type` or a bare name

The type name must reach **both** RawBars (core) and MaxBars (surface) as an **un-rewritten
literal**, and the only token the surface leaves untouched in both is a string literal. The
two natural-looking alternatives both break:

- **`as Type`** collides with the block-parameter keyword: MaxBars' surface reads `as Order`
  as a body binding `Order` (`extractBlockParams`), and RawBars (which runs *no* surface) would
  evaluate `as` as a positional argument and fail. It would also need `match` to be MaxBars-only.
- **A bare `{{#match SUBJECT Order}}`** — the surface path-rewrites the bare `Order` to
  `(lookup this "Order")`, a data read, not a type name.

A string literal `"Order"` sails through both dialects verbatim (subject + a `Lit String`
positional), so `{{#match}}` stays **RawBars + MaxBars** like `{{#case}}`, needs no dedicated
surface rule, and never shadows a body name. The cost is the quotes — an acceptable, honest
trade for cross-dialect parse-cleanliness. (`docs/03` schema inference later removes the
annotation entirely.)

## 3. Semantics

`{{#match}}` has **one runtime meaning** and **one extra static guarantee**:

- **Runtime (VM + PureScript reference)** — the subject is a value (a string: the serialized
  variant name); each `{{when Variant}}` matches when `subject == "Variant"`. This is exactly
  `{{#case}}`'s value dispatch with bare-identifier arms read as their names. The `"TYPE"`
  annotation is **ignored at runtime** — it is an AOT-only directive. So the VM and oracle
  need **no type system**: `matchH` is `caseH` with identifier arms.
- **AOT (Trussbars Rust)** — the subject is the typed enum; the emitter lowers to a real Rust
  `match` over **variant patterns**, and **rustc** validates the variant names and enforces
  exhaustiveness:

  ```rust
  match &order {
      Order::Shipped => { /* … */ }
      Order::Pending | Order::Queued => { /* … */ }
      Order::Cancelled => { /* … */ }
      // no `_`  ⇒  rustc errors if a variant is unhandled (exhaustiveness)
  }
  ```

  With an `{{else}}`, the emitter appends `_ => { … }` and exhaustiveness is off.

This split is the crux: exhaustiveness is an **AOT-only static guarantee** (a *diagnostic*,
not an output difference), so **conformance is preserved** — the corpus compares *rendered
output*, and on inputs the type permits, the runtime string-dispatch and the AOT enum-match
render identically. A subject value outside the declared variant set is unreachable by
construction in well-typed AOT, and renders `{{else}}`/empty under the runtime.

## 4. Why this needs *no* schema inference (the proc-macro insight)

The tempting design is "infer the subject's enum + variants (`docs/03`), then check the arms."
But a **Rust proc-macro runs before type-checking** — `truss!` cannot introspect `Ctx`'s
field types at all. The resolution is to *lean on rustc*: the macro emits
`match SUBJECT { TYPE::Variant => … }` and rustc does the rest — it rejects an unknown variant
(`TYPE::Bogus`) and a non-exhaustive set, as **class-B** diagnostics (`docs/07 §3`).

The macro only needs the **type path** to prefix the variants (`Order::`), which the `"TYPE"`
annotation supplies. So:

- **No `docs/03` dependency for the AOT path.** A2 ships on the implemented `Case` seam +
  `"TYPE"`.
- **`docs/03` is a later LSP upgrade**, not a blocker: schema inference would let the author
  omit `"TYPE"` and would move the "missing arm `X`" / "unknown variant" errors from rustc
  (class-B, at the use site) to a *located* **class-A** template diagnostic + variant
  completion.

## 5. The node

`Case` (`docs/12`) carries value arms. A2 adds a typed, pattern-dispatch variant. Two options:

- **(a) A `dispatch` discriminant on `Case`** — `Case { subject, dispatch: ByValue | ByEnum
  { ty }, arms, otherwise }`, where `ByEnum` arms hold variant identifiers. Reuses the parser
  split and the runtime path wholesale.
- **(b) A sibling `Match` node** — cleaner separation, a little duplication.

**Chosen: (a)** — the runtime dispatch is *identical* (string compare), only the AOT emit and
the arm-value interpretation differ, so a discriminant on `Case` keeps `matchH` ≡ `caseH` and
confines the new code to the AOT emitter.

## 6. Scope — v1 and deferrals

**v1 (this ADR):**

- Unit variants only (`Order::Shipped`), matched by name.
- `"TYPE"` required; or-patterns via space-separated variants; optional `{{else}}`.
- AOT exhaustiveness via rustc (class-B); runtime string-dispatch in VM/oracle.

**Deferred (each its own decision):**

- **Field binds** — `{{when Shipped(tracking)}}` binding payload from tuple/struct variants
  into the arm body. Needs the runtime to extract from the tagged object and the AOT to bind
  in the pattern; large, and orthogonal to exhaustiveness.
- **serde `rename`/`rename_all`.** v1 requires a variant to serialize **as its identifier**
  (the runtime compares the written name to the data string; the AOT writes `TYPE::Name`). A
  renamed variant breaks that identity. A future version reads the rename via a derive-side
  registry or `docs/03`.
- **Internally/adjacently-tagged enums** (`#[serde(tag = "kind")]` with payload) — the runtime
  discriminator-field model. v1 targets the externally-tagged / unit-string case.
- **Inferred subject type** (omit `"TYPE"`) — gated on `docs/03` in Rust.

### 6.1 Deferral note (team decision)

`{{#match}}` is **postponed**: typed-exhaustive matching is not a template-engine idiom, and
`{{#case}}` (shipped) covers the common multi-arm need. If revived, the agreed contract — from
the cross-backend debate — is:

- **Runtime exhaustiveness is uniform on all four surfaces.** No `{{else}}` + an unmatched
  subject ⇒ an **error**: a compile error in the AOT macro, a render `Err`/`Left` in the
  interpreter, the bytecode VM, and the PureScript Lab. This (not §3's earlier "AOT-only")
  is what satisfies "works the same" — and it keeps `--vm-compat`'s accept⇔accept honest,
  since under the old wording the AOT would *reject* a non-exhaustive match the VM *accepts*.
- **`"Type"` is an optional, output-preserving AOT refinement** — it lets the AOT emit a real
  Rust `match` (no `_`) so rustc proves the runtime error unreachable and gives the jump table.
  On the three non-AOT surfaces it is **inert** (ignored; a gibberish `"Type"` ≡ a real path).
- **Three gates, authored with the feature:** the byte-identity corpus on covered inputs; a
  *tri-surface negative gate* (one uncovered input → AOT compile-error + VM/oracle render-error);
  and a `"Type"`-inertness case. Plus a `case`↔`match` lint pair (suggest/​warn).

## 7. Conformance & governance

- A `{{#match}}` corpus case renders **byte-identically** to its `{{#case}}`-with-string-arms
  twin on every axis (`--v2`/`--vm`/`--vm-compat`, `test:compile`) — the runtime dispatch is
  the same. The new thing to test is the **AOT exhaustiveness diagnostic**: a `trybuild`
  UI-snapshot (an omitted variant → rustc's non-exhaustive-`match` error) and the accept case.
- Governed like `{{#case}}`: it is **nonEmpty-family surface** (RawBars/MaxBars), so the
  oracle (`matchH`) gets it with Trussbars; FullBars/MinBars reject it. The oracle defines the
  *runtime* semantics; rustc owns the *static* exhaustiveness.

## 8. Sequencing

1. **Freeze this surface** (the `"TYPE"` string + bare variant arms, §2). — *this ADR.*
2. **Reference `matchH`** — register `match` as a block op; `"TYPE"` parsed and carried but
   runtime-ignored; arms = identifier names compared as strings. Surface `when`/`else` already
   clause markers (`docs/12`).
3. **AOT emit** — `Case`'s `ByEnum` discriminant → `match SUBJECT { TYPE::Variant => … }`;
   `{{else}}` → `_`. Add the `trybuild` exhaustiveness gate.
4. **VM** — mirror `matchH` (string dispatch).
5. **Corpus + tutorial + spec** — a `match` example, the exhaustiveness trybuild case.
6. **Later:** field binds; serde-rename; `docs/03`-inferred subject (omit `"TYPE"`) + LSP
   class-A exhaustiveness/completion.

## 9. Summary

- `{{#match SUBJECT "TYPE"}}{{when Variant…}}…{{else}}…{{/match}}` — variant dispatch over a
  closed enum, **exhaustive** on the AOT path.
- It is `{{#case}}`'s typed sibling: **same runtime** (string dispatch, `matchH` ≡ `caseH`),
  plus an **AOT-only** Rust `match` whose exhaustiveness rustc enforces — so **no schema
  inference is required**, only the `"TYPE"` annotation.
- v1 is unit variants, no rename, no field binds; those are staged. The first-class `Case`
  node carries it via a `ByValue | ByEnum` discriminant.
