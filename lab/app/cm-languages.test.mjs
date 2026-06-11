// SPDX-License-Identifier: Apache-2.0
//
// Tests for the extracted CodeMirror tokenizers (Phase 0, editors sub-slice).
// The token functions are pure, so we drive them with a hand-rolled fake
// StringStream implementing only the methods they touch (match / next / eol /
// sol / skipToEnd / eatSpace) — no CodeMirror, no DOM.
// Run with: node lab/app/cm-languages.test.mjs (also in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { jsonataToken, jsToken, bytecodeToken, JS_KEYWORDS, BC_KEYWORDS } from "./cm-languages.mjs";

// A minimal StringStream mirroring CodeMirror's anchored-at-pos semantics.
class FakeStream {
  constructor(str) { this.string = str; this.pos = 0; }
  eol() { return this.pos >= this.string.length; }
  sol() { return this.pos === 0; }
  next() { return this.pos < this.string.length ? this.string[this.pos++] : undefined; }
  skipToEnd() { this.pos = this.string.length; }
  match(pattern) {
    const rest = this.string.slice(this.pos);
    if (typeof pattern === "string") {
      if (rest.startsWith(pattern)) { this.pos += pattern.length; return pattern; }
      return null;
    }
    const m = rest.match(pattern);
    if (m && m.index === 0) { this.pos += m[0].length; return m; }
    return null;
  }
  eatSpace() {
    const m = this.string.slice(this.pos).match(/^\s+/);
    if (m) { this.pos += m[0].length; return true; }
    return false;
  }
}

// Classify the FIRST token of `src` under `token`.
const first = (token, src) => token(new FakeStream(src));

// ── JSONata ───────────────────────────────────────────────────────────────────

test("jsonataToken classifies the leading token", () => {
  assert.equal(first(jsonataToken, "$foo"), "keyword");
  assert.equal(first(jsonataToken, "$"), "keyword");
  assert.equal(first(jsonataToken, '"hi"'), "string");
  assert.equal(first(jsonataToken, "'hi'"), "string");
  assert.equal(first(jsonataToken, "123"), "number");
  assert.equal(first(jsonataToken, "-4.5e2"), "number");
  assert.equal(first(jsonataToken, "true"), "atom");
  assert.equal(first(jsonataToken, "name"), "variableName");
  assert.equal(first(jsonataToken, "+"), "operator");
  assert.equal(first(jsonataToken, "/* c */"), "comment");
});

// ── JS (custom helpers) ─────────────────────────────────────────────────────────

test("jsToken classifies the leading token", () => {
  assert.equal(first(jsToken, "// comment"), "comment");
  assert.equal(first(jsToken, "/* block */"), "comment");
  assert.equal(first(jsToken, "const"), "keyword");
  assert.equal(first(jsToken, "function"), "keyword");
  assert.equal(first(jsToken, "`tmpl`"), "string");
  assert.equal(first(jsToken, "undefined"), "atom");
  assert.equal(first(jsToken, "42"), "number");
  assert.equal(first(jsToken, "myVar"), "variableName");
  assert.equal(first(jsToken, "=>"), "operator");
});

test("JS_KEYWORDS only matches whole keywords at the start", () => {
  assert.ok(JS_KEYWORDS.test("return x"));
  assert.ok(!JS_KEYWORDS.test("returnish"), "no partial-word match");
  assert.ok(!JS_KEYWORDS.test("  const"), "anchored at start");
});

// ── Bytecode disassembly ────────────────────────────────────────────────────────

test("bytecodeToken classifies the leading token", () => {
  assert.equal(first(bytecodeToken, "EMIT_TEXT"), "keyword");
  assert.equal(first(bytecodeToken, "EACH"), "keyword");
  assert.equal(first(bytecodeToken, '"lit"'), "string");
  assert.equal(first(bytecodeToken, "7"), "number");
  assert.equal(first(bytecodeToken, "nil"), "atom");
  assert.equal(first(bytecodeToken, "lower"), "variableName");
  assert.equal(first(bytecodeToken, "; a header comment"), "comment");
});

test("BC_KEYWORDS matches EMIT_TEXT before EMIT (longest opcode wins)", () => {
  // EMIT_TEXT is listed before EMIT in the alternation, so the longer opcode is
  // consumed whole rather than leaving a stray _TEXT.
  const s = new FakeStream("EMIT_TEXT");
  assert.equal(bytecodeToken(s), "keyword");
  assert.equal(s.pos, "EMIT_TEXT".length, "consumed the whole opcode");
});
