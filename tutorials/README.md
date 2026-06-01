# FlatBars tutorials (FlatBars Lab)

A runnable, lab-themed documentation site. **Mustache is the front door**: a
comprehensive `/mustache` reference walks every tag in the logic-less language,
each illustrated by a live example that renders through the real MinBars engine
and opens in the FlatBars Lab (`lab/`) with one click. The four FlatBars
surfaces — **RawBars · MinBars · FullBars · MaxBars** — follow as the ladder
beyond it.

## Run

```sh
cd tutorials
npm install            # Astro + @astrojs/preact + preact
npm run dev            # http://localhost:4321  ← the tutorials
npm run build          # static site → dist/
```

Pages: `/` (landing, Mustache hero) · `/mustache` (the comprehensive MinBars /
Mustache reference) · `/rawbars` (the meaning-free core reference) ·
`/fullbars`, `/maxbars` (one lesson per surface). MinBars and RawBars have no
per-surface lesson — their dedicated references supersede it.

**`npm run dev` serves the Lab too.** The dev server mounts the repo's `lab/` at
`/lab/` (same handler as `npm run lab`), so the tutorials and the Lab share one
origin and the **Open in Lab** buttons (`/lab/index.html#…`) work out of the box —
no second server. (`PUBLIC_LAB_URL` overrides the target only if you want to point
the buttons at a Lab hosted elsewhere.)

In production, serve `lab/` and this site under one origin so the default
`/lab/index.html` deep-links resolve; set `PUBLIC_SPEC_BASE` to where the Antora
spec is published (default `/flatbars/`).

## How it works

- **One source per example, gate-validated:** the Mustache reference's runnable
  examples live in `src/mustache.mjs`, the RawBars reference's in `src/rawbars.mjs`,
  the per-surface lessons in `src/examples.mjs`. `scripts/check-tutorial-links.mjs`
  (in `npm test`) renders every one through the real engine bundle, builds its
  Open-in-Lab link, asserts any `compiles`-flagged example emits JS, and fails if
  an example is broken or is defined but never shown on its page (orphan guard).
  A preview can never drift from what's tested.
- **Compiled-JS pane (opt-in):** an example can pass `compile` to show its
  template compiled to a JS module. It's guarded on the engine exposing
  `compileToJs` — the FlatBars dialects (RawBars/FullBars/MaxBars) do, MinBars
  doesn't — so the pane never appears where it can't run. The RawBars reference
  uses it on one flagship.
- **Prose illustrates; the spec is the contract.** Page copy annotates verified,
  runnable examples and links to the Antora spec — it never forks the normative
  text.
- **Shared chrome:** `src/layouts/Reference.astro` gives every page a sticky
  left navigation (scroll-spy on the reference, active-page on the surfaces) and
  the Lab's look via the token-only stylesheets `src/styles/lab-tokens.css`
  (violet palette + IBM Plex) and `src/styles/open-in-lab.css`. Tokens are
  copied, not the Lab's component CSS, so the two can't drift.
- **Open in Lab** uses the shared `lab/open-in-lab.mjs` (`labHref`), which encodes
  the workspace with the Lab's own share-state codec into the URL — self-
  contained, no vendoring, no fetch.
- **Live previews dogfood the real engine:** the `OpenInLab` island shows the
  example's template, data, and any partials, then renders the output (as plain
  text, in a dark pane) through the same engine the Lab ships — so a lesson runs
  the engine it teaches. Its **Open in Lab** button targets one named tab, so
  repeated clicks reuse a single Lab window. CI's `check:bundle` keeps that
  bundle from going stale.
- **Conformance badges are generated, not asserted.** `npm run gen:conformance`
  runs the vendored `mustache/spec` suite through the shipped MinBars bundle and
  writes `src/conformance.json`; the reference renders its support table from
  that data. `npm run check:conformance` (in `npm test`) fails if the committed
  file is stale, so the page can never claim more than the suite proves.
  Features the spec defines but MinBars doesn't implement (set delimiters,
  lambdas) appear as static `spec-only` callouts with no live button — a preview
  that can't run would mislead.

### Add or change a Mustache example

1. Add an entry to `src/mustache.mjs` (`{ template, data, partials? }`).
2. Reference it on the page: `<OpenInLab client:visible engine="minbars" … />`
   in `src/pages/mustache.astro` (the orphan guard enforces this).
3. `npm run check:tutorial-links` to confirm it renders and links.

## Spike cost (Astro vs plain static — the decision evidence)

Measured on this site (`/mustache` reference + landing + 3 surface lessons):

| metric | value |
|---|---|
| `npm install` | ~17 s, 365 packages, **151 MB** `node_modules` (gitignored) |
| `npm run build` | ~1 s → **312 KB** static `dist/` (5 HTML pages) |
| island JS (incl. engine + js-yaml) | 195 KB / **49 KB gzip**, one shared chunk, hydrated `client:visible` |
| authoring an example | one entry in `src/mustache.mjs` (template + data) |

Astro gives component authoring and ships static HTML (the build is dev-time
only; the deployed artifact is plain files, like the Lab). The cost is the
toolchain (`node_modules`, a Node build) — acceptable at this volume.
