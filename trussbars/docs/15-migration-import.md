# Trussbars — Migration Tool (`trussbars-import`)

> **Status:** **IMPLEMENTED** — the foreign-dialect *parsers* (all four dialects) **and**
> the **`…→ idiomatic .truss`** write half for **all four**: idiom metrics (Mustache), an
> idiom-aware lowering to the Trussbars IR per dialect, the IR→`.truss` *Lift*, and the
> `truss-import` CLI (`--metrics`, `--to-truss`). **Audience:** whoever builds out the
> `…→.truss` migration tool docs/13 makes a lead post-severance item. **Companion docs:**
> realises the **migration tool** row of `docs/13 §6`; `docs/12` (`{{#case}}`) and
> `docs/14` (`{{#match}}`) are downstream collapse targets.

## 1. Why this exists

`docs/13` (spin-out) makes a **Mustache/Handlebars→`.truss` migration tool** one of
the two lead deliverables of the post-severance build-out. A migration tool must
*read* a foreign template before it can lower it to MaxBars. This crate is that read
half: exhaustive, faithful parsers for four foreign template dialects, each producing
its own AST. The conversion to Trussbars syntax is deliberately a later step — see §6.

## 2. Scope

Parsers for four dialects, dispatched by file extension:

| Dialect | Extensions | Module |
| --- | --- | --- |
| **Mustache** (spec v1.4) | `.mustache` | `mustache` |
| **Handlebars** | `.hbs`, `.handlebars` | `handlebars` |
| **Liquid** (Shopify/Jekyll) | `.liquid` | `liquid` |
| **StringTemplate4** | `.st` (body), `.stg` (group) | `stringtemplate` |

Each is a **hand-rolled** byte-span lexer + recursive-descent parser with **zero
external dependencies**, matching the rest of the workspace. Every node carries a
byte-offset `Span` (reused from `trussbars-template`) so the migration tool can map
its output back to the original source — the same role spans play for diagnostics
(`docs/07`) and the inspect map (`docs/10`).

## 3. Design — per-dialect ASTs, one dispatcher

The four grammars diverge sharply (Liquid tags & filters, ST4 template groups &
anonymous templates, Handlebars block helpers & subexpressions, Mustache's minimal
core). **A shared AST would discard the structure a faithful migration depends on**,
so each dialect keeps its own fidelity-preserving AST. The *future* lowering is what
normalises the four; the parsers do not.

The public surface is small:

- `Dialect` — the dialect tag, with `from_extension` / `from_path` / `from_name`
  dispatch (`.mustache`, `.hbs`/`.handlebars`, `.liquid`, `.st`, `.stg`).
- `Ast` — a dialect-tagged union of the four root types.
- `parse(dialect, src) -> Result<Ast, ParseError>` — the one entry point.
- `truss-import` — a dev CLI that infers the dialect from the file extension (or
  `--dialect`), parses, and dumps the AST (`{:#?}`, no serialization dependency).

`ParseError { message, at }` mirrors `trussbars_template::ParseError` so the future
lowering can thread one error type end to end.

## 4. Coverage (exhaustive per dialect)

- **Mustache** — variables (`{{x}}` / `{{{x}}}` / `{{&x}}`), sections & inverted
  sections, comments, partials, **set-delimiters** (`{{=<% %>=}}`), dotted &
  implicit (`{{.}}`) names, **standalone-line whitespace stripping**, and the
  inheritance (`{{<parent}}` / `{{$block}}`) and dynamic-partial (`{{>*name}}`)
  modules. Lambdas are a runtime concern — the parser records the name.
- **Handlebars** — a Mustache superset: helper calls with positional & **hash**
  arguments, **subexpressions** `(h a)`, rich paths (`../`, `@data`, `this`,
  segment literals `[a b]`), block helpers with **`{{else if}}` chains** and
  `as |x y|` **block params**, inverted blocks, partials / **partial blocks** /
  **inline partials**, **decorators**, **raw blocks** `{{{{h}}}}…`, the two comment
  forms, and `{{~ ~}}` + standalone whitespace control.
- **Liquid** — object outputs with chained, **named-argument filters**; variable
  paths with `.`/`[…]` accessors; literals incl. `nil`/`empty`/`blank` and `(a..b)`
  ranges; the full core tag set — control (`if`/`elsif`/`else`/`unless`/`case`/`when`),
  iteration (`for`/`tablerow` with `limit`/`offset`/`reversed`, `break`/`continue`),
  variable (`assign`, `capture`, `increment`/`decrement`), theme (`include`/`render`/
  `section`), utility (`raw`, `comment`, `liquid`, `echo`, `cycle`, `ifchanged`);
  conditions (`== != > < >= <= contains and or`); `{{- -}}` / `{%- -%}` whitespace
  control. **Unknown (host-defined) tags are preserved verbatim** rather than
  rejected, so a migration run does not abort on a custom tag.
- **StringTemplate4** — `.st` bodies (text, `<expr>`, `<if>`/`<elseif>`/`<else>`/
  `<endif>`, `<! comment !>`, `<@region>` definitions) and `.stg` group files
  (`delimiters`/`import`/`group` directives, `name(params) ::= "…"` / `<<…>>` /
  `<%…%>` definitions, dictionaries) share one expression model: attribute &
  property access (`a.b`, `a.(e)`), template includes (`t(args)`, `(e)(args)`),
  the `:` **map/apply** operator (anonymous subtemplates `{x | …}`, multiple targets
  `a,b:t()`, chains), lists, string/bool literals, the `!`/`&&`/`||` conditional
  operators, and `; option=value` settings. Delimiters are configurable (a group's
  `delimiters` directive overrides the default `<` / `>`).

## 5. Conformance & testing

Parser-level unit tests live beside each module (`#[cfg(test)]`) and exercise every
construct above; integration tests (`tests/<dialect>.rs`) drive the public
`parse(dialect, …)` API over representative fixtures (`tests/fixtures/`) and assert
both AST shape and that spans point back into the source. The crate clears the
workspace lint bar (`forbid(unsafe)`, `deny(missing_docs)`, `deny(clippy::all)`).

## 6. The write half — Mustache → idiomatic `.truss`

The conversion is a three-stage pipeline (`metrics → lower → lift`), not a 1:1 node map.
*Idiomatic* means recurring shapes collapse to the natural MaxBars construct, and which
collapses to apply (and their thresholds) is chosen from **measured frequencies**, not
guessed.

- **`metrics`** (`metrics::mustache`) — a structural pass that counts idiom candidates so
  the lowering's parameters are data-driven. Run over a corpus (`truss-import --metrics`)
  to see which idioms occur. It detects the idiom catalogue below plus residual counts and
  structural tallies.
- **`lower`** (`lower::mustache`) — `mustache::Node` → `trussbars_template::ast` IR + a
  structured migration report, applying the idioms under [`LowerOptions`].
- **`lift`** (`lift::to_truss`) — the IR → idiomatic `.truss` serializer (re-sugars `lookup`
  chains to dotted paths and the desugared operators to infix: `c ? a : b`, `a == b`,
  `a ?? b`, `!x`). Faithful to the source's own whitespace.

### Idiom catalogue (metric → parameter)

| Idiom | Pattern → target | Default |
| --- | --- | --- |
| **I1** complementary collapse | `{{#x}}A{{/x}}{{^x}}B{{/x}}` (either order) → `{{#each}}…{{else}}` / `{{#with}}…{{else}}` / `{{#if}}…{{else}}` by **shape** | on |
| **I2** lone inverse | unpaired `{{^x}}B{{/x}}` → `{{#unless x}}B{{/unless}}` | on |
| **I3** trivial ternary | a trivial scalar pair → `{{x ? A : B}}` | `--ternary` |
| **I4** section shape | `{{#x}}` → `each` / `with` / `if` from an optional data sample (heuristic: assume iteration, with a note) | on |
| **I5** case run | run of ≥2 exclusive sections → `{{#case}}` | measure-only |

### Section shape — the data sample

A bare Mustache `{{#x}}` is overloaded (iterate a list / re-scope an object / test a scalar).
Without type information the lowering cannot know which; a [`ShapeOracle`] supplies it. A
`--data sample.json` resolves each path exactly (array → `each`, object → `with`, scalar →
`if`, descending into array elements for nested sections); absent a sample, the heuristic
assumes iteration and annotates the guess.

### Truthiness operators

Two idioms turn the truthiness delta into explicit operators rather than a caveat:

- **`?:` value-or-default** (`--ternary`): a complementary pair whose positive arm just
  echoes the value — `{{#name}}{{name}}{{/name}}{{^name}}Anon{{/name}}` — collapses to
  `{{name ?: "Anon"}}` (first-truthy / Elvis); a non-echoing trivial pair becomes
  `{{x ? A : B}}`.
- **Faithful predicate** (`--faithful-truthiness`): a bare-value condition becomes the
  *exact* predicate `{{#if (x != null) && (x != false)}}` — which reproduces Liquid (any
  value) and Mustache-scalar truthiness under `nonEmpty` regardless of how it treats
  `0`/`""`/`[]`/`{}` — and **no caveat is emitted**. Handlebars keeps the note (its rule
  makes `0`/`""`/`[]` falsy but `{}` truthy, which `nonEmpty` cannot reproduce). Under this
  flag the ternary's condition is guarded too (`(x != null && x != false) ? A : B`).

### Faithfulness & residuals

By default the Mustache↔MaxBars **truthiness delta** (`0`/`""`/`{}` truthy in Mustache;
`""`/`[]`/`{}` falsy under `nonEmpty`) is **accepted and annotated** on each boolean/scope
use — the migrated `.truss` carries an inline `{{! migrate: … }}` note and the report
records it (use `--faithful-truthiness` to make it exact instead).
Inadmissible constructs become residuals: a **dynamic partial** `{{>*x}}` (crosses the
names-static / data-dynamic boundary) and **inheritance** `{{<}}/{{$}}` are reported and
left as `{{! migrate: … — needs a human }}` comments; a **set-delimiter** directive is
dropped (MaxBars has fixed delimiters); Mustache **comments** are preserved as `.truss`
comments.

### CLI

**Migrating to `.truss` is the default mode.** `truss-import <file>` writes the migrated
`.truss` to stdout and the report to stderr; `--metrics` reports the idiom metrics, `--ast`
dumps the parsed AST. The idioms (`?:`/ternary collapse and the faithful-truthiness
predicate) are **on by default** — opt out with `--no-ternary` / `--no-faithful-truthiness`;
`--data s.json` supplies the section-shape sample, `--report-json` emits the report as JSON.
Output is **readable by default** — each block tag (`{{#each}}`, `{{#if}}`, `{{else}}`,
`{{/…}}`) on its own indented line, content re-flowed to trimmed lines; since block-tag
lines are standalone (the engine trims them) the render is preserved for
whitespace-insensitive content. Use `--compact` for the verbatim rendering (preserves
source whitespace exactly — preferable for `<pre>`/code-generation). `-o/--out <path>`
writes to disk instead of stdout: a folder (or a path with no extension) receives
`<input-stem>.truss` (parents created as needed), any other path is taken as the output
file.
(The library `LowerOptions::default()` stays conservative — all idioms off — so a host opts
in explicitly; the CLI is the opinionated front-end.)

### Handlebars

`lower::handlebars` maps the Handlebars superset to the IR. Built-in blocks
(`if`/`unless`/`each`/`with`) lower directly, with `{{else if}}` chains flattened to
`Cond` `elifs`, `as |item idx|` block params to the `each` bindings, and subexpressions
`(helper a)` to nested applications. Custom block helpers become `{{#head args}}…{{/head}}`
([`ir::HelperBlock`]); partials / partial blocks / inline partials map across; comments and
raw blocks are preserved. `@data` references map to MaxBars equivalents (`@root`, `@index`
→ `loop.index0`, `@first`/`@last`/`@key` → `loop.*`). Divergences are annotated: the
**truthiness rule** differs (Handlebars `0`/`""` falsy, `{}` truthy; `nonEmpty` the
inverse); a custom block helper's `{{else}}` arm is dropped (host block helpers are
binary, `docs/09`); **hash arguments** and `../` **parent paths** (removed in MaxBars,
ADR-021 — mapped best-effort to `@parentchain`) need review; **dynamic partials** and
**decorators** are residuals.

### Liquid

`lower::liquid` maps control flow directly — `if`/`elsif`/`else` → `Cond`, `unless`,
`case`/`when` → `{{#case}}`, `for` → `{{#each}}` — and `render`/`include`/`section` of a
**string-literal** template → a partial (computed names are residuals). Output filters
become a MaxBars helper chain (`upcase` → `uppercase`, `size` → `count`, `default` →
`firstTruthy`); a filter that matches a Trussbars prelude operation or a blessed i18n
host helper (`t`, `relative`, `number`, `date`, `selectPlural`, `json` — docs/09) passes
through unflagged, while a foreign one (e.g. Shopify's `link_to`) is flagged to register
as a host helper or convert. Two semantic deltas: Liquid is **not auto-escaping**, so
output is emitted *raw* (`{{{ }}}`) unless an `escape` filter is present (which is
consumed) — preserving behaviour; and the **truthiness rule** differs (Liquid: only
`false`/`nil` falsy). Stateful tags are residuals: `assign` (template-scoped — the report
shows the `{{#let}}` to wrap the dependent region), `capture`, `increment`/`decrement`,
`cycle`, `break`/`continue`, `tablerow`, and unknown tags; `for` `limit`/`offset`/
`reversed` are noted for conversion to a pipe.

### StringTemplate4

`lower::stringtemplate` (`.st`) maps `<expr>` → output (ST4 is not auto-escaping, so
*raw*), `<if(c)>…<elseif>…<else>` → `Cond`, a single-target `:` map (`<xs:{x|…}>` /
`<xs:t()>`) → `{{#each}}`, and a top-level named include `<t(…)>` → a partial.
`lower::stringtemplate_group` (`.stg`) turns each template definition into a
`{{#inline "name"}}…{{/inline}}` partial (parameters flagged for context declaration).
Residuals (no MaxBars analogue): `; separator=`/`null=`/… **options**, **multi-target**
and **chained** maps, **indirect** includes `(e)()`, **dynamic** properties `a.(e)`, an
anonymous subtemplate / map used as a value, list literals, dictionaries, and `<@region>`
(rendered inline with a note).

## 7. Out of scope (the next deliverables)

- **The differential gate** — render the migrated `.truss` and the original through both
  engines and assert equivalence *modulo a semantic-delta ledger* (truthiness, escaping,
  missing-key). Needs the real foreign engines as oracles. The idiom linter shares this
  rewrite engine (`docs/13 §6`); conformance-test against the PureScript `packages/linter`
  reference *while it still exists* (`docs/13`).
- **Schema inference** (`docs/03`) — to emit a *compiling* typed `.truss` (a `Ctx`).
- **The differential gate** — render the migrated `.truss` and the original through both
  engines and assert equivalence *modulo a semantic-delta ledger* (truthiness, escaping,
  missing-key). Needs the real foreign engines as oracles.
- **Schema inference** (`docs/03`) — to emit a *compiling* typed `.truss` (a `Ctx`), not
  just idiomatic surface; until then the data sample / heuristic disambiguates sections.
- **Wiring the official `mustache/spec` JSON suite** as a parser-level fixture (vendored in
  the flatbars repo under `lab/examples/vendored/mustache/`); hand-authored corpora cover
  the constructs here today.
- **Runtime/semantic concerns** (lambda evaluation, filter behaviour) — recorded by name
  and structure only.
