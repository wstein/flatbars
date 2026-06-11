// SPDX-License-Identifier: Apache-2.0
//
// The Lab's lightweight CodeMirror StreamLanguage tokenizers — JSONata (the
// transform editor), JS (the custom-helpers editor), and the bytecode disassembly
// view. Extracted from index.html (Phase 0, the first `editors` sub-slice): these
// are PURE — no app state, no DOM — so they unit-test directly (the token
// functions are exported raw for that; the factory wraps them in
// StreamLanguage.define).
//
// `StreamLanguage` is injected (not imported here) so this module reuses the
// page's single @codemirror/language instance — re-importing it from the CDN
// would risk a duplicate-instance bug.
//
// Token-style names map through the editors' shared `themeHighlight` (still in
// index.html), so the strings returned here ("keyword"/"string"/…) are the same
// ones CodeMirror's default tag system understands.

// JSONata: $functions and variables, strings, numbers, block comments, operators.
export function jsonataToken(stream) {
  if (stream.match(/\/\*/)) {
    while (!stream.match(/\*\//) && !stream.eol()) stream.next();
    return "comment";
  }
  if (stream.match(/"(?:[^"\\]|\\.)*"/) || stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";
  if (stream.match(/\$[a-zA-Z_]\w*/) || stream.match(/\$/)) return "keyword";
  if (stream.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
  if (stream.match(/(?:true|false|null)\b/)) return "atom";
  if (stream.match(/[a-zA-Z_]\w*/)) return "variableName";
  if (stream.match(/[+\-*/%=<>!&|~?:^@.]+/)) return "operator";
  stream.next();
  return null;
}

// JS (custom helpers): keywords, strings/templates, numbers, line+block comments,
// operators. Enough for a short helper script without a full JS grammar.
export const JS_KEYWORDS =
  /^(?:const|let|var|function|return|if|else|for|of|in|while|switch|case|break|continue|new|typeof|instanceof|this|class|extends|try|catch|finally|throw|await|async|yield|delete|void|do|null|undefined|true|false)\b/;

export function jsToken(stream) {
  if (stream.match(/\/\//)) { stream.skipToEnd(); return "comment"; }
  if (stream.match(/\/\*/)) {
    while (!stream.match(/\*\//) && !stream.eol()) stream.next();
    return "comment";
  }
  if (stream.match(/"(?:[^"\\]|\\.)*"/) || stream.match(/'(?:[^'\\]|\\.)*'/) || stream.match(/`(?:[^`\\]|\\.)*`/)) return "string";
  if (stream.match(/(?:true|false|null|undefined)\b/)) return "atom";
  if (stream.match(JS_KEYWORDS)) return "keyword";
  if (stream.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
  if (stream.match(/[a-zA-Z_$][\w$]*/)) return "variableName";
  if (stream.match(/[+\-*/%=<>!&|~?:^.]+/)) return "operator";
  stream.next();
  return null;
}

// Bytecode disassembly: uppercase opcodes/operands as keywords, quoted literals as
// strings, plus numbers and nil/bool atoms. `;` line comments at start-of-line.
export const BC_KEYWORDS =
  /^(?:EMIT_TEXT|EMIT|IF|THEN|ELSE|EACH|WITH|DO|SCOPE|GET|ASSIGNS|ASSIGN|LOCAL|THIS|PARENT|ROOT|INDEX0|INDEX1|KEY|FIRST|LAST|LIT|CALL|ESCAPE|AS)\b/;

export function bytecodeToken(stream) {
  if (stream.sol() && stream.match(/;.*/)) return "comment";
  if (stream.eatSpace()) return null;
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
  if (stream.match(BC_KEYWORDS)) return "keyword";
  if (stream.match(/-?\d+(\.\d+)?/)) return "number";
  if (stream.match(/(?:true|false|nil|null)\b/)) return "atom";
  if (stream.match(/[A-Za-z_]\w*/)) return "variableName";
  stream.next();
  return null;
}

// Build the three StreamLanguage instances against the page's `StreamLanguage`.
export function createCmLanguages(StreamLanguage) {
  return {
    jsonataLang: StreamLanguage.define({ token: jsonataToken }),
    jsLang: StreamLanguage.define({ token: jsToken }),
    bytecodeLang: StreamLanguage.define({ token: bytecodeToken }),
  };
}
