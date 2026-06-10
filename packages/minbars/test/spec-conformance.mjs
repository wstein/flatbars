// SPDX-License-Identifier: Apache-2.0
//
// The MinBars mustache-conformance harness — a *measurement* tool. It runs the
// vendored mustache/spec JSON suite (test/spec/*.json) against the MinBars
// engine (via the ClassicBars.JS `renderMustache` facade) and reports honest
// per-module pass counts. Some cases are expected to fail until a later phase
// adds standalone-whitespace / indentation handling; this harness MEASURES that
// gap, so it always EXITS 0. Run:
//
//   npm run test:minbars-spec   # spago build && node packages/minbars/test/spec-conformance.mjs
//
// Sibling: scripts/gen-conformance.mjs runs the SAME fixtures but through the
// shipped lab bundle (lab/renderer.mjs) to generate the Mustache tutorial's
// conformance table. This harness measures the spago build product (output/);
// `npm run check:bundle` keeps the lab bundle in step with that source, so the
// two measurements agree.
//
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const enginePath = resolve(root, "output/ClassicBars.JS/index.js");
if (!existsSync(enginePath)) {
  console.error("error: " + enginePath + " not found — run `spago build` first (npm run test:minbars-spec does).");
  process.exit(2);
}
const { renderMustache } = await import(enginePath);

const specDir = resolve(here, "spec");
const moduleFiles = readdirSync(specDir)
  .filter((n) => n.endsWith(".json"))
  .sort();

// Truncate a rendered string for a compact one-line diff.
const trunc = (s, n = 60) => {
  const j = JSON.stringify(s);
  return j.length > n ? j.slice(0, n) + "…" : j;
};

let grandPass = 0, grandTotal = 0;
const moduleLines = [];

for (const file of moduleFiles) {
  const mod = file.replace(/\.json$/, "");
  const suite = JSON.parse(readFileSync(resolve(specDir, file), "utf8"));
  const tests = suite.tests || [];
  let pass = 0;
  const fails = [];
  for (const t of tests) {
    const r = renderMustache(t.partials || {}, t.template, t.data ?? null);
    if (r.ok && r.value === t.expected) {
      pass++;
    } else {
      fails.push({
        name: t.name,
        expected: t.expected,
        got: r.ok ? r.value : "ERROR " + r.error,
        ok: r.ok,
      });
    }
  }
  grandPass += pass;
  grandTotal += tests.length;
  moduleLines.push(`  ${mod}: ${pass}/${tests.length}`);
  if (fails.length) {
    for (const f of fails) {
      moduleLines.push(
        `      FAIL ${f.name}` +
          (f.ok
            ? `  expected ${trunc(f.expected)} got ${trunc(f.got)}`
            : `  ${f.got}`),
      );
    }
  }
}

console.log("MinBars mustache/spec conformance\n");
for (const line of moduleLines) console.log(line);

const pending = grandTotal - grandPass;
console.log(
  `\nMinBars conformance: ${grandPass}/${grandTotal}` +
    (pending ? ` (${pending} pending — whitespace/indentation/semantics)` : " (all green)"),
);

// Measurement only: never fail the build. The next phase closes the gap.
process.exit(0);
