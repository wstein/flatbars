# Trussbars — `{% set %}` (forward) & `{% local %}` (bounded): scope-named bindings

> **Read `docs/19` first.** This ADR is written in the Django-style `{% %}` statement-tag surface
> that `docs/19` defines; the conceptual dependency runs 19 → 17 → 18 even though the numbering
> runs the other way. `{% set %}`/`{% local %}` presuppose that surface.
>
> **Status:** **Proposed** — supersedes the earlier `assign`/`let` naming. The two binding
> forms are renamed so **the keyword states the scope**: `{% set name = expr %}` binds into the
> *current* scope and flows forward to its close; `{% local name = expr %}…{% endlocal %}` opens
> a *bounded* region the binding is local to. The keyword **`let` is retired** (§4). Reference
> (to be added/renamed): nullary-installing engine handles in the **nonEmpty-family surface
> (RawBars/MaxBars)**; `local` is the renamed existing block-`let` (`letH`), `set` its block-less
> sibling. Trussbars lowers both to a Rust `let` — `local` inside a fresh `{ }`, `set` spliced
> into the current block. **Audience:** whoever extends surface binding. Companions: `docs/19`
> (the `{% %}` statement-tag surface these live in), `docs/18` (`{% capture %}` — shares `set`'s
> forward scope), `docs/06` (the freeze — the `let`→`local` rename is an amendment), `docs/01`,
> `docs/04`, `docs/12` (the naming principle), `docs/16` (truthiness).
>
> **Naming (the point of this ADR).** A binding keyword should telegraph its **scope**, not its
> mechanism. `set` = "set a value and carry on" — the *forward, current-scope* binding (Jinja's
> `{% set x = e %}` is exactly this). `local` = "this name is *local* to here" — the *bounded*
> binding, confined to its `{% local %}…{% endlocal %}` region. The pair reads as the scope
> contrast directly: `set` flows on, `local` is confined. `let` is dropped because a block-scoped
> `let` is **backwards** from the universal convention (Rust/ML/JS `let` is forward-scoped), so it
> mis-signalled scope — the exact complaint this ADR fixes.
>
> **"`let` retired" means the *surface keyword*, not the mechanism.** Authors no longer write
> `let`. The *lowering target* is still a Rust `let` (both `set` and `local` emit one), and the
> *oracle operation* is still `letH` — those are implementation names, unchanged. So "reuses the
> `let`-emit" / "`letH`-backed" below refer to the mechanism, not a surface form.

## 1. Context

The nonEmpty family has two genuine binding needs:

1. **Bounded** — "a temporary I need *only in this section*," discarded at the region's end.
   This is today's block-`let` (docs/06 §1, F4): sequential, computed-once aliases that never
   re-root, value-bound to a Rust `let` inside the `{ … }` the block opens.
2. **Forward** — "set a value up front and use it throughout the rest of the enclosing region,"
   without wrapping that whole region in a block and indenting it.

```text
{% set full_name = (append (append first " ") last) %}
{% set greeting  = (append "Hello, " full_name) %}

<h1>{{ greeting }}</h1>
... many lines, all of which see full_name / greeting ...

{% local tmp = (heavy expr) %}
  ... only this region sees `tmp` ...
{% endlocal %}                       {# `tmp` is gone here #}
```

The old names inverted intuition: the *bounded* one was `let` (which everywhere else means
*forward*), and the forward one had no first-class form (or the Liquid-borrowed `assign`). This
ADR renames so the keyword names the scope, and retires `let`.

The governing question is **not** "should templates have mutable variables?" (they must not —
§4 A3, the borrow/purity boundary) but "what are the two scopes, and what do we call them?"

## 2. Decision

Two bindings, named for their scope. Both are **nonEmpty-family + Trussbars** and live in the
`{% %}` statement-tag surface (`docs/19`):

**`{% set NAME = EXPR %}` — forward, current scope.** Binds `NAME` from its own position to the
close of the *enclosing block*. Block-less: no `{% endset %}`.

- `NAME` is a static identifier; `EXPR` is any expression (operators, pipes, filters, calls).
- **Scope is the enclosing block, forward only.** A top-level `{% set %}` is live to the end of
  the template; a `{% set %}` inside `{% each %}`/`{% if %}`/`{% with %}`/`{% local %}` is live
  to that block's close and **does not leak past it** — Rust lexical scope. This is a *deliberate
  divergence from **Liquid*** (whose `assign` persists into the whole document) but is
  **equivalent to Jinja's** `{% set %}`, which is already block-scoped — a `set` inside a Jinja
  `{% for %}` likewise does not survive the loop (Jinja's `namespace()`-or-nothing gotcha). So we
  match Jinja and tighten only Liquid.
- **Re-setting a name in the same block shadows** (a fresh binding), like a second Rust
  `let x = …;`. It does **not** mutate the prior binding and never reaches across a block
  boundary — so the loop-accumulator idiom (`{% set total = total + 1 %}` inside `{% each %}`)
  is **not** expressible. Intentional (§4 A3); use a fold-style helper for accumulation.

**`{% local NAME = EXPR [N2 = E2 …] %}…{% endlocal %}` — bounded.** The renamed block-`let`:
sequential, computed-once aliases (`N2` sees `NAME`) that never re-root, live only inside the
block, discarded at `{% endlocal %}`.

Common to both:

- **`NAME` may not shadow a reserved scope name** (`this`, `root`, `parent`, `outer`, `loop`,
  `yield`) **nor a built-in block head** (`if`/`each`/`with`/`local`/`case`/`inline`/`partial`)
  — a located error, mirroring the `case` reservation (`docs/12 §5.2`).
- **Truthiness and types** (docs/06 §2): value-bound, type inferred; a bound number has no
  `TruthyIn<NonEmpty>` impl, so `{% if bound_n %}` is a compile error — write `{% if bound_n > 0 %}`.

## 3. The lowering (concrete)

Both build the **same binding node**; they differ only in whether it opens a fresh scope. `local`
is the node today's block-`let` builds; `set` is that node tagged *open-ended* — it has no
delimited body, so its "body" is the remainder of the enclosing block's node list. That is a
**small but nonzero** parser change: a `Let` variant (or an `open_ended: bool` flag) plus a
parse-time step that captures the sibling tail as the binding's scope. Not a new *kind* of node,
but not free — budget it.

The AOT emitter:

```text
{% local x = e %}…body…{% endlocal %}   →   { let x = e; …body… }     // fresh Rust block
{% set   x = e %}                        →   let x = e;  (spliced into the current block,
                                                          live to its closing brace)
```

```text
{% each post in posts %}
  {% set slug = (lowercase (replace post.title " " "-")) %}
  <a href="/{{ slug }}">{{ post.title }}</a>
{% endeach %}
```

```rust
for post in (&ctx.posts).iter() {
    // {% set slug = … %}  →  a let in the loop-body block, live to the brace below
    let slug = trussbars_std::lowercase(trussbars_std::replace(&post.title, " ", "-"));
    out.push_str("<a href=\"/");
    out.push_str(&trussbars_std::escape_html(&slug));
    out.push_str("\">");
    out.push_str(&trussbars_std::escape_html(&post.title));
    out.push_str("</a>\n");
}   // ← `slug` drops here; it never leaked out of the loop (the Liquid divergence; matches Jinja)
```

The F4 caveat carries over to both: binding a non-`Copy` field *directly* (`{% set n = post.title %}`)
would move out of `&ctx` — bind a computed/owned value, or reference the field. `set`
overwhelmingly binds *computed* values (owned `String`/`f64`), so it hits this less than aliasing.

In the PureScript oracle, `local` is the existing `letH` (renamed); `set` is `letH`-backed sugar
that installs `NAME` as a nullary operation in the *current* frame (not a pushed child), so
siblings resolve it and the frame's close discards it. The JS compiler and VM mirror both; every
backend is pinned byte-for-byte by the corpus. Both belong to the **nonEmpty family — RawBars and
MaxBars**. **FullBars** (Handlebars-faithful) and **MinBars** (Mustache) get **neither**: FullBars
already rejects block-`let` on its strict surface (`checkSurfaceStrict`, ADR-024) and rejects `set`
likewise, pointing at `{% with %}`/Handlebars idioms; in MinBars they are ordinary text.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **`set` (forward) + `local` (bounded)** | **Chosen** | Each keyword names its scope; `set` has the exact Jinja precedent for forward binding, `local` plainly marks the confined region. Both reuse the one binding node — no runtime, no new AST. |
| **A2** | Keep `let` for one of them | **Rejected** | `let` is forward everywhere (Rust/ML/JS) but was *bounded* here — it mis-signalled scope (the complaint). Reusing it for *forward* would also clash with FullBars's Handlebars-`{{#let}}` rejection narrative. Retire it. |
| **A3** | Liquid-faithful: document-wide leak + mutable re-set (loop accumulators, Liquid; Jinja via `namespace()`) | **Rejected** | The Liquid-style leak is unimplementable against `&ctx` without hoisting an `Option` above every conditional; cross-iteration mutation breaks the borrow model and the effect-light property. We take the **name** (`set`) and the **block scope** from Jinja, and reject only Liquid's wider leak + Jinja's `namespace()` escape hatch. |
| **A4** | `set` only — drop the bounded form | **Rejected** | The bounded `local` earns its keep: it confines a temporary so it can't pollute the rest of the region (and auto-drops). Both scopes are real needs (§1). |

## 5. Consequences

### 5.1 One node, two scope-named spellings, byte-identical across backends

`set` and `local` share the binding node and the `let`-emit. The reference handle, the AOT Rust
`let`, the VM, and the JS compiler render identically, pinned by the corpus (`--v2`/`--vm`/
`--vm-compat`) and `test:compile`. Neither can diverge a backend without diverging the other.

### 5.2 `let`→`local` is a freeze amendment (a rename, not a new feature)

The bounded binding already shipped as block-`let` (docs/06 F4, byte-matched). This ADR **renames
it to `local`**; semantics are unchanged. The `flatbars migrate` codemod (docs/15, docs/19)
rewrites `{{#let …}}`/`{% let … %}` → `{% local … %}…{% endlocal %}`, and `checkSurfaceStrict`
rejects the old `let` spelling in the nonEmpty surface with a located pointer to `local`.

### 5.3 Scope matches Jinja; stricter than Liquid (a documented divergence)

`set` is block-scoped — **equivalent to Jinja's** `{% set %}` — so it does not leak past its
enclosing block and cannot mutate across scopes. It is stricter only than **Liquid**, whose
`assign` persists document-wide and supports loop accumulators. Migrating a *Liquid* template that
relies on that wider leak or an accumulator (docs/15) must rewrite; a *Jinja* template that leans
on `namespace()` for cross-scope mutation likewise has no equivalent here. The importer flags both
as located findings rather than silently mis-scoping.

### 5.4 The injection boundary is untouched

`NAME` is static and `EXPR` is an ordinary expression — no data selects a name or a code path, so
both bindings are inside the boundary (docs/06 §3) by construction.

### 5.5 Governance: nonEmpty-family *surface*, oracle-first

A language/surface change, so it lands in the RawBars/MaxBars oracle first (rename `letH`'s surface
to `local`; add the `set` sugar), giving the corpus an authority before Trussbars conforms
byte-for-byte (docs/12 §5.5).

## 6. Status & sequencing

1. **Surface frozen (§2).** `{% set NAME = EXPR %}` (forward) and `{% local … %}…{% endlocal %}`
   (bounded), the reservation rules, and the retirement of `let` are fixed here.
2. **Oracle first (§5.5).** Rename the block-`let` surface to `local`; add `set` as `letH`-backed
   forward sugar. Add `set-*`/`local-*` cases (prologue, in-loop drop, shadow, number-truthiness
   compile-error, reserved-name rejection, `local` auto-drop).
3. **Trussbars Rust.** `local` keeps the block emit; `set` splices a bare `let`; the VM mirrors
   both. Corpus on `--v2`/`--vm`/`--vm-compat`; freeze (docs/06 §5) amended (`let`→`local`, `set`
   IN).
4. **Migration (docs/15).** Codemod `{{#let}}`/`{% let %}` → `{% local %}`, Liquid/Jinja
   `{% assign %}`/`{% set %}` → `{% set %}` (with the leak/accumulator findings, §5.3).

## 7. Summary

- Two bindings, **named for their scope**: `{% set NAME = EXPR %}` (forward, current scope, flows
  on) and `{% local NAME = EXPR %}…{% endlocal %}` (bounded, confined, auto-dropped).
- **`let` is retired** — block-scoped `let` was backwards from the universal forward-`let`
  convention and mis-signalled scope (the complaint this fixes). `set` takes Jinja's forward
  precedent; `local` states the confined scope.
- Both **reuse the one binding node and the `let`-emit**; `local` opens a fresh Rust `{ }`, `set`
  splices a `let` into the current block. Byte-identical across backends.
- **Scope matches Jinja, stricter than Liquid**: no leak past the enclosing block, no cross-scope mutation —
  preserving the borrow model and effect-light property.
- **nonEmpty-family surface** (RawBars/MaxBars + Trussbars); FullBars and MinBars get neither
  (FullBars already rejects block-`let`, ADR-024). `let`→`local` is a rename/freeze-amendment;
  oracle-first, conformance-pinned.
