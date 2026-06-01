# `barebars` — the reference library

The PureScript reference implementation of the BareBars core, targeting the
specification in [`docs/`](../../docs/modules/ROOT/pages/). It compiles to
JavaScript, so a BareBars engine drops into the same places Handlebars does.

## Modules

This package is the **framework** only. The reference engine, **FullBars**,
lives in [`packages/fullbars`](../fullbars/) and is built on top of these modules.

| Module | Spec chapter | Role |
| --- | --- | --- |
| `BareBars.Error` | §4 | `ParseError` and `Error` types |
| `BareBars.Value` | §3.2 | `Value` data type (+ `Eq`/`Show`) |
| `BareBars.Syntax` | §3.1 | core AST: `Template`, `Node`, `Expr` |
| `BareBars.Lexer` | §1 | template tokenizer + expression tokenizer (`~`, escapes, comments, raw blocks) |
| `BareBars.Parser` | §2 | `parse :: String -> Either ParseError Template` |
| `BareBars.Span` | — | `Span` source ranges + `lineColumn`/`spanText` |
| `BareBars.Engine` | §3.4–3.6, A.13 | polymorphic IoC driver: `Ctl m env`, `Helper m env`, `Engine m env`, `runTemplate`/`runString` |
| `BareBars.Walk` | §4.3 | skeleton visitor (`foldRefs`/`foldTemplate`/`foldExpr`), `splitClause`, schema `validate` |
| `BareBars.Helper` | A.13 | arity-checked arg combinators (`nullary`/`unary`/`binary`/`variadic`/`atLeast`) for building helpers |
| `BareBars` | §7 | framework aggregator: `parse`, `runTemplate`, `validate`, `foldTemplate`, spans, the `Value` and `Engine` types |

The JSON ⇆ `Value` bridge (`BareBars.Json`: `parseValue`/`fromJson`/`toJson`) lives in a
separate adapter, [`packages/json`](../json/) (`barebars-json`), so the framework
carries no JSON dependency — JSON-ness is a host concern.

The reference engine **FullBars** is in [`packages/fullbars`](../fullbars/), with
modules `FullBars.Value` (value policy: `truthy`, `stringify`, `escapeHtml`),
`FullBars.Env` (`RefEnv m`, registry ops, `refEngine`), `FullBars.Prelude`
(`prelude` + `preludeSchema`), `FullBars.Lower` (`lower`, `RNode`,
`escapingWarnings`), and the `FullBars` aggregator exposing `preludeEnv`,
`compile`, `renderWith`, and `renderAff`.

## What works today

The full pipeline for **core syntax** renders end-to-end:

```purescript
import BareBars (Value(..))
import FullBars (renderWith)

renderWith "{{#each (lookup this \"xs\")}}<li>{{{this}}}</li>{{/each}}"
           (VObject (Map.fromFoldable [Tuple "xs" (VArray [VString "a", VString "b"])]))
-- Right "<li>a</li><li>b</li>"
```

Implemented: the **skeleton AST** (`{{{ output }}}`, `{{#block}}…{{/block}}`,
raw blocks `{{{{#raw}}}}…{{{{/raw}}}}`, comments, backslash escaping, `~`
whitespace control) with source spans on every tag; a **fully polymorphic
inversion-of-control engine** (`runTemplate`/`runString` over any
`MonadThrow Error m` and any `env`), with the reference engine supplied for
both `Either Error` (`renderWith`/`compile`) and `ExceptT Error Aff`
(`renderAff`) by the FullBars engine; multi-branch control flow via **`{{else}}` separators**
(`{{#if c}}…{{else}}…{{/if}}` — a name-agnostic `Sep` marker the engine splits
at); prelude helpers `this`, `lookup`, `true`/`false`/`null`, `escapeHtml`,
`safe`, `raw`, `if`, `unless`, `each`, `with`, `else`, `dict`, `apply`,
`partial`, `inline`, `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `not`, `and`, `or`, `log`;
and a JSON-schema-style `validate` over the skeleton.

`FullBars.Lower` is the reference *walker* (ADR-001): a `foldTemplate` that turns
the structural AST into the typed real AST (`RIf`/`ROut`/…), resolving clauses
(`{{else}}` → branches) and escaping (`escapeHtml` → the escaped flag). It backs the
playground's "Real AST" view and the `escapingWarnings` safety lint.

## Next milestones

- Extend `FullBars.Lower` with the rest of the surface dialect — `{{ }}`
  auto-escape, dotted-path → `lookup`, `@data`, hash args, partials (§5). Until
  then, author in core syntax.
- Partials & decorators in the prelude (§6.6).

## Test

```sh
spago test -p barebars      # or, from the repo root: npm test
```
