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
import { assertEsbuildVersion, bundleServer } from "../../shared/sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "..");
const root = resolve(ext, "..", "..");
const dist = resolve(ext, "dist");

assertEsbuildVersion(esbuild);
mkdirSync(resolve(dist, "server"), { recursive: true });

// The engine-backed server, bundled to one self-contained CJS file (the same step
// the JetBrains plugin runs, shared via editors/shared/sync.mjs). Source maps are
// emitted for debugging (the F5 "Attach to flatbars-lsp" config); .vscodeignore
// keeps **/*.map out of the shipped .vsix.
await bundleServer(esbuild, { repoRoot: root, outfile: resolve(dist, "server", "flatbars-lsp.cjs"), sourcemap: true });

// The extension client, bundled CJS with `vscode` left external (host-provided).
await esbuild.build({
  entryPoints: [resolve(ext, "src", "extension.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  outfile: resolve(dist, "extension.js"),
  logLevel: "warning",
});

// The TextMate fallback grammar — the canonical copy, verbatim.
copyFileSync(
  resolve(root, "editors", "flatbars.tmLanguage.json"),
  resolve(dist, "flatbars.tmLanguage.json"),
);

// The injection grammar — layers FlatBars tag highlighting into host grammars
// for hybrid templates (test.java.xbars, test.rb.fbars, …).
copyFileSync(
  resolve(root, "editors", "flatbars-injection.tmLanguage.json"),
  resolve(dist, "flatbars-injection.tmLanguage.json"),
);

console.log("✓ vscode assets synced to editors/vscode/dist (grammar + injection + bundled server + extension)");
