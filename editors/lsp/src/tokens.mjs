// SPDX-License-Identifier: Apache-2.0
//
// The pure semantic-token logic for `flatbars-lsp` (ADR-017): everything from the
// engine's `tokenize` spans to the LSP wire encoding, with no transport. The
// server (server.mjs) is a thin shell over these functions; this module is what
// the unit test exercises directly.
//
// The legend and the kind→(type, modifiers) mapping are derived from the shared
// editors/token-vocabulary.json — the single source of truth (ADR-017). The
// server therefore cannot name a token type the vocabulary does not declare.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokenize } from "./engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const vocabulary = JSON.parse(
  readFileSync(resolve(here, "..", "..", "token-vocabulary.json"), "utf8"),
);

// The LSP semantic-tokens legend, derived from the vocabulary in stable order.
export function buildLegend(vocab = vocabulary) {
  const tokenTypes = [];
  const tokenModifiers = [];
  for (const def of Object.values(vocab.kinds)) {
    if (!tokenTypes.includes(def.lsp.type)) tokenTypes.push(def.lsp.type);
    for (const m of def.lsp.modifiers ?? []) {
      if (!tokenModifiers.includes(m)) tokenModifiers.push(m);
    }
  }
  return { tokenTypes, tokenModifiers };
}

// kind → { typeIndex, modifierBits } against a legend.
function kindEncoder(vocab, legend) {
  const map = new Map();
  for (const [kind, def] of Object.entries(vocab.kinds)) {
    let bits = 0;
    for (const m of def.lsp.modifiers ?? []) bits |= 1 << legend.tokenModifiers.indexOf(m);
    map.set(kind, { typeIndex: legend.tokenTypes.indexOf(def.lsp.type), bits });
  }
  return map;
}

// Map a document URI / file name to its dialect. FlatBars has four surfaces; the
// extension picks one, defaulting to FullBars (the Handlebars-faithful surface).
export function dialectForUri(uri, fallback = "fullbars") {
  const lower = String(uri).toLowerCase();
  if (lower.endsWith(".mustache") || lower.endsWith(".min.hbs")) return "minbars";
  if (lower.endsWith(".rawbars") || lower.endsWith(".raw.hbs")) return "rawbars";
  if (lower.endsWith(".maxbars") || lower.endsWith(".max.hbs")) return "maxbars";
  return fallback;
}

// The flattened, NON-OVERLAPPING per-offset kind map LSP semantic tokens require:
// the tag span fills its range, the interior literal/operator spans override their
// sub-ranges (the engine emits the layered view; the LSP flattens it).
function flatten(text, dialect) {
  const kinds = new Array(text.length).fill(null);
  const spans = tokenize(text, dialect);
  for (const s of spans) if (s.role === "tag") fillRange(kinds, s.from, s.to, s.kind);
  for (const s of spans) if (s.role === "interior") fillRange(kinds, s.from, s.to, s.kind);
  return kinds;
}

function fillRange(arr, from, to, value) {
  for (let i = from; i < to && i < arr.length; i++) arr[i] = value;
}

// Run-length the flattened kind map into positioned tokens, split at line breaks
// (a semantic token may not cross a newline) and at kind changes. Returns
// `{ line, char, length, kind }` records in source order.
export function tokensOf(text, dialect) {
  const kinds = flatten(text, dialect);
  const tokens = [];
  let line = 0;
  let char = 0;
  let i = 0;
  while (i < text.length) {
    if (kinds[i] === null || text[i] === "\n") {
      if (text[i] === "\n") {
        line++;
        char = 0;
      } else {
        char++;
      }
      i++;
      continue;
    }
    const kind = kinds[i];
    const startLine = line;
    const startChar = char;
    let len = 0;
    while (i < text.length && kinds[i] === kind && text[i] !== "\n") {
      len++;
      char++;
      i++;
    }
    tokens.push({ line: startLine, char: startChar, length: len, kind });
  }
  return tokens;
}

// The LSP `SemanticTokens.data`: a flat array of 5-tuples
// [deltaLine, deltaStartChar, length, tokenType, tokenModifiers], delta-encoded
// against the previous token (the wire format `semanticTokens/full` returns).
export function encodeSemanticTokens(text, dialect, vocab = vocabulary, legend = buildLegend(vocab)) {
  const enc = kindEncoder(vocab, legend);
  const data = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of tokensOf(text, dialect)) {
    const e = enc.get(t.kind);
    if (!e) continue; // a kind the vocabulary does not map (should not happen)
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.char - prevChar : t.char;
    data.push(deltaLine, deltaChar, t.length, e.typeIndex, e.bits);
    prevLine = t.line;
    prevChar = t.char;
  }
  return { data };
}
