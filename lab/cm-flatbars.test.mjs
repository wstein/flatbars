// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the shared FlatBars highlighting presenter (ADR-014). CodeMirror
// is stubbed (this is pure-Node), but `highlightSpans` is the REAL engine facade
// from the committed bundle — so this also pins the bundle → presenter wiring.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FLATBARS_KIND_CLASS, kindClass, flatbarsHighlight } from "./cm-flatbars.mjs";
import { highlightSpans } from "./vendor/flatbars-engine.mjs";

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

// Run a dialect's highlighter over a template, returning the decorations the
// plugin would expose (an array of `{ from, to, class }`).
function decorate(template, dialect) {
  const ext = flatbarsHighlight(cm, highlightSpans, dialect);
  const inst = new ext.Cls(fakeView(template));
  return ext.opts.decorations(inst);
}

// The tag highlighting now also emits dimmed `cm-hb-pn` delimiter marks nested in
// each tag; the kind-mapping tests below assert the TAG classes, so drop the pn
// marks (a dedicated test covers them).
const tagClasses = (decos) => decos.filter((d) => d.class !== "cm-hb-pn").map((d) => d.class);

test("kindClass maps every lexer kind, with an expr fallback", () => {
  assert.equal(kindClass("keyword"), "cm-hb-block");
  assert.equal(kindClass("block-open"), "cm-hb-block");
  assert.equal(kindClass("block-parent"), "cm-hb-inherit");
  assert.equal(kindClass("set-delimiter"), "cm-hb-delim");
  assert.equal(kindClass("error"), "cm-hb-error");
  assert.equal(kindClass("totally-unknown"), "cm-hb-expr");
  // every declared kind resolves to a class
  for (const k of Object.keys(FLATBARS_KIND_CLASS)) {
    assert.ok(kindClass(k).startsWith("cm-hb-"));
  }
});

test("{{else}} paints as a statement (block class) between open/close", () => {
  const tags = decorate("{{#if c}}{{else}}{{/if}}", "maxbars").filter((d) => d.class !== "cm-hb-pn");
  assert.deepEqual(
    tags.map((d) => d.class),
    ["cm-hb-block", "cm-hb-block", "cm-hb-block"],
  );
  // and the offsets are the engine's, not a regex's
  assert.deepEqual(tags.map((d) => [d.from, d.to]), [[0, 9], [9, 17], [17, 24]]);
});

test("dialect-dependence: {{else}} is plain interpolation in MinBars", () => {
  assert.deepEqual(tagClasses(decorate("{{else}}", "minbars")), ["cm-hb-expr"]);
});

test("set delimiters are stateful — only the engine gets the following tag right", () => {
  const tags = decorate("{{=<% %>=}}x<%y%>", "minbars").filter((d) => d.class !== "cm-hb-pn");
  assert.deepEqual(tags.map((d) => d.class), ["cm-hb-delim", "cm-hb-expr"]);
  assert.deepEqual(tags.map((d) => [d.from, d.to]), [[0, 11], [12, 17]]);
});

test("inheritance sigils and raw/comment get their own palette slots", () => {
  const decos = decorate("{{<base}}{{$title}}d{{/title}}{{/base}}{{{x}}}{{! c }}", "fullbars");
  assert.deepEqual(
    tagClasses(decos),
    ["cm-hb-inherit", "cm-hb-inherit", "cm-hb-block", "cm-hb-block", "cm-hb-raw", "cm-hb-comment"],
  );
});

test("MaxBars interior tokens punch through with their own classes", () => {
  // `+` is an operator span between expr (head-coloured) spans; a simple tag
  // stays one expr chunk.
  assert.deepEqual(
    tagClasses(decorate("{{ a + b }}", "maxbars")),
    ["cm-hb-expr", "cm-hb-op", "cm-hb-expr"],
  );
  assert.deepEqual(tagClasses(decorate("{{name}}", "maxbars")), ["cm-hb-expr"]);
});

test("a tag's {{ }} delimiters get dimmed cm-hb-pn marks, nested in the tag", () => {
  // {{name}} → the tag mark plus a pn mark over `{{` and over `}}`.
  const decos = decorate("{{name}}", "fullbars");
  assert.deepEqual(
    decos.map((d) => [d.class, d.from, d.to]),
    [["cm-hb-expr", 0, 8], ["cm-hb-pn", 0, 2], ["cm-hb-pn", 6, 8]],
  );
  // triple-stash dims all three braces each side
  const raw = decorate("{{{x}}}", "fullbars").filter((d) => d.class === "cm-hb-pn");
  assert.deepEqual(raw.map((d) => [d.from, d.to]), [[0, 3], [4, 7]]);
  // a custom-delimiter tag keeps its full colour (only `{{`-style dims)
  const custom = decorate("{{=<% %>=}}<%y%>", "minbars").filter((d) => d.class === "cm-hb-pn");
  assert.deepEqual(custom.map((d) => [d.from, d.to]), [[0, 2], [9, 11]]);
});

test("a lex error degrades to no decorations", () => {
  assert.deepEqual(decorate("{{oops", "fullbars"), []);
});
