// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the pure semantic-token logic (no transport). Exercises the
// vocabulary-derived legend, the flatten + run-length tokenizer, and the LSP
// delta encoding — decoding it back to assert the round-trip.
import assert from "node:assert/strict";
import {
  buildLegend,
  dialectForUri,
  encodeSemanticTokens,
  tokensOf,
  vocabulary,
} from "../src/tokens.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
};

// ── Legend derives from the vocabulary ──────────────────────────────────────
t("legend types/modifiers are the vocabulary's, de-duplicated in order", () => {
  const legend = buildLegend();
  assert.deepEqual(legend.tokenTypes, ["variable", "macro", "keyword", "comment", "string", "number", "operator"]);
  assert.deepEqual(legend.tokenModifiers, ["readonly", "invalid"]);
  // every kind's lsp.type is in the legend (no kind names a type the legend omits)
  for (const def of Object.values(vocabulary.kinds)) {
    assert.ok(legend.tokenTypes.includes(def.lsp.type), `missing type ${def.lsp.type}`);
  }
});

// ── Flatten + RLE: tag fills, interior literals override, by line ───────────
t("tokensOf carves interior operator/string out of the tag run", () => {
  // {{ a ?? "b" }} — MaxBars: one expr tag with an interior `??` operator and a
  // string literal punched out of it.
  assert.deepEqual(tokensOf('{{ a ?? "b" }}', "maxbars"), [
    { line: 0, char: 0, length: 5, kind: "expr" },
    { line: 0, char: 5, length: 2, kind: "operator" },
    { line: 0, char: 7, length: 1, kind: "expr" },
    { line: 0, char: 8, length: 3, kind: "string" },
    { line: 0, char: 11, length: 3, kind: "expr" },
  ]);
});

t("tokensOf splits a multi-line comment at the newline (no token crosses \\n)", () => {
  const toks = tokensOf("a {{!--\nx--}} b", "fullbars");
  // the comment spans two lines; each line gets its own comment token.
  assert.deepEqual(
    toks.filter((x) => x.kind === "comment").map((x) => x.line),
    [0, 1],
  );
  assert.ok(toks.every((x) => x.kind === "comment"), "only the comment is tokenized");
});

t("plain content produces no tokens", () => {
  assert.deepEqual(tokensOf("just text, no tags", "fullbars"), []);
});

// ── Dialect resolution by file name ─────────────────────────────────────────
t("dialectForUri maps extensions, defaulting to fullbars", () => {
  assert.equal(dialectForUri("file:///x/page.mustache"), "minbars");
  assert.equal(dialectForUri("file:///x/page.rawbars"), "rawbars");
  assert.equal(dialectForUri("file:///x/page.maxbars"), "maxbars");
  assert.equal(dialectForUri("file:///x/page.hbs"), "fullbars");
  assert.equal(dialectForUri("file:///x/page.hbs", "rawbars"), "rawbars");
});

// ── LSP wire encoding round-trips to the same positioned tokens ─────────────
t("encodeSemanticTokens delta-encodes; decoding restores the tokens", () => {
  const src = '{{ a ?? "b" }}';
  const legend = buildLegend();
  const { data } = encodeSemanticTokens(src, "maxbars");
  assert.equal(data.length % 5, 0);

  // decode the LSP delta stream back to absolute (line, char, type, mods)
  const decoded = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [dL, dC, len, type, mods] = data.slice(i, i + 5);
    line += dL;
    char = dL === 0 ? char + dC : dC;
    decoded.push({ line, char, length: len, type: legend.tokenTypes[type], mods });
  }
  assert.deepEqual(decoded, [
    { line: 0, char: 0, length: 5, type: "variable", mods: 0 },
    { line: 0, char: 5, length: 2, type: "operator", mods: 0 },
    { line: 0, char: 7, length: 1, type: "variable", mods: 0 },
    { line: 0, char: 8, length: 3, type: "string", mods: 0 },
    { line: 0, char: 11, length: 3, type: "variable", mods: 0 },
  ]);
});

t("raw output carries the readonly modifier bit", () => {
  const legend = buildLegend();
  const { data } = encodeSemanticTokens("{{{x}}}", "fullbars");
  // a single raw token: type variable, modifier readonly (bit 0 -> 1).
  const mods = data[4];
  assert.equal(legend.tokenTypes[data[3]], "variable");
  assert.equal(mods, 1 << legend.tokenModifiers.indexOf("readonly"));
});

console.log(`✓ flatbars-lsp tokens unit tests passed (${passed})`);
