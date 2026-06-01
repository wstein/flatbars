# BareBars tutorials (FlatBars Lab)

One lesson per surface — **RawBars · MinBars · FullBars · MaxBars** — each showing a
live example and an **Open in Lab** button that opens the example in the FlatBars
Lab (`lab/`) on the right engine, no copy-pasting.

## Run

```sh
cd tutorials
npm install            # Astro + @astrojs/preact + preact
npm run dev            # http://localhost:4321  ← the tutorials
npm run build          # static site → dist/
```

`http://localhost:4321/` is the tutorials landing page; each surface is at
`/rawbars`, `/minbars`, `/fullbars`, `/maxbars`.

**Local dev with working "Open in Lab"** (two servers). The tutorials and the Lab
run on different ports locally, so point the buttons at the running Lab:

```sh
npm run lab                                                   # terminal 1 (repo root) → :8000
cd tutorials && PUBLIC_LAB_URL=http://localhost:8000/lab/index.html npm run dev   # terminal 2 → :4321
```

In production, serve the Lab (`lab/`) and this site under one origin so the default
`/lab/index.html` deep-links resolve; set `PUBLIC_SPEC_BASE` to where the Antora
spec is published (default `/barebars/`).

## How it works

- **One source per example:** `src/examples.mjs` holds the four lessons. The pages
  render them and the CI gate (`scripts/check-tutorial-links.mjs`) renders the same
  objects — a preview can never drift from what's tested.
- **Open in Lab** uses the shared `lab/open-in-lab.mjs` (`labHref`), which
  encodes the workspace with the Lab's own share-state codec into the URL — self-
  contained, no vendoring, no fetch.
- **Live previews dogfood the real engine:** the `OpenInLab` island imports the same
  `lab/vendor/barebars-engine.mjs` the Lab ships, so a lesson runs the
  engine it teaches. CI's `check:bundle` keeps that bundle from going stale.
- **The spec is the contract:** each lesson links to its Antora page and never forks
  the normative text.

## Spike cost (Astro vs plain static — the decision evidence)

Measured on this scaffold (4 lessons + landing):

| metric | value |
|---|---|
| `npm install` | ~17 s, 365 packages, **151 MB** `node_modules` (gitignored) |
| `npm run build` | ~2 s → **224 KB** static `dist/` (5 HTML pages) |
| island JS (incl. engine) | 160 KB / **38 KB gzip**, one shared chunk |
| authoring a lesson | one entry in `src/examples.mjs` (template + data) |

Astro gives Markdown/component authoring and ships static HTML (the build is
dev-time only; the deployed artifact is plain files, like the Lab). The cost is the
toolchain (`node_modules`, a Node build) — acceptable at lesson volume. Below ~8–10
pages, the plain-static path (hand-written HTML reusing the Lab's htm/preact idiom,
no build) is the cheaper alternative the team flagged.
