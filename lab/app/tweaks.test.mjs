// SPDX-License-Identifier: Apache-2.0
//
// Tests for the Appearance tweaks load/normalize (Phase 0). Run: node lab/app/tweaks.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { TWEAK_OPTS, normalizeTweaks } from "./tweaks.mjs";

test("normalizeTweaks returns the defaults for null/garbage input", () => {
  for (const bad of [null, undefined, [], "x", 3]) {
    assert.deepEqual(normalizeTweaks(bad), { layout: "split", lineNumbers: true, font: "plex", fontSize: 13, compactToolbar: false });
  }
});

test("normalizeTweaks merges stored prefs over the defaults", () => {
  const t = normalizeTweaks({ font: "courier", fontSize: 16, compactToolbar: true });
  assert.equal(t.font, "courier");
  assert.equal(t.fontSize, 16);
  assert.equal(t.compactToolbar, true);
  assert.equal(t.lineNumbers, true); // untouched default
});

test("normalizeTweaks drops retired keys (theme/mood/chipstyle)", () => {
  const t = normalizeTweaks({ theme: "dark", mood: "x", chipstyle: "solid", font: "plex" });
  for (const k of ["theme", "mood", "chipstyle"]) assert.ok(!(k in t), `${k} should be dropped`);
});

test("normalizeTweaks clamps an invalid font / fontSize back to the catalog", () => {
  const t = normalizeTweaks({ font: "comic-sans", fontSize: 99 });
  assert.equal(t.font, "plex");
  assert.equal(t.fontSize, 13);
  assert.ok(TWEAK_OPTS.font.some((o) => o.value === t.font));
});

test("normalizeTweaks: lineNumbers defaults on, explicit false respected", () => {
  assert.equal(normalizeTweaks({}).lineNumbers, true);
  assert.equal(normalizeTweaks({ lineNumbers: false }).lineNumbers, false);
});
