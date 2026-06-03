// SPDX-License-Identifier: Apache-2.0
//
// The `flatbars-lsp` server wiring (ADR-017): a thin shell over tokens.mjs. It
// advertises a semantic-tokens provider whose legend is derived from the shared
// token vocabulary, and answers `textDocument/semanticTokens/full` by running the
// engine lexer over the document — stateful by construction, so set delimiters,
// dialects, raw blocks and separators are all correct because there is no second
// grammar to be wrong. Highlighting is the first feature on this substrate;
// diagnostics/hover/completion are deferred (they need the recovering parser noted
// in ADR-017's open questions).
import {
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildLegend, dialectForUri, encodeSemanticTokens } from "./tokens.mjs";

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
    const dialect = dialectForUri(doc.uri, defaultDialect);
    return encodeSemanticTokens(doc.getText(), dialect);
  });

  documents.listen(connection);
  connection.listen();
  return { documents, legend };
}
