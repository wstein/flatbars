# Truthiness — FlatBars edges & Handlebars parity

A self-contained example that renders an HTML document exercising **every**
value kind FlatBars can decide truthiness for, with the engine's verdict
computed live (`{{#if v}}…{{else}}…{{/if}}`) next to what Handlebars.js would
decide for the same value.

## Files
- [`truthiness.bars`](truthiness.bars) — the template (itself a full HTML document).
- [`data.json`](data.json) — one value of each kind.
- [`expected.html`](expected.html) — the rendered output (regenerate with the command below).

## Run it

```sh
# from the repo root
npx spago run -p barebars-cli -- examples/truthiness/truthiness.bars \
  --data examples/truthiness/data.json > examples/truthiness/expected.html
```

Open `expected.html` in a browser. You can also paste `truthiness.bars` and
`data.json` into the [web playground](../../packages/playground/) to explore it
interactively.

## The rule

FlatBars truthiness ([`FlatBars.Value.truthy`](../../packages/flatbars/src/FlatBars/Value.purs)) —
**falsy** is exactly (the same set as Handlebars):

- `false`
- `null`
- `0`
- `""` (the empty string)
- `[]` (the empty array)
- a trusted empty string (`safe ""` / `esc_html ""` ⇒ `VSafe ""`)

**Everything else is truthy** — including the empty object `{}`, non-zero
numbers, and any non-empty string/array.

## `includeZero`

Like Handlebars, `0` is falsy by default. To count `0` as truthy, pass
Handlebars' `includeZero` option. BareBars has no hash-argument surface yet, so
it is supplied as an *options object* built with `dict`:

```handlebars
{{#if n (dict "includeZero" true)}} n is present (even if 0) {{/if}}
```

## Parity matrix

| Value | FlatBars | Handlebars.js | Parity |
| --- | --- | --- | --- |
| `false` | falsy | falsy | ✓ |
| `true` | truthy | truthy | ✓ |
| `null` | falsy | falsy | ✓ |
| `""` | falsy | falsy | ✓ |
| `"hi"` | truthy | truthy | ✓ |
| `"0"` | truthy | truthy | ✓ |
| `" "` | truthy | truthy | ✓ |
| `0` | falsy | falsy | ✓ |
| `0` + `includeZero` | truthy | truthy | ✓ |
| `42` | truthy | truthy | ✓ |
| `[]` | falsy | falsy | ✓ |
| `[1, 2]` | truthy | truthy | ✓ |
| `{}` | truthy | truthy | ✓ |
| `{"k": 1}` | truthy | truthy | ✓ |
| `safe ""` | **falsy** | **truthy** | ✗ |
| `safe "x"` | truthy | truthy | ✓ |

Note that the empty **array** is falsy in both (Handlebars special-cases empty
collections), while the empty **object** is truthy in both.

## The one remaining divergence

**A trusted empty string (`safe ""`) is falsy in FlatBars,** because it is still
an empty string. In Handlebars a `SafeString` is a wrapper *object*, so even an
empty one is truthy. Most templates never test a safe string for truthiness, but
the edge is real.

See also the [compatibility matrix](../../docs/modules/ROOT/pages/flatbars-compat.adoc)
§5, which lists these alongside the other Handlebars semantic differences.
