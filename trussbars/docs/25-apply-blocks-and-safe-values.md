# Trussbars — Block filters `{% apply P %}…{% endapply %}` + the dynamic `Value::Safe` model

> **Status:** **IMPLEMENTED** (all six stages; conformance-gated `oracle ≡ AOT ≡ VM`, 94/94).
> One frozen detail was corrected in build — see §2's escaping note. **Audience:**
> whoever extends the surface and the dynamic value model. **Companions:** `docs/18`
> (`{% capture %}` — the sibling render-body construct this shares all machinery with; that ADR
> froze capture's *surface*, this one adds the **dynamic-backend port** it predates), `docs/17`
> (`{% set %}`/`{% local %}` — the forward-scope `apply`/`capture` desugar into), `docs/19`
> (the `{% %}` surface), `docs/01`/`docs/06` (subset + freeze — amended), `docs/11` (the VM —
> gains `Value::Safe`), `docs/04` (conformance — both constructs become oracle≡AOT≡VM gated),
> `docs/09` (host helpers, the common `apply` target).
>
> **Decision in one line.** Add `{% apply PIPELINE %}…{% endapply %}` (apply a filter pipeline
> to a rendered block) as the Django-family block-filter; implement it **and** the `{% capture %}`
> port to the *dynamic* backends (interp/VM) over one shared foundation — a `render "@name"`
> value-op and a **`Value::Safe`** variant — both as **`SetSugar`-style parser desugars** over
> existing constructs, in the **oracle and Rust** (so both are conformance-gated, per the
> 2026-06-… product decision to keep `apply` in the oracle).
>
> **Naming — `apply`, not `filter`.** "filter" is already taken in Trussbars: the collection ops
> `where`/`reject` lower to `.filter()`, and value pipes are colloquially filters. `{% filter %}`
> would overload that — the exact ambiguity Twig hit and fixed by deprecating `{% filter %}` for
> `{% apply %}` (1.40/2.9). We take Twig's correction. `{% apply upper | truncate 280 %}` reads as
> "apply this pipeline," consistent with the `|` pipe surface; `{% filter %}` reads like a
> collection filter. A `{% filter %}` head is rejected with a located fix-it pointing to `apply`.

## 1. Context

`{% capture %}` (docs/18) renders a block body into a reusable **safe value**. The natural
companion — *render a block and pipe it through a filter/helper* — is a first-class construct in
every Django-family engine: `{% filter %}` (Jinja2, Django, Nunjucks, Tera), `{% apply %}` (Twig).
Trussbars has the *capability* only obliquely (a host **block** helper `{% op %}…{% endop %}`, which
must be a registered block fn), and the clean form is missing. This ADR adds it, and — because the
two share the same engine need — folds in the **dynamic-backend port** of `{% capture %}` that
docs/18 (written before interp/VM existed) did not cover.

## 2. The `{% apply %}` surface (frozen)

```text
{% apply PIPELINE %}BODY{% endapply %}
```

- **`BODY`** is rendered once (full template power: interpolation, control flow, partials),
  HTML-escaping its interpolations as usual — the result is a **safe** (pre-escaped) fragment.
- **`PIPELINE`** is a filter pipeline; **the rendered body is its implicit leading subject.**
  - `{% apply upper %}` → `upper(BODY)`
  - `{% apply truncate 280 %}` → `truncate(BODY, 280)`
  - `{% apply upper | truncate 280 %}` → `truncate(upper(BODY), 280)`
- The pipeline's result is **written at the `apply` site** (output-producing; unlike `capture`,
  which binds and produces nothing), and **emitted verbatim** (raw). **Corrected from the original
  freeze** (which said "otherwise escaped"): the body's *interpolations were already escaped while
  rendering it*, so the filtered fragment is safe markup — re-escaping it would double-escape. This
  is what the oracle does (its string ops preserve `VSafe`, Jinja `Markup`-style); Rust matches by
  emitting the `apply` Output raw. So `{% apply uppercase %}<b>{{x}}</b>` (x=`a`) → `<B>A</B>`, and a
  `{{ user }}` inside the body stays escaped through the filter.
- **`apply` binds nothing** and does not open a scope; the sibling tail continues unchanged.
- A bare `|` in the head is a parse error (as in any MaxBars block head, docs/19): the head *is* the
  pipeline, so `{% apply f %}` not `{% apply body | f %}`.

### Raw-body apply — composition, not a tag

To filter an **unprocessed** body (the old Handlebars quad-stache `{{{{op}}}}` use case — e.g.
`markdown` over literal markup with `{{ }}` left intact), **compose** with `{% raw %}`:

```text
{% apply markdown %}{% raw %}
  Literal {{ braces }} and {% tags %}, rendered as Markdown.
{% endraw %}{% endapply %}
```

We **reject** a dedicated `{% rawapply %}`/`{% rawfilter %}`: it would re-fuse the two orthogonal
constructs ADR-039 deliberately split when it retired the quad-stache. Two reusable tags compose;
don't add a one-off.

## 3. The desugar (oracle + Rust, identical to `SetSugar`)

`{% capture %}` already desugars in `Kernel.SetSugar.liftSet` (docs/18). `{% apply %}` joins it with
the same shape; both bottom out in an **inline partial** holding the body plus a **value-position
render** of it:

```text
{% capture NAME %}BODY{% endcapture %}TAIL
   ⟶  {% inline "@cap$k" %}BODY{% endinline %}
      {% local NAME = (render "@cap$k") %}TAIL{% endlocal %}        # forward scope = the tail is the local's body

{% apply PIPELINE %}BODY{% endapply %}
   ⟶  {% inline "@app$k" %}BODY{% endinline %}
      {{ (render "@app$k") | PIPELINE }}                             # output, no binding
```

`k` is the source-offset (hygienic, collision-free per ADR-018). In the **oracle**, `(render …)` is
the existing `(partial …)` value op (yields `VSafe`). In **Rust**, that value op does not exist yet
— §4 adds it.

## 4. The `render "@name"` value-op (the injection boundary holds)

A new internal value-op renders a **hoisted inline partial by a literal name** to a `Safe` value,
reusing each backend's existing partial expansion (interp `expand_partial`, the AOT partial emit,
the VM's partial path):

- **Literal name only.** `render` accepts a string *literal* argument; a computed/data name is a
  located error. Names stay static, data stays dynamic — the names-static injection invariant
  (docs/11 §6) is preserved exactly, as it is for `{% include %}`/`(partial …)`.
- It is **not surface** — the parser only ever emits it with a synthetic `@cap$`/`@app$` name. No
  user template can write `render` (it is not a reserved head, and a literal `@…` partial name is
  unreachable from author syntax).

## 5. The dynamic `Value::Safe` model (the crux)

In the **oracle**, capture/apply work because `(partial …)` yields a `VSafe` value that `{{NAME}}`
emits verbatim. The **AOT** path has the typed `trussbars_core::Safe` for the same reason. But the
**dynamic** `Value` (interp/VM) has *no* safe-string variant, and `{{ x | safe }}` is a **parse-time
output flag** (`Output{raw:true}`), not a value. So a captured `Value::Str` of pre-escaped HTML would
be **double-escaped** by a plain `{{NAME}}` (`Hello &lt;b&gt;` → `Hello &amp;lt;b&amp;gt;`),
diverging from the oracle.

**Decision: add `Value::Safe(Rc<str>)` to the dynamic `Value`.** A pre-escaped fragment carried *as
a value*, so it survives binding, piping, and re-output.

Semantics (the only rules that change):

| Operation | `Value::Safe(s)` |
| --- | --- |
| `write_escaped` (the `{{ x }}` path) | emit `s` **verbatim** (already escaped) — the no-double-escape rule |
| `raw_text` (the `{{ x \| safe }}` / `raw:true` path) | emit `s` verbatim |
| truthiness (`nonEmpty`/`Liquid`/`Handlebars`) | as `Str(s)` — non-empty ⟹ truthy (Liquid: always) |
| field/index navigation | `None` (a safe string is a scalar leaf, like `Str`) |
| `from_json` | never produced (JSON has no safe) — Safe is engine-internal only |
| a pipe op consuming it (`upper`, `truncate`, …) | sees the string `s` (ops coerce `Safe`→`str` like `Str`) |

`render` returns `Value::Safe`; `{% capture %}` binds it; `{% apply %}`'s pipeline starts from it.
Cost: `Value::Safe` is one `Rc<str>` (a clone is a refcount bump, like `Str`). The audit is ~130
exhaustive `Value::` match sites (interp + VM); most fall through identically to `Str`.

## 6. Rejected alternatives

- **`{% rawapply %}`/`{% rawfilter %}`** — compose `{% apply %}` + `{% raw %}` (§2). A fused tag
  re-makes the quad-stache mistake.
- **`{% call %}` (Jinja)** — already covered by `{% partial %}…{% endpartial %}` + `{% yield %}`
  (the caller-block mechanism). Only the *parameterized* caller (`caller(x)`) is unmet, and that is
  better framed later as "should `{% yield %}` take arguments," not a new construct.
- **First-class `Node::Capture`/`Node::Apply`** — touches ast/parse/emit/interp/vm/inherit/sig and
  hits the stateless-emit binding-scope wall for capture's forward scope. The `SetSugar` desugar
  sidesteps all of it (the tail becomes a `local` body) and is byte-identical to the oracle by
  construction.
- **No `Value::Safe` (keep `safe` parse-time-only)** — cannot express "render with escaping, emit
  verbatim" as a value, so `{{capturedName}}` double-escapes. Unfaithful; rejected.
- **`{% filter %}` spelling** — overloaded with collection filters / value pipes (see Naming).

## 7. Conformance & staged plan

Both constructs become **oracle ≡ AOT ≡ VM** gated (the `apply`-in-oracle decision). Corpus cases
land in `trussbars/conformance/cases.mjs` (capture: reuse/no-double-escape, safe-markup,
forward-scope, pipeable; apply: single filter, multi-pipe, filter-with-args, raw-body composition,
escaping of the result). Stages, each green + committed — **all delivered** (94/94 across `--v2`/
`--interp`/`--vm`). Notes on what changed in build:

- The `render` op landed in `eval_expr` only — that **covers both** interp *and* VM (the VM routes
  general output exprs through the shared evaluator), so no separate VM op was needed.
- The Rust desugars build `(render "@cap$k")` / `(render "@app$k")` source directly; the **oracle**
  uses an `__applybody__` placeholder (parser) that `SetSugar` substitutes (the oracle's `(partial …)`
  value op already yields `VSafe`).
- **Escaping correction** (§2): `apply` Output is **raw**, not "escaped otherwise" — the oracle's
  ops preserve `VSafe`, so the result is verbatim safe markup.
- The `__applybody__` placeholder and the capture *binding* both leak into PureScript schema
  inference (a `§Not-yet` gap), so the AOT cases carry `ctxFromData: true` (the data shape).
- The `filter`→`apply` reject shipped in **Rust**; a matching located reject in the **oracle**
  (where an unknown block head currently renders empty) is the one open follow-up.

1. **`Value::Safe`** in interp + VM (the ~130-site foundation; `write_escaped`/`raw_text`/truthiness
   rules; never from `from_json`).
2. **`render "@name"`** value-op (interp, AOT emit, VM), literal-name-only.
3. **Rust `{% capture %}`** desugar (parser) → port docs/18 to the dynamic backends; capture cases
   in `cases.mjs` (oracle already renders them) → gated.
4. **Oracle `{% apply %}`** in `Kernel.SetSugar` (+ the `filter`→`apply` located reject); MaxBars
   tests.
5. **Rust `{% apply %}`** desugar (parser; the pipeline-subject rule); apply cases → gated AOT≡VM≡oracle.
6. **Docs** — flip this ADR to Implemented; amend docs/18 (dynamic port), docs/01/06 (the surface),
   docs/11 (`Value::Safe`).

## 8. Implementation pointers

- **Oracle:** `packages/kernel/src/Kernel/SetSugar.purs` (`liftSet` — add the `apply` case beside
  `capture`); `packages/kernel/src/Kernel/Prelude.purs` (no new op — `apply` reuses `partial` +
  pipes); MaxBars/RawBars surface validation (the `filter`→`apply` reject).
- **Rust parser:** `crates/trussbars-template/src/parse.rs` — `RESERVED_BLOCK_HEADS` += `apply`
  (and the located `filter` reject); `capture`/`apply` desugar into `inline` + `local`/`Output`
  with a synthetic `@cap$`/`@app$` name and a `render` call.
- **Rust value model:** `crates/trussbars-interp/src/lib.rs` (`Value::Safe`, `write_escaped`,
  `raw_text`, `truthy*`, navigation, the `render` op in `eval_expr`); `crates/trussbars-vm/src/lib.rs`
  (the `Value::Safe` arms + the `render` op / `OutPath` interaction).
- **AOT:** `crates/trussbars-template/src/emit.rs` — `render "@name"` emits the existing inline-partial
  render into a `trussbars_core::Safe`.
- **Conformance:** `trussbars/conformance/cases.mjs` (+ regen `report.json`/snapshots via
  `gen:trussbars-snapshots`); `harness.mjs` already drives oracle + `--v2`/`--interp`/`--vm`.
