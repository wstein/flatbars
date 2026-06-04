#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Vocabulary-integrity gate (ADR-017). The editor stack rests on ONE contract —
// editors/token-vocabulary.json — shared by three consumers: the engine `tokenize`
// (the kinds it emits), the `flatbars-lsp` semantic-token legend, and the TextMate
// fallback grammar (its scopes). Those joints were previously ungated: a kind the
// engine emits but the vocabulary omits, a silent widening of `lspEmitKinds` (which
// would flatten `{{{x}}}` to one colour — the exact failure ADR-017's sparse design
// guards against), or a grammar scope renamed out from under the vocabulary would
// all pass every other gate. This asserts the four joints, mirroring the
// gen/check pattern of the other gates (exit non-zero on drift).
//
//   node scripts/check-vocab.mjs
//
// The witness for "the kinds the engine emits" is the SAME curated corpus the
// highlight golden uses (scripts/gen-highlight.mjs CORPUS), so there is no second
// corpus to drift; check:highlight guarantees that corpus stays exercised.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokenize } from "../lab/vendor/flatbars-engine.mjs";
import { CORPUS } from "./gen-highlight.mjs";
import { vocabulary, buildLegend } from "../editors/lsp/src/tokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The pinned sparse-correction set (ADR-017 amendment, blocker 3). The LSP emits
// semantic tokens ONLY for these kinds; widening it re-introduces the whole-tag
// flattening the two-layer design exists to avoid, narrowing it drops a correction
// the stateless grammar can't make. Either is a deliberate, reviewable change to
// THIS pin, never an accident.
// Updated when the TextMate fallback was thinned to a delimiter-only floor: the
// grammar no longer distinguishes `{{else}}` / `{{elif …}}` from other `{{…}}`
// interpolations, so the LSP fills the gap by emitting the `keyword` kind too.
// See ADR-017 (amendment) and editors/token-vocabulary.json `lspEmitKinds`.
const EXPECTED_LSP_EMIT = ["error", "keyword", "number", "operator", "set-delimiter", "string"];

const fail = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  fail.push(msg);
};
const sorted = (xs) => [...xs].sort();
const setEq = (a, b) => a.length === b.length && sorted(a).every((x, i) => x === sorted(b)[i]);

const kinds = vocabulary.kinds;
const vocabKinds = Object.keys(kinds);

// ── 1. Engine kinds ≡ vocabulary kinds ────────────────────────────────────────
console.log("Engine ⇄ vocabulary kind parity (witness: gen-highlight CORPUS):");
const emitted = new Set();
for (const c of CORPUS) for (const t of tokenize(c.src, c.dialect)) emitted.add(t.kind);
const emittedNotInVocab = [...emitted].filter((k) => !kinds[k]).sort();
const vocabNotEmitted = vocabKinds.filter((k) => !emitted.has(k)).sort();
if (emittedNotInVocab.length) bad(`engine emits kind(s) the vocabulary does not declare: ${emittedNotInVocab.join(", ")}`);
if (vocabNotEmitted.length) bad(`vocabulary declares kind(s) no corpus case exercises (dead vocab or missing coverage): ${vocabNotEmitted.join(", ")}`);
if (!emittedNotInVocab.length && !vocabNotEmitted.length) ok(`${vocabKinds.length} kinds, engine ≡ vocabulary`);

// ── 2. lspEmitKinds: pinned set, all real kinds ───────────────────────────────
console.log("lspEmitKinds (sparse-correction set):");
const emit = vocabulary.lspEmitKinds;
const notAKind = emit.filter((k) => !kinds[k]);
if (notAKind.length) bad(`lspEmitKinds names non-kind(s): ${notAKind.join(", ")}`);
if (!setEq(emit, EXPECTED_LSP_EMIT)) {
  bad(`lspEmitKinds drifted from the pinned set.\n      expected: ${EXPECTED_LSP_EMIT.join(", ")}\n      actual:   ${sorted(emit).join(", ")}\n      (widening re-flattens {{{x}}}; if intended, update EXPECTED_LSP_EMIT here and ADR-017.)`);
}
if (!notAKind.length && setEq(emit, EXPECTED_LSP_EMIT)) ok(`pinned to {${sorted(emit).join(", ")}}, all real kinds`);

// ── 3. Each kind structurally complete; legend derivation is consistent ───────
console.log("Kind shape + LSP legend derivation:");
const ROLES = ["tag", "interior"];
const emitSet = new Set(emit);
let shapeOk = true;
for (const [k, d] of Object.entries(kinds)) {
  if (!ROLES.includes(d.role)) { bad(`kind '${k}': role '${d.role}' not in {${ROLES.join(", ")}}`); shapeOk = false; }
  if (!d.lsp || typeof d.lsp.type !== "string" || !d.lsp.type) { bad(`kind '${k}': missing lsp.type`); shapeOk = false; }
  if (!Array.isArray(d.tmScopes)) { bad(`kind '${k}': tmScopes must be an array`); shapeOk = false; }
  // A kind the grammar can't scope (empty tmScopes) is only colourable via the
  // LSP, so it MUST be an lspEmitKind — otherwise neither layer paints it.
  else if (d.tmScopes.length === 0 && !emitSet.has(k)) { bad(`kind '${k}': empty tmScopes but not an lspEmitKind — uncolourable by grammar or LSP`); shapeOk = false; }
}
const legend = buildLegend(vocabulary);
const declaredTypes = new Set(Object.values(kinds).map((d) => d.lsp?.type).filter(Boolean));
if (!setEq([...declaredTypes], legend.tokenTypes)) { bad(`legend token types ≠ the distinct kind lsp.types`); shapeOk = false; }
for (const k of emit) {
  const t = kinds[k]?.lsp?.type;
  if (t && !legend.tokenTypes.includes(t)) { bad(`lspEmitKind '${k}' has type '${t}' absent from the legend`); shapeOk = false; }
}
if (shapeOk) ok(`${vocabKinds.length} kinds well-formed; legend = {${legend.tokenTypes.join(", ")}}`);

// ── 4. Grammar parity: every vocabulary tmScope exists in the fallback grammar ─
console.log("TextMate grammar scope parity:");
const grammar = JSON.parse(readFileSync(resolve(root, "editors", "flatbars.tmLanguage.json"), "utf8"));
const grammarScopes = new Set();
(function walk(node) {
  if (!node || typeof node !== "object") return;
  for (const key of ["name", "scopeName", "contentName"]) {
    if (typeof node[key] === "string") for (const s of node[key].split(/\s+/)) grammarScopes.add(s);
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
})(grammar);
const vocabScopes = new Set();
for (const d of Object.values(kinds)) for (const s of d.tmScopes) vocabScopes.add(s);
const missingScopes = [...vocabScopes].filter((s) => !grammarScopes.has(s)).sort();
if (missingScopes.length) bad(`vocabulary tmScope(s) absent from the grammar (renamed/dropped scope): ${missingScopes.join(", ")}`);
else ok(`${vocabScopes.size} vocabulary scopes all present in editors/flatbars.tmLanguage.json`);

console.log(fail.length ? `\n${fail.length} vocabulary-integrity check(s) failed` : `\nall vocabulary-integrity checks OK`);
process.exit(fail.length ? 1 : 0);
