# Trussbars — Language Subset Specification

> **Status:** Draft / normative-intent · **Audience:** the `rustEmit` backend, the v2
> proc-macro, the Rust runtime crates, and the conformance harness.
> **Companion docs (planned):** `02-runtime-api.md` (the `trussbars-core` / `trussbars-std`
> surface), `03-conformance.md` (the cross-language harness).
>
> **The name.** A *truss* is a rigid framework assembled from bars — statically
> determinate, load-bearing, fixed at build time, nothing shifts under load. That is
> static typing as a structural metaphor, and it is the thesis of this project: the
> template's shape is resolved and checked at compile time, with no runtime wobble. You
> *truss* your FlatBars templates into compiled Rust.
>
> **File extension.** Trussbars templates carry the **`.truss`** extension. A `.truss`
> file is MaxBars source (this subset), so the FlatBars editor tooling — the VS Code and
> JetBrains plugins, the TextMate grammar, and the LSP — recognises `.truss` as MaxBars
> and highlights it through the same `source.flatbars` grammar (single-sourced from
> `editors/shared/sync.mjs` LANGUAGES).

This document defines **Trussbars**: the dialect a MaxBars→Rust compiler accepts and
emits. It is *not* a second template engine and *not* a port of the FlatBars construction
kit. It is the **statically-typed subset of MaxBars** that a Rust compiler can render to
straight-line, monomorphized Rust with **no interpreter and no runtime AST walk**.

It is the contract the v1 `rustEmit` backend targets and the v2 proc-macro must match.

---

## 1. The organizing principle

> **Names are static. Data is dynamic. The two never cross.**

Every exclusion below is a consequence of this one rule. A *name* is the head of an
application, a partial name, a helper name, or a field path — anything that selects
*which operation runs* or *which value is read*. In Trussbars a name is always written
into the template and resolved at compile time. **No name may be computed from data.**

This rule is reached independently from two directions, and they coincide exactly:

- **From the type system.** Rust cannot field-access a struct by a runtime `String`, nor
  call a function whose name is a `String`, without reintroducing a dynamic dispatch table
  — i.e. an interpreter. So *statically resolvable* ⟹ *no data-derived names*.
- **From security.** "Data chooses which template/helper runs" is the server-side template
  injection (SSTI) / confused-deputy shape. Eliminating data-derived dispatch removes that
  hazard class outright. So *injection-safe* ⟹ *no data-derived names*.

The safety property and the typing property are **the same boundary**. The subset is
therefore not "MaxBars minus the inconvenient parts" — it is the closure of a single law.

---

## 2. Relationship to MaxBars

Trussbars ⊊ MaxBars. The surface grammar, operator precedence, reserved-scope model, and
prelude semantics are inherited unchanged **except** where this document marks a construct
*Out* or *Changed*. Concretely, Trussbars inherits, verbatim:

- The two-entry-point precedence ladder (expression vs. block head) and all infix
  operators — `+ - * / % == != < > <= >= && || ! ?? ?: ? :` and pipe `|` — desugaring to
  prelude calls. (Source of truth: `packages/maxbars/src/MaxBars/Expr.purs`.)
- The reserved-scope variable model — `this`, `loop`, `root`, `parent`, `outer`, `yield`
  — and the loop-metadata object. (ADR-021.)
- The `nonEmpty` truthiness rule. (ADR-022; see §7.)
- The prelude / stdlib operations. (`packages/kernel/src/Kernel/Prelude.purs`; see §6.)

It does **not** inherit the FlatBars kit: there is no dialect seam, no `parseExpr`
indirection, no truthiness-policy switch, no support for other dialects' spellings
(`{{#*inline}}`, `{{^}}`, `{{&}}`, `partial-block`, set-delimiters) — MaxBars already
rejects those, and Trussbars hard-codes the MaxBars front-end.

---

## 3. The bright line, stated formally

A construct is **admissible** iff every name it introduces is resolvable from the template
text and the statically-known context type alone, without consulting a runtime value.

| Name kind | Admissible form | Inadmissible form |
| --- | --- | --- |
| Field path | `{{user.name}}`, `{{loop.index0}}` (written path) | `{{lookup this k}}` where `k` is data |
| Partial | `{{> card}}` (written name) | `{{> (lookup this "kind")}}` (computed) |
| Helper | `{{multiply price qty}}` (written name) | `{{apply opName x}}` (name from data) |
| Block head | `{{#each items}}` (written name) | — (heads are always names in MaxBars) |

---

## 4. Excluded constructs (the *Out* set)

All three exclusions are instances of §1. Each is **intentionally unsupported on
injection-safety grounds**, not merely unimplemented — the conformance report (§11) must
say so.

### 4.1 Computed partial names — `{{> (expr)}}`

**Status:** Out (injection-class).

`{{> (lookup this "kind")}}` lets *data* select which partial renders. With any
attacker-influenced field, this reaches the entire partial registry — an SSTI / confused-
deputy hazard. It is the eval-shaped construct of the language.

**Replacement — keep the use case (polymorphism), drop the mechanism.** The legitimate
goal is "render each item by its type." Express it as a **closed sum type + exhaustive
match**, decoding the tag at the deserialization boundary:

```rust
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Person { Author(Author), Engineer(Engineer) }
```

`{{> this}}` over a `Person` compiles to a `match` that calls the statically-known
`author` / `engineer` template for each variant. This is **strictly safer and stronger**
than the dynamic form: no string, no registry probe, and `rustc` *forces* a new `kind` to
be handled. (Trait-object dispatch — each item implements a `Render` trait — is an
equivalent admissible mechanism.)

### 4.2 The `apply` meta-helper

**Status:** Out (injection-class).

`apply` calls a helper *named by a string argument*
(`apply: (a, f) => call(stringify(a[0]), …)` in `packages/compile/runtime/flatbars-runtime.mjs`).
It is the helper-dispatch analogue of §4.1 — data selecting which operation runs — and
falls under the same rule. Only statically-written helper names are admissible.

### 4.3 Computed `lookup` on a record

**Status:** Out, with one admissible exception.

`{{lookup this fieldNameFromData}}` is a data-derived field name. Inadmissible against a
struct. **Admissible exception:** when the lookup target is a **typed map**
(`BTreeMap<String, T>`), `lookup` returns `Option<&T>` and the author handles the `None`
explicitly — this is a value read with a *typed* result, not a name crossing into the
type system. Written-path lookup (`{{lookup user "name"}}` with a literal key) is
admissible and equivalent to `{{user.name}}`.

---

## 5. Changed semantics (the *Changed* set)

### 5.1 Missing key → compile error (was: empty string)

In MaxBars, a missing key renders empty (`name=[{{name}}] missing=[{{nope}}]` →
`missing=[]`). In Trussbars, `{{nope}}` against a context type without a `nope` field is a
**`rustc` compile error**, with a span.

This is an **intentional, stricter contract**, not a regression. It is the direct
consequence of the type boundary, and it converts a silent-empty footgun into a caught
mistake. *Optional* fields are still expressible: model them as `Option<T>` and handle
absence explicitly (e.g. `{{name ?? "anonymous"}}`, see §6 coalescing). The difference is
that absence becomes **declared in the type**, not implicit in every access.

### 5.2 Error model generally

Because the template is fully known at compile time and helper dispatch is ordinary Rust
name resolution, the following MaxBars *runtime* errors become **compile-time** errors for
free (no special machinery — they are just `rustc`):

- `UnknownHelper` → "no function named `X`".
- `ArityError` (for fixed-arity helpers) → wrong number of arguments.
- `TypeError` (e.g. arithmetic on a non-number) → Rust type mismatch.

Variadic-helper arity (`and`, `or`, `coalesce`, `dict`) and the typed-map `lookup` of §4.3
remain checked at their natural point (still in Rust, still without an interpreter).

### 5.3 Numeric truthiness → compile error

A bare number in boolean position — `{{#if count}}`, `{{!stock}}`, `{{n ?: x}}`,
`{{n ? a : b}}` — is a **compile error**. The author must state intent with an explicit
comparison: `{{#if count > 0}}`, `{{#if count != 0}}`.

Rationale: MaxBars's `nonEmpty` rule makes `0` *truthy*; Handlebars makes `0` *falsy* — each
surprises half its audience, and either way a bare-number condition is ambiguous. The typed
setting escapes the dilemma: rather than pick a rule, Trussbars **rejects the coercion** and
demands the comparison. This is the §5.2 philosophy (footgun → compile error) applied to
truthiness, enforced for free by simply not implementing `Truthy` for numeric types (runtime
API §3). `nonEmpty` still applies to every *non-numeric* type, where emptiness is
unambiguous. (`Option<number>` is likewise rejected; test presence first, then compare:
`{{(count ?? 0) > 0}}`.)

This is the second *changed-contract* divergence from the MaxBars oracle (alongside §5.1),
tracked as such in the conformance report (§11) — and it is a **loud** divergence (a compile
error), never a silent behaviour change.

---

## 6. Fully retained surface (the *In* set)

Everything below is admissible and typed. This is the bulk of the language.

**Output & paths.** `{{x}}` (HTML-escaped), `{{{x}}}` (raw), dotted paths `{{user.address.city}}`,
bracket segments for non-identifier keys `{{[first-name]}}` (emit with `#[serde(rename)]`).
Comments `{{! … }}` / `{{!-- … --}}`.

**Operators (all desugar to prelude calls; emitted as monomorphized Rust):**
arithmetic `+ - * / %` (`add`/`subtract`/`multiply`/`divide`/`modulo`, strictly numeric —
no string `+`); comparison `== != < > <= >=`; logic `&& || !`; null-coalesce `??`
(`coalesce`, first non-null, over `Option`); truthy-coalesce / Elvis `?:` (`firstTruthy`,
first truthy under `nonEmpty`); ternary `? :` (`ternary`). Pipe `a | f x` → `f a x`
(left value prepended). Pipe is omitted from block heads so `as |x|` parses; pipe a head
argument by parenthesising it: `{{#each (xs | f) as |x|}}`.

**Control flow** (emitted as native Rust `if` / `for`): `{{#if}}` / `{{else if}}` /
`{{else}}` / `{{#unless}}`; `{{#each xs}}` over `Vec` and over map (`BTreeMap`, key order
per the interpreter — see §11); `{{#each … else …}}` empty clause; `{{#with}}` re-root.

**Reserved scope & loop metadata** (typed structs / threaded context):
`{{this}}`; `{{loop.index0 index1 rindex0 rindex1 first last length key this}}`;
`loop.parent.*` and `loop.root.*` chains; `{{root.*}}`; `{{parent.*}}` and
`{{parent.parent.*}}` chains; block params `as |item i|`; labelled loops
`label outer` exposing `{{outer.index1 length first …}}`.

**Partials (static names only):** `{{> name}}` and `{{> name ctx}}` as typed template-
function calls; layout partials via `{{#inline "name"}}…{{yield}}…{{/inline}}` +
`{{#partial "name"}}…{{/partial}}` (the hoist pre-pass + yield stack). Polymorphic
dispatch via the §4.1 enum/trait replacement.

**Custom & block helpers** registered **at compile time** (as Rust functions / trait
impls, not runtime `register`): `{{loud name}}`, `{{{link "Home" url="/home"}}}`,
`{{#list people as |p i|}}…{{/list}}`.

**Raw blocks** `{{{{#op}}}}…{{{{/op}}}}` (body passed verbatim to a known helper).

---

## 7. Truthiness — `nonEmpty`, minus numbers

Trussbars has one fixed truthiness rule (no policy switch), applied to **non-numeric** types
only. **Falsy:** `false`, `null` (`None`), `""`, `[]`, `{}`. **Truthy:** every other
non-numeric value. It governs `if`/`unless`/`&&`/`||`/`!`, `?:` (`firstTruthy`), and the
ternary condition.

**Numbers are not coercible to bool** — a bare-number condition is a compile error (§5.3);
write the comparison. `??` (`coalesce`) is *not* truthiness — it tests presence (non-null),
so `""` survives a `??` fallback but not a `?:` one. `Option<String>` of `Some("")` is
**falsy** — absence *and* emptiness both fall through, matching the interpreter.

---

## 8. The data model — schema is ahead-of-time, values are runtime

**Precondition (load-bearing).** Typed compilation requires the host to **declare a context
type** `T` (a `#[derive(Deserialize)]` struct/enum). That type *is* the schema, and it is the
*ahead-of-time* artifact; the **data values are dynamic** and arrive at render time. The two
meet at exactly one seam — **serde deserialization** — which validates/coerces the dynamic
JSON *into* `T` before the compiled `render(&T)` runs. Every compile-time check (missing key
§5.1, numeric truthiness §5.3, helper/arity/type §5.2) is a check on the *declared type*,
which is genuinely known AOT; the value's dynamism is consumed at runtime by the code the
template emits (e.g. the `count > 0` the author was forced to write).

- A template binds to `T`. In v1 the `rustEmit` backend receives the type name via `meta` and
  emits `fn render(ctx: &T) -> String`; `rustc` type-checks the emitted accesses against `T`.
  In v2 the proc-macro sees `T` directly (`#[derive(Template)]`-style).
- `{{user.name}}` → `ctx.user.name` (field access), **not** a runtime probe.
- `{{#each items as |item|}}` types `item` as the element of `ctx.items`
  (`items: Vec<Item>` ⟹ `item: &Item`); loop metadata is a known `Loop` struct.
- `root` is the top-level `&T`; `parent` / `outer` are enclosing context/loop references,
  threaded by lexical nesting.

**Data ↔ schema mismatch policy (strict, with declared optionality).** A required field
absent or ill-typed at render time is a **loud serde deserialization error**, not a silent
empty. **Absence is declared, never implicit:** an optional field is `Option<T>` (or
`#[serde(default)]`), which the author writes deliberately and handles (`{{name ?? "anon"}}`).
This extends the §5.1 principle from the template to the data boundary. The permissive
alternative — missing→`Default`, unknown→ignored — is **rejected**: it re-imports the silent
footgun typing exists to kill.

**Schemaless data is out of scope.** A host that wants to throw an *undeclared* JSON blob at
a template — no context type — is asking for the dynamic engine (the existing PureScript/JS
MaxBars), not Trussbars. This is the same subset trade recurring: Trussbars exchanges
MaxBars's schemaless flexibility for compile-time safety, exactly as it trades away dynamic
partials (§4.1) and missing-key-empty (§5.1). Schema inference (`03-schema-inference.md`)
softens the authoring cost by *deriving* a candidate `T` from the template, but a declared
`T` remains the precondition.

---

## 9. Compilation model (no interpreter, no VM)

The template becomes straight-line Rust: native `if`/`for`, field accesses, and
monomorphized `trussbars_std::*` calls. There is **no `Value` enum interpreted at runtime**
and **no string-keyed dispatch table**. The durable artifacts are the Rust runtime crates
(`trussbars-core` + `trussbars-std`) and the conformance harness; the v1 PureScript
`rustEmit` backend is **scaffolding**, deleted at v2 cutover (when the proc-macro passes
the same harness).

**Crate layout:**

- `trussbars-core` — *implemented*: the `Safe`/`ToText`/`escape_html`/`esc` output layer,
  `nonEmpty` `Truthy` (minus numbers), and the borrowed-reference `Loop` frame model.
  (`coalesce`/`firstTruthy`/`ternary` are *not* here — they are emitted inline by codegen;
  see `02-runtime-api.md` §4.)
- `trussbars-std` — *implemented*: the prelude/stdlib operations as monomorphized functions —
  the string, number, and array packs plus `safe`/`modulo`. (`json`/`escape_json`, the i18n
  `Translator` pack, and `sort_by`/`pluck`/`group_by` are deferred; see `02-runtime-api.md` §9.)
- `trussbars-derive` — *implemented*: the `#[derive(Trussbars)]` companion macro, generating
  the `Truthy` impl for context structs (≥1 field ⟹ truthy). No `ToText` by design, so
  `{{struct}}` stays a compile error; struct-only until §4.1 enum dispatch.
- `trussbars-codegen` — *v1 implemented* as `MaxBars.Rust` (`packages/maxbars/src/MaxBars/Rust.purs`):
  the PureScript MaxBars→Rust emitter, reusing the proven parse + desugar and walking the core AST
  (paths → typed field access, operators → native Rust / `trussbars_std`, `if`/`each`/`with` →
  native control flow) for the vertical slice; verified end-to-end byte-identical by the
  conformance harness (`04-conformance.md`). v2 replaces it with the `trussbars` proc-macro.

---

## 10. Out of scope for v1

- **f64 → string byte-identity** is **achieved** under the default `ecma-float`
  backend (`dragonbox_ecma`), which is ECMA-262 byte-identical to JS `String(n)`
  (`-0`→`0`, `1e21`→`1e+21`, `1e-7`→`1e-7`, `Infinity`, `NaN`) — see
  `02-runtime-api.md` §2. It remains a divergence **only** on the pure
  `--no-default-features` build (Rust `Display`), which the conformance harness
  masks for that profile alone (§11, `04-conformance.md` §7).
- **i18n precision.** `t` / `number` / `date` / `selectPlural` / `relative` are a
  documented host-locale seam with English fallback, exactly as the JS engine treats the
  `translator` seam (ADR-029). Not byte-identical; not a correctness gate.

---

## 11. Conformance posture

The harness renders each case through the PureScript interpreter (the oracle) and the
emitted Rust, and asserts equal bytes — **on the admissible subset only**. It must:

1. **Generate a context type per case** from the case's data JSON, so `rustc` can check
   the emitted accesses.
2. **List excluded cases explicitly**, labelled by reason: *injection-class*
   (§4 — computed partials, `apply`, computed record `lookup`), *changed-contract*
   (§5.1 missing-key, §5.3 numeric-truthiness), *numeric-masked* (§10). The conformance score reports
   "Trussbars implements the data-derived-name-free subset," never a bare case count that
   silently shrank. Same anti-over-claim discipline as the existing `EXCEPTIONS` maps in
   the repo.

---

## 12. Appendix — the 20 documented MaxBars examples, classified

Source: `tutorials/src/maxbars.mjs`. Disposition under this spec:

| # | Example | Disposition |
| --- | --- | --- |
| 1 | Hello (`{{name}}`) | In |
| 2 | Dotted paths | In |
| 3 | Missing keys → empty | **Changed** (§5.1 — compile error) |
| 4 | Escaping (`{{html}}` / `{{{html}}}`) | In |
| 5 | Comments | In |
| 6 | Operator/helper/subexpr identity | In |
| 7 | Pipes | In |
| 8 | `??` / `?:` / ternary | In (optional fields → `Option`) |
| 9 | Conditionals with infix | In |
| 10 | `each` nesting + `root` + `parent` | In (parent/root threaded, §8) |
| 11 | `each` empty clause | In |
| 12 | `each` over object → `loop.key` | In (typed map) |
| 13 | `with` re-root | In |
| 14 | Block params + labelled loops | In (`outer` threaded, §8) |
| 15 | External/**dynamic** partials `{{> (lookup this "kind")}}` | **Out** (§4.1) → enum/match replacement |
| 16 | Layout partials + `yield` | In |
| 17 | Custom & block helpers | In (compile-time registration) |
| 18 | Raw blocks | In |
| 19 | Capstone email | In |
| 20 | HTML card | In |

**Tally:** 17 In · 1 Changed (#3) · 1 Out-with-replacement (#15) · #12 In via typed map.
The single *Out* example is the eval-shaped one — its capability survives via §4.1.
