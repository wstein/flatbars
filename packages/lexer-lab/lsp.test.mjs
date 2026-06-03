// SPDX-License-Identifier: Apache-2.0
//
// Demo + assertions for the hand-spike → LSP semantic-tokens wiring (lsp.mjs).
// Run: node packages/lexer-lab/lsp.test.mjs   (after `spago build`).
//
// It prints (1) the per-lexeme classification table, (2) the LSP wire `data`,
// (3) the decoded tokens — and asserts the sparse stream and, crucially, that a
// HALF-TYPED template still produces tokens (forgiveness) with an `Invalid` mark.
import assert from "node:assert/strict";
import { buildLegend, decode, lex, semanticTokens } from "./lsp.mjs";

const ok = (msg) => console.log(`  ✓ ${msg}`);

// A MaxBars-flavoured sample (operators on) exercising every emitted kind.
const SAMPLE = [
  '<h1>{{ title }}</h1>',
  '{{#each items}}',
  '  <li>{{ qty * price }} {{ label | upper }} {{ note }} {{ n >= 100 }}</li>',
  '{{/each}}',
  '{{=<% %>=}}',
  '<% greeting %>',
].join("\n");

console.log("hand-spike → LSP semantic tokens\n");
console.log("legend.tokenTypes:", buildLegend().tokenTypes.join(", "));
console.log("\n— per-lexeme classification (· = not emitted) —");
for (const t of lex(SAMPLE)) {
  if (t.kind === "Whitespace" || t.kind === "Text") continue;
  const tag = t.emit ? t.type : "·";
  console.log(
    `  ${String(t.start.line).padStart(2)}:${String(t.start.column).padStart(2)}  ` +
      `${t.kind.padEnd(12)} ${tag.padEnd(9)} ${JSON.stringify(t.text)}`,
  );
}

const { data } = semanticTokens(SAMPLE);
console.log("\n— LSP semanticTokens/full .data (5-tuples) —");
console.log(" ", JSON.stringify(data));

console.log("\n— decoded —");
const toks = decode(SAMPLE);
for (const t of toks) {
  console.log(`  ${t.line}:${t.char} len ${t.length}  ${t.type}${t.modifiers.length ? " " + t.modifiers.join("+") : ""}`);
}

console.log("\nassertions");

// The sparse stream is operators / literals / set-delimiters only.
const types = toks.map((t) => t.type);
assert.ok(types.includes("operator"), "emits operator (* | >=)");
assert.ok(types.includes("number"), "emits number (100)");
assert.ok(types.includes("keyword"), "emits set-delimiter (keyword)");
assert.equal(data.length % 5, 0, "data is a flat array of 5-tuples");
ok("sample yields a sparse operator/number/set-delimiter stream");

// Structural braces / idents are NOT emitted (left to the TextMate floor).
assert.ok(!lex("{{ title }}").some((t) => t.emit && t.kind === "Open"), "{{ is not emitted");
ok("structural braces stay silent (sparse corrections only)");

// FORGIVENESS: a half-typed template still lexes and still highlights.
const HALF = 'hi {{ count }} and then {{ oops';
const half = lex(HALF);
assert.ok(half.some((t) => t.kind === "Invalid"), "the dangling {{ becomes Invalid");
assert.ok(half.some((t) => t.kind === "Num" || t.text === "count"), "tokens before the error survive");
const halfDecoded = decode(HALF);
assert.ok(
  halfDecoded.some((t) => t.type === "variable" && t.modifiers.includes("invalid")),
  "the Invalid region carries the `invalid` modifier for the LSP",
);
ok("a half-typed template still produces tokens (no go-dark on first error)");

// And it is genuinely forgiving across several breakages.
for (const bad of ["{{", "{{ x", "{{#each", "before {{!{{ after {{ y }}", "{{{ z"]) {
  const r = lex(bad);
  assert.ok(Array.isArray(r) && r.length >= 1, `recovers on: ${JSON.stringify(bad)}`);
}
ok("recovers on a range of malformed inputs");

console.log("\nall lsp-wiring assertions passed");
