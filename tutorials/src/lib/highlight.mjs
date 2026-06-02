// SPDX-License-Identifier: Apache-2.0
//
// HTML-string highlighters for the runnable example card (behind its live
// editors) and the static spec-only code blocks. The template highlighter
// derives from the ENGINE lexer (ADR-014): `highlightTemplate` wraps the engine
// bundle's `highlightSpans(src, dialect)`, so the colour can never disagree with
// what the engine parses (the bug class in Exhibits A & B), is correct on set
// delimiters and every dialect's tag boundaries, and paints `{{else}}`/`{{elif}}`
// as statements where the dialect treats them as clause separators. The YAML
// highlighter (host *data*, not FlatBars syntax) is a separate, line-oriented
// pass — see the note above `highlightYaml`. Colours map to the Lab's "stem"
// palette via CSS classes (open-in-lab.css), so a template reads the same here
// as in the full Lab editor.
import { highlightSpans } from "../../../lab/vendor/flatbars-engine.mjs";

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENT[c]);
}

// Engine span kind → the card's "stem" palette class. Several kinds share a slot
// so `{{else}}` reads as control flow alongside `{{#…}}`, and set-delimiter tags
// read as inert meta (like comments). Mirrors lab/cm-flatbars.mjs's grouping; the
// classes differ only because the card's CSS predates the Lab's `cm-hb-*` names.
const KIND_CLASS = {
  expr: "stem-expr",
  keyword: "stem-block",
  "block-open": "stem-block",
  "block-inverse": "stem-block",
  "block-close": "stem-block",
  "block-parent": "stem-partial",
  "block-decl": "stem-partial",
  partial: "stem-partial",
  raw: "stem-raw",
  "raw-block": "stem-raw",
  comment: "stem-comment",
  "set-delimiter": "stem-comment",
  error: "stem-comment",
  // interior-role kinds (ADR-017): operators/strings/numbers inside a tag
  operator: "stem-op",
  string: "stem-str",
  number: "stem-num",
};

// Highlight a template by the engine's own spans. `dialect` selects the lexer
// configuration (set delimiters, clause keywords, and long-comment spans) exactly
// as the renderer would; it defaults to FullBars. Text outside any span stays the
// default colour.
export function highlightTemplate(src, dialect = "fullbars") {
  const spans = highlightSpans(String(src), dialect) || [];
  let out = "";
  let pos = 0;
  for (const s of spans) {
    if (!s || s.to <= s.from || s.from < pos) continue; // defensive: skip overlaps
    out += esc(src.slice(pos, s.from));
    const cls = KIND_CLASS[s.kind] || "stem-expr";
    out += '<span class="' + cls + '">' + esc(src.slice(s.from, s.to)) + "</span>";
    pos = s.to;
  }
  return out + esc(src.slice(pos));
}

// Highlight YAML data line-by-line (YAML is line-oriented, which sidesteps the
// nested-span hazard of a single global regex). Per line: pull a trailing `#`
// comment, colour a leading `key:`, then colour scalar values (quoted strings,
// numbers, the bool/null keywords). Plain scalars stay in the default colour.
export function highlightYaml(src) {
  return esc(src).split("\n").map(highlightYamlLine).join("\n");
}

function highlightYamlLine(raw) {
  // A `#` comment starts at column 0 or after whitespace (entities don't contain
  // a bare `#`, so this is safe post-escape). Split it off and colour it last.
  const cm = raw.match(/(^|\s)(#.*)$/);
  let line = raw;
  let comment = "";
  if (cm) {
    comment = '<span class="y-comment">' + cm[2] + "</span>";
    line = raw.slice(0, cm.index + cm[1].length);
  }

  // key: value   (with optional indentation and a leading "- " list marker)
  const kv = line.match(/^(\s*(?:- )?)([^:\s][^:]*?)(:)(\s.*|)$/);
  if (kv) {
    return kv[1] + '<span class="y-key">' + kv[2] + "</span>" + kv[3] + hlYamlValue(kv[4]) + comment;
  }
  // "- scalar" list item
  const li = line.match(/^(\s*- )(.*)$/);
  if (li) return li[1] + hlYamlValue(li[2]) + comment;
  // bare scalar or blank line
  return hlYamlValue(line) + comment;
}

function hlYamlValue(v) {
  // Classify the value as a WHOLE scalar, not by matching substrings — otherwise
  // a digit run inside a plain scalar (`default111`) is mis-coloured as a number,
  // and quotes inside esc() output are matched mid-word. Split off any leading
  // whitespace, then colour the trimmed scalar by what it is. A YAML plain scalar
  // is a string, so it gets the string colour (numbers/bools/null only when the
  // ENTIRE value is one); flow collections (`{}`, `[]`) are left uncoloured.
  const lead = v.match(/^\s*/)[0];
  const val = v.slice(lead.length);
  if (val === "") return v;
  let cls = "y-str"; // plain scalar ⇒ string
  if (/^(&quot;[\s\S]*&quot;|&#39;[\s\S]*&#39;)$/.test(val)) cls = "y-str"; // quoted string
  else if (/^(true|false|null|yes|no)$/.test(val)) cls = "y-kw"; // bool/null keyword
  else if (/^-?\d+(?:\.\d+)?$/.test(val)) cls = "y-num"; // number
  else if (/^[[{]/.test(val)) return v; // flow {} / [] — leave plain
  return lead + '<span class="' + cls + '">' + val + "</span>";
}
