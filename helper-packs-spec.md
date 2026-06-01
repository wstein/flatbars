# BareBars Value Primitives & MaxBars Operators — Specification

Status: draft for review · Companion: `loopvars-linter-spec.md`. Truthiness is specified in the truthiness ADR / `Kernel.Value` (not a separate file); the dialect ladder and MinBars live in their respective packages and `CLAUDE.md`, not in standalone `*-spec.md` files.

This spec is **not** a port of `helpers/handlebars-helpers`, and it is no longer organised as a stdlib of packs. `handlebars-helpers` ships 188 helpers because Handlebars has a weak *expression* language: authors need a helper for everything the surface can't say inline. MaxBars already removed most of those reasons (infix operators, pipes, loop variables, the partial/inheritance set). So the question this spec answers is **not** "which helpers do we adopt," but:

> **Which irreducible capabilities are genuinely missing, and at which layer do they belong — a shared prelude primitive, or a MaxBars operator?**

The answer is small: roughly **two dozen irreducible value primitives** in the shared prelude, plus **two MaxBars operator groups** (`??` and arithmetic). Everything else either already exists, or is sugar a pipe already expresses, or is impure and excluded.

---

## 1. The migration criterion (normative)

A capability is worth migrating **only if all four hold**:

1. **Irreducible** — it cannot be composed from what MaxBars already has (pipes `{{ x | f }}`, infix `&& || ! == != < > <= >=`, the prelude `lookup/if/unless/each/with/and/or/...`, the loop variables, `escapeHtml`/`json`/`safe`/`raw`). If a pipe chain expresses it, it is **sugar, not capability** — do not migrate it.
2. **High-frequency** — it is something templates actually reach for across ecosystems (Liquid/Jinja/Twig/Handlebars), not a library idiosyncrasy. `handlebars-helpers` is used here as a *frequency signal*, never as a source to mirror.
3. **Pure & deterministic** — a pure function of its arguments: no filesystem, network, clock, RNG, or ambient locale. Non-determinism is a *correctness* failure (it breaks referential transparency and golden tests).
4. **Determinism-stable across both targets** — it produces the **same `Value`** in the PureScript interpreter *and* the emitted JS runtime. Every helper is implemented twice and gated byte-identical by the `test:compile` conformance harness, so a capability that can't be made identical on both targets (see `toFixed`, §4) is not adoptable until it can.

This criterion is the whole design. It is deliberately strict because each primitive costs two implementations + a golden test, and because every new prelude name adds namespace pressure against the scoped loop helpers (we already saw `length`/`count`/`size` collide).

---

## 2. Already solved — do **not** migrate

The bulk of `handlebars-helpers` fails criterion 1 against current `main`. These are not candidates:

| `handlebars-helpers` category | why it is large there | BareBars equivalent | verdict |
|---|---|---|---|
| comparison (`eq` `ifEq` `unlessGt` `compare` `and` `or` …) | Handlebars has no inline booleans | MaxBars **infix** `{{#if a == b && c}}` + prelude `and/or/not/eq/ne/lt/gt/lte/gte` | replaced by a language feature |
| chaining / composition helpers | clumsy subexpressions | MaxBars **pipes** `{{ x \| f \| g }}` | replaced by a language feature |
| data access (`get` `lookup` `with` `withHash`) | — | prelude `lookup`/`get`, `with`, scope | solved |
| iteration meta (`@index` `@first` `forEach` `withFirst`) | — | **loop variables** `index0/index1/rindex0/rindex1/first/last/length/key` (loopvars spec) | solved |
| escaping / `json` / `raw` | — | `escapeHtml` (returns `VSafe`), `escapeJson`, `safe`, `raw`, `json` | solved |
| layout (`extend` `block` `content` `partial`) | — | `partial` / `inline` / `apply` + inheritance | solved |
| `fs` `path` `code`/`gist` `markdown` `i18n` `logging` `date` `random` `sanitize` `regex` | impure / unsafe | — | excluded (§7) |
| `map` `filter` `some` `iterate` (callback) | — | inexpressible: `Value` has no function constructor | rejected (§6) |

That is ~70–75% of the library. The lesson is the inverse of "adopt a pure subset": **one language feature retires N helpers** — and we already did that. Re-importing `ifEq`/`compare`/`pluck`-with-callback would add back the crutches MaxBars exists to remove.

---

## 3. Helper model & the subject-first convention

The capabilities that *do* migrate are ordinary registry helpers receiving `Ctl` (so they reach `env`):

```purescript
type Helper = Ctl M Env -> Array Value -> M Value
```

**Subject-first argument order (normative, and already shipped).** Every transformer takes its *subject* — the value being transformed — as **argument 0**, options following: `uppercase s`, `truncate s n`, `replace s find rep`, `join arr sep`. This is not a proposal: MaxBars's pipe already desugars `a | f` to `(f a)` with the piped value first (Liquid/Jinja filter semantics). So one rule makes all three surfaces coherent:

- direct call (RawBars): `(truncate s 20)` — FullBars: `{{truncate s 20}}`
- pipe (MaxBars): `{{ s | truncate 20 }}` ⇒ `(truncate s 20)` — piped value inserted as argument 0.

**One name set, three surfaces.** A primitive is dialect-agnostic; only the calling surface differs. This is the part of the original pack design worth keeping.

---

## 4. The value-primitives module *(SHIPPED)*

The full roster below is implemented in `Kernel.Prelude.primitiveHelperDefs` + the JS runtime (35 primitives: string, number, array), gated byte-identical by `test:compile` (conformance 210/210). A **single** module (not seven packs), assembled into the prelude alongside core. Subject is argument 0 throughout. "←x" marks a rename to the universal name; "alias:" lists linter-lowered aliases. The roster is everything that passes §1 — irreducible, high-frequency, pure, target-stable.

> **Reserved loop names (normative).** `length`, `first`, `last`, `key` are already registered **nullary** scoped loop helpers (`Kernel.Prelude.preludeSchema`, `arity: Exactly 0`; loopvars spec §A.1). A primitive **must not** redefine them with a different arity — inside a loop the scoped helper wins. So the collection-length reducer is **`count`** (alias `size`), the head/tail slices are **`take`/`takeRight`**, never `length`/`first`/`last`.

### string
| name | signature | notes |
|---|---|---|
| `lowercase` `uppercase` | `(s)` | ←`downcase`/`upcase` (aliases) |
| `capitalize` | `(s)` | first char upper |
| `trim` `trimStart` `trimEnd` | `(s)` | ←`trimLeft`/`trimRight` (ES standard) |
| `split` | `(s sep)` → `VArray` | |
| `replace` | `(s find rep)` | literal, **all** occurrences; `replaceFirst` for one |
| `slice` | `(s start [end])` | substring by index; negatives allowed |
| `includes` | `(s sub)` → `VBool` | substring membership (poly with array) |
| `startsWith` `endsWith` | `(s x)` → `VBool` | |
| *conveniences (composable, kept for frequency)* | | |
| `truncate` | `(s n [suffix])` | by chars; = `slice` + suffix, but ubiquitous |
| `append` `prepend` | `(s x)` | |

### array
| name | signature | notes |
|---|---|---|
| `join` | `(arr sep)` → `VString` | |
| `count` | `(arr)` | collection length; alias `size`. **←not `length`** (reserved) |
| `at` | `(arr i)` | ←`itemAt`; negative index allowed |
| `take` `takeRight` | `(arr n)` | first/last `n` elements (**not** `first`/`last`) |
| `reverse` | `(arr)` | poly with string **iff** a golden test proves identical `Value` semantics on both targets, else split (§11 open) |
| `unique` | `(arr)` | |
| `includes` | `(arr v)` → `VBool` | ←`inArray`; membership |
| `sortBy` `pluck` `groupBy` | `(arr key)` | **key-string**, not a callback (§6) |

### number
| name | signature | notes |
|---|---|---|
| `abs` `round` `floor` `ceil` | `(n)` | `round` pre-exists |
| `toInt` `toFloat` | `(s)` | parse |
| `toFixed` | `(n d)` | **determinism-sensitive** — interpreter (`Number` show) vs JS (`toFixed`) round differently; migrates only with a golden test pinning the rounding mode (§10) |

That is the entire stdlib: ~24 irreducible primitives. There is no `string`/`math`/`url`/`object` pack. `url` (`encodeURI`/`urlParse`/`stripQuerystring`), object reshaping (`merge`/`pick`/`forOwn`), and `addCommas`/`bytes` are **deferred** (§7) — none is irreducible-and-high-frequency enough to clear §1 today, and several are locale-ambient.

---

## 5. MaxBars operators — the capabilities that belong in the *language*, not a helper *(SHIPPED)*

Two high-frequency needs read far better as operators, and follow the exact pattern MaxBars already uses for `&&`→`and`: a surface operator desugaring to a shared prelude helper. The helper is the irreducible primitive (callable explicitly in RawBars); the operator is the MaxBars ergonomics. **Both shipped** — the prelude helpers (`add subtract multiply divide modulo coalesce`), the MaxBars lexer/precedence, the compiler runtime, and the linter lift table; conformance proves compiled ≡ interpreter and the lift re-sugars them back.

### 5.1 `??` — null-coalescing (replaces a `default` helper)
`default v fallback` is the single most-reached-for transformer in every ecosystem. It belongs as an **operator**, not a helper:

```
{{ user.nickname ?? user.name ?? "anon" }}
```

- Desugars to a core `coalesce` helper (`a ?? b` ⇒ `(coalesce a b)`), left-associative, chainable.
- **Null-coalescing only** — returns the left operand unless it is `VNull`. This deliberately sidesteps the truthiness-aware-`default` trap: a truthiness-aware fallback would couple the result to the file's `@truthiness` set and break determinism (criterion 3/4). If a falsy-aware variant is ever wanted it is a separate named helper (`defaultFalsy`), never `??`.
- RawBars/FullBars surface: the explicit `(coalesce a b)` call.

### 5.2 arithmetic infix `+ - * / %` (replaces `add`/`subtract`/`multiply`/`divide`/`modulo` helpers)
MaxBars shipped comparison infix but **not** arithmetic, so `{{ multiply price qty }}` is currently the only way to do math — exactly the helper-proliferation smell. Add arithmetic operators:

```
{{ price * qty }}        {{ subtotal + tax }}        {{ (n + 1) % cols }}
```

- Desugar to the shared prelude helpers `add subtract multiply divide modulo` (the irreducible primitives), the same way `>` desugars to `gt`. Shipped precedence (loosest→tightest): pipe, `??`, `||`, `&&`, comparison (non-associative), additive `+ -`, multiplicative `* / %`, prefix `!`, application/atom — so `n + 1 > 5` is `(gt (add n 1) 5)`.
- The helpers live in the shared prelude so RawBars/FullBars keep the explicit `(add a b)` form. (The `plus`/`minus`/`times` linter aliases are **deferred** — not yet wired.)
- **Strictly numeric** (shipped): operands must be numbers; a non-number is a `TypeError` (no string coercion — determinism). The interpreter is itself JS, so `+ - * /` match the compiled runtime bit-for-bit; `modulo` uses the `trunc` identity (= JS `%`); division by zero is IEEE `Infinity`. A dotted path stays a path (`.` is still an ident char), so `price.net * qty` is unambiguous.

These two operator groups are the **highest-value items in this spec**: together they retire the entire comparison-helper and math-helper surface of `handlebars-helpers` with two small, composable language features.

---

## 6. The no-lambda consequence (`Value` has no functions)

`map`/`filter`/`some` and free-function `sortBy` take a callback. `Value` has no function constructor, so a lambda cannot be passed. These are **not adopted**; instead:

- **Key-based forms** take a **dotted key string**: `sortBy arr "user.age"`, `pluck arr "id"`, `groupBy arr "type"`. The engine reads that path from each element. This covers the overwhelmingly common "by a field" case without functions.
- **No block "callback" helpers.** Block forms like `withSort`/`forEach`/`withFirst` are *redundant with `each` plus a value-returning primitive*: `{{#each (sortBy users "age")}}…{{/each}}`, `{{#each (take xs 3)}}…{{/each}}`. Since `sortBy`/`take` return arrays and compose into `each` (and into pipes), the block variants buy nothing and double the API — drop them.
- **Dropped entirely:** `map`/`filter`/`some` with arbitrary predicates, and `iterate`. A true predicate, if ever needed, would be a future *named-predicate* registry (comparison closures referenced by name), not ambient lambdas — explicitly a "maybe never," not a roadmap item.

This is the honest cost of the no-function-values rule, stated up front.

---

## 7. Naming canon

The references are **lodash** and the **ES string/array standard** — `handlebars-helpers` is too self-inconsistent (`downcase`+`lowercase`, `plus`+`add`, `isnt` with no `ne`) to be the authority.

- **Casing:** single-word names lowercase (`trim`, `join`, `round`); multi-word camelCase (`truncate` is one word; `startsWith`, `trimStart`). **snake_case is banned** — the two offenders (`esc_html`/`esc_json`) were renamed to `escapeHtml`/`escapeJson` and the old names deleted (§8). The prelude is now fully camelCase/lowercase.
- **Canonical + alias:** where the source ships duplicates, one is canonical and the other a linter-lowered alias: `lowercase` (not `downcase`), `uppercase` (not `upcase`); the arithmetic helpers carry `plus`/`minus`/`times` aliases. Aliases render correctly and normalise to canonical in committed form.
- **Universal over idiosyncratic:** `trimStart`/`trimEnd` (not `trimLeft`/`trimRight`), `includes` (not `inArray`), `at` (not `itemAt`), `count`/`size` (not a fourth spelling).
- **Keep what BareBars has right:** `and or not eq ne gt gte lt lte lookup if unless each with trim round raw json` — no churn; keep `ne` (do **not** adopt `is`/`isnt`). (`first`/`last`/`length`/`key` exist as the **loop variables** — §4 reserved-names note — not collection helpers.)

---

## 8. `esc_html` → `escapeHtml`, `esc_json` → `escapeJson` *(SHIPPED — clean break, no aliases)*

Removes the last snake_case names. `esc_html` was not just a name — it is a structural marker woven through the FullBars desugar output, `Kernel.Lower` (escaped-output detection + the safe-producer lint), the compiler `Emit` (inlined to `rt.esc`), the JS runtime, and the linter's lift. The rename threads through every one of those.

- `escapeHtml`/`escapeJson` are the canonical (camelCase) escapers; the desugar emits `escapeHtml` and the structural matchers key on it.
- **The old `esc_html`/`esc_json` names were deleted outright — no back-compat alias.** A first cut shipped them as permanent silent aliases, but they were then removed (the rename had only just landed, so nothing external depended on the old names; a clean break keeps the prelude minimal and avoids carrying snake_case forever). `{{{esc_html …}}}` now fails with `UnknownHelper`. *(If real-world templates ever need the old names, re-introduce them as silent aliases — the `withSilentAlias`/`warn`-flag mechanism is the way, but it is not in the tree today.)*
- `escape` stays distinct (URL-escape, deferred with the `url` set); `json` gains alias `stringify` *(not yet wired)*.

---

## 9. Excluded & deferred (with reasons)

| category / helper | disposition | reason |
|---|---|---|
| `fs`, `path` | **reject** | filesystem; impure; not portable to JS targets |
| `code` (`embed` `gist` `jsfiddle`) | **reject** | fetch remote URLs at render time — SSRF in a template engine |
| `markdown` / `md` | **reject** | file + heavy parser; impure |
| `i18n`, `logging` | **reject** | stateful / side-effecting |
| `html` (`sanitize` `attr` `css` `ul`…) | **reject** | `sanitize` is false-safety unless audited; the rest are niche markup gen |
| `math.random`, `number.phoneNumber` | **reject** | non-deterministic / locale-ambient |
| `map` `filter` `some` `iterate` | **reject** | callback/predicate — inexpressible in `Value` (§6) |
| `date` / `moment` | **defer** | needs `now()`; later as a pure pack with an **env-injected clock** (`Ctl`/`env` plumbing does not exist yet) |
| `url` (`encodeURI` `urlParse` `stripQuerystring`) | **defer** | useful but not yet irreducible-and-frequent enough to clear §1; revisit on demand |
| object reshaping (`merge` `pick` `forOwn`) | **defer** | same; key-based, but lower frequency than the §4 set |
| `number.addCommas/bytes` | **defer** | locale-dependent; later with explicit-locale args |
| `regex` (`test` `toRegex`) | **defer** | ReDoS on user patterns; needs a step-limit guard first |
| `object.JSONparse` | **defer** | injection / prototype-pollution surface; needs safe-parse |

---

## 10. Security & determinism rules (normative)

- **No I/O.** A primitive performs no filesystem, network, clock, or RNG access. Violations are rejected at review.
- **Escaping.** `escapeHtml` is the only HTML escaper; it returns `VSafe` and is idempotent. `raw` and the triple-stache bypass escaping and **must** carry an XSS-surface note in docs. `raw` stays in the core escaping group (alongside `escapeHtml`), not in the primitives module — a security-relevant primitive is not an ordinary string transformer.
- **No false-safety.** `sanitize` is excluded rather than shipped half-strength.
- **Guarded-or-deferred.** `regex` and `JSONparse` stay deferred until a guard (step-limit; safe-parse) is specced.
- **Determinism is an adoption gate, not a late test.** A primitive enters the module only with paired golden tests proving interpreter ≡ JS-runtime output on the same inputs. `round`/`toFixed`/`toFloat` pin their rounding/format mode explicitly.

---

## 11. Implementation plan

### P0 — separability + the criterion gate *(shipped, simplified)*
A helper lives in **two** synced places, not a runtime-assembled triple: a PureScript `HelperDef` (`{ name, block, arity, run }`) that **projects** to both the registry `prelude` and the validator `preludeSchema`, and a hand-written **JS-runtime** entry. The compiler emits a generic `rt.call("name", …)`, so there is no per-helper `emit` binding to assemble — `test:compile` (compiled ≡ interpreter) is the gate that keeps the two places identical, and `check:catalog` keeps the docs in sync with `preludeSchema`. (The originally-specced `PrimEntry { helper, schema, emit }` + `mkPrelude` assembly is therefore *not* built — the monolithic runtime can't honour an emit-per-helper protocol, and the existing gates already prevent drift.)
- **Separability** is realised as a split: `helperDefs = coreHelperDefs <> primitiveHelperDefs` (both exported), with a `coreSchema` projection. **Shipped** with a test that `coreSchema` omits the primitives while `preludeSchema` includes them — the primitives are a genuinely detachable set. A runtime *toggle* (build core-only) is deferred; the split is the foundation it would use.
- **The criterion** (§1) and the **reserved-loop-name** check (§4) are enforced at review, not by a `mkPrelude` conflict pass.

### P1 — string + number primitives
- **String (shipped):** the §4 string roster — `lowercase uppercase capitalize trim trimStart trimEnd split replace slice includes startsWith endsWith truncate append prepend` — subject-first, in `Kernel.Prelude.primitiveHelperDefs` + the JS runtime. Conformance 136→168 (compiled ≡ interpreter); value-pinning interpreter tests; catalog regenerated. Coercion: subject/string-args via `stringify`, numeric args via the strict `asNum`/`trunc`; code-unit indexing; `slice` matches JS exactly.
- **Number (shipped):** `abs`/`round`/`floor`/`ceil` (`Data.Number` FFI = `Math.*`), `toFixed` (`toStringWith (fixed d)` = JS `n.toFixed(d)`), `toInt`/`toFloat` (`Data.Number.fromString` = `parseFloat` gated by `isFinite`; runtime mirrors it; `VNull` on failure, `trunc` for `toInt`). `downcase`/`upcase` aliases land here. toInt/toFloat conformance uses only unambiguous inputs; the parseFloat/`Number()` edge cases are documented-excluded.

### P2 — array primitives (incl. the §6 key-based design) *(shipped)*
`join`/`count` (alias `size`)/`at`/`take`/`takeRight`/`reverse`/`unique`/`includes`; key-based `sortBy`/`pluck`/`groupBy` (dotted key string, no callbacks). No block forms.
- **Shipped:** key-path sorting/plucking/grouping; `sortBy` is a stable sort keyed by `compareValues` (incomparable ⇒ EQ), with a matching -1/0/1 runtime comparator over V8's stable sort. `includes` and `reverse` are **polymorphic** (string + array), type-dispatched on the subject. Conformance 168→210 (compiled ≡ interpreter for every primitive); no callback API.

### P3 — MaxBars operators
`??` ⇒ `(coalesce …)`; arithmetic `+ - * / %` ⇒ `(add/subtract/multiply/divide/modulo …)` with standard precedence. Surface-only desugar (`MaxBars.Expr`), the same seam as the comparison operators; the lift/lower linter learns the new operator↔helper rows.
- **Acceptance:** `{{ a ?? b ?? "x" }}` and `{{ price * qty + tax }}` render correctly; lower (X0) emits the explicit calls; lift (X3) re-sugars them; render-equivalence holds.

### P4 — guarded/deferred (on demand)
`regex` behind a step limit; safe `JSONparse`; a `date` pack with an injected clock; the `url`/object/locale sets if frequency justifies clearing §1.

---

## 12. Open decisions

Still open:

1. **`reverse` polymorphism** — *(now shipped polymorphic; string + array, type-dispatched on the subject — §P2.)* Nothing genuinely open here anymore; kept only as a note that `length` overloading is closed (`length` is the loop var, `count` the collection reducer).

Resolved:

- **Alias retention/lint policy** — **permanent + warn-on-demand**, the uniform alias story: the legacy aliases (`downcase`/`upcase`/`plus`/`minus`/`times`) are permanent working helpers (never removed), marked in `HelperDef.alias` (single source of truth → `preludeAliases`), flagged in the catalog ("alias of `canonical`"), and warned by the on-demand `Linter.Aliases.aliasWarnings` (host/CI, never render-time/blocking); the user-invoked lift/migrate assist rewrites them, but **nothing auto-rewrites on save**. (The escapers `esc_html`/`esc_json` are *not* aliases — they were deleted outright, §8 — so there is no longer a non-warned exception.)
- **Pipe argument position** — subject-as-argument-0 (shipped).
- **`default` semantics** — the shipped `??` operator, null-coalescing only (§5.1).
- **Block-vs-key duplication** — block forms dropped; key-based `sortBy`/`pluck`/`groupBy` only (§6).
- **Arithmetic operand policy** — strict-numeric; a non-number is a `TypeError`, no coercion (§5.2).

> **Status.** §5 operators and the full §4 value-primitives module (35 primitives: string/number/array) are **shipped** — conformance 210/210 (compiled ≡ interpreter), catalog generated, X3 lift re-sugars the operators. Deferred: the §9 sets (`url`/object/locale/`date`/`regex`/`JSONparse`) and a runtime core-only build toggle.
