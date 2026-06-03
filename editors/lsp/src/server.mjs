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
  DiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildLegend, encodeSemanticTokens, parseDiagnostics, resolveDialect } from "./tokens.mjs";

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
