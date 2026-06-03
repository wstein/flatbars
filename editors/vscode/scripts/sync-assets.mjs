#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Assemble the VS Code extension's shippable assets into ./dist (a build product,
// git-ignored). There is ONE canonical copy of each asset elsewhere in the repo;
// this script is the single-direction copy/bundle, so the extension can never
// drift from the source of truth:
//
//   * dist/flatbars.tmLanguage.json  <- editors/flatbars.tmLanguage.json (gated by
//                                       check:tmgrammar)
//   * dist/server/flatbars-lsp.mjs   <- esbuild of editors/lsp (self-contained:
//                                       bundles vscode-languageserver, the engine
//                                       bundle, and the inlined token vocabulary —
//                                       no node_modules needed at runtime)
//   * dist/extension.js              <- esbuild of src/extension.js (bundles
//                                       vscode-languageclient; `vscode` is external)
import { mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "..");
const root = resolve(ext, "..", "..");
const dist = resolve(ext, "dist");

mkdirSync(resolve(dist, "server"), { recursive: true });

// The engine-backed server, bundled to one self-contained file. CJS output: the
// server embeds vscode-languageserver, which is CJS and uses dynamic `require` of
// node builtins — that breaks under an ESM bundle, so we target CJS (node runs the
// .cjs entry directly).
await esbuild.build({
  entryPoints: [resolve(root, "editors", "lsp", "bin", "flatbars-lsp.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: resolve(dist, "server", "flatbars-lsp.cjs"),
  logLevel: "warning",
});

// The extension client, bundled CJS with `vscode` left external (host-provided).
await esbuild.build({
  entryPoints: [resolve(ext, "src", "extension.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: resolve(dist, "extension.js"),
  logLevel: "warning",
});

// The TextMate fallback grammar — the canonical copy, verbatim.
copyFileSync(
  resolve(root, "editors", "flatbars.tmLanguage.json"),
  resolve(dist, "flatbars.tmLanguage.json"),
);

console.log("✓ vscode assets synced to editors/vscode/dist (grammar + bundled server + extension)");
