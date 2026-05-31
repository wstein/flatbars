# `barebars-cli` — command-line renderer

Renders a BareBars **core-syntax** template against JSON data using the
reference prelude.

```sh
# from the repo root
npm run cli -- packages/cli/examples/greeting.bars --data packages/cli/examples/greeting.json

# or directly
spago run -p barebars-cli -- <template> [--data <data.json>] [--validate | --compile]
```

## Options

| Flag | Meaning |
| --- | --- |
| `-d`, `--data <file>` | JSON data file (default: `null` context) |
| `--validate` | Run the skeleton-AST validation pass against the prelude schema and report issues; do not render. Exits non-zero if any issue is found. |
| `-c`, `--compile` | Compile the template to a JS module (`BareBars.Compile`), printed to stdout; do not render. The default export is `function (data, rt)` — pair it with [`barebars-runtime.mjs`](../compile/runtime/barebars-runtime.mjs). |
| `-h`, `--help` | Show usage |

## Example

`examples/greeting.bars` rendered against `examples/greeting.json`:

```html
<h1>BareBars &lt;demo&gt;</h1>
<ul>
  <li>0. alpha</li>
  <li>1. beta</li>
</ul>
<p>All done.</p>
```

Templates use core syntax — `{{{ lookup this "x" }}}`, `{{#each …}}`, and
`{{else}}` for control flow: `{{#if …}}…{{else}}…{{/if}}`. `{{else}}` is a
name-agnostic *separator* — the parser keeps it as a structural marker and the
prelude `if`/`each`/`with` split their body at it. The full surface dialect
(`{{ x }}` auto-escape, dotted paths) is a future extension of the desugaring
walk; see [`FullBars.Lower`](../fullbars/src/FullBars/Lower.purs).
