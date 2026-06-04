// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the pure semantic-token logic (no transport). Exercises the
// vocabulary-derived legend, the flatten + run-length tokenizer, and the LSP
// delta encoding — decoding it back to assert the round-trip.
import assert from "node:assert/strict";
import {
  buildLegend,
  dialectDiagnostics,
  dialectForLanguageId,
  dialectForUri,
  documentSymbolsOf,
  encodeSemanticTokens,
  foldingRangesOf,
  formatDocument,
  parseDiagnostics,
  resolveDialect,
  tokensOf,
  vocabulary,
} from "../src/tokens.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
};

// ── Legend derives from the vocabulary ──────────────────────────────────────
t("legend types/modifiers are the vocabulary's, de-duplicated in order", () => {
  const legend = buildLegend();
  assert.deepEqual(legend.tokenTypes, ["variable", "macro", "keyword", "comment", "string", "number", "operator", "function"]);
  assert.deepEqual(legend.tokenModifiers, ["readonly", "invalid"]);
  // every kind's lsp.type is in the legend (no kind names a type the legend omits)
  for (const def of Object.values(vocabulary.kinds)) {
    assert.ok(legend.tokenTypes.includes(def.lsp.type), `missing type ${def.lsp.type}`);
  }
});

// ── Sparse emission: only the kinds the grammar can't get right ─────────────
t("tokensOf emits ONLY interior operator/string for a MaxBars tag (not the tag)", () => {
  // {{ a ?? "b" }} — the LSP corrects `??` and "b" (dialect-scoped); the `expr` tag
  // is left to the TextMate grammar, so no whole-tag token is emitted.
  assert.deepEqual(tokensOf('{{ a ?? "b" }}', "maxbars"), [
    { line: 0, char: 5, length: 2, kind: "operator" },
    { line: 0, char: 8, length: 3, kind: "string" },
  ]);
});

t("tokensOf leaves structural tags to the grammar (no whole-tag tokens)", () => {
  // The reported bug: {{{x}}} must NOT be flattened to one semantic token; the
  // grammar paints braces-vs-name. Likewise plain interpolation and comments.
  assert.deepEqual(tokensOf("{{{test}}}", "fullbars"), [], "raw output: grammar shows through");
  assert.deepEqual(tokensOf("{{name}}", "fullbars"), [], "interpolation: grammar shows through");
  assert.deepEqual(tokensOf("a {{!-- c --}} b", "fullbars"), [], "comment: grammar shows through");
});

t("tokensOf still emits the kinds the grammar gives up on", () => {
  assert.deepEqual(tokensOf("{{=<% %>=}}", "minbars").map((x) => x.kind), ["set-delimiter"]);
  assert.deepEqual(tokensOf("{{&x}}", "rawbars").map((x) => x.kind), ["error"]);
});

t("plain content produces no tokens", () => {
  assert.deepEqual(tokensOf("just text, no tags", "fullbars"), []);
});

// ── Dialect resolution: languageId first, then native extension, then default ──
t("dialectForLanguageId maps the four dialect languages; umbrella/others -> null", () => {
  assert.equal(dialectForLanguageId("maxbars"), "maxbars");
  assert.equal(dialectForLanguageId("rawbars"), "rawbars");
  assert.equal(dialectForLanguageId("flatbars"), null); // umbrella
  assert.equal(dialectForLanguageId("handlebars"), null); // not ours
});
t("dialectForUri maps every dialect extension (long, short, and host-compat)", () => {
  // Long-form per-dialect natives
  assert.equal(dialectForUri("file:///x/page.rawbars"), "rawbars");
  assert.equal(dialectForUri("file:///x/page.minbars"), "minbars");
  assert.equal(dialectForUri("file:///x/page.fullbars"), "fullbars");
  assert.equal(dialectForUri("file:///x/page.maxbars"), "maxbars");
  // Short-form aliases
  assert.equal(dialectForUri("file:///x/page.rbars"), "rawbars");
  assert.equal(dialectForUri("file:///x/page.mbars"), "minbars");
  assert.equal(dialectForUri("file:///x/page.fbars"), "fullbars");
  assert.equal(dialectForUri("file:///x/page.xbars"), "maxbars");
  // Host-compat: Handlebars / Mustache extensions claimed by their semantic peers
  assert.equal(dialectForUri("file:///x/page.hbs"), "fullbars");
  assert.equal(dialectForUri("file:///x/page.handlebars"), "fullbars");
  assert.equal(dialectForUri("file:///x/page.mustache"), "minbars");
  // The retired umbrella and unrelated extensions resolve to null.
  assert.equal(dialectForUri("file:///x/page.flatbars"), null);
  assert.equal(dialectForUri("file:///x/page.txt"), null);
});
// ── Parse diagnostics (ADR-023): per-dialect, with tag-covering ranges ──────
t("parseDiagnostics flags {{#if a == 1}} off MaxBars, clean on MaxBars", () => {
  const src = "{{#if a == 1}}x{{/if}}";
  const full = parseDiagnostics(src, "fullbars");
  assert.equal(full.length, 1, "one error off MaxBars");
  assert.match(full[0].message, /unexpected token/i);
  assert.equal(full[0].start, 8, "points at the ==");
  assert.equal(full[0].end, 14, "range extends to the tag close }}");
  assert.deepEqual(parseDiagnostics(src, "maxbars"), [], "MaxBars accepts ==");
  assert.deepEqual(parseDiagnostics("{{name}}", "fullbars"), [], "a clean template has none");
});

t("resolveDialect: languageId wins, then uri, then the configured default", () => {
  assert.equal(resolveDialect("maxbars", "file:///x/a.flatbars", "fullbars"), "maxbars"); // id wins
  assert.equal(resolveDialect("flatbars", "file:///x/a.rawbars", "fullbars"), "rawbars"); // umbrella -> uri
  assert.equal(resolveDialect("flatbars", "file:///x/a.flatbars", "minbars"), "minbars"); // -> default
});

// ── LSP wire encoding round-trips to the same positioned tokens ─────────────
t("encodeSemanticTokens delta-encodes; decoding restores the tokens", () => {
  const src = '{{ a ?? "b" }}';
  const legend = buildLegend();
  const { data } = encodeSemanticTokens(src, "maxbars");
  assert.equal(data.length % 5, 0);

  // decode the LSP delta stream back to absolute (line, char, type, mods)
  const decoded = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [dL, dC, len, type, mods] = data.slice(i, i + 5);
    line += dL;
    char = dL === 0 ? char + dC : dC;
    decoded.push({ line, char, length: len, type: legend.tokenTypes[type], mods });
  }
  // Sparse: only the operator and string are emitted (the expr tag is the grammar's).
  assert.deepEqual(decoded, [
    { line: 0, char: 5, length: 2, type: "operator", mods: 0 },
    { line: 0, char: 8, length: 3, type: "string", mods: 0 },
  ]);
});

t("a dialect-disallowed shape emits an error token with the invalid modifier", () => {
  const legend = buildLegend();
  const { data } = encodeSemanticTokens("{{&x}}", "rawbars"); // extras off ⇒ error
  assert.equal(legend.tokenTypes[data[3]], "variable");
  assert.equal(data[4], 1 << legend.tokenModifiers.indexOf("invalid"), "invalid modifier set");
});

// ── shrinkToInner edge cases: braces, whitespace-control ~, set-delim, raw block ──
// All flow through encodeSemanticTokens → tokensOf → flatten → shrinkToInner. We
// pick the embedded text out of the source so an offset edit doesn't break the
// assertion.
function findToken(src, dialect, needle) {
  const at = src.indexOf(needle);
  for (const t of tokensOf(src, dialect)) {
    if (t.char === at && t.length === needle.length) return t;
  }
  return null;
}

t("shrinkToInner trims braces and whitespace-control sigils off keyword spans", () => {
  // {{else}}, {{~else~}}, {{~ else ~}} — the LSP `keyword` span must cover the
  // word `else` only, leaving every brace and `~` to the grammar's embedded scope.
  for (const src of ["{{else}}", "{{~else~}}", "{{~ else ~}}", "{{ else }}"]) {
    const tok = findToken(src, "fullbars", "else");
    assert.ok(tok, `keyword span carved out for ${JSON.stringify(src)}`);
    assert.equal(tok.kind, "keyword");
  }
});

t("shrinkToInner trims set-delim and error tag spans likewise", () => {
  // {{= <% %> =}} — the trim takes braces and whitespace; the `=` markers stay
  // INSIDE the set-delim semantic token (intentional: themes paint them as the
  // directive). Span: `= <% %> =`.
  const setSrc = "{{= <% %> =}}";
  const setToks = tokensOf(setSrc, "minbars");
  assert.equal(setToks.length, 1);
  const [setTok] = setToks;
  assert.equal(setTok.kind, "set-delimiter");
  assert.equal(setTok.char, 2, "set-delim starts after `{{`");
  assert.equal(setSrc.slice(setTok.char, setTok.char + setTok.length), "= <% %> =");
  // {{&x}} on rawbars → error; trim skips `{{` and `}}`, leaves `&x`.
  const errSrc = "{{&x}}";
  const errToks = tokensOf(errSrc, "rawbars");
  assert.equal(errToks.length, 1);
  assert.equal(errToks[0].kind, "error");
  assert.equal(errToks[0].char, 2, "error skips the leading {{");
  assert.equal(errToks[0].length, 2, "error covers `&x`, not the closing `}}`");
});

// ── Operation-painter coverage (vocab-driven operationPosition) ─────────────
t("operation painter: head identifier, no sigil, in catalog → painted", () => {
  // `lookup` is in the prelude. `{{lookup x y}}` → `lookup` painted as operation,
  // `x` and `y` stay default.
  const src = "{{lookup x y}}";
  const opTok = findToken(src, "fullbars", "lookup");
  assert.ok(opTok && opTok.kind === "operation", "lookup painted");
});

t("operation painter: plain variable stays default-coloured", () => {
  // `name` isn't in the catalog → no tokens emitted.
  assert.deepEqual(tokensOf("{{name}}", "fullbars"), []);
});

t("operation painter: partial name always paints (no catalog check)", () => {
  // `mypartial` is a user-defined partial name, never in the catalog.
  const src = "{{> mypartial}}";
  const tok = findToken(src, "fullbars", "mypartial");
  assert.ok(tok && tok.kind === "operation", "partial name always paints");
});

t("operation painter: control-tag heads handled by the grammar, not LSP", () => {
  // {{#if cond}} — the `#if` is grammar-painted (keyword.control.section); the
  // LSP must NOT emit an `operation` span over `if`. `cond` isn't in the catalog.
  const toks = tokensOf("{{#if cond}}", "fullbars");
  for (const t of toks) assert.notEqual(t.kind, "operation");
});

t("operation painter: subexpression heads paint when known", () => {
  // {{#if (lookup ctx "x")}} — `lookup` inside the parens is a head.
  const src = '{{#if (lookup ctx "x")}}';
  const tok = findToken(src, "fullbars", "lookup");
  assert.ok(tok && tok.kind === "operation");
});

t("operation painter: MaxBars pipe targets paint when known", () => {
  // {{ x | upcase }} — `upcase` is the pipe target, in the catalog.
  const src = "{{ x | upcase }}";
  const tok = findToken(src, "maxbars", "upcase");
  assert.ok(tok && tok.kind === "operation");
});

t("operation painter: `||` (logical-or) does not fire a pipe paint", () => {
  // `{{#if a || b}}` — the `||` is two `|` characters; the painter must skip both.
  const toks = tokensOf("{{#if a || b}}", "maxbars");
  for (const tok of toks) assert.notEqual(tok.kind, "operation");
});

t("operation painter: trailing `|` doesn't crash", () => {
  // {{ xs | }} — the painter looks for an identifier after the pipe; none here.
  assert.doesNotThrow(() => tokensOf("{{ xs | }}", "maxbars"));
});

t("operation painter: identifier followed by `.` or `/` (path) stays default", () => {
  // `lookup.foo` — even if `lookup` is in the catalog, this is path access, not
  // a bare helper call. Must NOT paint.
  const toks = tokensOf("{{lookup.foo}}", "fullbars");
  for (const tok of toks) assert.notEqual(tok.kind, "operation");
});

t("operation painter: dialect-cross — MaxBars `??` is silent in MinBars", () => {
  // `{{ a ?? "b" }}` on MaxBars emits operator+string; the same source on MinBars
  // should emit NEITHER (MinBars doesn't have the operator and the engine doesn't
  // even reach the `??` as a known token).
  const max = tokensOf('{{ a ?? "b" }}', "maxbars").map((t) => t.kind);
  assert.deepEqual(max, ["operator", "string"], "MaxBars sees the operator + string");
  const min = tokensOf('{{ a ?? "b" }}', "minbars").map((t) => t.kind);
  for (const k of min) assert.notEqual(k, "operator", "MinBars must NOT paint `??` as operator");
});

// ── Dialect diagnostics: shapes the parser accepts but the dialect rejects ──
t("dialectDiagnostics — plain MinBars stays clean", () => {
  assert.deepEqual(dialectDiagnostics("{{name}}", "minbars"), []);
  assert.deepEqual(dialectDiagnostics("{{#items}}{{.}}{{/items}}", "minbars"), []);
  assert.deepEqual(dialectDiagnostics("{{a.b.c}}", "minbars"), []);
  assert.deepEqual(dialectDiagnostics("{{!-- comment --}}", "minbars"), []);
});

t("dialectDiagnostics — MinBars flags subexpressions", () => {
  const src = '{{#each (lookup x "y")}}{{/each}}';
  const ds = dialectDiagnostics(src, "minbars");
  assert.equal(ds.length, 1);
  assert.match(ds[0].message, /Subexpressions/);
  assert.equal(src[ds[0].start], "(", "diagnostic lands on the open paren");
});

t("dialectDiagnostics — MinBars flags helper invocations", () => {
  const ds = dialectDiagnostics("{{lookup x y}}", "minbars");
  assert.equal(ds.length, 1);
  assert.match(ds[0].message, /Helper invocations/);
});

t("dialectDiagnostics — RawBars flags the same shapes", () => {
  assert.equal(dialectDiagnostics("{{#each (lookup x)}}{{/each}}", "rawbars").length, 1);
  assert.equal(dialectDiagnostics("{{lookup x y}}", "rawbars").length, 1);
});

t("dialectDiagnostics — FullBars and MaxBars accept both shapes", () => {
  assert.deepEqual(dialectDiagnostics('{{#each (lookup x "y")}}{{/each}}', "fullbars"), []);
  assert.deepEqual(dialectDiagnostics("{{lookup x y}}", "fullbars"), []);
  assert.deepEqual(dialectDiagnostics("{{ a ?? b }}", "maxbars"), []);
});

t("parseDiagnostics merges parser and dialect findings", () => {
  // The user's exact case from the session: opens cleanly as fullbars, fires two
  // diagnostics in minbars (the subexpression + the helper invocation later in
  // the template).
  const tpl = '{{#each (lookup this "items")}}{{escapeHtml this}}{{/each}}';
  const fb = parseDiagnostics(tpl, "fullbars");
  assert.equal(fb.length, 0, "fullbars accepts subexpressions and helper invocations");
  const mb = parseDiagnostics(tpl, "minbars");
  assert.ok(mb.length >= 2, "minbars flags both the subexpression and the helper invocation");
});

// ── Folding ranges (ADR-026) ────────────────────────────────────────────────
t("foldingRangesOf pairs block-open / block-close by body word", () => {
  const text = "{{#each xs}}\n  body\n{{/each}}";
  assert.deepEqual(foldingRangesOf(text, "fullbars"), [{ start: 0, end: 2 }]);
});

t("foldingRangesOf drops same-line opens (zero-length folds are invalid LSP)", () => {
  // {{#if cond}}body{{/if}} on one line: no fold range.
  assert.deepEqual(foldingRangesOf("{{#if x}}body{{/if}}", "fullbars"), []);
});

t("foldingRangesOf folds raw-block regions as a whole", () => {
  // Handlebars-form raw block (no `#` sigil; the `#` form is FlatBars-native and
  // would parse as an `error` in `fullbars`). The single raw-block span covers
  // open through close, so the fold range covers all three lines.
  const text = "{{{{raw}}}}\nliteral\n{{{{/raw}}}}";
  const ranges = foldingRangesOf(text, "fullbars");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 2);
});

// ── Document symbols (ADR-026) ──────────────────────────────────────────────
t("documentSymbolsOf projects block nesting as a symbol tree", () => {
  const text = "{{#each xs}}\n  {{#if cond}}\n    body\n  {{/if}}\n{{/each}}";
  const syms = documentSymbolsOf(text, "fullbars");
  assert.equal(syms.length, 1);
  assert.equal(syms[0].name, "#each");
  assert.equal(syms[0].children.length, 1);
  assert.equal(syms[0].children[0].name, "#if");
});

t("documentSymbolsOf drops unbalanced opens (parse diagnostics flag them)", () => {
  // Bare {{#if cond}} with no close.
  const syms = documentSymbolsOf("{{#if cond}}\nbody\n", "fullbars");
  assert.deepEqual(syms, []);
});

// ── Formatter (ADR-026) ─────────────────────────────────────────────────────
function applyEdits(text, edits) {
  let s = text;
  for (let i = edits.length - 1; i >= 0; i--) s = s.slice(0, edits[i].from) + edits[i].newText + s.slice(edits[i].to);
  return s;
}

t("formatter: no-sigil tags get Mustache padding ({{ name }})", () => {
  assert.equal(applyEdits("{{name}}", formatDocument("{{name}}", "fullbars")), "{{ name }}");
  assert.equal(applyEdits("{{   name   }}", formatDocument("{{   name   }}", "fullbars")), "{{ name }}");
});

t("formatter: control sigils glue at both ends ({{#each items}})", () => {
  assert.equal(
    applyEdits("{{#each  items}}", formatDocument("{{#each  items}}", "fullbars")),
    "{{#each items}}",
  );
  assert.equal(
    applyEdits("{{/each}}", formatDocument("{{/each}}", "fullbars")),
    "{{/each}}",
  );
});

t("formatter: partial keeps the space after `>` ({{> partial}})", () => {
  assert.equal(
    applyEdits("{{>partial}}", formatDocument("{{>partial}}", "fullbars")),
    "{{> partial}}",
  );
});

t("formatter: set-delim balances spaces inside the `=` pair ({{= A B =}})", () => {
  assert.equal(
    applyEdits("{{=<% %>=}}", formatDocument("{{=<% %>=}}", "minbars")),
    "{{= <% %> =}}",
  );
});

t("formatter: idempotent (running twice yields no further edits)", () => {
  const messy = "{{  name  }}\n{{#if  cond  }}\n{{/if}}\n";
  const once = applyEdits(messy, formatDocument(messy, "fullbars"));
  assert.deepEqual(formatDocument(once, "fullbars"), [], "second pass is a no-op");
});

t("formatter: leaves comments and raw blocks untouched", () => {
  assert.deepEqual(formatDocument("{{!  comment  }}", "fullbars"), []);
  assert.deepEqual(formatDocument("{{{{#raw}}}}body{{{{/raw}}}}", "fullbars"), []);
});

console.log(`✓ flatbars-lsp tokens unit tests passed (${passed})`);
