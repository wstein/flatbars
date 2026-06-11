// SPDX-License-Identifier: Apache-2.0
//
// Test for the output subsystem factory (Phase 0). Verifies setOutput writes the
// caches, fans out to all five host callbacks, and drives the empty-state flag off
// the active view. Run: node lab/app/output.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

// Fake `.output-body` element so qs(".output-body").dataset.empty is observable.
const outputBody = { dataset: {} };
globalThis.document = { querySelector: (sel) => (sel === ".output-body" ? outputBody : null) };

const { createSetOutput } = await import("./output.mjs");

function harness(view = "source") {
  const ctx = { caches: { lastOutput: "", lastSegments: [], lastData: null, lastProgram: null } };
  const calls = [];
  const spy = (name) => () => calls.push(name);
  const setOutput = createSetOutput(ctx, {
    getOutputView: () => view,
    paintTextView: spy("paint"),
    renderPreview: spy("preview"),
    renderDock: spy("dock"),
    renderDataInspect: spy("inspect"),
    refreshSearchPanel: spy("search"),
  });
  return { ctx, calls, setOutput };
}

test("setOutput writes the output caches", () => {
  const { ctx, setOutput } = harness();
  const segs = [{ from: 0, to: 1 }];
  setOutput("hello", segs);
  assert.equal(ctx.caches.lastOutput, "hello");
  assert.equal(ctx.caches.lastSegments, segs);
});

test("setOutput defaults segments to an empty array", () => {
  const { ctx, setOutput } = harness();
  setOutput("x");
  assert.deepEqual(ctx.caches.lastSegments, []);
});

test("setOutput fans out to all five host refreshers", () => {
  const { calls, setOutput } = harness();
  setOutput("hi");
  assert.deepEqual(calls, ["paint", "preview", "dock", "inspect", "search"]);
});

test("setOutput drives .output-body[data-empty] off the active view's content", () => {
  const { setOutput } = harness("source");
  setOutput("non-empty");
  assert.equal(outputBody.dataset.empty, "false", "source view with output ⇒ not empty");
  setOutput("");
  assert.equal(outputBody.dataset.empty, "true", "source view, no output ⇒ empty");
});

test("the empty-state flag follows the view: bytecode needs a program, not output", () => {
  const { ctx, setOutput } = harness("bytecode");
  setOutput("ignored-for-bytecode");
  assert.equal(outputBody.dataset.empty, "true", "no lastProgram ⇒ empty under bytecode");
  ctx.caches.lastProgram = {};
  setOutput("still-ignored");
  assert.equal(outputBody.dataset.empty, "false", "lastProgram present ⇒ not empty");
});
