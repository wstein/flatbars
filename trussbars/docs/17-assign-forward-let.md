# Trussbars — `{{assign name = expr}}` (flat forward-scoped binding)

> **Status:** **Proposed** — a Liquid-borrowed *surface* construct, adapted to Trussbars's
> scope model. It is the **block-less sibling of `{{#let}}`**: where `{{#let}}` opens a
> nested scope, `{{assign}}` emits a single binding into the *current* block, live from its
> own position to the enclosing block's close. Reference (to be added): a nullary-installing
> engine handle in the **nonEmpty-family surface (RawBars/MaxBars)**, mirroring `letH`.
> Trussbars lowers it to a **bare Rust `let` statement** — no new runtime machinery.
> **Audience:** whoever extends surface binding. Companions: `docs/01` (the subset spec this
> amends), `docs/06` (the freeze — this is an addition, §5), `docs/04` (conformance),
> `docs/12` (the naming principle: a name signals its semantics), `docs/16` (truthiness),
> and the as-yet-unfiled `{{#capture}}` ADR (`docs/18`), the rendered-body counterpart.
>
> **Naming.** The keyword is **`assign`**, not a block-less `let`. `assign…=` is Liquid's and
> Ruby's spelling for *sequential, forward-scoped* binding; `let` (Rust/ML) connotes a
> *lexical, nested* scope — and Trussbars already uses `{{#let}}` for exactly that. Per the
> `docs/12` principle (the keyword should promise the semantics), two distinct scope models
> earn two distinct keywords. See §4 A2 for the rejected unify-under-`let` alternative.

## 1. Context

Trussbars has one binding form today, `{{#let}}` (docs/06 §1, F4): block-scoped, sequential,
computed-once aliases that **never re-root**, value-bound to a Rust `let` inside the `{ … }`
the block opens. It is the right tool for "a temporary I need *in this section*." It is the
wrong tool for the other half of the idiom Liquid's `{% assign %}` serves: **"set a value up
front and use it throughout the rest of the enclosing region,"** without wrapping that whole
region in a block and indenting it.

```handlebars
{{assign full_name = (append (append first " ") last)}}
{{assign greeting  = (append "Hello, " full_name)}}

<h1>{{greeting}}</h1>
... many lines, all of which see full_name / greeting ...
```

Written with `{{#let}}` this forces the entire remainder of the template to become the body
of a `{{#let}}…{{/let}}` — a pyramid of nesting for what is morally a prologue. `assign` is
the flat form: a binding statement with no body and no close.

The governing question is **not** "should templates have mutable variables?" (they must not —
§4 A3, the borrow/purity boundary) but "should Trussbars add a *block-less, forward-scoped*
binding, and what is its exact scope and lowering?"

## 2. Decision

**`{{assign name = expr}}` binds `name` to the value of `expr`, in scope from its own
position to the close of the *enclosing block*.** It is sugar over the same machinery as
`{{#let}}` — a Rust `let` — emitted *inline* rather than inside a fresh `{ }`.

Frozen surface (so the implementation is a transcription, not a redesign):

- `{{assign NAME = EXPR}}` — a **block-less** tag. No `#`, no `{{/assign}}`. `NAME` is a
  static identifier (the same name grammar as a `{{#let}}` binding); `EXPR` is any Trussbars
  expression (operators, pipes, filters, helper calls, parenthesised application).
- **Scope is the enclosing block, forward only.** A top-level `{{assign}}` is live to the end
  of the template; an `{{assign}}` inside `{{#each}}`/`{{#if}}`/`{{#with}}`/`{{#let}}` is live
  to that block's close and **does not leak past it**. This is Rust lexical scope — and a
  *deliberate divergence from Liquid*, whose `assign` leaks out of enclosing tags into the
  whole document (a known Liquid footgun). Trussbars chooses the stricter, predictable rule.
- **Re-assigning a name in the same block shadows** (a fresh binding), exactly like a second
  Rust `let x = …;`. It does **not** mutate the prior binding, and it never reaches across a
  block boundary — so the Liquid loop-accumulator idiom (`{% assign total = total | plus: 1 %}`
  inside a `for`) is **not** expressible. That is intentional (§4 A3); use a fold-style helper
  (`sum`, `count`, a host helper) for accumulation.
- **`name` may not shadow a reserved scope name** (`this`, `root`, `parent`, `outer`, `loop`,
  `yield`) **nor a built-in block head** (`if`/`each`/`with`/`let`/`case`/`inline`/`partial`) —
  a located error, mirroring the `case` reservation (`docs/12 §5.2`).
- **Truthiness and types are inherited from `{{#let}}` unchanged** (docs/06 §2): the binding
  is value-bound, its type inferred; a bound number still has no `TruthyIn<NonEmpty>` impl, so
  `{{#if assigned_n}}` is a compile error — write `{{#if assigned_n > 0}}`.

## 3. The lowering (concrete)

The parser builds the **same `Let` binding node** `{{#let}}` uses, tagged as *open-ended*
(no body of its own; its "body" is the remainder of the enclosing block's node list). No new
AST node is required — an `assign` is a `Let` whose scope is the cons-tail that follows it.

The AOT emitter lowers it to a **bare Rust `let`** spliced into the current block, so Rust's
own lexical scoping delivers the forward-to-end-of-block semantics for free:

```handlebars
{{#each post in posts}}
  {{assign slug = (lowercase (replace post.title " " "-"))}}
  <a href="/{{slug}}">{{post.title}}</a>
{{/each}}
```

```rust
for post in (&ctx.posts).iter() {
    // {{assign slug = …}}  →  a let in the loop-body block, live to the brace below
    let slug = trussbars_std::lowercase(trussbars_std::replace(&post.title, " ", "-"));
    out.push_str("<a href=\"/");
    out.push_str(&trussbars_std::escape_html(&slug));
    out.push_str("\">");
    out.push_str(&trussbars_std::escape_html(&post.title));
    out.push_str("</a>\n");
}   // ← `slug` drops here; it never leaked out of the loop (the Liquid divergence)
```

Because `assign` reuses the `{{#let}}` emit path, the F4 caveat carries over verbatim:
binding a non-`Copy` field *directly* (`{{assign n = post.title}}`) would move out of `&ctx`
— bind a computed/owned value, or reference the field. In practice `assign` overwhelmingly
binds *computed* values (a `String` from a filter, an `f64` from arithmetic), which are owned,
so it hits this less often than aliasing `{{#let}}` does.

In the PureScript oracle the construct is sugar over `letH`: `{{assign name = expr}}` installs
`name` as a block-scoped nullary operation in the *current* frame (not a pushed child frame),
so subsequent siblings resolve it and the frame's close discards it — the exact scope the Rust
`let` gives. The JS compiler (`MaxBars/Rust.purs`'s JS sibling) and the VM mirror it; every
backend is pinned byte-for-byte by the conformance corpus. The construct belongs to the
**nonEmpty-truthiness family — RawBars and MaxBars** (like `{{#let}}` and `{{#case}}`).
**FullBars** (Handlebars-faithful) and **MinBars** (Mustache) do **not** get `assign`:
FullBars rejects `{{assign …}}` with a located error pointing at `{{#let}}`/`{{#with}}`; in
MinBars it is an ordinary (meaningless) section/variable.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **Block-less tag, reusing the `{{#let}}` emit path** | **Chosen** | A new *spelling* over the existing `Let` node + `letH` op; no runtime, no AST node. Buys the flat prologue ergonomic with zero new machinery, and Rust lexical scope gives the forward semantics for free. |
| **A2** | Unify under `let`: `{{let x=e}}` (no `#`) == flat, `{{#let x=e}}…{{/let}}` == block | **Rejected** | More economical lexically, but conflates two genuinely different scope models under one keyword — against the `docs/12` naming principle (the name should promise the semantics). `assign` vs `let` makes "forward statement" vs "nested scope" visible at the call site. |
| **A3** | Liquid-faithful: leak past enclosing blocks + mutable re-assign (loop accumulators) | **Rejected** | The document-global leak is a known Liquid footgun and is *unimplementable* against `&ctx` without hoisting an `Option` above every conditional; cross-iteration mutation breaks the borrow model and the "effect-light" property. Trussbars takes the **name** from Liquid and the **scope** from Rust. |
| **A4** | Do nothing — wrap the region in `{{#let}}…{{/let}}` | **The baseline** | Already works, but forces the whole remainder of a region to nest inside a block. A1 is the un-indented form of the identical lowering. |

## 5. Consequences

### 5.1 One node, two spellings, byte-identical across backends
`assign` and `{{#let}}` share the `Let` node and the `let`-emit. The reference `letH`, the AOT
Rust `let`, the VM, and the JS compiler render identically, pinned by the corpus (`--v2`,
`--vm`, `--vm-compat`) and `test:compile`. Adding `assign` cannot diverge a backend without
also diverging `{{#let}}`.

### 5.2 Strictly stricter than Liquid (a documented divergence)
`assign` does not leak past its enclosing block and cannot mutate across scopes. Migrating a
Liquid template that relies on the leak or on a loop accumulator (`docs/15`, the import path)
must rewrite — the importer flags both as located, actionable findings rather than silently
mis-scoping. This is the same "reject the removed form with a located error" discipline the
project applies to dropped surface (CLAUDE.md, ADR-021).

### 5.3 The injection boundary is untouched
`NAME` is a static identifier and `EXPR` is an ordinary expression — no data selects a name or
a code path, so `assign` is inside the boundary (docs/06 §3) by construction. It adds no
computed-name surface.

### 5.4 Governance: nonEmpty-family *surface*, so the oracle gets it first
`assign` is a language/surface construct, not a host concern, so under the project framing
(MaxBars/PureScript is the oracle that defines the surface; Trussbars is the production impl)
it lands in the **RawBars/MaxBars** oracle first (or together), giving the conformance corpus
an authority for every case before Trussbars conforms (docs/12 §5.5).

## 6. Status & sequencing

1. **Surface frozen (§2).** The spelling `{{assign NAME = EXPR}}`, the enclosing-block forward
   scope, shadow-on-rebind, and the reservation rules are fixed here.
2. **Oracle first (§5.4).** `assign` lands as `letH`-backed sugar in RawBars/MaxBars so the
   live oracle renders it; add `assign-*` conformance cases (prologue, in-loop drop, shadow,
   the number-truthiness compile-error, the reserved-name rejection).
3. **Trussbars Rust.** The parser tags an open-ended `Let`; the emitter splices a bare `let`
   into the current block; the VM mirrors it. Corpus on `--v2`/`--vm`/`--vm-compat`; freeze
   (docs/06 §5) amended to list `assign` as IN.
4. **Importer (docs/15).** Map Liquid `{% assign %}` → `{{assign}}`, emitting a located finding
   when the source relies on block-leak or accumulation (§5.2).

## 7. Summary

- `{{assign NAME = EXPR}}` is the **block-less, forward-scoped** sibling of `{{#let}}` — a flat
  binding statement, no body, no close.
- It **reuses the `Let` node and the `let`-emit**; the AOT lowering is a bare Rust `let`, so
  Rust lexical scope provides "live to the enclosing block's close" for free.
- It is **stricter than Liquid by design**: scope does not leak past the enclosing block, and
  there is no cross-scope mutation (no loop accumulators) — preserving the borrow model and the
  effect-light property.
- The keyword is **`assign`** (not a block-less `let`) because, per `docs/12`, a distinct scope
  model deserves a distinct, semantics-promising name.
- It is **nonEmpty-family surface** (RawBars/MaxBars + Trussbars); FullBars and MinBars reject
  it. Oracle-first, conformance-pinned across all backends.
