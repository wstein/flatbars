# Trussbars — v1 Feature Freeze

> **Status: RATIFIED** (v1 surface frozen) · **Audience:** the v2 proc-macro author.
> **Rebaselined against current `develop`** (branch `feat/trussbars-rebaseline`):
> develop's MaxBars dropped the `as |x|` loop form for Liquid binding
> (`{{#each x in xs}}`) and shipped `{{#let}}` and list/dict literals. The v1 emitter
> then closed the surface — `{{#let}}`, list literals, the collection filters
> (`where`/`reject`/`find`/`some`/`every`), and enum context types are all in.
> The conformance harness is **52/52 byte-matched against develop**; the freeze
> below is the v1 surface as it stands.
> **This document is the contract v2 targets.** v2 reimplements the emitter in
> idiomatic Rust; it must accept exactly this surface and produce **byte-identical**
> output (the conformance harness is the witness, docs/04). v2 *adds* mechanism
> (compile-time codegen, error mapping, a host-helper convention) but does **not**
> change the language below without an explicit amendment here. The two surface
> items still **out** of v1 are `dict` literals (need a generated struct) and
> data-carrying-enum field dispatch (a `match`) — both type-aware, deliberately → v2.
>
> **Amended by docs/19 (Proposed) — surface delimiters.** §1's control-flow surface below is
> written in the `{{ }}`/`{{#…}}` spelling. For **RawBars/MaxBars/Trussbars**, docs/19 moves all
> control-flow keywords, separators, and binding statements to Django-style **`{% %}`** (so
> `{{#if}}`→`{% if %}`, `{{#let}}`→`{% local %}` per docs/17, the quad-stache raw block →
> `{% raw %}`); `{{ }}` becomes output-only. ClassicBars/MinBars keep `{{ }}`. The *language* below
> (constructs, value policy, exclusions) is unchanged — only the delimiters — so the byte-identity
> contract holds. **Governance:** `{% %}` is a *surface* decision, which docs/12 §5.5 places with
> the **oracle** (PureScript RawBars/MaxBars); docs/17–19 are Trussbars's conformance view of that
> decision, not its authority. **The §1 spellings below are now the `{% %}` surface** (docs/19
step 4 landed — the Rust `trussbars-template` lexer reads `{% %}` and the corpus is migrated;
the literal *verbatim region* is now `{% raw %} … {% endraw %}` per ADR-039 item 2, while a
raw-block *helper* — `{{{{#op}}}}`, head ≠ `raw`, fed to an operation — keeps the quad-stache).

Evidence base: the conformance corpus (`trussbars/conformance/cases.mjs`, 71
byte-matched cases) and the blog/changelog dogfoods (`trussbars/examples/`).
Source of truth for "supported" is the v1 emitter
(`packages/maxbars/src/MaxBars/Rust.purs`); this doc is its human-readable freeze.

## 1. Supported surface (IN)

| Area | Constructs |
| --- | --- |
| **Output** | `{{ x }}` (escaped), `{{{ x }}}` (raw), dotted paths `{{ a.b.c }}` |
| **Reserved scope** | `this`, `root`, `parent`, `outer` (labelled loop), `loop`, `yield` |
| **Conditionals** | `{% if %}` / `{% else %}` / `{% unless %}`; `else if` via the `elif` chain (`{% elif … %}`) |
| **Iteration** | `{% each xs %}` over arrays **and** maps (`groupBy` result) — map iteration binds `loop.key`; Liquid-style block binding `{% each item in xs %}` / `{% each item i in xs %}` (the `as \|…\|` form was removed on develop, ADR/commit `4729026`); `label NAME` after `in`; `{% else %}` empty arm; closes `{% endeach %}` |
| **Loop metadata** | `loop.index0/index1/rindex0/rindex1/first/last/length/key/depth`; `loop.parent` / `loop.root` chains; `outer` via `label NAME` |
| **Context** | `{% with obj %}…{% endwith %}` re-root (needs `#[derive(Trussbars)]` on `obj`'s type) |
| **Local** | `{% local a=(e) b=(e2) %}…{% endlocal %}` — block-scoped sequential aliases (`b` sees `a`), computed once, **never re-roots**; value-bound to a Rust `let` (best for computed scalars; the `let` head is retired per docs-17) |
| **Operators (inline)** | `+ - * / %`, `== != < > <= >=`, `&& \|\| !`, `??` (coalesce), `?:` (first-truthy), `a ? b : c` (ternary) |
| **Pipes** | `{{ x \| f arg }}` desugars to the helper call `f(x, arg)` |
| **Partials** | inline definitions `{% inline "n" %}…{% endinline %}` + use `{{> n}}` / `{{> n ctx}}`; block partials `{% partial "n" %}…{% endpartial %}` with `{{yield}}` |
| **Verbatim region** | `{% raw %}…{% endraw %}` (verbatim body; ADR-039 item 2 — retires the quad-stache `{{{{#raw}}}}`). A raw-block *helper* `{{{{#op}}}}` (op ≠ `raw`, fed to an operation) is the separate, unchanged form. |
| **Literals** | string, number (`f64`), `true`/`false`, `null`, **list `[a, b, c]`** (homogeneous → a Rust array; `Each`/`count` work). Dict `{k: v}` literals are **not** in v1 (see F5). |

**Helper inventory** (monomorphized `trussbars_std::*` calls; `count`/`size`/`length` alias):
- *string* — `uppercase capitalize lowercase trim trimStart trimEnd append prepend replace split startsWith endsWith includes slice truncate reverse`
- *array* — `count at take takeRight join reverse unique includes slice pluck sortBy groupBy`
- *collection filters* (ADR-036/037) — `where reject find some every` (`"key"` truthiness or `"key" "cmp" value`; cmp ∈ gt/gte/lt/lte/eq/ne/startsWith/endsWith/includes). `find` returns `Option`, unwrapped by an Option-aware `{% with %}` (`if let Some`).
- *number* — `abs ceil floor round modulo toFixed toFloat toInt`
- *escaping* — `escapeHtml safe raw`

## 2. Value policy (fixed)

- **Truthiness = `nonEmpty`, numbers excluded** *(the default policy)*.
  `false`/`None`/`()`/`""`/`[]`/`{}` are falsy; everything else non-numeric is truthy.
  **Numbers have no `TruthyIn<NonEmpty>` impl**, so `{% if count %}` is a *compile error* —
  write `{% if count > 0 %}`. (The typed escape from the `0`-truthy vs `0`-falsy dilemma;
  docs/01 §5.3.) A template may opt into the `Liquid`/`Handlebars`/host-defined policies at
  compile time (`truss!(…, truthiness = …)`); only `nonEmpty` is conformance-checked
  (docs/01 §7.1, docs/16).
- **Numbers are `f64`.** Numeric literals emit as `f64`, so a field compared to a
  literal must be `f64` (blog finding F2). Print-only / `groupBy`-key numbers may be `i64`.
- **Escaping** mirrors the reference `escapeHtml`: `& < > " '` → entities; raw/`safe`/
  partial output passes through.
- **Context types** (`#[derive(Trussbars)]`): a struct is truthy iff it has ≥1 field;
  an **enum** is always truthy, and a **fieldless** enum also stringifies to the
  variant name (`Status::Active` → `"Active"`, matching serde's unit-variant form) —
  so `{{status}}` and `{% if (eq status "Active") %}` work. A **data-carrying** enum
  gets truthiness only; variant field-access (`match`) is the §4.1 dispatch, → v2.
- **Names are static.** A template path is the Rust field identifier verbatim — no
  rename layer (blog finding F1). Templates use snake_case to keep Rust idiomatic.

## 3. Out — by design, permanently (the injection boundary)

These are **rejected on purpose** and v2 must keep rejecting them — they are the
"no data chooses code" boundary (docs/01 §1):

- **Computed partials** (`{{> (lookup …)}}`), **computed `lookup`**, **`apply`** — a
  data-derived name selecting code is the SSTI shape.
- **`{{struct}}`** — a context struct has no `ToText`, so stringifying an object is a
  compile error (the typed form of the interpreter's "cannot stringify an object").

## 4. Deferred / open (decide at freeze)

From the blog dogfood (`examples/blog/README.md`); each needs an explicit in/out call:

| ID | Gap | Proposed disposition |
| --- | --- | --- |
| **F3** | **No host-helper registration** (`date`, `markdown`, `pluralize`, i18n `t` all `unsupported`). | **DONE (v2)** — the closed-allow-list host-helper convention (docs/09): `truss!(…, helpers = [date, markdown])` / `#[truss_helpers(…)]` declares the callable host fns, a declared head emits a typed free-function call, an undeclared one is a located `unknown helper` error. Keeps "names static" (only the impl is host-provided). |
| **F6** | Generated module is hand-committed; a `.truss` typo is a Node error, not a `rustc` error at the call site. | **DONE (v2)** — the `truss!` proc-macro compiles templates at build time (`path = "…"` loads from a file) with diagnostics mapped to template spans (docs/07). |
| **F2** | A field compared to a numeric literal must be `f64`. | **DONE** — a numeric literal in operator position emits as `trussbars_core::NumLit`, which coerces against any numeric field type (`views: i64` works with `> 100`); string ordering untouched, string-vs-number is a compile error (docs/20, v2-conformance 71/71). |
| **F4** | `{% local %}` (the `{{#let}}` block, renamed per docs-17) block-scoped sequential aliases — **DONE.** The emitter emits nested `{% local name=(e) %}` as block-scoped Rust `let`s (value-bound; `local-bindings` conformance case). The one limit: binding a non-`Copy` field *directly* (`n=(user.name)`) would move out of `&ctx` — use the field instead. | **CLOSED** (this branch). |
| **F5** | **List literals `[…]` — DONE** (homogeneous → a Rust array; `Each` via a fixed-array runtime impl, `count` via slice coercion; `list-each-int`/`-str`/`-count` cases). **Dict literals `{k: v}` — DONE:** field access (`{{#with {a:1}}}{{a}}`) compiles to a block-local **generic** struct (`struct __Dict<F0,…>`), whose field types are inferred at instantiation — so even the type-blind emitters synthesize it (both v1 and v2; `dict-*` conformance cases gated v-vs-oracle). Truthiness of a dict subject is resolved at compile time (a non-empty literal is always truthy). | **list & dict CLOSED.** |
| **F1** | Template path == Rust identifier (no rename). | **WONTFIX** — it *is* "names are static"; document only. |
| **F7** | A **piped or bare multi-arg application used directly as an `{{#if}}`/`{{#unless}}` condition** is rejected ("options argument") — a `startsWith` applied to the subject fails as a bare condition head, whether written as a pipe or as a prefix call. **Workaround: parenthesize** the call — `{{#if (startsWith x "f")}}` works. Applications work in every position *except* a bare condition head. | **v2, IN (fix)** — the desugar should accept a piped/applied condition without the parens. Found via the changelog dogfood (`examples/changelog`); the parens form is the v1 workaround. |
| **F8** | **Escaping is HTML-only.** `{{ }}` always HTML-escapes, so non-HTML output targets (markdown source, JSON, CSV) get entities — e.g. a commit subject `"x"` becomes `&quot;x&quot;`. Correct when the output is later HTML-rendered (GitHub markdown), literal otherwise. No per-target escaping policy. | **v2, consider** — a target-escape policy (HTML / none / JSON) selected per template, or keep HTML-only and document. Use raw `{{{ }}}` for trusted non-HTML output (XSS-unsafe if later HTML-rendered). Found via the changelog dogfood. |
| **F10** | **`{{#with (block-param).field}}` renders empty in the reference.** `{{#each row in rows}}{{#with row.meta}}…{{/with}}{{/each}}` — a `with` whose subject is a path off a *Liquid block binding* re-roots to nothing in the interpreter (a plain `{{#with x}}` works; a deep path `{{row.meta.lbl}}` works). The v1 emitter likely resolves it (a latent divergence); the corpus avoids it. | **v2, verify** — match the reference (whatever it is) and pin a case, or treat as a reference bug to fix upstream. Found via the corpus-hardening edges. |

## 5. The freeze

**Frozen for v2 as the target surface:** §1 (supported surface) + §2 (value policy)
+ §3 (permanent exclusions). v2 must accept these and match v1 byte-for-byte.

**v2 may ADD, without changing the frozen language:** the host-helper convention
(F3), template-span diagnostics (F6), and — if cheap and non-breaking — the integer
coercion rule (F2). Anything that changes §1/§2/§3 semantics requires an amendment
to this document and a conformance-corpus update first.

**Out of scope for the freeze:** `{{#let}}` (F4, undecided) and collection literals
(F5, deferred) are *not* part of the v2 target surface unless promoted here first.
