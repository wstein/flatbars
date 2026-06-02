// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the custom-helper bag builder (ADR-018). Uses the REAL engine
// bundle for `safe` and an end-to-end `renderWith`, so this pins the
// source → bag → render wiring the Lab and tutorials rely on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHelpers } from "./helpers.mjs";
import { renderWith, safe } from "./vendor/flatbars-engine.mjs";

test("buildHelpers collects registerHelper calls into a bag", () => {
  const r = buildHelpers("registerHelper('loud', (s) => String(s).toUpperCase())", safe);
  assert.equal(r.ok, true);
  assert.equal(typeof r.helpers.loud, "function");
  assert.equal(r.helpers.loud("hi"), "HI");
});

test("empty source is a valid empty bag", () => {
  assert.deepEqual(buildHelpers("", safe), { ok: true, helpers: {}, error: "" });
  assert.deepEqual(buildHelpers("   \n", safe).helpers, {});
});

test("a syntax error is reported, not thrown", () => {
  const r = buildHelpers("registerHelper('x', =>)", safe);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});

test("registerHelper validates its arguments", () => {
  assert.equal(buildHelpers("registerHelper('x', 42)", safe).ok, false);
  assert.equal(buildHelpers("registerHelper(123, () => 1)", safe).ok, false);
});

test("the bag drives renderWith end-to-end (escaped + safe)", () => {
  const { helpers } = buildHelpers(
    "registerHelper('loud', (s) => String(s).toUpperCase());\n" +
      "registerHelper('em', (s) => safe('<em>' + s + '</em>'))",
    safe,
  );
  // escaped in {{ }}
  assert.equal(renderWith(helpers, {}, "{{loud x}}", { x: "<b>ada" }).value, "&lt;B&gt;ADA");
  // safe() emits raw markup even in {{ }}
  assert.equal(renderWith(helpers, {}, "{{em x}}", { x: "hi" }).value, "<em>hi</em>");
});
