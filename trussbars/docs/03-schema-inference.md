# Trussbars — Schema Inference (analyse → report → schema → data scaffold)

> **Status:** **Accepted** — design ratified 2026-06-10 (decisions below). · **Depends on:**
> `01-subset-spec.md` §8 (the schema precondition), `02-runtime-api.md` · **Extends:**
> [ADR-0030 symbolic analyse](../../spec/src/content/docs/adr/adr-0030-symbolic-analyse.mdx)
> (and through it ADR-0022 analyse mode).

`01` §8 makes a **declared context type `T` a hard precondition** of typed compilation.
That is a real authoring cost. This document removes most of it: a tool **derives a candidate
`T` from the template** (refined by optional sample data), emits a human report, and scaffolds
a skeleton data file. The author edits a generated struct instead of writing one from scratch.

The machinery is almost entirely ADR-0030's, run in reverse.

---

## Decisions (ratified 2026-06-10)

1. **PureScript-first, then Rust port (§7).** Build L1 by extending ADR-0030's `analyze` in
   PureScript — it reuses the trace / miss-detection / scaffold machinery, validates the design
   against the live analyser, and *is* the per-case `Ctx` generation the conformance harness needs
   now (§7, superseding the data-only `ctxgen.mjs`). Then port L1+L2 to a native `trussbars infer`
   Rust CLI — that port **is `docs/13` G2** (drops `spago` from the harness; gives Rust users
   `trussbars infer` standalone, consistent with the ratified **(C)**). Prototype against the
   reference, then port — not greenfield.
2. **Multiple data samples — union them (§2, §5, §8).** `infer` accepts a glob/dir of sample files
   and unions the observations: a path present in some and absent in others ⟹ `Option`; each new
   sample can reveal more enum variants. Directly attacks §8's biggest limit (enum-variant
   completeness); the report states how many samples informed each field/variant set.
3. **Conflicts are soft (§3).** A type conflict (e.g. `{{ x | uppercase }}` *and* `{{ x * 2 }}`) is
   **never silently merged**: `infer` emits the best-guess schema with the conflict prominently
   flagged in the report, and exits non-zero only under `--strict`. The tool stays usable
   mid-authoring while surfacing the likely bug.

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

**Many samples, unioned (decision §2).** The data source accepts a glob/dir of sample files, not a
single fixture: observations are unioned across them, so a path present in some and absent in others
becomes `Option`, and each sample can contribute new `#[serde(tag)]` enum variants (§5). More
samples ⟹ stronger optionality + enum coverage; the report records how many informed each result.

---

## 3. Template inference rules (usage ⟹ type)

Each construct constrains the type of the paths it touches. Collected over the whole template,
these unify into the schema.

| Template construct | Constraint inferred |
| --- | --- |
| `{{a.b.c}}` | `a` is an object with field `b`; `b` with field `c`; `c` is a scalar (`impl ToText`, under-determined — §4) |
| `{% each x in xs %}` | `xs: Vec<X>`; `x: X`, with `X` constrained by the body's use of `x` |
| `{% each v in m %}` **with `loop.key`** | `m: BTreeMap<String, V>` |
| `{{m \| uppercase}}` (string pack) | `m: String` |
| `{{p * q}}`, `{{n > 0}}` (arithmetic / numeric compare) | `p`, `q`, `n` are numeric (default `f64`, §4) |
| `{{a == b}}` | `a`, `b` share one comparable type (couples two paths) |
| `{{xs \| join …}}`, `{{xs \| count}}` (array pack) | `xs` is an array |
| `{{xs \| pluck "name"}}` | `xs: Vec<{ name: _ }>` (literal key ⟹ a required field) |
| `{% if x %}…` | `x` is a **non-numeric** truthy type (numeric is a compile error, `01` §5.3) — rules `x` *out* of being a bare number |
| `{{x ?? y}}`, `{{x ?: y}}` | `x` is **optional** ⟹ `Option<_>` (a template-level optionality signal) |
| `{{> card item}}` | `item` has the inferred context type of partial `card` (couples partial schemas) |
| `{% case x.tag %}{% when "A" %}…` over a collection | `x` is a `#[serde(tag="tag")]` enum; variants = the `when` literals ∪ data tag values (§5) |

Constraints unify per path; a conflict (e.g. `{{x \| uppercase}}` *and* `{{x * 2}}`) is
**reported, not silently merged** (decision §3 above): `infer` emits the best-guess schema with the
conflict flagged, exiting non-zero only under `--strict`. It almost always means a template bug or a
misnamed path.

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

**Polymorphic dispatch (§4.1) → a tagged enum.** The dispatch marker is
**`{% case x.tag %}{% when "A" %}…{% when "B" %}…{% endcase %}`** over a collection — the
*supported* Trussbars idiom (`{{#case}}`, docs/12). (An earlier draft named `{{> this}}`; that is
a **computed partial**, forbidden by the injection boundary — F3/§3 of docs/06 — so it can never
be the marker. The implemented `Kernel.Schema` keys off `{% case %}`.) The serde **tag** is the
case subject's last key (`x.tag`); the **variants** are the `{% when %}` literals, **unioned with
the data-observed values** of that tag field. So the template gives an exhaustive-by-authoring
variant set and data only *adds* any extras (strictly better than the data-only enumeration the
draft assumed). Inference emits `#[serde(tag = "tag")] enum X { … }` and the report flags it as
template+data-derived, never implying completeness (broader data / more `when` arms reveal more
variants).

> **Implemented (L1, 2026-06-10).** `packages/kernel/src/Kernel/Schema.purs` does the
> template-symbolic walk (most of §3 + §5 enums) and §2 data-scalar refinement; `MaxBars.inferMax`/
> `inferMaxData` and the `inferMaxbars` JS facade expose it; `node trussbars/conformance/infer.mjs`
> (`npm run infer`) is the `trussbars infer` prototype — **71/71 conformance-corpus templates
> produce a schema**. It is a *new* module (not literally an `analyze` extension): the
> template-symbolic source (§2) is a fresh static walk, but it reuses the AST and is the producer
> dual of ADR-0030 as designed. The harness uses inference as its primary ctx source (genCtx
> fallback for maps/enums hints); `infer --strict` exits non-zero on conflicts; two-path `{{a == b}}`
> unifies the operands' types (a fixpoint propagates a determined side to the other). **Not yet:**
> the Rust port (G2).

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

v1 ships **L1 + L2**, **PureScript-first then ported to Rust** (decision §1):

1. **L1 in PureScript** — extend ADR-0030's `analyze` to emit `schemaScaffold` + `dataScaffold`
   beside `jsonataScaffold`. Reuses the trace/miss/scaffold machinery and is validated against the
   live analyser. The conformance harness already needs a context type per case from each case's
   data JSON (`01` §11) — that requirement and L1 are the **same code**, so L1 lands regardless and
   **supersedes the data-only `ctxgen.mjs`** (it covers unexercised paths, which the data-only
   scaffold misses — ADR-0030's documented coverage weakness, §2).
2. **L2 / the Rust port** — `trussbars infer <template> [glob]` writes `ctx.rs` + `sample.json`.
   Porting L1+L2 to Rust **is `docs/13` G2**: it drops `spago` from the harness (so the harness runs
   oracle-free) and gives Rust users `trussbars infer` natively — required for Trussbars-standalone
   under the ratified **(C)**. The PureScript L1 is the reference the Rust port is differentially
   tested against, not a throwaway.

---

## 8. Limits (state them, don't hide them)

- **Enum variants may be incomplete** (§5) — the `{% when %}` arms enumerate the variants the
  *template* handles, and data adds any extra observed tags; a variant neither matched nor observed
  is missed. The report flags the set as non-exhaustive.
- **Heterogeneous JSON arrays** (mixed-type elements) have no `Vec<T>`; flagged, not guessed.
- **Numeric width** (`i64`/`u32`/`f64`) is defaulted (`f64`) and flagged; the author narrows.
- **Order-3 coupling** — `{{a == b}}` couples two paths' types; if they disagree across
  usages, that's a reported conflict, not a silent pick.
- **A declared `T` is still the contract** (`01` §8) — inference produces a *candidate* the
  author owns and edits; it is not a runtime schemaless escape hatch.

---

## 9. Worked example

**Template** (the `02` §13 teams template):

```text
{% each team in teams %}
{{team.name}} ({{root.org}}):
{% each m in team.members %}
  {{loop.index1}}. {{m | uppercase}}{% if loop.last %} (last){% endif %} — {{parent.name}}
{% endeach %}
{% endeach %}
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
