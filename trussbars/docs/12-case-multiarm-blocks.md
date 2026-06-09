# Trussbars — Multi-arm `{{#case}}` blocks (`{{#case}}…{{when …}}…{{else}}`)

> **Status:** **Implemented** — a *first-class* construct (not a desugar). Reference:
> `Kernel.Prelude.caseH` (RawBars/MaxBars). Trussbars: `trussbars-template::Case` lowered to
> a Rust `match` by the AOT emitter, mirrored by the VM. Conformance: the `case-*` corpus
> cases on `--v2`/`--vm`/`--vm-compat`; `test:compile` pins the JS compiler. **Audience:**
> whoever extends surface control flow. Companion to `docs/09 §3.1` (host block helpers —
> which this is explicitly **not** a generalization of), `docs/01` (the subset spec this
> amends), `docs/04` (conformance), and `docs/08` (the v2 front-end this extends).
>
> **Naming.** The head keyword is **`case`**, not `match` or `switch`. The arm/catch-all are
> `when`/`else`, and `case…when…else` is the exact triad of SQL (`CASE WHEN … ELSE`), Ruby,
> and Liquid — three independent precedents for *this* shape. `match…when` is a pairing no
> language uses (Rust/Scala `match` arms are patterns, not `when`), and `match` would
> over-promise the exhaustive pattern-matching that v1 explicitly does **not** do (§4 A2).
> The name **`match`** is therefore reserved for the future *typed exhaustive* variant.

## 1. Context

The block-helper `{{else}}` debate (`docs/09 §3.1`, "Planned") deliberately drew a line:
the inverse arm of a *host block helper* is **binary** (a uniform `Fn(Arm)` selector with
`Arm ∈ {Main, Else}`), and anything richer — *named, multi-arm* blocks — was split out to
its own decision rather than smuggled in through `{{else}}`. This is that decision.

The shape under consideration:

```handlebars
{{#case status}}
  {{when "shipped"}}On its way{{when "pending" "queued"}}Waiting{{else}}Unknown{{/case}}
```

A subject, one or more `{{when …}}` arms matched against it, and an optional trailing
`{{else}}`. The closest precedents are **Liquid's** `{% case %}/{% when %}/{% else %}` and
**Ruby/SQL's** `case … when … else` — *not* Handlebars, which has no such construct. (Rust's
`match` is the inspiration for the *typed exhaustive* future variant in §4, A2 — a different
feature with a different keyword.)

The governing question is **not** "how do host helpers get N arms?" (they don't — see §5.3)
but "should Trussbars add a **built-in** multi-arm conditional, and what does it cost?"

## 2. Decision

**`{{#case}}` is a *first-class* construct — not sugar.** It has its own AST node
(`trussbars-template::Case`), its own engine operation in the reference
(`Kernel.Prelude.caseH`), and its own emit in every backend. The reason is **codegen**:
a first-class node lets the AOT compiler lower `{{#case}}` to a **Rust `match`** — the
subject evaluated **once** as the scrutinee, dispatched by one guard arm per `{{when}}` —
instead of a desugared `eq`-chain that re-evaluates the subject on every arm. (An earlier
draft of this ADR chose a desugar-to-`Cond` lowering; that was superseded — the first-class
node is the prerequisite for the `match` and for the future typed-exhaustive variant, §4 A2.)

Frozen surface (so the implementation is a transcription, not a redesign):

- `{{#case SUBJECT}}` opens the block; `SUBJECT` is a required expression.
- Zero or more `{{when V1 [V2 …]}}` arms. Each carries one or more **value expressions**;
  the arm is taken when the subject equals **any** of them (`subject == V1 || …`).
- An optional trailing `{{else}}` arm (the catch-all). With no `{{else}}`, an unmatched
  subject renders nothing — exactly like an `{{#if}}` without `{{else}}`.
- `{{/case}}` closes it. `when` and `else` are **context-sensitive separators** inside a
  case (like `else`/`else if` inside `if`), split out by the same `parse_until` mechanism.
- **Only whitespace** may precede the first `{{when}}` (standalone-line trimming applies as
  for `if`/`each`). Non-whitespace content before the first arm is a **located error** — no
  Liquid-style silent fall-through.
- `case` becomes a **reserved built-in block head** (joining `if`/`each`/`with`/`let`/
  `inline`/`partial` in `open_block`); it can no longer name a host block helper (§5.2).

Frozen surface (so the eventual PR is a transcription, not a redesign):

- `{{#case SUBJECT}}` opens the block; `SUBJECT` is a required expression.
- Zero or more `{{when V1 [V2 …]}}` arms. Each carries one or more **value expressions**;
  the arm is taken when the subject equals **any** of them (`eq s V1 || eq s V2 || …`).
- An optional trailing `{{else}}` arm (the catch-all). With no `{{else}}`, an unmatched
  subject renders nothing — exactly like an `{{#if}}` without `{{else}}`.
- `{{/case}}` closes it. `when` and `else` are **context-sensitive separators** inside a
  case (like `else`/`else if` inside `if`), split out by the same `parse_until` mechanism.
- **Only whitespace** may precede the first `{{when}}` (standalone-line trimming applies as
  for `if`/`each`). Non-whitespace content before the first arm is a **located error** — no
  Liquid-style silent fall-through.
- `case` becomes a **reserved built-in block head** (joining `if`/`each`/`with`/`let`/
  `inline`/`partial` in `open_block`); it can no longer name a host block helper (§5.2).

## 3. The lowering (concrete)

The parser builds a first-class [`Case`](../crates/trussbars-template/src/ast.rs) node — the
subject and each arm's **raw** values are kept (not pre-folded into `eq`s), so the emitter
owns the dispatch shape:

```text
Case {
  subject:  s,
  arms:     [ ([a],    [A]),     // {{when a}}
              ([b, c], [BC]) ],  // {{when b c}}  — multiple values per arm
  otherwise:[E],                 // {{else}}
}
```

The AOT emitter lowers it to a **Rust `match`** — the subject bound once, one guard arm per
`{{when}}`, `{{else}}` the `_` arm:

```rust
{
    let __subj = &(s);
    match () {
        () if *__subj == (a) => { /* A */ }
        () if *__subj == (b) || *__subj == (c) => { /* BC */ }
        _ => { /* E */ }
    }
}
```

Each guard reuses the same `==` the `eq` operator emits, so the rendered bytes are identical
to the interpreter — a `{{#case}}` corpus case passes the `--v2`, `--vm`, and `--vm-compat`
axes. The win over the desugared `eq`-chain is that the subject is evaluated **once**, and
the node is the seam the typed-exhaustive `match` (§4 A2) plugs into later.

In the PureScript reference the construct is equally first-class, so the oracle defines the
same semantics it isn't a desugar of: `Kernel.Prelude.caseH` is an engine operation — the
engine evaluates the subject once and hands it in; `caseH` takes the first `{{when}}` arm
whose value equals it (short-circuit), else `{{else}}`. The compilers match: the JS emitter
compiles an `if`/`else if` chain over the same `eq`; `MaxBars/Rust.purs` (the v1 emitter)
emits the same Rust `match`. The construct belongs to the **`nonEmpty`-truthiness family —
RawBars and MaxBars**; `when` joins their clause-separator set. **FullBars** (Handlebars-
faithful) and **MinBars** (Mustache) do **not** have `case`: FullBars rejects `{{#case}}`
with a located error pointing at the `{{#if (eq …)}}` form, and in MinBars a `{{#case}}` is
an ordinary Mustache section.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **First-class node → Rust `match`** | **Chosen** | A dedicated `Case` node + `caseH` op + per-backend emit. Costs a node and an emit arm, but the subject is evaluated **once** and the AOT backend emits a real `match` — the optimization a desugared `eq`-chain can't express, and the seam A2 extends. |
| **A1′** | Sugar → `Cond` (eq-chain) | **Superseded** | An earlier draft desugared `{{#case}}` to a `Cond`/`if`-chain (no new machinery, compiler "free"). Rejected because it re-evaluates the subject per arm and gives the codegen nothing to optimize — `case` should *become* a `match`, not an `if`-chain. |
| **A2** | Typed exhaustive Rust-`match` over closed enums | **Future extension of A1** | The real typed superpower (compile-time exhaustiveness on `#[serde(tag)]` enums) — literal *pattern* arms, not value guards. Needs compile-time knowledge of the subject's variant set (schema, `docs/03`). The first-class `Case` node (A1) is its prerequisite; spelled `{{#match}}` with pattern arms, not `when`. |
| **A3** | A host block helper with N named arms (generalize `docs/09 §3.1`'s arm-selector) | **Rejected** | The matching semantics are *engine value-comparisons over template literals*, not host Rust logic — so the engine is the natural evaluator, not a host fn. Routing it through a helper would force every author to re-implement `eq`-dispatch and fragment the convention. Keeps host block helpers cleanly **binary**. |
| **A4** | Do nothing — authors write `{{#if (eq s a)}}…{{else if (eq s b)}}…{{/if}}` | **The baseline** | Already works, but re-evaluates the subject per arm and never compiles to a `match`. A1 buys the subject-stated-once readability, the `case/when` spelling, **and** the `match` codegen. |

Beyond ergonomics (`{{#case}}` is the subject-stated-once, `when`-spelled form of a
recurring `{{#if (eq …)}}` chain), A1 buys the **codegen**: the subject is evaluated once
and the AOT backend emits a `match`.

## 5. Consequences

### 5.1 One first-class construct, byte-identical across backends

The `Case` node is rendered by four backends — the reference `caseH`, the AOT Rust `match`,
the VM tree-walk, and the JS/`MaxBars.Rust.purs` compilers — each pinned byte-for-byte by
the conformance corpus (`--v2`, `--vm`, `--vm-compat`) and `test:compile`. The arms carry
*raw* values, so the AOT emitter is free to choose its dispatch (today a guard `match`;
tomorrow a literal-pattern `match`, §4 A2) without touching the surface or the other
backends.

### 5.2 `case` becomes reserved

A host block helper named `case` is now shadowed by the built-in. Acceptable (`if`/`each`/
`with` are already reserved), but it is called out in `docs/09` and rejected with a located
error if someone declares `helpers = [case]`. In the PureScript reference the same
reservation holds: `case` is a registered engine operation, so it can never resolve to a
host operation; FullBars (which has no `case`) rejects it with a located, actionable error
pointing at the `{{#if (eq …)}}` form.

### 5.3 Host block helpers stay binary

This explicitly does **not** give host block helpers multiple author-named arms. The
`docs/09 §3.1` arm-selector remains `Arm ∈ {Main, Else}`. The two features are kept apart on
purpose; conflating them was the failure mode the original debate guarded against.

### 5.4 No exhaustiveness in v1

v1 dispatches by value equality: a subject matching no arm (and no `{{else}}`) renders empty
— it is **not** a compile error. The exhaustiveness guarantee that would make a typed
`{{#match}}` genuinely safer than an `if`-chain is **A2**, and it is out of scope here. This
is the substantive reason the v1 keyword is `case`, not `match`: `case` promises value
dispatch (what it does); `match` would promise patterns + exhaustiveness (what A2 will do).

### 5.5 Governance: this is nonEmpty-family *surface*, so the oracle gets it with Trussbars

`{{#case}}` is a **language/surface** construct, not a host concern — so under the project
framing (*MaxBars/PureScript is the oracle that defines the surface; Trussbars is the
production impl*), it cannot be a Trussbars-only token. It is a first-class operation of the
**`nonEmpty`-family surface — RawBars and MaxBars** (`Kernel.Prelude.caseH`) so the oracle
renders it and Trussbars conforms byte-for-byte against the live oracle (`docs/04`). The
oracle is implemented first (or together) precisely so the conformance corpus has an
authority for every `{{#case}}` case. (FullBars and MinBars are excluded — see §5.4 and §3.)

## 6. Status & sequencing

1. **Surface frozen (§2).** The exact spelling `{{#case SUBJECT}}{{when V …}}{{else}}{{/case}}`
   is fixed.
2. **Oracle first (§5.5).** `caseH` lands so the live oracle renders `{{#case}}`; the
   conformance corpus then has an authority for each case. **Done.**
3. **Trussbars Rust (`Case` node → `match`).** `case_block` builds a first-class `Case`
   (`Stop::When`, splitting on `when`/`else`); the emitter lowers it to a Rust `match` and the
   VM mirrors it; corpus cases on the `--v2`/`--vm`/`--vm-compat` axes; the reserved-word
   rejection (§5.2); `docs/09` cross-linked. **Done.**
4. **Later, optional:** **A2** — a typed exhaustive `{{#match}}` over closed `#[serde(tag)]`
   enums (compile-time exhaustiveness), its own decision once the schema/enum story
   (`docs/03`) needs it. It takes the `match` keyword and *pattern* arms, and plugs into the
   `Case` node A1 established.

## 7. Summary

- `{{#case}}…{{when …}}…{{else}}` is a **first-class construct** — its own AST node
  (`Case`), engine operation (`caseH`), and per-backend emit — **not** a desugar.
- The AOT compiler lowers it to a **Rust `match`** (subject evaluated once); the VM, the
  reference interpreter, and the JS compiler render byte-identically (conformance + test:compile).
- It is a **built-in control structure**, deliberately **not** a generalization of host
  block helpers (which stay binary, `docs/09 §3.1`).
- v1 has **no exhaustiveness**; the typed exhaustive variant (A2) is a staged future
  extension that takes the **`match`** keyword with pattern arms, built on the `Case` node.
- The keyword is **`case`** because `case…when…else` is the SQL/Ruby/Liquid triad that
  matches both the chosen arm keyword and the v1 (value-dispatch, non-exhaustive) semantics.
