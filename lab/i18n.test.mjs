// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the catalog.yaml → i18n helper bag builder (ADR-029) and its
// wiring through the helper worker, across the three t-supporting dialects
// (RawBars/FullBars/MaxBars; MinBars is excluded). catalog.yaml is pure message
// DATA; the active locale comes from config.yaml. Uses the REAL vendored js-yaml
// and engine bundle.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildI18nHelpers } from "./i18n.mjs";
import { runHelperRequest } from "./helpers-worker.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";

// catalog.yaml — messages only (locale-keyed); the locale lives in config.yaml.
const CATALOG = `
en:
  greeting: "Hello, {name}!"
  hello: "Hi there"
  files.deleted:
    one: "Deleted {count} file"
    other: "Deleted {count} files"
pl:
  greeting: "Cześć, {name}!"
  hello: "Witaj!"
  files.deleted:
    one: "Usunięto {count} plik"
    few: "Usunięto {count} pliki"
    many: "Usunięto {count} plików"
    other: "Usunięto {count} pliku"
`;
const CONFIG_PL = "i18n:\n  locale: pl";

test("empty catalog is a valid empty bag", () => {
  assert.deepEqual(buildI18nHelpers("", "en", loadYaml), { ok: true, helpers: {}, error: "" });
});

test("the catalog builds the i18n bag bound to the given locale", () => {
  const { ok, helpers } = buildI18nHelpers(CATALOG, "pl", loadYaml);
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(helpers).sort(), ["date", "number", "relative", "selectPlural", "t"]);
  assert.equal(helpers.t("greeting", { name: "Ada" }), "Cześć, Ada!");
  assert.equal(helpers.t("files.deleted", { count: 5 }), "Usunięto 5 plików"); // `many`, a category en lacks
  assert.equal(helpers.t("no.such.key", {}), "no.such.key"); // fallback-and-flag
  assert.equal(helpers.selectPlural(2), "few");
});

test("the same catalog under a different locale", () => {
  const { helpers } = buildI18nHelpers(CATALOG, "en", loadYaml);
  assert.equal(helpers.t("greeting", { name: "Ada" }), "Hello, Ada!");
  assert.equal(helpers.t("files.deleted", { count: 2 }), "Deleted 2 files");
});

test("a malformed / non-mapping catalog is reported, not thrown", () => {
  assert.equal(buildI18nHelpers("- a\n- b", "en", loadYaml).ok, false);
  assert.match(buildI18nHelpers("- a\n- b", "en", loadYaml).error, /catalog\.yaml/);
});

test("the worker renders against catalog + config for each t-supporting dialect", () => {
  // FullBars: hash-arg surface
  const fb = runHelperRequest({ dialect: "fullbars", template: '{{t "greeting" name=who}}', data: { who: "Ada" }, catalogSrc: CATALOG, configSrc: CONFIG_PL });
  assert.equal(fb.value, "Cześć, Ada!", fb.error);
  // MaxBars: borrows the FullBars surface
  const mx = runHelperRequest({ dialect: "maxbars", template: '{{t "greeting" name=who}}', data: { who: "Ada" }, catalogSrc: CATALOG, configSrc: CONFIG_PL });
  assert.equal(mx.value, "Cześć, Ada!", mx.error);
  // RawBars: the desugared core surface — explicit dict + lookup, no hash sugar
  const rb = runHelperRequest({ dialect: "rawbars", template: '{{{t "greeting" (dict "name" (lookup this "who"))}}}', data: { who: "Ada" }, catalogSrc: CATALOG, configSrc: CONFIG_PL });
  assert.equal(rb.value, "Cześć, Ada!", rb.error);
  const rb2 = runHelperRequest({ dialect: "rawbars", template: '{{{t "hello"}}}', data: {}, catalogSrc: CATALOG, configSrc: CONFIG_PL });
  assert.equal(rb2.value, "Witaj!", rb2.error);
});

test("config.yaml drives the locale; default is en", () => {
  const noCfg = runHelperRequest({ dialect: "fullbars", template: '{{t "hello"}}', data: {}, catalogSrc: CATALOG });
  assert.equal(noCfg.value, "Hi there", noCfg.error); // en default
});

test("helpers.js overrides a catalog-derived helper", () => {
  const res = runHelperRequest({
    dialect: "fullbars",
    template: '{{t "greeting" name=who}}',
    data: { who: "Ada" },
    catalogSrc: CATALOG,
    configSrc: CONFIG_PL,
    helperSrc: "registerHelper('t', (k) => 'OVERRIDDEN:' + k)",
  });
  assert.equal(res.value, "OVERRIDDEN:greeting", res.error);
});

test("a malformed catalog/config surfaces as a render error, not a throw", () => {
  assert.match(runHelperRequest({ template: "{{x}}", data: {}, catalogSrc: "- bad" }).error, /catalog\.yaml/);
  assert.match(runHelperRequest({ template: "{{x}}", data: {}, configSrc: "- bad" }).error, /config\.yaml/);
});
