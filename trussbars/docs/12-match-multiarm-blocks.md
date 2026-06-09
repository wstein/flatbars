# Trussbars — Multi-arm `{{#match}}` blocks (`{{#match}}…{{when …}}…{{else}}`)

> **Status:** Proposed / decision doc — *paper first, no code.* Gated on **(a)** a real use
> case and **(b)** MaxBars-spec ratification (the oracle defines the surface — see §6).
> **Audience:** whoever adds surface control flow. Companion to `docs/09 §3.1` (host block
> helpers — which this is explicitly **not** a generalization of), `docs/01` (the subset
> spec this would amend), `docs/04` (conformance), and `docs/08` (the v2 front-end this
> extends).

## 1. Context

The block-helper `{{else}}` debate (`docs/09 §3.1`, "Planned") deliberately drew a line:
the inverse arm of a *host block helper* is **binary** (a uniform `Fn(Arm)` selector with
`Arm ∈ {Main, Else}`), and anything richer — *named, multi-arm* blocks — was split out to
its own decision rather than smuggled in through `{{else}}`. This is that decision.

The shape under consideration:

```handlebars
{{#match status}}
  {{when "shipped"}}On its way{{when "pending" "queued"}}Waiting{{else}}Unknown{{/match}}
```

A subject, one or more `{{when …}}` arms matched against it, and an optional trailing
`{{else}}`. The closest precedents are **Liquid's** `{% case %}/{% when %}/{% else %}` and
**Rust's** `match` — *not* Handlebars, which has no such construct.

The governing question is **not** "how do host helpers get N arms?" (they don't — see §5.3)
but "should Trussbars add a **built-in** multi-arm conditional, and what does it cost?"

## 2. Decision

**`{{#match}}` is built-in surface sugar that desugars to the existing `Cond`
(`if`/`else if`/`else`) node — the subject compared to each arm's value(s) by `eq`.** It
adds **no** new AST variant, engine path, VM path, or compiler emit: it is a *parser
rewrite* into machinery that is already conformance-gated on both backends. This is the
same "reuse the core, desugar the surface" move MaxBars already makes for pipes, operators,
and list/dict literals.

Frozen surface (so the eventual PR is a transcription, not a redesign):

- `{{#match SUBJECT}}` opens the block; `SUBJECT` is a required expression.
- Zero or more `{{when V1 [V2 …]}}` arms. Each carries one or more **value expressions**;
  the arm is taken when the subject equals **any** of them (`eq s V1 || eq s V2 || …`).
- An optional trailing `{{else}}` arm (the catch-all). With no `{{else}}`, an unmatched
  subject renders nothing — exactly like an `{{#if}}` without `{{else}}`.
- `{{/match}}` closes it. `when` and `else` are **context-sensitive separators** inside a
  match (like `else`/`else if` inside `if`), split out by the same `parse_until` mechanism.
- **Only whitespace** may precede the first `{{when}}` (standalone-line trimming applies as
  for `if`/`each`). Non-whitespace content before the first arm is a **located error** — no
  Liquid-style silent fall-through.
- `match` becomes a **reserved built-in block head** (joining `if`/`each`/`with`/`let`/
  `inline`/`partial` in `open_block`); it can no longer name a host block helper (§5.2).

## 3. The desugaring (concrete)

```handlebars
{{#match s}}{{when a}}A{{when b c}}BC{{else}}E{{/match}}
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
prelude ops. A `{{#match}}` corpus case would pass the `--v2`, `--vm`, and `--vm-compat`
axes the day the parser rewrite lands, with zero new evaluator code.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **Sugar → `Cond` (eq-chain)** | **Chosen** | No new machinery; parity/compiler free; Liquid-faithful; reuses `Cond`. |
| **A2** | Typed exhaustive Rust `match` over closed enums | **Future extension of A1** | The real typed superpower (compile-time exhaustiveness on `#[serde(tag)]` enums), but needs compile-time knowledge of the subject's variant set (schema, `docs/03`) and new emit. Stage it after A1. |
| **A3** | A host block helper with N named arms (generalize `docs/09 §3.1`'s arm-selector) | **Rejected** | The matching semantics are *engine value-comparisons over template literals*, not host Rust logic — so the engine is the natural evaluator, not a host fn. Routing it through a helper would force every author to re-implement `eq`-dispatch and fragment the convention. Keeps host block helpers cleanly **binary**. |
| **A4** | Do nothing — authors write `{{#if (eq s a)}}…{{else if (eq s b)}}…{{/if}}` | **The baseline** | Already works and is *exactly* what A1 desugars to. The only thing A1 buys is the subject-stated-once readability and a familiar `case/when` spelling. Honest cost/benefit: small. |

The A4 baseline is why this is **not urgent**: `{{#match}}` is pure ergonomics over an
expressible idiom. It earns its place only if real templates show the `{{#if (eq …)}}`
chain is a recurring readability tax.

## 5. Consequences

### 5.1 Parity and conformance are free
Desugaring to `Cond` means nothing new to keep in sync across AOT/VM/oracle — the single
biggest reason to prefer A1. Implementation risk is confined to the parser.

### 5.2 `match` becomes reserved
A host block helper named `match` would now be shadowed by the built-in. Acceptable (`if`/
`each`/`with` are already reserved), but it must be called out in `docs/09` and rejected
with a located error if someone declares `helpers = [match]`.

### 5.3 Host block helpers stay binary
This explicitly does **not** give host block helpers multiple author-named arms. The
`docs/09 §3.1` arm-selector remains `Arm ∈ {Main, Else}`. The two features are kept apart on
purpose; conflating them was the failure mode the original debate guarded against.

### 5.4 No exhaustiveness in v1
A1 is a string/value `eq`-chain: a subject value matching no arm (and no `{{else}}`) renders
empty — it is **not** a compile error. The exhaustiveness guarantee that would make
`{{#match}}` genuinely safer than an `if`-chain is **A2**, and it is out of scope here.

### 5.5 Governance: this is MaxBars *surface*, so the oracle must get it first
`{{#match}}` is a **language/surface** construct, not a host concern — so under the project
framing (*MaxBars/PureScript is the oracle that defines the surface; Trussbars is the
production impl*), it cannot be a Trussbars-only token. Either it is added to the **MaxBars
spec** (a main-repo ADR + the PureScript parser/desugar) so the oracle renders it and
Trussbars conforms, **or** it is scoped as Trussbars-only sugar with conformance proven
against hand-desugared `{{#if}}`-chain equivalents. **The decision: it belongs in the
MaxBars spec.** This doc is therefore the Trussbars-side decision *and a dependency*: the
implementation is gated on a MaxBars spec ADR landing the `{{#match}}` surface, so the
oracle stays the source of truth (`docs/04`).

## 6. Status & sequencing

1. **Now:** proposed, paper only. No parser/AST/emit change. The `{{#match}}` head, like any
   non-built-in block head, currently parses to a `HelperBlock` and resolves to an
   `unknown helper` error unless declared — i.e. it is inert, not silently mis-handled.
2. **Before implementing — two gates:** (a) a concrete consumer (a real template where the
   `{{#if (eq …)}}` chain is a measured readability tax), and (b) a ratified **MaxBars spec
   ADR** for the `{{#match}}` surface (§5.5).
3. **When built:** a parser rewrite (`match_block` in `open_block`, splitting on `when`/
   `else`) lowering to `Cond`; a corpus case added to the `--v2`/`--vm`/`--vm-compat` axes;
   the reserved-word rejection (§5.2); and `docs/09` cross-linked.
4. **Later, optional:** **A2** — a typed exhaustive `match` over closed `#[serde(tag)]` enums
   (compile-time exhaustiveness), its own decision once the schema/enum story (`docs/03`)
   needs it.

## 7. Summary

- `{{#match}}…{{when …}}…{{else}}` is best modeled as **surface sugar desugaring to the
  existing `Cond` node** (subject `eq` each `when` value) — no new engine/VM/compiler
  machinery, parity and the compiler for free.
- It is a **built-in control structure**, deliberately **not** a generalization of host
  block helpers (which stay binary, `docs/09 §3.1`).
- v1 has **no exhaustiveness**; the typed exhaustive-`match`-over-enums variant (A2) is a
  staged future extension.
- Because it is **MaxBars surface**, it must be ratified in the MaxBars spec first; this doc
  is the Trussbars decision plus that dependency. With the A4 baseline already expressible,
  the feature is low-urgency ergonomics — gated on demonstrated need.
