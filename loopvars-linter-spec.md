# MaxBars Loop Variables & Cross-Dialect Linter — Specification & Implementation Plan

Status: **Part A shipped; Part B in implementation.** Companion to truthiness (specified in the truthiness ADR / `Kernel.Value`, not here).

Implementation status (what `main` does today):

- **Part A — Loop variables — SHIPPED.** The `index0`/`index1`/`rindex0`/`rindex1`/`first`/`last`/`length`/`key` set as scoped helpers in `each` (`Kernel.Prelude.iterate`); the `index`/`rindex`/`size` aliases resolved at desugar (`MaxBars.maxLoopVars`); `key` is **`null` for arrays** (engine, per the §A.1 fix); bare-name vs `this.NAME` resolution (`FullBars.Surface.pathExpr`); the **warn-always shadow lint** (`MaxBars.loopVarWarnings`, on-demand). The recursion budget is shipped (ADR-012, default 64); the `depth` accessor and labeled loops are **not** built — A.5/A.6's boundaries stand.
- **Part B — Cross-dialect linter / translator — being built.** The transpiler over the tier ladder: its four jobs (lower / lift / migrate / materialize-truthiness), what is lossless vs heuristic, and the per-construct rules.

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

> **Normative (the `this.NAME` escape hatch).** A loop variable is resolved only for a **whole bare name**, never for a path. `pathExpr` matches the loop-var resolver against the *original* identifier, not the segmented head — so `this.first` and `../first` reduce to a `lookup` and are **never** loop-var-resolved. A regression once stripped the leading `this.`, leaving the segment `first` to match the resolver and silently turn `{{this.first}}` into the loop variable; the fix (match the whole name) is load-bearing and pinned by a render test (`{{#each xs}}{{this.first}}{{/each}}` reads the element's `first` field).

## A.4 Shadowing — the cost of dropping `@`, and the lint that contains it

`@` previously namespaced loop metadata away from data. Without it, a data object carrying a `length`, `size`, `first`, `last`, `index`, or `key` field — all common — is **shadowed** inside any loop and must be read as `this.length`. Worse, a reader can't tell whether bare `length` is data or loop-meta without knowing they're inside a loop.

This is an accepted trade (punctuation reduction is the goal, and the bare name is the whole reason MaxBars sits above FullBars, which keeps `@index`), contained by tooling rather than buried:

- **Shadowing lint — warn-always, on-demand (SHIPPED).** `MaxBars.loopVarWarnings :: String -> Either ParseError (Array Issue)` walks the desugared template and emits a `Warn` for every bare use of a *data-like* loop variable — `first`, `last`, `length`, `key` — pointing at the `this.<name>` fix. It needs **no schema**: it cannot know whether a field exists, so it warns on the ambiguous names whenever they appear bare. It is a **lint pass the host/CI invokes**, not a render-time nag (render never calls it) — so it is informational, never blocks rendering. The unambiguous spellings (`index0`/`index1`/`rindex0`/`rindex1`) are never data-like, so they are not flagged.
- A **schema-aware *error* tier** (escalate to an error when a declared field actually collides) is **future** — it needs a data-field schema the kernel `Schema` (helper-only) does not yet carry. Until then the warn-always tier is the whole lint.
- The `index`/`size` → `index0`/`length` auto-resolution at desugar removes those two from the bare-collision surface entirely (`{{index}}`/`{{size}}` are already the canonical loop vars, not data).

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

- The recursion construct is a **partial that (transitively) invokes itself** (partials already exist). The cross-dialect **recursion budget is SHIPPED** (ADR-012, default **64**): `partialH` increments a depth counter on entry and raises a located `RecursionLimit` past the budget, so a cyclic partial errors instead of overflowing the stack. The `depth` *accessor* (`depth` = `1` at the top-level invocation, `+1` per recursive call, `1` outside recursion) is **not yet built** — it rides on the same counter when added (A-phase L3).

Note the distinction from *static nested-loop depth* (how many `each` blocks you sit inside) — that is free to compute but is **not** what `depth` means here, and conflating them is a footgun. If static nesting is ever wanted it would be a separate, differently named helper; we are not adding one unprompted.

## A.7 Desugar summary

All of the above is desugar/engine-level: `each` installs the scoped helpers; the desugar adds their names (plus any `as |…|` params) to the in-scope set for the body; aliases lower; `this.<name>` forces the data path. The core skeleton parser is untouched.

---

# Part B — Cross-dialect linter / translator

A transpiler over the tier ladder **RawBars ⊂ FullBars ⊂ MaxBars**, plus Handlebars as a migration source. It has **four jobs**, and the direction decides whether a job is mechanical or heuristic.

## B.1 The four jobs

| job | direction | nature | lossless? |
|---|---|---|---|
| **lower** | MaxBars → FullBars → RawBars | desugar / lower | **yes**, mechanical |
| **lift** | RawBars → FullBars → MaxBars | resugar | **no**, best-effort + ambiguity flags |
| **migrate** | Handlebars → MaxBars | source-language port | mostly; a flagged reinterpreted-token residual |
| **materialize truthiness** | any downward cross of a tier that can't carry the `@truthiness` directive | semantic guard insertion | required for correctness (see B.5) |

## B.2 Lower (down) — lossless

Each MaxBars/FullBars sugar has a defined lowering; the linter applies it and pretty-prints at the target tier:

| MaxBars | → FullBars | → RawBars |
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

A non-default-mode file would **not** survive a downward *source* translation that dropped its mode: lowering a `mustache`/`minimal`-mode MaxBars file to RawBars source and discarding the `@truthiness` would silently switch it to the `handlebars` default and change which branch runs.

**Chosen mechanism — carry the directive (SHIPPED, X1).** `@truthiness` is a *core* header directive, and RawBars honours it exactly as FullBars/MaxBars do (one resolver, `Kernel.Value.resolveTruthinessWith`). So the lower simply **re-emits the file's header directives into the lowered RawBars source** (`Linter.Print.printDirectives` → a leading `{{! @truthiness: <value> }}` comment, value carried verbatim). The lowered file then resolves the *same* `FalsySet` and renders identically — losslessly, with no per-condition rewrite and no new helper. `Linter.Lower.lowerReport` returns a `materialized` flag (true for any non-default mode) so a host/CLI can report or refuse on it; the carried directive makes the default behaviour render-exact rather than refusing. A `handlebars`-mode or directive-less file lowers cleanly (the flag is false), since the target's fixed default already matches.

**Alternative — per-condition guards (deferred).** The originally-specced form wrapped each `if`/`unless`/`&&`/`||`/`!` condition in an explicit `(truthy <set> cond)` guard (`<set>` the explicit shape list, e.g. `(truthy (false null) cond)`). It is strictly more self-contained — it survives even a consumer that strips directives — but it requires a `truthy` *prelude* helper that takes a falsy-set descriptor, which the engine does not (yet) carry. It is deferred behind the directive-carry mechanism, which needs no engine change. (The two are composable: a future guard pass would replace the carried directive for hosts that forbid directive injection.)

> **Note — the *compile* path is already safe.** This obligation is specific to **source-to-source** lowering. The JS compiler (`compileSurface`/`compileMaxJs`) does *not* have this problem: it resolves the file's `@truthiness` at compile time and bakes the `FalsySet` into the emitted module's `$falsy` preamble (`rt.truthy(c0.falsy, …)`), so a compiled `mustache`-mode template already carries its own truthiness. Materialization closes the gap that only the source-transpile direction opens.

> **Note — the *compile* path is already safe.** This obligation is specific to **source-to-source** lowering. The JS compiler (`compileSurface`/`compileMaxJs`) does *not* have this problem: it resolves the file's `@truthiness` at compile time and bakes the `FalsySet` into the emitted module's `$falsy` preamble (`rt.truthy(c0.falsy, …)`), so a compiled `mustache`-mode template already carries its own truthiness. Materialization closes the gap that only the source-transpile direction opens.

## B.6 Lints the translator owns

- **Shadowing** (A.4): warn-always on a bare data-like loop-var (`first`/`last`/`length`/`key`); the schema-aware *error* tier is future.
- **Partial-mode mismatch** (truthiness ADR / `Kernel.Value`): a partial whose `@truthiness` differs from its caller's — one render then runs two truthiness rules.
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

### L1 — Shadowing lint *(shipped: warn-always)*
- Warn-always, on-demand: `MaxBars.loopVarWarnings` emits a `Warn` for every bare `first`/`last`/`length`/`key`, suggesting `this.<name>`. No schema needed; not wired into render. The schema-aware *error* tier (escalate on a real declared-field collision) is future, pending a data-field schema.
- **Acceptance (shipped):** bare `{{first}}`/`{{length}}`/`{{key}}` warn; `{{index0}}` and `{{this.first}}` do not; the lint fires with no schema/loop.

### L2 — Parent-loop access
- Confirm block-param bindings nest lexically (`as |user uidx|` visible in inner loops); document the innermost rule and the v1 limitation (only element/index/key reachable outward).
- **Acceptance:** the A.5 example renders outer and inner indices correctly; an attempt to read outer `first` from an inner loop is a clear "not reachable; bind it" diagnostic.

### L3 — `depth` + recursion *(deferred)*
- Define the recursive-partial construct; thread the depth counter; `depth = 1` outside recursion.
- **Acceptance:** a self-including partial reports increasing `depth`; non-recursive use reads `1`.

### X0 — Lossless lower
- Run the front-end backwards: MaxBars→FullBars→RawBars pretty-printing, using B.2/B.7.
- **Acceptance:** round-trip property — `lower` then re-parse yields the same real AST as parsing the MaxBars source directly, on **truthiness-default (`handlebars`/directive-less) files** of the example corpus. (Non-default-mode files are *out of scope for the pure round-trip*: X1's materialization deliberately inserts `(truthy <set> …)` guards, so the lowered AST differs by construction — those files are covered by X1's render-equivalence acceptance instead.)

### X1 — Truthiness materialization *(shipped: carry the directive)*
- On any downward cross of a non-`handlebars`-mode file, **carry the `@truthiness` directive forward** into the lowered RawBars source (`Linter.Print.printDirectives`), so it resolves the same `FalsySet` (`Kernel.Value.resolveTruthinessWith`) and renders identically. `lowerReport` exposes a `materialized` flag for host reporting/refusal. The per-condition `(truthy <set> …)` guard form is the deferred alternative (§B.5). A `handlebars`/directive-less file lowers cleanly.
- **Acceptance (shipped):** `minimal`/`nil`/`mustache`/`presence`-mode templates — at values whose branch differs from the handlebars default — render identically through the MaxBars interpreter and through the lowered RawBars source (`renderMax src == RawBars.render (lower src)`); the test fails if the directive is dropped.

### X2 — Migrate Handlebars → MaxBars *(shipped)*
- `Linter.Migrate.migrateToMaxBars` applies B.4 as a **minimal-diff token-stream rewrite** (untouched tags are rebuilt from their original source slice, so formatting/`~` is preserved): `{{^x}}`→`{{#unless x}}` (close paired via a stack), `@index`/`@first`/`@last`/`@key`→bare loop vars, `{{&x}}`→`{{{x}}}`, `{{else if c}}`→`{{elif c}}`. Emits a per-file residual report for the flagged rows (`parent-data` `@../`/`@root`, `ambiguous-section` bare Mustache `{{#name}}`, `set-delimiters` `{{=…=}}`).
- **Acceptance (shipped):** render-equivalence oracle — residual-free mechanical templates render identically through `FullBars.renderSurface` (Handlebars) and `renderMax` of the migrated source across a data matrix; every residual carries a span (`end > start`), a message, and a suggested fix.

### X3 — Heuristic lift *(shipped: assist only)*
- `Linter.Lift.liftToMaxBars` re-sugars RawBars (core) source up to MaxBars with ambiguity flags (B.3); never an automated commit (flags are advisory, they do not change the emitted source). It is the inverse of X0's lower: the operator table inverts exactly (`and`→`&&`, `gt`→`>`, `not`→`!`, …), `Output (esc_html e)`→escaped `{{ e }}`, recognised unary filters (`esc_html`/`safe`/`json`/`esc_json`) re-sugar `(f a)`→`a | f`, and infix operands that are themselves infix are parenthesised. Flags: `lookup-path` (`(lookup this "x")`→`x`, could be `this.x`), `unrecognised-filter` (arity-1 non-filter call left as a call), `multi-arg-call`.
- **Acceptance (shipped):** `(and a (gt b 21))` lifts to `a && (b > 21)`; `(lookup this "x")` lifts to `x` **with** a `lookup-path` flag; multi-arg helpers are left as calls + flagged. Two render oracles: `RawBars.render input == renderMax (lift input)` on a corpus, and the lower∘lift round-trip `renderMax src == renderMax (lift (lower src))`.

---

# Status notes

- **`key` for arrays — `null`** (not the index). Matches Handlebars (`@key` is object-only); `index0` already carries the array position. Implemented in the engine (`Kernel.Prelude.iterate` + the JS runtime); see §A.1.
- **`depth` + recursion** — the recursion *budget* is shipped (ADR-012, default 64); the `depth` *accessor* is not yet built (§A.6). The earlier draft claimed both were "resolved in `rawbars-maxbars-spec.md`" — that companion does not exist; the budget lives in ADR-012 and the accessor remains future work.
- **Outer-loop `first`/`last`/`length`/`rindex`** from a nested loop — **not built.** A.5's v1 limitation stands (block params reach the outer element/index/key only). *Labeled loops* (`label u` → `u.first`/`u.length`) would generalise this but are a separate, unbuilt proposal — not a resolution to cite here.
- **Truthiness naming** (`mustache`/`handlebars`/`minimal`/`presence`/`always` + the `nil`/`ruby` synonyms) is settled in the truthiness ADR / `Kernel.Value`; no action here.
