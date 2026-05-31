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
**falsy** is exactly:

- `false`
- `null`
- `""` (the empty string)
- `[]` (the empty array)
- a trusted empty string (`safe ""` / `esc_html ""` ⇒ `VSafe ""`)

**Everything else is truthy** — including `0`, the empty object `{}`, and any
non-empty string/array/number.

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
| `0` | **truthy** | **falsy** | ✗ |
| `42` | truthy | truthy | ✓ |
| `[]` | falsy | falsy | ✓ |
| `[1, 2]` | truthy | truthy | ✓ |
| `{}` | truthy | truthy | ✓ |
| `{"k": 1}` | truthy | truthy | ✓ |
| `safe ""` | **falsy** | **truthy** | ✗ |
| `safe "x"` | truthy | truthy | ✓ |

Note that the empty **array** is falsy in both (Handlebars special-cases empty
collections), while the empty **object** is truthy in both.

## The two divergences

1. **`0` is truthy in FlatBars.** Handlebars treats `0` as falsy unless its
   `includeZero` option is set. Guard zero explicitly where it matters:
   `{{#if (not (eq n 0))}}…{{/if}}`. (This also covers `-0`.)
2. **A trusted empty string (`safe ""`) is falsy in FlatBars,** because it is
   still an empty string. In Handlebars a `SafeString` is a wrapper *object*, so
   even an empty one is truthy. Most templates never test a safe string for
   truthiness, but the edge is real.

See also the [compatibility matrix](../../docs/modules/ROOT/pages/flatbars-compat.adoc)
§5, which lists these alongside the other Handlebars semantic differences.
