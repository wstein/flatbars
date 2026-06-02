#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Handlebars conformance proof for FullBars — DIFFERENTIAL, so it cannot
// over-claim. For every case in conformance/handlebars/corpus.json it renders
// the template through the REAL `handlebars` npm package (the oracle, a
// dev-only dependency) and through FullBars (lab/vendor/flatbars-engine.mjs,
// the same bundle the Lab ships), then asserts byte-equality. The "expected"
// output is therefore whatever upstream Handlebars actually produces — never a
// value we wrote down. The headline number is the share of cases where FullBars
// matches Handlebars exactly.
//
//   node scripts/hbs-conformance.mjs            # measure + write the report
//   node scripts/hbs-conformance.mjs --check    # CI: fail if the report is stale
//   node scripts/hbs-conformance.mjs --verbose  # also print every mismatch
//
// Cases tagged `gap` in the corpus are the documented FullBars divergences we
// are closing (blockHelperMissing / Mustache-style sections). They start as
// misses; the number rises as the feature lands.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Handlebars from "handlebars";
import { renderWith, safe } from "../lab/vendor/flatbars-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const corpusFile = resolve(root, "conformance/handlebars/corpus.json");
const reportFile = resolve(root, "conformance/handlebars/report.json");

// ── Helper definitions, registered IDENTICALLY in both engines ───────────────
// Each entry gives the Handlebars form and the FullBars form (an inline
// `{ name: fn }` per ADR-018). They must be semantically identical so a
// mismatch reflects the engine, not the helper. A helper FullBars cannot
// express (e.g. a user-defined *block* helper) is omitted on the FullBars side
// on purpose — the resulting miss is a real, reported gap.
const HELPERS = {
  loud: {
    hb: (s) => String(s).toUpperCase(),
    fb: (s) => String(s).toUpperCase(),
  },
  trim: {
    hb: (s) => String(s).trim(),
    fb: (s) => String(s).trim(),
  },
  link: {
    hb: function (text, options) {
      return new Handlebars.SafeString('<a href="' + options.hash.href + '">' + text + "</a>");
    },
    fb: (text, hash) => safe('<a href="' + (hash && hash.href) + '">' + text + "</a>"),
  },
  // A user-defined BLOCK helper. Handlebars supports it; FullBars's user-helper
  // API (ADR-018) is inline-only, so there is no `fb` — this is a known gap.
  bold: {
    hb: function (options) {
      return new Handlebars.SafeString("<b>" + options.fn(this) + "</b>");
    },
  },
};

function renderHandlebars(test) {
  const hb = Handlebars.create(); // isolated instance — no helper/partial leakage
  for (const name of test.helpers || []) hb.registerHelper(name, HELPERS[name].hb);
  for (const [name, src] of Object.entries(test.partials || {})) hb.registerPartial(name, src);
  return hb.compile(test.template)(test.data ?? {});
}

function renderFullBars(test) {
  const bag = Object.create(null);
  for (const name of test.helpers || []) if (HELPERS[name].fb) bag[name] = HELPERS[name].fb;
  const r = renderWith(bag, test.partials || {}, test.template, test.data ?? {});
  if (!r.ok) throw new Error(r.error || "render failed");
  return r.value;
}

// ── Run ──────────────────────────────────────────────────────────────────────
const corpus = JSON.parse(readFileSync(corpusFile, "utf8"));
const verbose = process.argv.includes("--verbose");
const check = process.argv.includes("--check");

const modules = [];
const misses = [];
let gp = 0, gt = 0; // global pass / total
let gapP = 0, gapT = 0; // gap-tagged pass / total

for (const cat of corpus.categories) {
  let pass = 0;
  for (const t of cat.tests) {
    const isGap = t.tag === "gap";
    if (isGap) gapT++;
    let expected, ok = false, actual = null, err = null;
    try {
      expected = renderHandlebars(t);
    } catch (e) {
      expected = "<<oracle-threw: " + (e && e.message) + ">>";
    }
    try {
      actual = renderFullBars(t);
      ok = actual === expected;
    } catch (e) {
      err = String((e && e.message) || e);
    }
    if (ok) {
      pass++;
      if (isGap) gapP++;
    } else {
      misses.push({ category: cat.id, name: t.name, gap: !!isGap, template: t.template, expected, actual, error: err });
    }
  }
  gp += pass;
  gt += cat.tests.length;
  modules.push({ id: cat.id, label: cat.label, pass, total: cat.tests.length });
}

const pct = (p, t) => (t === 0 ? "100.0" : ((100 * p) / t).toFixed(1));
const report = {
  _generated: "by scripts/hbs-conformance.mjs — DO NOT EDIT; run `npm run gen:hbs-conformance`",
  oracle: "handlebars@" + Handlebars.VERSION + " (dev-only differential oracle)",
  engine: "FullBars (lab/vendor/flatbars-engine.mjs — the shipped Lab bundle)",
  method: "render each corpus case through real Handlebars AND FullBars; pass = byte-identical",
  total: { pass: gp, total: gt, pct: Number(pct(gp, gt)) },
  gap: { pass: gapP, total: gapT, label: "blockHelperMissing / Mustache-style sections" },
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
      "✗ conformance/handlebars/report.json is stale vs the corpus + current engine.\n" +
        "  Run `npm run gen:hbs-conformance` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`✓ report.json current — FullBars ${gp}/${gt} (${pct(gp, gt)}%) vs handlebars@${Handlebars.VERSION}`);
} else {
  writeFileSync(reportFile, text);
  console.log(`\nFullBars vs handlebars@${Handlebars.VERSION} — DIFFERENTIAL conformance\n`);
  for (const m of modules) {
    const flag = m.pass === m.total ? "✓" : "✗";
    console.log(`  ${flag} ${m.label.padEnd(38)} ${m.pass}/${m.total}`);
  }
  console.log(`  ${"".padEnd(40)} ─────`);
  console.log(`  ${"OVERALL".padEnd(40)} ${gp}/${gt}  (${pct(gp, gt)}%)`);
  console.log(`  of which blockHelperMissing gap: ${gapP}/${gapT}`);
  console.log(`\n  wrote ${reportFile}`);
  if (verbose && misses.length) {
    console.log(`\n  ${misses.length} mismatch(es):`);
    for (const m of misses) {
      console.log(`\n  ✗ ${m.category}/${m.name}${m.gap ? " [gap]" : ""}`);
      console.log(`      template: ${JSON.stringify(m.template)}`);
      console.log(`      handlebars: ${JSON.stringify(m.expected)}`);
      console.log(`      fullbars:   ${m.error ? "THREW " + JSON.stringify(m.error) : JSON.stringify(m.actual)}`);
    }
  } else if (misses.length) {
    console.log(`\n  ${misses.length} mismatch(es) — run with --verbose to see them.`);
  }
}
