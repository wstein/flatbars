// SPDX-License-Identifier: Apache-2.0
//
// Tests for the share-URL snapshot (Phase 0). Run: node lab/app/share-state.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { snapshotState, buildVector } from "./share-state.mjs";

test("buildVector captures the workspace + actual output as a conformance vector", () => {
  const ctx = {
    state: { tabs: [{ name: "main", source: "{{x}}" }, { name: "row", source: "r" }], escapeMode: "html" },
    caches: { lastData: { x: 1 }, lastOutput: "1", lastUsedTransformers: ["upcase"] },
  };
  assert.deepEqual(buildVector(ctx, { status: "miss", path: "y" }), {
    name: "data access: miss y",
    template: "{{x}}",
    partials: { row: "r" },
    data: { x: 1 },
    escape: "html",
    expected: "1",
    transformers: ["upcase"],
  });
  // no row → generic name; null data → {}
  const ctx2 = { state: { tabs: [{ name: "main", source: "" }], escapeMode: "" }, caches: { lastData: null, lastOutput: "", lastUsedTransformers: [] } };
  const v = buildVector(ctx2, null);
  assert.equal(v.name, "playground capture");
  assert.deepEqual(v.data, {});
  assert.deepEqual(v.partials, {});
});

const baseState = () => ({
  tabs: [{ name: "main", source: "{{x}}" }, { name: "row", source: "r" }],
  yamlSrc: "x: 1", transformSrc: "", helpersSrc: "", catalogSource: "",
  labLocale: "en", labPathSchema: [], dataOverlays: [],
  escapeMode: "", outputView: "source", standalone: true, allowList: null,
  activeView: "tmpl", activeTabIdx: 0, minbarsCompat: true, loadedExampleIdx: 3,
});
const snap = (over = {}, mode = "tmpl") => snapshotState({ state: { ...baseState(), ...over } }, mode);

test("snapshotState serialises tabs/data and the always-present fields", () => {
  const s = snap();
  assert.deepEqual(s.tabs, [{ n: "main", s: "{{x}}" }, { n: "row", s: "r" }]);
  assert.equal(s.d, "x: 1");
  assert.equal(s.t, "");
  assert.equal(s.e, "");
  assert.equal(s.v, "source");
  assert.equal(s.sa, 1); // standalone true → 1
  assert.equal(s.av, "tmpl");
  assert.equal(s.ai, 0);
  assert.equal(s.x, 3);
});

test("defaults are OMITTED so links stay compact", () => {
  const s = snap();
  for (const k of ["h", "cat", "loc", "ps", "do", "al", "mj", "tm", "hm"]) {
    assert.ok(!(k in s), `default field ${k} should be omitted`);
  }
});

test("non-defaults are persisted", () => {
  const s = snap({
    helpersSrc: "registerHelper()", catalogSource: "en: {}", labLocale: "de",
    labPathSchema: ["a"], dataOverlays: [{ name: "o", source: "y" }],
    standalone: false, allowList: ["upcase"], minbarsCompat: false,
  });
  assert.equal(s.h, "registerHelper()");
  assert.equal(s.cat, "en: {}");
  assert.equal(s.loc, "de");
  assert.deepEqual(s.ps, ["a"]);
  assert.deepEqual(s.do, [{ n: "o", s: "y" }]);
  assert.equal(s.sa, 0); // standalone false → 0
  assert.deepEqual(s.al, ["upcase"]);
  assert.equal(s.mj, 0); // minbarsCompat false (spec) → mj:0
});

test("the active template-pane mode round-trips (transform/helpers)", () => {
  assert.equal(snap({}, "transform").tm, 1);
  assert.ok(!("hm" in snap({}, "transform")));
  assert.equal(snap({}, "helpers").hm, 1);
  assert.ok(!("tm" in snap({}, "tmpl")));
});
