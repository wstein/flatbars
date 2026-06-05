// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the catalog.yaml → i18n helper bag builder (ADR-029, the Lab's
// dedicated catalog tab) and its wiring through the helper worker. Uses the REAL
// vendored js-yaml and engine bundle, so this pins the catalog → bag → render
// path the Lab relies on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildI18nHelpers } from "./i18n.mjs";
import { runHelperRequest } from "./helpers-worker.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";

const CATALOG = `
locale: pl
messages:
  en:
    greeting: "Hello, {name}!"
    files.deleted:
      one: "Deleted {count} file"
      other: "Deleted {count} files"
  pl:
    greeting: "Cześć, {name}!"
    files.deleted:
      one: "Usunięto {count} plik"
      few: "Usunięto {count} pliki"
      many: "Usunięto {count} plików"
      other: "Usunięto {count} pliku"
`;

test("empty catalog is a valid empty bag", () => {
  assert.deepEqual(buildI18nHelpers("", loadYaml), { ok: true, helpers: {}, error: "" });
  assert.deepEqual(buildI18nHelpers("   \n", loadYaml).helpers, {});
});

test("catalog builds t/number/date/selectPlural/relative bound to the locale", () => {
  const { ok, helpers } = buildI18nHelpers(CATALOG, loadYaml);
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(helpers).sort(), ["date", "number", "relative", "selectPlural", "t"]);
  // pl: interpolation + the `many` plural category (a category English lacks)
  assert.equal(helpers.t("greeting", { name: "Ada" }), "Cześć, Ada!");
  assert.equal(helpers.t("files.deleted", { count: 5 }), "Usunięto 5 plików");
  assert.equal(helpers.t("files.deleted", { count: 1 }), "Usunięto 1 plik");
  // a missing key falls back to the key itself (ADR-029)
  assert.equal(helpers.t("no.such.key", {}), "no.such.key");
  // the Intl formatting helpers, locale-bound (pl)
  assert.equal(helpers.selectPlural(2), "few");
  assert.equal(helpers.number(1000), new Intl.NumberFormat("pl").format(1000));
});

test("locale defaults to en when omitted", () => {
  const { helpers } = buildI18nHelpers('messages:\n  en:\n    hi: "Hi {name}"', loadYaml);
  assert.equal(helpers.t("hi", { name: "Ada" }), "Hi Ada");
});

test("malformed catalog is reported, not thrown", () => {
  const r = buildI18nHelpers("messages: [not, a, mapping", loadYaml); // invalid YAML
  assert.equal(r.ok, false);
  assert.match(r.error, /catalog\.yaml/);
});

test("a non-mapping document is rejected", () => {
  const r = buildI18nHelpers("- just\n- a list", loadYaml);
  assert.equal(r.ok, false);
  assert.match(r.error, /mapping/);
});

test("the worker renders a template against the catalog tab (catalogSrc)", () => {
  const res = runHelperRequest({
    template: '{{t "greeting" name=who}} — {{t "files.deleted" count=n}}',
    data: { who: "Ada", n: 2 },
    catalogSrc: CATALOG,
  });
  assert.equal(res.ok, true);
  assert.equal(res.value, "Cześć, Ada! — Usunięto 2 pliki");
});

test("helpers.js overrides a catalog-derived helper", () => {
  const res = runHelperRequest({
    template: '{{t "greeting" name=who}}',
    data: { who: "Ada" },
    catalogSrc: CATALOG,
    helperSrc: "registerHelper('t', (k, a) => 'OVERRIDDEN:' + k)",
  });
  assert.equal(res.ok, true);
  assert.equal(res.value, "OVERRIDDEN:greeting");
});

test("a malformed catalog surfaces as a render error, not a throw", () => {
  const res = runHelperRequest({ template: "{{x}}", data: { x: 1 }, catalogSrc: "messages: [bad" });
  assert.equal(res.ok, false);
  assert.match(res.error, /catalog\.yaml/);
});
