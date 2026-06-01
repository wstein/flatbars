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
| `-s`, `--surface` | Read the template in the surface dialect (`{{ name }}`, paths, `@data`, `as \|x\|`) instead of core syntax. Applies to both render and `--compile`. |
| `-m`, `--mustache` | Render with the Mustache (MinBars) engine. Render-only — cannot combine with `--surface`/`--compile`/`--validate`. |
| `--validate` | Run the skeleton-AST validation pass against the prelude schema and report issues; do not render. Exits non-zero if any issue is found. |
| `-c`, `--compile` | Compile the template to a JS module (`BareBars.Compile`), printed to stdout; do not render. The default export is `function (data, rt)` — pair it with [`barebars-runtime.mjs`](../compile/runtime/barebars-runtime.mjs). |
| `-h`, `--help` | Show usage |

## `barebars examples` — the vendored conformance corpus

```sh
spago run -p barebars-cli -- examples verify [--provider mustache]
```

`verify` is the headless MinBars conformance gate (see
[`example-loader-spec.md`](../../example-loader-spec.md) §6.5): it reads each
vendored fixture under `examples/vendored/<provider>/`, renders
template + data + partials through MinBars, and asserts `actual == expected` — a
divergence is a conformance failure. It reports `passed/total` and exits non-zero
on any miss. The corpus is vendored offline (`node scripts/vendor-mustache.mjs`);
`verify` never fetches. `npm run examples:verify` runs it as part of `npm test`.

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
prelude `if`/`each`/`with` split their body at it. The surface dialect (`{{ x }}`
auto-escape, dotted paths, `@data`, `as |x|`) is available via `--surface`; it is
the desugaring walk in [`FullBars.Surface`](../fullbars/src/FullBars/Surface.purs)
over the structural AST that [`Kernel.Lower`](../kernel/src/Kernel/Lower.purs)
also materializes for tooling.
