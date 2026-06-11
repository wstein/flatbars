// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Truthiness dock panel (Phase 0, last dock panel). Run:
// node lab/app/dock/truthiness.test.mjs (in test:lab).

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

const { renderTruthiness } = await import("./truthiness.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const ok = (findings) => ({ ok: true, findings });
const noSchema = { suppressed: 0, pathSchema: [] };
const noop = { openProblem() {} };

test("renderTruthiness shows analyse-unavailable when not ok", () => {
  const body = fakeNode("div");
  renderTruthiness(body, { analyse: { ok: false, error: "boom" }, ...noSchema }, noop);
  assert.ok(allByClass(body, "cv-empty")[0].text.includes("boom"));
});

test("renderTruthiness shows the portable state with zero findings", () => {
  const body = fakeNode("div");
  renderTruthiness(body, { analyse: ok([]), ...noSchema }, noop);
  assert.ok(allByClass(body, "cv-empty")[0].text.includes("portable"));
});

test("renderTruthiness groups observed/potential/miss and emits a Fix hint per finding", () => {
  const findings = [
    { kind: "observed", tag: "if", value: "0", flips: ["mustache"], fix: "use `eq`", line: 1, column: 1 },
    { kind: "potential", tag: "if", value: '""', flips: ["mustache", "st4"], fix: "branch explicitly", line: 2, column: 3 },
    { kind: "miss", tag: "if", path: "user.age", value: "absent", fix: "check the key", line: 3, column: 5 },
  ];
  const body = fakeNode("div");
  renderTruthiness(body, { analyse: ok(findings), ...noSchema }, noop);
  assert.ok(allByClass(body, "cv-head")[0].text.includes("1 observed, 1 potential"));
  assert.ok(allByClass(body, "cv-head")[0].text.includes("1 miss"));
  assert.equal(allByClass(body, "cv-row").length, 3, "one row per finding");
  // flip labels are formatted from value + flips
  assert.ok(allByClass(body, "cv-label").some((n) => n.text.includes("tested 0 — flips under mustache")));
  assert.ok(allByClass(body, "cv-label").some((n) => n.text.includes("would diverge if it held")));
  // miss label intentionally wraps the path in backticks; the value is plain
  assert.ok(allByClass(body, "cv-label").some((n) => n.text === "`user.age` absent"));
});

test("a finding row click jumps to main:line:col", () => {
  const calls = [];
  const body = fakeNode("div");
  renderTruthiness(body, { analyse: ok([{ kind: "observed", tag: "if", value: "0", flips: ["x"], fix: "f", line: 7, column: 4 }]), ...noSchema },
    { openProblem: (p) => calls.push(p) });
  allByClass(body, "cv-row")[0]._click();
  assert.deepEqual(calls, [{ file: "main", line: 7, col: 4 }]);
});

test("the PathSchema hint appears with the suppressed count when a schema is active", () => {
  const body = fakeNode("div");
  renderTruthiness(body, { analyse: ok([]), suppressed: 2, pathSchema: ["user", "items"] }, noop);
  assert.ok(allByClass(body, "cv-hint").some((n) => n.text.includes("PathSchema active (2 suppressed)")));
});
