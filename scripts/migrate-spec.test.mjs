// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the AsciiDoc → MDX spec converter (ADR-031). Each construct is
// exercised in isolation on synthetic input, so a regression points at one rule.
//   node scripts/migrate-spec.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  convert,
  escapeProseMdx,
  resolveXref,
  routeFor,
  splitCells,
  unwrapPass,
} from "./migrate-spec.mjs";

const body = (adoc) => convert(adoc).body;
const fm = (adoc) => convert(adoc).frontmatter;

test("title becomes frontmatter, navtitle becomes sidebar label", () => {
  const f = fm("= The core model\n:navtitle: Core model\n\nBody.\n");
  assert.match(f, /title: The core model/);
  assert.match(f, /sidebar:\n {2}label: Core model/);
});

test("section headings shift = levels to # levels", () => {
  assert.match(body("= T\n\n== Context\n"), /^## Context$/m);
  assert.match(body("= T\n\n=== Sub\n"), /^### Sub$/m);
  assert.match(body("= T\n\n==== Deep\n"), /^#### Deep$/m);
});

test("explicit anchor before a heading becomes a raw anchor element", () => {
  const out = body("= T\n\n[#expressions]\n== Expressions & paths\n");
  assert.match(out, /<a id="expressions"><\/a>/);
  assert.match(out, /^## Expressions & paths$/m);
});

test("xref to a known page resolves to its route", () => {
  assert.equal(resolveXref("concepts.adoc"), "/concepts/");
  assert.equal(resolveXref("host-api.adoc#api"), "/engine/host-api/#api");
  assert.equal(resolveXref("adr-0017-editor-support-lsp.adoc"), "/adr/adr-0017-editor-support-lsp/");
});

test("xref macro becomes a markdown link with caption", () => {
  assert.match(body("= T\n\nSee xref:concepts.adoc[the core model]."), /\[the core model\]\(\/concepts\/\)/);
});

test("empty-caption xref falls back to the page/anchor name", () => {
  assert.match(body("= T\n\nxref:errors.adoc[]"), /\[errors\]\(\/spec\/errors\/\)/);
});

test("unknown xref target warns and degrades to text, not a dead link", () => {
  const r = convert("= T\n\nxref:nope.adoc[gone]");
  assert.ok(r.warnings.some((w) => /unresolved xref/.test(w)));
  assert.doesNotMatch(r.body, /\]\(/); // no link emitted
});

test("defined attributes substitute; template tags do not", () => {
  // {hbs} is a real Antora attribute → Handlebars; {{else}} is a FlatBars tag,
  // escaped in prose and (separately) left literal inside a code span.
  const out = body("= T\n\nLike {hbs}, but the {{else}} clause and `{{else}}` differ.");
  assert.match(out, /Like Handlebars,/);
  assert.match(out, /the &#123;&#123;else&#125;&#125; clause/); // prose tag escaped
  assert.match(out, /`\{\{else\}\}`/); // code-span tag literal
});

test("source block becomes a fenced block with language; braces stay literal", () => {
  const out = body("= T\n\n[source,handlebars]\n----\n{{#each xs}}{{this}}{{/each}}\n----\n");
  assert.match(out, /```handlebars\n\{\{#each xs\}\}\{\{this\}\}\{\{\/each\}\}\n```/);
});

test("prose braces and angle brackets are entity-escaped for MDX", () => {
  assert.equal(escapeProseMdx("a {{x}} and <b>"), "a &#123;&#123;x&#125;&#125; and &lt;b>");
  // …but inside an inline-code span they stay literal:
  assert.equal(escapeProseMdx("use `{{x}}` here"), "use `{{x}}` here");
});

test("AsciiDoc \\{ literal-brace escapes are unwrapped then MDX-escaped", () => {
  const out = body("= T\n\nThe \\{\\{else}} clause renders nothing.");
  assert.match(out, /The &#123;&#123;else&#125;&#125; clause/);
  assert.doesNotMatch(out, /\\\{/); // no AsciiDoc escapes survive
});

test("pass:[] passthrough unwraps; braces escape in prose, stay literal in code", () => {
  assert.equal(unwrapPass("the pass:[{{/name}}] closer"), "the {{/name}} closer");
  // In prose the unwrapped tag is entity-escaped:
  assert.match(body("= T\n\nthe pass:[{{/name}}] closer"), /the &#123;&#123;\/name&#125;&#125; closer/);
  // Inside a code span it stays literal:
  assert.match(body("= T\n\nthe `pass:[{{/name}}]` closer"), /the `\{\{\/name\}\}` closer/);
});

test("inline [[id]] anchor becomes a raw anchor element, not escaped", () => {
  const out = body("= T\n\n[[divergence]]*3a. Divergence* is computed.\n");
  assert.match(out, /<a id="divergence"><\/a>/);
  assert.doesNotMatch(out, /&lt;a id/); // not escaped
});

test("AsciiDoc <<id>> and <<id,text>> become anchor links", () => {
  assert.match(body("= T\n\nSee <<divergence>> and <<watch,the watch list>>."), /\[divergence\]\(#divergence\)/);
  assert.match(body("= T\n\nSee <<watch,the watch list>>."), /\[the watch list\]\(#watch\)/);
});

test("inline admonition becomes a Starlight aside", () => {
  const out = body("= T\n\nNOTE: mind the gap.\n");
  assert.match(out, /:::note\nmind the gap\.\n:::/);
});

test("block admonition with delimiters becomes an aside", () => {
  const out = body("= T\n\n[IMPORTANT]\n====\nRead this.\n\nAnd this.\n====\n");
  assert.match(out, /:::note\[Important\]/);
  assert.match(out, /Read this\./);
  assert.match(out, /:::/);
});

test("block admonition without delimiters wraps the next paragraph", () => {
  const out = body("= T\n\n[TIP]\nA single-line tip.\n\nNext para.\n");
  assert.match(out, /:::tip\nA single-line tip\.\n:::/);
  assert.match(out, /Next para\./);
});

test("splitCells respects code spans and escaped pipes", () => {
  assert.deepEqual(splitCells("|`a` |b"), ["`a`", "b"]);
  assert.deepEqual(splitCells("|the `|>` op |pipes"), ["the `|>` op", "pipes"]);
  assert.deepEqual(splitCells("|x \\| y |z"), ["x | y", "z"]);
});

test("a header table becomes a GFM table", () => {
  const out = body(
    [
      "= T",
      "",
      '[cols="1,3",options="header"]',
      "|===",
      "|Error |Cause",
      "",
      "|`UnterminatedTag` |an opener with no closer",
      "|===",
    ].join("\n"),
  );
  assert.match(out, /\| Error \| Cause \|/);
  assert.match(out, /\| --- \| --- \|/);
  assert.match(out, /\| `UnterminatedTag` \| an opener with no closer \|/);
});

test("a headerless table gets a synthesized header row", () => {
  const out = body(["= T", "", "|===", "|a |b", "|c |d", "|==="].join("\n"));
  assert.match(out, /\|  \|  \|\n\| --- \| --- \|/); // empty header
  assert.match(out, /\| a \| b \|/);
  assert.match(out, /\| c \| d \|/);
});

test("multiline cells are joined", () => {
  const out = body(
    ["= T", "", '[cols="1,1"]', "|===", "|first", "continued |second", "|==="].join("\n"),
  );
  assert.match(out, /\| first continued \| second \|/);
});

test("unhandled block-attribute lines are dropped", () => {
  const out = body("= T\n\n[.lead]\nA lead paragraph.\n\n[horizontal]\nterm:: def\n");
  assert.doesNotMatch(out, /\[\.lead\]/);
  assert.doesNotMatch(out, /\[horizontal\]/);
  assert.match(out, /A lead paragraph\./);
});

test("routeFor knows the explicit pages and the ADR pattern", () => {
  assert.equal(routeFor("maxbars"), "/engine/maxbars/");
  assert.equal(routeFor("adr-final-review"), "/adr/adr-final-review/");
  assert.equal(routeFor("bogus"), null);
});

test("a full small document converts coherently", () => {
  const r = convert(
    [
      "= Concepts",
      ":navtitle: Concepts",
      "",
      "== Everything is a helper",
      "",
      "`{{{city}}}` calls xref:prelude.adoc[helper `city`]. See {hbs}.",
      "",
      "[source,text]",
      "----",
      "{{city}}",
      "----",
    ].join("\n"),
  );
  assert.match(r.frontmatter, /title: Concepts/);
  assert.match(r.body, /^## Everything is a helper$/m);
  assert.match(r.body, /\[helper `city`\]\(\/engine\/prelude\/\)/);
  assert.match(r.body, /See Handlebars\./);
  assert.match(r.body, /```text\n\{\{city\}\}\n```/);
  assert.equal(r.warnings.length, 0);
});
