# Trussbars — Multi-arm `{{#case}}` blocks (`{{#case}}…{{when …}}…{{else}}`)

> **Status:** Proposed / decision doc — *surface frozen; oracle + Trussbars implementations
> landing together.* Gated originally on **(a)** a real use case and **(b)** MaxBars-spec
> ratification (the oracle defines the surface — see §6). **Audience:** whoever adds surface
> control flow. Companion to `docs/09 §3.1` (host block helpers — which this is explicitly
> **not** a generalization of), `docs/01` (the subset spec this would amend), `docs/04`
> (conformance), and `docs/08` (the v2 front-end this extends).
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

**`{{#case}}` is built-in surface sugar that desugars to the existing `Cond`
(`if`/`else if`/`else`) node — the subject compared to each arm's value(s) by `eq`.** It
adds **no** new AST variant, engine path, VM path, or compiler emit: it is a *parser
rewrite* into machinery that is already conformance-gated on both backends. This is the
same "reuse the core, desugar the surface" move MaxBars already makes for pipes, operators,
and list/dict literals.

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

## 3. The desugaring (concrete)

```handlebars
{{#case s}}{{when a}}A{{when b c}}BC{{else}}E{{/case}}
```

lowers to the existing [`Cond`](../crates/trussbars-template/src/ast.rs) node — no new types:

```text
Cond {
  negated:  false,
  cond:     eq(s, a),                       // first {{when}}  → the `if`
  body:     [A],
  elifs:    [ (or(eq(s, b), eq(s, c)), [BC]) ],   // later {{when}} → `else if`
  otherwise:[E],                            // {{else}}        → the trailing else
}
```

Because the target is `Cond`, **AOT≡VM parity and the compiler are free**: both backends
already render `Cond` byte-identically (conformance-gated), and `eq`/`or` are existing
prelude ops. A `{{#case}}` corpus case passes the `--v2`, `--vm`, and `--vm-compat` axes
the day the parser rewrite lands, with zero new evaluator code.

In the PureScript oracle (MaxBars), the same rewrite is a **surface desugar**: the
`{{#case}}` block is rewritten into the existing `{{#if (eq s a)}}…{{elif (or (eq s b)
(eq s c))}}…{{else}}…{{/if}}` skeleton *before* lowering, so the interpreter, the JS
compiler, and the `MaxBars/Rust.purs` emitter all handle it with no change.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **Sugar → `Cond` (eq-chain)** | **Chosen** | No new machinery; parity/compiler free; Liquid-faithful; reuses `Cond`. |
| **A2** | Typed exhaustive Rust-`match` over closed enums | **Future extension of A1, owns the `match` name** | The real typed superpower (compile-time exhaustiveness on `#[serde(tag)]` enums), but needs compile-time knowledge of the subject's variant set (schema, `docs/03`) and new emit. Stage it after A1; spelled `{{#match}}` with *pattern* arms, not `when`. |
| **A3** | A host block helper with N named arms (generalize `docs/09 §3.1`'s arm-selector) | **Rejected** | The matching semantics are *engine value-comparisons over template literals*, not host Rust logic — so the engine is the natural evaluator, not a host fn. Routing it through a helper would force every author to re-implement `eq`-dispatch and fragment the convention. Keeps host block helpers cleanly **binary**. |
| **A4** | Do nothing — authors write `{{#if (eq s a)}}…{{else if (eq s b)}}…{{/if}}` | **The baseline** | Already works and is *exactly* what A1 desugars to. The only thing A1 buys is the subject-stated-once readability and a familiar `case/when` spelling. Honest cost/benefit: small. |

The A4 baseline is why this is **pure ergonomics** over an expressible idiom: `{{#case}}`
earns its place as the subject-stated-once, `when`-spelled form of a recurring
`{{#if (eq …)}}` chain.

## 5. Consequences

### 5.1 Parity and conformance are free

Desugaring to `Cond` (Rust) / the `if` skeleton (oracle) means nothing new to keep in sync
across AOT/VM/oracle — the single biggest reason to prefer A1. Implementation risk is
confined to the parser/surface-desugar.

### 5.2 `case` becomes reserved

A host block helper named `case` is now shadowed by the built-in. Acceptable (`if`/`each`/
`with` are already reserved), but it is called out in `docs/09` and rejected with a located
error if someone declares `helpers = [case]`. In the PureScript oracle the same reservation
holds: `{{#case}}` is rewritten in the surface pass, so it can never resolve to a host
operation; FullBars (which has no `case`) rejects it with a located, actionable error
pointing at the `{{#if (eq …)}}` form.

### 5.3 Host block helpers stay binary

This explicitly does **not** give host block helpers multiple author-named arms. The
`docs/09 §3.1` arm-selector remains `Arm ∈ {Main, Else}`. The two features are kept apart on
purpose; conflating them was the failure mode the original debate guarded against.

### 5.4 No exhaustiveness in v1

A1 is a string/value `eq`-chain: a subject value matching no arm (and no `{{else}}`) renders
empty — it is **not** a compile error. The exhaustiveness guarantee that would make a typed
`{{#match}}` genuinely safer than an `if`-chain is **A2**, and it is out of scope here. This
is the substantive reason the v1 keyword is `case`, not `match`: `case` promises value
dispatch (what it does); `match` would promise patterns + exhaustiveness (what A2 will do).

### 5.5 Governance: this is MaxBars *surface*, so the oracle gets it together with Trussbars

`{{#case}}` is a **language/surface** construct, not a host concern — so under the project
framing (*MaxBars/PureScript is the oracle that defines the surface; Trussbars is the
production impl*), it cannot be a Trussbars-only token. It is added to the **MaxBars surface**
(the PureScript parser/desugar) so the oracle renders it and Trussbars conforms byte-for-byte
against the live oracle (`docs/04`). MaxBars is implemented first (or together) precisely so
the conformance corpus has an authority for every `{{#case}}` case.

## 6. Status & sequencing

1. **Surface frozen (§2).** The exact spelling `{{#case SUBJECT}}{{when V …}}{{else}}{{/case}}`
   is fixed; the implementation is a transcription, not a redesign.
2. **Oracle first (§5.5).** The MaxBars surface desugar lands so the live oracle renders
   `{{#case}}`; the conformance corpus then has an authority for each case.
3. **Trussbars Rust:** a parser rewrite (`case_block` in `open_block`, splitting on `when`/
   `else`) lowering to `Cond`; a corpus case added to the `--v2`/`--vm`/`--vm-compat` axes;
   the reserved-word rejection (§5.2); and `docs/09` cross-linked.
4. **Later, optional:** **A2** — a typed exhaustive `{{#match}}` over closed `#[serde(tag)]`
   enums (compile-time exhaustiveness), its own decision once the schema/enum story
   (`docs/03`) needs it. It takes the `match` keyword and *pattern* arms.

## 7. Summary

- `{{#case}}…{{when …}}…{{else}}` is modeled as **surface sugar desugaring to the existing
  `Cond` node** (Rust) / the `if`/`elif`/`else` skeleton (oracle) — subject `eq` each `when`
  value — with no new engine/VM/compiler machinery; parity and the compiler come for free.
- It is a **built-in control structure**, deliberately **not** a generalization of host
  block helpers (which stay binary, `docs/09 §3.1`).
- v1 has **no exhaustiveness**; the typed exhaustive variant (A2) is a staged future
  extension that takes the **`match`** keyword with pattern arms.
- The keyword is **`case`** because `case…when…else` is the SQL/Ruby/Liquid triad that
  matches both the chosen arm keyword and the v1 (value-dispatch, non-exhaustive) semantics.
