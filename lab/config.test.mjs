// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the config.yaml parser (ADR-029, the Lab's per-surface settings
// tab). Uses the REAL vendored js-yaml.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseConfig, minbarsCompatFromConfig, CONFIG_DEFAULTS } from "./config.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";

test("empty config is the defaults (en, mustacheJs)", () => {
  const r = parseConfig("", loadYaml);
  assert.deepEqual(r, { ok: true, config: { ...CONFIG_DEFAULTS }, error: "" });
  assert.equal(CONFIG_DEFAULTS.minbarsTruthiness, "mustacheJs"); // default true
});

test("i18n.locale is read", () => {
  assert.equal(parseConfig("i18n:\n  locale: pl", loadYaml).config.locale, "pl");
});

test("minbars.truthiness defaults mustacheJs; only `spec` opts out", () => {
  assert.equal(parseConfig("minbars:\n  truthiness: spec", loadYaml).config.minbarsTruthiness, "spec");
  assert.equal(parseConfig("minbars:\n  truthiness: mustacheJs", loadYaml).config.minbarsTruthiness, "mustacheJs");
  assert.equal(parseConfig("minbars: {}", loadYaml).config.minbarsTruthiness, "mustacheJs"); // unrecognised → default
});

test("minbarsCompatFromConfig: true unless spec", () => {
  assert.equal(minbarsCompatFromConfig({ minbarsTruthiness: "mustacheJs" }), true);
  assert.equal(minbarsCompatFromConfig({ minbarsTruthiness: "spec" }), false);
  assert.equal(minbarsCompatFromConfig(parseConfig("", loadYaml).config), true); // default true
});

test("a malformed / non-mapping config is reported with safe defaults", () => {
  const bad = parseConfig("- a\n- b", loadYaml);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /config\.yaml/);
  assert.deepEqual(bad.config, { ...CONFIG_DEFAULTS }); // callers still get usable defaults
});
