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
import { paintKinds, KIND_CLASS, tagRanges } from "../../../lab/highlight-paint.mjs";
import operationsJson from "../../../editors/operations.json" with { type: "json" };

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENT[c]);
}

// The prelude operation names — so the highlighter lights up helper names (head /
// pipe / subexpression) exactly as the Lab and VS Code's LSP do, and only for
// names the engine actually knows (a plain `{{name}}` stays default).
const OP_NAMES = new Set(operationsJson.operations.map((o) => o.name));
const isOperation = (name) => OP_NAMES.has(name);

// Highlight a template with the shared INNER-TOKEN painter (lab/highlight-
// paint.mjs): braces + keywords one colour, helper names another, literals their
// own — the VS Code "2026-dark" look, rather than the old whole-tag-one-colour
// model. Every segment inside a tag is bold (the editor "bold tag" treatment),
// and each whole tag (`{ … }`, braces included) sits on a `tk-tag` plate so it
// reads as one pill. `dialect` selects the lexer config (set delimiters, clause
// keywords) exactly as the renderer would; it defaults to ClassicBars.
export function highlightTemplate(src, dialect = "classicbars") {
  const text = String(src);
  const tags = tagRanges(text, dialect); // ascending, non-overlapping
  let out = "";
  let ti = 0;
  let inTag = false;
  for (const seg of paintKinds(text, dialect, isOperation)) {
    // Open a tag plate exactly at a tag boundary (segments never cross one).
    if (!inTag && ti < tags.length && seg.from === tags[ti].from) {
      out += '<span class="tk-tag">';
      inTag = true;
    }
    const body = esc(text.slice(seg.from, seg.to));
    const cls = seg.kind ? KIND_CLASS[seg.kind] : seg.inTag ? "tk-in" : "";
    out += cls ? '<span class="' + cls + '">' + body + "</span>" : body;
    // Close it at the tag's end (so `{{a}}{{b}}` is two pills, not one).
    if (inTag && seg.to === tags[ti].to) {
      out += "</span>";
      inTag = false;
      ti++;
    }
  }
  return out;
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
// classes (`.j-*` in lab-tokens.css) — not the `.tk-*` template tokens — so an
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
