#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// MinBars conformance proof against the FULL official Mustache spec. The mirror
// of scripts/hbs-conformance.mjs, but Mustache *ships* a declarative spec — each
// fixture carries its own `expected` output — so the spec itself is the oracle;
// no second engine is needed. For every fixture in conformance/mustache/spec/ it
// renders the template through MinBars (lab/minbars.mjs — the shipped Lab bundle)
// and asserts `actual === expected`. The headline is conformance over every
// module MinBars implements — all required modules plus the optional
// dynamic-names and inheritance. The optional `~lambdas` module is excluded by
// design (logged, never silently): a lambda is a function in the data, and a
// `Value` is pure data, never a function. The two jobs a lambda does live
// elsewhere — a value-producing lambda is precalculated in a preprocess step
// (any host computation; the Lab uses JSONata) and rendered as plain data; a
// section lambda that rewrites its block body is a helper/block helper. Engine
// guarantee: no arbitrary host code runs from template data, and the rendered
// Value stays pure and JSON-serialisable.
//
//   node scripts/mustache-conformance.mjs            # measure + write report.json
//   node scripts/mustache-conformance.mjs --check    # CI: fail if report.json is stale
//   node scripts/mustache-conformance.mjs --verbose  # also print every mismatch
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createMinBarsRenderer } from "../lab/minbars.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const specDir = resolve(root, "conformance/mustache/spec");
const reportFile = resolve(root, "conformance/mustache/report.json");

// Display order + labels (the optional `~` modules sort last). A module not
// listed still appears, labelled by id, so a new module can't silently vanish.
const META = [
  ["interpolation", "Interpolation"],
  ["sections", "Sections"],
  ["inverted", "Inverted sections"],
  ["comments", "Comments"],
  ["partials", "Partials"],
  ["delimiters", "Set delimiters"],
  ["dynamic-names", "Dynamic names (optional)"],
  ["inheritance", "Inheritance (optional)"],
  ["lambdas", "Lambdas (optional)"],
];
const labelFor = (id) => META.find(([k]) => k === id)?.[1] ?? id;
const orderOf = (id) => {
  const i = META.findIndex(([k]) => k === id);
  return i === -1 ? META.length : i;
};
// Optional modules carry the `~` filename prefix in the spec; record it so the
// report can mark them (and so we never silently treat optional as required).
const isOptional = (file) => file.startsWith("~");

const verbose = process.argv.includes("--verbose");
const check = process.argv.includes("--check");

const renderer = await createMinBarsRenderer();

// The `~lambdas` module is NOT scored: a Mustache/Handlebars lambda is a function
// embedded in the data, and a `Value` is pure data, never a function. The two
// jobs a lambda does live outside the value — a value-producing lambda is
// precalculated in a preprocess step (any host computation; the Lab uses JSONata)
// and rendered as plain data; a section lambda that rewrites its body is a
// helper/block helper. So lambdas are a deliberate architectural substitution,
// not a target; scoring them would mis-frame a design choice as a failure. They
// are excluded explicitly (logged below — never silently), case count recorded.
const LAMBDA_MODULE = "lambdas";

const modules = [];
const misses = [];
let lambdaCases = 0;
let gp = 0, gt = 0; // scored over the modules MinBars implements (lambdas excluded by design)
for (const file of readdirSync(specDir).filter((n) => n.endsWith(".json")).sort()) {
  const id = file.replace(/\.json$/, "").replace(/^~/, "");
  const suite = JSON.parse(readFileSync(resolve(specDir, file), "utf8"));
  const tests = suite.tests || [];
  if (id === LAMBDA_MODULE) {
    lambdaCases = tests.length;
    continue; // replaced by JSONata preprocessing — see the note in the report
  }
  let pass = 0;
  for (const t of tests) {
    let actual = null, err = null, ok = false;
    try {
      actual = renderer.render(renderer.compile(t.template, t.partials || {}).program, t.data ?? null);
      ok = actual === t.expected;
    } catch (e) {
      err = String((e && e.message) || e);
    }
    if (ok) pass++;
    else misses.push({ module: id, name: t.name, optional: isOptional(file), template: t.template, expected: t.expected, actual, error: err });
  }
  gp += pass;
  gt += tests.length;
  modules.push({ id, label: labelFor(id), optional: isOptional(file), pass, total: tests.length });
}
modules.sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.id.localeCompare(b.id));

const pct = (p, t) => (t === 0 ? "100.0" : ((100 * p) / t).toFixed(1));
const report = {
  _generated: "by scripts/mustache-conformance.mjs — DO NOT EDIT; run `npm run gen:mustache-conformance`",
  source: "mustache/spec (full official suite, vendored: conformance/mustache/spec)",
  engine: "MinBars (lab/minbars.mjs — the shipped Lab bundle)",
  method: "render each spec fixture through MinBars; pass = actual === the fixture's own `expected`",
  // The score covers every Mustache module MinBars implements — all required
  // modules plus the optional dynamic-names and inheritance.
  conformance: { pass: gp, total: gt, pct: Number(pct(gp, gt)), scope: "all implemented modules" },
  modules,
  // Not scored — a deliberate substitution, not a target. A Value is pure data,
  // never a function; the two jobs a lambda does live outside the value.
  lambdas: {
    spec_module: "~lambdas",
    cases: lambdaCases,
    status: "out-of-value-by-design",
    rationale:
      "A Value is pure data, never a function (by design). A value-producing lambda is precalculated " +
      "in a preprocess step (any host computation; the Lab uses JSONata) and rendered as plain data; a " +
      "section lambda that rewrites its block body maps to a helper/block helper (render-time behaviour). " +
      "Engine guarantee: no arbitrary host code runs from template data, and the rendered Value stays " +
      "pure and JSON-serialisable. See conformance/mustache/README.md.",
  },
};
const text = JSON.stringify(report, null, 2) + "\n";

if (check) {
  let current = "";
  try {
    current = readFileSync(reportFile, "utf8");
  } catch {
    /* missing → stale */
  }
  if (current !== text) {
    console.error(
      "✗ conformance/mustache/report.json is stale vs the spec + current engine.\n" +
        "  Run `npm run gen:mustache-conformance` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`✓ report.json current — MinBars ${gp}/${gt} (${pct(gp, gt)}%) of all implemented Mustache modules; lambdas out-of-value by design`);
} else {
  writeFileSync(reportFile, text);
  console.log(`\nMinBars vs the official Mustache spec — every module MinBars implements\n`);
  for (const m of modules) {
    const flag = m.pass === m.total ? "✓" : "✗";
    const tag = m.optional ? " (optional)" : "";
    console.log(`  ${flag} ${(m.label).padEnd(28)} ${m.pass}/${m.total}${tag}`);
  }
  console.log(`  ${"".padEnd(30)} ─────`);
  console.log(`  ${"CONFORMANCE".padEnd(30)} ${gp}/${gt}  (${pct(gp, gt)}%)`);
  console.log(`\n  + lambdas (${lambdaCases} spec cases): out of the value by design — a function in data,`);
  console.log(`    and Value is pure data. Value-producing lambda → precalculate (preprocess; the Lab`);
  console.log(`    uses JSONata); section lambda → a helper. No host code runs from template data.`);
  console.log(`\n  wrote ${reportFile}`);
  if (verbose && misses.length) {
    console.log(`\n  ${misses.length} mismatch(es) in implemented modules:`);
    for (const m of misses) {
      console.log(`\n  ✗ ${m.module}/${m.name}${m.optional ? " (optional)" : ""}`);
      console.log(`      template: ${JSON.stringify(m.template)}`);
      console.log(`      expected: ${JSON.stringify(m.expected)}`);
      console.log(`      minbars:  ${m.error ? "THREW " + JSON.stringify(m.error) : JSON.stringify(m.actual)}`);
    }
  } else if (misses.length) {
    console.log(`\n  ${misses.length} mismatch(es) in implemented modules — run with --verbose.`);
  }
}
