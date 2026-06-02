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
// `highlightSpans(src, dialect)` from the committed `flatbars-js` bundle, the
// same function both front-ends paint from. This is now the true
// "highlighting == what the engine lexes" oracle, not a snapshot of a regex. The
// corpus carries the Exhibit A/B regressions plus the cases a regex cannot do:
// set-delimiter statefulness, per-dialect tag boundaries, and the clause keywords.
//
// NOTE: long comments `{{!-- … --}}` are coloured (the lexer emits them as a
// span-only token under `keepLongComments`, which only the highlighter sets — the
// render/compile token stream is unchanged). Host *data* highlighting (YAML) is a
// separate concern (real `lang-yaml` + a data-side decorator), out of this
// FlatBars-syntax gate's scope.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { highlightSpans } from "../lab/vendor/flatbars-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "highlight-golden.json");

// The corpus. Each case runs through `highlightSpans(src, dialect)`. `note`
// documents the invariant the case protects.
const CORPUS = [
  // ── Regression exhibits from the design debate ──────────────────────────
  { id: "exhibit-a-long-comment", dialect: "fullbars", note: "the whole {{!-- name --}} is ONE comment span and the trailing `!` is OUTSIDE it — the regex closed the comment at the inner }} (Exhibit A fixed)", src: "Hello, {{!-- name --}}!" },
  { id: "exhibit-b-unterminated-comment", dialect: "fullbars", note: "an unterminated {{!-- swallows to the next --}} (one comment span) exactly as the lexer does — no stray raw tag (Exhibit B fixed)", src: "escaped: {{html}}\nraw:     {{!-- html}}\namp:     {{&html--}}" },

  // ── Interpolation ───────────────────────────────────────────────────────
  { id: "expr", dialect: "fullbars", note: "{{name}} → expr", src: "Hello, {{name}}!" },
  { id: "triple-raw", dialect: "fullbars", note: "{{{x}}} → raw (unescaped)", src: "raw: {{{html}}}" },
  { id: "amp-raw", dialect: "fullbars", note: "{{&x}} → raw", src: "amp: {{&html}}" },
  { id: "dotted", dialect: "fullbars", note: "dotted path stays one expr tag", src: "{{name.first}} {{name.last}}" },
  { id: "implicit", dialect: "fullbars", note: "implicit iterator {{.}} inside a section", src: "{{#tags}}[{{.}}]{{/tags}}" },

  // ── Sections / inverted ─────────────────────────────────────────────────
  { id: "section", dialect: "fullbars", note: "{{#}}/{{/}} → block-open/block-close", src: "{{#items}}{{name}}{{/items}}" },
  { id: "inverted", dialect: "fullbars", note: "{{^}} → block-inverse", src: "{{^items}}none{{/items}}" },

  // ── Clause keywords (dialect-dependent, via IoC) ─────────────────────────
  { id: "clause-else", dialect: "fullbars", note: "{{else}} between block open/close → keyword (statement-like)", src: "{{#if a}}x{{else}}y{{/if}}" },
  { id: "clause-elif", dialect: "maxbars", note: "{{elif …}} → keyword", src: "{{#if a}}x{{elif b}}y{{/if}}" },
  { id: "minbars-else-is-expr", dialect: "minbars", note: "MinBars (Mustache) has no clause words: {{else}} is a plain interpolation, NOT a keyword (IoC: classification follows the dialect)", src: "{{else}}" },

  // ── Composition / inheritance ───────────────────────────────────────────
  { id: "partial", dialect: "fullbars", note: "{{> name}} → partial", src: "{{> row}}" },
  { id: "dynamic-partial", dialect: "fullbars", note: "{{>* name}} → partial", src: "{{>* which}}" },
  { id: "inheritance", dialect: "fullbars", note: "{{<parent}} → block-parent, {{$block}} → block-decl (regression: the regex mis-coloured these as plain expressions)", src: "{{<layout}}{{$title}}Welcome{{/title}}{{/layout}}" },

  // ── Comments / raw blocks ───────────────────────────────────────────────
  { id: "short-comment", dialect: "fullbars", note: "{{! … }} (single bang) → comment", src: "Total{{! dropped }}: {{total}}" },
  { id: "raw-block", dialect: "fullbars", note: "{{{{raw}}}} … {{{{/raw}}}} → one raw-block span", src: "{{{{raw}}}}{{x}}{{{{/raw}}}}" },

  // ── Set delimiters (the case every regex fails — stateful) ───────────────
  { id: "set-delimiter-switch", dialect: "minbars", note: "{{=A B=}} → set-delimiter, and the FOLLOWING <%x%> is lexed in the new pair (a regex cannot track this)", src: "{{=<% %>=}}<%x%>" },
  { id: "set-delimiter-switchback", dialect: "minbars", note: "switch to <% %>, then switch back to the default {{ }} pair mid-stream", src: "{{=<% %>=}}<%x%><%={{ }}=%>{{y}}" },

  // ── MaxBars surface — interior tokens punch through (ADR-017 end offsets) ──
  { id: "maxbars-operators", dialect: "maxbars", note: "infix operators get their own `operator` span; identifiers/whitespace stay `expr` (the tag's colour)", src: "{{ a + b * c }}" },
  { id: "maxbars-pipe", dialect: "maxbars", note: "pipes `|` are operators too", src: "{{ items | sort | first }}" },
  { id: "maxbars-literals", dialect: "maxbars", note: "string and number literals punch through as `string` / `number`", src: "{{ label ?? \"n/a\" }} {{ qty * 2 }}" },

  // ── Dialect gates (ADR-014): a structurally-valid shape the dialect REJECTS is
  //    coloured `error`, never painted valid — the highlighter agrees with the parser. ──
  { id: "maxbars-extras-amp", dialect: "maxbars", note: "extras off: {{&x}} (unescaped) is disallowed → error, not raw", src: "{{&x}}" },
  { id: "maxbars-extras-inverse", dialect: "maxbars", note: "extras off: {{^x}} (inverse) is disallowed → error; the close stays block-close", src: "{{^x}}b{{/x}}" },
  { id: "maxbars-extras-rawblock", dialect: "maxbars", note: "extras off: {{{{…}}}} raw block (with or without a #) is disallowed → error", src: "{{{{#raw}}}}b{{{{/raw}}}}" },
  { id: "fullbars-inheritance-off", dialect: "fullbars", note: "inheritance off: the Mustache {{<l}}/{{$b}} sigils are disallowed → error (FullBars is not a Mustache surface)", src: "{{<l}}{{$b}}x{{/b}}{{/l}}" },
  { id: "minbars-inheritance-on", dialect: "minbars", note: "inheritance on: the same {{<l}}/{{$b}} sigils ARE valid block kinds in MinBars", src: "{{<l}}{{$b}}x{{/b}}{{/l}}" },
  { id: "minbars-extras-on", dialect: "minbars", note: "extras on: {{^x}} (inverse) and {{&x}} (unescaped) are valid in MinBars", src: "{{^x}}b{{/x}}{{&y}}" },
];

const data = {
  _generated: "by scripts/gen-highlight.mjs — DO NOT EDIT; run `npm run gen:highlight`",
  source: "lab/vendor/flatbars-engine.mjs — highlightSpans(src, dialect) (ENGINE-DERIVED; ADR-014)",
  cases: CORPUS.map(({ id, dialect, note, src }) => ({
    id,
    dialect,
    note,
    src,
    spans: highlightSpans(src, dialect),
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
