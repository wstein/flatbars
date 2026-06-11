// SPDX-License-Identifier: Apache-2.0
//
// Test for the Differential dock panel (Phase 7) — the verdict + diff logic and the
// pure renderer. Run: node lab/app/dock/differential.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { renderDifferential, verdictOf, firstDiff } from "./differential.mjs";

// A fake makeEl(tag, attrs, children) → a node we can introspect.
function makeEl(tag, attrs = {}, children = []) {
  const node = {
    tag, className: attrs.class || "", attrs, children: [], _click: null,
    append(...cs) { for (const c of cs) this.children.push(c); },
    addEventListener(ev, fn) { if (ev === "click") this._click = fn; },
    get text() {
      return this.children.map((c) => (typeof c === "string" ? c : c && c.text !== undefined ? c.text : "")).join("");
    },
  };
  for (const c of children) node.append(c);
  return node;
}
const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const body = () => makeEl("div");

test("verdictOf: match / diverge / n-a", () => {
  assert.equal(verdictOf({ output: "x" }, { output: "x" }), "match");
  assert.equal(verdictOf({ output: "x" }, { output: "y" }), "diverge");
  assert.equal(verdictOf({ output: "x" }, { error: "boom" }), "na");
  assert.equal(verdictOf({ error: "no ref" }, { output: "x" }), "na");
});

test("firstDiff locates the first differing byte with context", () => {
  assert.deepEqual(firstDiff("hello", "hello"), { index: -1 });
  const d = firstDiff("Greeting: Ada", "Greeting: Bob");
  assert.equal(d.index, 10);
  assert.ok(d.refSnippet.includes("Ada") && d.candSnippet.includes("Bob"));
  // a length difference also diverges
  assert.notEqual(firstDiff("ab", "abc").index, -1);
});

test("renderDifferential shows the comparing state until ready", () => {
  const b = body();
  renderDifferential(b, { ready: false }, { makeEl });
  assert.match(b.text, /Comparing engines/);
});

test("a matching candidate renders green, no report button", () => {
  const b = body();
  const model = {
    ready: true, dialect: "maxbars",
    reference: { id: "oracle", label: "Reference", output: "Hi Ada" },
    candidates: [{ id: "trussbars", label: "Trussbars", output: "Hi Ada", verdict: "match" }],
  };
  let reported = false;
  renderDifferential(b, model, { makeEl, onReport: () => (reported = true) });
  assert.ok(allByClass(b, "diff-match").length, "a match row is rendered");
  assert.ok(b.text.includes("byte-identical"));
  assert.equal(allByClass(b, "diff-report").length, 0, "no report button for a match");
  assert.equal(reported, false);
});

test("a diverging candidate shows the first difference + a working report button", () => {
  const b = body();
  const model = {
    ready: true, dialect: "maxbars",
    reference: { id: "oracle", label: "Reference", output: "Greeting: Ada" },
    candidates: [{ id: "trussbars", label: "Trussbars", output: "Greeting: Bob", verdict: "diverge" }],
  };
  const reported = [];
  renderDifferential(b, model, { makeEl, onReport: (c) => reported.push(c.id) });
  assert.ok(allByClass(b, "diff-diverge").length, "a diverge row is rendered");
  assert.ok(b.text.includes("First difference at byte 10"));
  const btn = allByClass(b, "diff-report")[0];
  assert.ok(btn, "the report-divergence button is present");
  btn._click();
  assert.deepEqual(reported, ["trussbars"], "clicking report fires onReport with the candidate");
});

test("an n/a candidate (engine can't render the surface) is neutral, not flagged", () => {
  const b = body();
  const model = {
    ready: true, dialect: "classicbars",
    reference: { id: "oracle", label: "Reference", output: "x" },
    candidates: [{ id: "trussbars", label: "Trussbars", error: "parse error", verdict: "na" }],
  };
  renderDifferential(b, model, { makeEl, onReport: () => {} });
  assert.ok(allByClass(b, "diff-na").length, "an n/a row is rendered");
  assert.equal(allByClass(b, "diff-report").length, 0, "no report button for n/a");
  assert.ok(b.text.includes("n/a"));
});
