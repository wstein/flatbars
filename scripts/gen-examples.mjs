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
// Projects MinBars, RawBars and MaxBars from their typed sources. FullBars keeps
// its curated lab/examples/fullbars/ set (the former shared `handlebars/` catalog),
// so no dialect shares a folder. Examples carrying a custom `helpers` field
// (ADR-018) or a cross-dialect `engine` override are page-only and skipped here.
// Converting FullBars to a typed-source projection too is a tracked follow-up.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dump as yamlDump } from "../lab/vendor/js-yaml.mjs";
import { createRenderer } from "../lab/renderer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const humanize = (id) =>
  id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

// One dialect: its lab engine id, the typed source, the file extension, and a
// renderer factory (the SAME path check-tutorial-links + the Lab use). All four
// dialects now project from their typed sources — no hand-maintained catalog, no
// shared folder. Entries carrying a custom `helpers` field (ADR-018) or a cross-
// dialect `engine` override are page-only and skipped here (the Lab dropdown
// hosts neither), so FullBars's helper/raw-block examples stay tutorial-only.
const DIALECTS = [
  // MinBars + FullBars examples are deliberately non-HTML (plain text / Markdown /
  // config / email), so they land in the "Plain Text" output view, not the HTML
  // preview — `defaultView: "source"` (the real view-tab name; see lab/output-view.mjs).
  // A per-example `view: "rendered"` (e.g. the HTML `card`) overrides it.
  { engine: "minbars", module: "../tutorials/src/mustache.mjs", ext: "mustache", defaultView: "source", makeRenderer: () => createRenderer("minbars") },
  { engine: "fullbars", module: "../tutorials/src/fullbars.mjs", ext: "hbs", defaultView: "source", makeRenderer: () => createRenderer("surface") },
  { engine: "rawbars", module: "../tutorials/src/rawbars.mjs", ext: "rawbars", makeRenderer: () => createRenderer("core") },
  { engine: "maxbars", module: "../tutorials/src/maxbars.mjs", ext: "maxbars", defaultView: "source", makeRenderer: () => createRenderer("maxbars") },
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
    // The catalog loader hosts neither custom helpers (ADR-018) nor a cross-dialect
    // `engine` override (RawBars diptychs render `sugar` under FullBars), so those
    // page-only examples are not projected to the Lab dropdown.
    if (ex.helpers && ex.helpers.trim()) continue;
    if (ex.engine && ex.engine !== d.engine) continue;
    const partials = ex.partials || {};
    const partialNames = Object.keys(partials);
    files[`${base}/${id}/main.${d.ext}`] = ex.template;
    files[`${base}/${id}/data.yaml`] = ex.data && Object.keys(ex.data).length ? yamlDump(ex.data) : "{}\n";
    for (const [name, src] of Object.entries(partials)) files[`${base}/${id}/${name}.${d.ext}`] = src;
    manifest.push({
      id,
      label: ex.label || humanize(id),
      group: ex.group || "Examples",
      view: ex.view || d.defaultView || "rendered",
      main: `main.${d.ext}`,
      partials: partialNames,
      data: "data.yaml",
    });
    // Snapshot the render — the gate's expected output (asserts the example renders).
    const res = renderer.render(renderer.compile(ex.template, partials).program, ex.data ?? {});
    snapshots[id] = typeof res === "string" ? res : res.output;
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
