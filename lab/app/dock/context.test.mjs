// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Context Inspector panel (Phase 0) + its pure helpers.
// Run: node lab/app/dock/context.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", attrs: {}, style: { cssText: "" }, children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : (c && c.children ? c.text : "")))).join("");
    },
  };
}
globalThis.document = { createElement: (t) => fakeNode(t), createTextNode: (s) => ({ text: s }) };

const { renderContext, oneLineLabel, snapTitle, ctxSnippet, ctxType } = await import("./context.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};

// ── pure helpers ──────────────────────────────────────────────────────────────

test("oneLineLabel collapses whitespace and truncates with an ellipsis", () => {
  assert.equal(oneLineLabel("a\n  b\t c"), "a b c");
  assert.equal(oneLineLabel("x".repeat(80)).length, 61); // 60 + ellipsis
  assert.ok(oneLineLabel("x".repeat(80)).endsWith("…"));
});

test("snapTitle names loop iterations, falls back to #n", () => {
  assert.equal(snapTitle({ index: null }, 0), "#1");
  assert.equal(snapTitle({ index: 0 }, 0), "@index 0");
  assert.equal(snapTitle({ index: 2, key: "b" }, 5), "@index 2 · @key b");
});

test("ctxSnippet/ctxType render values and their type tags", () => {
  assert.equal(ctxSnippet(null), "—");
  assert.equal(ctxSnippet("hi"), '"hi"');
  assert.equal(ctxSnippet({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(ctxType(null), "null");
  assert.equal(ctxType([1, 2, 3]), "array(3)");
  assert.equal(ctxType("x"), "string");
});

// ── renderContext ─────────────────────────────────────────────────────────────

test("renderContext prompts to click when there is no target or program", () => {
  const body = fakeNode("div");
  renderContext(body, { ctxTarget: null, program: null, data: {}, inspectAt: () => [], minbarsCompat: false });
  assert.ok(allByClass(body, "ctx-hint")[0].text.includes("Click an expression"));
});

test("renderContext shows an inspect error without throwing", () => {
  const body = fakeNode("div");
  renderContext(body, {
    ctxTarget: { file: "main", start: 0, end: 1, label: "x" }, program: {}, data: {},
    inspectAt: () => { throw new Error("nope"); }, minbarsCompat: false,
  });
  assert.ok(allByClass(body, "ctx-hint")[0].text.includes("inspect error: nope"));
});

test("renderContext renders one snapshot card per snap with its scope rows", () => {
  const body = fakeNode("div");
  const snaps = [{ this: { a: 1 }, index: 0, key: "k", locals: { user: "Ada" } }];
  renderContext(body, {
    ctxTarget: { file: "main", start: 0, end: 1, label: "name" }, program: {}, data: {},
    inspectAt: () => snaps, minbarsCompat: false,
  });
  assert.ok(allByClass(body, "ctx-hint")[0].text.includes("1 snapshot at `name`"));
  assert.equal(allByClass(body, "ctx-snap").length, 1);
  // @this, @index, @key present (non-null), plus the local `user`
  const keys = allByClass(body, "key").map((n) => n.text);
  assert.ok(keys.includes("@this") && keys.includes("@index") && keys.includes("@key") && keys.includes("user"));
  // @parent/@root absent (null) ⇒ filtered out
  assert.ok(!keys.includes("@parent"));
});

test("renderContext notes a span that was never reached (empty snaps)", () => {
  const body = fakeNode("div");
  renderContext(body, {
    ctxTarget: { file: "main", start: 0, end: 1, label: "x" }, program: {}, data: {},
    inspectAt: () => [], minbarsCompat: false,
  });
  assert.ok(body.text.includes("never reached"));
});
