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
// Returns null if the extension picks no dialect. Each dialect ships long-form
// (`.rawbars`) and short-form (`.rbars`) extensions; FullBars also claims the
// Handlebars extensions and MinBars the Mustache extension (see
// editors/shared/sync.mjs LANGUAGES for the canonical mapping).
const URI_EXTENSION_DIALECT = {
  ".rawbars": "rawbars",
  ".rbars": "rawbars",
  ".minbars": "minbars",
  ".mbars": "minbars",
  ".mustache": "minbars",
  ".fullbars": "fullbars",
  ".fbars": "fullbars",
  ".hbs": "fullbars",
  ".handlebars": "fullbars",
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
  const parser = engineDiagnostics(text, dialect).map((d) => {
    const close = text.indexOf("}}", d.offset);
    const end = close < 0 ? Math.min(d.offset + 2, text.length) : close + 2;
    return { start: d.offset, end, message: d.message };
  });
  return [...parser, ...dialectDiagnostics(text, dialect)];
}

// Dialect-level diagnostics: shapes the engine's STRUCTURAL parser accepts but
// the dialect's semantics reject. The structural parser (ADR-001) is shared
// across dialects — it doesn't know that Mustache (MinBars) has no
// subexpressions, no helper invocations, and no block parameters. Without this
// pass, `{{#each (lookup this "items")}}` would surface no diagnostic in a
// `.minbars` file even though the engine refuses to render it.
//
// The checks operate on token spans the engine already gives us, scoped per
// non-comment / non-raw-block tag. Each violation reports the OFFENDING SUBSPAN
// (the `(` for subexpression, or the helper-arg gap) so the squiggle lands on
// the actual problem, not the whole tag. Per-dialect rules:
//   * MinBars — no subexpressions, no helper invocations (tag body must be a
//     single path: `name`, `name.foo`, `name/foo`, `[seg.with.dot]`).
//   * RawBars — same as MinBars (core dialect has no helpers either).
//   * FullBars / MaxBars — no extra checks; the parser already accepts their
//     full surface.
export function dialectDiagnostics(text, dialect) {
  if (dialect !== "minbars" && dialect !== "rawbars") return [];
  const out = [];
  for (const s of tokenize(text, dialect)) {
    if (s.role !== "tag") continue;
    if (s.kind === "comment" || s.kind === "raw-block" || s.kind === "error") continue;
    if (s.kind === "set-delimiter") continue; // {{=A B=}} legitimately has internal space
    const body = bodyOfTag(text, s);
    if (!body) continue;
    // Most-specific rules first, so the diagnostic message matches the actual
    // construct rather than the generic "helper invocation" catch-all. Each rule
    // returns the diagnostic offset in body.text (or -1); we stop at the first
    // hit per tag so squiggle spam stays manageable.
    const finders = [
      findSubexpression,
      findBlockParam,
      findPartialHashArg(s.kind),
      findOperator,
      findHelperArgs,
    ];
    for (const finder of finders) {
      const hit = finder(body.text);
      if (hit) {
        out.push({
          start: body.from + hit.at,
          end: body.from + hit.at + hit.len,
          message: hit.msg(displayName(dialect)),
        });
        break;
      }
    }
  }
  return out;
}

function findSubexpression(body) {
  const at = findOutsideStrings(body, "(");
  if (at < 0) return null;
  return {
    at, len: 1,
    msg: (d) => `Subexpressions \`(…)\` are not valid in ${d} — only a single path is allowed in a tag.`,
  };
}

function findBlockParam(body) {
  // ` as |x|` or ` as |x y|`. The leading space is mandatory so we don't false-
  // positive on identifiers that happen to start with `as`.
  const m = /\sas\s*\|/.exec(body);
  if (!m) return null;
  return {
    at: m.index, len: m[0].length,
    msg: (d) => `Block parameters (\`as |…|\`) are not valid in ${d} — sections take only a single name.`,
  };
}

function findPartialHashArg(kind) {
  return (body) => {
    if (kind !== "partial") return null;
    // `name=value` anywhere in the body outside strings; `=` outside a string
    // is the simplest signal. Skip the partial sigil (`>`/`>*`) plus the
    // partial name — those don't contain `=`.
    const at = findOutsideStrings(body, "=");
    if (at < 0) return null;
    return {
      at, len: 1,
      msg: (d) => `Partial hash arguments (\`name=value\`) are not valid in ${d} — only the partial name is allowed.`,
    };
  };
}

function findOperator(body) {
  // MaxBars operators that the engine's tokenize doesn't classify as `error`
  // when the dialect doesn't support them — `??` / `==` / `!=` / `<=` / `>=` /
  // `<-` / `&&` / `||`. Single-char operators (`<`/`>`/`+`/`*`/`%`/`!`/`|`/`-`)
  // are too noisy to flag at this layer because identifier punctuation often
  // overlaps; the helper-args rule catches them via the whitespace-gap test.
  const multi = body.match(/\?\?|==|!=|<=|>=|<-|&&|\|\|/);
  if (!multi) return null;
  return {
    at: multi.index, len: multi[0].length,
    msg: (d) => `Operator \`${multi[0]}\` is a MaxBars feature, not valid in ${d}.`,
  };
}

function findHelperArgs(body) {
  const at = findHelperArgsGap(body);
  if (at < 0) return null;
  return {
    at, len: 1,
    msg: (d) => `Helper invocations with arguments are not valid in ${d} — a tag body is a single path, not a function call.`,
  };
}

function bodyOfTag(text, s) {
  // Skip braces, sigils, ~ at both ends; the rest is the body.
  let from = s.from;
  let to = s.to;
  while (from < to && /[{}~]/.test(text[from])) from++;
  if (from < to && /[#/\^<$>&!=]/.test(text[from])) from++; // sigil
  if (from < to && text[from] === "*") from++; // partial-block decorator
  while (to > from && /[{}~]/.test(text[to - 1])) to--;
  if (to > from && text[to - 1] === "=") to--; // set-delim close (defensive)
  return from < to ? { from, text: text.slice(from, to) } : null;
}

function findOutsideStrings(s, ch) {
  let inStr = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === ch) {
      return i;
    }
  }
  return -1;
}

function findHelperArgsGap(s) {
  // Trim leading/trailing whitespace, then scan for the first whitespace run
  // that separates two non-string identifiers. Strings are skipped entirely
  // so `{{> "p"}}` (illegal in different ways) doesn't flag here.
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i++;
  // Skip the first identifier / path / bracketed segment.
  let inStr = null;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      i++;
    } else if (c === '"' || c === "'") {
      inStr = c;
      i++;
    } else if (/\s/.test(c)) {
      break;
    } else {
      i++;
    }
  }
  // i is now on the first whitespace or end of body. Check whether there's a
  // non-whitespace token after — if so, it's helper-args territory.
  const ws = i;
  while (i < s.length && /\s/.test(s[i])) i++;
  return i < s.length ? ws : -1;
}

function displayName(dialect) {
  return dialect === "minbars" ? "MinBars (Mustache)" : "RawBars";
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
  for (const s of spans) {
    if (s.role !== "tag") continue;
    if (emitKinds.has(s.kind)) {
      const [from, to] = shrinkToInner(text, s.from, s.to);
      fillRange(kinds, from, to, s.kind);
    } else if (isDelimiterSwitched(text, s)) {
      // After a `{{=A B=}}` directive the active delimiters change (ADR-015) and
      // the stateless TextMate grammar can no longer match subsequent tags —
      // `<%name%>` reads as content. The engine still tokenises them correctly,
      // so the LSP fills the gap by emitting whole-tag semantic tokens for any
      // tag whose delimiters aren't the grammar's hard-coded default `{{`/`}}`.
      // This is the one place the LSP paints tag-level tokens for an `expr` /
      // `block-open` / etc. kind outside `lspEmitKinds`.
      fillRange(kinds, s.from, s.to, s.kind);
    }
  }
  for (const s of spans) if (s.role === "interior" && emitKinds.has(s.kind)) fillRange(kinds, s.from, s.to, s.kind);
  if (emitKinds.has("operation")) paintOperations(kinds, text, spans);
  return kinds;
}

// True when the tag's opener is not the grammar's default `{{` (i.e. a directive
// earlier in the document switched the active delimiters via `{{=A B=}}`). The
// TextMate grammar hard-codes `{{`/`}}` patterns, so a tag opening with anything
// else needs the LSP to paint the whole span.
function isDelimiterSwitched(text, s) {
  return text[s.from] !== "{";
}

// Paint operation-position identifiers (helper names) as the `operation` kind.
// Per-tag-kind position policy comes from the vocabulary's `operationPosition`
// field, so a vocab edit (e.g. flipping a new kind to `any`) immediately changes
// LSP behaviour without touching this file. Catalog lookup gates `head` and `any`
// (plain variables stay default-coloured); `always-head` skips the catalog (used
// for partial names — user-defined, never in the catalogue).
const operationPositionByKind = (() => {
  const m = new Map();
  for (const [k, def] of Object.entries(vocabulary.kinds)) {
    if (def.role === "tag" && def.operationPosition) m.set(k, def.operationPosition);
  }
  return m;
})();
const IDENT_RE = /^[A-Za-z_][\w-]*/;

function paintOperations(kinds, text, spans) {
  for (const s of spans) {
    if (s.role !== "tag") continue;
    const pos = operationPositionByKind.get(s.kind);
    if (!pos || pos === "none") continue;
    if (pos === "head") paintHeadOperation(kinds, text, s, false);
    else if (pos === "always-head") paintHeadOperation(kinds, text, s, true);
    // `any` (block tags): the head is the grammar's keyword.control.section;
    // we only scan subexpression heads + pipe targets inside the body.
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

function paintHeadOperation(kinds, text, s, alwaysPaint) {
  let i = s.from;
  // Skip braces, whitespace-control `~`, raw sigil `&`, whitespace.
  while (i < s.to && /[{}~&\s]/.test(text[i])) i++;
  // Partial sigil `>` (with optional `*` decorator) then whitespace.
  if (text[i] === ">") {
    i++;
    if (text[i] === "*") i++;
    while (i < s.to && /\s/.test(text[i])) i++;
  }
  paintIdentAt(kinds, text, i, s.to, alwaysPaint);
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

// ── Folding (ADR-026) ────────────────────────────────────────────────────────
// Every matched (block-open, block-close) pair is a fold region; every raw-block
// open/close pair is one too. We pair by the block-open's *body word* — Mustache
// requires `{{/name}}` to match the open's `{{#name}}`, so two scans by `bodyWord`
// give a correct stack. Unbalanced opens are dropped silently (the diagnostics
// path already reports them as parse errors).
const BLOCK_OPEN_KINDS = new Set(["block-open", "block-inverse", "block-parent", "block-decl", "raw-block"]);
const BLOCK_CLOSE_KIND = "block-close";

export function foldingRangesOf(text, dialect) {
  const spans = tokenize(text, dialect);
  const stack = [];
  const ranges = [];
  // raw-block tokens come as a single span; its `from`/`to` cover the WHOLE block
  // (open through close). Emit it directly. Other block tags pair up.
  for (const s of spans) {
    if (s.role !== "tag") continue;
    if (s.kind === "raw-block") {
      ranges.push({ start: lineOf(text, s.from), end: lineOf(text, s.to - 1) });
      continue;
    }
    if (BLOCK_OPEN_KINDS.has(s.kind)) stack.push({ word: bodyWord(text, s), line: lineOf(text, s.from) });
    else if (s.kind === BLOCK_CLOSE_KIND) {
      const word = bodyWord(text, s);
      // Pop until we find a matching open (silently drops unbalanced opens).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].word === word) {
          ranges.push({ start: stack[i].line, end: lineOf(text, s.from) });
          stack.splice(i);
          break;
        }
      }
    }
  }
  // Drop zero-length folds (open + close on same line) — they're invalid LSP.
  return ranges.filter((r) => r.end > r.start);
}

function bodyWord(text, s) {
  // Skip braces, sigils, `~`, whitespace; capture the next identifier.
  let i = s.from;
  while (i < s.to && /[{}~#/\^<$>&!\s]/.test(text[i])) i++;
  const m = IDENT_RE.exec(text.slice(i, s.to));
  return m ? m[0] : "";
}

function lineOf(text, offset) {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// ── Document symbols (ADR-026) ───────────────────────────────────────────────
// Project the block-nesting hierarchy as an LSP `DocumentSymbol[]` tree. Used by
// IntelliJ's Structure View and VS Code's outline. Symbol name = body word; range
// covers the whole block; selectionRange = the open tag's body word.
export function documentSymbolsOf(text, dialect) {
  const spans = tokenize(text, dialect);
  const root = { children: [] };
  const stack = [root];
  for (const s of spans) {
    if (s.role !== "tag") continue;
    if (s.kind === "raw-block") {
      stack[stack.length - 1].children.push(makeSymbol(text, s, s.to, "raw-block"));
      continue;
    }
    if (BLOCK_OPEN_KINDS.has(s.kind)) {
      const sym = makeSymbol(text, s, null, s.kind);
      stack[stack.length - 1].children.push(sym);
      stack.push(sym);
    } else if (s.kind === BLOCK_CLOSE_KIND) {
      const word = bodyWord(text, s);
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].word === word) {
          stack[i].endOffset = s.to;
          stack.length = i;
          break;
        }
      }
    }
  }
  return projectSymbols(text, root.children);
}

function makeSymbol(text, openSpan, endOffset, kind) {
  return {
    word: bodyWord(text, openSpan) || "(anonymous)",
    kind,
    startOffset: openSpan.from,
    endOffset, // filled when the matching close is seen (null = unbalanced; we drop these)
    children: [],
  };
}

function projectSymbols(text, items) {
  const result = [];
  for (const s of items) {
    if (s.endOffset == null) continue; // unbalanced — parse diagnostics will flag it
    result.push({
      name: `#${s.word}`,
      kind: s.kind === "raw-block" ? "macro" : "function",
      from: s.startOffset,
      to: s.endOffset,
      children: projectSymbols(text, s.children),
    });
  }
  return result;
}

// ── Formatting (ADR-026) ─────────────────────────────────────────────────────
// Canonical-spacing inside `{{ … }}`: idempotent, dialect-agnostic. The rules
// follow Handlebars / Mustache convention rather than blanket-padding:
//   * No-sigil tags get Mustache-style padding ({{ name }}).
//   * Sigil tags glue the sigil to its identifier ({{#each items}}).
//   * Partial sigil keeps the conventional space ({{> partial}}).
//   * Set-delim pairs balance ({{= <% %> =}}).
//   * Comments and raw-block bodies are opaque and never reformatted.
const SKIP_FORMAT_KINDS = new Set(["comment", "raw-block"]);

export function formatDocument(text, dialect) {
  const edits = [];
  for (const s of tokenize(text, dialect)) {
    if (s.role !== "tag") continue;
    if (SKIP_FORMAT_KINDS.has(s.kind)) continue;
    const tag = text.slice(s.from, s.to);
    const formatted = canonicaliseTag(tag);
    if (formatted !== tag) edits.push({ from: s.from, to: s.to, newText: formatted });
  }
  return edits;
}

function canonicaliseTag(tag) {
  const openMatch = tag.match(/^(\{+)(~?)([#/\^<$>&=!]?)(\*?)/);
  const closeMatch = tag.match(/(=?)(~?)(\}+)$/);
  if (!openMatch || !closeMatch) return tag;
  const [, openBraces, openTilde, sigil, partialStar] = openMatch;
  const [, closeEq, closeTilde, closeBraces] = closeMatch;
  const bodyStart = openMatch[0].length;
  const bodyEnd = tag.length - closeMatch[0].length;
  if (bodyStart > bodyEnd) return tag; // overlapping match: leave alone
  const body = tag.slice(bodyStart, bodyEnd).trim().replace(/\s+/g, " ");
  const open = openBraces + openTilde + sigil + partialStar;
  const close = closeEq + closeTilde + closeBraces;
  return open + canonicaliseBody(body, sigil) + close;
}

function canonicaliseBody(body, sigil) {
  if (body === "") return sigil === "" ? " " : "";
  // No sigil → Mustache padding ({{ name }}).
  if (sigil === "") return " " + body + " ";
  // Set-delim → balanced spaces inside the `=` pair ({{= A B =}}).
  if (sigil === "=") return " " + body + " ";
  // Partial → conventional space between `>` and the partial name ({{> p}}).
  if (sigil === ">") return " " + body;
  // Other sigils (`#`, `/`, `^`, `<`, `$`, `&`, `!`) — glue at both ends, the
  // Handlebars convention: `{{#each items}}`, `{{/each}}`, `{{^empty}}`.
  return body;
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
