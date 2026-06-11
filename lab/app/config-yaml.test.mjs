// SPDX-License-Identifier: Apache-2.0
//
// Tests for the config.yaml round-trip (Phase 0). loadYaml is stubbed (returns the
// pre-parsed object) so the tests target the serialise + validate logic, not the
// YAML parser. Run: node lab/app/config-yaml.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { createConfigYaml } from "./config-yaml.mjs";

const mkCtx = (over = {}) => ({ state: {
  escapeMode: "html", standalone: true, allowList: null, minbarsCompat: true,
  labLocale: "en", labPathSchema: [], ...over,
} });
const make = (ctx, over = {}) => createConfigYaml(ctx, {
  engine: "classicbars", engineBuiltins: ["upcase", "trim", "eval"],
  loadYaml: (parsed) => parsed, // tests pass the already-parsed object as `text`
  ...over,
});

test("buildConfigYaml serialises the policy into the commented scaffold", () => {
  const { buildConfigYaml } = make(mkCtx());
  const out = buildConfigYaml();
  assert.match(out, /escape: html/);
  assert.match(out, /trim_whitespace: true/);
  assert.match(out, /allow: ~/); // null → ~ (unconstrained)
  assert.match(out, /i18n:/);
  assert.match(out, /locale: en/);
});

test("buildConfigYaml renders a real allow-list and the MinBars truthiness block", () => {
  const list = make(mkCtx({ allowList: ["upcase", "trim"] })).buildConfigYaml();
  assert.match(list, /allow: \[upcase, trim\]/);
  const min = make(mkCtx({ minbarsCompat: false }), { engine: "minbars" }).buildConfigYaml();
  assert.match(min, /minbars:/);
  assert.match(min, /truthiness: spec/);
  assert.doesNotMatch(min, /i18n:/); // MinBars: no i18n/analyse block
});

test("parseConfigYaml normalises a valid config", () => {
  const { parseConfigYaml } = make(mkCtx());
  const r = parseConfigYaml({ escape: "json", trim_whitespace: false, transformers: { allow: ["upcase"] } });
  assert.deepEqual(r, { ok: true, value: { escape: "json", trim: false, allow: ["upcase"], mustacheJs: true, locale: "en", pathSchema: [] } });
});

test("parseConfigYaml: empty/null config → defaults", () => {
  const r = make(mkCtx()).parseConfigYaml(null);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { escape: "", trim: true, allow: null, mustacheJs: true, locale: "en", pathSchema: [] });
});

test("parseConfigYaml rejects a bad escape mode", () => {
  const r = make(mkCtx()).parseConfigYaml({ escape: "bogus" });
  assert.equal(r.ok, false);
  assert.match(r.error, /escape:/);
});

test("parseConfigYaml rejects an unknown allow-list transformer", () => {
  const r = make(mkCtx()).parseConfigYaml({ transformers: { allow: ["upcase", "nope"] } });
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown transformer.*nope/);
});

test("parseConfigYaml: minbars.truthiness spec → mustacheJs false; pathSchema dedupes", () => {
  const r = make(mkCtx()).parseConfigYaml({ minbars: { truthiness: "spec" }, analyse: { pathSchema: ["a", "a", "b"] } });
  assert.equal(r.value.mustacheJs, false);
  assert.deepEqual(r.value.pathSchema, ["a", "b"]);
});
