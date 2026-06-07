#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Project a dialect's TYPED example source (tutorials/src/<id>.mjs) into the
// FlatBars Lab's folder-based example catalog (lab/examples/<dialect>/), so the
// Lab dropdown and the tutorial page share ONE source and can never drift. Each
// example becomes `<id>/{main.<ext>, data.yaml, <partial>.<ext>}` plus an
// `examples.json` manifest the Lab fetches; the example is also rendered through
// the real engine and its output committed to `snapshots.json` — so the gate
// asserts EXPECTED output (valid Mustache, not just "produces something").
//
// Drift-gated like the catalog: `check:examples` regenerates and diffs.
//   node scripts/gen-examples.mjs           # regenerate
//   node scripts/gen-examples.mjs --check    # CI: fail on drift
//
// Currently projects MinBars (the curated, metadata-complete source). Promoting
// the other three dialects (killing the shared lab/examples/handlebars hack) is a
// tracked follow-up: it needs per-example Lab-curation tags + custom-helper
// projection (fullbars examples carry ADR-018 helpers the catalog loader omits).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dump as yamlDump } from "../lab/vendor/js-yaml.mjs";
import { createMinBarsRenderer } from "../lab/minbars.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const humanize = (id) =>
  id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

// One dialect: its lab engine id, the typed source, the file extension, and a
// renderer factory (the SAME path check-tutorial-links + the Lab use).
const DIALECTS = [
  { engine: "minbars", module: "../tutorials/src/mustache.mjs", ext: "mustache", makeRenderer: createMinBarsRenderer },
];

// Build the full {relpath: content} map a dialect projects to. Pure (no I/O), so
// gen and --check share it.
async function buildDialect(d) {
  const { examples } = await import(d.module);
  const renderer = await d.makeRenderer();
  const base = `lab/examples/${d.engine}`;
  const files = {};
  const manifest = [];
  const snapshots = {};
  for (const [id, ex] of Object.entries(examples)) {
    const partials = ex.partials || {};
    const partialNames = Object.keys(partials);
    files[`${base}/${id}/main.${d.ext}`] = ex.template;
    files[`${base}/${id}/data.yaml`] = ex.data && Object.keys(ex.data).length ? yamlDump(ex.data) : "{}\n";
    for (const [name, src] of Object.entries(partials)) files[`${base}/${id}/${name}.${d.ext}`] = src;
    manifest.push({
      id,
      label: ex.label || humanize(id),
      group: ex.group || "Examples",
      view: ex.view || "rendered",
      main: `main.${d.ext}`,
      partials: partialNames,
      data: "data.yaml",
    });
    // Snapshot the render — the gate's expected output (asserts valid Mustache).
    const out = renderer.render(renderer.compile(ex.template, partials).program, ex.data ?? {});
    snapshots[id] = out;
  }
  files[`${base}/examples.json`] = JSON.stringify(manifest, null, 2) + "\n";
  files[`${base}/snapshots.json`] = JSON.stringify(snapshots, null, 2) + "\n";
  return files;
}

// Every relpath under a dialect's example dir on disk (so --check catches stray files).
function onDisk(base) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(resolve(root, dir))) return;
    for (const ent of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk(base);
  return out;
}

const check = process.argv.includes("--check");
let drift = 0;
let total = 0;
for (const d of DIALECTS) {
  const base = `lab/examples/${d.engine}`;
  const want = await buildDialect(d);
  total += Object.keys(want).length;
  if (check) {
    const have = new Set(onDisk(base));
    for (const [rel, content] of Object.entries(want)) {
      let cur = null;
      try { cur = readFileSync(resolve(root, rel), "utf8"); } catch {}
      if (cur !== content) { console.error(`✗ ${rel} is stale or missing`); drift++; }
      have.delete(rel);
    }
    for (const stray of have) { console.error(`✗ ${stray} is not produced by the source (stale)`); drift++; }
  } else {
    // Clean-regenerate the dir so removed examples don't linger.
    if (existsSync(resolve(root, base))) rmSync(resolve(root, base), { recursive: true });
    for (const [rel, content] of Object.entries(want)) {
      mkdirSync(dirname(resolve(root, rel)), { recursive: true });
      writeFileSync(resolve(root, rel), content);
    }
  }
}

if (check) {
  if (drift) {
    console.error(`\n${drift} example artifact(s) drifted. Run \`npm run gen:examples\` and commit.`);
    process.exit(1);
  }
  console.log(`✓ lab example catalog current — ${total} files across ${DIALECTS.length} dialect(s)`);
} else {
  console.log(`✓ wrote ${total} files across ${DIALECTS.length} dialect(s) (${DIALECTS.map((d) => d.engine).join(", ")})`);
}
