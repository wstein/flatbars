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

// Engine span kind → the unified "stem" palette class (the single source shared
// with the legend). Several kinds share a slot so `{{else}}` reads as control
// flow alongside `{{#…}}`. The mapping honours the redesign's seven families:
// inheritance tags (`{{<layout}}`, `{{$block}}`) get their own violet `inherit`
// slot, and set-delimiter tags their own rose `delim` slot — distinct from
// partials and comments. Mirrors lab/cm-flatbars.mjs's grouping.
const KIND_CLASS = {
  expr: "stem-expr",
  keyword: "stem-block",
  "block-open": "stem-block",
  "block-inverse": "stem-block",
  "block-close": "stem-block",
  "block-parent": "stem-inherit",
  "block-decl": "stem-inherit",
  partial: "stem-partial",
  raw: "stem-raw",
  "raw-block": "stem-raw",
  comment: "stem-comment",
  "set-delimiter": "stem-delim",
  // A structurally-valid tag the dialect disallows (an extras/inheritance-gated
  // shape) — flagged like a lex error.
  error: "stem-error",
};

// Every emitted span is a whole tag (the highlighter colours by meaning, one
// span per tag). This is the subset whose `{{`/`}}` delimiters get dimmed:
// `raw-block` (`{{{{…}}}}`) and `error` are excluded — a four-brace stem and a
// disallowed-shape span don't take the two-brace delimiter dimmer cleanly.
const TAG_KINDS = new Set([
  "expr", "keyword", "block-open", "block-inverse", "block-close",
  "block-parent", "block-decl", "partial", "raw",
  "comment", "set-delimiter",
]);

// Wrap leading `{{`/`{{{` and trailing `}}`/`}}}` in a dimmed `.pn` span, keeping
// the sigil + name as the loud part — the same "highlight theme" the legend uses.
// Braces survive HTML-escaping (esc() doesn't touch `{`/`}`), so this is safe on
// the already-escaped slice. Anchored to the span ends, and `{{{`/`}}}` are tried
// before `{{`/`}}`, so a MaxBars half-tag span like `{{a ` dims only its `{{` and
// ` b}}` only its `}}`.
function dimDelims(escaped) {
  return escaped
    .replace(/^(\{\{\{?)/, '<span class="pn">$1</span>')
    .replace(/(\}\}\}?)$/, '<span class="pn">$1</span>');
}

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
    let body = esc(src.slice(s.from, s.to));
    if (TAG_KINDS.has(s.kind)) body = dimDelims(body);
    out += '<span class="' + cls + '">' + body + "</span>";
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

// Highlight a JSONata expression (the "Data shaping" guide's editors + the
// surface pages' static transform blocks). JSONata is NOT a FlatBars dialect, so
// it has its own small tokenizer rather than the engine lexer: a single
// left-to-right scan trying each token kind in priority order (comment, string,
// regex literal, number, $function / $variable, operator, keyword) and leaving
// field names + punctuation in the default colour. Colours map to plain-text
// classes (`.j-*` in lab-tokens.css) — not the `.stem-*` tag chips — so an
// expression reads like code, not a row of boxed tags.
const JSONATA_KW = /^(function|true|false|null|and|or|in)\b/;
export function highlightJsonata(src) {
  const s = String(src);
  let out = "";
  let i = 0;
  const N = s.length;
  const push = (cls, t) => (out += '<span class="' + cls + '">' + esc(t) + "</span>");
  while (i < N) {
    const r = s.slice(i);
    let m;
    if ((m = /^\/\*[\s\S]*?\*\//.exec(r))) { push("j-comment", m[0]); i += m[0].length; continue; }
    if ((m = /^"(?:[^"\\]|\\.)*"/.exec(r)) || (m = /^'(?:[^'\\]|\\.)*'/.exec(r))) { push("j-str", m[0]); i += m[0].length; continue; }
    if ((m = /^\/(?:[^/\\\n]|\\.)+\/[a-z]*/.exec(r))) { push("j-regex", m[0]); i += m[0].length; continue; }
    if ((m = /^\d+(?:\.\d+)?/.exec(r))) { push("j-num", m[0]); i += m[0].length; continue; }
    if ((m = /^\$\$/.exec(r))) { push("j-var", m[0]); i += m[0].length; continue; }
    if ((m = /^\$[A-Za-z_]\w*(?=\s*\()/.exec(r))) { push("j-fn", m[0]); i += m[0].length; continue; }
    if ((m = /^\$[A-Za-z_]\w*/.exec(r)) || (m = /^\$/.exec(r))) { push("j-var", m[0]); i += m[0].length; continue; }
    if ((m = /^(:=|~>|>=|<=|!=|\?|&|=|>|<|\+|\*|\||%)/.exec(r))) { push("j-op", m[0]); i += m[0].length; continue; }
    if ((m = JSONATA_KW.exec(r))) { push("j-kw", m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(r))) { out += esc(m[0]); i += m[0].length; continue; } // field name → default colour
    out += esc(s[i]);
    i += 1;
  }
  return out;
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
