// SPDX-License-Identifier: Apache-2.0
//
// Test for the render root (Phase 0). A fake host drives run() through its
// branches — happy render, compile error, YAML error, transform error, allow-list
// denial, helper-pending, missing-assigns — the paths the browser smoke (happy
// path only) never exercises. Run: node lab/app/render.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { createRun } from "./render.mjs";

function mkHost(over = {}) {
  const { renderer: rover = {}, ...rest } = over;
  const ctx = { caches: {} };
  const calls = { setOutput: [], setError: [], renderDock: 0, saveHash: 0, requestHelperRender: [], updateDiagnostics: [] };
  const defaultRenderer = {
    compile: () => ({ program: { p: 1 } }),
    usedTransformers: () => [],
    requiredAssigns: () => [],
    parseAst: () => ({ ast: { nodes: [] } }),
    catalog: () => [],
    analyze: () => ({ ok: true, findings: [] }),
    lint: () => ({ ok: true, findings: [] }),
    render: () => ({ output: "OUT", segments: [{ from: 0, to: 3 }] }),
  };
  const defaults = {
    getYamlSrc: () => "a: 1",
    getTabs: () => [{ name: "main", source: "{{a}}" }],
    getActiveTabIdx: () => 0,
    getStandalone: () => true,
    getTransformSrc: () => "",
    getHelpersSrc: () => "",
    getCatalogSource: () => "",
    getAllowList: () => null,
    getEscapeMode: () => "",
    getMinbarsCompat: () => false,
    getLabLocale: () => "en",
    getLabPathSchema: () => [],
    getDataOverlays: () => [],
    getLoadedExampleIdx: () => -1,
    getHelperCache: () => ({ key: null, output: "", error: "" }),
    examples: [],
    ENGINE: "classicbars",
    partialsMap: () => ({}),
    fileSource: () => "{{a}}",
    engineHas: () => false,
    clearDiagnostics: () => {},
    setRecomputing: () => {},
    setRenderPending: () => {},
    refreshCoverageGutter: () => {},
    resetCaretLink: () => {},
    syncOutputToCaret: () => {},
    markCustom: () => {},
    debounce: (fn) => fn,
    loadYaml: () => ({ a: 1 }),
    jsonata: () => ({ evaluate: (d) => d }),
    spanRange: () => [0, 0],
    charToLineColumn: () => ({ line: 1, column: 1 }),
    mergeDataOverlays: (d) => ({ merged: d, clashes: [] }),
    analyseCalls: () => [],
    analyseEscapeRuns: () => ({}),
    analyseWhitespace: () => [],
    analyseDataAccess: () => [],
    analyseCoverage: () => [],
    buildDependencyGraph: () => ({}),
    buildCheatSheetData: (d) => d,
  };
  // Recorder spies — last, so a test override can't replace them by accident.
  const spies = {
    setError: (m) => calls.setError.push(m),
    setOutput: (...a) => calls.setOutput.push(a),
    renderDock: () => { calls.renderDock++; },
    saveHash: () => { calls.saveHash++; },
    updateDiagnostics: (d) => calls.updateDiagnostics.push(d),
    requestHelperRender: (k, req) => calls.requestHelperRender.push([k, req]),
  };
  const host = { ...defaults, ...rest, ...spies, renderer: { ...defaultRenderer, ...rover } };
  return { ctx, host, calls };
}
const last = (a) => a[a.length - 1];

test("happy path: compile → analyse → render → setOutput + timings", () => {
  const { ctx, host, calls } = mkHost();
  createRun(ctx, host).run();
  assert.deepEqual(last(calls.setOutput), ["OUT", [{ from: 0, to: 3 }]]);
  assert.equal(last(calls.setError), "");
  assert.deepEqual(ctx.caches.lastData, { a: 1 });
  assert.deepEqual(ctx.caches.lastProgram, { p: 1 });
  assert.ok(ctx.caches.lastTimings && typeof ctx.caches.lastTimings.totalMs === "number");
  assert.deepEqual(ctx.caches.dockProblems, []);
});

test("compile error: populates Problems, clears output, no program", () => {
  const { ctx, host, calls } = mkHost({ renderer: { compile: () => ({ errors: [{ file: "main", start: 0, end: 1, message: "bad tag" }] }) } });
  createRun(ctx, host).run();
  assert.equal(ctx.caches.lastProgram, null);
  assert.equal(ctx.caches.dockProblems.length, 1);
  assert.equal(ctx.caches.dockProblems[0].severity, "error");
  assert.ok(last(calls.setError).startsWith("compile error:"));
  assert.deepEqual(last(calls.setOutput), [""]);
});

test("YAML error: Problems row attributed to data.yaml, output cleared", () => {
  const { ctx, host, calls } = mkHost({ loadYaml: () => { throw Object.assign(new Error("bad yaml"), { mark: { line: 2, column: 3 } }); } });
  createRun(ctx, host).run();
  assert.equal(ctx.caches.dockProblems[0].file, "data.yaml");
  assert.equal(ctx.caches.dockProblems[0].line, 3); // mark.line + 1
  assert.ok(last(calls.setError).startsWith("invalid YAML:"));
  assert.deepEqual(last(calls.setOutput), [""]);
});

test("transform error: lastData nulled, Problems row for transform", () => {
  const { ctx, host, calls } = mkHost({
    getTransformSrc: () => "$bad",
    jsonata: () => ({ evaluate: () => { throw new Error("jsonata boom"); } }),
  });
  createRun(ctx, host).run();
  assert.equal(ctx.caches.lastData, null);
  assert.equal(ctx.caches.dockProblems[0].file, "transform");
  assert.ok(last(calls.setError).startsWith("transform error:"));
});

test("allow-list denial: cap Problem, output cleared, timings nulled, no render", () => {
  let rendered = false;
  const { ctx, host, calls } = mkHost({
    getAllowList: () => ["onlythis"],
    renderer: { usedTransformers: () => ["forbidden"], render: () => { rendered = true; return { output: "X", segments: [] }; } },
  });
  createRun(ctx, host).run();
  assert.equal(rendered, false, "render is refused");
  assert.equal(last(ctx.caches.dockProblems).severity, "cap");
  assert.equal(ctx.caches.lastTimings, null);
  assert.deepEqual(last(calls.setOutput), [""]);
});

test("helper-pending: requests an out-of-band render and shows rendering…", () => {
  const { ctx, host, calls } = mkHost({
    getHelpersSrc: () => "registerHelper('x', () => 1)",
    getHelperCache: () => ({ key: "STALE", output: "", error: "" }),
  });
  createRun(ctx, host).run();
  assert.equal(calls.requestHelperRender.length, 1, "kicked off the worker render");
  assert.deepEqual(last(calls.setOutput), ["rendering…"]);
  assert.equal(ctx.caches.lastTimings, null);
});

test("missing assigns: promoted to warn Problems rows", () => {
  const { ctx, host } = mkHost({ renderer: { requiredAssigns: () => ["missingKey"] } });
  createRun(ctx, host).run();
  assert.deepEqual(ctx.caches.lastMissingAssigns, ["missingKey"]);
  assert.ok(ctx.caches.dockProblems.some((p) => p.severity === "missing" && p.message.includes("missingKey")));
});

test("scheduleRun marks custom, sets the pending guard, and debounces run", () => {
  const flags = [];
  const { ctx, host } = mkHost({
    markCustom: () => flags.push("custom"),
    setRenderPending: (v) => flags.push("pending:" + v),
    setRecomputing: (v) => flags.push("recompute:" + v),
    debounce: (fn) => () => flags.push("debounced"),
  });
  createRun(ctx, host).scheduleRun();
  assert.deepEqual(flags, ["custom", "pending:true", "recompute:true", "debounced"]);
});
