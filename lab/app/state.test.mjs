// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the extracted application-state factory (Phase 0). Offline,
// zero-dependency — run with: node lab/app/state.test.mjs (also in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { createAppState, helperKey } from "./state.mjs";

test("createAppState returns the faithful index.html defaults", () => {
  const s = createAppState("classicbars");
  assert.deepEqual(s.tabs, [{ name: "main", source: "" }]);
  assert.equal(s.activeTabIdx, 0);
  assert.equal(s.loadedExampleIdx, -1);
  assert.equal(s.exampleModified, false);
  assert.equal(s.activeView, "tmpl");
  assert.equal(s.dataPaneMode, "data");
  assert.equal(s.outputView, "source");
  assert.equal(s.allowScripts, true);
  assert.equal(s.minbarsCompat, true);
  assert.equal(s.standalone, true);
  assert.equal(s.allowList, null);
  assert.equal(s.focusMode, null);
  assert.deepEqual(s.templateDiagnostics, []);
  assert.deepEqual(s.labPathSchema, []);
  assert.equal(s.labLocale, "en");
  assert.deepEqual(s.helperCache, { key: null, output: "", error: "" });
  assert.equal(s.helperInFlight, null);
  assert.deepEqual(s.dataOverlays, []);
});

test("openEditors includes the helpers editor for every engine except MinBars", () => {
  for (const e of ["rawbars", "classicbars", "maxbars"]) {
    assert.deepEqual(createAppState(e).openEditors, ["main", "data", "transform", "helpers"], e);
  }
  assert.deepEqual(createAppState("minbars").openEditors, ["main", "data", "transform"]);
});

test("createAppState yields a fresh record each call (no shared references)", () => {
  const a = createAppState("classicbars");
  const b = createAppState("classicbars");
  a.tabs.push({ name: "x", source: "y" });
  a.dataOverlays.push({ name: "o" });
  assert.deepEqual(b.tabs, [{ name: "main", source: "" }], "tabs not aliased");
  assert.deepEqual(b.dataOverlays, [], "overlays not aliased");
});

test("helperKey is a stable JSON key, null on unserialisable input", () => {
  const k = helperKey("t", {}, { a: 1 }, "src", null, "en", "classicbars");
  assert.equal(k, helperKey("t", {}, { a: 1 }, "src", null, "en", "classicbars"));
  assert.notEqual(k, helperKey("t2", {}, { a: 1 }, "src", null, "en", "classicbars"));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(helperKey(cyclic, {}, {}, "", null, "en", "classicbars"), null);
});
