# MaxBars Loop Variables & Cross-Dialect Linter — Specification & Implementation Plan

Status: draft for review · Companion to `truthiness-spec.md` (truthiness is specified there, not here).

This document settles the two items left open in the loop-variable / linter feedback:

- **Part A — Loop variables.** The explicit `index0`/`index1`/… set as scoped helpers, the `length`/`size` and `index`/`rindex` aliases, the shadowing cost of dropping `@`, the **innermost rule + how an inner loop reaches an outer loop's index** (the open question), and the status of `depth`.
- **Part B — Cross-dialect linter / translator.** The transpiler over the tier ladder — its four jobs, what is lossless vs heuristic, and the per-construct rules.

---

# Part A — Loop variables

## A.1 The set

`each` (and any future loop construct) installs the following **scoped helpers** into the loop body. No `@`, no `loop.` record. They behave exactly like block params: in scope inside the body, out of scope outside it.

| name | type | definition (let `n` = item count, `i` = 0-based position) |
|---|---|---|
| `index0` | number | `i` |
| `index1` | number | `i + 1` |
| `rindex0` | number | `n - 1 - i` (last item ⇒ `0`) |
| `rindex1` | number | `n - i` (last item ⇒ `1`) |
| `first` | bool | `i == 0` |
| `last` | bool | `i == n - 1` |
| `length` | number | `n` |
| `key` | string \| null | the property name when iterating an object; **`null` when iterating an array** (use `index0` for the array position) |
| `depth` | number | recursion depth — **reserved, deferred** (A.6) |
| `this` | value | the current item (already established) |

The arithmetic relationships are **normative** so no two implementations (interpreter, compiler) can drift: `index1 = index0 + 1`, `rindex0 = length - 1 - index0`, `rindex1 = length - index0`, `first = (index0 == 0)`, `last = (index0 == length - 1)`. (`key` is included because object iteration needs it even though it was absent from the original list.)

These are installed by `each` only. `with` shifts context and installs none of them.

## A.2 Aliases (linter-lowered)

Three names are tolerated aliases that the linter rewrites to the explicit form — the same treatment as a directive's good-style normalisation:

| alias | lowers to | rationale |
|---|---|---|
| `index` | `index0` | the Handlebars 0-based rule, but ambiguous on the page; explicit wins |
| `rindex` | `rindex0` | same |
| `size` | `length` | `length` is canonical (Twig/Liquid/Jinja/JS); `size` is the Liquid/Ruby outlier. Do **not** also add `count` |

The aliases render correctly *and* the linter lowers them, so source stays readable but the committed form is unambiguous — consistent with the "no one should guess" principle behind having both `index0` and `index1` in the first place.

## A.3 Scope & resolution

The resolution rule is the existing FullBars `scope` mechanism with the loop names folded in:

> A bare identifier is a **data path** (`lookup this "name"`) **unless** it is an in-scope name (a block param or a loop variable), in which case it is the **scoped-helper call**. `this.name` **always** forces the data path.

So inside a loop, bare `first` ⇒ `(first)`; `this.first` ⇒ `lookup this "first"` reads a data field named `first`. Outside a loop, `first` is not in scope, so bare `first` ⇒ `lookup this "first"` (a plain field). No core change — this is desugar-level scoping.

## A.4 Shadowing — the cost of dropping `@`, and the lint that contains it

`@` previously namespaced loop metadata away from data. Without it, a data object carrying a `length`, `size`, `first`, `last`, `index`, or `key` field — all common — is **shadowed** inside any loop and must be read as `this.length`. Worse, a reader can't tell whether bare `length` is data or loop-meta without knowing they're inside a loop.

This is an accepted trade (punctuation reduction is the goal), contained by tooling rather than buried:

- **Shadowing lint (schema-aware).** When a schema is available (the `validate` / `ToValue` typed binding), the linter **errors/warns** on a bare loop-variable name that collides with a field present on the loop's element type, and points at the `this.<name>` fix. Without a schema it can only warn heuristically (it cannot know the data shape), so the lint is strongest when a schema is declared.
- The `index`/`size` → `index0`/`length` auto-lowering reduces the collision surface for the two most common offenders.

## A.5 Innermost rule + reaching an outer loop (the open question, resolved)

**Bare loop variables always refer to the innermost enclosing loop.** To reach an outer loop's iteration state, **name it with a block param** in the outer loop — the binding is lexically scoped and remains visible inside nested loops:

```
{{#each users as |user uidx|}}        uidx is the outer loop's index0, bound by name
  {{#each user.posts as |post|}}
    user #{{uidx}} / post #{{index0}}  uidx = outer index, index0 = inner index
  {{/each}}
{{/each}}
```

This resolves parent access **without** reintroducing `@../` or a `loop.parent` record: it reuses the block-param machinery FullBars already has (`each` binds `item` and the index/key positionally). The bare `index0` is unambiguously the innermost loop; anything outer must be given a name.

**Limitation (v1):** block-param binding exposes the outer **element**, **index**, and **key** (the positions `each` binds), but not the outer `first`/`last`/`rindex`/`length`. Those are not directly reachable from a nested loop in v1. If needed, compute from a named outer index and a named outer length, or restructure. A future **labeled-loop** extension could generalise this; it is explicitly out of scope now. This is the honest boundary — the common case (outer index) is covered by existing machinery; the rest is deferred, not silently broken.

## A.6 `depth` — reserved and deferred

`depth` (Twig-style) is the **dynamic recursion depth**: how many times a recursive construct has re-entered itself, starting at `1`. Unlike `index0`/`first`/`last`/`rindex*` — which are per-iteration state local to one `each` and therefore free — `depth` requires threading a counter across recursive invocations, which presupposes a **recursion construct** MaxBars does not yet define.

Decision: **`depth` is reserved in the vocabulary but its semantics ship with the recursion construct, not now.** Until then:

- The recursion construct is a **partial that (transitively) invokes itself** (partials already exist); `depth` counts that re-entry, `1` at the top-level invocation, `+1` per recursive call.
- Outside any recursion, `depth` is `1`.
- Implementation is a later phase (A-phase L3).

Note the distinction from *static nested-loop depth* (how many `each` blocks you sit inside) — that is free to compute but is **not** what `depth` means here, and conflating them is a footgun. If static nesting is ever wanted it would be a separate, differently named helper; we are not adding one unprompted.

## A.7 Desugar summary

All of the above is desugar/engine-level: `each` installs the scoped helpers; the desugar adds their names (plus any `as |…|` params) to the in-scope set for the body; aliases lower; `this.<name>` forces the data path. The core skeleton parser is untouched.

---

# Part B — Cross-dialect linter / translator

A transpiler over the tier ladder **CoreBars ⊂ FullBars ⊂ MaxBars**, plus Handlebars as a migration source. It has **four jobs**, and the direction decides whether a job is mechanical or heuristic.

## B.1 The four jobs

| job | direction | nature | lossless? |
|---|---|---|---|
| **lower** | MaxBars → FullBars → CoreBars | desugar / lower | **yes**, mechanical |
| **lift** | CoreBars → FullBars → MaxBars | resugar | **no**, best-effort + ambiguity flags |
| **migrate** | Handlebars → MaxBars | source-language port | mostly; a flagged reinterpreted-token residual |
| **materialize truthiness** | any downward cross of a tier that can't carry the `@truthiness` directive | semantic guard insertion | required for correctness (see B.5) |

## B.2 Lower (down) — lossless

Each MaxBars/FullBars sugar has a defined lowering; the linter applies it and pretty-prints at the target tier:

| MaxBars | → FullBars | → CoreBars |
|---|---|---|
| `{{ a \| f }}` | `{{ f a }}` | `{{{ esc_html (f (lookup this "a")) }}}` |
| `{{ a \| f x }}` | `{{ f a x }}` | piped value is the **first** argument |
| `{{#if a && b}}` | `{{#if (and a b)}}` | `(and …)` |
| `{{#if a > b}}` | `{{#if (gt a b)}}` | operator→helper table (B.7) |
| bare `index0` (in loop) | `@index` *(alias of `index0`)* | `(index0)` |
| `index1` / `rindex0` / … | `(index1)` / `(rindex0)` / … | same scoped helpers |
| `this.k` | `lookup this "k"` | `(lookup this "k")` |
| `index` / `size` aliases | lowered to `index0` / `length` first | — |

The loop variables are **the same engine scoped helpers in every dialect**; FullBars's `@index` is just an alias for `index0`. So lowering never invents semantics — it only removes surface sugar.

## B.3 Lift (up) — heuristic, with flags

Lifting is best-effort because the mapping isn't injective:

- `(and a b)` → `a && b`, `(gt a b)` → `a > b` — recoverable for the fixed operator set.
- `(f a)` → `a | f` only if `f` is a recognised unary "filter-shaped" helper; **flag** otherwise. `(myhelper a b c)` has **no** canonical pipe form (multi-arg, no obvious subject) — left as a call, flagged.
- `(lookup this "x")` → `x` **or** `this.x`? The linter can't tell whether the author wrote `this.x` to dodge a shadow; it emits `x` and **flags** the spot for human confirmation.

Lift is an assist, never an automated commit.

## B.4 Migrate (Handlebars → MaxBars)

| Handlebars | MaxBars | note |
|---|---|---|
| `@index` | `index0` | Handlebars `@index` is 0-based |
| `@first` / `@last` / `@key` | `first` / `last` / `key` | drop the `@` |
| `{{^x}}` | `{{#unless x}}` or `!x` | inverted section |
| `{{&x}}` | `{{{x}}}` | unescaped |
| `{{else if c}}` | `{{elif c}}` / `else if` infix | clause chain |
| `@../index` | **manual** | requires binding the outer index with `as \|x i\|` and editing the outer `each` — cannot be done purely mechanically; **flagged** |
| `{{#x}}` Mustache section | `{{#if x}}` / `{{#each x}}` | ambiguous (truthy vs list); **flagged** |
| `{{=<% %>=}}` set delimiters | unsupported | **flagged** |

Truthiness needs **no** materialization for this direction: Handlebars truthiness == MaxBars default (`handlebars`/`empty`). The deliberate 5–10% — the reinterpreted tokens and the manual rows above — is collected into a per-file migration report for human review.

## B.5 Materialize truthiness (the correctness trap)

A non-default-mode file does **not** survive a downward translation. Lowering a `nil`-mode MaxBars file to FullBars/CoreBars (neither of which carries the `@truthiness` directive) would silently switch it to `handlebars` truthiness and change which branch runs. The linter must therefore **materialize** the set: every `if`/`unless`/`&&`/`||`/`!` condition is wrapped at the target tier in an explicit guard derived from the file's `FalsySet` — e.g. `cond` becomes `(truthy-nil cond)` (or `(truthy <set> cond)`), per `truthiness-spec.md` §6.3.

So down-translation of any file whose `@truthiness` ≠ `handlebars` is **not purely syntactic**; the linter either emits the guards or refuses and warns. (A `handlebars`-mode or directive-less file lowers cleanly, since the target's fixed default already matches.)

## B.6 Lints the translator owns

- **Shadowing** (A.4): schema-aware collision of a bare loop-var with a data field.
- **Partial-mode mismatch** (`truthiness-spec.md`): a partial whose `@truthiness` differs from its caller's — one render then runs two truthiness rules.
- **Alias normalisation:** `index`→`index0`, `rindex`→`rindex0`, `size`→`length`, and directive good-style (`@key:value`, one per line).
- **Migration residual:** the flagged Handlebars rows in B.4.

## B.7 Operator → helper table (shared by lower/lift/migrate)

| infix | helper | infix | helper |
|---|---|---|---|
| `&&` | `and` | `==` | `eq` |
| `\|\|` | `or` | `!=` | `ne` |
| `!` | `not` | `<` `>` | `lt` `gt` |
| | | `<=` `>=` | `lte` `gte` |

`a \| f` ⇒ `(f a)`; `a \| f x` ⇒ `(f a x)` (piped value first). These are the same rules MaxBars's front-end uses, so the lowering is the front-end run backwards.

---

# Phased implementation plan

Loop-variable phases (`L`) and linter phases (`X`) are independent tracks; ordering within each is by dependency.

### L0 — Core loop variables
- `each` installs `index0 index1 rindex0 rindex1 first last length key` as scoped helpers; bodies get them in scope; `this.<name>` forces the data path; `index`/`rindex`/`size` lower to `index0`/`rindex0`/`length` at desugar.
- **Acceptance:** golden tests pin the arithmetic (`index1 = index0+1`, `rindex0 = length-1-index0`, `first`/`last` at the ends), object `key` (property name) vs array `key` (**`null`**), and `this.length` reading a shadowed field; the aliases render and lower.

### L1 — Shadowing lint
- Schema-aware: error/warn on a bare loop-var colliding with a present field on the element type; suggest `this.<name>`.
- **Acceptance:** with a declared schema, a `length` field inside `{{#each}}` warns; without a schema, only a heuristic warning.

### L2 — Parent-loop access
- Confirm block-param bindings nest lexically (`as |user uidx|` visible in inner loops); document the innermost rule and the v1 limitation (only element/index/key reachable outward).
- **Acceptance:** the A.5 example renders outer and inner indices correctly; an attempt to read outer `first` from an inner loop is a clear "not reachable; bind it" diagnostic.

### L3 — `depth` + recursion *(deferred)*
- Define the recursive-partial construct; thread the depth counter; `depth = 1` outside recursion.
- **Acceptance:** a self-including partial reports increasing `depth`; non-recursive use reads `1`.

### X0 — Lossless lower
- Run the front-end backwards: MaxBars→FullBars→CoreBars pretty-printing, using B.2/B.7.
- **Acceptance:** round-trip property — `lower` then re-parse yields the same real AST as parsing the MaxBars source directly, on the full example corpus.

### X1 — Truthiness materialization
- On any downward cross, wrap conditions in explicit `(truthy <set> …)` guards when the file's mode ≠ `handlebars`; otherwise lower cleanly. (Depends on `truthiness-spec.md` Phase 2.)
- **Acceptance:** a `nil`-mode template lowered to CoreBars renders identically to the MaxBars interpreter across the truthiness conformance matrix.

### X2 — Migrate Handlebars → MaxBars
- Apply B.4; emit a per-file residual report for the flagged rows (`@../`, Mustache sections, set delimiters).
- **Acceptance:** a representative Handlebars template ports with ≤ the documented residual; every residual item carries a span and a suggested fix.

### X3 — Heuristic lift *(assist only)*
- CoreBars/FullBars → MaxBars with ambiguity flags (B.3); never an automated commit.
- **Acceptance:** `(and a (gt b 21))` lifts to `a && (b > 21)`; `(lookup this "x")` lifts to `x` **with** a confirmation flag; multi-arg helpers are left as calls.

---

# Resolved / superseded

The first three items below were left open in this spec and are now **resolved in `rawbars-maxbars-spec.md`**, which introduces the shared env frame-stack primitive. This spec defers to it.

1. **`depth` + recursion construct** — *resolved.* Recursion is self-including partials, guarded by the cross-dialect recursion budget (default **64**, `rawbars-maxbars-spec.md` §7). `depth` ships as a MaxBars-only accessor (Handlebars/FullBars have no `@depth`). Supersedes A.6's deferral.
2. **Outer-loop `first`/`last`/`length`/`rindex`** from a nested loop — *resolved.* MaxBars **labeled loops** (`label u` → `u.first`/`u.length`/`u.rindex0`) reach the full outer set; the block-param workaround in A.5 (outer element/index/key only) is now just the minimal subset. Supersedes A.5's v1 limitation.
3. **`key` for arrays** — *resolved: `null`* (not `index0`), in every engine. Matches Handlebars (`@key` set only on object iteration); `index0` already carries the array position; conflating them masks array/object confusion. Folded into the variable table above.
4. Truthiness naming (`nil` vs `minimal`) is settled in `truthiness-spec.md` (alias `nil`/`ruby`); no action here.
