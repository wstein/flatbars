# FlatBars tutorials (FlatBars Lab)

A runnable, lab-themed documentation site. The landing leads with the **thesis** —
FlatBars is a meaning-free parser, and the four surfaces — **RawBars · MinBars ·
FullBars · MaxBars** — are languages built on it. **MinBars is the recommended
start**: a comprehensive `/minbars` reference walks every tag in the logic-less
Mustache language, each illustrated by a live example that renders through the
real MinBars engine and opens in the FlatBars Lab (`lab/`) with one click.

## Run

```sh
cd tutorials
npm install            # Astro + @astrojs/preact + preact
npm run dev            # http://localhost:4321  ← the tutorials
npm run build          # static site → dist/
```

Pages: `/` (landing — thesis first, MinBars the recommended start) · `/minbars`
(the comprehensive MinBars / Mustache reference) · `/rawbars` (the meaning-free core reference) ·
`/fullbars` (the comprehensive FullBars / Handlebars reference) · `/maxbars`
(the comprehensive MaxBars reference — infix operators, pipes, bare loop vars).
All four surfaces now have a dedicated reference, so there is no generic
per-surface lesson page any more.

**`npm run dev` serves the Lab too.** The dev server mounts the repo's `lab/` at
`/lab/` (same handler as `npm run lab`), so the tutorials and the Lab share one
origin and the **Open in Lab** buttons (`/lab/index.html#…`) work out of the box —
no second server. (`PUBLIC_LAB_URL` overrides the target only if you want to point
the buttons at a Lab hosted elsewhere.)

In production, serve `lab/` and this site under one origin so the default
`/lab/index.html` deep-links resolve; set `PUBLIC_SPEC_BASE` to where the Antora
spec is published (default `/flatbars/`).

## Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds this site and the Lab and publishes
them to the repo's GitHub **project page**,
`https://wstein.github.io/flatbars/`, on push to `develop` (or via
*workflow_dispatch*). **One-time setup:** repo *Settings → Pages → Build and
deployment → Source = **GitHub Actions***.

Because a project page serves under a `/<repo>/` sub-path, the build is
parameterised by three env vars (set in the workflow; unset locally ⇒ root, so
`npm run dev` and the gates are unaffected):

| var | value | effect |
|---|---|---|
| `PUBLIC_BASE_PATH` | `/flatbars` | Astro `base`; `astro.config` then normalises the hand-written root-absolute links (`/minbars`, prose cross-links) to that base in the built HTML |
| `PUBLIC_LAB_URL` | `/flatbars/lab/index.html` | bakes the based Lab URL into the runnable-example island (client JS the build-time rewrite can't reach) |
| `PUBLIC_SITE` | `https://wstein.github.io` | Astro `site` |
| `PUBLIC_SPEC_BASE` | `/flatbars/spec/flatbars/` | where the footer "normative reference" links point — the Antora spec's ADR pages |

The Lab is plain static files with **relative** asset paths, so the workflow just
copies `lab/` into `dist/lab/` (served at `/flatbars/lab/`); its "Docs" backlink
(`../<engine>`) resolves to `/flatbars/<engine>`. The **Antora spec** is built in
the same workflow (`npm run docs`) and copied to `dist/spec/`, so it ships on the
same origin and the footer links resolve (the spec lives under Antora's component
path, hence `…/spec/flatbars/`). To deploy at a **root** origin instead (custom
domain or a user/org page), drop `PUBLIC_BASE_PATH` (and add a `CNAME`); the links
then stay root-absolute as authored.

## How it works

- **One source per example, gate-validated:** the Mustache reference's runnable
  examples live in `src/mustache.mjs`, the RawBars reference's in `src/rawbars.mjs`,
  the FullBars reference's in `src/fullbars.mjs`, the MaxBars reference's in
  `src/maxbars.mjs`, and the landing-page surface cards in `src/examples.mjs`.
  `scripts/check-tutorial-links.mjs` (in `npm test`) renders
  every one through the real engine bundle (custom-helper examples via the
  facade's `renderWith`, ADR-018), builds its Open-in-Lab link, asserts any
  `compiles`-flagged example emits JS, and fails if an example is broken or is
  defined but never shown on its page (orphan guard). A preview can never drift
  from what's tested.
- **Compiled-JS pane (opt-in):** an example can pass `compile` to show its
  template compiled to a JS module. It's guarded on the engine exposing
  `compileToJs` — the FlatBars dialects (RawBars/FullBars/MaxBars) do, MinBars
  doesn't — so the pane never appears where it can't run. The RawBars reference
  uses it on one flagship.
- **Prose illustrates; the spec is the contract.** Page copy annotates verified,
  runnable examples and links to the Antora spec — it never forks the normative
  text.
- **Shared chrome:** `src/layouts/Reference.astro` gives every reference and
  surface page a sticky left navigation (scroll-spy on the reference, active-page
  on the surfaces) plus a topbar with three controls — **Theme** (light/dark),
  **Chips** (the tag-chip style: tint/outline/solid), and a **Legend** popover.
  Theme is an explicit `[data-theme]` on `<html>` set before first paint by the
  anti-flash script in `BaseHead.astro` (seeded from the OS preference on a first
  visit); Chips is `[data-chipstyle]` on `<body>`. Both persist to `localStorage`
  (`flatbars-docs-opts`). The Lab's look comes from the token-only stylesheets
  `src/styles/lab-tokens.css` (violet palette + IBM Plex) and
  `src/styles/open-in-lab.css`, with `src/styles/docs-chrome.css` for the topbar
  controls and the legend — tokens are copied, not the Lab's component CSS, so the
  two can't drift. A single `src/components/BaseHead.astro` owns the `<head>`
  (meta, the one canonical font link, the token sheet, the anti-flash script) for
  **both** the landing and `Reference.astro`, so the two heads can't drift on
  fonts again; `check:tutorial-links` fails if either page hand-rolls its own font
  link.
- **One honest syntax palette:** `lab-tokens.css` defines a single seven-family
  `--c-*` palette (escaped · raw · section · partial · inheritance ·
  set-delimiter · comment) that drives the runnable-example highlighter
  (`src/lib/highlight.mjs`, ADR-014, engine-derived), the inline prose tags
  (highlighted client-side in the page's own dialect), AND the colour legend
  (`src/components/LegendPopover.astro`, server-rendered from the same data) — so
  the legend can never lie about the examples. Each tag's `{{ }}` delimiters are
  dimmed; the Chips control restyles every chip (editor, inline, legend) together.
  Palette values are tuned to clear **WCAG AA** on their own tint.
- **Open in Lab** uses the shared `lab/open-in-lab.mjs` (`labHref`), which encodes
  the workspace with the Lab's own share-state codec into the URL — self-
  contained, no vendoring, no fetch.
- **Live previews dogfood the real engine:** the `OpenInLab` island shows the
  example's template, data, and any partials, then renders the output (as plain
  text, in a dark pane) through the same engine the Lab ships — so a lesson runs
  the engine it teaches. Its **Open in Lab** button targets one named tab, so
  repeated clicks reuse a single Lab window. CI's `check:bundle` keeps that
  bundle from going stale.
- **Accessible runnable examples.** The cards open straight into content; Reset +
  Open-in-Lab float top-right and reveal on hover/focus-within, with an
  always-visible fallback on touch (no-hover) devices so the per-example "Open in
  Lab" is never undiscoverable. Each editor `<textarea>` carries an `aria-label`
  (its visible caption lives in an `aria-hidden` highlight layer). `npm run
  check:a11y` (in `npm test`) pins these invariants at source; a headless axe-core
  smoke gate over a built page is a tracked follow-up.
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
   in `src/pages/minbars.astro` (the orphan guard enforces this).
3. `npm run check:tutorial-links` to confirm it renders and links.

## Spike cost (Astro vs plain static — the decision evidence)

Measured on this site (`/minbars` reference + landing + 3 surface lessons):

| metric | value |
|---|---|
| `npm install` | ~17 s, 365 packages, **151 MB** `node_modules` (gitignored) |
| `npm run build` | ~1 s → **312 KB** static `dist/` (5 HTML pages) |
| island JS (incl. engine + js-yaml) | 195 KB / **49 KB gzip**, one shared chunk, hydrated `client:visible` |
| authoring an example | one entry in `src/mustache.mjs` (template + data) |

Astro gives component authoring and ships static HTML (the build is dev-time
only; the deployed artifact is plain files, like the Lab). The cost is the
toolchain (`node_modules`, a Node build) — acceptable at this volume.
