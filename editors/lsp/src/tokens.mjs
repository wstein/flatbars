// SPDX-License-Identifier: Apache-2.0
//
// The pure semantic-token logic for `flatbars-lsp` (ADR-017): everything from the
// engine's `tokenize` spans to the LSP wire encoding, with no transport. The
// server (server.mjs) is a thin shell over these functions; this module is what
// the unit test exercises directly.
//
// The legend and the kind→(type, modifiers) mapping are derived from the shared
// editors/token-vocabulary.json — the single source of truth (ADR-017). The
// server therefore cannot name a token type the vocabulary does not declare.
import { tokenize, diagnostics as engineDiagnostics } from "./engine.mjs";
// The shared single source of truth (ADR-017), imported as data so the bundler
// can inline it into the self-contained server — no runtime file read.
import vocabularyJson from "../../token-vocabulary.json" with { type: "json" };
import { operationByName, hoverMarkdown, completionItems, rewriteFor } from "./operations.mjs";

export const vocabulary = vocabularyJson;

// The LSP semantic-tokens legend, derived from the vocabulary in stable order.
export function buildLegend(vocab = vocabulary) {
  const tokenTypes = [];
  const tokenModifiers = [];
  for (const def of Object.values(vocab.kinds)) {
    if (!tokenTypes.includes(def.lsp.type)) tokenTypes.push(def.lsp.type);
    for (const m of def.lsp.modifiers ?? []) {
      if (!tokenModifiers.includes(m)) tokenModifiers.push(m);
    }
  }
  return { tokenTypes, tokenModifiers };
}

// kind → { typeIndex, modifierBits } against a legend.
function kindEncoder(vocab, legend) {
  const map = new Map();
  for (const [kind, def] of Object.entries(vocab.kinds)) {
    let bits = 0;
    for (const m of def.lsp.modifiers ?? []) bits |= 1 << legend.tokenModifiers.indexOf(m);
    map.set(kind, { typeIndex: legend.tokenTypes.indexOf(def.lsp.type), bits });
  }
  return map;
}

// FlatBars has four surfaces, each a first-class editor language. The dialect is
// the document's `languageId` — `rawbars`/`minbars`/`fullbars`/`maxbars`; the
// `flatbars` umbrella (and anything else) yields null so the caller falls back.
export const DIALECTS = ["rawbars", "minbars", "fullbars", "maxbars"];

export function dialectForLanguageId(languageId) {
  return DIALECTS.includes(languageId) ? languageId : null;
}

// A robust fallback when the languageId is not a dialect (the `flatbars` umbrella,
// or a host — e.g. JetBrains — that doesn't send our id): map the native extension.
// Returns null if the extension picks no dialect. Each dialect ships two native
// extensions — long (`.rawbars`) and short (`.rbars`); both resolve here.
const URI_EXTENSION_DIALECT = {
  ".rawbars": "rawbars",
  ".rbars": "rawbars",
  ".minbars": "minbars",
  ".mbars": "minbars",
  ".fullbars": "fullbars",
  ".fbars": "fullbars",
  ".maxbars": "maxbars",
  ".xbars": "maxbars",
};

export function dialectForUri(uri) {
  const lower = String(uri).toLowerCase();
  for (const [ext, d] of Object.entries(URI_EXTENSION_DIALECT)) if (lower.endsWith(ext)) return d;
  return null;
}

// The resolution the server uses: languageId first, then the URI, then the
// configured default (FullBars unless overridden).
export function resolveDialect(languageId, uri, fallback = "fullbars") {
  return dialectForLanguageId(languageId) ?? dialectForUri(uri) ?? fallback;
}

// Parse diagnostics (ADR-023) as engine offset ranges. The recovering parser
// reports each error at the offending tag's start; we extend the range to that
// tag's close (`}}`) so the squiggle covers the whole tag (falling back to a
// two-char width when no close is found — an unterminated tag).
export function parseDiagnostics(text, dialect) {
  return engineDiagnostics(text, dialect).map((d) => {
    const close = text.indexOf("}}", d.offset);
    const end = close < 0 ? Math.min(d.offset + 2, text.length) : close + 2;
    return { start: d.offset, end, message: d.message };
  });
}

// Semantic tokens are SPARSE CORRECTIONS over the TextMate floor (ADR-017), not a
// blanket re-colour: the LSP emits only the kinds in `lspEmitKinds` — the ones the
// stateless grammar can't get right (dialect-scoped interior operators/literals,
// set delimiters, dialect-disallowed errors). The structural tags (interpolation,
// raw, blocks, partials, comments) are left to the grammar, which already paints
// the familiar braces-vs-name look — so the LSP does not flatten `{{{x}}}` to one
// colour. This builds the flattened, non-overlapping per-offset kind map.
const emitKinds = new Set(vocabulary.lspEmitKinds);

function flatten(text, dialect) {
  const kinds = new Array(text.length).fill(null);
  const spans = tokenize(text, dialect);
  for (const s of spans)
    if (s.role === "tag" && emitKinds.has(s.kind)) {
      const [from, to] = shrinkToInner(text, s.from, s.to);
      fillRange(kinds, from, to, s.kind);
    }
  for (const s of spans) if (s.role === "interior" && emitKinds.has(s.kind)) fillRange(kinds, s.from, s.to, s.kind);
  if (emitKinds.has("operation")) paintOperations(kinds, text, spans);
  return kinds;
}

// Paint operation-position identifiers (helper names) as the `operation` kind.
// `expr` / `raw` / `partial` tags get a head paint; every tag scans its body for
// subexpression heads (`(` + IDENT). The TextMate grammar handles control-tag
// sigils (`#each`, `/if`, …) as `keyword.control.section`, so this only touches
// what the grammar leaves default. Gated on the operations catalog so plain
// variables (`{{name}}`) stay default-coloured; partial names always paint.
const HEAD_OPERATION_TAG_KINDS = new Set(["expr", "raw", "partial"]);
const NO_OPERATION_TAG_KINDS = new Set(["comment", "raw-block", "error", "set-delimiter", "keyword"]);
const IDENT_RE = /^[A-Za-z_][\w-]*/;

function paintOperations(kinds, text, spans) {
  for (const s of spans) {
    if (s.role !== "tag") continue;
    if (NO_OPERATION_TAG_KINDS.has(s.kind)) continue;
    if (HEAD_OPERATION_TAG_KINDS.has(s.kind)) paintHeadOperation(kinds, text, s);
    paintSubexpressionHeads(kinds, text, s);
    paintPipeTargets(kinds, text, s);
  }
}

// MaxBars `value | helper` — the identifier after every `|` (that isn't part of
// `||`) is in operation position. Block params (`{{#each xs as |x|}}`) feed
// non-helper identifiers; the catalog check skips them.
function paintPipeTargets(kinds, text, s) {
  for (let i = s.from; i < s.to; i++) {
    if (text[i] !== "|" || text[i - 1] === "|" || text[i + 1] === "|") continue;
    let j = i + 1;
    while (j < s.to && /\s/.test(text[j])) j++;
    paintIdentAt(kinds, text, j, s.to, false);
  }
}

function paintHeadOperation(kinds, text, s) {
  let i = s.from;
  // Skip braces, whitespace-control `~`, raw sigil `&`, whitespace.
  while (i < s.to && /[{}~&\s]/.test(text[i])) i++;
  // Partial sigil `>` (with optional `*` decorator) then whitespace.
  if (text[i] === ">") {
    i++;
    if (text[i] === "*") i++;
    while (i < s.to && /\s/.test(text[i])) i++;
  }
  paintIdentAt(kinds, text, i, s.to, s.kind === "partial");
}

function paintSubexpressionHeads(kinds, text, s) {
  for (let i = s.from; i < s.to - 1; i++) {
    if (text[i] !== "(" || kinds[i] !== null) continue;
    let j = i + 1;
    while (j < s.to && /\s/.test(text[j])) j++;
    paintIdentAt(kinds, text, j, s.to, false);
  }
}

// `alwaysPaint` skips the catalog check (used for partial names — user-defined,
// never in the catalog). Otherwise we only paint if the identifier resolves as
// a known operation, and never if it's followed by a `.` or `/` (path access,
// not a bare helper call).
function paintIdentAt(kinds, text, i, to, alwaysPaint) {
  const m = IDENT_RE.exec(text.slice(i, to));
  if (!m) return;
  const after = text[i + m[0].length];
  if (after === "." || after === "/") return;
  if (!alwaysPaint && !operationByName(m[0])) return;
  for (let k = i; k < i + m[0].length; k++) if (kinds[k] === null) kinds[k] = "operation";
}

// Trim braces / whitespace-control sigils / surrounding whitespace off a tag span
// so the LSP-emitted semantic token covers only the INNER body — `{{~ else ~}}` →
// `else`. The grammar already paints `{{`, `~`, `}}` (and the `=` of set-delim) as
// `punctuation.section.embedded.*`; without this trim, the tag-level semantic token
// (keyword, set-delimiter, error) would override the braces too, blotting out the
// embedded colour the theme applies. The trim is correct for any tag shape because
// `{`/`}`/`~`/whitespace never appear in a FlatBars identifier body.
function shrinkToInner(text, from, to) {
  let s = from;
  let e = to;
  while (s < e && /[{}~\s]/.test(text[s])) s++;
  while (e > s && /[{}~\s]/.test(text[e - 1])) e--;
  return [s, e];
}

function fillRange(arr, from, to, value) {
  for (let i = from; i < to && i < arr.length; i++) arr[i] = value;
}

// Run-length the flattened kind map into positioned tokens, split at line breaks
// (a semantic token may not cross a newline) and at kind changes. Returns
// `{ line, char, length, kind }` records in source order.
export function tokensOf(text, dialect) {
  const kinds = flatten(text, dialect);
  const tokens = [];
  let line = 0;
  let char = 0;
  let i = 0;
  while (i < text.length) {
    if (kinds[i] === null || text[i] === "\n") {
      if (text[i] === "\n") {
        line++;
        char = 0;
      } else {
        char++;
      }
      i++;
      continue;
    }
    const kind = kinds[i];
    const startLine = line;
    const startChar = char;
    let len = 0;
    while (i < text.length && kinds[i] === kind && text[i] !== "\n") {
      len++;
      char++;
      i++;
    }
    tokens.push({ line: startLine, char: startChar, length: len, kind });
  }
  return tokens;
}

// ── Hover & completion (ADR-017) ──────────────────────────────────────────────
// Both are gated on being INSIDE a tag, decided by the engine's own `tokenize`
// (never a re-implemented lexer): the offset must fall in a `tag` span and not in
// an interior string/number literal. So hover/completion fire on operation names
// and arguments, never in surrounding text or inside a quoted string.
function inTagContext(text, dialect, offset) {
  let inTag = false;
  let inLiteral = false;
  for (const s of tokenize(text, dialect)) {
    if (s.role === "tag" && offset >= s.from && offset <= s.to) inTag = true;
    if (s.role === "interior" && (s.kind === "string" || s.kind === "number") && offset > s.from && offset < s.to) inLiteral = true;
  }
  return inTag && !inLiteral;
}

// The identifier under `offset`, or null. FlatBars operation/scoped names are
// `[A-Za-z0-9_]` plus `-` (the hyphenated scoped vars: `partial-block`,
// `parent-index`, …). A bare `-` in MaxBars arithmetic is space-delimited, so this
// only over-captures an unspaced `a-b`, which resolves to no operation (harmless).
function wordAt(text, offset) {
  const isWord = (c) => c !== undefined && /[A-Za-z0-9_-]/.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  return start === end ? null : { word: text.slice(start, end), start, end };
}

// Hover for a known operation under the cursor (inside a tag). Returns the Markdown
// body and the word's offset range, or null. server.mjs maps offsets to positions.
export function hoverAt(text, dialect, offset) {
  if (!inTagContext(text, dialect, offset)) return null;
  const w = wordAt(text, offset);
  if (!w) return null;
  const op = operationByName(w.word);
  if (!op) return null;
  return { markdown: hoverMarkdown(op), start: w.start, end: w.end };
}

// Completion candidates when the cursor is inside a tag; [] otherwise. Plain items
// ({ label, detail, kind, sortText }); server.mjs maps `kind` to CompletionItemKind.
export function completionsAt(text, dialect, offset) {
  return inTagContext(text, dialect, offset) ? completionItems() : [];
}

// A canonicalization rewrite for the operation/variable under `offset` (inside a
// tag), or null — the data behind the "rewrite X → Y" quick-fix. Returns the word
// range and the canonical replacement. Alias rewrites apply in any dialect; the
// scoped-variable rewrite (index → index0, partial-block → yield) is native to
// RawBars/MaxBars only (FullBars/MinBars keep Handlebars' @index/@partial-block).
export function canonAt(text, dialect, offset) {
  if (!inTagContext(text, dialect, offset)) return null;
  const w = wordAt(text, offset);
  if (!w) return null;
  const r = rewriteFor(w.word);
  if (!r) return null;
  if (r.source === "scoped" && dialect !== "rawbars" && dialect !== "maxbars") return null;
  return { from: w.start, to: w.end, name: w.word, canonical: r.canonical };
}

// The LSP `SemanticTokens.data`: a flat array of 5-tuples
// [deltaLine, deltaStartChar, length, tokenType, tokenModifiers], delta-encoded
// against the previous token (the wire format `semanticTokens/full` returns).
export function encodeSemanticTokens(text, dialect, vocab = vocabulary, legend = buildLegend(vocab)) {
  const enc = kindEncoder(vocab, legend);
  const data = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of tokensOf(text, dialect)) {
    const e = enc.get(t.kind);
    if (!e) continue; // a kind the vocabulary does not map (should not happen)
    const deltaLine = t.line - prevLine;
    const deltaChar = deltaLine === 0 ? t.char - prevChar : t.char;
    data.push(deltaLine, deltaChar, t.length, e.typeIndex, e.bits);
    prevLine = t.line;
    prevChar = t.char;
  }
  return { data };
}
