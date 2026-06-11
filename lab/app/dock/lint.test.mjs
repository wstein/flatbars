// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Lint dock panel (Phase 0). Run:
// node lab/app/dock/lint.test.mjs (in test:lab).

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

const { renderLint } = await import("./lint.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const noop = { openProblem() {} };

test("renderLint shows unavailable when the template did not parse", () => {
  const body = fakeNode("div");
  renderLint(body, { ok: false, error: "parse fail" }, noop);
  assert.ok(allByClass(body, "cv-empty")[0].text.includes("parse fail"));
});

test("renderLint shows the all-canonical state with zero findings", () => {
  const body = fakeNode("div");
  renderLint(body, { ok: true, findings: [] }, noop);
  assert.ok(allByClass(body, "cv-empty")[0].text.includes("canonical"));
  assert.ok(allByClass(body, "cv-head")[0].text.includes("0 canonicalization findings"));
});

test("renderLint renders one row per finding with stripped message + kind fallback", () => {
  const findings = [
    { name: "alias", message: "use `index0` not `index`", line: 1, column: 2 },
    { severity: "warning", message: "legacy scoped var", line: 3, column: 4 },
  ];
  const body = fakeNode("div");
  renderLint(body, { ok: true, findings }, noop);
  assert.equal(allByClass(body, "cv-row").length, 2);
  // f.name preferred, else f.severity
  assert.ok(allByClass(body, "cv-kind").some((n) => n.text === "alias"));
  assert.ok(allByClass(body, "cv-kind").some((n) => n.text === "warning"));
  // backticks stripped from the message
  assert.ok(allByClass(body, "cv-label").some((n) => n.text === "use index0 not index"));
});

test("a lint row click jumps to main:line:col", () => {
  const calls = [];
  const body = fakeNode("div");
  renderLint(body, { ok: true, findings: [{ name: "x", message: "m", line: 9, column: 1 }] },
    { openProblem: (p) => calls.push(p) });
  allByClass(body, "cv-row")[0]._click();
  assert.deepEqual(calls, [{ file: "main", line: 9, col: 1 }]);
});
