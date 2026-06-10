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
import { existsSync, statSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as rpcNs from "vscode-jsonrpc/node";
import { LANGUAGE_IDS } from "../../shared/sync.mjs";

const rpc = rpcNs.default ?? rpcNs;
const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "..");
const root = resolve(ext, "..", "..");

// ── 0. The manifest's auto-activation precondition holds ─────────────────────
// The extension carries no explicit activationEvents: since VS Code 1.74 the
// onLanguage events are generated from contributes.languages, so the extension
// (and the LSP client it starts) auto-activates on opening a FlatBars file. That
// guarantee rests on two manifest facts, asserted here; the end-to-end proof that
// activation actually surfaces tokens + diagnostics is the real-IDE test
// (test/ide, run in CI). The dialect set is single-sourced from editors/shared.
const manifest = JSON.parse(readFileSync(resolve(ext, "package.json"), "utf8"));
const langIds = manifest.contributes.languages.map((l) => l.id).sort();
assert.deepEqual(langIds, [...LANGUAGE_IDS].sort(), "contributes.languages matches the canonical dialect set");
const [, major, minor] = manifest.engines.vscode.match(/(\d+)\.(\d+)/);
assert.ok(Number(major) > 1 || (Number(major) === 1 && Number(minor) >= 74), "engines.vscode >= 1.74 (onLanguage auto-generation)");
// Activation events are spelled out — one `onLanguage:<dialect>` per contributed
// language. Auto-generation since 1.74 would cover the common case, but the
// explicit list keeps older clients and CI environments deterministic. Each event
// must reference a contributed language id, otherwise the LSP never starts.
const expectedActivations = manifest.contributes.languages.map((l) => `onLanguage:${l.id}`).sort();
assert.deepEqual([...manifest.activationEvents].sort(), expectedActivations, "activationEvents = one onLanguage per contributed dialect");

// ── Bold "isle" emphasis: configurationDefaults bold the whole tag ───────────
// VS Code bolds every brace cluster + interior via overridable configurationDefaults,
// codegenned from the vocabulary. Assert both layers match token-vocabulary.json so the
// generated manifest can't silently drift from the contract (the positive companion to
// check:editors-manifests' whole-file diff; mirrors the JetBrains parity assertion).
const vocab = JSON.parse(readFileSync(resolve(root, "editors", "token-vocabulary.json"), "utf8"));
const cfgDefaults = manifest.contributes.configurationDefaults;
const expectTmScopes = [...new Set(Object.values(vocab.kinds).flatMap((k) => k.tmScopes ?? []))].sort();
const boldTmScopes = cfgDefaults["editor.tokenColorCustomizations"].textMateRules
  .filter((r) => r.settings.fontStyle === "bold")
  .map((r) => r.scope)
  .sort();
assert.deepEqual(boldTmScopes, expectTmScopes, "textMateRules bold exactly the vocabulary's tmScopes");
const expectSemTypes = [...new Set([
  ...Object.values(vocab.kinds).map((k) => k.lsp?.type).filter(Boolean),
  ...(vocab.customSemanticTypes ?? []).map((t) => t.id),
])].sort();
for (const id of LANGUAGE_IDS) {
  const rules = cfgDefaults["editor.semanticTokenColorCustomizations"][`[${id}]`].rules;
  const bold = Object.entries(rules).filter(([, v]) => v.fontStyle === "bold").map(([k]) => k).sort();
  assert.deepEqual(bold, expectSemTypes, `[${id}] semantic rules bold exactly the vocabulary's token types`);
}

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
    initializationOptions: { defaultDialect: "classicbars" },
  });
  const legend = init.capabilities.semanticTokensProvider.legend;
  await conn.sendNotification("initialized", {});

  // languageId 'maxbars' on a `.rawbars` URI with a classicbars default: the dialect
  // must come from the languageId, so `??` is an operator and "b" a string.
  const uri = "file:///t/page.rawbars";
  const text = '{{ a ?? "b" }}';
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "maxbars", version: 1, text },
  });
  const res = await conn.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri } });

  // Decode the delta stream and assert SEMANTICALLY: the `??` is an operator and
  // "b" is a string. Doesn't care about token count (so additive painters — e.g.
  // an `operation` kind painting a known head — don't false-fail this gate).
  assert.equal(res.data.length % 5, 0, "delta-encoded token stream is 5-tuples");
  const decoded = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < res.data.length; i += 5) {
    const [dL, dC, len, type] = res.data.slice(i, i + 5);
    line += dL;
    char = dL === 0 ? char + dC : dC;
    decoded.push({ type: legend.tokenTypes[type], slice: text.slice(char, char + len) });
  }
  assert.ok(
    decoded.some((t) => t.type === "operator" && t.slice === "??"),
    "the bundled server tokenises `??` as a MaxBars operator",
  );
  assert.ok(
    decoded.some((t) => t.type === "string" && t.slice === '"b"'),
    "the bundled server tokenises `\"b\"` as a string literal",
  );

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
