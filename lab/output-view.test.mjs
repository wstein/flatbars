// SPDX-License-Identifier: Apache-2.0
//
// DOM test harness for the Lab's output-view system (ADR-022 follow-up). Two of
// the three layers from docs/playground-smoke.md, both offline + zero-dependency:
//
//   1. DECISION — viewKind / visibleViews / validView / analyseText (pure).
//   2. WIRING   — applyView against a hand-rolled fake `document` (no jsdom, no
//      browser): we stub the DOM *interface* the code touches (`.hidden`), NOT
//      layout or CodeMirror. Layer 3 (pixels) is the manual checklist.
//
// Run with: node --test output-view.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_TABS,
  visibleViews,
  validView,
  viewKind,
  analyseText,
  applyView,
} from "./output-view.mjs";

// A FlatBars-shaped feature vector (mirrors flatbars.mjs BB_FEATURES, trimmed).
const FB = ["surface-dialect", "core-dialect", "compile-js", "analyse"];
// An engine without the analyse capability (e.g. a minimal/other engine).
const NO_ANALYSE = ["surface-dialect", "core-dialect"];

// ── Layer 1: decision ───────────────────────────────────────────────────────

test("viewKind: text views paint the editor, previews use the iframe", () => {
  for (const v of ["source", "data", "bytecode", "st4", "compiled", "analyse"]) {
    assert.equal(viewKind(v), "text", `${v} should be a text view`);
  }
  for (const v of ["rendered", "markdown"]) {
    assert.equal(viewKind(v), "preview", `${v} should be a preview view`);
  }
});

test("every VIEW_TABS entry has a defined kind (no unhandled view)", () => {
  for (const t of VIEW_TABS) {
    assert.ok(viewKind(t.view) === "text" || viewKind(t.view) === "preview", t.view);
  }
});

test("visibleViews gates the Truthiness view on the analyse capability", () => {
  assert.ok(visibleViews(FB).some((t) => t.view === "analyse"), "shown when advertised");
  assert.ok(!visibleViews(NO_ANALYSE).some((t) => t.view === "analyse"), "hidden otherwise");
  // capability-free views are always present
  assert.ok(visibleViews(NO_ANALYSE).some((t) => t.view === "rendered"));
});

test("validView keeps an exposed view and falls back to rendered otherwise", () => {
  assert.equal(validView("analyse", FB), "analyse");
  assert.equal(validView("analyse", NO_ANALYSE), "rendered"); // gated off ⇒ fallback
  assert.equal(validView("bogus", FB), "rendered");
});

test("analyseText returns the report, the error, or a no-engine placeholder", () => {
  const ok = { analyze: () => ({ ok: true, report: "# Truthiness analysis\n…", jsonata: "" }) };
  assert.match(analyseText(ok, "{{#if x}}…{{/if}}", { x: "" }), /Truthiness analysis/);

  const bad = { analyze: () => ({ ok: false, error: "1:1: parse boom" }) };
  assert.match(analyseText(bad, "{{#if", {}), /Analyse error: 1:1: parse boom/);

  assert.match(analyseText({}, "x", {}), /no analyse mode/); // engine without analyze
});

test("analyseText passes the source through as the program (not the data)", () => {
  let seenSource = null, seenData = null;
  const spy = { analyze: (p, d) => { seenSource = p.source; seenData = d; return { ok: true, report: "" }; } };
  analyseText(spy, "TPL", { k: 1 });
  assert.equal(seenSource, "TPL");
  assert.deepEqual(seenData, { k: 1 });
});

// ── Layer 2: wiring (hand-rolled fake DOM — interface only, no layout) ────────

// The two output containers as fakes; `applyView` only ever sets `.hidden`.
const fakeEls = () => ({ text: { hidden: null }, preview: { hidden: null } });

test("applyView shows the text pane and hides the iframe for a text view", () => {
  const els = fakeEls();
  const kind = applyView(els, "analyse");
  assert.equal(kind, "text");
  assert.equal(els.text.hidden, false);
  assert.equal(els.preview.hidden, true);
});

test("applyView shows the iframe and hides the text pane for a preview view", () => {
  const els = fakeEls();
  const kind = applyView(els, "rendered");
  assert.equal(kind, "preview");
  assert.equal(els.text.hidden, true);
  assert.equal(els.preview.hidden, false);
});

test("applyView is exhaustive: every VIEW_TABS view drives exactly one pane visible", () => {
  for (const t of VIEW_TABS) {
    const els = fakeEls();
    applyView(els, t.view);
    // exactly one of the two panes is visible
    assert.notEqual(els.text.hidden, els.preview.hidden, `${t.view} must pick one pane`);
  }
});
