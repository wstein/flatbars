// SPDX-License-Identifier: Apache-2.0
//
// Tiling-conformance gate for the source map (ADR-035). Renders every example of
// each source-map dialect (core / FullBars / MaxBars) through the mapped render
// and asserts its `segments` tile the output exactly: ordered, contiguous from 0,
// each `len > 0`, covering [0, output.len) with no gaps or overlaps — the contract
// the playground's provenance UI relies on. The engine self-verifies per render
// (degrading to [] on a mismatch), so a non-empty map here is a *proven* map; this
// gate pins that the corpus produces them and none silently regress to empty.
// Run: node scripts/check-provenance.mjs

import { readFileSync } from "node:fs";
import { load as loadYaml } from "../lab/vendor/js-yaml.mjs";
import { createRenderer } from "../lab/renderer.mjs";

// The dialects that back source maps, each with its own example corpus. MinBars
// emits a source map too now (ADR-035) — over its own `.mustache` corpus, rendered
// on the spec rule (`createRenderer("minbars")` defaults to it).
const DIALECTS = ["rawbars", "fullbars", "maxbars", "minbars"];

// segments tile the output: contiguous from 0, every len > 0, covering it exactly.
function tiles(output, segments) {
  let at = 0;
  for (const s of segments) {
    if (s.out !== at || s.len <= 0) return false;
    at += s.len;
  }
  return at === output.length;
}

const failures = [];
let mapped = 0;
let emitMapped = 0; // examples whose map carries at least one linkable emit run

for (const dialect of DIALECTS) {
  const base = new URL(`../lab/examples/${dialect}/`, import.meta.url);
  const read = (rel) => readFileSync(new URL(rel, base), "utf8");
  const manifest = JSON.parse(read("examples.json"));
  const r = await createRenderer(dialect);

  for (const ex of manifest) {
    const ext = ex.main.split(".").pop(); // .hbs / .rawbars / .maxbars
    const main = read(`${ex.id}/${ex.main}`);
    const partials = {};
    for (const name of ex.partials || []) partials[name] = read(`${ex.id}/${name}.${ext}`);
    const data = ex.data ? loadYaml(read(`${ex.id}/${ex.data}`)) : null;

    let out;
    try {
      out = r.render(r.compile(main, partials).program, data, { map: true });
    } catch (e) {
      failures.push(`${dialect}/${ex.id}: render error — ${e.message}`);
      continue;
    }
    if (out.segments.length === 0) continue; // honest degrade (e.g. a transforming helper)
    mapped++;
    if (out.segments.some((s) => s.kind === "emit" && s.start != null)) emitMapped++;
    if (!tiles(out.output, out.segments)) failures.push(`${dialect}/${ex.id}: segments do not tile the output`);
    // every run is tagged with a known file: the entry ("main") or a declared partial.
    const knownFiles = new Set(["main", ...(ex.partials || [])]);
    if (!out.segments.every((s) => knownFiles.has(s.file)))
      failures.push(`${dialect}/${ex.id}: a run has an unknown file tag`);
  }
}

// The corpus must actually exercise emit provenance — guard against a wiring
// regression that silently returns empty (or text-only) maps everywhere.
if (emitMapped === 0) failures.push("no example produced a linkable emit run (provenance wiring regressed?)");

if (failures.length) {
  console.error("✗ check:provenance\n" + failures.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log(`✓ check:provenance — ${mapped} examples across ${DIALECTS.length} dialects tile a source map`);
