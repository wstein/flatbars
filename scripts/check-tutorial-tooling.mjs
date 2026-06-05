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
import { analyze, lint, migrate } from "../lab/vendor/flatbars-engine.mjs";
import { examples as analyseExamples } from "../tutorials/src/analyse.mjs";
import { lintExamples, migrateExamples } from "../tutorials/src/lint.mjs";

let fail = 0;
const miss = (msg) => {
  console.error("  ✘ " + msg);
  fail++;
};

console.log("Analyse examples (truthiness portability):");
for (const [key, ex] of Object.entries(analyseExamples)) {
  const before = fail;
  const r = analyze(ex.template, ex.data);
  if (!r.ok) {
    miss(`${key}: analyse errored: ${r.error}`);
    continue;
  }
  if (r.findings.length !== ex.finds)
    miss(`${key}: expected ${ex.finds} finding(s), got ${r.findings.length}`);
  for (const m of ex.expect ?? [])
    if (!r.report.includes(m)) miss(`${key}: report missing ${JSON.stringify(m)}\n${r.report}`);
  if (fail === before) console.log(`  ✓ ${key} — ${r.findings.length} finding(s)`);
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
  for (const m of ex.containsSource ?? [])
    if (!r.source.includes(m)) miss(`${key}: migrated source missing ${JSON.stringify(m)}\n${r.source}`);
  if (ex.residualKind && !r.residuals.some((x) => x.kind === ex.residualKind))
    miss(`${key}: expected a ${ex.residualKind} residual, got [${r.residuals.map((x) => x.kind).join(", ")}]`);
  if (fail === before) console.log(`  ✓ ${key}`);
}

const total =
  Object.keys(analyseExamples).length +
  Object.keys(lintExamples).length +
  Object.keys(migrateExamples).length;
if (fail) {
  console.error(`\n✘ check:tutorial-tooling — ${fail} failure(s)`);
  process.exit(1);
}
console.log(`\n✓ check:tutorial-tooling — ${total} linter/analyser examples verified against the engine`);
