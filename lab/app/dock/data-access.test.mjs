// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Data Access dock panel (Phase 0). Run:
// node lab/app/dock/data-access.test.mjs (in test:lab).

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

const { renderDataAccess, dxSnippet } = await import("./data-access.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const noCaches = { rows: [], requiredAssigns: [], missingAssigns: [] };
const deps = { rowPosition: () => ({ line: 1, column: 1 }), openProblem() {}, saveAsVector() {} };

test("dxSnippet previews nil/string/object/scalar and truncates to 60 chars", () => {
  assert.equal(dxSnippet(null), "nil");
  assert.equal(dxSnippet(undefined), "nil");
  assert.equal(dxSnippet("hi"), '"hi"');
  assert.equal(dxSnippet(42), "42");
  assert.equal(dxSnippet({ a: 1 }), '{"a":1}');
  assert.equal(dxSnippet("x".repeat(100)).length, 60);
});

test("renderDataAccess shows the empty state with no lookups", () => {
  const body = fakeNode("div");
  renderDataAccess(body, noCaches, deps);
  assert.equal(allByClass(body, "dx-empty").length, 1);
  assert.equal(allByClass(body, "dx-row").length, 0);
});

test("renderDataAccess renders the required-assigns contract, flagging missing keys", () => {
  const body = fakeNode("div");
  renderDataAccess(body, { rows: [], requiredAssigns: ["user", "items"], missingAssigns: ["items"] }, deps);
  const assigns = allByClass(body, "dx-assign");
  assert.equal(assigns.length, 2);
  assert.ok(assigns.some((n) => n.className.includes("missing")), "missing key flagged");
  assert.equal(allByClass(body, "dx-contract-warn").length, 1);
});

test("renderDataAccess renders rows; non-hit rows get a Save-vector button wired to saveAsVector", () => {
  const saved = [];
  const rows = [
    { status: "hit", path: "user.name", value: "Ada", file: "main", start: 0, end: 3 },
    { status: "miss", path: "user.age", file: "main", start: 5, end: 8 },
  ];
  const body = fakeNode("div");
  renderDataAccess(body, { rows, requiredAssigns: [], missingAssigns: [] },
    { ...deps, saveAsVector: (r) => saved.push(r.path) });
  assert.equal(allByClass(body, "dx-row").length, 2);
  // value preview only on the hit row
  assert.ok(allByClass(body, "dx-val").some((n) => n.text === '"Ada"'));
  // exactly one Save-vector button (the miss row); clicking it calls saveAsVector
  const saves = allByClass(body, "dx-save");
  assert.equal(saves.length, 1);
  saves[0]._click({ stopPropagation() {} });
  assert.deepEqual(saved, ["user.age"]);
});

test("clicking a row jumps to its source position", () => {
  const calls = [];
  const body = fakeNode("div");
  renderDataAccess(body, { rows: [{ status: "miss", path: "x", file: "p", start: 1, end: 2 }], requiredAssigns: [], missingAssigns: [] },
    { rowPosition: () => ({ line: 4, column: 2 }), openProblem: (p) => calls.push(p), saveAsVector() {} });
  allByClass(body, "dx-row")[0]._click();
  assert.deepEqual(calls, [{ file: "p", line: 4, col: 2 }]);
});
