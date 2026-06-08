# blog-example — a Trussbars dogfood

A small but realistic blog (index, single post, year archive) rendered entirely by
Trussbars-compiled templates. Its job is **ergonomics**: build something real with
the v1 emitter + runtime, and record every place the API forced an awkward choice
or simply couldn't do the thing. Those findings feed the v1 feature freeze
(`trussbars/docs/06-feature-freeze.md`) that v2 is designed against.

```sh
cargo +1.96.0 run                     # render the three pages to stdout
cargo +1.96.0 test                    # golden gate (tests/golden/*.html)
BLESS=1 cargo +1.96.0 test            # regenerate the goldens after an intended change
node generate.mjs                     # regenerate src/templates.rs from templates/*.truss
```

## Layout

- `templates/*.truss` — the source templates (MaxBars surface, `.truss` extension).
- `generate.mjs` — runs the v1 emitter (`compileMaxRust`) over each template and
  writes `src/templates.rs`. (The committed generated module is the v1 stand-in for
  what the v2 proc-macro will do at compile time — see the last gap below.)
- `src/context.rs` — the typed host context (`IndexCtx`/`PostCtx`/`ArchiveCtx`).
- `src/lib.rs` — sample data. `src/main.rs` — render to stdout.

## What worked (no friction)

Nested `{{#each}}` with block params, field paths, `{{#if}}` on a `Vec`
(non-empty) and on a **comparison** (`views > 100`), `{{{ raw }}}` for pre-rendered
markup, pipes (`tag | lowercase`, `tags | count`), interpolation inside attributes
(`href="/posts/{{slug}}"`), an inline partial reused via `{{> card}}` inside
`{{#each}}`, and `{{#each (groupBy posts "year")}}` with `{{loop.key}}` for the
archive. HTML escaping is automatic (`Truss &amp; Bars`, `&lt;engine&gt;`); the raw
body passes through. All three pages are byte-pinned in `tests/golden/`.

## Ergonomics findings (the point of this example)

| # | Finding | Impact | Disposition |
|---|---|---|---|
| F1 | **Field names are static.** `{{post.body_html}}` resolves to the Rust field `post.body_html` verbatim — no `serde`-style rename layer for *paths*. Templates must use the same identifier as the struct. | Low — just use snake_case both sides. Worth one line in the docs. | Document. Not a defect — it's "names are static." |
| F2 | **Numbers are `f64`.** `{{#if views > 100}}` emits `views > 100.0`, so a field compared to a numeric literal must be `f64` (`i64 > f64` won't compile). Print-only / `groupBy`-key numbers can stay `i64`. | Medium — surprising; `views: f64` reads oddly. | Document; consider an integer-literal coercion rule in v2. |
| F3 | **No host-helper registration.** `{{date …}}`, `{{… \| markdown}}`, `{{… \| pluralize …}}` are all `unsupported: helper '…'`. There is no way for a host to register a monomorphized helper for `.truss`. | **High** — forced us to precompute `date` strings and `body_html` in Rust, and there's no clean pluralization. | **Top v2 candidate**: a typed host-helper convention (a trait or attribute the proc-macro can resolve). |
| F4 | **`{{#let}}` doesn't parse** — `LexError` (ADR-024, deferred). No way to bind a computed value once and reuse it. | Medium — re-piping is the workaround. | Tracked (ADR-024); decide in/out at the freeze. |
| F5 | **No collection / `dict` literals** — `{{#each (dict …)}}` is `unsupported`. Can't build an ad-hoc map/list in-template. | Low for a blog; higher for dashboards. | Tracked; likely v2. |
| F6 | **The generated module is committed.** With no build.rs/proc-macro, `generate.mjs` must be run by hand and `src/templates.rs` checked in. A typo in a `.truss` is a Node error, not a `rustc` error at the call site. | **High (DX)** — this *is* the v2 motivation: compile-time codegen with errors mapped to template spans. | **v2 (the whole point).** |

### Severity summary

- **F3 (host helpers)** and **F6 (compile-time codegen + error mapping)** are the
  two that actually hurt and are the strongest pulls toward v2.
- **F2** is a small but real surprise worth a coercion rule.
- **F1, F4, F5** are minor / already-tracked.

No correctness gaps were found — everything the emitter accepted rendered
byte-correctly (golden-pinned). The gaps are about *reach* and *DX*, not soundness.
