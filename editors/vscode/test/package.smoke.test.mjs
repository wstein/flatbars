// SPDX-License-Identifier: Apache-2.0
//
// Headless smoke test for the VS Code extension (ADR-017). There is no editor
// runtime or Marketplace here, so this verifies the two things that CAN be checked
// offline:
//
//   1. the BUNDLED server actually works — esbuild's self-contained
//      dist/server/flatbars-lsp.mjs is driven over real LSP
//      (initialize -> didOpen -> semanticTokens/full), proving the engine,
//      vocabulary, and vscode-languageserver bundled correctly;
//   2. the extension PACKAGES — `vsce package` builds a .vsix, proving the
//      manifest and the contributed grammar are valid.
//
// NOT covered (documented limits): live VS Code rendering and Marketplace publish.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as rpcNs from "vscode-jsonrpc/node.js";

const rpc = rpcNs.default ?? rpcNs;
const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "..");
const root = resolve(ext, "..", "..");

// ── Build the shippable assets (grammar + bundled server + extension) ────────
execFileSync(process.execPath, [resolve(ext, "scripts", "sync-assets.mjs")], { stdio: "pipe" });
const serverBundle = resolve(ext, "dist", "server", "flatbars-lsp.cjs");
assert.ok(existsSync(serverBundle), "sync-assets produced the bundled server");
assert.ok(existsSync(resolve(ext, "dist", "flatbars.tmLanguage.json")), "grammar copied into dist");
assert.ok(existsSync(resolve(ext, "dist", "extension.js")), "extension bundled into dist");

// ── 1. The bundled server speaks LSP and emits the right tokens ──────────────
const child = spawn(process.execPath, [serverBundle], { stdio: ["pipe", "pipe", "inherit"] });
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
  const legend = init.capabilities.semanticTokensProvider.legend;
  await conn.sendNotification("initialized", {});

  // languageId 'maxbars' on a `.flatbars` URI with a fullbars default: the dialect
  // must come from the languageId, so `??` is an operator and "b" a string.
  const uri = "file:///t/page.flatbars";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "maxbars", version: 1, text: '{{ a ?? "b" }}' },
  });
  const res = await conn.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri } });

  // Sparse semantic tokens: only the `??` operator and "b" string (the expr tag is
  // the grammar's) — 2 correction tokens.
  assert.equal(res.data.length, 2 * 5, "bundled server emits the 2 MaxBars correction tokens");
  const op = legend.tokenTypes.indexOf("operator");
  const str = legend.tokenTypes.indexOf("string");
  assert.ok(res.data.includes(op) && res.data.includes(str), "operator and string tokens present");

  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
} finally {
  conn.dispose();
  child.kill();
}

// ── 2. The extension packages into a .vsix ───────────────────────────────────
const vsceBin = resolve(root, "node_modules", "@vscode", "vsce", "vsce");
const vsix = resolve(ext, "flatbars-smoke.vsix");
rmSync(vsix, { force: true });
try {
  execFileSync(process.execPath, [vsceBin, "package", "--no-dependencies", "--out", vsix], {
    cwd: ext,
    stdio: "pipe",
  });
  assert.ok(existsSync(vsix), "vsce produced a .vsix");
  assert.ok(statSync(vsix).size > 1024, ".vsix is non-trivial");
} finally {
  rmSync(vsix, { force: true });
}

console.log("✓ flatbars vscode smoke test passed (bundled server speaks LSP; .vsix packages)");
