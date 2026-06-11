// SPDX-License-Identifier: Apache-2.0
//
// INNER-TOKEN painter for the FlatBars highlighters (the Lab editor + the
// tutorials cards/operation-heavy pages). The Lab/tutorials have no TextMate
// grammar layer the way VS Code does, so this does a FULL per-character paint
// — STRUCTURE (braces, block sigils/keywords, comments, set-delimiters) AND the
// LSP's SEMANTIC operation pass (helper names in head / pipe / subexpression
// position). The goal is to read exactly like VS Code's 2026-dark rendering
// (grammar floor + LSP semantic tokens), not the old "whole tag, one colour".
//
// The operation pass is a FAITHFUL PORT of the LSP painter (editors/lsp/src/
// tokens.mjs `paintHeadOperation` / `paintPipeTargets` / `paintSubexpressionHeads`
// / `paintIdentAt`, gated by each tag kind's `operationPosition`). A drift gate
// (scripts/check-paint-parity.mjs) asserts this stays byte-identical to the LSP
// on a corpus, so the two paths can't silently diverge (ADR-017's one-contract
// rule). The eventual single-source refactor (debate proposal C) extracts this
// pass so the LSP imports it too.
//
// It emits KINDS; the two front-ends map each kind to a `--c-*` palette class.
// It uses ONLY the engine bundle's `tokenize` (so tag boundaries / dialects
// agree with the engine) + an injected `isOperation(name)` predicate (the host
// supplies the prelude vocabulary — the Lab from `lab/operation-names.mjs`, the
// tutorials from editors/operations.json, both projections of the same prelude),
// keeping it self-contained and browser-safe.
import { tokenize } from "./vendor/flatbars-engine.mjs?v=94529c81";

// Per-tag-kind operation position — HARDCODED from the LSP token vocabulary
// (`operationPosition`), since the browser Lab can't import editors/ JSON at
// runtime. `head`: the first identifier is the helper (`{{lookup x}}` → lookup;
// plain `{{name}}` stays default). `always-head`: paint the head regardless
// (partial names). `any`: the head is the block keyword (painted structurally);
// only subexpression heads + pipe targets in the body are operations. Absent =
// none (comment / raw-block / set-delimiter / clause keyword / error).
const OP_POSITION = {
  expr: "head",
  raw: "head",
  "block-open": "any",
  "block-inverse": "any",
  "block-parent": "any",
  "block-decl": "any",
  "block-close": "any",
  partial: "always-head",
};

// A leaf identifier, exactly as the LSP's `IDENT_RE` (no dots — a dotted path
// like `loop.index0` is data, never a helper).
const IDENT_RE = /^[A-Za-z_][\w-]*/;
// Block / inheritance / partial-import sigils + their keyword word. Clause
// keywords (`{{else}}` / `{{elif}}`) are NOT special-cased here: the engine's
// `tokenize` already gives them the `keyword` kind in dialects where they ARE
// clause separators (ClassicBars/MaxBars); in MinBars `{{else}}` is a plain `expr`
// (Mustache has no `else`), so the operation pass owns it — exactly like the LSP.
const SIGIL_KW = /^[#^/]\s*[A-Za-z_][\w-]*/;

// Paint `text` (under `dialect`) into a flat array of non-overlapping segments
// `{ from, to, kind, inTag }` covering [0, text.length). `isOperation(name)`
// returns true for a known prelude helper.
export function paintKinds(text, dialect = "classicbars", isOperation = () => false) {
  const n = text.length;
  const kind = new Array(n).fill(null);
  const inTag = new Array(n).fill(false);
  // Defensive: a non-FlatBars dialect (the Lab's Stem engine) or a lex failure
  // yields no spans → the whole text stays default (no highlighting), never an
  // exception that would kill the editor.
  let raw;
  try { raw = tokenize(text, dialect); } catch { raw = null; }
  const spans = (raw || []).filter((s) => s && s.to > s.from);

  // 1. Structure — the part VS Code's TextMate grammar floors: braces, block /
  //    inheritance / partial-import sigils, clause keywords, comments, set-delims.
  for (const s of spans) {
    if (s.role !== "tag") continue;
    for (let i = s.from; i < s.to; i++) inTag[i] = true;
    paintStructure(kind, text, s, n);
  }
  // 2. Interior literals (string/number) — the engine already located them.
  for (const s of spans) {
    if (s.role === "interior" && (s.kind === "string" || s.kind === "number")) fill(kind, s.from, s.to, s.kind, n);
  }
  // 3. Operations — the LSP's semantic pass, ported exactly. Only paints cells
  //    still `null` (so it never overwrites a brace / keyword / literal).
  for (const s of spans) {
    if (s.role === "tag") paintOps(kind, text, s, isOperation, n);
  }
  return toSegments(kind, inTag, n);
}

// The [from, to) range of every tag (role=tag span) — the whole `{ … }`, braces
// included. The highlighters lay one `tag-bg` plate over each so a tag reads as a
// single pill, with the per-token colours layered on top. Defensive (a non-tag
// dialect / lex failure yields none), like paintKinds.
export function tagRanges(text, dialect = "classicbars") {
  let raw;
  try { raw = tokenize(text, dialect); } catch { raw = null; }
  return (raw || [])
    .filter((s) => s && s.role === "tag" && s.to > s.from)
    .map((s) => ({ from: s.from, to: s.to }));
}

function fill(kind, from, to, k, n) {
  for (let i = Math.max(0, from); i < Math.min(n, to); i++) kind[i] = k;
}
const braceLens = (tag) =>
  // A `{% … %}` statement tag (docs-19): the two-char `{%` / `%}` delimiters are the
  // escape tokens (the grammar's #statement_tag scopes them punctuation).
  tag.startsWith("{%")
    ? [2, tag.endsWith("%}") ? 2 : 0]
    : [(tag.match(/^\{{2,4}/) || [""])[0].length, (tag.match(/\}{2,4}$/) || [""])[0].length];

function paintStructure(kind, text, s, n) {
  const { from, to } = s;
  if (s.kind === "comment") {
    // The WHOLE comment — delimiters included (`{{!` / `{{!--` … `--}}` / `}}`) —
    // reads in the comment colour. This matches the editor grammar (the comment
    // braces are `punctuation.definition.comment.*`, the comment family, not the
    // generic `punctuation.section.embedded`) and the universal convention
    // (HTML/C/Handlebars) that the delimiters are part of the comment.
    fill(kind, from, to, "comment", n);
    return;
  }
  if (s.kind === "set-delimiter") {
    // VS Code keeps the set-delim BRACES punctuation (the grammar) and paints only
    // the `=A B=` directive body (the LSP's `set-delimiter` semantic token). Match
    // that: braces punct, inner delim. (For a delimiter-SWITCHED tag the braces
    // aren't `{{`, so braceLens returns 0/0 and the whole tag stays delim.)
    const dtag = text.slice(from, to);
    const [dOpen, dClose] = braceLens(dtag);
    fill(kind, from, from + dOpen, "punct", n);
    fill(kind, from + dOpen, to - dClose, "delim", n);
    fill(kind, to - dClose, to, "punct", n);
    return;
  }
  // `error` (dialect-disallowed) and `unterminated` (recovering lexer, ADR-023)
  // both paint as the error style — a broken/illegal tag, wavy-underlined.
  if (s.kind === "error" || s.kind === "unterminated") { fill(kind, from, to, "error", n); return; }

  const tag = text.slice(from, to);
  // A raw block is ONE span covering BOTH tags — the opener `{{{{[#]name}}}}` and
  // the closer `{{{{/name}}}}` — with a verbatim body between. Paint all four brace
  // clusters (punct) and the `#`/`/` sigils (keyword); the body + name stay default.
  // (The generic open/close paint below would only reach the outer `{{{{` and the
  // final `}}}}`, leaving the opener's `}}}}` and the `{{{{/` unhighlighted.)
  if (s.kind === "raw-block") {
    // Mirror VS Code's `raw_block` grammar: the `{{{{`/`}}}}` braces are punct, and
    // the WHOLE head — the `#`/`/` sigil + name — is one `keyword.control.section`
    // span, so `#myraw` and `/myraw` share the section scope (painted keyword), like
    // `{{#each}}` / `{{/each}}` at the double-brace level.
    const open = tag.match(/^(\{\{\{\{)(\s*)(#?\w[\w./@-]*)(\s*)(\}\}\}\})/);
    if (open) {
      fill(kind, from, from + 4, "punct", n); // {{{{
      const hs = from + open[1].length + open[2].length;
      fill(kind, hs, hs + open[3].length, "keyword", n); // #name (section)
      const oEnd = from + open[0].length;
      fill(kind, oEnd - 4, oEnd, "punct", n); // }}}}
    }
    const close = tag.match(/(\{\{\{\{)(\s*)(\/\w[\w./@-]*)(\s*)(\}\}\}\})$/);
    if (close) {
      const cFrom = to - close[0].length;
      fill(kind, cFrom, cFrom + 4, "punct", n); // {{{{
      const hs = cFrom + close[1].length + close[2].length;
      fill(kind, hs, hs + close[3].length, "keyword", n); // /name (section)
      fill(kind, to - 4, to, "punct", n); // }}}}
    }
    return;
  }
  const [openLen, closeLen] = braceLens(tag);
  fill(kind, from, from + openLen, "punct", n);
  fill(kind, to - closeLen, to, "punct", n);

  // Find the first non-whitespace char after the opener.
  let i = from + openLen;
  const end = to - closeLen;
  while (i < end && /\s/.test(text[i])) i++;
  const inner = text.slice(i, end);

  // A clause tag ({{else}} / {{elif …}} / the `{{else if paused}}` chain) — the
  // WHOLE inner is the keyword token, matching VS Code: the grammar leaves `else`
  // unscoped, so the LSP fills a keyword tag's entire shrunk-inner with `keyword`
  // (`flatten` → `fillRange(shrinkToInner(...))`), not just the first word. Trim
  // surrounding whitespace / `~` exactly as the LSP's shrinkToInner does.
  if (s.kind === "keyword") {
    let a = i;
    let e = end;
    while (a < e && /[~\s]/.test(text[a])) a++;
    while (e > a && /[~\s]/.test(text[e - 1])) e--;
    if (e > a) fill(kind, a, e, "keyword", n);
    return;
  }
  // Block / inverse / close sigil + word ({{#if}}, {{^x}}, {{/each}}).
  if (s.kind.startsWith("block")) {
    const sk = inner.match(SIGIL_KW);
    if (sk) { fill(kind, i, i + sk[0].length, "keyword", n); return; }
    // A block sigil with no word after it — inline-partial-block {{#> p}} or
    // decorator {{#* inline}}: the grammar scopes only the `#` as
    // keyword.control.section (the `>` / `*` is keyword.operator → default). Paint
    // just the sigil char; the partial name stays default (the LSP leaves it).
    if (/^[#^/]/.test(inner)) { fill(kind, i, i + 1, "keyword", n); return; }
    // A `{% … %}` statement tag (docs-19): the head is a BAREWORD (no sigil) —
    // `if`/`each`/`case`/`unless`/`with`/`local`/`endX` — scoped keyword.control by
    // the grammar's #statement_tag rule. Paint the head word; args stay default.
    if (tag.startsWith("{%")) {
      const w = inner.match(/^#?[A-Za-z_][\w-]*/);
      if (w) { fill(kind, i, i + w[0].length, "keyword", n); return; }
    }
  }
  // Inheritance / partial sigils ({{<l}}, {{$b}}, {{> p}}). Paint ONLY the sigil
  // char (the grammar's keyword.control.import) — NOT the trailing whitespace —
  // and leave the name for the operation pass (always-head → operation), matching
  // VS Code (partial names paint as the `function` semantic token).
  const im = inner.match(/^[<$>+]/);
  if (im) fill(kind, i, i + im[0].length, "keyword", n);
}

// ── The LSP operation pass, ported verbatim (editors/lsp/src/tokens.mjs) ──────
function paintOps(kind, text, s, isOp, n) {
  const pos = OP_POSITION[s.kind];
  if (!pos) return;
  const tag = text.slice(s.from, s.to);
  const [openLen, closeLen] = braceLens(tag);
  const bodyStart = s.from + openLen;
  const bodyEnd = s.to - closeLen;
  if (pos === "head") paintHeadOperation(kind, text, s, openLen, closeLen, false, isOp, n);
  else if (pos === "always-head") paintHeadOperation(kind, text, s, openLen, closeLen, true, isOp, n);
  paintSubexpressionHeads(kind, text, bodyStart, bodyEnd, isOp, n);
  paintPipeTargets(kind, text, bodyStart, bodyEnd, isOp, n);
}

function paintHeadOperation(kind, text, s, openLen, closeLen, always, isOp, n) {
  let i = s.from + openLen;
  const end = s.to - closeLen;
  while (i < end && /[~&\s]/.test(text[i])) i++; // whitespace-control ~, raw &, ws
  if (text[i] === ">") { // partial sigil (with optional * decorator)
    i++;
    if (text[i] === "*") i++;
    while (i < end && /\s/.test(text[i])) i++;
  }
  paintIdentAt(kind, text, i, end, always, isOp, n);
}

function paintPipeTargets(kind, text, bodyStart, bodyEnd, isOp, n) {
  for (let i = bodyStart; i < bodyEnd; i++) {
    if (text[i] !== "|" || text[i - 1] === "|" || text[i + 1] === "|") continue;
    let j = i + 1;
    while (j < bodyEnd && /\s/.test(text[j])) j++;
    paintIdentAt(kind, text, j, bodyEnd, false, isOp, n);
  }
}

function paintSubexpressionHeads(kind, text, bodyStart, bodyEnd, isOp, n) {
  for (let i = bodyStart; i < bodyEnd - 1; i++) {
    if (text[i] !== "(" || kind[i] !== null) continue;
    let j = i + 1;
    while (j < bodyEnd && /\s/.test(text[j])) j++;
    paintIdentAt(kind, text, j, bodyEnd, false, isOp, n);
  }
}

function paintIdentAt(kind, text, i, to, always, isOp, n) {
  const m = IDENT_RE.exec(text.slice(i, to));
  if (!m) return;
  const after = text[i + m[0].length];
  if (after === "." || after === "/") return; // a dotted/segment path is data
  if (!always && !isOp(m[0])) return;
  for (let k = i; k < i + m[0].length; k++) if (kind[k] === null) kind[k] = "operation";
}

function toSegments(kind, inTag, n) {
  const segs = [];
  let i = 0;
  while (i < n) {
    const k = kind[i];
    const t = inTag[i];
    let j = i + 1;
    while (j < n && kind[j] === k && inTag[j] === t) j++;
    segs.push({ from: i, to: j, kind: k, inTag: t });
    i = j;
  }
  return segs;
}

// The kind → palette-class map the front-ends share, so the Lab and the
// tutorials (and the legend) can never drift. `null` → no class (default).
export const KIND_CLASS = {
  punct: "tk-punct",
  keyword: "tk-keyword",
  operation: "tk-operation",
  number: "tk-number",
  string: "tk-string",
  comment: "tk-comment",
  delim: "tk-delim",
  error: "tk-error",
};

// A per-character kind array (for the parity gate / consumers that prefer it).
export function paintCharKinds(text, dialect = "classicbars", isOperation = () => false) {
  const kinds = new Array(text.length).fill(null);
  for (const seg of paintKinds(text, dialect, isOperation)) {
    for (let i = seg.from; i < seg.to; i++) kinds[i] = seg.kind;
  }
  return kinds;
}
