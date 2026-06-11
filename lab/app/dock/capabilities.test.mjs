// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the Capabilities dock panel (Phase 0). Covers both engine
// branches (Handlebars profile vs Stem host policy). Run:
// node lab/app/dock/capabilities.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function fakeNode(tag) {
  return {
    tag, className: "", attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    get text() {
      return this.children.map((c) => (c && c.text !== undefined ? c.text : (typeof c === "string" ? c : (c && c.children ? c.text : "")))).join("");
    },
  };
}
globalThis.document = { createElement: (t) => fakeNode(t), createTextNode: (s) => ({ text: s }) };

const { renderCapabilities } = await import("./capabilities.mjs");

const allByClass = (node, cls, acc = []) => {
  if (node.className && node.className.split(" ").includes(cls)) acc.push(node);
  for (const c of node.children || []) if (c && c.children) allByClass(c, cls, acc);
  return acc;
};
const engineMeta = { version: "1.0", builtins: [1, 2, 3], bcVersion: "bc/v1" };
const base = { escapeRuns: { html: 2, plain: 1, raw: 0, total: 3 }, usedTransformers: [], engineMeta,
  escapeMode: "html", standalone: true, allowList: null };

test("Handlebars branch (no stem-allow-list) shows the HB profile + plain escape mix", () => {
  const body = fakeNode("div");
  renderCapabilities(body, { ...base, stemAllowList: false });
  assert.ok(allByClass(body, "cp-head")[0].text.includes("Handlebars security profile"));
  assert.equal(allByClass(body, "cp-policy-row").length, 7, "7 HB profile rows");
  assert.equal(allByClass(body, "cp-tiers").length, 0, "no Stem tier breakdown");
  assert.ok(allByClass(body, "cp-emit-row")[0].text.includes("3 emits"));
  assert.ok(!allByClass(body, "cp-emit-row")[0].text.includes("{{{"), "no tag hint on HB branch");
});

test("Stem branch shows host policy, allow-list states, and the tagged escape mix", () => {
  const body = fakeNode("div");
  renderCapabilities(body, { ...base, stemAllowList: true });
  assert.ok(allByClass(body, "cp-head")[0].text.includes("host policy snapshot"));
  // unconstrained allow-list ⇒ "ok"
  assert.ok(allByClass(body, "cp-policy-v").some((n) => n.text.includes("unconstrained")));
  assert.ok(allByClass(body, "cp-emit-row")[0].text.includes("{{{"), "tag hint on Stem branch");
});

test("allow-list states: null=unconstrained, []=EMPTY/warn, [names]=callable", () => {
  for (const [allowList, needle] of [[null, "unconstrained"], [[], "EMPTY"], [["upcase", "trim"], "2 names callable"]]) {
    const body = fakeNode("div");
    renderCapabilities(body, { ...base, stemAllowList: true, allowList });
    assert.ok(allByClass(body, "cp-policy-v").some((n) => n.text.includes(needle)), needle);
  }
});

test("eval reference flips the Eval row to danger", () => {
  const body = fakeNode("div");
  renderCapabilities(body, { ...base, stemAllowList: true, usedTransformers: ["eval", "upcase"] });
  assert.ok(allByClass(body, "danger").some((n) => n.text.includes("REFERENCED")));
});

test("risk tiers roll up usedTransformers via TRANSFORMER_RISK; unknown → host", () => {
  const body = fakeNode("div");
  // upcase=format, map=transform, mystery=host(unknown)
  renderCapabilities(body, { ...base, stemAllowList: true, usedTransformers: ["upcase", "map", "mystery"] });
  assert.ok(allByClass(body, "cp-risk-format").length === 1);
  assert.ok(allByClass(body, "cp-risk-transform").length === 1);
  assert.ok(allByClass(body, "cp-risk-host").length === 1);
  assert.equal(allByClass(body, "cp-empty").length, 0, "tiers present ⇒ no empty note");
});

test("raw emits trigger the escape warning", () => {
  const body = fakeNode("div");
  renderCapabilities(body, { ...base, stemAllowList: true, escapeRuns: { html: 1, plain: 0, raw: 2, total: 3 } });
  assert.equal(allByClass(body, "cp-warn").length, 1);
});
