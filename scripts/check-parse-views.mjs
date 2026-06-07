// SPDX-License-Identifier: Apache-2.0
//
// Drift gate (parser-unification consensus, #2): the Lab's AST view and the
// editor Problems panel must report the SAME parse errors — because both project
// the ONE recovering parser (ADR-023). `astJson` (the structural tree the Lab
// renders) and `diagnostics` (the located errors `flatbars-lsp` publishes) both
// call `parseRecovering opts src` under the hood; this gate asserts they agree,
// char-for-char, over a malformed-template corpus, so the two views can never
// drift onto different parsers (or different per-dialect options).
//
// Dialect vocabularies differ between the two facades — the Lab uses
// "core"/"surface"/"maxbars" (rawbars→core, fullbars→surface), the LSP uses
// "rawbars"/"fullbars"/"maxbars"/"minbars". We pair the ones that resolve to the
// SAME ParseOptions so the comparison is apples-to-apples; a mismatch means
// `astJson` and `diagnostics` have diverged on either the parser or the options.
import { astJson, diagnostics } from "../lab/vendor/flatbars-engine.mjs";

// [astDialect (astJson vocabulary), diagDialect (diagnostics vocabulary)] — each
// pair resolves to identical ParseOptions in both facades.
const DIALECTS = [
  ["maxbars", "maxbars"], // both → maxOptions
  ["surface", "fullbars"], // both → defaultParseOptions
  ["core", "rawbars"], // both → coreOptions
];

// Templates that the recovering parser keeps walking past — each carries at least
// one error in at least one dialect. We compare the FULL error set per dialect.
const CASES = [
  "{{#each xs}}row", // unclosed block
  "{{name", // unterminated tag
  "{{#if a}}x{{/each}}", // mismatched close
  "{{> }}", // partial with no name
  "{{{{raw}}}}body{{{{/wrong}}}}", // raw-block name mismatch
  "{{&x}}", // extras: rejected by core/maxbars, fine in fullbars-as-surface
  "{{<layout}}x{{/layout}}", // inheritance: rejected outside minbars
  "before {{#with o}}{{a}} after", // unclosed with, content around it
  "{{=<% %>=}}", // set-delimiter: only minbars accepts; an error elsewhere
  "{{}}", // empty tag
  "ok {{a}} {{#each}}{{/each}}", // each with no argument
];

// Normalise one error record to the comparable fields (both facades expose these).
const key = (e) => `${e.line}:${e.column}:${e.offset}:${e.message}`;
const errSet = (arr) => (arr ?? []).map(key).sort();

let fails = 0;
let pairs = 0;
for (const src of CASES) {
  for (const [astD, diagD] of DIALECTS) {
    pairs++;
    const fromAst = errSet(astJson(astD, src).errors);
    const fromDiag = errSet(diagnostics(src, diagD));
    if (fromAst.length !== fromDiag.length || fromAst.some((k, i) => k !== fromDiag[i])) {
      fails++;
      console.error(
        `✘ [${astD}↔${diagD}] error sets diverge for ${JSON.stringify(src)}\n` +
          `   astJson : ${JSON.stringify(fromAst)}\n` +
          `   diagnostics: ${JSON.stringify(fromDiag)}`,
      );
    }
  }
}

if (fails) {
  console.error(
    `\n✘ check:parse-views — ${fails} case(s) where the AST view and the diagnostics disagree.\n` +
      `  Both must project the one recovering parser (ADR-023); see packages/js/src/FullBars/JS.purs.`,
  );
  process.exit(1);
}
console.log(
  `✓ check:parse-views — AST view (astJson) ≡ diagnostics over ${pairs} dialect×case pairs ` +
    `(${CASES.length} templates × ${DIALECTS.length} dialects) — one recovering parser.`,
);
