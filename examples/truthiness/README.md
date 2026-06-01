# Truthiness — FullBars edges & Handlebars parity

A self-contained example that renders an HTML document exercising **every**
value kind FullBars can decide truthiness for, with the engine's verdict
computed live (`{{#if v}}…{{else}}…{{/if}}`) next to what Handlebars.js would
decide for the same value.

## Files
- [`template.hbs`](template.hbs) — the template (itself a full HTML document).
- [`meta.json`](meta.json) — the label and ordering used by the generated playground manifest.
- [`data.json`](data.json) — one value of each kind.
- [`expected.html`](expected.html) — the rendered output (regenerate with the command below).

## Run it

```sh
# from the repo root
npx spago run -p flatbars-cli -- examples/truthiness/template.hbs \
  --data examples/truthiness/data.json > examples/truthiness/expected.html
```

Open `expected.html` in a browser. You can also paste `template.hbs` and
`data.json` into the [web playground](../../packages/playground/) to explore it
interactively.

## The rule

FullBars truthiness ([`FullBars.Value.truthy`](../../packages/fullbars/src/FullBars/Value.purs)) —
**falsy** is exactly (the same set as Handlebars):

- `false`
- `null`
- `0`
- `""` (the empty string)
- `[]` (the empty array)
- a trusted empty string (`safe ""` / `escapeHtml ""` ⇒ `VSafe ""`)

**Everything else is truthy** — including the empty object `{}`, non-zero
numbers, and any non-empty string/array.

## `includeZero`

Like Handlebars, `0` is falsy by default. To count `0` as truthy, pass
Handlebars' `includeZero` option. FlatBars has no hash-argument surface yet, so
it is supplied as an *options object* built with `dict`:

```handlebars
{{#if n (dict "includeZero" true)}} n is present (even if 0) {{/if}}
```

## Parity matrix

| Value | FullBars | Handlebars.js | Parity |
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

## Safe strings — a deliberate divergence

FullBars keeps one invariant Handlebars does not: **marking a string safe never
changes its truthiness — a safe string tests as its content**
(`truthy (VSafe s) == truthy (VString s)`). So `safe ""` is **falsy**. Handlebars
instead wraps safe output in a `SafeString` *object*, which is always truthy —
empty or not. FullBars' content-based rule is the more useful one (an empty
escaped section reads as empty), so it is kept on purpose.

The sharp edge to know: `safe` and `escapeHtml` **stringify** their argument, so
`(safe 0)` is truthy (it is the non-empty string `"0"`) while `0` is falsy.
Testing the truthiness of an escaped/safe value is therefore a category error —
they are *output*, not data. The engine's `escapingWarnings` lint flags it:

```handlebars
{{#if (safe x)}}…{{/if}}   ⚠ testing an escaped/safe value — test the data
{{#if x}}…{{/if}}          ✓ test the underlying data
```

See also the [compatibility matrix](../../docs/modules/ROOT/pages/fullbars-compat.adoc)
§5, which lists this alongside the other Handlebars semantic differences.
