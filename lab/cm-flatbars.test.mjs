// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the Lab's CodeMirror highlighting presenter. CodeMirror is
// stubbed (pure-Node), but the painter (lab/highlight-paint.mjs) drives the REAL
// engine `tokenize` from the committed bundle — so this pins the bundle →
// painter → presenter wiring. The painter is INNER-TOKEN (a faithful port of the
// LSP operation pass, drift-gated by scripts/check-paint-parity.mjs); these tests
// assert the presenter emits the `.tk-*` marks for that paint.

import { test } from "node:test";
import assert from "node:assert/strict";

import { flatbarsHighlight } from "./cm-flatbars.mjs";
import operationsJson from "../editors/operations.json" with { type: "json" };

const OPS = new Set(operationsJson.operations.map((o) => o.name));
const isOperation = (name) => OPS.has(name);

// Minimal CodeMirror doubles: `Decoration.mark(...).range(from,to)` records a
// classed range; `Decoration.set` returns the ranges; `ViewPlugin.fromClass`
// hands back the class + options so a test can drive `build` directly.
const Decoration = {
  mark: (spec) => ({ range: (from, to) => ({ from, to, class: spec.class }) }),
  set: (ranges) => ranges,
  none: [],
};
const ViewPlugin = { fromClass: (Cls, opts) => ({ Cls, opts }) };
const cm = { ViewPlugin, Decoration };
const fakeView = (text) => ({ state: { doc: { toString: () => text } } });

// flatbarsHighlight returns TWO layers — `[tokens, plates]` (the per-token colour
// set, then the whole-tag `tk-tag` plate set kept separate and returned LAST so CM
// nests the plate OUTSIDE the token marks). Flatten both layers for assertions.
function decorate(template, dialect) {
  const layers = flatbarsHighlight(cm, dialect, isOperation);
  const view = fakeView(template);
  return layers.flatMap((ext) => ext.opts.decorations(new ext.Cls(view)));
}
// (source slice → class) pairs, so assertions read by what the token IS.
const marks = (template, dialect) =>
  decorate(template, dialect).map((d) => [template.slice(d.from, d.to), d.class]);
const has = (m, text, cls) => m.some(([t, c]) => t === text && c === cls);

test("braces are tk-punct; block sigils + words are tk-keyword", () => {
  const m = marks("{{#if c}}{{/if}}", "maxbars");
  assert.ok(has(m, "{{", "tk-punct"), JSON.stringify(m));
  assert.ok(has(m, "#if", "tk-keyword"), JSON.stringify(m));
  assert.ok(has(m, "/if", "tk-keyword"), JSON.stringify(m));
  // the condition `c` is a default in-tag (bold) span, not coloured
  assert.ok(has(m, " c", "tk-in") || has(m, "c", "tk-in"), JSON.stringify(m));
});

test("a prelude helper is tk-operation; numbers tk-number; plain args default", () => {
  const m = marks("{{toFixed n 2}}", "maxbars");
  assert.ok(has(m, "toFixed", "tk-operation"), JSON.stringify(m));
  assert.ok(has(m, "2", "tk-number"), JSON.stringify(m));
  // a bare `{{name}}` is not a call → no operation mark
  assert.ok(!marks("{{name}}", "maxbars").some(([, c]) => c === "tk-operation"));
});

test("a pipe target and a subexpression head both paint as operations", () => {
  const m = marks("{{x | uppercase}}", "maxbars");
  assert.ok(has(m, "uppercase", "tk-operation"), JSON.stringify(m));
  const s = marks("{{count (pluck rows key)}}", "maxbars");
  assert.ok(has(s, "count", "tk-operation"), JSON.stringify(s)); // head
  assert.ok(has(s, "pluck", "tk-operation"), JSON.stringify(s)); // subexpr head
});

test("dialect-dependence: {{else}} in MinBars is a head operation (else is a registered op)", () => {
  // MinBars has no `else` clause → {{else}} is a value tag; `else` is in the
  // prelude, so it paints as an operation, exactly as the LSP does.
  assert.ok(has(marks("{{else}}", "minbars"), "else", "tk-operation"));
});

test("set-delimiter directive is tk-delim", () => {
  assert.ok(marks("{{=<% %>=}}", "minbars").some(([, c]) => c === "tk-delim"));
});

test("a dialect-disallowed shape is tk-error", () => {
  assert.ok(marks("{{&x}}", "maxbars").some(([, c]) => c === "tk-error"));
  // …but valid where the dialect allows it (MinBars raw) → no error
  assert.ok(!marks("{{&x}}", "minbars").some(([, c]) => c === "tk-error"));
});

test("an unterminated tag recovers to a tk-error decoration (ADR-023), not blank", () => {
  // The recovering lexer marks the orphan as `unterminated` (painted tk-error)
  // instead of dropping all highlighting.
  assert.ok(marks("{{oops", "fullbars").some(([, c]) => c === "tk-error"));
  // …and earlier valid tags stay painted: a {{name}} before the break still gets
  // its tk-tag plate, plus the broken tail is tk-error.
  const m = marks("Hi {{name}} more {{oops", "fullbars");
  assert.ok(m.some(([, c]) => c === "tk-error"), "the broken tail is tk-error");
  assert.ok(m.some(([, c]) => c === "tk-tag"), "the earlier {{name}} still gets a plate");
});

test("each whole tag gets ONE tk-tag plate over its full { … } range", () => {
  // The plate layer (returned last) marks each tag from first { to last } so it
  // reads as one pill, with the token marks nested inside.
  const tpl = "{{#each xs}}{{name}}{{/each}}";
  const plates = marks(tpl, "fullbars").filter(([, c]) => c === "tk-tag");
  assert.equal(plates.length, 3, JSON.stringify(plates)); // one per tag, not per token
  assert.deepEqual(
    plates.map(([t]) => t),
    ["{{#each xs}}", "{{name}}", "{{/each}}"],
  );
});
