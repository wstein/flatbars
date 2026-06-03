#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:tmgrammar — the drift gate for the TextMate FALLBACK grammar (ADR-017).
//
//   node scripts/check-tmgrammar.mjs
//
// The fallback is the well-known Handlebars TextMate grammar, re-identified as
// `source.flatbars` and extended for all four dialects (inverse sections, Mustache
// inheritance, set delimiters, MaxBars operators). It keeps the standard Handlebars
// scope names so themes colour FlatBars the way developers already know.
//
// That grammar is RICHER than the engine — it splits a tag into sigil / name /
// args / literals, where the engine paints one kind per tag — so a scope==kind
// bijection does not fit. Instead this gate checks, FOR EACH DIALECT, the two
// things the engine actually defines and a stateless grammar can be held to:
//
//   1. TAG BOUNDARIES — exactly the characters the engine marks as inside a
//      FlatBars tag are the characters the grammar scopes as a tag. (Every FlatBars
//      tag scope ends in `.handlebars`; everything else — host text, and a leading
//      YAML front-matter block — is left plain or scoped `*.yaml`, never
//      `.handlebars`.) This catches the Exhibit-A/B class of begin/end drift.
//   2. LITERALS — wherever the engine carves a `string`/`number`, the grammar
//      scopes it `string.quoted.*` / `constant.numeric.*` too.
//
// Everything else (which helper is a keyword, argument colouring, operators) is
// allowed enrichment: the fallback is the floor, the LSP is the authority. Set-
// delimiter SWITCHES are out of scope — a stateless grammar cannot track the new
// delimiters that follow `{{=A B=}}` (the LSP does); the directive itself is checked.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { tokenize } from "../lab/vendor/flatbars-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const editors = resolve(here, "..", "editors");
const require = createRequire(import.meta.url);
const onigPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const { Registry, parseRawGrammar, INITIAL } = (await import("vscode-textmate")).default;
const oniguruma = (await import("vscode-oniguruma")).default;

function fail(msg) {
  console.error(`✗ check:tmgrammar — ${msg}`);
  process.exit(1);
}

// Literal scopes (string/number) from the shared vocabulary — the only scopes the
// gate maps to an engine kind.
const vocab = JSON.parse(readFileSync(resolve(editors, "token-vocabulary.json"), "utf8"));
const litScope = new Map();
for (const kind of ["string", "number"]) {
  for (const s of vocab.kinds[kind].tmScopes) litScope.set(s, kind);
}

// ── The per-dialect corpus. Default delimiters; no set-delimiter SWITCH (the
//    stateless fallback gives up past `{{=A B=}}`). `note` documents the form. ────
const CORPUS = [
  // FullBars — Handlebars-faithful.
  { dialect: "fullbars", src: "Hello, {{name}}!", note: "interpolation" },
  { dialect: "fullbars", src: "{{name.first}} {{name.last}}", note: "dotted paths" },
  { dialect: "fullbars", src: "raw: {{{html}}} {{&html}}", note: "unescaped" },
  { dialect: "fullbars", src: "{{#each items}}{{name}}{{/each}}", note: "section + close" },
  { dialect: "fullbars", src: "{{#if a}}x{{else}}y{{/if}}", note: "block + else" },
  { dialect: "fullbars", src: "{{> row}} {{>* which}}", note: "partials" },
  { dialect: "fullbars", src: "a{{! short }}b {{!-- long {{x}} --}}c", note: "comments" },
  { dialect: "fullbars", src: "{{{{raw}}}}{{x}}{{{{/raw}}}}", note: "raw block (body inside)" },
  { dialect: "fullbars", src: '{{ "x" }} {{#if (gt qty 5)}}{{/if}}', note: "string + number literals" },
  // MinBars — Mustache: inverse, inheritance, set-delimiter directive.
  { dialect: "minbars", src: "{{#items}}{{.}}{{/items}}", note: "section + implicit" },
  { dialect: "minbars", src: "{{^items}}none{{/items}}", note: "inverted section" },
  { dialect: "minbars", src: "{{<layout}}{{$title}}Hi{{/title}}{{/layout}}", note: "inheritance" },
  { dialect: "minbars", src: "{{=<% %>=}}", note: "set-delimiter directive (no switch follow-up)" },
  { dialect: "minbars", src: "{{! c }} {{&raw}} {{{trip}}}", note: "comment + unescaped" },
  // RawBars — meaning-free core; extras off ⇒ {{&}}/{{^}}/{{{{…}}}} are error tags.
  { dialect: "rawbars", src: "{{city}} {{#each x}}{{/each}}", note: "core forms" },
  { dialect: "rawbars", src: "{{&x}} {{^x}}b{{/x}}", note: "disallowed shapes are still tags (engine: error)" },
  // MaxBars — infix operators + pipes (enrichment) over the same tags.
  { dialect: "maxbars", src: "{{ a + b * c }}", note: "arithmetic operators" },
  { dialect: "maxbars", src: '{{ label ?? "n/a" }}', note: "coalesce + string" },
  { dialect: "maxbars", src: "{{ items | first }}", note: "pipe" },
  { dialect: "maxbars", src: "{{#if a}}x{{elif b}}y{{/if}}", note: "elif clause" },
  { dialect: "maxbars", src: "{{ qty * 2 }}", note: "number literal" },
  { dialect: "maxbars", src: "{{ (add a 1) }}", note: "subexpression + number" },
  // Interaction cases: `|` as a block param (not a pipe), hash args + string literal.
  { dialect: "fullbars", src: "{{#each xs as |x i|}}{{x}}{{/each}}", note: "block params" },
  { dialect: "fullbars", src: '{{> row name="x"}}', note: "partial hash + string" },
  // Inline decorators and partial blocks (a3360f6 / 845aed4) — already correct, now pinned.
  { dialect: "fullbars", src: '{{#*inline "layout"}}b{{/inline}}', note: "inline decorator block + string" },
  { dialect: "fullbars", src: "{{#>layout}}b{{/layout}}", note: "partial block" },
  { dialect: "maxbars", src: "{{#>layout}}b{{/layout}}", note: "partial block (maxbars re-spelling)" },
];

// ── Load the grammar; the one external include (YAML front matter) gets an empty
//    stub grammar (its content is never a FlatBars tag, so empty is correct here). ──
const EXTERNAL = ["source.yaml"];
await oniguruma.loadWASM(readFileSync(onigPath).buffer);
const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scope) => {
    if (scope === "source.flatbars") {
      return parseRawGrammar(readFileSync(resolve(editors, "flatbars.tmLanguage.json"), "utf8"), "flatbars.tmLanguage.json");
    }
    if (EXTERNAL.includes(scope)) {
      return parseRawGrammar(JSON.stringify({ scopeName: scope, patterns: [] }), `${scope}.json`);
    }
    return null;
  },
});
const grammar = await registry.loadGrammar("source.flatbars");
if (!grammar) fail("could not load editors/flatbars.tmLanguage.json as source.flatbars");

// The engine's per-character truth: which chars are inside a tag, and the literals.
function engineMasks(src, dialect) {
  const tag = new Array(src.length).fill(false);
  const lit = new Array(src.length).fill(null);
  for (const s of tokenize(src, dialect)) {
    if (s.role === "tag") {
      for (let i = s.from; i < s.to; i++) tag[i] = true;
    } else if (s.kind === "string" || s.kind === "number") {
      for (let i = s.from; i < s.to; i++) lit[i] = s.kind;
    }
  }
  return { tag, lit };
}

// The grammar's per-character view: a char is "in a tag" if any scope ends in
// `.handlebars`; literals come from the vocabulary's string/number scopes.
function grammarMasks(src) {
  const tag = new Array(src.length).fill(false);
  const lit = new Array(src.length).fill(null);
  let stack = INITIAL;
  let base = 0;
  for (const line of src.split("\n")) {
    const r = grammar.tokenizeLine(line, stack);
    for (const t of r.tokens) {
      const isTag = t.scopes.some((s) => s.endsWith(".handlebars"));
      let litKind = null;
      for (const s of t.scopes) if (litScope.has(s)) litKind = litScope.get(s);
      for (let i = t.startIndex; i < t.endIndex; i++) {
        tag[base + i] = isTag;
        if (litKind) lit[base + i] = litKind;
      }
    }
    stack = r.ruleStack;
    base += line.length + 1; // + the "\n"
  }
  return { tag, lit };
}

let checked = 0;
for (const { src, dialect, note } of CORPUS) {
  const e = engineMasks(src, dialect);
  const g = grammarMasks(src);

  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") continue;
    if (e.tag[i] !== g.tag[i]) {
      const ctx = `${JSON.stringify(src)} @${i} (${JSON.stringify(src[i])})`;
      fail(`[${dialect}] ${note}: tag-boundary disagreement at ${ctx} — engine ${e.tag[i] ? "tag" : "content"}, grammar ${g.tag[i] ? "tag" : "content"}`);
    }
    if (e.lit[i] && g.lit[i] !== e.lit[i]) {
      const ctx = `${JSON.stringify(src)} @${i} (${JSON.stringify(src[i])})`;
      fail(`[${dialect}] ${note}: literal disagreement at ${ctx} — engine ${e.lit[i]}, grammar ${g.lit[i] ?? "plain"}`);
    }
  }
  if (!e.tag.includes(true)) fail(`[${dialect}] ${note}: fixture exercises no tag (corpus bug)`);
  checked++;
}

console.log(`✓ check:tmgrammar — Handlebars fallback agrees with the engine on tag boundaries + literals across ${checked} fixtures (rawbars/minbars/fullbars/maxbars)`);
