// SPDX-License-Identifier: Apache-2.0
//
// Test for the output subsystem factory (Phase 0). A fake host lets us drive the
// whole cluster (setOutput / paintTextView / renderPreview / setOutputDoc /
// buildProvenance) offline — covering the bytecode/data/compiled views the
// browser smoke never opens. Run: node lab/app/output.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

function harness(view = "source") {
  const calls = [];
  let editorDoc = "";
  const frame = {
    _a: {}, srcdoc: null,
    getAttribute(k) { return k in this._a ? this._a[k] : null; },
    setAttribute(k, v) { this._a[k] = v; },
  };
  const outputBody = { dataset: {} };
  globalThis.document = {
    querySelector: (s) => (s === ".output-body" ? outputBody : null),
    getElementById: (id) => (id === "output-preview" ? frame : null),
  };
  const outputEditor = {
    state: { doc: { toString: () => editorDoc } },
    dispatch: (tr) => { if (tr.changes && tr.changes.insert !== undefined) editorDoc = tr.changes.insert; },
  };
  const Decoration = {
    none: "NONE",
    mark: () => ({ range: (f, t) => ({ f, t }) }),
    set: (ranges) => ({ ranges }),
  };
  const ctx = { caches: { lastOutput: "", lastSegments: [], lastData: null, lastProgram: null, lastSegViews: [] } };
  const host = {
    getView: () => view,
    getMinbarsCompat: () => true,
    getAllowScripts: () => false,
    renderer: {
      compileToJs: () => ({ ok: true, value: "COMPILED_JS" }),
      migrate: () => ({ ok: true, source: "MIGRATED", residuals: [] }),
    },
    outputEditor, Decoration,
    setProvenance: { of: (v) => ({ prov: v }) },
    setOutLink: { of: (v) => ({ link: v }) },
    renderDock: () => calls.push("dock"),
    renderDataInspect: () => calls.push("inspect"),
    refreshSearchPanel: () => calls.push("search"),
    updateOutLang: () => calls.push("lang"),
    templateSourceFor: () => "TPL",
    partialsMap: () => ({}),
    resetCaretLink: () => calls.push("resetCaret"),
    disassemble: (p) => "DISASM:" + p.tag,
    dumpYaml: (d) => "YAML:" + JSON.stringify(d),
    marked: { parse: (s) => "MD<" + s + ">" },
    segmentRanges: (out, segs) => segs.map((s) => ({ from: s.from, to: s.to, kind: s.kind })),
  };
  return { ctx, host, calls, frame, outputBody, getEditorDoc: () => editorDoc };
}

const make = async (h) => (await import("./output.mjs")).createOutputView(h.ctx, h.host);

test("setOutput writes caches, paints, and fans out in order", async () => {
  const h = harness("source");
  const { setOutput } = await make(h);
  setOutput("hello", [{ from: 0, to: 2, kind: "emit" }]);
  assert.equal(h.ctx.caches.lastOutput, "hello");
  assert.equal(h.getEditorDoc(), "hello", "source view paints lastOutput into the editor");
  assert.deepEqual(h.calls, ["resetCaret", "lang", "dock", "inspect", "search"]);
  assert.equal(h.outputBody.dataset.empty, "false");
});

test("paintTextView routes bytecode → disassemble(lastProgram)", async () => {
  const h = harness("bytecode");
  const { paintTextView } = await make(h);
  h.ctx.caches.lastProgram = { tag: "PROG" };
  paintTextView();
  assert.equal(h.getEditorDoc(), "DISASM:PROG");
  assert.deepEqual(h.ctx.caches.lastSegViews, [], "non-source views clear segviews");
});

test("paintTextView routes data → dumpYaml(lastData)", async () => {
  const h = harness("data");
  const { paintTextView } = await make(h);
  h.ctx.caches.lastData = { a: 1 };
  paintTextView();
  assert.equal(h.getEditorDoc(), 'YAML:{"a":1}');
});

test("paintTextView routes compiled → renderer.compileToJs", async () => {
  const h = harness("compiled");
  const { paintTextView } = await make(h);
  paintTextView();
  assert.equal(h.getEditorDoc(), "COMPILED_JS");
});

test("paintTextView source view builds provenance segviews from segments", async () => {
  const h = harness("source");
  const { setOutput } = await make(h);
  setOutput("abcdef", [{ from: 0, to: 3, kind: "emit" }, { from: 3, to: 6, kind: "text" }]);
  assert.equal(h.ctx.caches.lastSegViews.length, 2);
  assert.equal(h.ctx.caches.lastSegViews[0].kind, "emit");
});

test("renderPreview sets the iframe srcdoc + sandbox; markdown view runs marked", async () => {
  const h = harness("markdown");
  const { renderPreview } = await make(h);
  h.ctx.caches.lastOutput = "# hi";
  renderPreview();
  assert.ok(h.frame.srcdoc.includes("MD<# hi>"), "markdown piped through marked.parse");
  assert.equal(h.frame.getAttribute("sandbox"), "allow-same-origin", "scripts off ⇒ same-origin sandbox");
});

test("buildProvenance returns empty deco for no segments", async () => {
  const h = harness();
  const { buildProvenance } = await make(h);
  assert.deepEqual(buildProvenance("x", []), { segViews: [], deco: "NONE" });
});
