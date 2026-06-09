# Trussbars — Migration-Tool Read Half (`trussbars-import`)

> **Status:** **IMPLEMENTED** (the foreign-dialect *parsers*). The lowering of each
> foreign AST → the Trussbars AST (`trussbars-template::ast`) is the **next**,
> separate deliverable and is explicitly out of scope here. **Audience:** whoever
> builds the `…→.truss` migration tool docs/13 makes a lead post-severance item.
> **Companion docs:** realises the **migration tool** row of `docs/13 §6`; the
> output of these parsers is the migration tool's input.

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

## 6. Out of scope (the next deliverables)

- **The lowering itself** — foreign AST → `trussbars_template::ast::Node`, the
  migration tool proper. The idiom linter shares this rewrite engine (`docs/13 §6`).
  Conformance-test the Rust output against the PureScript `packages/linter` reference
  *while it still exists* (`docs/13`).
- **Wiring the official `mustache/spec` JSON suite** as a parser-level fixture (the
  flatbars repo vendors it under `lab/examples/vendored/mustache/`). Hand-authored
  corpora cover the constructs here; gating against the full upstream suite is a
  follow-up.
- **Runtime/semantic concerns** (lambda evaluation, filter behaviour) — the parsers
  record names and structure only.
