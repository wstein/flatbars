#!/usr/bin/env node
// Generate (or --check) the helper-catalog partials from the engine's single
// source of truth, FullBars.preludeSchema.
//
// The PureScript module FullBars.Catalog renders each fragment to a String
// (types are first-class there); this script only does file I/O and comparison,
// so the Map/Arity values never have to be marshalled across the FFI boundary.
// Two twins are emitted from the same source: the AsciiDoc partial the Antora
// prelude page includes, and the MDX partial the Starlight spec site imports
// (ADR-031).
//
//   node scripts/generate-helper-catalog.mjs           # write the partials
//   node scripts/generate-helper-catalog.mjs --check    # fail if out of date
//
// Requires `spago build` to have produced output/FullBars.Catalog first.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const compiled = resolve(root, "output/FullBars.Catalog/index.js");

if (!existsSync(compiled)) {
  console.error(
    "error: " + compiled + " not found — run `spago build` (or `npm run build`) first.",
  );
  process.exit(2);
}

const mod = await import(compiled);

// One source, two rendered partials. `export` is the FullBars.Catalog binding;
// `path` is the file it owns.
const partials = [
  { export: "helperCatalogAdoc", path: "docs/modules/ROOT/partials/helper-catalog.adoc" },
  { export: "helperCatalogMarkdown", path: "spec/src/partials/helper-catalog.mdx" },
];

const check = process.argv.includes("--check");
let stale = 0;

for (const p of partials) {
  const generated = mod[p.export];
  const target = resolve(root, p.path);
  if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === generated) continue;
    stale++;
    console.error("error: " + p.path + " is out of date with FullBars.preludeSchema.");
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, generated);
    console.log("wrote " + p.path);
  }
}

if (check) {
  if (stale > 0) {
    console.error("Run `npm run gen:catalog` and commit the result.");
    process.exit(1);
  }
  console.log("helper catalog is up to date.");
}
