// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the tutorials' template highlighter (`src/lib/highlight.mjs`).
// It derives from the engine lexer (ADR-014) via the shared INNER-TOKEN painter
// (lab/highlight-paint.mjs) and maps each token KIND to the unified `--c-*`
// palette (`tk-*`), wrapping every whole tag in a `tk-tag` plate. The painter
// drives the REAL engine `tokenize` from the committed bundle, so this also pins
// the bundle → presenter wiring (the sibling `lab/cm-flatbars.test.mjs` pins the
// Lab presenter).

import { test } from "node:test";
import assert from "node:assert/strict";

import { highlightTemplate, highlightJsonata, esc } from "../src/lib/highlight.mjs";

// Each whole tag is wrapped in a `.tk-tag` plate; `tag(inner)` builds the expected.
const tag = (inner) => '<span class="tk-tag">' + inner + "</span>";

// The highlighter is INNER-TOKEN (lab/highlight-paint.mjs): braces are
// punctuation, block sigils + clause words are keywords, prelude helper names
// are operations, literals get their own kind — the VS Code "2026-dark" look.
test("a plain tag: braces are punctuation, the name default (inner-token)", () => {
  assert.equal(
    highlightTemplate("{{name}}", "minbars"),
    tag('<span class="tk-punct">{{</span><span class="tk-in">name</span><span class="tk-punct">}}</span>'),
  );
});

test("triple-stash braces are punctuation, the body default", () => {
  assert.equal(
    highlightTemplate("{{{html}}}", "minbars"),
    tag('<span class="tk-punct">{{{</span><span class="tk-in">html</span><span class="tk-punct">}}}</span>'),
  );
});

test("a block sigil + its word is one keyword run", () => {
  const out = highlightTemplate("{{#items}}x{{/items}}", "minbars");
  assert.ok(out.includes('<span class="tk-keyword">#items</span>'), out);
  assert.ok(out.includes('<span class="tk-keyword">/items</span>'), out);
  assert.ok(out.startsWith('<span class="tk-tag"><span class="tk-punct">{{</span>'));
});

test("a prelude helper name lights up as an operation; literals get their kind", () => {
  const out = highlightTemplate("{{toFixed n 2}}", "maxbars");
  assert.ok(out.includes('<span class="tk-operation">toFixed</span>'), out);
  assert.ok(out.includes('<span class="tk-number">2</span>'), out);
  // a bare `{{name}}` is NOT a call — it stays default, no operation colour.
  assert.ok(!highlightTemplate("{{name}}", "maxbars").includes("tk-operation"));
});

test("a string literal in a tag is tk-string", () => {
  assert.ok(highlightTemplate('{{eq x "hi"}}', "maxbars").includes('<span class="tk-string">&quot;hi&quot;</span>'));
});

test("a partial name is an operation (like the LSP always-head); the sigil a keyword", () => {
  // {{> card}} — `>` is a keyword (only the sigil, not the trailing space, which
  // VS Code leaves default), `card` paints as the `function`/operation semantic
  // token (purple), matching VS Code (grammar `keyword.control.import` + LSP).
  const out = highlightTemplate("{{> card}}", "fullbars");
  assert.ok(out.includes('<span class="tk-keyword">&gt;</span><span class="tk-in"> </span><span class="tk-operation">card</span>'), out);
});

test("inheritance sigils are keywords; the name stays default (the `any` position)", () => {
  const out = highlightTemplate("{{<layout}}{{$title}}Hi{{/title}}{{/layout}}", "minbars");
  assert.ok(out.includes('<span class="tk-keyword">&lt;</span><span class="tk-in">layout</span>'), out);
  assert.ok(out.includes('<span class="tk-keyword">$</span><span class="tk-in">title</span>'), out);
  assert.ok(out.includes('<span class="tk-keyword">/title</span>'));
});

test("a set-delimiter directive: punct braces, tk-delim body (like VS Code)", () => {
  // VS Code keeps the {{ }} braces punctuation (grammar) and paints only the
  // `=A B=` directive body via the LSP set-delimiter semantic token.
  const out = highlightTemplate("{{=<% %>=}}", "minbars");
  assert.ok(out.startsWith('<span class="tk-tag"><span class="tk-punct">{{</span>'), out);
  assert.ok(out.includes('<span class="tk-delim">=&lt;% %&gt;=</span>'), out);
  assert.ok(out.endsWith('<span class="tk-punct">}}</span></span>'), out);
});

test("a comment: punct braces/sigil, tk-comment body (like VS Code)", () => {
  // The comment delimiters ({{! … }}) are punctuation in VS Code (the
  // punctuation.section.embedded scope sits over comment.block); only the body grey.
  const out = highlightTemplate("{{! note }}", "minbars");
  assert.ok(out.startsWith('<span class="tk-tag"><span class="tk-punct">{{!</span>'), out);
  assert.ok(out.includes('<span class="tk-comment"> note </span>'), out);
  assert.ok(out.endsWith('<span class="tk-punct">}}</span></span>'), out);
});

test("MaxBars operators and non-helper identifiers stay default", () => {
  assert.equal(
    highlightTemplate("{{a + b}}", "maxbars"),
    tag('<span class="tk-punct">{{</span><span class="tk-in">a + b</span><span class="tk-punct">}}</span>'),
  );
});

test("special characters in a tag body are HTML-escaped", () => {
  const out = highlightTemplate("{{=<% %>=}}", "minbars");
  assert.ok(out.includes("&lt;% %&gt;="));
  assert.equal(esc("<b> & 'x'"), "&lt;b&gt; &amp; &#39;x&#39;");
});

test("text outside any tag stays plain (and escaped)", () => {
  assert.equal(highlightTemplate("a < b", "minbars"), "a &lt; b");
});

test("a dialect-disallowed shape is flagged tk-error, not painted valid", () => {
  // MaxBars (extras off) rejects {{&x}} and the Handlebars no-hash raw block.
  assert.ok(highlightTemplate("{{&x}}", "maxbars").startsWith('<span class="tk-tag"><span class="tk-error">'));
  assert.ok(highlightTemplate("{{{{raw}}}}b{{{{/raw}}}}", "maxbars").includes('class="tk-error"'));
  // FullBars (inheritance off) rejects the Mustache {{<l}} sigil.
  assert.ok(highlightTemplate("{{<l}}x{{/l}}", "fullbars").startsWith('<span class="tk-tag"><span class="tk-error">'));
  // …but MinBars allows {{&x}} — no error; braces punctuation, body default.
  assert.ok(highlightTemplate("{{&x}}", "minbars").startsWith('<span class="tk-tag"><span class="tk-punct">'));
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
