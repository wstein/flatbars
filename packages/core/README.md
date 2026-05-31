# `barebars` — the reference library

The PureScript reference implementation of the BareBars core, targeting the
specification in [`docs/`](../../docs/modules/ROOT/pages/). It compiles to
JavaScript, so a BareBars engine drops into the same places Handlebars does.

## Modules

| Module | Spec chapter | Role |
| --- | --- | --- |
| `BareBars.Error` | §4 | `ParseError` and `Error` types |
| `BareBars.Value` | §3.2, §3.6 | `Value`, `truthy`, `stringify`, `escapeHtml` |
| `BareBars.Syntax` | §3.1 | core AST: `Template`, `Node`, `Expr` |
| `BareBars.Lexer` | §1 | template tokenizer + expression tokenizer (`~`, escapes, comments, raw blocks) |
| `BareBars.Parser` | §2 | `parse :: String -> Either ParseError Template` |
| `BareBars.Span` | — | `Span` source ranges + `lineColumn`/`spanText` |
| `BareBars.Engine` | §3.4–3.6, A.13 | polymorphic IoC driver: `Ctl m env`, `Helper m env`, `Engine m env`, `runTemplate`/`runString` |
| `BareBars.Env` | §3.3 | the reference engine: pluggable `RefEnv m`, registry ops, `refEngine` |
| `BareBars.Prelude` | §6 | the reference prelude (`Helper m (RefEnv m)`) + `preludeSchema` |
| `BareBars.Walk` | §4.3 | skeleton visitor (`foldRefs`/`foldTemplate`), clause utilities, schema `validate` |
| `BareBars.Surface` | §5 | surface dialect — **scaffold/TODO** |
| `BareBars.Json` | — | JSON ⇆ `Value` bridge for hosts |
| `BareBars` | §7 | host API: `parse`, `runTemplate`, `validate`, `compile`, `renderWith`, `renderAff`, `prelude` |

## What works today

The full pipeline for **core syntax** renders end-to-end:

```purescript
import BareBars (renderWith, Value(..))

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
(`renderAff`); multi-branch control flow via **`{{else}}` separators**
(`{{#if c}}…{{else}}…{{/if}}` — a name-agnostic `Sep` marker the engine splits
at); prelude helpers `this`, `lookup`, `true`/`false`/`null`, `esc_html`,
`safe`, `raw`, `if`, `unless`, `each`, `with`, `else`, `dict`, `apply`,
`eq`/`eq?`, `not`, `and`, `or`, `log`;
and a JSON-schema-style `validate` over the skeleton.

## Next milestones

- `BareBars.Surface` — the `{{ }}` / dotted-path / `@data` / hash-arg / partial
  desugarer (§5). Until then, author in core syntax.
- Partials & decorators in the prelude (§6.6).

## Test

```sh
spago test -p barebars      # or, from the repo root: npm test
```
