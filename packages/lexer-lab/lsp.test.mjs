// SPDX-License-Identifier: Apache-2.0
//
// Demo + assertions for the hand-spike → LSP semantic-tokens wiring (lsp.mjs).
// Run: node packages/lexer-lab/lsp.test.mjs   (after `spago build`).
//
// It prints (1) the per-lexeme classification table, (2) the LSP wire `data`,
// (3) the decoded tokens — and asserts the sparse stream and, crucially, that a
// HALF-TYPED template still produces tokens (forgiveness) with an `Invalid` mark.
import assert from "node:assert/strict";
import { buildLegend, decode, diagnostics, lex, semanticTokens } from "./lsp.mjs";

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

// FORGIVENESS: a half-typed template still lexes — every valid token survives,
// including the interior of the still-open last tag (in-tag recovery), so the
// editor never goes dark mid-keystroke.
const HALF = "hi {{ count }} and then {{ oops";
const half = lex(HALF);
assert.ok(half.some((t) => t.kind === "Ident" && t.text === "count"), "the completed tag survives");
assert.ok(half.some((t) => t.kind === "Ident" && t.text === "oops"), "the open tag's interior survives");
ok("a half-typed template still produces tokens (no go-dark on first error)");

// IN-TAG recovery: an unterminated tag keeps the interior tokens it already
// lexed, so the operator and number in `{{ price * 2` still get semantic tokens
// — opener-only recovery would have lost them to ocean.
const INTAG = "{{ price * 2";
const intag = lex(INTAG);
assert.ok(intag.some((t) => t.kind === "Op" && t.text === "*"), "operator survives in-tag recovery");
assert.ok(intag.some((t) => t.kind === "Num"), "number survives in-tag recovery");
const intagTypes = decode(INTAG).map((t) => t.type);
assert.ok(intagTypes.includes("operator") && intagTypes.includes("number"), "they still emit semantic tokens");
ok("in-tag recovery keeps an unterminated tag's interior (operator + number)");

// Only the unparseable TAIL is Invalid, and lexing resyncs at the close so the
// next tag is unaffected.
const TAIL = "{{ a ; b }} ok {{ y }}"; // `;` can't start an interior lexeme
const tail = lex(TAIL);
assert.ok(tail.some((t) => t.kind === "Invalid"), "the bad interior tail is Invalid");
assert.ok(tail.some((t) => t.text === "a"), "the valid prefix (a) is kept");
assert.equal(tail.filter((t) => t.kind === "Ident" && t.text === "y").length, 1, "the next tag still lexes");
assert.ok(
  decode(TAIL).some((t) => t.type === "variable" && t.modifiers.includes("invalid")),
  "the Invalid tail reaches the LSP wire with the `invalid` modifier",
);
ok("in-tag recovery marks only the bad tail Invalid and resyncs at the close");

// And it is genuinely forgiving across several breakages.
for (const bad of ["{{", "{{ x", "{{#each", "before {{!{{ after {{ y }}", "{{{ z"]) {
  const r = lex(bad);
  assert.ok(Array.isArray(r) && r.length >= 1, `recovers on: ${JSON.stringify(bad)}`);
}
ok("recovers on a range of malformed inputs");

// DIAGNOSTICS from the same recovering pass: every Invalid token → an LSP
// Diagnostic with a 0-based range and a message.
console.log("\n— diagnostics (publishDiagnostics) —");
const DIAG = "{{ a ; b }}\nfine {{ c }}\n{{!-- never closed";
for (const d of diagnostics(DIAG)) {
  console.log(
    `  ${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}  ${d.message}`,
  );
}

const diags = diagnostics(DIAG);
assert.ok(diags.length >= 2, "reports a diagnostic per malformed span");
assert.ok(diags.every((d) => d.severity === 1 && d.source === "flatbars-lexer-lab"), "Error severity + source");
assert.ok(
  diags.some((d) => d.message === "unterminated comment"),
  "the unterminated comment carries the reader's message",
);
assert.ok(
  diags.some((d) => /unexpected input|unterminated tag/.test(d.message)),
  "the malformed tag interior carries a message",
);
assert.ok(
  diags.every((d) => d.range.start.line >= 0 && d.range.start.character >= 0),
  "ranges are 0-based LSP positions",
);
ok("diagnostics: each Invalid span becomes an LSP Diagnostic (range + message)");

console.log("\nall lsp-wiring assertions passed");
