# Trussbars — v1 Feature Freeze

> **Status:** Freeze candidate · **Audience:** the v2 proc-macro author.
> **This document is the contract v2 targets.** v2 reimplements the emitter in
> idiomatic Rust; it must accept exactly this surface and produce **byte-identical**
> output (the conformance harness is the witness, docs/04). v2 *adds* mechanism
> (compile-time codegen, error mapping, a host-helper convention) but does **not**
> change the language below without an explicit amendment here.

Evidence base: the conformance corpus (`trussbars/conformance/cases.mjs`, 39
byte-matched cases) and the blog dogfood (`trussbars/examples/blog/`, three
golden-pinned pages). Source of truth for "supported" is the v1 emitter
(`packages/maxbars/src/MaxBars/Rust.purs`); this doc is its human-readable freeze.

## 1. Supported surface (IN)

| Area | Constructs |
| --- | --- |
| **Output** | `{{ x }}` (escaped), `{{{ x }}}` (raw), dotted paths `{{ a.b.c }}` |
| **Reserved scope** | `this`, `root`, `parent`, `outer` (labelled loop), `loop`, `yield` |
| **Conditionals** | `{{#if}}` / `{{else}}` / `{{#unless}}`; `else if` via the `elif` chain |
| **Iteration** | `{{#each xs}}` over arrays **and** maps (`groupBy` result) — map iteration binds `loop.key`; block params `as |item|` / `as \|item i\|`; `{{else}}` empty arm |
| **Loop metadata** | `loop.index0/index1/rindex0/rindex1/first/last/length/key`; `loop.parent` / `loop.root` chains; `outer` via `label NAME` |
| **Context** | `{{#with obj}}` re-root (needs `#[derive(Trussbars)]` on `obj`'s type) |
| **Operators (inline)** | `+ - * / %`, `== != < > <= >=`, `&& \|\| !`, `??` (coalesce), `?:` (first-truthy), `a ? b : c` (ternary) |
| **Pipes** | `{{ x \| f arg }}` desugars to the helper call `f(x, arg)` |
| **Partials** | inline definitions `{{#inline "n"}}…{{/inline}}` + use `{{> n}}` / `{{> n ctx}}`; block partials `{{#partial "n"}}…{{/partial}}` with `{{yield}}` |
| **Raw blocks** | `{{{{#raw}}}}…{{{{/raw}}}}` (verbatim body) |
| **Literals** | string, number (`f64`), `true`/`false`, `null` |

**Helper inventory** (monomorphized `trussbars_std::*` calls; `count`/`size`/`length` alias):
- *string* — `uppercase capitalize lowercase trim trimStart trimEnd append prepend replace split startsWith endsWith includes slice truncate reverse`
- *array* — `count at take takeRight join reverse unique includes slice pluck sortBy groupBy`
- *number* — `abs ceil floor round modulo toFixed toFloat toInt`
- *escaping* — `escapeHtml safe raw`

## 2. Value policy (fixed)

- **Truthiness = `nonEmpty`, numbers excluded.** `false`/`None`/`()`/`""`/`[]`/`{}`
  are falsy; everything else non-numeric is truthy. **Numbers have no `Truthy` impl**,
  so `{{#if count}}` is a *compile error* — write `{{#if count > 0}}`. (The typed
  escape from the `0`-truthy vs `0`-falsy dilemma; docs/01 §5.3.)
- **Numbers are `f64`.** Numeric literals emit as `f64`, so a field compared to a
  literal must be `f64` (blog finding F2). Print-only / `groupBy`-key numbers may be `i64`.
- **Escaping** mirrors the reference `escapeHtml`: `& < > " '` → entities; raw/`safe`/
  partial output passes through.
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
| **F3** | **No host-helper registration** (`date`, `markdown`, `pluralize`, i18n `t` all `unsupported`). | **v2, IN** — design a *typed* host-helper convention (a trait or attribute the proc-macro resolves). The single highest-value addition; keeps "names static" (the helper name is still written in the template, only its impl is host-provided). |
| **F6** | Generated module is hand-committed; a `.truss` typo is a Node error, not a `rustc` error at the call site. | **v2, IN (the motivation)** — compile-time codegen with diagnostics mapped to template spans (spike: docs/07). |
| **F2** | A field compared to a numeric literal must be `f64`. | **v2, consider** — an integer-literal coercion rule so `views: i64` works with `> 100`. Small, optional. |
| **F4** | `{{#let}}` does not parse (ADR-024). | **Open** — decide IN/OUT at freeze; re-piping is the current workaround. |
| **F5** | No collection/`dict` literals (`{{#each (dict …)}}`). | **Deferred** — low value for typed hosts (build the collection in Rust); revisit for dashboard-style use. |
| **F1** | Template path == Rust identifier (no rename). | **WONTFIX** — it *is* "names are static"; document only. |

## 5. The freeze

**Frozen for v2 as the target surface:** §1 (supported surface) + §2 (value policy)
+ §3 (permanent exclusions). v2 must accept these and match v1 byte-for-byte.

**v2 may ADD, without changing the frozen language:** the host-helper convention
(F3), template-span diagnostics (F6), and — if cheap and non-breaking — the integer
coercion rule (F2). Anything that changes §1/§2/§3 semantics requires an amendment
to this document and a conformance-corpus update first.

**Out of scope for the freeze:** `{{#let}}` (F4, undecided) and collection literals
(F5, deferred) are *not* part of the v2 target surface unless promoted here first.
