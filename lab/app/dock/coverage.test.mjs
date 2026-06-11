// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Coverage dock panel (Phase 0). The browser smoke does not
// exercise the dock. Run: node lab/app/dock/coverage.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", attrs: {}, title: "", children: [], _click: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(c) { this.children.push(c); },
    addEventListener(ev, fn) { if (ev === "click") this._click = fn; },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : (c && c.children ? c.text : "")))).join("");
    },
  };
}
globalThis.document = { createElement: (t) => fakeNode(t), createTextNode: (s) => ({ text: s }) };

const { renderCoverage } = await import("./coverage.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const deps = { rowPosition: () => ({ line: 1, column: 1 }), openProblem() {} };

test("renderCoverage shows the empty state when there are no blocks", () => {
  const body = fakeNode("div");
  renderCoverage(body, [], deps);
  assert.equal(allByClass(body, "cv-empty").length, 1);
  assert.equal(allByClass(body, "cv-row").length, 0);
});

test("renderCoverage renders a head summary + one row per block with executed/dead class", () => {
  const rows = [
    { kind: "if", label: "user.active", executed: true, start: 0, end: 5, file: "main" },
    { kind: "each", label: "items", executed: false, start: 10, end: 20, file: "main" },
  ];
  const body = fakeNode("div");
  renderCoverage(body, rows, { rowPosition: (r) => ({ line: r.start, column: 2 }), openProblem() {} });
  assert.ok(allByClass(body, "cv-head")[0].text.includes("2 blocks"));
  assert.ok(allByClass(body, "cv-head")[0].text.includes("1 executed"));
  const rowEls = allByClass(body, "cv-row");
  assert.equal(rowEls.length, 2);
  assert.ok(rowEls[0].className.includes("ok"));
  assert.ok(rowEls[1].className.includes("dead"));
  assert.ok(allByClass(body, "cv-where").some((n) => n.text === "main:10:2"));
});

test("a row click calls openProblem with the resolved position", () => {
  const calls = [];
  const body = fakeNode("div");
  renderCoverage(body, [{ kind: "with", label: "x", executed: true, start: 3, end: 4, file: "p" }],
    { rowPosition: () => ({ line: 9, column: 4 }), openProblem: (p) => calls.push(p) });
  allByClass(body, "cv-row")[0]._click();
  assert.deepEqual(calls, [{ file: "p", line: 9, col: 4 }]);
});
