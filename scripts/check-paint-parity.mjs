// SPDX-License-Identifier: Apache-2.0
//
// Drift gate (debate proposal #2, strengthened): the online inner-token painter
// (lab/highlight-paint.mjs) must render EXACTLY like VS Code — and VS Code's
// rendering is the TextMate grammar (the structural floor) OVERLAID with the
// LSP's semantic tokens (editors/lsp/src/tokens.mjs `flatten`). So this builds
// that COMBINED oracle per char — `lsp[i] ?? grammarKind[i]` — and asserts the
// online painter matches it, across every dialect × a corpus.
//
// Why combined, not just-LSP: the LSP is SPARSE (it emits only the kinds the
// grammar can't floor — operations, literals, clause keywords); the grammar
// floors the rest (braces, block sigils, comment/partial delimiters). An
// earlier version of this gate compared only `operation`/`string`/`number` vs
// the LSP and so MISSED structural divergence — e.g. it never caught that the
// painter coloured only `else` in `{{else if paused}}` while VS Code (the LSP)
// fills the whole clause, nor that comment braces are punctuation. The combined
// oracle closes that gap: every coloured char is pinned.
//
// Normalisation: `operator` → default (the grammar scopes `|`/`+`/`>=` as
// keyword.operator, but the 2026-dark theme renders operators in the default
// colour, so the painter leaves them default BY DESIGN); `set-delimiter` → the
// painter's `delim` class. `keyword.operator` (the `>` in `{{#> p}}`, the `*` in
// a decorator) is likewise default.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { flatten } from "../editors/lsp/src/tokens.mjs";
import { paintCharKinds } from "../lab/highlight-paint.mjs";
import operationsJson from "../editors/operations.json" with { type: "json" };

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const editors = resolve(here, "..", "editors");

const OP_NAMES = new Set(operationsJson.operations.map((o) => o.name));
const isOperation = (name) => OP_NAMES.has(name);

// ── Load the committed TextMate grammar exactly as a real editor would (the same
//    setup scripts/check-tmgrammar.mjs uses). The grammar is the structural floor
//    VS Code paints UNDER the LSP semantic tokens. ──
const { Registry, parseRawGrammar } = (await import("vscode-textmate")).default;
const oniguruma = (await import("vscode-oniguruma")).default;
await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer);
const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scope) => {
    if (scope === "source.flatbars")
      return parseRawGrammar(readFileSync(resolve(editors, "flatbars.tmLanguage.json"), "utf8"), "flatbars.tmLanguage.json");
    if (scope === "source.yaml") return parseRawGrammar(JSON.stringify({ scopeName: scope, patterns: [] }), "yaml.json");
    return null;
  },
});
const grammar = await registry.loadGrammar("source.flatbars");
if (!grammar) {
  console.error("✘ could not load editors/flatbars.tmLanguage.json");
  process.exit(1);
}

// A TextMate scope stack → the painter's kind vocabulary. Order matters only
// where one token carries several scopes; the most specific (rightmost) wins, and
// punctuation.section.embedded is always rightmost on a delimiter.
function scopeKind(scopes) {
  const s = scopes.join(" ");
  if (s.includes("punctuation.section.embedded")) return "punct";
  if (s.includes("keyword.operator")) return null; // operators render default
  if (s.includes("keyword.control")) return "keyword";
  if (s.includes("keyword.directive")) return "delim"; // set-delimiter `=` markers
  if (s.includes("string.")) return "string";
  if (s.includes("constant.numeric")) return "number";
  if (s.includes("comment")) return "comment";
  return null;
}

// Both the LSP and the painter's vocabularies, normalised to one colour surface.
const norm = (k) => (k === "operator" ? null : k === "set-delimiter" ? "delim" : k || null);

function grammarKinds(line) {
  const g = new Array(line.length).fill(null);
  for (const t of grammar.tokenizeLine(line, null).tokens) {
    const k = scopeKind(t.scopes);
    for (let i = t.startIndex; i < t.endIndex; i++) g[i] = k;
  }
  return g;
}

const DIALECTS = ["classicbars", "maxbars", "minbars", "rawbars"];
// Each case is `[template, dialects?]`; default = all four. Set-delimiters are
// MinBars-only (the others reject them), so that case is scoped.
const CASES = [
  ["{{name}}"],
  ["{{loop.index0}} {{loop.first}}"],
  ["{{lookup ctx key}}"],
  ["{{toFixed price 2}}"],
  ["{{price | toFixed 2}}", ["maxbars"]],
  ["{{value | uppercase | trim}}", ["maxbars"]],
  ["{{sum items (add a b)}}"],
  ["{{eq x add}}"],
  ["{{#if (gt qty 0)}}x{{else}}y{{/if}}"],
  ["{{#if active}}a{{else if paused}}b{{else}}c{{/if}}"],
  ["{{#each (sortBy rows key) as |r|}}{{r.n}}{{/each}}"],
  ['{{concat "a" name 3}}'],
  ["{{> card}}"],
  ["{{> *dynamic}}"],
  ["{{#> layout}}body{{/layout}}"],
  ["{{#*inline \"x\"}}y{{/inline}}"],
  // raw blocks: braces are punct, the whole head (#name / /name) is the section
  // keyword — both spellings, in the dialects that accept each.
  ["{{{{myraw}}}}body {{x}}{{{{/myraw}}}}", ["classicbars"]],
  ["{{{{#myraw}}}}body {{x}}{{{{/myraw}}}}", ["rawbars", "maxbars"]],
  // Handlebars comments `{{! }}` / `{{!-- --}}` — NOT MaxBars, where `{{ }}` is
  // output-only (`bracesOutputOnly`, ADR-039): the comment is `{# … #}`, so a `{{!`
  // there lexes as output, not a comment.
  ["{{! comment with add toFixed }}", ["classicbars", "minbars", "rawbars"]],
  ["{{!-- a {{nested}}-looking comment --}}", ["classicbars", "minbars", "rawbars"]],
  // the Django/Jinja inline comment `{# … #}` (ADR-039 item 1) — the statement-tag
  // dialects (RawBars/MaxBars), where the engine lexes it as a comment.
  ["{# a {{nested}}-looking comment #}", ["rawbars", "maxbars"]],
  ["{{a + b * c}}", ["maxbars"]],
  ["{{price >= 100}}", ["maxbars"]],
  ["{{=<% %>=}}", ["minbars"]],
  ["Hello {{name}}, you have {{count items}} ({{round pct 1}}%)."],
  ["<h2>{{author.firstName}} {{author.lastName}}</h2>"],
  ["tasks is {{#if tasks}}truthy{{else}}falsy{{/if}}."],
  // {% %} statement tags (docs-19): the {%/%} braces are punct and the bareword head
  // (if/each/case/unless/local/endX) is the control keyword — args stay default. The
  // separators when/else/elif paint keyword too. nonEmpty-family only (RawBars/MaxBars).
  ["{% if (gt qty 0) %}x{% else %}y{% endif %}", ["rawbars", "maxbars"]],
  ["{% case status %}{% when \"shipped\" %}a{% else %}b{% endcase %}", ["rawbars", "maxbars"]],
  ["{% unless done %}todo{% endunless %}", ["rawbars", "maxbars"]],
  ["{% each rows %}{{this}}{% endeach %}", ["rawbars", "maxbars"]],
  ["{% local total=(add a b) %}{{total}}{% endlocal %}", ["rawbars", "maxbars"]],
  // the block-less {% set %} forward binding (docs-17): the `set` head is keyword,
  // the binding args stay default (the grammar's #statement_tag scopes the head).
  ["{% set total = (add a b) %}{{total}}", ["maxbars"]],
];

let fails = 0;
let chars = 0;
let pairs = 0;
for (const [tpl, dialects = DIALECTS] of CASES) {
  const g = grammarKinds(tpl);
  for (const dialect of dialects) {
    pairs++;
    const lsp = flatten(tpl, dialect);
    const mine = paintCharKinds(tpl, dialect, isOperation);
    for (let i = 0; i < tpl.length; i++) {
      chars++;
      const vscode = norm(lsp[i]) ?? g[i]; // semantic token wins, else grammar floor
      const online = norm(mine[i]);
      if ((vscode ?? null) !== (online ?? null)) {
        fails++;
        const ctx = tpl.slice(Math.max(0, i - 8), i + 8);
        console.error(
          `✘ [${dialect}] @${i} "${ctx}"  VSCode=${vscode ?? "·"}  online=${online ?? "·"}\n   ${tpl}`,
        );
      }
    }
  }
}

if (fails) {
  console.error(`\n✘ check:paint-parity — ${fails} char(s) diverge from VS Code (grammar + LSP).`);
  process.exit(1);
}
console.log(
  `✓ check:paint-parity — online painter ≡ VS Code (TextMate grammar + LSP) per char across ` +
    `${pairs} dialect×case pairs (${chars} chars).`,
);
