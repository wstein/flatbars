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
import { createMinBarsRenderer } from "../lab/minbars.mjs";
import { createFlatBarsRenderer } from "../lab/flatbars.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const humanize = (id) =>
  id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

// One dialect: its lab engine id, the typed source, the file extension, and a
// renderer factory (the SAME path check-tutorial-links + the Lab use). MinBars,
// RawBars and MaxBars project from typed sources; FullBars keeps its own curated
// folder (lab/examples/fullbars/, the former shared `handlebars/` catalog — those
// ARE FullBars examples). No dialect shares a folder anymore (the hack is gone);
// converting FullBars to a typed-source projection too is a tracked follow-up.
// A few passing mustache/spec fixtures derived straight into the MinBars catalog
// (a "From the spec" group), so the Lab's coverage tracks the spec. Each is
// rendered and asserted against its OWN `expected` — if MinBars drifts from the
// spec, gen fails (stronger than the snapshot). Terse by nature (they're test
// fixtures), so we keep the list short and representative.
const SPEC_FIXTURES = [
  "interpolation/basic-interpolation",
  "sections/list",
  "inverted/falsey",
  "comments/inline",
  "partials/basic-behavior",
];

const DIALECTS = [
  { engine: "minbars", module: "../tutorials/src/mustache.mjs", ext: "mustache", specFixtures: SPEC_FIXTURES, makeRenderer: () => createMinBarsRenderer() },
  { engine: "rawbars", module: "../tutorials/src/rawbars.mjs", ext: "rawbars", makeRenderer: () => createFlatBarsRenderer("core") },
  { engine: "maxbars", module: "../tutorials/src/maxbars.mjs", ext: "maxbars", makeRenderer: () => createFlatBarsRenderer("maxbars") },
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
      view: ex.view || "rendered",
      main: `main.${d.ext}`,
      partials: partialNames,
      data: "data.yaml",
    });
    // Snapshot the render — the gate's expected output (asserts the example renders).
    const res = renderer.render(renderer.compile(ex.template, partials).program, ex.data ?? {});
    snapshots[id] = typeof res === "string" ? res : res.output;
  }
  // Spec-derived examples (item C): a few passing mustache/spec fixtures, asserted
  // against their own `expected` so the Lab tracks the spec.
  for (const fxPath of d.specFixtures || []) {
    const fx = JSON.parse(readFileSync(resolve(root, "lab/examples/vendored/mustache", fxPath + ".json"), "utf8"));
    const id = "spec-" + fxPath.split("/").pop();
    const partials = fx.partials || {};
    const out = renderer.render(renderer.compile(fx.template, partials).program, fx.data ?? {});
    const rendered = typeof out === "string" ? out : out.output;
    if (rendered !== fx.expected) {
      console.error(`✗ spec fixture ${fxPath}: MinBars render diverged from the spec's expected.`);
      console.error(`  expected ${JSON.stringify(fx.expected)}\n  got      ${JSON.stringify(rendered)}`);
      process.exit(1);
    }
    files[`${base}/${id}/main.${d.ext}`] = fx.template;
    files[`${base}/${id}/data.yaml`] = fx.data && Object.keys(fx.data).length ? yamlDump(fx.data) : "{}\n";
    for (const [name, src] of Object.entries(partials)) files[`${base}/${id}/${name}.${d.ext}`] = src;
    manifest.push({
      id,
      label: humanize(fxPath.split("/").pop()) + " (spec)",
      group: "From the spec",
      view: "text",
      main: `main.${d.ext}`,
      partials: Object.keys(partials),
      data: "data.yaml",
    });
    snapshots[id] = rendered;
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
