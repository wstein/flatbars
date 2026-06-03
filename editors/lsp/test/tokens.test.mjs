// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the pure semantic-token logic (no transport). Exercises the
// vocabulary-derived legend, the flatten + run-length tokenizer, and the LSP
// delta encoding — decoding it back to assert the round-trip.
import assert from "node:assert/strict";
import {
  buildLegend,
  dialectForLanguageId,
  dialectForUri,
  encodeSemanticTokens,
  parseDiagnostics,
  resolveDialect,
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

// ── Sparse emission: only the kinds the grammar can't get right ─────────────
t("tokensOf emits ONLY interior operator/string for a MaxBars tag (not the tag)", () => {
  // {{ a ?? "b" }} — the LSP corrects `??` and "b" (dialect-scoped); the `expr` tag
  // is left to the TextMate grammar, so no whole-tag token is emitted.
  assert.deepEqual(tokensOf('{{ a ?? "b" }}', "maxbars"), [
    { line: 0, char: 5, length: 2, kind: "operator" },
    { line: 0, char: 8, length: 3, kind: "string" },
  ]);
});

t("tokensOf leaves structural tags to the grammar (no whole-tag tokens)", () => {
  // The reported bug: {{{x}}} must NOT be flattened to one semantic token; the
  // grammar paints braces-vs-name. Likewise plain interpolation and comments.
  assert.deepEqual(tokensOf("{{{test}}}", "fullbars"), [], "raw output: grammar shows through");
  assert.deepEqual(tokensOf("{{name}}", "fullbars"), [], "interpolation: grammar shows through");
  assert.deepEqual(tokensOf("a {{!-- c --}} b", "fullbars"), [], "comment: grammar shows through");
});

t("tokensOf still emits the kinds the grammar gives up on", () => {
  assert.deepEqual(tokensOf("{{=<% %>=}}", "minbars").map((x) => x.kind), ["set-delimiter"]);
  assert.deepEqual(tokensOf("{{&x}}", "rawbars").map((x) => x.kind), ["error"]);
});

t("plain content produces no tokens", () => {
  assert.deepEqual(tokensOf("just text, no tags", "fullbars"), []);
});

// ── Dialect resolution: languageId first, then native extension, then default ──
t("dialectForLanguageId maps the four dialect languages; umbrella/others -> null", () => {
  assert.equal(dialectForLanguageId("maxbars"), "maxbars");
  assert.equal(dialectForLanguageId("rawbars"), "rawbars");
  assert.equal(dialectForLanguageId("flatbars"), null); // umbrella
  assert.equal(dialectForLanguageId("handlebars"), null); // not ours
});
t("dialectForUri maps native extensions only (no .hbs/.mustache), null otherwise", () => {
  assert.equal(dialectForUri("file:///x/page.minbars"), "minbars");
  assert.equal(dialectForUri("file:///x/page.maxbars"), "maxbars");
  assert.equal(dialectForUri("file:///x/page.flatbars"), null); // umbrella, not a dialect
  assert.equal(dialectForUri("file:///x/page.mustache"), null); // not claimed anymore
});
// ── Parse diagnostics (ADR-023): per-dialect, with tag-covering ranges ──────
t("parseDiagnostics flags {{#if a == 1}} off MaxBars, clean on MaxBars", () => {
  const src = "{{#if a == 1}}x{{/if}}";
  const full = parseDiagnostics(src, "fullbars");
  assert.equal(full.length, 1, "one error off MaxBars");
  assert.match(full[0].message, /unexpected token/i);
  assert.equal(full[0].start, 8, "points at the ==");
  assert.equal(full[0].end, 14, "range extends to the tag close }}");
  assert.deepEqual(parseDiagnostics(src, "maxbars"), [], "MaxBars accepts ==");
  assert.deepEqual(parseDiagnostics("{{name}}", "fullbars"), [], "a clean template has none");
});

t("resolveDialect: languageId wins, then uri, then the configured default", () => {
  assert.equal(resolveDialect("maxbars", "file:///x/a.flatbars", "fullbars"), "maxbars"); // id wins
  assert.equal(resolveDialect("flatbars", "file:///x/a.rawbars", "fullbars"), "rawbars"); // umbrella -> uri
  assert.equal(resolveDialect("flatbars", "file:///x/a.flatbars", "minbars"), "minbars"); // -> default
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
  // Sparse: only the operator and string are emitted (the expr tag is the grammar's).
  assert.deepEqual(decoded, [
    { line: 0, char: 5, length: 2, type: "operator", mods: 0 },
    { line: 0, char: 8, length: 3, type: "string", mods: 0 },
  ]);
});

t("a dialect-disallowed shape emits an error token with the invalid modifier", () => {
  const legend = buildLegend();
  const { data } = encodeSemanticTokens("{{&x}}", "rawbars"); // extras off ⇒ error
  assert.equal(legend.tokenTypes[data[3]], "variable");
  assert.equal(data[4], 1 << legend.tokenModifiers.indexOf("invalid"), "invalid modifier set");
});

console.log(`✓ flatbars-lsp tokens unit tests passed (${passed})`);
