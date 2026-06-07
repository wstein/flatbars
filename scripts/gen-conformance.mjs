#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate the Mustache reference's conformance data from the vendored
// mustache/spec suite, so the page can never claim more conformance than the
// suite proves (design-debate follow-up). Mirrors the gen:catalog/check:catalog
// pattern: default writes the data file; `--check` fails if it is stale.
//
//   node scripts/gen-conformance.mjs            # regenerate
//   node scripts/gen-conformance.mjs --check    # CI: fail if out of date
//
// The engine is the SAME bundle the page's live islands run (lab/renderer.mjs),
// so a badge can't claim a pass the reader's own preview would contradict. The
// fixtures live in packages/minbars/test/spec/*.json (re-vendor via
// scripts/vendor-mustache.mjs). Output: tutorials/src/conformance.json.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRenderer } from "../lab/renderer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const specDir = resolve(root, "packages/minbars/test/spec");
const outFile = resolve(root, "tutorials/src/conformance.json");

// Display order + human labels for the modules we vendor. A module not listed
// here still appears (labelled by its id), so a newly-vendored module can't
// silently vanish from the table.
const META = [
  ["interpolation", "Interpolation"],
  ["sections", "Sections"],
  ["inverted", "Inverted sections"],
  ["comments", "Comments"],
  ["partials", "Partials"],
  ["inheritance", "Template inheritance"],
  ["dynamic-names", "Dynamic names"],
  ["delimiters", "Set delimiters"],
];
const labelFor = (id) => META.find(([k]) => k === id)?.[1] ?? id;
const orderOf = (id) => {
  const i = META.findIndex(([k]) => k === id);
  return i === -1 ? META.length : i;
};

const renderer = await createRenderer("minbars");

const modules = [];
let gp = 0, gt = 0;
for (const file of readdirSync(specDir).filter((n) => n.endsWith(".json")).sort()) {
  const id = file.replace(/\.json$/, "").replace(/^~/, ""); // ~ marks phase-deferred
  const suite = JSON.parse(readFileSync(resolve(specDir, file), "utf8"));
  const tests = suite.tests || [];
  let pass = 0;
  for (const t of tests) {
    try {
      const out = renderer.render(renderer.compile(t.template, t.partials || {}).program, t.data ?? null);
      if (out === t.expected) pass++;
    } catch {
      /* a thrown render counts as a miss */
    }
  }
  gp += pass;
  gt += tests.length;
  modules.push({ id, label: labelFor(id), pass, total: tests.length });
}
modules.sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.id.localeCompare(b.id));

const data = {
  _generated: "by scripts/gen-conformance.mjs — DO NOT EDIT; run `npm run gen:conformance`",
  source: "mustache/spec (vendored: packages/minbars/test/spec)",
  engine: "MinBars (lab/renderer.mjs — the same bundle the page's live examples run)",
  modules,
  total: { pass: gp, total: gt },
};
const text = JSON.stringify(data, null, 2) + "\n";

const check = process.argv.includes("--check");
if (check) {
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {
    /* missing → stale */
  }
  if (current !== text) {
    console.error(
      "✗ tutorials/src/conformance.json is stale vs the vendored mustache/spec suite.\n" +
        "  Run `npm run gen:conformance` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`✓ conformance.json current — MinBars ${gp}/${gt} on the vendored mustache/spec suite`);
} else {
  writeFileSync(outFile, text);
  console.log(`wrote ${outFile}\n  MinBars ${gp}/${gt} on the vendored mustache/spec suite`);
  for (const m of modules) console.log(`  ${m.label}: ${m.pass}/${m.total}`);
}
