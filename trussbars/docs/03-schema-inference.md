# Trussbars — Schema Inference (analyse → report → schema → data scaffold)

> **Status:** Draft / design · **Depends on:** `01-subset-spec.md` §8 (the schema
> precondition), `02-runtime-api.md` · **Extends:**
> [ADR-0030 symbolic analyse](../../spec/src/content/docs/adr/adr-0030-symbolic-analyse.mdx)
> (and through it ADR-0022 analyse mode).

`01` §8 makes a **declared context type `T` a hard precondition** of typed compilation.
That is a real authoring cost. This document removes most of it: a tool **derives a candidate
`T` from the template** (refined by optional sample data), emits a human report, and scaffolds
a skeleton data file. The author edits a generated struct instead of writing one from scratch.

The machinery is almost entirely ADR-0030's, run in reverse.

---

## 1. The dual: ADR-0030 *consumes* a schema; Trussbars *produces* one

ADR-0030's symbolic analyser already, per its Decision:

- traces every condition and **path access** in a render (the `Decision` trace,
  `WriterT (Array Decision)`);
- knows each accessed path's **observed type** — it derives same-type what-ifs (`number ⇒ 0`,
  `string ⇒ ""`, `array ⇒ []`, `object ⇒ {}`), so it already classifies path types;
- wraps `lookup` and records **misses** (paths resolving to absent/`null`);
- exposes a **`PathSchema` seam** `String -> Value -> Boolean` ("can path *p* hold value *v*?")
  that a host plugs in to *suppress* impossible what-ifs;
- emits `reportMarkdown` and `jsonataScaffold`.

ADR-0030 takes a `PathSchema` **as input** to prune findings. Trussbars runs the same trace to
**produce** a schema as **output**. It is the producer dual of ADR-0030's consumer.

**The loop closes — and this is the prize.** ADR-0030 names its own weakness: *"the engine has
no schema to reason about which values a path can hold."* A Trussbars-inferred schema **is that
missing input.** Feed it back into the `PathSchema` seam and analyse-mode's "no findings"
becomes *actually* complete instead of "complete for this sample." Trussbars schema inference
doesn't merely reuse ADR-0030 — it **completes** it.

One more alignment: ADR-0030's `kind: "miss"` findings ("`user.naem` resolved to null — likely
a typo") are the **soft, runtime, advisory** preview of Trussbars's `01` §5.1 **hard,
compile-time** missing-key error. Same signal, two phases — and inference is where the soft
becomes the optionality input to the hard.

---

## 2. Two sources of constraint (the S3 model)

Mirroring ADR-0030's own *observed* vs *potential* split:

| Source | What it yields | Stability |
| --- | --- | --- |
| **Template-symbolic** (a function of the template) | the **complete path set** + each path's **usage-implied type** + template-level optionality (`x ?? y`) | stable, CI-gateable — the *gating skeleton* |
| **Data-observed** (a function of the sample) | **scalar refinement** (is bare `{{x}}` a string or a number?), **presence/absence** → `Option`, **enum tags** for §4.1 dispatch | sample-bound, *advisory* |

The template gives the **shape and the type constraints** (and covers every path, since it
*is* the set of accesses). Data **refines the under-determined scalars and optionality** it
can't see. Each covers the other's blind spot. Template-only is a valid degraded mode (with
guessed scalars, §4); data-only is the naïve quicktype approach and is rejected as the primary
source — it misses unexercised paths, exactly ADR-0030's documented coverage weakness.

---

## 3. Template inference rules (usage ⟹ type)

Each construct constrains the type of the paths it touches. Collected over the whole template,
these unify into the schema.

| Template construct | Constraint inferred |
| --- | --- |
| `{{a.b.c}}` | `a` is an object with field `b`; `b` with field `c`; `c` is a scalar (`impl ToText`, under-determined — §4) |
| `{{#each xs as \|x\|}}` | `xs: Vec<X>`; `x: X`, with `X` constrained by the body's use of `x` |
| `{{#each m as \|v\|}}` **with `loop.key`** | `m: BTreeMap<String, V>` |
| `{{m \| uppercase}}` (string pack) | `m: String` |
| `{{p * q}}`, `{{n > 0}}` (arithmetic / numeric compare) | `p`, `q`, `n` are numeric (default `f64`, §4) |
| `{{a == b}}` | `a`, `b` share one comparable type (couples two paths) |
| `{{xs \| join …}}`, `{{xs \| count}}` (array pack) | `xs` is an array |
| `{{xs \| pluck "name"}}` | `xs: Vec<{ name: _ }>` (literal key ⟹ a required field) |
| `{{#if x}}…` | `x` is a **non-numeric** truthy type (numeric is a compile error, `01` §5.3) — rules `x` *out* of being a bare number |
| `{{x ?? y}}`, `{{x ?: y}}` | `x` is **optional** ⟹ `Option<_>` (a template-level optionality signal) |
| `{{> card item}}` | `item` has the inferred context type of partial `card` (couples partial schemas) |
| `{{> this}}` over a collection | a polymorphic dispatch site → an enum (§5, needs data tags) |

Constraints unify per path; a conflict (e.g. `{{x \| uppercase}}` *and* `{{x * 2}}`) is
**reported, not silently merged** — it almost always means a template bug or a misnamed path.

---

## 4. The under-determined scalar, and defaulting

A bare output `{{x}}` only pins `x: impl ToText` — it could be `String`, a number, or `bool`.
Resolution order:

1. **Other template usage pins it** — if `x` also appears in `x * 2`, it's numeric; in
   `x | trim`, a string. Prefer this.
2. **Data observation pins it** — the sample shows `"x": "hi"` ⟹ `String`. This is the main
   reason folding in data is worth it.
3. **Default + flag** — with neither, default to **`String`** (the most permissive `ToText`)
   and **flag every defaulted field in the report** so the author knows it's a guess, not a
   deduction.

Numeric default is **`f64`** (the engine's number model); the report flags it so an author who
wants `i64`/`u32` narrows deliberately. Narrowing is safe (serde validates at the boundary);
widening a wrong guess is the author's call.

---

## 5. Optionality and polymorphism

**Optionality → `Option<T>`** comes from three signals, strongest first:
1. **Template** — `{{x ?? y}}` / `{{x ?: y}}` / `{{#if x}}…{{else}}…` says the author *treats*
   `x` as possibly-absent. Strong, stable.
2. **Data miss** — ADR-0030's `kind:"miss"` for path `x` (absent/`null` in the sample).
   Advisory.
3. Neither ⟹ **required** (no `Option`), consistent with `01` §5.1 (absence must be declared).

**Polymorphic dispatch (§4.1) → a tagged enum** is the one case template-symbolic analysis
*cannot* finish alone: `{{> this}}` over a collection says "dispatch by variant," but the
*variants* come from the data's tag field. Inference emits a `#[serde(tag = "kind")]` enum with
one variant per **observed** tag value, and flags it as data-derived (re-run with broader data
to discover more variants — the report says so explicitly, never implying completeness).

---

## 6. Outputs

Run `analyze(template [, data])` (extended) or `trussbars infer` (§7):

1. **Report** (`reportMarkdown`, extended) — leads with a coverage line (*N paths · M
   usage-pinned · K data-refined · J defaulted*), then per path: inferred type, optionality,
   confidence (`pinned` / `refined` / `guessed`), and any conflicts. The honesty discipline is
   ADR-0030's, inherited.
2. **Schema** — the Rust context type(s): nested structs for objects, `Vec<_>` for arrays,
   `BTreeMap<String, _>` for keyed maps, `Option<_>` for optionals, `#[serde(rename)]` for
   non-identifier keys, the `#[derive(Deserialize, Trussbars)]` line (`02` §12). Recursive
   templates (a partial calling itself) emit a recursive type with `Box`/`Vec`.
3. **Data scaffold** — a skeleton JSON matching the schema (placeholder/empty/`null` per field,
   one element per array), reusing the `jsonataScaffold` emission machinery. This is the *base
   shape data scaffold* — the author fills in values and has a working fixture immediately.

---

## 7. Where it lives

| Layer | Rating | Role |
| --- | --- | --- |
| **L1. Extend `analyze` to emit `schemaScaffold` + `dataScaffold`** (beside `jsonataScaffold`) | 4.5 | smallest delta; reuses the trace, miss-detection, report, and scaffold emitter wholesale |
| **L2. `trussbars infer <template> [data]`** — thin CLI / build step over L1, writes `ctx.rs` + `sample.json` | 4.0 | the author-facing tool |
| L3. Proc-macro infers at Rust compile time (v2) | 2.5 | chicken-and-egg (infer *then* verify against usage); defer |

v1 ships **L1 + L2**. The conformance harness already needs a context type per case derived
from each case's data JSON (`01` §11) — that requirement and L1 are the **same code**, so it
is built regardless.

---

## 8. Limits (state them, don't hide them)

- **Enum variants need data** (§5) — template alone can't enumerate them; report flags
  incompleteness.
- **Heterogeneous JSON arrays** (mixed-type elements) have no `Vec<T>`; flagged, not guessed.
- **Numeric width** (`i64`/`u32`/`f64`) is defaulted (`f64`) and flagged; the author narrows.
- **Order-3 coupling** — `{{a == b}}` couples two paths' types; if they disagree across
  usages, that's a reported conflict, not a silent pick.
- **A declared `T` is still the contract** (`01` §8) — inference produces a *candidate* the
  author owns and edits; it is not a runtime schemaless escape hatch.

---

## 9. Worked example

**Template** (the `02` §13 teams template):

```handlebars
{{#each teams as |team|}}
{{team.name}} ({{root.org}}):
{{#each team.members as |m|}}
  {{loop.index1}}. {{m | uppercase}}{{#if loop.last}} (last){{/if}} — {{parent.name}}
{{/each}}
{{/each}}
```

**Template-symbolic pass** (no data) infers:

- `teams` → array (`{{#each teams}}`) of `Team`.
- `Team.name` → scalar, used only in `{{team.name}}` and `{{parent.name}}` → **guessed
  `String`** (flagged).
- `org` → scalar on root, `{{root.org}}` → **guessed `String`** (flagged).
- `Team.members` → array (`{{#each team.members}}`) of `M`.
- `M` → used as `{{m | uppercase}}` ⟹ **pinned `String`** (string-pack usage).
- no `??`/`?:`/`{{else}}` ⟹ every field **required**.

**Emitted report** (shape):

```text
4 paths · 1 usage-pinned · 0 data-refined · 2 guessed   (provide --data to refine)
  teams              : [Team]            required   pinned
  Team.name          : string            required   guessed  ← bare output, defaulted
  Team.members       : [string]          required   pinned   (m | uppercase)
  org (root)         : string            required   guessed  ← bare output, defaulted
```

**Emitted schema:**

```rust
#[derive(Deserialize, Trussbars)]
struct Ctx { org: String, teams: Vec<Team> }
#[derive(Deserialize, Trussbars)]
struct Team { name: String, members: Vec<String> }
```

**Emitted data scaffold** (`sample.json`):

```json
{ "org": "", "teams": [ { "name": "", "members": [ "" ] } ] }
```

The author confirms the two guessed `String`s (or narrows), fills the scaffold, and has a
compiling, byte-checkable template — without hand-writing the struct. Feeding the schema back
into ADR-0030's `PathSchema` seam then makes a subsequent analyse run's coverage *complete*,
not sample-bound.
