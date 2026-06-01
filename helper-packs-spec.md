# BareBars Helper Packs — Specification

Status: draft for review · Companions: `rawbars-maxbars-spec.md`, `truthiness-spec.md`, `loopvars-linter-spec.md`, `minbars-spec.md`

This spec defines how BareBars ships a standard library of transformer helpers, and pins the curated, normative name registry. It is **not** a port of `helpers/handlebars-helpers`: that library is a 188-helper kitchen sink, roughly a third of which is impure (`fs`, `code`/`embed`/`gist`, `markdown`, `i18n`, `logging`, `date`/moment), self-inconsistent in naming (`downcase`+`lowercase`, `plus`+`add`, `eq`+`is`, `isnt` with no `ne`), or inexpressible in BareBars's `Value` model (no function constructor ⇒ no callback helpers). We adopt the **pure, deterministic, safe subset** under **lodash/ES-standard names**, organised as separable packs.

---

## 1. Scope & philosophy

- **Packs, not a fat prelude.** The core prelude stays minimal (control, truthiness, `lookup`/`get`, escaping, `each`/`with`). Everything else is a **separable pack** — `string`, `array`, `comparison`, `math`, `number`, `object`, `url` — bundled in the default distribution but importable à la carte. This preserves the substrate role of RawBars and the "every helper is one you supply" thesis.
- **Pure & deterministic only.** A pack helper is a pure function of its arguments. No filesystem, no network, no clock, no RNG, no ambient locale. Non-determinism is a *correctness* failure here (it breaks referential transparency and golden tests), not a style choice.
- **Expressible in `Value`.** Helpers consume and produce `Value` (`VString VNumber VBool VNull VArray VObject VSafe`). Anything that needs a function value (`map`/`filter`/`some` with a callback) is **redesigned** into key-based or block forms (§7), not adopted as-is.
- **One name set, three surfaces.** A pack is dialect-agnostic; only the calling surface differs: RawBars `(uppercase x)`, FullBars `{{uppercase x}}`, MaxBars pipe `{{x | uppercase}}`.

---

## 2. The pack protocol

A pack is a PureScript module exporting a manifest and a helper map:

```purescript
type Pack =
  { name    :: String              -- "string", "array", …
  , version :: String              -- semver
  , helpers :: Map Name Helper     -- canonical names → helpers
  , aliases :: Map Name Name       -- alias → canonical (linter-lowered, §4)
  }

mkPrelude :: Array Pack -> Either PackConflict Prelude
```

- **Merge** unions the helper maps. A name defined by two packs is a `PackConflict` (hard error by default; an explicit `override` list is required to shadow). Aliases that collide with a canonical name are also conflicts.
- **Default bundle** = core prelude + `{ string, array, comparison, math, number, object, url }`. A minimal build can pass only the packs it wants.
- **Versioning.** Packs are semver'd independently of the engine; the manifest lets the linter check that every helper a template set uses is present in the assembled prelude (the "pack availability" check).

The same `Map Name Helper` is consumed unchanged by every dialect — the engine only swaps the surface parser/desugarer.

---

## 3. Helper model & the subject-first convention

Helpers are ordinary registry helpers receiving `Ctl` (so they reach `env`; block helpers also reach the body via `ctl.children`):

```purescript
type Helper = Ctl M Env -> Array Value -> M Value
```

**Subject-first argument order (normative).** Every transformer takes its *subject* — the value being transformed — as **argument 0**, with options following: `uppercase s`, `truncate s n`, `replace s find rep`, `join arr sep`, `default v fallback`. This single rule makes all three surfaces coherent at once:

- direct call: `(truncate s 20)` / `{{truncate s 20}}`
- pipe: `{{s | truncate 20}}` desugars to `(truncate s 20)` — **the piped value is inserted as argument 0** (Liquid/Jinja filter semantics), the rest follow.

Block helpers use the body as their "callback": `withSort arr "name"` renders `ctl.children` once per sorted element (each pushed as context), exactly as `each` does.

---

## 4. Naming canon

`handlebars-helpers` is too self-inconsistent to be the authority; the broader references are **lodash** and the **ES string/array standard**.

- **Casing:** single-word names are lowercase (`trim`, `join`, `round`); multi-word names are camelCase (`truncateWords`, `startsWith`, `escapeHtml`). **snake_case is banned.**
- **Canonical + alias:** where the source library ships duplicates, exactly one is canonical and the other is a documented alias the linter lowers. `lowercase` (not `downcase`), `uppercase` (not `upcase`), `add` (not `plus`), `subtract` (not `minus`), `multiply` (not `times`); aliases render correctly and normalise to canonical in committed form.
- **Prefer the universal name** over the library's idiosyncrasy: `trimStart`/`trimEnd` (ES standard, replaced `trimLeft`/`trimRight`), `includes` (not `inArray`), `at` (not `itemAt`), `camelCase`/`kebabCase`/`snakeCase`/`startCase` (lodash; `kebabCase` not `dashcase`).
- **Keep what BareBars already has right:** `and or not eq ne gt gte lt lte lookup if unless each with trim first last round raw json` are already common — no churn. In particular **keep `ne`** (more common in the wild than `handlebars-helpers`'s `isnt`); do **not** adopt `is`/`isnt`.

---

## 5. Core prelude (unchanged) + the one rename

The core prelude keeps its current members: control `if unless each with`, truthiness/boolean `and or not eq ne gt gte lt lte`, data `lookup`, escaping `escape`/`raw`, plus `json`. These are **not** moved into packs and **not** renamed — except:

**`esc_html` → `escapeHtml`.** It is the only snake_case name and it is the default escaper (≈13 call sites), so:

- `escapeHtml` becomes canonical (HTML-escapes `& < > "` plus `'`; returns `VSafe`; idempotent).
- `esc_html` is retained as a **deprecated alias** (lowered by the linter, warned, never removed silently) — renaming the default escaper without an alias is a security-sensitive breaking change and is not allowed.
- `escape` stays distinct (URL-escape, `url` pack); `json` gains alias `stringify`.

---

## 6. Normative pack registry

Subject is argument 0 throughout. "←x" marks a rename away from the source library; "alias:" lists lowered aliases; "block" marks body-using helpers.

### string
| name | signature | notes |
|---|---|---|
| `uppercase` / `lowercase` | `(s)` | ←`upcase`/`downcase` (those become aliases) |
| `capitalize` | `(s)` | first char upper |
| `startCase` | `(s)` | ←`capitalizeAll`; lodash title-ish |
| `camelCase` `pascalCase` `snakeCase` `kebabCase` | `(s)` | ←`dashcase`→`kebabCase`; lodash names |
| `trim` `trimStart` `trimEnd` | `(s)` | ←`trimLeft`/`trimRight` |
| `truncate` | `(s n [suffix])` | by chars |
| `truncateWords` | `(s n)` | by words |
| `replace` `replaceFirst` | `(s find rep)` | literal replace |
| `remove` `removeFirst` | `(s sub)` | |
| `append` `prepend` | `(s x)` | |
| `split` | `(s sep)` → `VArray` | |
| `reverse` | `(s)` | also array (§array) |
| `startsWith` | `(s prefix)` → `VBool` | |
| `ellipsis` `occurrences` `sentence` | `(s …)` | |
| `raw` | `(s)` → `VSafe` | passthrough; **XSS surface** (§9) |

### array
| name | signature | notes |
|---|---|---|
| `join` | `(arr sep)` | |
| `length` | `(arr)` | |
| `first` `last` | `(arr [n])` | pre-existing names |
| `reverse` | `(arr)` | |
| `includes` | `(arr v)` → `VBool` | ←`inArray` |
| `at` | `(arr i)` | ←`itemAt`; negative index allowed |
| `unique` | `(arr)` | |
| `sortBy` | `(arr key)` | **key-string**, not a fn (§7) |
| `pluck` | `(arr key)` → `VArray` | **key-string** (§7) |
| `groupBy` | `(arr key)` → `VObject` | **key-string** (§7) |
| `isArray` | `(v)` → `VBool` | |
| `forEach` `withFirst` `withLast` `withGroup` `withSort` | block | body as callback (§7) |

### comparison *(core boolean ops already in prelude; pack adds:)*
| name | signature | notes |
|---|---|---|
| `default` | `(v fallback)` | null-coalesce: `v` unless `VNull` |
| `contains` | `(coll v)` → `VBool` | string/array/object membership |
| `has` | `(obj key)` → `VBool` | ←`hasOwn` |
| `compare` | `(a op b)` → `VBool` | `op` ∈ `== != < <= > >=` |
| `ifOdd` `ifEven` `ifNth` | block | numeric guards |
| — drop — | | `is`/`isnt` (dupes of `eq`/`ne`), `unlessEq/Gt/Lt/Gteq/Lteq` (derivable) |

### math
| name | signature | notes |
|---|---|---|
| `add` `subtract` `multiply` `divide` `modulo` | `(a b)` | alias: `plus minus times` |
| `abs` `round` `floor` `ceil` | `(n)` | |
| `sum` `avg` `min` `max` | `(arr)` | reductions |
| — drop — | | `random` (non-deterministic, §9) |

### number
| name | signature | notes |
|---|---|---|
| `toFixed` `toPrecision` | `(n d)` | |
| `toInt` `toFloat` | `(s)` | parse |
| — defer — | | `addCommas` `bytes` `phoneNumber` (locale; §8) |

### object
| name | signature | notes |
|---|---|---|
| `get` | `(obj path)` | dotted path; ←`getObject` merged in |
| `has` | `(obj key)` | shared with comparison |
| `merge` | `(a b …)` → `VObject` | alias of/replaces `extend` |
| `pick` | `(obj keys…)` → `VObject` | |
| `isObject` | `(v)` → `VBool` | |
| `forOwn` | block | iterate object entries |
| `json` | `(v [indent])` → `VString` | core; alias `stringify` |
| — defer — | | `JSONparse` (injection/pollution; §9) |

### url
| name | signature | notes |
|---|---|---|
| `encodeURI` `decodeURI` | `(s)` | |
| `escape` | `(s)` | URL-escape; **distinct from `escapeHtml`** |
| `urlParse` | `(s)` → `VObject` | |
| `stripProtocol` `stripQuerystring` | `(s)` | |

---

## 7. Non-lambda redesign (the `Value`-has-no-functions consequence)

`map`, `filter`, `some`, and free-function `sortBy` take a callback. `Value` has no function constructor, so a lambda cannot be passed. These are **not adopted**; instead:

- **Key-based** forms take a **dotted key string**: `sortBy arr "user.age"`, `pluck arr "id"`, `groupBy arr "type"`. The engine reads that path from each element. This covers the overwhelmingly common "by a field" case without functions.
- **Block** forms use the body as the per-element template: `forEach arr` (iterate), `withFirst arr n` / `withLast arr n` (slice), `withGroup arr size` (chunk), `withSort arr key` (sort then render). Each pushes the element as context and renders `ctl.children`, exactly like `each`.
- **Dropped entirely:** `map`/`filter`/`some` with arbitrary predicates, and `iterate`. If a true predicate is ever needed, it would be a future *named-predicate* pack (a registry of comparison closures referenced by name), not ambient lambdas — out of scope now.

This is the honest cost of the no-function-values rule, and it is stated up front rather than papered over.

---

## 8. Excluded & deferred (with reasons)

| category / helper | disposition | reason |
|---|---|---|
| `fs`, `path` | **reject** | filesystem; impure; not portable to JS targets |
| `code` (`embed` `gist` `jsfiddle`) | **reject** | fetch remote URLs at render time — SSRF in a template engine |
| `markdown` / `md` | **reject** | file + heavy parser; impure |
| `i18n`, `logging` | **reject** | stateful / side-effecting |
| `date` / `moment` | **defer** | needs moment + `now()`; later as a pure pack with an **env-injected clock** |
| `html` (`sanitize` `attr` `css` `js` `thumbnailImage` `ol` `ul`) | **reject** | `sanitize` is false-safety unless audited; the rest are niche markup gen |
| `math.random`, `number.phoneNumber` | **reject** | non-deterministic / locale-ambient |
| `number.addCommas/bytes` | **defer** | locale-dependent; later with explicit-locale args |
| `regex` (`test` `toRegex`) | **defer** | ReDoS on user patterns; needs a step-limit guard first |
| `object.JSONparse` | **defer** | injection / prototype-pollution surface |
| `map` `filter` `some` `iterate` | **reject** | callback/predicate — inexpressible in `Value` (§7) |

---

## 9. Security & determinism rules (normative)

- **No I/O.** A pack helper performs no filesystem, network, clock, or RNG access. Violations are rejected at review.
- **Escaping.** `escapeHtml` is the only HTML escaper; it returns `VSafe` and is idempotent. `raw` and the triple-stache bypass escaping and **must** carry an XSS-surface note in docs.
- **No false-safety.** `sanitize` is excluded rather than shipped half-strength.
- **Guarded-or-deferred.** `regex` and `JSONparse` stay deferred until a guard (step-limit; safe-parse) is specced.
- **Determinism is testable.** Every pack helper has golden tests; the same inputs yield the same `Value` on every target (interpreter and JS codegen).

---

## 10. Implementation plan

### H0 — Pack protocol
`Pack` type, `mkPrelude` with conflict detection, the default-bundle assembly, the linter pack-availability check. No helpers yet beyond a smoke pack.

### H1 — `escapeHtml` rename + alias
Add `escapeHtml`; retain `esc_html` as a lowered, warned alias; migrate the ≈13 call sites; `json`→alias `stringify`.
- **Acceptance:** existing escaping golden tests pass under both names; the linter rewrites `esc_html`→`escapeHtml`.

### H2 — string + comparison + math packs
The canonical members in §6 with subject-first signatures; alias lowering (`downcase`/`plus`/…); `default` null-coalesce.
- **Acceptance:** golden tests per helper across all three surfaces (RawBars call, FullBars curly, MaxBars pipe).

### H3 — array + object packs (incl. the §7 redesign)
Key-based `sortBy`/`pluck`/`groupBy`; block `forEach`/`withFirst`/`withLast`/`withGroup`/`withSort`/`forOwn`; `get`/`merge`/`pick`/`has`.
- **Acceptance:** key-path sorting/plucking; block forms render the body per element; no callback API exists.

### H4 — number + url packs
Deterministic `toFixed`/`toInt`/`toFloat`; `encodeURI`/`urlParse`/`stripProtocol`.
- **Acceptance:** deterministic golden tests; locale formatters confirmed absent.

### H5 — guards (conditional)
If demand: a `regex` pack behind a backtrack/step limit; safe `JSONparse`; a `date` pack with an injected clock.

---

## 11. Open decisions

1. **Pipe arg position** (§3) — confirm subject-as-argument-0 (Liquid/Jinja) rather than last-arg; this fixes every transformer's signature.
2. **`default` semantics** (§6) — null-coalesce (proposed) vs truthiness-aware (returns fallback when the subject is falsy under the file's truthiness set). Truthiness-aware is more powerful but couples `default` to the active set.
3. **Alias retention policy** — how long deprecated aliases (`esc_html`, `downcase`, `plus`, …) live, and whether the linter auto-rewrites on save or only warns.
4. **`reverse`/`length` overloading** — single polymorphic helper over string+array, or separate per pack. Polymorphic is fewer names; separate is clearer types.
5. **Block vs key duplication** — both `sortBy` (inline, returns array) and `withSort` (block) exist; confirm we want both rather than one.
