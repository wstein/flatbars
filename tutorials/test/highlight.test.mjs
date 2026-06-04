// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the tutorials' template highlighter (`src/lib/highlight.mjs`).
// It derives from the engine lexer's spans (ADR-014) and maps them to the
// unified seven-family `--c-*` palette (`stem-*`), dimming each tag's `{{ }}`
// delimiters with a nested `.pn` span. `highlightSpans` here is the REAL engine
// facade from the committed bundle, so this also pins the bundle → presenter
// wiring (the sibling `lab/cm-flatbars.test.mjs` pins the Lab presenter).

import { test } from "node:test";
import assert from "node:assert/strict";

import { highlightTemplate, highlightJsonata, esc } from "../src/lib/highlight.mjs";

test("a plain tag is one expr chunk with dimmed {{ }} delimiters", () => {
  assert.equal(
    highlightTemplate("{{name}}", "minbars"),
    '<span class="stem-expr"><span class="pn">{{</span>name<span class="pn">}}</span></span>',
  );
});

test("triple-stash and ampersand both read as raw, with their full delimiters dimmed", () => {
  assert.equal(
    highlightTemplate("{{{html}}}", "minbars"),
    '<span class="stem-raw"><span class="pn">{{{</span>html<span class="pn">}}}</span></span>',
  );
  assert.ok(highlightTemplate("{{&html}}", "minbars").startsWith('<span class="stem-raw">'));
});

test("inheritance sigils get the violet `inherit` family, closes stay `block`", () => {
  const out = highlightTemplate("{{<layout}}{{$title}}Hi{{/title}}{{/layout}}", "minbars");
  assert.ok(out.includes('<span class="stem-inherit"><span class="pn">{{</span>&lt;layout'));
  assert.ok(out.includes('<span class="stem-inherit"><span class="pn">{{</span>$title'));
  // a close tag is `block-close` → the orange block family, not inherit
  assert.ok(out.includes('<span class="stem-block"><span class="pn">{{</span>/title'));
});

test("the set-delimiters tag gets the rose `delim` family (not comment)", () => {
  assert.ok(highlightTemplate("{{=<% %>=}}", "minbars").startsWith('<span class="stem-delim">'));
});

test("a section opens with the orange `block` family", () => {
  assert.ok(highlightTemplate("{{#items}}x{{/items}}", "minbars").startsWith('<span class="stem-block">'));
});

test("a comment reads as the grey `comment` family", () => {
  assert.ok(highlightTemplate("{{! note }}", "minbars").startsWith('<span class="stem-comment">'));
});

test("a MaxBars expression is one expr span — operators do not split the tag", () => {
  // The whole tag reads in the one `expr` colour; the `+` carries no colour of
  // its own. Only the `{{`/`}}` delimiters are dimmed.
  assert.equal(
    highlightTemplate("{{a + b}}", "maxbars"),
    '<span class="stem-expr"><span class="pn">{{</span>a + b<span class="pn">}}</span></span>',
  );
});

test("special characters in a tag body are HTML-escaped", () => {
  // `<`/`&` survive as entities inside the highlighted span.
  const out = highlightTemplate("{{=<% %>=}}", "minbars");
  assert.ok(out.includes("&lt;% %&gt;="));
  assert.equal(esc("<b> & 'x'"), "&lt;b&gt; &amp; &#39;x&#39;");
});

test("text outside any tag stays plain (and escaped)", () => {
  assert.equal(highlightTemplate("a < b", "minbars"), "a &lt; b");
});

test("a dialect-disallowed shape is flagged stem-error, not painted valid", () => {
  // MaxBars (extras off) rejects {{&x}} / {{^x}} and the *Handlebars* no-hash raw
  // block {{{{name}}}}; the highlighter agrees by colouring them stem-error. (Per
  // the per-dialect raw-block gating, MaxBars *accepts* the FlatBars-native hash
  // spelling {{{{#name}}}}, so that one is not an error here.)
  assert.ok(highlightTemplate("{{&x}}", "maxbars").startsWith('<span class="stem-error">'));
  assert.ok(highlightTemplate("{{{{raw}}}}b{{{{/raw}}}}", "maxbars").includes('class="stem-error"'));
  // FullBars (inheritance off) rejects the Mustache {{<l}} sigil.
  assert.ok(highlightTemplate("{{<l}}x{{/l}}", "fullbars").startsWith('<span class="stem-error">'));
  // …but MinBars allows them, so there it is the raw family, not an error.
  assert.ok(highlightTemplate("{{&x}}", "minbars").startsWith('<span class="stem-raw">'));
});

// ── JSONata highlighter (the Data shaping guide's expression editors) ──
// Not a FlatBars dialect: its own tokenizer, mapped to plain `.j-*` colour
// classes (NOT the `.stem-*` tag chips). These pin the token classification.

test("a function call is j-fn; a $variable and $$ root are j-var", () => {
  assert.equal(highlightJsonata("$sum(items)"), '<span class="j-fn">$sum</span>(items)');
  assert.equal(highlightJsonata("$t"), '<span class="j-var">$t</span>');
  assert.equal(highlightJsonata("$$"), '<span class="j-var">$$</span>');
});

test("strings, numbers, operators and the function keyword get their classes", () => {
  assert.equal(highlightJsonata('"x"'), '<span class="j-str">&quot;x&quot;</span>');
  assert.equal(highlightJsonata("2.34"), '<span class="j-num">2.34</span>');
  assert.equal(highlightJsonata("a ~> b"), 'a <span class="j-op">~&gt;</span> b');
  assert.ok(highlightJsonata("function($x){$x}").startsWith('<span class="j-kw">function</span>'));
});

test("a /regex/ literal is j-regex; field names stay the default colour", () => {
  assert.equal(highlightJsonata("/[A-Z]+/"), '<span class="j-regex">/[A-Z]+/</span>');
  assert.equal(highlightJsonata("order.customer"), "order.customer"); // no spans on plain paths
});
