// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the custom-helper bag builder (ADR-018). Uses the REAL engine
// bundle for `safe` and an end-to-end `renderWith`, so this pins the
// source → bag → render wiring the Lab and tutorials rely on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHelpers } from "./helpers.mjs";
import { runHelperRequest } from "./helpers-worker.mjs";
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

test("a declared arity is captured and enforced like the prelude (ADR-018)", () => {
  const { helpers } = buildHelpers("registerHelper('loud', (s) => String(s).toUpperCase(), 1)", safe);
  assert.deepEqual(Object.keys(helpers), ["loud"]);
  assert.equal(typeof helpers.loud, "object"); // { fn, arity } descriptor
  assert.equal(helpers.loud.arity, 1);
  // correct arity renders; wrong arity is an ArityError matching the prelude's text
  assert.equal(renderWith(helpers, {}, "{{loud x}}", { x: "a" }).value, "A");
  const bad = renderWith(helpers, {}, "{{loud x y}}", { x: "a", y: "b" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "ArityError: loud: expected exactly 1 argument(s), got 2");
});

test("range arities: [min, max] is enforced when over the max", () => {
  // A bare {{between}} with no args would be a data path (helpers need args), so
  // arity is exercised with too-MANY args (an unambiguous helper call).
  const { helpers } = buildHelpers(
    "registerHelper('between', (a, b) => (a || '') + (b || ''), [1, 2])",
    safe,
  );
  assert.equal(renderWith(helpers, {}, "{{between a}}", { a: "x" }).value, "x");
  assert.equal(renderWith(helpers, {}, "{{between a b}}", { a: "x", b: "y" }).value, "xy");
  const over = renderWith(helpers, {}, "{{between a b c}}", { a: "x", b: "y", c: "z" });
  assert.equal(over.ok, false);
  assert.match(over.error, /^ArityError: between: expected 1.2 argument\(s\), got 3$/); // 1–2 (en-dash)
});

test("the Worker core (runHelperRequest) builds + renders off-thread (ADR-018)", () => {
  const ok = runHelperRequest({
    template: "{{loud x}}",
    data: { x: "<b>ada" },
    helperSrc: "registerHelper('loud', (s) => String(s).toUpperCase(), 1)",
  });
  assert.deepEqual(ok, { ok: true, value: "&lt;B&gt;ADA", error: "" });

  const arity = runHelperRequest({
    template: "{{loud x y}}",
    data: { x: "a", y: "b" },
    helperSrc: "registerHelper('loud', (s) => s, 1)",
  });
  assert.equal(arity.ok, false);
  assert.match(arity.error, /ArityError: loud: expected exactly 1/);

  const broken = runHelperRequest({ template: "{{x}}", data: {}, helperSrc: "registerHelper('x'," });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /helper error/);
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

test("a block helper renders the body via options.fn (ADR-020)", () => {
  const { helpers } = buildHelpers(
    "registerHelper('bold', function (options) { return safe('<b>' + options.fn(this) + '</b>'); })",
    safe,
  );
  // options.fn(this) renders the body in the current context; the return is raw.
  assert.equal(renderWith(helpers, {}, "{{#bold}}{{name}}{{/bold}}", { name: "Ada" }).value, "<b>Ada</b>");
  // the same registration used inline sees no options.fn (usage decides).
  assert.equal(renderWith(helpers, {}, "{{bold}}", {}).value, "");
});

test("options.fn(ctx) shifts context; options.inverse renders {{else}} (ADR-020)", () => {
  const { helpers } = buildHelpers(
    "registerHelper('list', (xs, o) => safe('<ul>' + xs.map((i) => '<li>' + o.fn(i) + '</li>').join('') + '</ul>'));\n" +
      "registerHelper('ifAny', (xs, o) => (xs.length ? o.fn() : o.inverse()))",
    safe,
  );
  assert.equal(
    renderWith(helpers, {}, "{{#list people}}{{name}}{{/list}}", { people: [{ name: "Ada" }, { name: "Lin" }] }).value,
    "<ul><li>Ada</li><li>Lin</li></ul>",
  );
  assert.equal(renderWith(helpers, {}, "{{#ifAny xs}}some{{else}}none{{/ifAny}}", { xs: [] }).value, "none");
});

test("a block helper supplies scoped @vars via options.fn(ctx, { data }) (ADR-020 Phase 2)", () => {
  const { helpers } = buildHelpers(
    "registerHelper('idx', (items, o) =>\n" +
      "  items.map((x, i) => o.fn(x, { data: { index: i, first: i === 0 } })).join(''))",
    safe,
  );
  assert.equal(
    renderWith(helpers, {}, "{{#idx items}}{{@index}}{{#if @first}}*{{/if}}:{{label}} {{/idx}}",
      { items: [{ label: "a" }, { label: "b" }] }).value,
    "0*:a 1:b ",
  );
});

test("block options surface is fn/inverse/data — hash etc. throw (ADR-020)", () => {
  const { helpers } = buildHelpers("registerHelper('h', (options) => options.hash.x)", safe);
  const r = renderWith(helpers, {}, "{{#h}}b{{/h}}", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /options\.hash is not supported/);
});
