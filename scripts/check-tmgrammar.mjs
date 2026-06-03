#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:tmgrammar — the drift gate for the TextMate FALLBACK grammar (ADR-017).
//
//   node scripts/check-tmgrammar.mjs
//
// WHY THIS EXISTS: the TextMate grammar is a SECOND representation of FlatBars
// surface syntax (the drift ADR-014 fought). It is a permanent, non-authoritative
// fallback for the no-LSP contexts, so — like every other derived artifact — it is
// drift-bounded by a gate. We tokenize a curated DEFAULT-DELIMITER corpus through
// BOTH the engine (`tokenize`, the authority) and the real `vscode-textmate`
// engine running `editors/flatbars.tmLanguage.json`, mapping each TextMate scope
// back to an engine token kind via `editors/token-vocabulary.json` (the single
// source of truth all three consumers share). Two assertions:
//
//   1. NO MIS-COLOUR — wherever the grammar paints a character with a scope that
//      maps to a kind, the engine agrees on that kind at that character. The
//      grammar is allowed to leave a region PLAIN (give up — set delimiters,
//      MaxBars operators, dialect-error shapes), but it must never paint it WRONG.
//   2. FLOOR COVERAGE — each fixture's `expect` kinds (the default-delimiter forms
//      the fallback is responsible for) are actually painted somewhere, so the gate
//      can't pass with a degenerate empty grammar.
//
// The grammar is the floor; the engine is the ceiling. Set-delimiter and MaxBars-
// operator regions are deliberately out of the corpus (the fallback gives up).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { tokenize } from "../lab/vendor/flatbars-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const editors = resolve(here, "..", "editors");
const require = createRequire(import.meta.url);
const onigPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const { Registry, parseRawGrammar, INITIAL } = (await import("vscode-textmate")).default;
const oniguruma = (await import("vscode-oniguruma")).default;

// ── The curated corpus. Default delimiters only; no set-delimiter / MaxBars-
//    operator forms (the fallback gives up on those by design). `expect` lists the
//    engine kinds the grammar MUST cover for this fixture. ──────────────────────
const CORPUS = [
  { src: "Hello, {{name}}!", dialect: "fullbars", expect: ["expr"] },
  { src: "{{name.first}} {{name.last}}", dialect: "fullbars", expect: ["expr"] },
  { src: "raw: {{{html}}}", dialect: "fullbars", expect: ["raw"] },
  { src: "amp: {{&html}}", dialect: "fullbars", expect: ["raw"] },
  { src: "{{#items}}{{name}}{{/items}}", dialect: "fullbars", expect: ["block-open", "expr", "block-close"] },
  { src: "{{^items}}none{{/items}}", dialect: "fullbars", expect: ["block-inverse", "block-close"] },
  { src: "{{#if a}}x{{else}}y{{/if}}", dialect: "fullbars", expect: ["block-open", "keyword", "block-close"] },
  { src: "{{> row}}", dialect: "fullbars", expect: ["partial"] },
  { src: "{{>* which}}", dialect: "fullbars", expect: ["partial"] },
  { src: "{{<layout}}{{$title}}Hi{{/title}}{{/layout}}", dialect: "minbars", expect: ["block-parent", "block-decl", "block-close"] },
  { src: "Total{{! dropped }}: {{total}}", dialect: "fullbars", expect: ["comment", "expr"] },
  { src: "Hello, {{!-- name --}}!", dialect: "fullbars", expect: ["comment"] },
  { src: "{{{{raw}}}}{{x}}{{{{/raw}}}}", dialect: "fullbars", expect: ["raw-block"] },
  { src: "{{#if (gt qty 5)}}{{/if}}", dialect: "fullbars", expect: ["block-open", "number", "block-close"] },
  { src: "{{ label }} {{ \"n/a\" }}", dialect: "fullbars", expect: ["expr", "string"] },
];

// Build the scope → kind reverse map from the vocabulary (exact leaf-scope match).
const vocab = JSON.parse(readFileSync(resolve(editors, "token-vocabulary.json"), "utf8"));
const scopeToKind = new Map();
for (const [kind, def] of Object.entries(vocab.kinds)) {
  for (const scope of def.tmScopes) {
    if (scopeToKind.has(scope)) {
      fail(`vocabulary: scope "${scope}" maps to both "${scopeToKind.get(scope)}" and "${kind}"`);
    }
    scopeToKind.set(scope, kind);
  }
}

function fail(msg) {
  console.error(`✗ check:tmgrammar — ${msg}`);
  process.exit(1);
}

// The engine's per-character kind map: the tag span fills its range, interior
// literal spans override their sub-ranges (the flattened, non-overlapping view).
function engineKinds(src, dialect) {
  const out = new Array(src.length).fill(null);
  const spans = tokenize(src, dialect);
  for (const s of spans.filter((s) => s.role === "tag")) {
    for (let i = s.from; i < s.to; i++) out[i] = s.kind;
  }
  for (const s of spans.filter((s) => s.role === "interior")) {
    for (let i = s.from; i < s.to; i++) out[i] = s.kind;
  }
  return out;
}

// The grammar's per-character kind map: tokenize each line, and for each token pick
// the MOST SPECIFIC scope (innermost) that the vocabulary maps to a kind. Scopes
// with no mapping (punctuation, meta.*, the root) leave the character plain.
function grammarKinds(grammar, src) {
  const out = new Array(src.length).fill(null);
  let ruleStack = INITIAL;
  let base = 0;
  const lines = src.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const r = grammar.tokenizeLine(line, ruleStack);
    for (const t of r.tokens) {
      let kind = null;
      for (let k = t.scopes.length - 1; k >= 0; k--) {
        if (scopeToKind.has(t.scopes[k])) {
          kind = scopeToKind.get(t.scopes[k]);
          break;
        }
      }
      if (kind !== null) {
        for (let i = t.startIndex; i < t.endIndex; i++) out[base + i] = kind;
      }
    }
    ruleStack = r.ruleStack;
    base += line.length + 1; // + the "\n"
  }
  return out;
}

const wasm = readFileSync(onigPath);
await oniguruma.loadWASM(wasm.buffer);

const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async () =>
    parseRawGrammar(readFileSync(resolve(editors, "flatbars.tmLanguage.json"), "utf8"), "flatbars.tmLanguage.json"),
});

const grammar = await registry.loadGrammar("source.flatbars");
if (!grammar) fail("could not load editors/flatbars.tmLanguage.json");

let checked = 0;
for (const { src, dialect, expect } of CORPUS) {
  const eng = engineKinds(src, dialect);
  const tm = grammarKinds(grammar, src);

  // 1. No mis-colour: where the grammar paints a kind, the engine must agree.
  for (let i = 0; i < src.length; i++) {
    if (tm[i] !== null && tm[i] !== eng[i]) {
      const ctx = `${JSON.stringify(src)} @${i} (${JSON.stringify(src[i])})`;
      fail(`mis-colour in ${ctx}: grammar=${tm[i]} but engine=${eng[i] ?? "plain"}`);
    }
  }
  // 2. Floor coverage: each expected kind is actually painted by the grammar.
  const painted = new Set(tm.filter((k) => k !== null));
  for (const k of expect) {
    if (!painted.has(k)) {
      fail(`floor coverage: ${JSON.stringify(src)} — grammar never painted "${k}" (the fallback must cover this default-delimiter form)`);
    }
  }
  checked++;
}

console.log(`✓ check:tmgrammar — TextMate fallback agrees with the engine on ${checked} default-delimiter fixtures (no mis-colour; floor covered)`);
