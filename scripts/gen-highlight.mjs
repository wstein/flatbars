#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate / check the syntax-highlighter golden snapshots. Mirrors the
// gen:catalog/check:catalog and gen:conformance/check:conformance pattern:
//
//   node scripts/gen-highlight.mjs            # regenerate the golden file
//   node scripts/gen-highlight.mjs --check    # CI: fail if highlighting drifted
//
// WHY THIS EXISTS (design-debate consensus, Tier 2 + Priya's "10/10,
// non-negotiable"): rendering has three drift gates (examples:verify,
// test:compile, check:catalog); highlighting had NONE, which is why the
// Exhibit-A/B mis-highlighting shipped silently. This gate pins the highlighter
// output over a curated corpus — including Exhibits A & B — so a change to
// highlighting is a deliberate, reviewable diff (rerun gen:highlight), never an
// accident.
//
// STOPGAP NOTE (ADR-014, highlighting-spec.md): today the golden is produced by
// the regex highlighter (tutorials/src/lib/highlight.mjs), so this is a
// REGRESSION gate, not yet an engine-equivalence oracle. Under Tier 1 the corpus
// stays, the golden source flips to `tokenizeTemplate(src,{dialect})` from the
// engine bundle, and this gate becomes the true "highlighting == what the engine
// parses" check. The corpus cases below are authored to read CORRECTLY today, so
// they double as the acceptance set Tier 1 must keep green.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { highlightTemplate, highlightYaml } from "../tutorials/src/lib/highlight.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "highlight-golden.json");

// The corpus. `lang: "template"` runs through highlightTemplate; "yaml" through
// highlightYaml. `note` documents the invariant each case protects.
const CORPUS = [
  // ── Regression exhibits from the design debate ──────────────────────────
  { id: "exhibit-a-long-comment", lang: "template", note: "the whole {{!-- … --}} is ONE comment; the trailing `!` is OUTSIDE it", src: "Hello, {{!-- name --}}!" },
  { id: "exhibit-b-unterminated-comment", lang: "template", note: "a {{!-- with no own --}} swallows to the next --}} (or EOF), as the engine's RComment does", src: "escaped: {{html}}\nraw:     {{!-- html}}\namp:     {{&html--}}" },

  // ── Interpolation ───────────────────────────────────────────────────────
  { id: "expr", lang: "template", note: "{{name}} → stem-expr", src: "Hello, {{name}}!" },
  { id: "triple-raw", lang: "template", note: "{{{x}}} → stem-raw (unescaped)", src: "raw: {{{html}}}" },
  { id: "amp-raw", lang: "template", note: "{{&x}} → stem-raw; `&` arrives as &amp; after escaping", src: "amp: {{&html}}" },
  { id: "dotted", lang: "template", note: "dotted path stays one expr", src: "{{name.first}} {{name.last}}" },
  { id: "implicit", lang: "template", note: "implicit iterator {{.}}", src: "{{#tags}}[{{.}}]{{/tags}}" },

  // ── Sections / inverted ─────────────────────────────────────────────────
  { id: "section", lang: "template", note: "{{#}} and {{/}} → stem-block", src: "{{#items}}{{name}}{{/items}}" },
  { id: "inverted", lang: "template", note: "{{^}} → stem-block", src: "{{^items}}none{{/items}}" },

  // ── Composition / inheritance ───────────────────────────────────────────
  { id: "partial", lang: "template", note: "{{> name}} → stem-partial; `>` arrives as &gt; (regression: was mis-coloured raw)", src: "{{> row}}" },
  { id: "dynamic-partial", lang: "template", note: "{{>* name}} → stem-partial", src: "{{>* which}}" },
  { id: "inheritance", lang: "template", note: "{{<parent}} and {{$block}} → stem-partial; close → stem-block", src: "{{<layout}}{{$title}}Welcome{{/title}}{{/layout}}" },

  // ── Comments / raw blocks ───────────────────────────────────────────────
  { id: "short-comment", lang: "template", note: "{{! … }} (single bang, no --) → stem-comment", src: "Total{{! dropped }}: {{total}}" },
  { id: "tilde-long-comment", lang: "template", note: "{{~!-- … --}} whitespace-control long comment", src: "a {{~!-- note --}} b" },
  { id: "raw-block", lang: "template", note: "{{{{raw}}}} … {{{{/raw}}}} delimiters → stem-raw, body literal", src: "{{{{raw}}}}{{x}}{{{{/raw}}}}" },

  // ── YAML data ───────────────────────────────────────────────────────────
  { id: "yaml-scalars", lang: "yaml", note: "key + string/number/bool/null colouring", src: "name: Ada\nid: 42\nactive: true\nnada: null" },
  { id: "yaml-list", lang: "yaml", note: "list markers + nested keys", src: "items:\n  - name: pen\n    qty: 3\ntags:\n  - math" },
  { id: "yaml-comment", lang: "yaml", note: "trailing # comment", src: "name: Ada  # the author" },
];

const data = {
  _generated: "by scripts/gen-highlight.mjs — DO NOT EDIT; run `npm run gen:highlight`",
  source: "tutorials/src/lib/highlight.mjs (STOPGAP regex highlighter — see ADR-014 / highlighting-spec.md)",
  cases: CORPUS.map(({ id, lang, note, src }) => ({
    id,
    lang,
    note,
    src,
    html: lang === "yaml" ? highlightYaml(src) : highlightTemplate(src),
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
      "✗ scripts/highlight-golden.json is stale vs tutorials/src/lib/highlight.mjs.\n" +
        "  Highlighting changed. If intended, run `npm run gen:highlight` and commit;\n" +
        "  review the diff to confirm no construct (esp. Exhibits A & B) regressed.",
    );
    process.exit(1);
  }
  console.log(`✓ highlight-golden.json current — ${data.cases.length} highlighter cases pinned`);
} else {
  writeFileSync(outFile, text);
  console.log(`wrote ${outFile}\n  ${data.cases.length} highlighter cases pinned (incl. Exhibits A & B)`);
}
