# `barebars-cli` — command-line renderer

Renders a BareBars **core-syntax** template against JSON data using the
reference prelude.

```sh
# from the repo root
npm run cli -- packages/cli/examples/greeting.bars --data packages/cli/examples/greeting.json

# or directly
spago run -p barebars-cli -- <template> [--data <data.json>] [--validate]
```

## Options

| Flag | Meaning |
| --- | --- |
| `-d`, `--data <file>` | JSON data file (default: `null` context) |
| `--validate` | Run the skeleton-AST validation pass against the prelude schema and report issues; do not render. Exits non-zero if any issue is found. |
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
clause blocks for control flow: `{{#if …}}…{{#else}}…{{/else}}{{/if}}` (the core
has no `{{else}}` separator; `else` is a nested clause block the prelude `if`
interprets). The surface dialect (`{{ x }}`, dotted paths) is not yet wired up;
see [`BareBars.Surface`](../core/src/BareBars/Surface.purs).
