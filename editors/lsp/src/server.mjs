// SPDX-License-Identifier: Apache-2.0
//
// The `flatbars-lsp` server wiring (ADR-017): a thin shell over tokens.mjs. It
// advertises a semantic-tokens provider whose legend is derived from the shared
// token vocabulary, and answers `textDocument/semanticTokens/full` by running the
// engine lexer over the document — stateful by construction, so set delimiters,
// dialects, raw blocks and separators are all correct because there is no second
// grammar to be wrong. Highlighting was the first feature on this substrate;
// diagnostics (ADR-023) are the second — published from the recovering parser, so
// the editor flags exactly what the dialect would reject. Hover/completion follow.
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildLegend,
  canonAt,
  completionsAt,
  encodeSemanticTokens,
  hoverAt,
  parseDiagnostics,
  resolveDialect,
} from "./tokens.mjs";

// Wire a server onto an already-created LSP `connection`. Kept separate from the
// stdio entry point so a test can drive it over any transport.
export function startServer(connection) {
  const documents = new TextDocuments(TextDocument);
  const legend = buildLegend();
  let defaultDialect = "fullbars";

  connection.onInitialize((params) => {
    const opt = params.initializationOptions;
    if (opt && typeof opt.defaultDialect === "string") defaultDialect = opt.defaultDialect;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        semanticTokensProvider: {
          legend,
          full: true,
          range: false,
        },
        hoverProvider: true,
        // Trigger after a block/partial sigil, a subexpression open, or a space
        // (the next head/argument); the editor also invokes on demand.
        completionProvider: { triggerCharacters: ["#", ">", "(", " "] },
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      },
      serverInfo: { name: "flatbars-lsp" },
    };
  });

  connection.languages.semanticTokens.on((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return { data: [] };
    const dialect = resolveDialect(doc.languageId, doc.uri, defaultDialect);
    return encodeSemanticTokens(doc.getText(), dialect);
  });

  // Hover: a prelude operation under the cursor → its ADR-019 kind, arity, and a
  // synthesised signature (read from editors/operations.json, projected from the
  // prelude schema). Returns null off an operation, so the editor shows nothing.
  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const dialect = resolveDialect(doc.languageId, doc.uri, defaultDialect);
    const h = hoverAt(doc.getText(), dialect, doc.offsetAt(params.position));
    if (!h) return null;
    return {
      contents: { kind: MarkupKind.Markdown, value: h.markdown },
      range: { start: doc.positionAt(h.start), end: doc.positionAt(h.end) },
    };
  });

  // Completion: inside a tag, offer the prelude operations (deprecated aliases
  // excluded; scoped variables sorted after helpers). Empty outside a tag.
  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const dialect = resolveDialect(doc.languageId, doc.uri, defaultDialect);
    return completionsAt(doc.getText(), dialect, doc.offsetAt(params.position)).map((c) => ({
      label: c.label,
      detail: c.detail,
      kind: c.kind === "variable" ? CompletionItemKind.Variable : CompletionItemKind.Function,
      sortText: c.sortText,
    }));
  });

  // Code action: a one-click "rewrite X → Y" quick-fix when the cursor is on a
  // canonicalizable name (a deprecated alias, or — in RawBars/MaxBars — a
  // non-canonical scoped variable). The replacement comes from the same
  // editors/operations.json the hover reads (projected from the prelude).
  connection.onCodeAction((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const dialect = resolveDialect(doc.languageId, doc.uri, defaultDialect);
    const c = canonAt(doc.getText(), dialect, doc.offsetAt(params.range.start));
    if (!c) return [];
    const range = { start: doc.positionAt(c.from), end: doc.positionAt(c.to) };
    return [
      {
        title: `Rewrite \`${c.name}\` → \`${c.canonical}\``,
        kind: CodeActionKind.QuickFix,
        edit: { changes: { [doc.uri]: [{ range, newText: c.canonical }] } },
      },
    ];
  });

  // Publish parse diagnostics (ADR-023) on open and every edit. The recovering
  // parser reports every error at once; offsets map to LSP ranges via positionAt.
  const publishDiagnostics = (doc) => {
    const dialect = resolveDialect(doc.languageId, doc.uri, defaultDialect);
    const items = parseDiagnostics(doc.getText(), dialect).map((d) => ({
      range: { start: doc.positionAt(d.start), end: doc.positionAt(d.end) },
      severity: DiagnosticSeverity.Error,
      source: "flatbars",
      message: d.message,
    }));
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: items });
  };
  documents.onDidChangeContent((e) => publishDiagnostics(e.document));

  documents.listen(connection);
  connection.listen();
  return { documents, legend };
}
