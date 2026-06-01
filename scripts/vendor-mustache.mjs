#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Vendor the mustache/spec conformance corpus into reference/web/examples/vendored/mustache/.
// This is the "sync" step of the example-loader spec (example-loader-spec.md §5):
// fetch the spec's `.json` modules at a PINNED commit and split each into one
// fixture file per test, in the shared vendored-fixture format (§4). The corpus
// is then plain, diffable, offline files — no runtime fetch. The headless
// `barebars examples verify` gate (§6.5) renders each fixture through MinBars and
// asserts `actual == expected` (a divergence is a conformance failure).
//
// `.json` (not `.yml`) is deliberate: mustache/spec ships both, so `JSON.parse`
// suffices and the corpus carries no YAML dependency (the locked MinBars decision).
//
//   node scripts/vendor-mustache.mjs            # vendor at the pinned commit
//   node scripts/vendor-mustache.mjs <sha>      # vendor at a chosen commit
//
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// The corpus lives under the FlatBars Lab's served root so both the headless
// `barebars examples verify` gate (run from the repo root) and the Lab (served
// from reference/web/) read one canonical copy — no duplication.
const OUT = resolve(root, "reference/web/examples/vendored/mustache");

// Pinned mustache/spec commit (refs/heads/master at vendor time). Bump
// deliberately; re-running at the same SHA is byte-identical.
const PINNED = "e8ec001db7f594521e773c34866aca2b5d6b0037";
const SHA = process.argv[2] || PINNED;

// In-scope modules = the Mustache core that MinBars implements (MinBars.purs):
// escaped/raw interpolation, dotted names, the implicit iterator, sections,
// inverted sections, comments, and context-inheriting partials. Excluded:
// `delimiters` (set-delimiters deferred), `~lambdas` (no function arm in Value),
// `~dynamic-names`/`~inheritance` (optional modules — add when MinBars lands them).
const MODULES = ["comments", "interpolation", "sections", "inverted", "partials"];

const NOTICE =
  "Mustache spec (github.com/mustache/spec), MIT. Test fixtures vendored verbatim.";

const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";

// Stable key order so re-vendoring at the same SHA yields byte-identical files.
function fixture(module, test) {
  return {
    id: `mustache/${module}/${slug(test.name)}`,
    provider: "mustache",
    dialect: "minbars",
    divergenceMeaning: "conformance-failure",
    desc: test.desc || "",
    template: test.template,
    data: test.data ?? null,
    partials: test.partials || {},
    expected: test.expected,
    features: [module],
    support: "ok",
    unsupported: [],
    source: {
      url: `https://github.com/mustache/spec/blob/${SHA}/specs/${module}.json`,
      repo: "github.com/mustache/spec",
      commit: SHA,
    },
    license: { spdx: "MIT", holder: "mustache/spec contributors", notice: NOTICE },
  };
}

async function fetchModule(module) {
  const url = `https://raw.githubusercontent.com/mustache/spec/${SHA}/specs/${module}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${module}: HTTP ${res.status}`);
  return res.json();
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
let total = 0;
const manifest = [];
for (const module of MODULES) {
  const spec = await fetchModule(module);
  const dir = resolve(OUT, module);
  mkdirSync(dir, { recursive: true });
  const seen = new Map();
  for (const test of spec.tests) {
    let s = slug(test.name);
    // disambiguate slug collisions within a module (deterministic suffix)
    seen.set(s, (seen.get(s) ?? 0) + 1);
    if (seen.get(s) > 1) s = `${s}-${seen.get(s)}`;
    const fx = fixture(module, test);
    fx.id = `mustache/${module}/${s}`;
    writeFileSync(resolve(dir, `${s}.json`), JSON.stringify(fx, null, 2) + "\n");
    // `path` is relative to reference/web/ (the Lab's fetch root).
    manifest.push({
      id: fx.id,
      provider: fx.provider,
      dialect: fx.dialect,
      divergenceMeaning: fx.divergenceMeaning,
      category: module,
      name: s,
      desc: fx.desc,
      path: `examples/vendored/mustache/${module}/${s}.json`,
    });
    total++;
  }
  console.log(`  ${module}: ${spec.tests.length} fixtures`);
}
// The browse manifest the FlatBars Lab reads to list fixtures (example-loader-spec.md §8).
writeFileSync(
  resolve(OUT, "manifest.json"),
  JSON.stringify({ commit: SHA, fixtures: manifest }, null, 2) + "\n",
);
console.log(`vendored ${total} mustache fixtures at ${SHA.slice(0, 7)} → reference/web/examples/vendored/mustache/`);
