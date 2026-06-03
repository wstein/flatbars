// SPDX-License-Identifier: Apache-2.0
//
// Wiring the hand-written lexer spike (FlatBars.Lab.LexerHand) to LSP semantic
// tokens — the proof that the CST-style token model feeds an editor directly.
//
// This is the same contract the shipping server (editors/lsp/src/tokens.mjs)
// honours: the legend is derived from the shared editors/token-vocabulary.json
// (ADR-017), and the output is the `textDocument/semanticTokens/full` wire shape
// — a flat array of delta-encoded [deltaLine, deltaStartChar, length, tokenType,
// tokenModifiers] 5-tuples. But where the production path must flatten the
// engine's offset spans back into per-line tokens, the hand lexer already gives
// every token a line/column `Span`, so the conversion is a direct map.
//
// Like the production server, it emits SPARSE corrections (`lspEmitKinds`:
// operator/string/number/set-delimiter) over the TextMate floor — the kinds a
// stateless grammar can't get right — and leaves the structural braces alone.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = (m) => resolve(here, "../../output", m, "index.js");

// The FORGIVING lexer: an LSP must keep highlighting around a half-typed tag,
// so we drive recovery (never throws; malformed openers become `Invalid`).
const { tokenizeRecovering } = await import(out("FlatBars.Lab.LexerHand"));
const { defaultLexConfig, semanticTokenType, lspEmits } = await import(out("FlatBars.Lab.Lexer"));
const { default: vocabulary } = await import(resolve(here, "../../editors/token-vocabulary.json"), {
  with: { type: "json" },
});

// Legend = the vocabulary's lsp types/modifiers in declaration order (identical
// to editors/lsp/src/tokens.mjs:buildLegend, so the indices line up).
export function buildLegend(vocab = vocabulary) {
  const tokenTypes = [];
  const tokenModifiers = [];
  for (const def of Object.values(vocab.kinds)) {
    if (!tokenTypes.includes(def.lsp.type)) tokenTypes.push(def.lsp.type);
    for (const m of def.lsp.modifiers ?? []) if (!tokenModifiers.includes(m)) tokenModifiers.push(m);
  }
  return { tokenTypes, tokenModifiers };
}

// PureScript `Maybe String` → JS string | null (a `Just` carries `.value0`).
const fromMaybe = (m) => (m && "value0" in m ? m.value0 : null);

const arithConfig = { ...defaultLexConfig, infixArith: true };

// Run the hand lexer and return every non-trivia token as a flat JS record —
// the basis for both the wire encoding and the human-readable table below.
export function lex(text, cfg = arithConfig) {
  const toks = tokenizeRecovering(cfg)(text); // forgiving: always an array
  return toks.map((t) => {
    const kind = t.lexeme.constructor.name; // Open / Sigil / Ident / Op / Invalid / …
    return {
      kind,
      type: fromMaybe(semanticTokenType(t.lexeme)), // ADR-017 semantic-token type
      emit: lspEmits(t.lexeme), // in the sparse correction set?
      message: kind === "Invalid" ? t.lexeme.value0 : null, // recovery diagnostic
      start: t.span.start, // { index, line, column } (1-based line/col)
      end: t.span.end,
      text: text.slice(t.span.start.index, t.span.end.index),
    };
  });
}

// publishDiagnostics from the SAME recovering pass: every Invalid token becomes
// an LSP Diagnostic (0-based range, Error severity). So one lex feeds both the
// semantic-token and the diagnostic channels.
export function diagnostics(text, { cfg = arithConfig } = {}) {
  const diags = [];
  for (const t of lex(text, cfg)) {
    if (t.kind !== "Invalid") continue;
    diags.push({
      range: {
        start: { line: t.start.line - 1, character: t.start.column - 1 },
        end: { line: t.end.line - 1, character: t.end.column - 1 },
      },
      severity: 1, // DiagnosticSeverity.Error
      source: "flatbars-lexer-lab",
      message: t.message,
    });
  }
  return diags;
}

// The LSP `semanticTokens/full` response: { legend, data }. Sparse by default,
// matching the production server. A token that crosses a line is skipped (the
// LSP forbids it; none of the sparse kinds do in practice).
export function semanticTokens(text, { sparse = true, cfg = arithConfig } = {}) {
  const legend = buildLegend();
  const invalidBit = 1 << legend.tokenModifiers.indexOf("invalid");
  const data = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of lex(text, cfg)) {
    if (!(sparse ? t.emit : t.type)) continue;
    if (t.start.line !== t.end.line) continue;
    const line = t.start.line - 1; // LSP positions are 0-based
    const char = t.start.column - 1;
    const length = t.end.index - t.start.index;
    const bits = t.kind === "Invalid" ? invalidBit : 0; // ADR-017 `error` modifier
    const deltaLine = line - prevLine;
    data.push(deltaLine, deltaLine === 0 ? char - prevChar : char, length, legend.tokenTypes.indexOf(t.type), bits);
    prevLine = line;
    prevChar = char;
  }
  return { legend, data };
}

// Decode the flat wire data back into absolute, human-readable tokens — for the
// demo, and so a test can assert against something legible.
export function decode(text, opts = {}) {
  const { legend, data } = semanticTokens(text, opts);
  const tokens = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [dl, dc, len, typeIdx, bits] = [data[i], data[i + 1], data[i + 2], data[i + 3], data[i + 4]];
    line += dl;
    char = dl === 0 ? char + dc : dc;
    const mods = legend.tokenModifiers.filter((_, b) => bits & (1 << b));
    tokens.push({ line, char, length: len, type: legend.tokenTypes[typeIdx], modifiers: mods });
  }
  return tokens;
}
