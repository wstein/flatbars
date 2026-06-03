// SPDX-License-Identifier: Apache-2.0
//
// The FlatBars VS Code extension entry point. Two layers, per ADR-017:
//
//   * The TextMate grammar (contributed in package.json) paints the default-
//     delimiter forms immediately — first paint, and the only colour in no-LSP
//     contexts. It is the floor.
//   * This client spawns flatbars-lsp (the bundled, self-contained server) and
//     wires its semantic tokens, which OVERRIDE the grammar and correct the
//     stateful regions (set delimiters, dialects, MaxBars operators). It is the
//     ceiling. The engine always wins where it runs.
const path = require("path");
const { workspace } = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

function activate(context) {
  // The server is bundled to a single self-contained file (no node_modules).
  const serverModule = context.asAbsolutePath(path.join("dist", "server", "flatbars-lsp.cjs"));
  const defaultDialect = workspace.getConfiguration("flatbars").get("defaultDialect", "fullbars");

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  const clientOptions = {
    documentSelector: [{ language: "flatbars" }],
    initializationOptions: { defaultDialect },
  };

  client = new LanguageClient("flatbars-lsp", "FlatBars Language Server", serverOptions, clientOptions);
  client.start();
}

function deactivate() {
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
