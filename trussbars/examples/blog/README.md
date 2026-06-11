# blog-example — a Trussbars dogfood

A small but realistic blog (index, single post, year archive) rendered entirely by
Trussbars-compiled templates. Its job is **ergonomics**: build something real with
the engine + runtime, and record every place the API forced an awkward choice
or simply couldn't do the thing. Those findings feed the feature freeze
(`trussbars/docs/06-feature-freeze.md`).

The templates are compiled at build time by the **native v2 `truss!` proc-macro**
(`trussbars-macros`) — each loaded straight from its `.truss` file (`path = …`), no
PureScript transpiler and no committed generated module.

```sh
cargo +1.96.0 run                     # render the three pages to stdout
cargo +1.96.0 test                    # golden gate (tests/golden/*.html)
BLESS=1 cargo +1.96.0 test            # regenerate the goldens after an intended change
```

A template edit is picked up on the next `cargo build` (the macro `include_bytes!`s
each `.truss`, so cargo tracks it). A typo in a `.truss` is a `rustc` error located
at the template's `line:col`.

## Layout

- `templates/*.truss` — the source templates (MaxBars surface, `.truss` extension).
- `src/templates.rs` — three one-line `truss!(render_*, Ctx, path = "…")` calls; the
  proc-macro compiles each `.truss` into a typed `pub fn render_*` at build time.
- `src/context.rs` — the typed host context (`IndexCtx`/`PostCtx`/`ArchiveCtx`).
- `src/lib.rs` — sample data. `src/main.rs` — render to stdout.

## What worked (no friction)

Nested `{% for %}` with loop bindings, field paths, `{% if %}` on a `Vec`
(non-empty) and on a **comparison** (`views > 100`), `{{ raw | safe }}` for pre-rendered
markup, pipes (`tag | lowercase`, `tags | count`), interpolation inside attributes
(`href="/posts/{{slug}}"`), an inline partial reused via `{% include "card" %}` inside
`{% for %}`, and `{% for (groupBy posts "year") %}` with `{{loop.key}}` for the
archive. HTML escaping is automatic (`Truss &amp; Bars`, `&lt;engine&gt;`); the raw
body passes through. All three pages are byte-pinned in `tests/golden/`.

Rebaselined onto **develop's** MaxBars and re-dogfooded with its newer features:
Liquid loop binding (`{% for post in this %}`; the `as |x|` block-param form is gone),
**`{% local %}`** (the archive's per-year post count, computed once), and a **list
literal** (`{% for ["All", "Rust", "Design"] %}` — the index nav).

## Ergonomics findings (the point of this example)

| # | Finding | Impact | Disposition |
|---|---|---|---|
| F1 | **Field names are static.** `{{post.body_html}}` resolves to the Rust field `post.body_html` verbatim — no `serde`-style rename layer for *paths*. Templates must use the same identifier as the struct. | Low — just use snake_case both sides. Worth one line in the docs. | Document. Not a defect — it's "names are static." |
| F2 | **Numbers are `f64`.** `{% if views > 100 %}` emits `views > 100.0`, so a field compared to a numeric literal must be `f64` (`i64 > f64` won't compile). Print-only / `groupBy`-key numbers can stay `i64`. | Medium — surprising; `views: f64` reads oddly. | Document; consider an integer-literal coercion rule in v2. |
| F3 | **No host-helper registration.** `{{date …}}`, `{{… \| markdown}}`, `{{… \| pluralize …}}` were all `unsupported: helper '…'`. | **High** — forced us to precompute `date` strings and `body_html` in Rust. | **CLOSED (v2) & dogfooded** — `post.truss` now calls two host helpers via `helpers = [date, markdown]`: `{{date post.date "%B %e, %Y" "en"}}` (a `String` formatter from `trussbars-i18n`) and `{{post.body \| markdown}}` (a crate-local `Safe`-returning renderer, so it emits unescaped without a `\| safe` pipe). The context carries a raw ISO date and Markdown source instead of precomputed strings. |
| F4 | **`{% local %}` — now supported & USED.** The archive computes a per-year post count once via `{% local n=(this \| count) %}<h2>{{loop.key}} ({{n}} posts)</h2>…{% endlocal %}` (block-scoped, never re-roots). Originally reported "doesn't parse" against the *pre-rebaseline* surface; develop shipped it and the emitter now emits it. | — | **CLOSED** — emitter emits block-scoped Rust `let`s. |
| F5 | **List literals `[…]` — supported & USED** (the index nav is `{% for ["All", "Rust", "Design"] %}`, → a Rust array). **Dict `{k: v}` literals — DONE (v2)** — field access compiles to a block-local generic struct (`{% scope {a: 1} %}{{a}}{% endscope %}`), inferred at instantiation. | Low | **list & dict CLOSED.** |
| F6 | **The generated module was committed.** Originally `generate.mjs` had to be run by hand and `src/templates.rs` checked in, so a `.truss` typo was a Node error, not a `rustc` error at the call site. | **High (DX)** — this *was* the v2 motivation: compile-time codegen with errors mapped to template spans. | **CLOSED** — `src/templates.rs` is now three `truss!(…, path = "…")` calls; the v2 proc-macro compiles each `.truss` at build time, `include_bytes!`-tracks it, and locates errors at `line:col`. |
| F9 | **Generated code tripped clippy pedantry.** The committed module needed `#![allow(needless_borrow, single_char_add_str)]` because the emitter wraps args uniformly in `&(…)` and pushes single-char literals. | Low | **CLOSED** — the emitter output now lives inside the `truss!` expansion (clippy does not lint external-macro-generated code) and is no longer committed, so no module-level `allow` is needed. |

### Severity summary

- **F3 (host helpers)** is now the one open gap that actually hurts — **F6** (the
  compile-time-codegen + error-mapping motivation) is closed by the v2 proc-macro.
- **F2** is a small but real surprise worth a coercion rule.
- **F4** (`{% local %}`) and **F5-lists** are now CLOSED and exercised here; **F5-dict**
  and **F9** (generated-code clippy) are clean v2 items.
- **F1** is minor / wontfix.

No correctness gaps were found — everything the emitter accepted rendered
byte-correctly (golden-pinned). The gaps are about *reach* and *DX*, not soundness.
