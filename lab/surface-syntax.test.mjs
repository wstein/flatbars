// SPDX-License-Identifier: Apache-2.0
//
// Unit test for the Lab's surface-syntax projection (the data the topbar's
// surface-aware Reference popup reads). Asserts the projection's shape and that it
// covers exactly the four dialects the Lab can render. Drift vs the single source
// (shared/surface-syntax.json) is gated separately by check:surface-syntax.
import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE_SYNTAX } from "./surface-syntax.mjs";
import { readFileSync } from "node:fs";

const source = JSON.parse(readFileSync(new URL("../shared/surface-syntax.json", import.meta.url), "utf8"));

test("the projection covers the four Lab surfaces", () => {
  const ids = SURFACE_SYNTAX.map((s) => s.id).sort();
  assert.deepEqual(ids, ["fullbars", "maxbars", "minbars", "rawbars"]);
});

test("each surface has the fields the Reference popup renders", () => {
  for (const s of SURFACE_SYNTAX) {
    assert.ok(s.label && s.engine && s.route, `${s.id}: label/engine/route`);
    assert.equal(s.engine, s.id, `${s.id}: engine matches id`);
    assert.match(s.route, /^\//, `${s.id}: route is root-absolute`);
    assert.ok(s.truthiness && s.truthiness.rule && s.truthiness.falsy, `${s.id}: truthiness`);
    assert.ok(Array.isArray(s.rows) && s.rows.length >= 5, `${s.id}: has rows`);
    for (const r of s.rows) {
      assert.ok(r.feature && r.syntax && r.note, `${s.id}: row {feature,syntax,note}`);
    }
  }
});

test("the projection equals the single source (gen:surface-syntax was run)", () => {
  assert.deepEqual(SURFACE_SYNTAX, source.surfaces);
});

console.log("✓ lab surface-syntax projection unit tests passed");
