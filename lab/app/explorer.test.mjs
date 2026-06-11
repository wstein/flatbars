// SPDX-License-Identifier: Apache-2.0
//
// DOM-fake test for the file explorer (Phase 0). The browser smoke renders the
// explorer on boot (integration), but not its rename/collapse/delete wiring — this
// covers the tree structure, the row-click → selectTemplateTab handler, the delete
// button, and the collapse toggle. Run: node lab/app/explorer.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

// ── Minimal fake DOM (interface only) ─────────────────────────────────────────
function makeNode(tag) {
  return {
    tag, className: "", textContent: "", title: "", hidden: false, tabIndex: undefined,
    dataset: {}, children: [], _on: {}, _expFile: undefined, _html: "",
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    addEventListener(ev, fn) { (this._on[ev] ||= []).push(fn); },
    fire(ev, arg) { for (const fn of this._on[ev] || []) fn(arg || { stopPropagation() {}, preventDefault() {} }); },
    replaceWith() {}, focus() {}, select() {},
    querySelector(sel) { return descend(this).find((n) => matches(n, sel)) || null; },
    querySelectorAll(sel) { return descend(this).filter((n) => matches(n, sel)); },
  };
}
const matches = (n, sel) => sel.replace(/^\./, "").split(".").every((c) => (n.className || "").split(" ").includes(c));
const descend = (n, acc = []) => { for (const c of n.children || []) { if (c && c.children) { acc.push(c); descend(c, acc); } } return acc; };
const allRows = (tree, cls) => descend(tree).filter((n) => (n.className || "").split(" ").includes(cls));

function harness(over = {}) {
  const tree = makeNode("div");
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  // navigator is a read-only Node global; IS_MAC (rename keys) is irrelevant here.
  globalThis.document = { createElement: (t) => makeNode(t) };
  const calls = [];
  const spy = (name) => (...a) => calls.push([name, ...a]);
  const ctx = { state: {
    tabs: [{ name: "main", source: "x" }, { name: "row", source: "{{name}}" }],
    activeTabIdx: 0, activeView: "tmpl", dataTab: "edit", dataFile: "data",
    dataOverlays: [{ name: "extra", source: "a: 1" }],
    yamlDirty: false, transformDirty: false, helpersDirty: false, catalogDirty: false,
    escapeMode: "", standalone: true, allowList: null, openEditors: ["main"],
  } };
  const host = {
    selectTemplateTab: spy("selectTemplateTab"), addPartial: spy("addPartial"), removeTab: spy("removeTab"),
    selectDataTab: spy("selectDataTab"), addOverlay: spy("addOverlay"), removeOverlay: spy("removeOverlay"),
    selectTransformTab: spy("selectTransformTab"), selectHelpersTab: spy("selectHelpersTab"),
    selectCatalogTab: spy("selectCatalogTab"), selectConfigTab: spy("selectConfigTab"),
    closeEditor: spy("closeEditor"), overlayByName: (n) => ctx.state.dataOverlays.find((o) => o.name === n),
    markCustom: spy("markCustom"), scheduleRun: spy("scheduleRun"), validateOverlayName: () => null,
    getTemplateMode: () => "tmpl", TEMPLATE_EXT: "hbs", ENGINE: "classicbars",
    ...over,
  };
  return { tree, ctx, host, calls };
}

const make = async (h) => {
  globalThis.byIdTree = h.tree;
  // byId("explorer-tree") must return the tree; everything else null.
  globalThis.document.getElementById = (id) => (id === "explorer-tree" ? h.tree : null);
  const { createExplorer } = await import("./explorer.mjs");
  return createExplorer(h.ctx, h.host);
};

test("renderExplorer builds the group tree from ctx.state", async () => {
  const h = harness();
  const ex = await make(h);
  ex.renderExplorer();
  // a group header per group (template/partials/data/overlays/transform/helpers/
  // localization/config for classicbars — labels live in innerHTML, the headers are
  // real nodes).
  assert.equal(allRows(h.tree, "exp-gh").length, 8);
  // a row for main + the `row` partial + data.yaml + the `extra` overlay
  const names = allRows(h.tree, "exp-name").map((n) => n.textContent);
  assert.ok(names.includes("main.hbs"), names);
  assert.ok(names.includes("row.hbs"), names);
  assert.ok(names.includes("data.yaml"));
  assert.ok(names.includes("extra.yaml"));
});

test("clicking a partial row selects its template tab", async () => {
  const h = harness();
  const ex = await make(h);
  ex.renderExplorer();
  const rows = allRows(h.tree, "exp-row");
  // main is row 0 of TEMPLATE; the partial `row` is in PARTIALS — click it.
  const partial = rows.find((r) => descend(r).some((n) => n.textContent === "row.hbs"));
  partial.fire("click");
  assert.ok(h.calls.some(([n, i]) => n === "selectTemplateTab" && i === 1), JSON.stringify(h.calls));
});

test("a partial row has a delete button wired to removeTab", async () => {
  const h = harness();
  const ex = await make(h);
  ex.renderExplorer();
  const del = allRows(h.tree, "exp-del")[0];
  assert.ok(del, "partials get a delete button");
  del.fire("click");
  assert.ok(h.calls.some(([n]) => n === "removeTab"));
});

test("toggling a group header collapses it and persists", async () => {
  const h = harness();
  const ex = await make(h);
  ex.renderExplorer();
  const gh = allRows(h.tree, "exp-gh")[1]; // PARTIALS header
  gh.fire("click");
  assert.equal(globalThis.localStorage.getItem("stem.explorer.collapsed") !== null, true, "collapse persisted");
});
