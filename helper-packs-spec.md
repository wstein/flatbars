# BareBars Value Primitives & MaxBars Operators — Specification

Status: draft for review · Companion: `loopvars-linter-spec.md`. Truthiness is specified in the truthiness ADR / `Kernel.Value` (not a separate file); the dialect ladder and MinBars live in their respective packages and `CLAUDE.md`, not in standalone `*-spec.md` files.

This spec is **not** a port of `helpers/handlebars-helpers`, and it is no longer organised as a stdlib of packs. `handlebars-helpers` ships 188 helpers because Handlebars has a weak *expression* language: authors need a helper for everything the surface can't say inline. MaxBars already removed most of those reasons (infix operators, pipes, loop variables, the partial/inheritance set). So the question this spec answers is **not** "which helpers do we adopt," but:

> **Which irreducible capabilities are genuinely missing, and at which layer do they belong — a shared prelude primitive, or a MaxBars operator?**

The answer is small: roughly **two dozen irreducible value primitives** in the shared prelude, plus **two MaxBars operator groups** (`??` and arithmetic). Everything else either already exists, or is sugar a pipe already expresses, or is impure and excluded.

---

## 1. The migration criterion (normative)

A capability is worth migrating **only if all four hold**:

1. **Irreducible** — it cannot be composed from what MaxBars already has (pipes `{{ x | f }}`, infix `&& || ! == != < > <= >=`, the prelude `lookup/if/unless/each/with/and/or/...`, the loop variables, `esc_html`/`json`/`safe`/`raw`). If a pipe chain expresses it, it is **sugar, not capability** — do not migrate it.
2. **High-frequency** — it is something templates actually reach for across ecosystems (Liquid/Jinja/Twig/Handlebars), not a library idiosyncrasy. `handlebars-helpers` is used here as a *frequency signal*, never as a source to mirror.
3. **Pure & deterministic** — a pure function of its arguments: no filesystem, network, clock, RNG, or ambient locale. Non-determinism is a *correctness* failure (it breaks referential transparency and golden tests).
4. **Determinism-stable across both targets** — it produces the **same `Value`** in the PureScript interpreter *and* the emitted JS runtime. Every helper is implemented twice and gated byte-identical by `test:compile` (110/110), so a capability that can't be made identical on both targets (see `toFixed`, §4) is not adoptable until it can.

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
| escaping / `json` / `raw` | — | `esc_html` (returns `VSafe`), `esc_json`, `safe`, `raw`, `json` | solved |
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

## 4. The value-primitives module

A **single** module (not seven packs), assembled into the prelude alongside core. Subject is argument 0 throughout. "←x" marks a rename to the universal name; "alias:" lists linter-lowered aliases. The roster is everything that passes §1 — irreducible, high-frequency, pure, target-stable.

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

## 5. MaxBars operators — the capabilities that belong in the *language*, not a helper

Two high-frequency needs read far better as operators, and follow the exact pattern MaxBars already uses for `&&`→`and`: a surface operator desugaring to a shared prelude helper. The helper is the irreducible primitive (callable explicitly in RawBars); the operator is the MaxBars ergonomics.

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

- Desugar to the shared prelude helpers `add subtract multiply divide modulo` (the irreducible primitives), the same way `>` desugars to `gt`. Standard precedence (`* / %` above `+ -`, both above comparison, all above `&&`/`||`).
- The helpers live in the shared prelude so RawBars/FullBars keep the explicit `(add a b)` form (aliases `plus`/`minus`/`times` lowered by the linter).
- Division by zero and non-numeric operands follow the engine's existing numeric-coercion/error policy — no new semantics, just surface.

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

- **Casing:** single-word names lowercase (`trim`, `join`, `round`); multi-word camelCase (`truncate` is one word; `startsWith`, `trimStart`). **snake_case is banned** (the one offender is handled in §8).
- **Canonical + alias:** where the source ships duplicates, one is canonical and the other a linter-lowered alias: `lowercase` (not `downcase`), `uppercase` (not `upcase`); the arithmetic helpers carry `plus`/`minus`/`times` aliases. Aliases render correctly and normalise to canonical in committed form.
- **Universal over idiosyncratic:** `trimStart`/`trimEnd` (not `trimLeft`/`trimRight`), `includes` (not `inArray`), `at` (not `itemAt`), `count`/`size` (not a fourth spelling).
- **Keep what BareBars has right:** `and or not eq ne gt gte lt lte lookup if unless each with trim round raw json` — no churn; keep `ne` (do **not** adopt `is`/`isnt`). (`first`/`last`/`length`/`key` exist as the **loop variables** — §4 reserved-names note — not collection helpers.)

---

## 8. `esc_html` → `escapeHtml` (orthogonal rename — separate decision)

This is independent of the migration question; it is the one snake_case name in the prelude and the default escaper (woven through the FullBars desugar output, `Kernel.Lower`, the compiler `Emit`, the JS runtime, the conformance corpus, **and the shipped linter's pretty-printers**, ~60 occurrences). Proposal, pending sign-off:

- `escapeHtml` becomes canonical (HTML-escapes `& < > "` plus `'`; returns `VSafe`; idempotent).
- **`esc_html` is retained as a permanent, non-warned alias.** Renaming a security primitive's name baked into the desugar and the compiler is a breaking change whose only danger is *removal*; a permanent alias makes the blast radius zero while giving new code the consistent name. (This corrects the earlier "deprecated/warned" framing — do not schedule removal.)
- `escape` stays distinct (URL-escape, deferred with the `url` set); `json` gains alias `stringify`.

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

### P0 — the helper triple + the criterion gate
A migrated helper is not a bare function: the engine runs on the registry `prelude` **and** the parallel validator `preludeSchema` (`{ block, arity }`), **and** `test:compile` requires a JS-runtime implementation the compiler can emit. So each entry is a triple:

```purescript
type PrimEntry m =
  { helper :: Helper m                               -- interpreter implementation
  , schema :: { block :: Boolean, arity :: Arity }   -- feeds preludeSchema
  , emit   :: EmitBinding                            -- compiler/runtime binding (test:compile)
  }
```

`mkPrelude :: { primitives :: Boolean } -> Either Conflict { prelude, schema, runtime }` assembles registry + schema + runtime **together** (so `check:catalog` and `test:compile` can't drift), with conflict detection that also rejects collisions against the **reserved loop names** (§4).
- **Acceptance:** a duplicate or reserved-name collision is a `Conflict`; **core prelude with `primitives:false` renders a template** (the primitives are genuinely optional, tested not asserted); `check:catalog` + `test:compile` green.

### P1 — string + number primitives
The §4 string roster and `abs`/`round`/`floor`/`ceil`/`toInt`/`toFloat`/`toFixed`, subject-first; alias lowering (`downcase`/…).
- **Acceptance:** golden tests per primitive across all three surfaces (RawBars call, FullBars curly, MaxBars pipe); `toFixed`/`toFloat` rounding pinned and identical on interpreter and JS.

### P2 — array primitives (incl. the §6 key-based design)
`join`/`count`/`at`/`take`/`takeRight`/`reverse`/`unique`/`includes`; key-based `sortBy`/`pluck`/`groupBy`. No callback or block forms.
- **Acceptance:** key-path sorting/plucking/grouping; stable sort identical on both targets; no callback API exists; `reverse` polymorphism decided by golden test (else split string/array).

### P3 — MaxBars operators
`??` ⇒ `(coalesce …)`; arithmetic `+ - * / %` ⇒ `(add/subtract/multiply/divide/modulo …)` with standard precedence. Surface-only desugar (`MaxBars.Expr`), the same seam as the comparison operators; the lift/lower linter learns the new operator↔helper rows.
- **Acceptance:** `{{ a ?? b ?? "x" }}` and `{{ price * qty + tax }}` render correctly; lower (X0) emits the explicit calls; lift (X3) re-sugars them; render-equivalence holds.

### P4 — guarded/deferred (on demand)
`regex` behind a step limit; safe `JSONparse`; a `date` pack with an injected clock; the `url`/object/locale sets if frequency justifies clearing §1.

---

## 12. Open decisions

1. **`reverse` polymorphism** — one helper over string+array (fewer names) only if a golden test proves identical `Value` semantics on both targets; otherwise split. *(`length` overloading is no longer open — `length` is the loop var, `count` the collection reducer.)*
2. **Alias retention policy** — how long lowered aliases (`downcase`, `plus`, …) live, and whether the linter auto-rewrites on save or only warns. (`esc_html` is settled: permanent, non-warned — §8.)
3. **Arithmetic operand policy** — confirm division-by-zero / non-numeric behaviour reuses the engine's existing numeric policy unchanged (no new error kinds).

Resolved and removed from this list: pipe argument position (subject-as-argument-0, shipped); `default` semantics (→ the `??` operator, null-coalescing only); block-vs-key duplication (block forms dropped, §6).
