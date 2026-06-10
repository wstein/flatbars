// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the pure hover/completion logic (ADR-017): the editors/
// operations.json projection (operations.mjs) and the in-tag position resolution
// (tokens.mjs hoverAt/completionsAt). No transport — protocol.test.mjs covers the
// wire.
import assert from "node:assert/strict";
import { hoverAt, completionsAt, canonAt } from "../src/tokens.mjs";
import { OPERATIONS, operationByName, signatureOf, hoverMarkdown, completionItems, rewriteFor } from "../src/operations.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
};

// ── operations.json projection ──────────────────────────────────────────────
t("operations carry the engine's facts: kind, source, canonical, and prose doc", () => {
  assert.ok(OPERATIONS.length > 50, "the prelude projects many operations");
  for (const o of OPERATIONS) {
    assert.ok(["value", "inline", "block"].includes(o.kind), `${o.name}: ADR-019 kind`);
    assert.ok(["registered", "scoped", "alias", "synonym"].includes(o.source), `${o.name}: source`);
    // alias/synonym always name a canonical; a scoped var MAY (index→index0,
    // partial-block→yield); a registered op never does.
    if (o.source === "alias" || o.source === "synonym") assert.ok(o.canonical, `${o.name}: canonical target`);
    else if (o.source === "registered") assert.equal(o.canonical, null, `${o.name}: no canonical`);
    // Every operation is documented — registered ops via the required
    // OperationDef.doc field, scoped variables via scopedDocs.
    assert.ok(typeof o.doc === "string" && o.doc.length > 0, `${o.name}: has a prose doc`);
  }
});

t("operationByName resolves a known op and rejects an unknown one", () => {
  assert.equal(operationByName("each").kind, "block");
  assert.equal(operationByName("uppercase").kind, "inline");
  assert.equal(operationByName("definitely-not-an-op"), null);
});

t("signatureOf is synthesised from the kind (no prose)", () => {
  assert.equal(signatureOf({ name: "each", kind: "block" }), "{{#each …}}…{{/each}}");
  assert.equal(signatureOf({ name: "this", kind: "value" }), "{{this}}");
  assert.equal(signatureOf({ name: "eq", kind: "inline" }), "{{eq …}}");
});

t("hoverMarkdown distinguishes alias/synonym/scoped and includes the prose doc", () => {
  const up = hoverMarkdown(operationByName("uppercase"));
  assert.match(up, /inline operation/);
  assert.match(up, /Uppercases its argument\./, "includes the prelude doc prose");
  assert.match(hoverMarkdown(operationByName("downcase")), /deprecated alias of `lowercase`/);
  // Scoped variables are documented too (scopedDocs).
  const first = hoverMarkdown(operationByName("first"));
  assert.match(first, /scoped variable/);
  assert.match(first, /first iteration/, "scoped variables carry a prose doc");
});

t("completionItems exclude deprecated aliases; scoped sort after helpers", () => {
  const items = completionItems();
  const labels = items.map((i) => i.label);
  assert.ok(labels.includes("each") && labels.includes("uppercase"), "helpers offered");
  assert.ok(!labels.includes("downcase"), "deprecated alias excluded");
  const each = items.find((i) => i.label === "each");
  assert.equal(each.kind, "function");
  assert.ok(each.sortText.startsWith("0"), "helpers sort before scoped");
});

// ── In-tag position resolution (hoverAt / completionsAt) ─────────────────────
const tpl = "Hi {{uppercase name}} {{#each xs}}{{this}}{{/each}}";

t("hoverAt fires on an operation head inside a tag, with its range", () => {
  const h = hoverAt(tpl, "classicbars", 8); // inside `uppercase` (chars 5–14)
  assert.ok(h, "hover present");
  assert.match(h.markdown, /uppercase/);
  assert.equal(tpl.slice(h.start, h.end), "uppercase", "range is the operation word");
});

t("hoverAt is null outside a tag and on a non-operation word", () => {
  assert.equal(hoverAt(tpl, "classicbars", 0), null, "in surrounding text");
  assert.equal(hoverAt(tpl, "classicbars", 16), null, "`name` is not a prelude operation");
});

t("hoverAt is suppressed inside a string literal", () => {
  const s = '{{ a ?? "each" }}'; // "each" here is a string, not the block op
  assert.equal(hoverAt(s, "maxbars", 10), null, "no hover inside the quoted string");
});

t("completionsAt offers operations in a tag, nothing outside", () => {
  assert.ok(completionsAt(tpl, "classicbars", 8).length > 0, "inside a tag");
  assert.equal(completionsAt(tpl, "classicbars", 0).length, 0, "outside any tag");
});

// ── Canonicalization (rewriteFor / canonAt — the quick-fix data) ─────────────
t("rewriteFor offers alias + scoped rewrites, not synonyms or canonical names", () => {
  assert.equal(rewriteFor("downcase").canonical, "lowercase"); // deprecated alias
  assert.equal(rewriteFor("index").canonical, "index0"); // scoped non-canonical
  assert.equal(rewriteFor("partial-block").canonical, "yield");
  assert.equal(rewriteFor("isnt"), null, "synonym is endorsed — not rewritten");
  assert.equal(rewriteFor("index0"), null, "already canonical");
  assert.equal(rewriteFor("uppercase"), null, "ordinary operation");
});

t("canonAt resolves the word range + canonical inside a tag", () => {
  const c = canonAt("Hi {{{index}}}", "rawbars", 8); // inside `index`
  assert.ok(c && c.canonical === "index0");
  assert.equal("Hi {{{index}}}".slice(c.from, c.to), "index", "range is the word");
  // hyphenated scoped name captured whole
  assert.equal(canonAt("{{{partial-block}}}", "rawbars", 8).canonical, "yield");
});

t("canonAt is dialect-scoped and tag-scoped", () => {
  assert.equal(canonAt("{{{index}}}", "classicbars", 5), null, "scoped rewrite is RawBars/MaxBars-only");
  assert.ok(canonAt("{{{downcase x}}}", "classicbars", 5), "alias rewrite applies in any dialect");
  assert.equal(canonAt("index", "rawbars", 1), null, "outside any tag");
});

console.log(`✓ flatbars-lsp operations (hover/completion/code-action) unit tests passed (${passed})`);
