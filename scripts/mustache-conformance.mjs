#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// MinBars conformance proof against the FULL official Mustache spec. The mirror
// of scripts/hbs-conformance.mjs, but Mustache *ships* a declarative spec — each
// fixture carries its own `expected` output — so the spec itself is the oracle;
// no second engine is needed. For every fixture in conformance/mustache/spec/ it
// renders the template through MinBars (lab/minbars.mjs — the shipped Lab bundle)
// and asserts `actual === expected`. The headline number is the share of the
// WHOLE spec MinBars reproduces, optional `~` modules included — so it cannot
// over-claim (cf. the curated subset in packages/minbars/test/spec, which is
// 100% by construction).
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

const modules = [];
const misses = [];
let gp = 0, gt = 0;
for (const file of readdirSync(specDir).filter((n) => n.endsWith(".json")).sort()) {
  const id = file.replace(/\.json$/, "").replace(/^~/, "");
  const optional = isOptional(file);
  const suite = JSON.parse(readFileSync(resolve(specDir, file), "utf8"));
  const tests = suite.tests || [];
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
    else misses.push({ module: id, name: t.name, optional, template: t.template, expected: t.expected, actual, error: err });
  }
  gp += pass;
  gt += tests.length;
  modules.push({ id, label: labelFor(id), optional, pass, total: tests.length });
}
modules.sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.id.localeCompare(b.id));

// Required-only subtotal: the spec's mandatory modules (no `~`). MinBars targets
// these; the optional modules are reported separately so the headline is honest
// without conflating "must support" and "may support".
const req = modules.filter((m) => !m.optional);
const rp = req.reduce((a, m) => a + m.pass, 0);
const rt = req.reduce((a, m) => a + m.total, 0);

const pct = (p, t) => (t === 0 ? "100.0" : ((100 * p) / t).toFixed(1));
const report = {
  _generated: "by scripts/mustache-conformance.mjs — DO NOT EDIT; run `npm run gen:mustache-conformance`",
  source: "mustache/spec (full official suite, vendored: conformance/mustache/spec)",
  engine: "MinBars (lab/minbars.mjs — the shipped Lab bundle)",
  method: "render each spec fixture through MinBars; pass = actual === the fixture's own `expected`",
  required: { pass: rp, total: rt, pct: Number(pct(rp, rt)) },
  total: { pass: gp, total: gt, pct: Number(pct(gp, gt)) },
  modules,
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
  console.log(`✓ report.json current — MinBars ${rp}/${rt} (${pct(rp, rt)}%) required, ${gp}/${gt} (${pct(gp, gt)}%) full spec`);
} else {
  writeFileSync(reportFile, text);
  console.log(`\nMinBars vs the official Mustache spec — full-suite conformance\n`);
  for (const m of modules) {
    const flag = m.pass === m.total ? "✓" : "✗";
    const tag = m.optional ? " (optional)" : "";
    console.log(`  ${flag} ${(m.label).padEnd(28)} ${m.pass}/${m.total}${tag}`);
  }
  console.log(`  ${"".padEnd(30)} ─────`);
  console.log(`  ${"REQUIRED modules".padEnd(30)} ${rp}/${rt}  (${pct(rp, rt)}%)`);
  console.log(`  ${"FULL spec (incl. optional)".padEnd(30)} ${gp}/${gt}  (${pct(gp, gt)}%)`);
  console.log(`\n  wrote ${reportFile}`);
  if (verbose && misses.length) {
    console.log(`\n  ${misses.length} mismatch(es):`);
    for (const m of misses) {
      console.log(`\n  ✗ ${m.module}/${m.name}${m.optional ? " (optional)" : ""}`);
      console.log(`      template: ${JSON.stringify(m.template)}`);
      console.log(`      expected: ${JSON.stringify(m.expected)}`);
      console.log(`      minbars:  ${m.error ? "THREW " + JSON.stringify(m.error) : JSON.stringify(m.actual)}`);
    }
  } else if (misses.length) {
    console.log(`\n  ${misses.length} mismatch(es) — run with --verbose to see them.`);
  }
}
