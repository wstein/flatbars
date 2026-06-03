// SPDX-License-Identifier: Apache-2.0
//
// Protocol-level smoke test for `flatbars-lsp`: spawn the real stdio server and
// drive it over JSON-RPC — initialize -> didOpen -> semanticTokens/full — then
// assert the decoded tokens. This is the honest "the server actually speaks LSP"
// check; the pure encoding is covered in tokens.test.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as rpcNs from "vscode-jsonrpc/node.js";

const rpc = rpcNs.default ?? rpcNs;
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "..", "bin", "flatbars-lsp.mjs");

const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "inherit"] });
const conn = rpc.createMessageConnection(
  new rpc.StreamMessageReader(child.stdout),
  new rpc.StreamMessageWriter(child.stdin),
);
conn.listen();

try {
  const init = await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: { defaultDialect: "fullbars" },
  });

  const provider = init.capabilities.semanticTokensProvider;
  assert.ok(provider, "server advertises a semantic-tokens provider");
  assert.equal(provider.full, true, "supports semanticTokens/full");
  assert.ok(
    provider.legend.tokenTypes.includes("variable") && provider.legend.tokenTypes.includes("operator"),
    "legend carries the vocabulary's token types",
  );

  await conn.sendNotification("initialized", {});

  const uri = "file:///test/page.hbs";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "handlebars", version: 1, text: "Hello, {{name}}!" },
  });

  const result = await conn.sendRequest("textDocument/semanticTokens/full", {
    textDocument: { uri },
  });

  // {{name}} is one `expr` (variable) token at line 0, char 7, length 8.
  const variable = provider.legend.tokenTypes.indexOf("variable");
  assert.deepEqual([...result.data], [0, 7, 8, variable, 0], "one expr token over {{name}}");

  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
  console.log("✓ flatbars-lsp protocol smoke test passed (initialize -> didOpen -> semanticTokens/full)");
} finally {
  conn.dispose();
  child.kill();
}
