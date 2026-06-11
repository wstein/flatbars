// SPDX-License-Identifier: Apache-2.0
//
// Test for the status bar (Phase 0). Run: node lab/app/statusbar.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";

const meta = { innerHTML: "" };
globalThis.document = { getElementById: (id) => (id === "status-meta" ? meta : null) };
const { createStatusBar, escapeHtml } = await import("./statusbar.mjs");

// A CM view whose caret sits at head=5 on line 2 (line starts at offset 3).
const fakeView = { state: { selection: { main: { head: 5 } }, doc: { lineAt: () => ({ from: 3, number: 2 }) } } };

function bar(over = {}) {
  return createStatusBar({
    getActiveView: () => "tmpl",
    getDataTab: () => "edit",
    isInspectTab: (n) => n === "context" || n === "ast",
    dataView: fakeView,
    templateView: fakeView,
    overlayByName: () => null,
    getDataFile: () => "data",
    getTemplateMode: () => "tmpl",
    activeTab: () => ({ name: "main" }),
    ...over,
  });
}

test("escapeHtml escapes &, <, >", () => {
  assert.equal(escapeHtml('a & b < c > d'), "a &amp; b &lt; c &gt; d");
});

test("template tab shows the active tab name + caret Ln/Col", () => {
  meta.innerHTML = "";
  bar()();
  assert.equal(meta.innerHTML, "<b>main · Ln 2, Col 3</b>"); // head 5 - from 3 + 1 = 3
});

test("inspector tab shows a read-only label, no caret", () => {
  meta.innerHTML = "";
  bar({ getActiveView: () => "data", getDataTab: () => "context" })();
  assert.equal(meta.innerHTML, "<b>Context Inspector</b>  ·  read-only");
  bar({ getActiveView: () => "data", getDataTab: () => "ast" })();
  assert.ok(meta.innerHTML.includes("Syntax Tree"));
});

test("config / catalog / transform / helpers filenames", () => {
  bar({ getActiveView: () => "config" })();
  assert.ok(meta.innerHTML.includes("config.yaml"));
  bar({ getActiveView: () => "catalog" })();
  assert.ok(meta.innerHTML.includes("catalog.yaml"));
  bar({ getTemplateMode: () => "transform" })();
  assert.ok(meta.innerHTML.includes("transform"));
  bar({ getTemplateMode: () => "helpers" })();
  assert.ok(meta.innerHTML.includes("helpers.js"));
});

test("data pane shows an overlay name or data.yaml", () => {
  bar({ getActiveView: () => "data", overlayByName: () => ({ name: "users/active" }) })();
  assert.ok(meta.innerHTML.includes("users/active.yaml"));
  bar({ getActiveView: () => "data", overlayByName: () => null })();
  assert.ok(meta.innerHTML.includes("data.yaml"));
});
