#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate / check the syntax-highlighter golden snapshots. Mirrors the
// gen:catalog/check:catalog and gen:conformance/check:conformance pattern:
//
//   node scripts/gen-highlight.mjs            # regenerate the golden file
//   node scripts/gen-highlight.mjs --check    # CI: fail if highlighting drifted
//
// WHY THIS EXISTS (design-debate consensus): rendering has three drift gates
// (examples:verify, test:compile, check:catalog); highlighting had NONE, which is
// why the Exhibit-A/B mis-highlighting shipped silently. This gate pins the
// highlighter output over a curated corpus so a change is a deliberate, reviewable
// diff (rerun gen:highlight), never an accident.
//
// ENGINE-DERIVED (ADR-014, Tier 1): the golden source is the engine itself —
// `highlightSpans(src, dialect)` and `tokenize(src, dialect)` from the committed
// `flatbars-js` bundle, the same functions the front-ends and `flatbars-lsp` paint
// from. This is the true "highlighting == what the engine lexes" oracle, not a
// snapshot of a regex. The corpus carries the Exhibit A/B regressions plus the
// cases a regex cannot do: set-delimiter statefulness, per-dialect tag boundaries,
// the clause keywords, and (ADR-017) the interior string/number/operator axis.
//
// Each case pins BOTH views: `spans` (the tag-role projection the Lab/tutorials
// paint) and `tokens` (the full ADR-017 tag+interior vocabulary the editor layer
// consumes). A drift in either fails the gate.
//
// NOTE: long comments `{{!-- … --}}` are coloured (the lexer emits them as a
// span-only token under `keepLongComments`, which only the highlighter sets — the
// render/compile token stream is unchanged). Host *data* highlighting (YAML) is a
// separate concern (real `lang-yaml` + a data-side decorator), out of this
// FlatBars-syntax gate's scope.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { highlightSpans, tokenize } from "../lab/vendor/flatbars-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "highlight-golden.json");

// The corpus. Each case runs through `highlightSpans(src, dialect)`. `note`
// documents the invariant the case protects. Exported so the vocabulary-integrity
// gate (scripts/check-vocab.mjs) can reuse the one curated corpus as its witness
// of the kinds the engine actually emits — no second corpus to drift.
export const CORPUS = [
  // ── Regression exhibits from the design debate ──────────────────────────
  { id: "exhibit-a-long-comment", dialect: "classicbars", note: "the whole {{!-- name --}} is ONE comment span and the trailing `!` is OUTSIDE it — the regex closed the comment at the inner }} (Exhibit A fixed)", src: "Hello, {{!-- name --}}!" },
  { id: "exhibit-b-unterminated-comment", dialect: "classicbars", note: "an unterminated {{!-- swallows to the next --}} (one comment span) exactly as the lexer does — no stray raw tag (Exhibit B fixed)", src: "escaped: {{html}}\nraw:     {{!-- html}}\namp:     {{&html--}}" },
  { id: "unterminated-tag", dialect: "classicbars", note: "an unterminated {{ with no }} recovers to an `unterminated` span (ADR-023) instead of dropping all highlighting; the earlier {{name}} stays lit and the scan resyncs to the broken tail", src: "Hi {{name}} more {{oops" },

  // ── Interpolation ───────────────────────────────────────────────────────
  { id: "expr", dialect: "classicbars", note: "{{name}} → expr", src: "Hello, {{name}}!" },
  { id: "triple-raw", dialect: "classicbars", note: "{{{x}}} → raw (unescaped)", src: "raw: {{{html}}}" },
  { id: "amp-raw", dialect: "classicbars", note: "{{&x}} → raw", src: "amp: {{&html}}" },
  { id: "dotted", dialect: "classicbars", note: "dotted path stays one expr tag", src: "{{name.first}} {{name.last}}" },
  { id: "implicit", dialect: "classicbars", note: "implicit iterator {{.}} inside a section", src: "{{#tags}}[{{.}}]{{/tags}}" },

  // ── Sections / inverted ─────────────────────────────────────────────────
  { id: "section", dialect: "classicbars", note: "{{#}}/{{/}} → block-open/block-close", src: "{{#items}}{{name}}{{/items}}" },
  { id: "inverted", dialect: "classicbars", note: "{{^}} → block-inverse", src: "{{^items}}none{{/items}}" },

  // ── Clause keywords (dialect-dependent, via IoC) ─────────────────────────
  { id: "clause-else", dialect: "classicbars", note: "{{else}} between block open/close → keyword (statement-like)", src: "{{#if a}}x{{else}}y{{/if}}" },
  { id: "clause-elif", dialect: "maxbars", note: "{{elif …}} → keyword", src: "{{#if a}}x{{elif b}}y{{/if}}" },
  { id: "minbars-else-is-expr", dialect: "minbars", note: "MinBars (Mustache) has no clause words: {{else}} is a plain interpolation, NOT a keyword (IoC: classification follows the dialect)", src: "{{else}}" },

  // ── Composition / inheritance ───────────────────────────────────────────
  { id: "partial", dialect: "classicbars", note: "{{> name}} → partial", src: "{{> row}}" },
  { id: "dynamic-partial", dialect: "classicbars", note: "{{>* name}} → partial", src: "{{>* which}}" },
  { id: "inheritance", dialect: "classicbars", note: "{{<parent}} → block-parent, {{$block}} → block-decl (regression: the regex mis-coloured these as plain expressions)", src: "{{<layout}}{{$title}}Welcome{{/title}}{{/layout}}" },

  // ── Comments / raw blocks ───────────────────────────────────────────────
  { id: "short-comment", dialect: "classicbars", note: "{{! … }} (single bang) → comment", src: "Total{{! dropped }}: {{total}}" },
  { id: "raw-block", dialect: "classicbars", note: "{{{{raw}}}} … {{{{/raw}}}} → one raw-block span", src: "{{{{raw}}}}{{x}}{{{{/raw}}}}" },

  // ── Set delimiters (the case every regex fails — stateful) ───────────────
  { id: "set-delimiter-switch", dialect: "minbars", note: "{{=A B=}} → set-delimiter, and the FOLLOWING <%x%> is lexed in the new pair (a regex cannot track this)", src: "{{=<% %>=}}<%x%>" },
  { id: "set-delimiter-switchback", dialect: "minbars", note: "switch to <% %>, then switch back to the default {{ }} pair mid-stream", src: "{{=<% %>=}}<%x%><%={{ }}=%>{{y}}" },

  // ── MaxBars surface — a tag is ONE span by its head's meaning; interior
  //    operators and literals carry no colour of their own (ADR-014) ──
  { id: "maxbars-operators", dialect: "maxbars", note: "an expression with infix operators is one `expr` span — the operators do not split the tag", src: "{{ a + b * c }}" },
  { id: "maxbars-pipe", dialect: "maxbars", note: "pipes `|` do not split the tag either — still one `expr` span", src: "{{ items | sort | first }}" },
  { id: "maxbars-literals", dialect: "maxbars", note: "string and number literals stay the tag's colour — each tag is one `expr` span", src: "{{ label ?? \"n/a\" }} {{ qty * 2 }}" },

  // ── Interior token vocabulary (ADR-017): the tag stays ONE `expr`/`block-*`
  //    span (see `spans`), and the richer `tokens` view ALSO carves interior
  //    string/number/operator literals at their exact spans. The interior axis is
  //    dialect-scoped: `+ - * /` are operators only under MaxBars' `infixArith`. ──
  { id: "interior-maxbars-operators", dialect: "maxbars", note: "MaxBars: `+`/`*` carve interior `operator` spans inside the one `expr` tag", src: "{{ a + b * c }}" },
  { id: "interior-maxbars-string-coalesce", dialect: "maxbars", note: "MaxBars: `??` carves an `operator` span and the quoted literal a `string` span", src: "{{ label ?? \"n/a\" }}" },
  { id: "interior-maxbars-range-op", dialect: "maxbars", note: "MaxBars: the glued `..` carves an `operator` span between two `number` spans (`rangeOperator`); a single `.` would stay path punctuation", src: "{{ 1..3 }}" },
  { id: "interior-maxbars-list-literal", dialect: "maxbars", note: "MaxBars: a `[…]` list literal — the `[` `,` `]` punctuation stays the tag colour (like parens), only the `number` elements carve interior spans", src: "{{ [1, 2] }}" },
  { id: "interior-maxbars-dict-literal", dialect: "maxbars", note: "MaxBars: a `{k: v}` dict literal — braces/comma stay the tag colour; the `:` carves an `operator` span and the value a `number` span", src: "{{ {a: 1} }}" },
  { id: "interior-number-in-block-arg", dialect: "classicbars", note: "a numeric literal in a block arg carves a `number` span; the tag stays `block-open`", src: "{{#if (gt qty 5)}}{{/if}}" },
  { id: "interior-kernel-path-punctuation", dialect: "classicbars", note: "OFF MaxBars, `a-b` is a path (no operator span) — the interior seam follows the dialect's `lexOptions`", src: "{{ a-b }}" },
  { id: "interior-partial-no-op", dialect: "classicbars", note: "a partial's leading `>` is the tag's meaning, never an interior `operator` span", src: "{{> row}}" },

  // ── Dialect gates (ADR-014): a structurally-valid shape the dialect REJECTS is
  //    coloured `error`, never painted valid — the highlighter agrees with the parser. ──
  { id: "maxbars-extras-amp", dialect: "maxbars", note: "extras off: {{&x}} (unescaped) is disallowed → error, not raw", src: "{{&x}}" },
  { id: "maxbars-extras-inverse", dialect: "maxbars", note: "extras off: {{^x}} (inverse) is disallowed → error; the close stays block-close", src: "{{^x}}b{{/x}}" },
  // Raw blocks have two spellings, gated per dialect: the FlatBars `{{{{#name}}}}`
  // (RawBars/MaxBars) vs the Handlebars bare `{{{{name}}}}` (ClassicBars). MinBars has
  // neither (Mustache). A spelling the dialect rejects colours `error`.
  { id: "maxbars-rawblock-hash", dialect: "maxbars", note: "MaxBars accepts the FlatBars {{{{#raw}}}} spelling → raw-block", src: "{{{{#raw}}}}b{{{{/raw}}}}" },
  { id: "maxbars-rawblock-bare", dialect: "maxbars", note: "MaxBars rejects the Handlebars bare {{{{raw}}}} spelling → error", src: "{{{{raw}}}}b{{{{/raw}}}}" },
  { id: "classicbars-rawblock-hash", dialect: "classicbars", note: "ClassicBars rejects the FlatBars {{{{#raw}}}} spelling (not Handlebars) → error", src: "{{{{#raw}}}}b{{{{/raw}}}}" },
  { id: "classicbars-inheritance-off", dialect: "classicbars", note: "inheritance off: the Mustache {{<l}}/{{$b}} sigils are disallowed → error (ClassicBars is not a Mustache surface)", src: "{{<l}}{{$b}}x{{/b}}{{/l}}" },
  { id: "minbars-inheritance-on", dialect: "minbars", note: "inheritance on: the same {{<l}}/{{$b}} sigils ARE valid block kinds in MinBars", src: "{{<l}}{{$b}}x{{/b}}{{/l}}" },
  { id: "minbars-extras-on", dialect: "minbars", note: "extras on: {{^x}} (inverse) and {{&x}} (unescaped) are valid in MinBars", src: "{{^x}}b{{/x}}{{&y}}" },
];

// Run the gen/check only when invoked as a script (`node scripts/gen-highlight.mjs`),
// not when imported for the CORPUS — importing must have no side effects.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = {
    _generated: "by scripts/gen-highlight.mjs — DO NOT EDIT; run `npm run gen:highlight`",
    source: "lab/vendor/flatbars-engine.mjs — highlightSpans (tag-role, ADR-014) + tokenize (full vocabulary, ADR-017), ENGINE-DERIVED",
    cases: CORPUS.map(({ id, dialect, note, src }) => ({
      id,
      dialect,
      note,
      src,
      // `spans` = the tag-role projection (ADR-014, what the Lab/tutorials paint).
      // `tokens` = the full ADR-017 vocabulary (tag spans + interior string/number/
      // operator literals) the editor layer (LSP/TextMate) consumes. `highlightSpans`
      // is `tokenize` filtered to `role == "tag"`, so the two cannot disagree.
      spans: highlightSpans(src, dialect),
      tokens: tokenize(src, dialect),
    })),
  };
  const text = JSON.stringify(data, null, 2) + "\n";

  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outFile, "utf8");
    } catch {
      /* missing → stale */
    }
    if (current !== text) {
      console.error(
        "✗ scripts/highlight-golden.json is stale vs the engine bundle.\n" +
          "  Highlighting (the lexer's spans) changed. If intended, run `npm run gen:highlight`\n" +
          "  and commit; review the diff to confirm no construct (esp. Exhibits A & B, set\n" +
          "  delimiters, clause keywords) regressed. If the engine changed, also rebundle.",
      );
      process.exit(1);
    }
    console.log(`✓ highlight-golden.json current — ${data.cases.length} engine-derived highlighter cases pinned`);
  } else {
    writeFileSync(outFile, text);
    console.log(`wrote ${outFile}\n  ${data.cases.length} engine-derived highlighter cases pinned (incl. Exhibits A & B, set delimiters, clause keywords)`);
  }
}
