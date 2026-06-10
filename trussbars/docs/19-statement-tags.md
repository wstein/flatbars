# Trussbars — Django-style `{% %}` statement tags (control flow & separators)

> **Status:** **Proposed** — a two-sigil surface for the **nonEmpty-family + Trussbars**:
> `{{ }}` becomes **output-only**; every control-flow keyword, clause separator, and binding
> statement moves to **`{% %}`** (Django / Jinja / Liquid). It is delivered as a **`LexConfig`
> knob** (`statementTags`) — the same mechanism as `mustacheDelims` / `rangeOperator` /
> `collectionLiterals` — so it re-delimits the **existing** structural `Block`/`Sep` nodes and
> leaves the engine, desugar, validate, and compile drivers **untouched**.
>
> **Scope (by decision):** **RawBars, MaxBars, and Trussbars** only. **ClassicBars** (Handlebars-
> faithful) and **MinBars** (Mustache) keep `{{ }}`-only and are explicitly **out** — see §5.3.
>
> **Audience:** the lexer/parser owner and the v2 proc-macro author. Companions: `docs/12`
> (the `{{#case}}` separator machinery this simplifies), `docs/17`/`docs/18` (`set`/`local`/`capture`
> — **re-spelled** by this ADR, §5.6), `docs/01`/`docs/06` (subset + freeze — a major amendment,
> §5.4), `docs/08` (the v2 parser this extends), `docs/15` (the migration codemod), `docs/04`
> (conformance). Upstream: CLAUDE.md (the `LexConfig` knobs; the `RawBars ⊂ ClassicBars ⊂ MaxBars`
> ladder, ADR-005; `check:parity`; `checkSurfaceStrict`).
>
> **Naming.** `{% %}` is Django's, shared by Jinja, Liquid, and Twig — the established mark for
> *"a tag that does something but interpolates nothing."* `{{ }}` stays the mark for *"emit this
> value."* Close tags are Django-spelled `{% endif %}` (not `{% /if %}`) — §4 A3.

## 1. Context

The `{{ }}`-only family has a structural defect this ADR closes: **a clause separator has no
lexical marker.** `{{else}}`, `{{elif x}}`, `{{when "shipped"}}` are written *identically* to
output — `{{else}}` is the same shape as `{{city}}`, `{{when x}}` the same shape as a helper
call `{{format x}}`. Their separator role is not in the syntax; it is recovered *contextually*
by the enclosing block (`splitClauses`, [Kernel/Walk.purs:186](../../packages/kernel/src/Kernel/Walk.purs)),
and the names are effectively reserved.

The tax is visible in this repo's own decisions. `docs/12 §2` had to legislate around it:

- `case` is forced to become a **reserved built-in block head** — it can no longer name a host
  helper, because `{{#case}}` and a `{{case …}}` application are the same tag class.
- `when` / `else` are "**context-sensitive** separators … split by `parse_until`."
- "**Only whitespace** may precede the first `{{when}}` … non-whitespace before the first arm is
  a **located error**."

None of those rules describe *meaning*; they exist only because the parser cannot *see* that a
separator is a separator. The defect is **worst in exactly the dialects that added rich control
flow** — RawBars/MaxBars/Trussbars, which grew `case`/`when`/`elif`/`local`/`set`. The mild
classic `{{else}}` of Handlebars (ClassicBars) and the inverted sections of Mustache (MinBars)
carry far less of it (§5.3). So the cure belongs precisely where the disease is.

The governing question is **not** "should output syntax change?" (it must not — `{{ x }}` is
the one thing every reader already knows) but "should *non-output* tags get their own lexical
class, and what exactly moves?"

## 2. Decision

**In RawBars/MaxBars/Trussbars, `{{ }}` is interpolation-only and every non-output tag is
`{% %}`.** Concretely:

**Governing rule.** `{{ … }}` (and `{{{ … }}}`) *emits a value at this position*. `{% … %}`
*is structure or a statement and emits nothing by itself.* A tag's sigil is decided by that
one question.

**Stays `{{ }}` (output):**

| Form | Role |
| --- | --- |
| `{{ x }}`, `{{{ x }}}`, dotted `{{ a.b.c }}` | escaped / raw interpolation |
| `{{ x \| f arg }}`, `{{ uppercase x }}` | helper application that *produces* output |
| `{{> n}}`, `{{> n ctx}}` | partial **inclusion** (renders a sub-template — output) |
| `{{ yield }}` | emits the caller's block body (output) |
| `{{! comment }}` | comment (unchanged; **not** moved to Django's `{# #}` — §4 A4) |

**Moves to `{% %}` (control / separator / statement):**

| Construct | Frozen spelling |
| --- | --- |
| If / else-if / else | `{% if c %}…{% elif d %}…{% else %}…{% endif %}` |
| Unless | `{% unless c %}…{% endunless %}` |
| Each (+ empty arm) | `{% each item in xs %}…{% else %}…{% endeach %}` (the `docs/06`/`each-empty` arm) |
| With | `{% with obj %}…{% endwith %}` |
| Case / when / else | `{% case s %}{% when v … %}…{% else %}…{% endcase %}` |
| Local (bounded scope, `docs/17`) | `{% local a=(e) b=(e2) %}…{% endlocal %}` (the renamed block-`let`) |
| Set (forward scope, `docs/17`) | `{% set name = expr %}` |
| Capture (`docs/18`) | `{% capture name %}…{% endcapture %}` |
| Inline partial **definition** | `{% inline "n" %}…{% endinline %}` |
| Block-partial **definition-call** | `{% partial "n" ctx %}…{% endpartial %}` |
| Raw verbatim block | `{% raw %}…{% endraw %}` (retires quad-stache, §5.8) |

**Whitespace control** rides along on the same `~` marker as `{{~ ~}}`: `{%~ if c ~%}`.

**Delivery is a `LexConfig` knob — `statementTags`** — **on** for RawBars/MaxBars (and the
Trussbars subset), **off** for ClassicBars/MinBars (§5.3). This is the exact pattern of the
existing per-dialect knobs (`mustacheDelims`, `rangeOperator`, `collectionLiterals`).

## 3. The mechanism (why this is small)

`{% %}` is a **re-delimiting of the same structural nodes**, not new semantics. The skeleton
AST is unchanged: `{% if %}…{% endif %}` still parses to the same `Block`, `{% else %}` /
`{% when %}` to the same `Sep`, `{% set %}` to the same binding node the block-`let` (now
`{% local %}`) builds. The **desugar, interpret, and compile drivers never see the difference** —
they consume `Block`/`Sep`, and a `Block` does not record which delimiters opened it.

Two layers *do* change, and the doc should not pretend otherwise (cf. §5.1): the **lexer/parser**
(it recognizes `{% %}` and produces `Sep` from a lexical token instead of a reserved *name*), and
**`splitClauses`** in `Kernel.Walk` (it keys off that token rather than a reserved-name list). That
is precisely the *simplification* §5.1 claims — but it is a change to the walk machinery, not a
no-op. What stays invariant is everything *downstream* of `Block`/`Sep`: the IoC interpret driver,
the desugar rules, the validator, and every emit backend.

What changes is confined to the **lexer/parser and `splitClauses`**:

```text
LexConfig { statementTags = true }     ⇒  `{%` opens a statement tag, scanned to `%}`
                                          (brace-aware close, like collectionLiterals'
                                          structural scanner); the contained head selects
                                          Block-open / Block-close (`endX`) / Sep / Statement.
```

Concrete before/after (MaxBars):

```handlebars
{{!-- before --}}
{{#each post in posts}}
  {{#if post.draft}}draft{{elif post.pinned}}pinned{{else}}live{{/if}}
{{else}}(no posts){{/each}}

{{!-- after --}}
{% each post in posts %}
  {% if post.draft %}draft{% elif post.pinned %}pinned{% else %}live{% endif %}
{% else %}(no posts){% endeach %}
```

`post.draft`, the body text, and any `{{ post.title }}` interpolation inside are **untouched** —
only the structural tags moved. The parsed tree, the `nonEmpty` truthiness, and every rendered
byte are identical, so the conformance corpus re-renders byte-for-byte.

**In Trussbars** the change is equally confined: the v2 lexer (`docs/08`) learns `{% %}`; the
desugar, the AOT Rust emitter, and the VM are **unchanged** (same `Block`/`Sep` → same Rust
`if`/`for`/`match`). The payoff lands in **diagnostics**: a stray `{% else %}` is now a *parse*
error with a span (`else outside if`) instead of a render-time unknown-helper, and `{% endif %}`
vs `{% endeach %}` mismatches are caught lexically.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **Full `{% %}` for all non-output tags** (this ADR) | **Chosen** | Gives separators, keywords, *and* statements one unambiguous class. A `LexConfig` knob re-delimits existing nodes — engine/compiler untouched. Matches Django/Jinja/Liquid muscle memory and the project's "output vs effect" split. |
| **A2** | Clause sigil only — `{{:else}}` / `{{:when}}` (Svelte's `{:else if}`) | **Rejected** | Fixes *only* the separator, keeping blocks as `{{#if}}`. Smaller, but leaves a *third* delimiter style in play and still reads control flow as curlies; the team chose the cleaner two-sigil split that also re-homes `local`/`set`/`capture`. Recorded as the runner-up. |
| **A3** | Close tags `{% /if %}` (uniform structural close) | **Rejected** | More regular vs `#`/`/`, but non-idiomatic for `{% %}`; Django/Jinja/Liquid/Twig all spell `{% endif %}`. Faithfulness wins; the verbosity is the cost of the convention. |
| **A4** | Also move comments to `{# #}` and rename `each`→`for` | **Out of scope** | Each is an *independent* breaking change with its own churn; bundling them inflates the migration. `{{! }}` comments and the `each` keyword stay. `for`/`{# #}` may be revisited as separate alignments. |
| **A5** | Status quo — name-agnostic `Sep` in `{{ }}` | **The baseline** | Smallest grammar, but pays the `docs/12 §2` reservation/located-error tax in every control-flow ADR and produces a structurally-dishonest AST (output-shaped separators). |

## 5. Consequences

### 5.1 The namespace splits cleanly — code is deleted, not added
With separators in their own class, `else`/`elif`/`when`/`case` stop being reserved *names*: a
host helper or a data field may be named `else`, and `{{ else }}` can even *output* it, because
`{% else %}` is a different tag entirely. `splitClauses` keys off the lexical `Sep` token rather
than a reserved-name list; the `case`-as-reserved-head rule (`docs/12 §5.2`) and the
"whitespace-only before the first arm" located error relax. The parser stops manufacturing an
`Output` node it must later reinterpret. This is the "simplifies the code we needed to solve
`{{else}}`" payoff stated in the request — realized as *removed* special-casing.

### 5.2 The `⊂` ladder becomes structural, not textual (ADR-005 amendment)
`RawBars ⊂ ClassicBars ⊂ MaxBars` was a *surface*-superset "modulo documented exceptions." With
RawBars/MaxBars on `{% %}` and ClassicBars on `{{# }}`, ClassicBars is no longer a textual superset of
RawBars. The ladder is amended to mean **shared engine/prelude/compiler** (still true) with the
control-tag *delimiter* now a documented per-dialect surface divergence — the largest yet, but
the same *kind* as `mustacheDelims`/`rangeOperator`. `check:parity` (RawBars ≡ MaxBars) is
**unaffected** — both carry `statementTags`. The cross-dialect lowering (`linter`, MaxBars →
RawBars *source*) emits `{% %}`, which makes "this is the desugared structural form" visually
obvious.

### 5.3 ClassicBars and MinBars stay `{{ }}`-only — the cure is aligned with the disease
- **ClassicBars is Handlebars-faithful**; its value is drop-in `{{#if}}…{{/if}}{{else}}`
  compatibility, gated against the real `handlebars` npm package (98% conformance). `{% %}` would
  break that contract outright — so `statementTags = false`, and the LSP keeps layering its
  `dialectDiagnostics` (as it already does for `mustacheDelims`) so a `{% %}` typed in ClassicBars
  surfaces an actionable "use RawBars/MaxBars" message, not a raw parse failure.
- **MinBars is Mustache-faithful** (`{{#}}/{{/}}/{{^}}`, no `else`/`elif`/`when`), gated against
  the official `mustache/spec`. It has *no* separators to disambiguate. `statementTags = false`.

The residual `{{else}}` ambiguity therefore remains *only* where the upstream spec mandates it
and where it is mildest — never in the rich-control-flow dialects, which are cured.

### 5.4 A breaking surface change — codemod + located rejection (the discipline)
Every existing RawBars/MaxBars/Trussbars template, the conformance corpus, the `/rawbars` and
`/maxbars` tutorials, `examples/`, and the editor grammar change. Per CLAUDE.md's standing rule
(*settle the spelling in the ADR, then migrate once; reject the removed form with a located,
actionable error*):

- **Codemod.** Extend `flatbars migrate` / `docs/15` with a purely-mechanical rewrite
  (`{{#if}}`→`{% if %}`, `{{/if}}`→`{% endif %}`, `{{else}}`→`{% else %}`, `{{#each … in …}}`→
  `{% each … in … %}`, `{{when v}}`→`{% when v %}`, `{{#let …}}`→`{% local … %}` (rename, docs/17),
  etc.). It is a
  delimiter swap on an unchanged tree, so it is total and reversible.
- **Reject the old form.** In `statementTags` dialects a `{{#if}}` / `{{/if}}` / bare `{{else}}`
  is a `checkSurfaceStrict` located error pointing at the `{% %}` form — never a silent no-op.

### 5.5 Editors, highlighting, LSP
`{% %}` needs a token class in `editors/token-vocabulary.json` (the ERB-canonical
`punctuation.section.embedded.*` with the `%`-sigil split out as `keyword.control.*`), threaded
to the engine `tokenize`, the TextMate grammar (`check:tmgrammar`), and the LSP legend
(`check:vocab`). This is *net simpler to highlight* than the status quo: control flow is now
lexically separable from output, so the grammar no longer needs the keyword-name heuristics it
uses to tint `{{else}}` differently from `{{city}}`.

### 5.6 Houses `docs/17` (`set`/`local`) and `docs/18` (`capture`)

In these dialects the binding statements are `{% set x = e %}` / `{% local x = e %}…{% endlocal %}`
and `{% capture x %}…{% endcapture %}` — the spellings in `docs/17`/`18`
were written before this ADR and are superseded *for RawBars/MaxBars/Trussbars*. Their
**semantics are unchanged** (forward scope, `safe`-typed capture, the borrow/injection rules);
only the delimiters move. Those ADRs carry a forward-pointer to here.

### 5.7 Governance: nonEmpty-family *surface*, oracle-first
A language/surface change, so it lands in the RawBars/MaxBars oracle first (the `statementTags`
knob in the shared lexer), giving the corpus an authority before Trussbars conforms byte-for-
byte (`docs/12 §5.5`).

### 5.8 Raw blocks: `{% raw %}…{% endraw %}` retires the quad-stache
`{{{{#raw}}}}…{{{{/raw}}}}` existed so a raw body could contain literal `{{ }}`. `{% raw %}…{%
endraw %}` scans verbatim to `{% endraw %}`, so the body may now contain **both** literal `{{ }}`
and `{% %}` — strictly more capable. The quad-stache is retired in `statementTags` dialects
(rejected with a located error, §5.4); it remains in ClassicBars/MinBars.

## 6. Status & sequencing

1. **Surface frozen (§2).** The moved/stays partition, the `{% endX %}` close spelling, the `~`
   whitespace marker, and the `statementTags` knob are fixed here.
2. **Oracle first (§5.7).** Add `statementTags` to `LexConfig`; lex `{% %}` (brace-aware close)
   into the existing `Block`/`Sep`/statement nodes; enable for RawBars/MaxBars. Re-render the
   corpus byte-for-byte; add `stmt-*` cases (stray-separator parse error, `endX` mismatch, the
   namespace-split proof — a field named `else`).
3. **Atomic cutover — no red window (§5.4).** The danger is an interval where the oracle accepts
   only `{% %}` but every downstream fixture is still `{{ }}` (or vice versa) and the gates go red.
   Avoid it by making the switch *one commit*, staged in three sub-steps **within** that commit:
   1. **Land the lexer dual-reading, gated off.** `statementTags` defaults **false**, so the
      oracle still parses today's `{{ }}` surface and every gate stays green — the knob is dormant.
   2. **Run the codemod over every fixture in the same commit.** `flatbars migrate` rewrites the
      71-case corpus, the `/rawbars` + `/maxbars` tutorials, `examples/`, and the editor fixtures
      from `{{ }}` → `{% %}` (a delimiter swap on the unchanged tree, so it is total and
      reversible). Because the moved tags re-parse to the *same* `Block`/`Sep` nodes, every
      rewritten template renders byte-for-byte identically — the conformance corpus, `check:parity`
      (RawBars ≡ MaxBars), and `test:compile` (interpreter ≡ compiler) all stay green across the
      rewrite.
   3. **Flip `statementTags = true` for RawBars/MaxBars and turn on `checkSurfaceStrict`** for the
      old `{{#…}}`/`{{else}}`/quad-stache forms — in the *same* commit, after the fixtures are
      already `{% %}`. The flip and the now-migrated fixtures land together, so the build is never
      half-converted.
   The commit is the one-way door: there is no staged coexistence and no `{{ }}`-control-flow
   fallback for these dialects (the `{{:else}}` clause-sigil of §4 A2 is *not* held in reserve —
   it is a rejected alternative, not an escape hatch).
4. **Trussbars (`docs/08`) — DONE.** The Rust `trussbars-template` lexer learns `{% %}`
   (a port of `FlatBars.Lexer.readStatementTag`: `{%`→the same `Lexeme::Tag` sigils the
   `{{ }}` form yields, brace-aware `%}` close); the parser gains the `local` block
   (docs-17) and the `elif` clause; the desugar/emitter/VM are untouched. The conformance
   corpus is `{% %}` and all backends pass — AOT 71/71, `--v2` 71/71, `--vm` 71/71,
   `--vm-compat` 71/71. `{{ }}` control flow stays a lenient superset for now (the strict
   legacy-reject + the remaining parse-time diagnostics of §3 are a follow-on refinement).
5. **Editors (§5.5)** and the `docs/06` freeze amendment, both inside the step-3 commit (the
   editor fixtures are migrated in 3.ii; the freeze §1 spellings update with the flip in 3.iii).

## 7. Summary

- In **RawBars / MaxBars / Trussbars**, `{{ }}` is **output-only** and every control keyword,
  clause separator, and binding statement is **`{% %}`** (Django/Jinja/Liquid).
- It ships as a **`LexConfig` knob (`statementTags`)** that **re-delimits the existing
  `Block`/`Sep` nodes**. The lexer/parser and `splitClauses` change (the *simplification*, §5.1);
  the desugar, interpret, and compile drivers are **untouched** — rendered bytes are identical
  (conformance holds).
- It **deletes** the separator-ambiguity machinery (`docs/12 §2`): `else`/`when`/`elif`/`case`
  stop being reserved names, `splitClauses` keys off a real token, the AST stops lying.
- **ClassicBars** (Handlebars) and **MinBars** (Mustache) are **excluded** and keep `{{ }}`-only —
  upstream-fidelity contracts, and the dialects where the ambiguity is mildest. The cure is
  aligned with the disease.
- It is a **breaking** change handled by the project discipline: freeze here, a mechanical
  `flatbars migrate` codemod, and a located rejection of the old `{{#…}}` form. It re-spells the
  `set`/`local`/`capture` tags of `docs/17`/`18` and retires the raw quad-stache (§5.8).
