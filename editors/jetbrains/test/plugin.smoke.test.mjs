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
import * as rpcNs from "vscode-jsonrpc/node";

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
  assert.ok(init.capabilities.codeActionProvider, "bundled server advertises code actions");
  await conn.sendNotification("initialized", {});
  // Semantic tokens are sparse corrections: a plain interpolation emits nothing
  // (the grammar paints it), but a MaxBars operator does. Decode the delta stream
  // and assert SEMANTICALLY so an additive painter doesn't break this gate.
  const uri = "file:///t/page.maxbars";
  const text = "{{ a ?? b }}";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "maxbars", version: 1, text },
  });
  const r = await conn.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri } });
  const legend = init.capabilities.semanticTokensProvider.legend;
  assert.equal(r.data.length % 5, 0, "delta stream is 5-tuples");
  const decoded = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < r.data.length; i += 5) {
    const [dL, dC, len, type] = r.data.slice(i, i + 5);
    line += dL;
    char = dL === 0 ? char + dC : dC;
    decoded.push({ type: legend.tokenTypes[type], slice: text.slice(char, char + len) });
  }
  assert.ok(
    decoded.some((t) => t.type === "operator" && t.slice === "??"),
    "bundled server tokenises `??` as a MaxBars operator",
  );
  // The canonicalization quick-fix ships in the same bundle, so the JetBrains
  // plugin offers it too: the platform LSP client consumes textDocument/codeAction
  // by default (IDEA 2023.3+), this proves the bundled server delivers it. A
  // RawBars doc with the non-canonical `index` offers a one-click rewrite to `index0`.
  // Positions computed from the source so cosmetic edits don't break the test.
  const caUri = "file:///t/page.rawbars";
  const caText = "{{{index}}}";
  const caTarget = caText.indexOf("index");
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: caUri, languageId: "rawbars", version: 1, text: caText },
  });
  const actions = await conn.sendRequest("textDocument/codeAction", {
    textDocument: { uri: caUri },
    range: { start: { line: 0, character: caTarget + 1 }, end: { line: 0, character: caTarget + 1 } },
    context: { diagnostics: [] },
  });
  assert.equal(actions.length, 1, "bundled server offers the `index` → `index0` quick-fix");
  assert.match(actions[0].title, /index.*index0/, "titled the rewrite");
  assert.equal(actions[0].edit.changes[caUri][0].newText, "index0", "edit replaces with the canonical name");
  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
} finally {
  conn.dispose();
  child.kill();
}

console.log("✓ flatbars jetbrains smoke test passed (bundled server speaks LSP; assets canonical; descriptors valid)");
