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
  parseSetDelimBody,
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
  assert.deepEqual(legend.tokenTypes, ["variable", "macro", "keyword", "comment", "embeddedDelimiter", "string", "number", "operator", "function"]);
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
  assert.deepEqual(tokensOf("{{{test}}}", "classicbars"), [], "raw output: grammar shows through");
  assert.deepEqual(tokensOf("{{name}}", "classicbars"), [], "interpolation: grammar shows through");
  assert.deepEqual(tokensOf("a {{!-- c --}} b", "classicbars"), [], "comment: grammar shows through");
});

t("tokensOf still emits the kinds the grammar gives up on", () => {
  assert.deepEqual(tokensOf("{{=<% %>=}}", "minbars").map((x) => x.kind), ["set-delimiter"]);
  assert.deepEqual(tokensOf("{{&x}}", "rawbars").map((x) => x.kind), ["error"]);
});

t("plain content produces no tokens", () => {
  assert.deepEqual(tokensOf("just text, no tags", "classicbars"), []);
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
  assert.equal(dialectForUri("file:///x/page.classicbars"), "classicbars");
  assert.equal(dialectForUri("file:///x/page.maxbars"), "maxbars");
  // Short-form aliases
  assert.equal(dialectForUri("file:///x/page.rbars"), "rawbars");
  assert.equal(dialectForUri("file:///x/page.mbars"), "minbars");
  assert.equal(dialectForUri("file:///x/page.fbars"), "classicbars");
  assert.equal(dialectForUri("file:///x/page.xbars"), "maxbars");
  // Trussbars AOT-compiled templates are MaxBars source.
  assert.equal(dialectForUri("file:///x/page.truss"), "maxbars");
  // Host-compat: Handlebars / Mustache extensions claimed by their semantic peers
  assert.equal(dialectForUri("file:///x/page.hbs"), "classicbars");
  assert.equal(dialectForUri("file:///x/page.handlebars"), "classicbars");
  assert.equal(dialectForUri("file:///x/page.mustache"), "minbars");
  // The retired umbrella and unrelated extensions resolve to null.
  assert.equal(dialectForUri("file:///x/page.flatbars"), null);
  assert.equal(dialectForUri("file:///x/page.txt"), null);
});
// ── Parse diagnostics (ADR-023): per-dialect, with tag-covering ranges ──────
t("parseDiagnostics flags {{#if a == 1}} off MaxBars, clean on MaxBars", () => {
  const src = "{{#if a == 1}}x{{/if}}";
  const full = parseDiagnostics(src, "classicbars");
  assert.equal(full.length, 1, "one error off MaxBars");
  assert.match(full[0].message, /unexpected token/i);
  assert.equal(full[0].start, 8, "points at the ==");
  assert.equal(full[0].end, 14, "range extends to the tag close }}");
  assert.deepEqual(parseDiagnostics(src, "maxbars"), [], "MaxBars accepts ==");
  assert.deepEqual(parseDiagnostics("{{name}}", "classicbars"), [], "a clean template has none");
});

t("resolveDialect: languageId wins, then uri, then the configured default", () => {
  assert.equal(resolveDialect("maxbars", "file:///x/a.flatbars", "classicbars"), "maxbars"); // id wins
  assert.equal(resolveDialect("flatbars", "file:///x/a.rawbars", "classicbars"), "rawbars"); // umbrella -> uri
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
    const tok = findToken(src, "classicbars", "else");
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
  const opTok = findToken(src, "classicbars", "lookup");
  assert.ok(opTok && opTok.kind === "operation", "lookup painted");
});

t("operation painter: plain variable stays default-coloured", () => {
  // `name` isn't in the catalog → no tokens emitted.
  assert.deepEqual(tokensOf("{{name}}", "classicbars"), []);
});

t("operation painter: partial name always paints (no catalog check)", () => {
  // `mypartial` is a user-defined partial name, never in the catalog.
  const src = "{{> mypartial}}";
  const tok = findToken(src, "classicbars", "mypartial");
  assert.ok(tok && tok.kind === "operation", "partial name always paints");
});

t("operation painter: control-tag heads handled by the grammar, not LSP", () => {
  // {{#if cond}} — the `#if` is grammar-painted (keyword.control.section); the
  // LSP must NOT emit an `operation` span over `if`. `cond` isn't in the catalog.
  const toks = tokensOf("{{#if cond}}", "classicbars");
  for (const t of toks) assert.notEqual(t.kind, "operation");
});

t("operation painter: subexpression heads paint when known", () => {
  // {{#if (lookup ctx "x")}} — `lookup` inside the parens is a head.
  const src = '{{#if (lookup ctx "x")}}';
  const tok = findToken(src, "classicbars", "lookup");
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
  const toks = tokensOf("{{lookup.foo}}", "classicbars");
  for (const tok of toks) assert.notEqual(tok.kind, "operation");
});

t("operation painter: dialect-cross — MaxBars `??` is silent in MinBars", () => {
  // `{{ a ?? "b" }}` on MaxBars emits operator+string; the same source on MinBars
  // gets no operator span from the engine AND surfaces an actionable
  // `dialectDiagnostics` rule pointing at `??`.
  const max = tokensOf('{{ a ?? "b" }}', "maxbars").map((t) => t.kind);
  assert.deepEqual(max, ["operator", "string"], "MaxBars sees the operator + string");
  // Negative: no operator span from the LSP under MinBars.
  const min = tokensOf('{{ a ?? "b" }}', "minbars").map((t) => t.kind);
  for (const k of min) assert.notEqual(k, "operator", "MinBars must NOT paint `??` as operator");
  // Positive: dialectDiagnostics fires the MaxBars-operator message on `??`.
  // Without this, the test would pass even if the entire diagnostic rule were
  // accidentally dropped — the old assertion checked only the kind absence.
  const ds = parseDiagnostics('{{ a ?? "b" }}', "minbars");
  assert.ok(
    ds.some((d) => /Operator `\?\?`.*MaxBars/.test(d.message)),
    "MinBars surfaces the MaxBars-operator diagnostic for `??`",
  );
});

// ── Delimiter-switched tags: LSP paints the new delimiters as `set-delimiter` ──
t("tokensOf paints opener+closer of non-default-delim tags", () => {
  // After `{{=<% %>=}}` the active delimiters become `<%` / `%>`. The grammar
  // is hard-coded to `{{` / `}}` and can't recognise `<%name%>` as a tag; the
  // LSP paints ONLY the `<%` and `%>` (as `set-delimiter`, the same kind as
  // the directive that introduced them) so the body stays default-coloured
  // and the tag reads like default-delim tags do under the grammar.
  const src = "{{=<% %>=}}\n<%name%>\n{{age}}\n<%={{ }}=%>\n{{name}}\n{{age}}";
  const toks = tokensOf(src, "minbars");
  // Both directives are painted as `set-delimiter` (inner body).
  const directives = toks.filter((t) => t.line === 0 || t.line === 3);
  assert.equal(directives.length, 2, "two set-delim directives painted");
  assert.ok(directives.every((t) => t.kind === "set-delimiter"));
  // <%name%> on line 1: opener at C0 (2 chars), closer at C6 (2 chars), body
  // (`name`) untouched.
  const lineOneToks = toks.filter((t) => t.line === 1);
  assert.equal(lineOneToks.length, 2, "opener + closer painted, body untouched");
  assert.deepEqual(lineOneToks.map((t) => ({ char: t.char, len: t.length, kind: t.kind })), [
    { char: 0, len: 2, kind: "set-delimiter" },
    { char: 6, len: 2, kind: "set-delimiter" },
  ]);
  // {{age}} between switches (line 2): plain content, engine doesn't see a tag.
  // {{name}} / {{age}} after switch-back (lines 4/5): grammar-painted, no LSP.
  assert.equal(toks.filter((t) => t.line === 2 || t.line === 4 || t.line === 5).length, 0);
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

t("dialectDiagnostics — ClassicBars and MaxBars accept both shapes", () => {
  assert.deepEqual(dialectDiagnostics('{{#each (lookup x "y")}}{{/each}}', "classicbars"), []);
  assert.deepEqual(dialectDiagnostics("{{lookup x y}}", "classicbars"), []);
  assert.deepEqual(dialectDiagnostics("{{ a ?? b }}", "maxbars"), []);
});

t("dialectDiagnostics — every non-MinBars dialect flags set-delim usage", () => {
  // Set-delim `{{=A B=}}` is a Mustache feature reserved for MinBars (ADR-015
  // amendment). ClassicBars / RawBars / MaxBars all reject it; without the
  // dialect rule the recovering parser emits a generic "LexError" with no
  // hint that the feature is dialect-gated.
  for (const dialect of ["classicbars", "rawbars", "maxbars"]) {
    const ds = dialectDiagnostics("{{=<% %>=}}\n<%name%>", dialect);
    assert.ok(ds.length >= 1, `set-delim flagged in ${dialect}`);
    const setDelimFinding = ds.find((d) => /Set-delimiter directives/.test(d.message));
    assert.ok(setDelimFinding, `set-delim-specific message in ${dialect}`);
    assert.match(setDelimFinding.message, /Mustache feature reserved for MinBars/);
  }
  // MinBars accepts set-delim silently (it IS the Mustache surface).
  assert.deepEqual(dialectDiagnostics("{{=<% %>=}}", "minbars"), []);
});

t("dialectDiagnostics — MinBars flags block parameters", () => {
  const ds = dialectDiagnostics("{{#each items as |item|}}{{/each}}", "minbars");
  assert.equal(ds.length, 1);
  assert.match(ds[0].message, /Block parameters/);
});

t("dialectDiagnostics — MinBars flags partial hash args", () => {
  const ds = dialectDiagnostics('{{> p name="v"}}', "minbars");
  assert.equal(ds.length, 1);
  assert.match(ds[0].message, /Partial hash arguments/);
});

t("dialectDiagnostics — MinBars flags MaxBars-only operators", () => {
  for (const [op, src] of [
    ["??", "{{ a ?? b }}"],
    ["==", "{{ a == b }}"],
    ["!=", "{{ a != b }}"],
    ["<=", "{{ a <= b }}"],
    ["<-", "{{ a <- b }}"],
    ["&&", "{{ a && b }}"],
  ]) {
    const ds = dialectDiagnostics(src, "minbars");
    assert.ok(ds.length >= 1, `${op} flagged`);
    assert.match(ds[0].message, new RegExp(`Operator.*${op.replace(/[?+*]/g, "\\$&")}.*MaxBars`));
  }
});

t("dialectDiagnostics — RawBars matches MinBars on the extended rules", () => {
  assert.equal(dialectDiagnostics("{{#each xs as |i|}}{{/each}}", "rawbars").length, 1);
  assert.equal(dialectDiagnostics('{{> p k="v"}}', "rawbars").length, 1);
  assert.equal(dialectDiagnostics("{{ a ?? b }}", "rawbars").length, 1);
});

t("dialectDiagnostics — every rule still fires inside a delim-switched tag", () => {
  // `bodyOfTag` strips the active opener / closer by length; without that fix
  // the rules saw `% lookup x y %>` instead of `lookup x y` and either
  // false-positived on the leading space or missed the real shape.
  const ctx = "{{=<% %>=}}\n";
  // 1) helper-args inside switched tag — already covered earlier; verify still fires.
  const helper = dialectDiagnostics(ctx + "<% lookup x y %>", "minbars");
  assert.ok(helper.some((d) => /Helper invocations/.test(d.message)));
  // 2) block params inside switched tag.
  const blockp = dialectDiagnostics(ctx + "<%#each xs as |i|%><%/each%>", "minbars");
  assert.ok(blockp.some((d) => /Block parameters/.test(d.message)));
  // 3) partial hash args inside switched tag.
  const hash = dialectDiagnostics(ctx + '<%> p k="v"%>', "minbars");
  assert.ok(hash.some((d) => /Partial hash arguments/.test(d.message)));
  // 4) MaxBars-only operator inside switched tag.
  const op = dialectDiagnostics(ctx + "<% a ?? b %>", "minbars");
  assert.ok(op.some((d) => /Operator `\?\?`/.test(d.message)));
});

t("paintOperations — `always-head` paints partial names with whitespace-control / decorator sigils", () => {
  // `{{~> mypartial ~}}` — whitespace-control on both ends, partial name in
  // the middle. paintHeadOperation skips `~&\s` then optional `>` + `*` + ws.
  const src1 = "{{~> mypartial ~}}";
  const toks1 = tokensOf(src1, "classicbars");
  const op1 = toks1.find((t) => t.kind === "operation");
  assert.ok(op1, "partial name painted under whitespace control");
  assert.equal(src1.slice(op1.char, op1.char + op1.length), "mypartial");

  // `{{>* decorator}}` — partial-block decorator marker. The `*` must be
  // consumed BEFORE the identifier scan.
  const src2 = "{{>* decoblock}}";
  const toks2 = tokensOf(src2, "classicbars");
  const op2 = toks2.find((t) => t.kind === "operation");
  assert.ok(op2, "partial-block decorator name painted past `>*`");
  assert.equal(src2.slice(op2.char, op2.char + op2.length), "decoblock");
});

t("dialectDiagnostics — delim-switched tags use active delimiters when extracting body", () => {
  // After `{{=<% %>=}}` the active delimiters are `<%` / `%>`. A delim-switched
  // tag with a single-name body (`<% erb_style_tags %>`) MUST be silent — the
  // body is a single identifier, identical to a default-delim `{{ name }}`.
  // Without delim-aware body extraction, `bodyOfTag` would leave `% ... %>` in
  // the body and the helper-args rule would false-positive on the leading space.
  const valid = `{{=<% %>=}}
<% erb_style_tags %>
<%={{ }}=%>
{{ ok }}`;
  assert.deepEqual(dialectDiagnostics(valid, "minbars"), [], "single-identifier body in switched tag stays silent");
  // But a REAL helper-args call inside a delim-switched tag must still fire.
  const invalid = `{{=<% %>=}}
<% lookup x y %>`;
  const ds = dialectDiagnostics(invalid, "minbars");
  assert.ok(ds.length >= 1, "helper-args inside switched tag still flagged");
  assert.match(ds[0].message, /Helper invocations/);
});

t("parseDiagnostics merges parser and dialect findings", () => {
  // The user's exact case from the session: opens cleanly as classicbars, fires two
  // diagnostics in minbars (the subexpression + the helper invocation later in
  // the template).
  const tpl = '{{#each (lookup this "items")}}{{escapeHtml this}}{{/each}}';
  const fb = parseDiagnostics(tpl, "classicbars");
  assert.equal(fb.length, 0, "classicbars accepts subexpressions and helper invocations");
  const mb = parseDiagnostics(tpl, "minbars");
  assert.ok(mb.length >= 2, "minbars flags both the subexpression and the helper invocation");
});

// ── Folding ranges (ADR-026) ────────────────────────────────────────────────
t("foldingRangesOf pairs block-open / block-close by body word", () => {
  const text = "{{#each xs}}\n  body\n{{/each}}";
  assert.deepEqual(foldingRangesOf(text, "classicbars"), [{ start: 0, end: 2 }]);
});

t("foldingRangesOf drops same-line opens (zero-length folds are invalid LSP)", () => {
  // {{#if cond}}body{{/if}} on one line: no fold range.
  assert.deepEqual(foldingRangesOf("{{#if x}}body{{/if}}", "classicbars"), []);
});

// ── parseSetDelimBody validation matches the engine's `tryReadSetDelim` ─────
t("parseSetDelimBody accepts the canonical Mustache forms", () => {
  assert.deepEqual(parseSetDelimBody("{{=<% %>=}}"), { open: "<%", close: "%>" });
  assert.deepEqual(parseSetDelimBody("<%={{ }}=%>"), { open: "{{", close: "}}" });
  assert.deepEqual(parseSetDelimBody("{{=[ ]=}}"), { open: "[", close: "]" });
  // Whitespace runs (spaces / tabs) inside the body collapse via split(/\s+/).
  assert.deepEqual(parseSetDelimBody("{{=  <%   %>  =}}"), { open: "<%", close: "%>" });
});

t("parseSetDelimBody rejects malformed shapes the engine would also reject", () => {
  // No `=` at all.
  assert.equal(parseSetDelimBody("{{<% %>}}"), null);
  // Only one part.
  assert.equal(parseSetDelimBody("{{=onlyone=}}"), null);
  // Three or more parts.
  assert.equal(parseSetDelimBody("{{=a b c=}}"), null);
  // `=` inside a delimiter (alignment with engine's "may not contain `=`" rule).
  assert.equal(parseSetDelimBody("{{=A=B C=}}"), null);
  assert.equal(parseSetDelimBody("{{=A B=C=}}"), null);
  // Empty body.
  assert.equal(parseSetDelimBody("{{==}}"), null);
});

t("paintOperations head identifier paints under switched delimiters", () => {
  // `lookup` is a catalogue operation; after `{{=<% %>=}}` it should still
  // paint via paintHeadOperation, which previously skipped only `{}~&\s` and
  // failed on the `<` opener.
  const src = "{{=<% %>=}}\n<%lookup x%>";
  const toks = tokensOf(src, "minbars");
  const opTok = toks.find((t) => t.line === 1 && t.kind === "operation");
  assert.ok(opTok, "head operation painted under <% %>");
  assert.equal(src.split("\n")[1].slice(opTok.char, opTok.char + opTok.length), "lookup");
});

t("shrinkToInner trims the active delimiter pair, not just {} / }}", () => {
  // For a `keyword`-kind tag (`{{else}}` under default delimiters), shrinkToInner
  // must trim exactly the active opener / closer length. Default-delim case is
  // the canonical use site of shrinkToInner; verify the keyword span covers
  // only `else`, not `{{else}}`.
  const src = "{{else}}";
  const toks = tokensOf(src, "classicbars");
  const kw = toks.find((t) => t.kind === "keyword");
  assert.ok(kw, "keyword span emitted");
  assert.equal(src.slice(kw.char, kw.char + kw.length), "else", "keyword span = `else` only");
  // Under switched delimiters the engine reclassifies `<%else%>` as plain
  // `expr` (clause-separator detection is hard-coded to the default `{{` /
  // `}}`), so the keyword path isn't exercised here — the paintOperations
  // catalogue test below covers the visible behaviour.
});

t("paintOperations finds `else` (a catalogue entry) under switched delimiters", () => {
  // The engine emits `<%else%>` as `expr` after a switch (keyword detection
  // is delim-bound). `else` IS in operations.json, so paintHeadOperation
  // paints it; the test proves the head walker advances past the `<%` opener.
  const src = "{{=<% %>=}}\n<%else%>";
  const toks = tokensOf(src, "minbars");
  const op = toks.find((t) => t.line === 1 && t.kind === "operation");
  assert.ok(op, "head identifier paints under <% %>");
  assert.equal(src.split("\n")[1].slice(op.char, op.char + op.length), "else");
  // The brace pair carries set-delimiter (not the body).
  const opener = toks.find((t) => t.line === 1 && t.char === 0 && t.kind === "set-delimiter");
  const closer = toks.find((t) => t.line === 1 && t.char === 6 && t.kind === "set-delimiter");
  assert.ok(opener && closer, "<% and %> painted as set-delimiter (theme-mapped to embedded colour)");
});

t("foldingRangesOf pairs blocks opened under switched delimiters", () => {
  // `<%#each xs%>` / `<%/each%>` — bodyWord must resolve `each` for both,
  // otherwise both return "" and the fold pairs incorrectly.
  const src = "{{=<% %>=}}\n<%#each xs%>\n  body\n<%/each%>";
  const folds = foldingRangesOf(src, "minbars");
  assert.equal(folds.length, 1);
  assert.equal(folds[0].start, 1);
  assert.equal(folds[0].end, 3);
  const syms = documentSymbolsOf(src, "minbars");
  assert.equal(syms.length, 1);
  assert.equal(syms[0].name, "#each");
});

t("foldingRangesOf folds raw-block regions as a whole", () => {
  // Handlebars-form raw block (no `#` sigil; the `#` form is FlatBars-native and
  // would parse as an `error` in `classicbars`). The single raw-block span covers
  // open through close, so the fold range covers all three lines.
  const text = "{{{{raw}}}}\nliteral\n{{{{/raw}}}}";
  const ranges = foldingRangesOf(text, "classicbars");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 2);
});

// ── Document symbols (ADR-026) ──────────────────────────────────────────────
t("documentSymbolsOf projects block nesting as a symbol tree", () => {
  const text = "{{#each xs}}\n  {{#if cond}}\n    body\n  {{/if}}\n{{/each}}";
  const syms = documentSymbolsOf(text, "classicbars");
  assert.equal(syms.length, 1);
  assert.equal(syms[0].name, "#each");
  assert.equal(syms[0].children.length, 1);
  assert.equal(syms[0].children[0].name, "#if");
});

t("documentSymbolsOf drops unbalanced opens (parse diagnostics flag them)", () => {
  // Bare {{#if cond}} with no close.
  const syms = documentSymbolsOf("{{#if cond}}\nbody\n", "classicbars");
  assert.deepEqual(syms, []);
});

// ── Formatter (ADR-026) ─────────────────────────────────────────────────────
function applyEdits(text, edits) {
  let s = text;
  for (let i = edits.length - 1; i >= 0; i--) s = s.slice(0, edits[i].from) + edits[i].newText + s.slice(edits[i].to);
  return s;
}

t("formatter: no-sigil tags get Mustache padding ({{ name }})", () => {
  assert.equal(applyEdits("{{name}}", formatDocument("{{name}}", "classicbars")), "{{ name }}");
  assert.equal(applyEdits("{{   name   }}", formatDocument("{{   name   }}", "classicbars")), "{{ name }}");
});

t("formatter: control sigils glue at both ends ({{#each items}})", () => {
  assert.equal(
    applyEdits("{{#each  items}}", formatDocument("{{#each  items}}", "classicbars")),
    "{{#each items}}",
  );
  assert.equal(
    applyEdits("{{/each}}", formatDocument("{{/each}}", "classicbars")),
    "{{/each}}",
  );
});

t("formatter: partial keeps the space after `>` ({{> partial}})", () => {
  assert.equal(
    applyEdits("{{>partial}}", formatDocument("{{>partial}}", "classicbars")),
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
  const once = applyEdits(messy, formatDocument(messy, "classicbars"));
  assert.deepEqual(formatDocument(once, "classicbars"), [], "second pass is a no-op");
});

t("formatter: leaves comments and raw blocks untouched", () => {
  assert.deepEqual(formatDocument("{{!  comment  }}", "classicbars"), []);
  assert.deepEqual(formatDocument("{{{{#raw}}}}body{{{{/raw}}}}", "classicbars"), []);
});

t("formatter: leaves malformed set-delim tags alone (set-delim consistency check)", () => {
  // `{{==}}` is a malformed set-delim shape the engine rejects — the formatter
  // must not rewrite it (would change byte length on an already-bad tag and
  // break "Format Document" idempotence on unparseable text). Same for
  // `{{=A=}}` / `{{=A}}` / `{{A=}}` — partial / missing `=` on either side.
  for (const malformed of ["{{==}}", "{{=A B}}", "{{A B=}}"]) {
    assert.deepEqual(formatDocument(malformed, "classicbars"), [], `malformed ${JSON.stringify(malformed)} left alone`);
  }
});

console.log(`✓ flatbars-lsp tokens unit tests passed (${passed})`);
