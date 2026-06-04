// SPDX-License-Identifier: Apache-2.0
//
// Offline smoke test for the JetBrains plugin (ADR-017). The full `gradle
// buildPlugin` needs the IntelliJ SDK + a JDK 17 toolchain, which is out of scope
// for the repo's offline `npm test`; that build is documented in README.md and run
// in CI. Here we verify, with no JVM, the parts that CAN drift:
//
//   1. the bundled server WORKS — drive the synced resources/server/flatbars-lsp.cjs
//      over real LSP (the same self-contained server the plugin ships);
//   2. the assets are present and canonical — the TextMate grammar equals
//      editors/flatbars.tmLanguage.json, the VS Code-style bundle manifest is valid;
//   3. the descriptors register the right extension points — the TextMate
//      bundleProvider (base, all IDEs) and the Ultimate-gated LSP serverSupportProvider.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as rpcNs from "vscode-jsonrpc/node.js";

const rpc = rpcNs.default ?? rpcNs;
const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, "..");
const root = resolve(plugin, "..", "..");
const res = resolve(plugin, "src", "main", "resources");

// ── Build the shippable assets into resources ────────────────────────────────
execFileSync(process.execPath, [resolve(plugin, "scripts", "sync-assets.mjs")], { stdio: "pipe" });
const serverBundle = resolve(res, "server", "flatbars-lsp.cjs");
assert.ok(existsSync(serverBundle), "sync-assets produced the bundled server");

// ── 2. Assets are present and canonical ──────────────────────────────────────
const grammar = readFileSync(resolve(res, "textmate-bundle", "flatbars.tmLanguage.json"), "utf8");
const canonical = readFileSync(resolve(root, "editors", "flatbars.tmLanguage.json"), "utf8");
assert.equal(grammar, canonical, "bundled grammar is the canonical editors/flatbars.tmLanguage.json verbatim");
const bundleManifest = JSON.parse(readFileSync(resolve(res, "textmate-bundle", "package.json"), "utf8"));
assert.equal(bundleManifest.contributes.grammars[0].scopeName, "source.flatbars", "bundle manifest declares the grammar");

// ── 3. Descriptors register the right extension points ───────────────────────
const pluginXml = readFileSync(resolve(res, "META-INF", "plugin.xml"), "utf8");
assert.match(pluginXml, /defaultExtensionNs="com\.intellij\.textmate"/, "uses the TextMate EP namespace");
assert.match(pluginXml, /<bundleProvider implementation="com\.flatbars\.idea\.FlatBarsTextMateBundleProvider"/, "registers the bundle provider");
assert.match(pluginXml, /<depends>org\.jetbrains\.plugins\.textmate<\/depends>/, "depends on the TextMate plugin");

const lspXml = readFileSync(resolve(plugin, "src", "lsp", "resources", "META-INF", "flatbars-lsp.xml"), "utf8");
assert.match(lspXml, /platform\.lsp\.serverSupportProvider implementation="com\.flatbars\.idea\.FlatBarsLspServerSupportProvider"/, "the LSP fragment registers the server support provider");
assert.match(lspXml, /<applicationConfigurable[^]*?instance="com\.flatbars\.idea\.FlatBarsConfigurable"/, "the LSP fragment registers the default-dialect settings page");

// ── 1. The bundled server speaks LSP ─────────────────────────────────────────
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
  assert.ok(init.capabilities.semanticTokensProvider, "bundled server advertises semantic tokens");
  await conn.sendNotification("initialized", {});
  // Semantic tokens are sparse corrections: a plain interpolation emits nothing
  // (the grammar paints it), but a MaxBars operator does.
  const uri = "file:///t/page.maxbars";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "maxbars", version: 1, text: "{{ a ?? b }}" },
  });
  const r = await conn.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri } });
  const operator = init.capabilities.semanticTokensProvider.legend.tokenTypes.indexOf("operator");
  assert.deepEqual([...r.data], [0, 5, 2, operator, 0], "one operator token over `??`");
  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
} finally {
  conn.dispose();
  child.kill();
}

console.log("✓ flatbars jetbrains smoke test passed (bundled server speaks LSP; assets canonical; descriptors valid)");
