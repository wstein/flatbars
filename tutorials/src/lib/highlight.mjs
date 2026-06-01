// SPDX-License-Identifier: Apache-2.0
//
// Tiny syntax highlighters that emit HTML strings, shared by the runnable
// example card (behind its live editors) and the static spec-only code blocks.
// Ported from the FlatBars-design mockup's `highlight.js`; the JSON highlighter
// is replaced by a YAML one because the Lab's — and these cards' — native data
// format is YAML (see lab/open-in-lab.mjs `dataText`). Colours map to the Lab's
// "stem" palette via CSS classes (open-in-lab.css), so a template reads the same
// here as in the full Lab editor.

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENT[c]);
}

// ⚠ STOPGAP — a regex approximation, NOT the real grammar. The authoritative,
// dialect-aware tokenizer is the engine lexer (packages/core/src/FlatBars/
// Lexer.purs + Token.purs). Per ADR-014 and highlighting-spec.md (Tier 1), this
// regex is to be REPLACED by `tokenizeTemplate(source, { dialect })` exposed
// from the engine bundle, so the highlighter can never disagree with what the
// engine actually parses (the bug class in Exhibits A & B). Until then, this
// recognises the opener literals the engine's `openerLiteralAt` enumerates —
// long comments `{{!-- … --}}` / `{{~!--`, raw blocks `{{{{ … }}}}`, triples
// `{{{ … }}}` — so the common Mustache/FullBars forms stop misfiring. It does
// NOT understand MaxBars operators/pipes (that needs the dialect-scoped lexer).
//
// Order matters: alternatives are tried left-to-right at each position, so the
// most specific opener (long comment, then 4-brace, then 3-brace) must precede
// the bare `{{ … }}` — otherwise `{{[^{}]*?}}` closes a `{{!--` at its inner
// `}}` (Exhibit A). A long comment with no `--}}` runs to EOF, matching how the
// engine's `RComment` swallows to the close-or-end (Exhibit B).
const TAG_RE = /\{\{~?!--[\s\S]*?(?:--~?\}\}|$)|\{\{\{\{[\s\S]*?\}\}\}\}|\{\{\{[\s\S]*?\}\}\}|\{\{[^{}]*?\}\}/g;

export function highlightTemplate(src) {
  return esc(src).replace(TAG_RE, (m) => {
    let cls;
    if (/^\{\{~?!--/.test(m)) cls = "stem-comment"; // long comment {{!-- … --}}
    else if (m.startsWith("{{{{")) cls = "stem-raw"; // raw-block delimiter {{{{ … }}}}
    else if (m.startsWith("{{{")) cls = "stem-raw"; // triple-brace unescaped {{{ … }}}
    else {
      // Bare {{ … }} — classify by the interior sigil. The sigil is read AFTER
      // escaping, so `<` (inheritance parent) and `&` (raw) arrive as entities;
      // decode just those two leading forms to classify them correctly.
      const t = m.slice(2, -2).trim();
      let c = t[0];
      if (t.startsWith("&lt;")) c = "<"; // inheritance parent {{<layout}}
      else if (t.startsWith("&gt;")) c = ">"; // partial {{> name}} / {{>* name}}
      else if (t.startsWith("&amp;")) c = "&"; // raw {{&name}}
      cls = "stem-expr";
      if (c === "&") cls = "stem-raw";
      else if (c === "#" || c === "/" || c === "^") cls = "stem-block";
      else if (c === ">" || c === "<" || c === "$") cls = "stem-partial";
      else if (c === "!") cls = "stem-comment"; // short comment {{! … }}
    }
    return '<span class="' + cls + '">' + m + "</span>";
  });
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
  // Quotes were turned into entities by esc(), so match their escaped forms.
  return v.replace(
    /(&quot;.*?&quot;|&#39;.*?&#39;)|\b(true|false|null|yes|no)\b|(-?\d+(?:\.\d+)?)/g,
    (m, str, kw, num) => {
      if (str !== undefined) return '<span class="y-str">' + str + "</span>";
      if (kw !== undefined) return '<span class="y-kw">' + kw + "</span>";
      return '<span class="y-num">' + num + "</span>";
    },
  );
}
