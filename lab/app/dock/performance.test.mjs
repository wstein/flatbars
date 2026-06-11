// SPDX-License-Identifier: Apache-2.0
//
// Test for the Performance dock panel (Phase 0, first dock migration). The
// browser smoke does NOT exercise this panel, so this DOM-fake test is its
// safety net. Run: node lab/app/dock/performance.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

// Fake document for makeEl (imported transitively by performance.mjs). Nodes
// record class + flattened text so the test can assert structure without a DOM.
function fakeNode(tag) {
  return {
    tag, className: "", style: { cssText: "" }, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(c) { this.children.push(c); },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : ""))).join("");
    },
  };
}
globalThis.document = {
  createElement: (tag) => fakeNode(tag),
  createTextNode: (s) => ({ text: s }),
};

const { renderPerformance } = await import("./performance.mjs");

// Collect every descendant node with the given class.
function allByClass(node, cls, acc = []) {
  if (node.className === cls) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
}

test("renderPerformance shows the empty state before any run", () => {
  const body = fakeNode("div");
  renderPerformance(body, null);
  const empty = allByClass(body, "pf-empty");
  assert.equal(empty.length, 1);
  assert.equal(empty[0].text, "No run yet.");
  assert.equal(allByClass(body, "pf-grid").length, 0, "no grid without timings");
});

test("renderPerformance renders one grid with the four phase rows", () => {
  const body = fakeNode("div");
  renderPerformance(body, { parseMs: 1, compileMs: 2, renderMs: 3, totalMs: 6, outBytes: 1234 });
  assert.equal(allByClass(body, "pf-grid").length, 1);
  // 4 rows × 3 cells; check the value cells are formatted "N.NN ms"
  const vals = allByClass(body, "pf-v").map((n) => n.text);
  assert.deepEqual(vals, ["1.00 ms", "2.00 ms", "3.00 ms", "6.00 ms"]);
  // outBytes is localised into the Render row's sub cell
  assert.ok(allByClass(body, "pf-sub").some((n) => n.text.includes("1,234 bytes")));
  assert.equal(allByClass(body, "pf-warn").length, 0, "no warning under 100 ms");
});

test("renderPerformance warns when the total run exceeds 100 ms", () => {
  const body = fakeNode("div");
  renderPerformance(body, { parseMs: 90, compileMs: 10, renderMs: 5, totalMs: 105, outBytes: 0 });
  assert.equal(allByClass(body, "pf-warn").length, 1);
});
