#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate / check editors/operations.json — the prelude operation table the
// editor layer's hover + completion (ADR-017) read. Mirrors gen:catalog: the
// single source is FullBars.preludeSchema, projected by FullBars.Catalog
// (`operations`), so the editor can never list an operation the engine doesn't
// know. Like the helper catalog, it imports from output/ (the spago build
// product), so run a build first.
//
//   node scripts/gen-operations.mjs            # regenerate editors/operations.json
//   node scripts/gen-operations.mjs --check    # CI: fail if it drifted from the schema
//
// Each entry carries only what the engine actually knows: name, the ADR-019 kind
// (value/inline/block, derived structurally), arity, source (registered / scoped /
// alias / synonym), the alias/synonym target (`null` otherwise), and the one-line
// `doc` from OperationDef (the single source; empty for scoped variables, which
// carry none).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { operations } from "../output/FullBars.Catalog/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "..", "editors", "operations.json");

const data = {
  _generated: "by scripts/gen-operations.mjs from FullBars.preludeSchema — DO NOT EDIT; run `npm run gen:operations`",
  operations: operations
    .map((o) => ({ name: o.name, kind: o.kind, arity: o.arity, source: o.source, canonical: o.canonical || null, doc: o.doc || "" }))
    .sort((a, b) => a.name.localeCompare(b.name)),
};
const text = JSON.stringify(data, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {
    /* missing → stale */
  }
  if (current !== text) {
    console.error(
      "✗ editors/operations.json is stale vs FullBars.preludeSchema.\n" +
        "  The prelude changed. Run `npm run gen:operations` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`✓ editors/operations.json current — ${data.operations.length} operations`);
} else {
  writeFileSync(outFile, text);
  console.log(`wrote ${outFile}\n  ${data.operations.length} operations projected from FullBars.preludeSchema`);
}
