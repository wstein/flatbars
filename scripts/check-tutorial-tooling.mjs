// SPDX-License-Identifier: Apache-2.0
//
// Gate for the linter & analyser tutorial references. Like check-tutorial-links and
// check-jsonata, it runs every example through the REAL engine bundle the Lab uses
// (lab/vendor/flatbars-engine.mjs), so the pages can never claim a finding, report
// line, or rewrite the tools do not produce:
//
//   • analyse examples → analyze(template, data): the finding COUNT and the report
//     SUBSTRINGS (located finding + portable fix).
//   • lint examples    → lint(template, dialect): the finding count + report
//     substrings, or the exact `report` for the clean no-findings line.
//   • migrate examples → migrate(template): the migrated MaxBars source contains
//     each expected string, and any expected residual `kind` is present.
//
// One content source per example (tutorials/src/{analyse,lint}.mjs), the same the
// pages import. Exits non-zero on any miss; prints a per-item ✓/✗ log.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, analyzeWith, analyzeMinbars, lint, migrate } from "../lab/vendor/flatbars-engine.mjs";

// Analyse dispatch by example engine: MinBars (Mustache) renders on its own
// truthiness rule, so it analyses through `analyzeMinbars`; every other dialect
// is ClassicBars-surface `analyze`. (analyzeWith — the host PathSchema — is ClassicBars
// only; a minbars example never sets `pathSchema`.)
const analyzeFor = (engine) => (engine === "minbars" ? analyzeMinbars : analyze);
import { labHref } from "../lab/open-in-lab.mjs";
import { decodeState } from "../lab/playground_utils.mjs";
import { examples as analyseExamples, gallery as analyseGallery } from "../tutorials/src/analyse.mjs";
import { lintExamples, migrateExamples, lintLabInput, migrateLabInput } from "../tutorials/src/lint.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0;
const miss = (msg) => {
  console.error("  ✘ " + msg);
  fail++;
};

// Orphan guard (mirrors check-tutorial-links): every example must be referenced on
// its page, so no example is verified-but-unshown (or shown-but-unverified).
function noOrphans(page, prefix, keys) {
  const src = readFileSync(resolve(ROOT, page), "utf8");
  for (const k of keys)
    if (!src.includes(`${prefix}.${k}.`)) miss(`${k}: not referenced (\`${prefix}.${k}\`) in ${page}`);
}

console.log("Analyse examples (truthiness portability):");
for (const [key, ex] of Object.entries(analyseExamples)) {
  const before = fail;
  const r = analyzeFor(ex.engine)(ex.template, ex.data);
  if (!r.ok) {
    miss(`${key}: analyse errored: ${r.error}`);
    continue;
  }
  if (r.findings.length !== ex.finds)
    miss(`${key}: expected ${ex.finds} finding(s), got ${r.findings.length}`);
  for (const m of ex.expect ?? [])
    if (!r.report.includes(m)) miss(`${key}: report missing ${JSON.stringify(m)}\n${r.report}`);
  // ADR-030: when the example demos PathSchema suppression, assert analyzeWith
  // removes exactly `expectSuppressed` advisory (potential + miss) findings — so the
  // interactive suppression the page teaches can't silently regress.
  if (ex.pathSchema) {
    const advisory = (res) => res.findings.filter((f) => f.kind === "potential" || f.kind === "miss").length;
    const sup = analyzeWith((p) => !ex.pathSchema.includes(p), ex.template, ex.data);
    if (!sup.ok) miss(`${key}: analyzeWith errored: ${sup.error}`);
    else {
      const removed = advisory(r) - advisory(sup);
      if (removed !== ex.expectSuppressed)
        miss(`${key}: expected ${ex.expectSuppressed} suppressed, got ${removed}`);
    }
  }
  if (fail === before) console.log(`  ✓ ${key} — ${r.findings.length} finding(s)` + (ex.pathSchema ? `, ${ex.expectSuppressed} suppressed` : ""));
}

console.log("Analyse gallery (portability at scale):");
for (const item of analyseGallery) {
  const before = fail;
  const r = analyzeFor(item.engine)(item.template, item.data);
  if (!r.ok) { miss(`${item.name}: analyse errored: ${r.error}`); continue; }
  const got = { observed: 0, potential: 0, miss: 0 };
  for (const f of r.findings) if (f.kind in got) got[f.kind]++;
  for (const k of ["observed", "potential", "miss"])
    if (got[k] !== item.expect[k])
      miss(`${item.name}: expected ${item.expect[k]} ${k}, got ${got[k]}`);
  if (fail === before) console.log(`  ✓ ${item.name} — ${got.observed}/${got.potential}/${got.miss} obs/pot/miss`);
}

console.log("Lint examples (canonicalization):");
for (const [key, ex] of Object.entries(lintExamples)) {
  const before = fail;
  const r = lint(ex.template, ex.engine);
  if (!r.ok) {
    miss(`${key}: lint errored: ${r.error}`);
    continue;
  }
  if (ex.findings != null && r.findings.length !== ex.findings)
    miss(`${key}: expected ${ex.findings} finding(s), got ${r.findings.length}`);
  if (ex.report != null && r.report !== ex.report)
    miss(`${key}: report ${JSON.stringify(r.report)} !== ${JSON.stringify(ex.report)}`);
  for (const m of ex.expect ?? [])
    if (!r.report.includes(m)) miss(`${key}: report missing ${JSON.stringify(m)}\n${r.report}`);
  if (fail === before) console.log(`  ✓ ${key}`);
}

console.log("Migrate examples (Handlebars → MaxBars):");
for (const [key, ex] of Object.entries(migrateExamples)) {
  const before = fail;
  const r = migrate(ex.template);
  if (!r.ok) {
    miss(`${key}: migrate errored: ${r.error}`);
    continue;
  }
  if (r.source !== ex.source)
    miss(`${key}: migrated source\n  got:  ${JSON.stringify(r.source)}\n  want: ${JSON.stringify(ex.source)}`);
  if (ex.residualKind && !r.residuals.some((x) => x.kind === ex.residualKind))
    miss(`${key}: expected a ${ex.residualKind} residual, got [${r.residuals.map((x) => x.kind).join(", ")}]`);
  if (fail === before) console.log(`  ✓ ${key}`);
}

// Open-in-Lab parity: every /lint example must build a valid Lab deep-link that
// carries the example into the right view — a lint example opens the Lint dock
// panel (`dk`), a migrate example the Migrated MaxBars output view (`v`). Decode
// the URL the page builds and assert the engine + target + template round-trip, so
// the "Open in Lab" links can never drift from the example or target the wrong view.
console.log("Open-in-Lab deep-links (lint -> Lint panel, migrate -> Migrated view):");
async function decodeLink(href) {
  const url = new URL(href, "https://x/");
  return { engine: url.searchParams.get("engine"), state: await decodeState(href.slice(href.indexOf("#") + 1)) };
}
for (const [key, ex] of Object.entries(lintExamples)) {
  const before = fail;
  const { engine, example } = lintLabInput(ex);
  const { engine: gotEngine, state } = await decodeLink(await labHref(engine, example));
  if (gotEngine !== engine) miss(`lint:${key}: link engine ${gotEngine} !== ${engine}`);
  if (state.dk !== "lint") miss(`lint:${key}: link should open the Lint panel (dk), got ${JSON.stringify(state.dk)}`);
  if (state.tabs?.[0]?.s !== ex.template) miss(`lint:${key}: link template drifted from the example`);
  if (fail === before) console.log(`  ✓ lint:${key} → ?engine=${engine} #dk=lint`);
}
for (const [key, ex] of Object.entries(migrateExamples)) {
  const before = fail;
  const { engine, example } = migrateLabInput(ex);
  const { engine: gotEngine, state } = await decodeLink(await labHref(engine, example));
  if (gotEngine !== engine) miss(`migrate:${key}: link engine ${gotEngine} !== ${engine}`);
  if (state.v !== "migrated") miss(`migrate:${key}: link should open the Migrated view (v), got ${JSON.stringify(state.v)}`);
  if (state.tabs?.[0]?.s !== ex.template) miss(`migrate:${key}: link template drifted from the example`);
  if (fail === before) console.log(`  ✓ migrate:${key} → ?engine=${engine} #v=migrated`);
}

console.log("Page references (orphan guard):");
const beforeOrphans = fail;
noOrphans("tutorials/src/pages/analyse.astro", "ex", Object.keys(analyseExamples));
noOrphans("tutorials/src/pages/lint.astro", "lintExamples", Object.keys(lintExamples));
noOrphans("tutorials/src/pages/lint.astro", "migrateExamples", Object.keys(migrateExamples));
if (fail === beforeOrphans) console.log("  ✓ every example is shown on its page");

const total =
  Object.keys(analyseExamples).length +
  Object.keys(lintExamples).length +
  Object.keys(migrateExamples).length;
if (fail) {
  console.error(`\n✘ check:tutorial-tooling — ${fail} failure(s)`);
  process.exit(1);
}
console.log(`\n✓ check:tutorial-tooling — ${total} linter/analyser examples verified against the engine`);
