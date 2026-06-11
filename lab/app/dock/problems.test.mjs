// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Problems dock panel (Phase 0, last dock tab). Run:
// node lab/app/dock/problems.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", attrs: {}, title: "", children: [], _click: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    addEventListener(ev, fn) { if (ev === "click") this._click = fn; },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : (c && c.children ? c.text : "")))).join("");
    },
  };
}
globalThis.document = { createElement: (t) => fakeNode(t), createTextNode: (s) => ({ text: s }) };

const { renderProblems } = await import("./problems.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const noop = { openOrCreatePartial() {}, openProblem() {} };
const prob = (over) => ({ severity: "error", message: "boom", file: "main", line: 1, col: 1, ...over });

test("renderProblems shows the clean empty state with no problems", () => {
  const body = fakeNode("div");
  renderProblems(body, [], noop);
  assert.equal(allByClass(body, "problem-empty").length, 1);
  assert.equal(allByClass(body, "problem").length, 0);
});

test("severity maps cap/missing→cap, render→render, else error; with the source label", () => {
  const body = fakeNode("div");
  renderProblems(body, [prob({ severity: "cap" }), prob({ severity: "missing" }), prob({ severity: "render" }), prob({ severity: "x" })], noop);
  assert.equal(allByClass(body, "cap").length, 2, "cap + missing both render as cap");
  assert.equal(allByClass(body, "render").length, 1);
  assert.equal(allByClass(body, "error").length, 1);
  assert.ok(allByClass(body, "src").some((n) => n.text === "missing assign"));
  assert.ok(allByClass(body, "src").some((n) => n.text === "capability"));
});

test("an unknown-partial problem grows a Create-partial button wired to openOrCreatePartial", () => {
  const created = [];
  const body = fakeNode("div");
  renderProblems(body, [prob({ message: 'unknown partial "row"' })],
    { ...noop, openOrCreatePartial: (n) => created.push(n) });
  const btns = allByClass(body, "problem-action");
  assert.equal(btns.length, 1);
  btns[0]._click({ stopPropagation() {} });
  assert.deepEqual(created, ["row"]);
});

test("clicking a problem row calls openProblem with the problem", () => {
  const calls = [];
  const body = fakeNode("div");
  const p = prob({ file: "card", line: 4, col: 2 });
  renderProblems(body, [p], { ...noop, openProblem: (x) => calls.push(x) });
  allByClass(body, "problem")[0]._click();
  assert.deepEqual(calls, [p]);
});
