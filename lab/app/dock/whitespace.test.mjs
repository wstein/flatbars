// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Whitespace dock panel (Phase 0). The browser smoke does
// not exercise the dock, so this is the panel's safety net. Run:
// node lab/app/dock/whitespace.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", style: { cssText: "" }, attrs: {}, title: "", children: [], _click: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(c) { this.children.push(c); },
    addEventListener(ev, fn) { if (ev === "click") this._click = fn; },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : (c && c.children ? c.text : "")))).join("");
    },
  };
}
globalThis.document = { createElement: (t) => fakeNode(t), createTextNode: (s) => ({ text: s }) };

const { renderWhitespace } = await import("./whitespace.mjs");

// Exact class-membership match (so "wt-row" does NOT also match the "wt-rows"
// container).
const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};

const noop = { openProblem() {}, standaloneOn: true };

test("renderWhitespace shows the empty state with no markers", () => {
  const body = fakeNode("div");
  renderWhitespace(body, [], noop);
  assert.equal(allByClass(body, "wt-empty").length, 1);
  assert.equal(allByClass(body, "wt-row").length, 0);
});

test("renderWhitespace renders one row per marker with kind classes and positions", () => {
  const rows = [
    { kind: "leading", file: "main", line: 1, col: 1 },
    { kind: "trailing", file: "main", line: 2, col: 9 },
    { kind: "standalone", file: "p", line: 3, col: 1, desc: "each", stripped: true },
  ];
  const body = fakeNode("div");
  renderWhitespace(body, rows, noop);
  const rowEls = allByClass(body, "wt-row");
  assert.equal(rowEls.length, 3);
  assert.ok(rowEls[0].className.includes("wt-leading"));
  assert.ok(rowEls[2].className.includes("wt-standalone"));
  assert.ok(allByClass(body, "wt-where").some((n) => n.text === "main:2:9"));
});

test("a row click calls openProblem with its file:line:col", () => {
  const calls = [];
  const body = fakeNode("div");
  renderWhitespace(body, [{ kind: "leading", file: "card", line: 7, col: 3 }],
    { openProblem: (p) => calls.push(p), standaloneOn: true });
  allByClass(body, "wt-row")[0]._click();
  assert.deepEqual(calls, [{ file: "card", line: 7, col: 3 }]);
});

test("the trim-off hint shows only when standalone lines are unstripped and the toggle is off", () => {
  const rows = [{ kind: "standalone", file: "p", line: 1, col: 1, desc: "if", stripped: false }];
  const off = fakeNode("div");
  renderWhitespace(off, rows, { openProblem() {}, standaloneOn: false });
  assert.equal(allByClass(off, "wt-hint").length, 1, "hint when toggle off");
  const on = fakeNode("div");
  renderWhitespace(on, rows, { openProblem() {}, standaloneOn: true });
  assert.equal(allByClass(on, "wt-hint").length, 0, "no hint when toggle on");
});
