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
| `BareBars.Env` | §3.3 | `Env`, `Helper`, `Blocks`, frame stack |
| `BareBars.Eval` | §3.4–3.5 | `render :: Template -> Env -> Either Error String` |
| `BareBars.Prelude` | §6 | the reference prelude (a working subset) + `preludeSchema` |
| `BareBars.Walk` | §4.3 | skeleton-AST visitor (`foldRefs`) + schema validation (`validate`) |
| `BareBars.Surface` | §5 | surface dialect — **scaffold/TODO** |
| `BareBars.Json` | — | JSON ⇆ `Value` bridge for hosts |
| `BareBars` | §7 | host API: `parse`, `render`, `validate`, `compile`, `renderWith`, `prelude` |

## What works today

The full pipeline for **core syntax** renders end-to-end:

```purescript
import BareBars (renderWith, Value(..))

renderWith "{{#each (lookup this \"xs\")}}<li>{{{this}}}</li>{{/each}}"
           (VObject (Map.fromFoldable [Tuple "xs" (VArray [VString "a", VString "b"])]))
-- Right "<li>a</li><li>b</li>"
```

Implemented: content, `{{{ output }}}`, `{{#block}}…{{sep …}}…{{/block}}` with
name-agnostic separators (`{{else}}`, `{{elif}}`, `{{otherwise}}`, … — the core
privileges no name), inverse-first `{{^block}}`, raw blocks
`{{{{#raw}}}}…{{{{/raw}}}}`, comments, backslash escaping, `~` whitespace
control; prelude helpers `this`, `lookup`, `true`/`false`/`null`, `esc_html`,
`safe`, `raw`, `if`, `unless`, `each`, `with`, `dict`, `apply`, `eq`/`eq?`,
`not`, `and`, `or`, `log`; and a JSON-schema-style validation pass
(`validate preludeSchema`) over the skeleton AST.

## Next milestones

- `BareBars.Surface` — the `{{ }}` / dotted-path / `@data` / hash-arg / partial
  desugarer (§5). Until then, author in core syntax.
- Partials & decorators in the prelude (§6.6).
- Source spans on evaluation errors (§4.3); `M = Aff` host for async helpers (§7.5).

## Test

```sh
spago test -p barebars      # or, from the repo root: npm test
```
