// SPDX-License-Identifier: Apache-2.0
//
// Tests for the DOM builder `makeEl` (Phase 0) against a hand-rolled fake
// document — interface only, no jsdom. byId/qs are trivial getElementById/
// querySelector wrappers and need no test. Run: node lab/app/dom.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", style: { cssText: "" }, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(c) { this.children.push(c); },
  };
}
globalThis.document = {
  createElement: (tag) => fakeNode(tag),
  createTextNode: (s) => ({ text: s }),
};

const { makeEl } = await import("./dom.mjs");

test("makeEl sets class and style via the fast path, others via setAttribute", () => {
  const n = makeEl("div", { class: "a b", style: "color:red", "data-x": "1", role: "alert" });
  assert.equal(n.tag, "div");
  assert.equal(n.className, "a b");
  assert.equal(n.style.cssText, "color:red");
  assert.deepEqual(n.attrs, { "data-x": "1", role: "alert" });
});

test("makeEl appends string children as text nodes and skips null/undefined", () => {
  const n = makeEl("span", {}, ["hi", null, undefined, "there"]);
  assert.deepEqual(n.children, [{ text: "hi" }, { text: "there" }]);
});

test("makeEl accepts a single (non-array) child and nested element children", () => {
  const child = makeEl("b", {}, "x");
  const n = makeEl("p", {}, child);
  assert.equal(n.children.length, 1);
  assert.equal(n.children[0], child, "element child appended as-is, not wrapped");
});
