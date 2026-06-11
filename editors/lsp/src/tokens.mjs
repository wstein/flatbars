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

// The engine has four surfaces; `tokenize` / `dialectDiagnostics` below accept any of them
// (the FlatBars Lab and the paint-parity gate exercise all four). The SHIPPED editor
// language, however, is Trussbars-only — the plugins contribute one language, `trussbars`,
// whose engine surface is `maxbars` (Trussbars is MaxBars→Rust). So a document's `maxbars`
// engine dialect is reached through the `trussbars` language id / the `.truss` extension.
export const DIALECTS = ["rawbars", "minbars", "classicbars", "maxbars"];

// The shipped editor language id → its engine dialect. Only `trussbars` ships.
const LANGUAGE_DIALECT = { trussbars: "maxbars" };

export function dialectForLanguageId(languageId) {
  return LANGUAGE_DIALECT[languageId] ?? (DIALECTS.includes(languageId) ? languageId : null);
}

// A robust fallback when the languageId is not the shipped language (a host — e.g.
// JetBrains — that doesn't send our id): map the native extension. The Trussbars-only
// plugins associate a single extension, `.truss`, onto the `maxbars` engine surface.
const URI_EXTENSION_DIALECT = {
  ".truss": "maxbars",
};

export function dialectForUri(uri) {
  const lower = String(uri).toLowerCase();
  for (const [ext, d] of Object.entries(URI_EXTENSION_DIALECT)) if (lower.endsWith(ext)) return d;
  return null;
}

// The resolution the server uses: languageId first, then the URI, then the
// configured default (ClassicBars unless overridden).
export function resolveDialect(languageId, uri, fallback = "maxbars") {
  // The `fallback` (the `flatbars.defaultDialect` setting) is a shipped language id, so
  // normalise it through `dialectForLanguageId` (`trussbars` → `maxbars`); a final
  // `maxbars` keeps the result a valid engine dialect for `tokenize`.
  return (
    dialectForLanguageId(languageId) ??
    dialectForUri(uri) ??
    dialectForLanguageId(fallback) ??
    "maxbars"
  );
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
//   * ClassicBars / MaxBars — no extra checks; the parser already accepts their
//     full surface.
export function dialectDiagnostics(text, dialect) {
  // Set-delimiter directives are a MinBars (Mustache) feature only (ADR-015
  // amendment). RawBars, MaxBars, and ClassicBars all reject `{{=A B=}}` at the
  // parser; the recovering parser surfaces a generic "LexError: unexpected
  // character" without telling the user the feature is dialect-gated. Surface
  // an actionable message at the `=` instead. MinBars accepts silently.
  if (dialect === "classicbars" || dialect === "rawbars" || dialect === "maxbars") {
    const out = [];
    const re = /\{\{=/g;
    let m;
    const dialectName = { classicbars: "ClassicBars (Handlebars surface)", rawbars: "RawBars", maxbars: "MaxBars" }[dialect];
    while ((m = re.exec(text)) !== null) {
      out.push({
        start: m.index,
        end: m.index + 3,
        message:
          `Set-delimiter directives \`{{=A B=}}\` are not valid in ${dialectName} — ` +
          `they're a Mustache feature reserved for MinBars. Switch the file to MinBars ` +
          `to use them (Cmd-Shift-P → Change Language Mode).`,
      });
    }
    // The bounded binding `{{#local}}` is a RawBars/MaxBars construct (ADR-024,
    // renamed from `let` by docs-17). In ClassicBars it has no meaning (the engine
    // rejects it at render, `checkSurfaceStrict`) — surface that here as an actionable
    // editor message rather than a silent no-op.
    if (dialect === "classicbars") {
      const localRe = /\{\{~?#local\b/g;
      let lm;
      while ((lm = localRe.exec(text)) !== null) {
        out.push({
          start: lm.index,
          end: lm.index + lm[0].length,
          message:
            "The bounded binding `{{#local}}` is a RawBars/MaxBars construct — ClassicBars has no `local`. " +
            "Alias with `{{#with x as |n|}}`, or switch the file to MaxBars " +
            "(Cmd-Shift-P → Change Language Mode).",
        });
      }
    }
    // The `let` keyword is retired (docs-17) — flag it in every nonEmpty dialect, in
    // both the `{{#let}}` (ClassicBars braces) and `{% let %}` (RawBars/MaxBars
    // statement-tag) spellings, with a pointer to the scope-named replacements.
    {
      const letRe = /\{\{~?#let\b|\{%~?\s*let\b/g;
      let lm;
      while ((lm = letRe.exec(text)) !== null) {
        out.push({
          start: lm.index,
          end: lm.index + lm[0].length,
          message:
            "`{{#let}}` / `{% let %}` is retired (docs-17) — the bounded binding is now " +
            "`{% local … %} … {% endlocal %}`, the forward binding `{% set name = … %}`.",
        });
      }
    }
    if (dialect === "classicbars") return out;
    // MaxBars binds loops Liquid-style (`{{#each x in xs}}`); the removed trailing
    // `{{#each … as …}}` form parses but the engine rejects it at render
    // (`checkSurfaceStrict`, MaxBars path). Flag it here too, with the `x in xs`
    // fix, rather than letting it silently render empty. (`with`/helper `as` stays.)
    if (dialect === "maxbars") {
      const eachAsRe = /\{\{~?#each\b[^}]*?\sas\s/g;
      let em;
      while ((em = eachAsRe.exec(text)) !== null) {
        out.push({
          start: em.index,
          end: em.index + em[0].length,
          message:
            "MaxBars binds loops Liquid-style — write the names before `in`, " +
            "e.g. `{{#each x in xs}}` or `{{#each x i in xs}}`. The trailing `as` " +
            "form on `each` is gone (`scope`/custom helpers still use `as`).",
        });
      }
      // The re-rooting `{% with %}` is renamed `{% scope %}` in MaxBars (ADR-039);
      // the engine rejects `with` at render. Flag it here with the rename fix
      // (RawBars keeps `with`, so this rule is MaxBars-only).
      const withRe = /\{%~?\s*with\b/g;
      let wm;
      while ((wm = withRe.exec(text)) !== null) {
        out.push({
          start: wm.index,
          end: wm.index + wm[0].length,
          message:
            "The context re-root is spelled `{% scope … %} … {% endscope %}` in MaxBars (ADR-039) — " +
            "`with` is reserved. (RawBars keeps `{% with %}`.)",
        });
      }
      // The loop keyword is `for` in MaxBars (ADR-039 item 4); `{% each %}` is
      // rejected at render. Flag it with the rename fix (RawBars keeps `each`).
      const eachRe = /\{%~?\s*each\b/g;
      let em2;
      while ((em2 = eachRe.exec(text)) !== null) {
        out.push({
          start: em2.index,
          end: em2.index + em2[0].length,
          message:
            "The loop keyword is `for` in MaxBars (ADR-039) — write `{% for x in xs %}` " +
            "(or bare `{% for xs %}`) … `{% endfor %}`; `each` is reserved. (RawBars keeps `{% each %}`.)",
        });
      }
    }
    // RawBars/MaxBars still want the rest of the dialect rules (they're not
    // Handlebars-compatible and have their own constraints — see below).
    // Continue into the shared MinBars/RawBars rules… but RawBars only.
    if (dialect === "maxbars") return out;
    // Fall through to RawBars validation rules below.
    const rest = dialectRulesFor(text, dialect);
    return out.concat(rest);
  }
  if (dialect !== "minbars" && dialect !== "rawbars") return [];
  return dialectRulesFor(text, dialect);
}

function dialectRulesFor(text, dialect) {
  if (dialect !== "minbars" && dialect !== "rawbars") return [];
  const out = [];
  // Walk the per-span active-delim context (same machinery `flatten` uses) so
  // `bodyOfTag` strips the correct opener/closer length for delim-switched
  // tags. Without this, `<% lookup x %>` would leave `% lookup x %>` in the
  // body and the helper-args rule would false-positive on the leading space.
  for (const { span: s, openDelim, closeDelim } of spansWithActiveDelims(tokenize(text, dialect), text)) {
    if (s.role !== "tag") continue;
    if (s.kind === "set-delimiter") continue; // skip the directive itself
    if (s.kind === "comment" || s.kind === "raw-block" || s.kind === "error") continue;
    const body = bodyOfTag(text, s, openDelim, closeDelim);
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

function bodyOfTag(text, s, openDelim = "{{", closeDelim = "}}") {
  // Strip the active opening / closing delimiter pair (passed in so we cope
  // with `<%` / `%>` after a `{{=<% %>=}}` directive switched them), then any
  // ~ control character and tag-shape sigil at the (now-inside-the-braces)
  // ends. What's left is the tag body — the part the dialect rules check.
  // Set-delimiter spans never reach here (caller skips `s.kind ===
  // "set-delimiter"` upstream), so no defensive `=` trim is needed.
  let from = s.from + openDelim.length;
  let to = s.to - closeDelim.length;
  if (from < to && text[from] === "~") from++;
  if (from < to && /[#/\^<$>&!]/.test(text[from])) from++;
  if (from < to && text[from] === "*") from++; // partial-block decorator after `>`
  if (to > from && text[to - 1] === "~") to--;
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

// Exported so the online highlighter's drift gate (scripts/check-paint-parity.mjs)
// can assert its ported operation pass stays byte-identical to this one.
export function flatten(text, dialect) {
  const kinds = new Array(text.length).fill(null);
  const spans = tokenize(text, dialect);
  // Precompute, for every tag span, the active delimiter pair AT the time the
  // engine emitted it — the pair that opened and closed it. Set-delimiter
  // directives are themselves emitted at the OLD pair (they use it to open),
  // then update the pair for everything that follows. Every body-walking
  // helper below threads through this resolution so it never assumes
  // `{{` / `}}` and silently misbehaves after a switch.
  const ctxBySpan = spansWithActiveDelims(spans, text);
  for (const { span: s, openDelim, closeDelim } of ctxBySpan) {
    if (s.role !== "tag") continue;
    // Comments are floored to the grammar (their `{{!`/`{#` braces are comment-family
    // punctuation, painted by the TextMate `comment_*` rules). Skip them here, or the
    // `{# … #}` inline comment trips the delimiter-switch heuristic below — its `{#`
    // opener is neither `{{` nor `{%`, so the braces would wrongly paint as set-delimiter.
    if (s.kind === "comment") continue;
    if (s.kind === "set-delimiter") {
      const [from, to] = shrinkToInner(text, s.from, s.to, openDelim, closeDelim);
      fillRange(kinds, from, to, s.kind);
      continue;
    }
    if (emitKinds.has(s.kind)) {
      const [from, to] = shrinkToInner(text, s.from, s.to, openDelim, closeDelim);
      fillRange(kinds, from, to, s.kind);
    } else if ((!startsWithOpen(text, s.from, openDelim) || openDelim !== "{{") && !startsWithOpen(text, s.from, "{%")) {
      // Delimiter-switched tag — the stateless grammar can't see it because it
      // hard-codes `{{` / `}}`. Paint ONLY the opener and closer (as the same
      // `set-delimiter` kind as the directive that introduced them — themes
      // paint them like the directive), so the body stays default-coloured and
      // the tag reads visually consistent with default-delim tags. A `{% … %}`
      // statement tag (docs-19) is EXCLUDED: the grammar's #statement_tag rule
      // paints its braces (punctuation) and head (keyword.control), so the LSP
      // defers to the floor exactly as it does for the `{{#x}}` block forms.
      fillRange(kinds, s.from, s.from + openDelim.length, "set-delimiter");
      fillRange(kinds, s.to - closeDelim.length, s.to, "set-delimiter");
    }
  }
  for (const s of spans) if (s.role === "interior" && emitKinds.has(s.kind)) fillRange(kinds, s.from, s.to, s.kind);
  if (emitKinds.has("operation")) paintOperations(kinds, text, ctxBySpan);
  return kinds;
}

// Project the engine's flat span stream onto a stream of (span, active opener,
// active closer) records. The opener / closer the engine USED for the span is
// the active pair AT EMISSION — a set-delimiter directive itself parses under
// the old pair and only afterwards switches to the new one. Every per-span
// helper that walks the tag body needs this to skip the right number of
// characters off each end.
function spansWithActiveDelims(spans, text) {
  let openDelim = "{{";
  let closeDelim = "}}";
  const out = [];
  for (const s of spans) {
    out.push({ span: s, openDelim, closeDelim });
    if (s.role === "tag" && s.kind === "set-delimiter") {
      const switched = parseSetDelimBody(text.slice(s.from, s.to));
      if (switched) {
        openDelim = switched.open;
        closeDelim = switched.close;
      }
    }
  }
  return out;
}

function startsWithOpen(text, at, openDelim) {
  for (let i = 0; i < openDelim.length; i++) if (text[at + i] !== openDelim[i]) return false;
  return true;
}

// Parse `{{=A B=}}` (or the equivalent under any active pair) — return the new
// `{ open, close }` pair, or `null` for malformed input (callers fall back to
// the previous active pair rather than corrupting subsequent paint).
//
// Validation mirrors the engine's lexer (`packages/core/src/FlatBars/Lexer.purs`,
// `tryReadSetDelim`): the immediate character after the active opener must be
// `=`, the immediate character before the active closer must be `=`, the inner
// body splits on whitespace into EXACTLY two non-empty words, and NEITHER word
// may contain `=` or whitespace. A laxer parser would accept things the engine
// rejects (e.g. `{{=A=B C=}}`) and then track those bogus delimiters for every
// subsequent tag — silently corrupting paint until the user notices.
export function parseSetDelimBody(tag) {
  // The first and last `=` mark the directive's inner-body boundaries — and per
  // the engine they MUST be flush against the active opener / closer. We don't
  // know the active opener's length here, but `tag` is exactly one tag span:
  // the `=` at position `openIdx` must be immediately followed by the body and
  // immediately preceded by the active opener (any other content there would
  // mean the engine wouldn't have emitted a set-delimiter span in the first
  // place — so we trust the engine's segmentation).
  const openIdx = tag.indexOf("=");
  const closeIdx = tag.lastIndexOf("=");
  if (openIdx < 0 || closeIdx <= openIdx) return null;
  const body = tag.slice(openIdx + 1, closeIdx);
  const parts = body.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [open, close] = parts;
  if (!open || !close) return null;
  // Per the Mustache spec (and the engine's `tryReadSetDelim`), delimiters may
  // not contain whitespace or `=`. The whitespace check is implicit (we split
  // on it); the `=` check we do here. Reject malformed input so the active
  // pair doesn't drift to nonsense.
  if (open.includes("=") || close.includes("=")) return null;
  return { open, close };
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

function paintOperations(kinds, text, ctxBySpan) {
  for (const { span: s, openDelim, closeDelim } of ctxBySpan) {
    if (s.role !== "tag") continue;
    const pos = operationPositionByKind.get(s.kind);
    if (!pos || pos === "none") continue;
    if (pos === "head") paintHeadOperation(kinds, text, s, openDelim, closeDelim, false);
    else if (pos === "always-head") paintHeadOperation(kinds, text, s, openDelim, closeDelim, true);
    // `any` (block tags): the head is the grammar's keyword.control.section;
    // we only scan subexpression heads + pipe targets inside the body.
    const bodyStart = s.from + openDelim.length;
    const bodyEnd = s.to - closeDelim.length;
    paintSubexpressionHeads(kinds, text, bodyStart, bodyEnd);
    paintPipeTargets(kinds, text, bodyStart, bodyEnd);
  }
}

// MaxBars `value | helper` — the identifier after every `|` (that isn't part of
// `||`) is in operation position. Block params (`{{#each xs as |x|}}`) feed
// non-helper identifiers; the catalog check skips them. Bounds are the tag
// BODY range (delimiters already excluded by the caller).
function paintPipeTargets(kinds, text, bodyStart, bodyEnd) {
  for (let i = bodyStart; i < bodyEnd; i++) {
    if (text[i] !== "|" || text[i - 1] === "|" || text[i + 1] === "|") continue;
    let j = i + 1;
    while (j < bodyEnd && /\s/.test(text[j])) j++;
    paintIdentAt(kinds, text, j, bodyEnd, false);
  }
}

function paintHeadOperation(kinds, text, s, openDelim, closeDelim, alwaysPaint) {
  // Start inside the opener; bound at the start of the closer.
  let i = s.from + openDelim.length;
  const end = s.to - closeDelim.length;
  // Skip whitespace-control `~`, raw sigil `&`, whitespace.
  while (i < end && /[~&\s]/.test(text[i])) i++;
  // Partial sigil `>` (with optional `*` decorator) then whitespace.
  if (text[i] === ">") {
    i++;
    if (text[i] === "*") i++;
    while (i < end && /\s/.test(text[i])) i++;
  }
  paintIdentAt(kinds, text, i, end, alwaysPaint);
}

function paintSubexpressionHeads(kinds, text, bodyStart, bodyEnd) {
  for (let i = bodyStart; i < bodyEnd - 1; i++) {
    if (text[i] !== "(" || kinds[i] !== null) continue;
    let j = i + 1;
    while (j < bodyEnd && /\s/.test(text[j])) j++;
    paintIdentAt(kinds, text, j, bodyEnd, false);
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

// Trim the active opener / closer / whitespace-control sigils / surrounding
// whitespace off a tag span so the LSP-emitted semantic token covers only the
// INNER body — `{{~ else ~}}` → `else`, `<% else %>` (after a switch) → `else`.
// The grammar (or `flatten`'s set-delimiter painter) already paints the
// delimiter braces; without this trim, the tag-level semantic token (keyword,
// set-delimiter, error) would override the braces too. The opener / closer
// chars are stripped by length so we cope with `<%` / `%>` after a
// `{{=<% %>=}}` directive switched the active pair.
function shrinkToInner(text, from, to, openDelim, closeDelim) {
  let s = from + openDelim.length;
  let e = to - closeDelim.length;
  while (s < e && /[~\s]/.test(text[s])) s++;
  while (e > s && /[~\s]/.test(text[e - 1])) e--;
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
  const ctxBySpan = spansWithActiveDelims(spans, text);
  const stack = [];
  const ranges = [];
  // raw-block tokens come as a single span; its `from`/`to` cover the WHOLE block
  // (open through close). Emit it directly. Other block tags pair up by name,
  // resolved per-span with the active delimiter pair (so blocks opened under
  // `<% %>` after a switch still pair correctly).
  for (const { span: s, openDelim, closeDelim } of ctxBySpan) {
    if (s.role !== "tag") continue;
    if (s.kind === "raw-block") {
      ranges.push({ start: lineOf(text, s.from), end: lineOf(text, s.to - 1) });
      continue;
    }
    if (BLOCK_OPEN_KINDS.has(s.kind)) {
      stack.push({ word: bodyWord(text, s, openDelim, closeDelim), line: lineOf(text, s.from) });
    } else if (s.kind === BLOCK_CLOSE_KIND) {
      const word = bodyWord(text, s, openDelim, closeDelim);
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

function bodyWord(text, s, openDelim, closeDelim) {
  // Start inside the opener; end before the closer; then skip sigils and
  // whitespace and capture the next identifier. The opener / closer chars are
  // stripped by length so a delim-switched `<%#each xs%>` resolves `each`
  // identically to a default-delim `{{#each xs}}`.
  let i = s.from + openDelim.length;
  const end = s.to - closeDelim.length;
  while (i < end && /[~#/\^<$>&!\s]/.test(text[i])) i++;
  const m = IDENT_RE.exec(text.slice(i, end));
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
  const ctxBySpan = spansWithActiveDelims(spans, text);
  const root = { children: [] };
  const stack = [root];
  for (const { span: s, openDelim, closeDelim } of ctxBySpan) {
    if (s.role !== "tag") continue;
    if (s.kind === "raw-block") {
      stack[stack.length - 1].children.push(makeSymbol(text, s, openDelim, closeDelim, s.to, "raw-block"));
      continue;
    }
    if (BLOCK_OPEN_KINDS.has(s.kind)) {
      const sym = makeSymbol(text, s, openDelim, closeDelim, null, s.kind);
      stack[stack.length - 1].children.push(sym);
      stack.push(sym);
    } else if (s.kind === BLOCK_CLOSE_KIND) {
      const word = bodyWord(text, s, openDelim, closeDelim);
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

function makeSymbol(text, openSpan, openDelim, closeDelim, endOffset, kind) {
  return {
    word: bodyWord(text, openSpan, openDelim, closeDelim) || "(anonymous)",
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
  // Set-delim consistency: the open's `=` sigil and the close's `=` must agree.
  // Mismatch (e.g. `{{==}}` matched as open=`{{=` + close=`}}` with no closing
  // `=`) is malformed input the engine would reject — leave it untouched so the
  // formatter is idempotent on unparseable text and "Format Document" can't
  // change byte length of something already rejected by the parser.
  if ((sigil === "=") !== (closeEq === "=")) return tag;
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
// RawBars/MaxBars only (ClassicBars/MinBars keep Handlebars' @index/@partial-block).
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
