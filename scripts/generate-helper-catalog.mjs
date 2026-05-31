#!/usr/bin/env node
// Generate (or --check) the helper-catalog AsciiDoc partial from the engine's
// single source of truth, FlatBars.preludeSchema.
//
// The PureScript module FlatBars.Catalog renders the whole fragment to a String
// (types are first-class there); this script only does file I/O and comparison,
// so the Map/Arity values never have to be marshalled across the FFI boundary.
//
//   node scripts/generate-helper-catalog.mjs           # write the partial
//   node scripts/generate-helper-catalog.mjs --check    # fail if out of date
//
// Requires `spago build` to have produced output/FlatBars.Catalog first.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const target = resolve(
  root,
  "docs/modules/ROOT/partials/helper-catalog.adoc",
);
const compiled = resolve(root, "output/FlatBars.Catalog/index.js");

if (!existsSync(compiled)) {
  console.error(
    "error: " + compiled + " not found — run `spago build` (or `npm run build`) first.",
  );
  process.exit(2);
}

const { helperCatalogAdoc } = await import(compiled);
const generated = helperCatalogAdoc;

const check = process.argv.includes("--check");

if (check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === generated) {
    console.log("helper catalog is up to date.");
    process.exit(0);
  }
  console.error(
    "error: " +
      target +
      " is out of date with FlatBars.preludeSchema.\n" +
      "Run `npm run gen:catalog` and commit the result.",
  );
  process.exit(1);
}

writeFileSync(target, generated);
console.log("wrote " + target);
