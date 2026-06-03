#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Assemble the JetBrains plugin's shippable assets into src/main/resources (a
// build product, git-ignored). Single-direction copy/bundle from the canonical
// sources, so the plugin can never drift:
//
//   * resources/server/flatbars-lsp.cjs        <- esbuild of editors/lsp (the same
//                                                 self-contained server the VS Code
//                                                 extension ships); the descriptor
//                                                 extracts it and spawns node on it.
//   * resources/textmate-bundle/                <- a VS Code-style TextMate bundle
//       package.json, flatbars.tmLanguage.json,   (grammar + language config) the
//       language-configuration.json               plugin registers as the fallback.
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, "..");
const root = resolve(plugin, "..", "..");
const res = resolve(plugin, "src", "main", "resources");

mkdirSync(resolve(res, "server"), { recursive: true });
mkdirSync(resolve(res, "textmate-bundle"), { recursive: true });

// The engine-backed server, bundled to one self-contained CJS file (vscode-
// languageserver is CJS and dynamically requires node builtins, so CJS output).
await esbuild.build({
  entryPoints: [resolve(root, "editors", "lsp", "bin", "flatbars-lsp.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: resolve(res, "server", "flatbars-lsp.cjs"),
  logLevel: "warning",
});

// The TextMate fallback, as a VS Code-style bundle dir (JetBrains reads these).
copyFileSync(
  resolve(root, "editors", "flatbars.tmLanguage.json"),
  resolve(res, "textmate-bundle", "flatbars.tmLanguage.json"),
);
copyFileSync(
  resolve(root, "editors", "vscode", "language-configuration.json"),
  resolve(res, "textmate-bundle", "language-configuration.json"),
);
writeFileSync(
  resolve(res, "textmate-bundle", "package.json"),
  JSON.stringify(
    {
      name: "flatbars",
      displayName: "FlatBars",
      version: "0.1.0",
      engines: { vscode: "*" },
      contributes: {
        // The `flatbars` umbrella + one language per dialect, native extensions
        // only (not .hbs/.handlebars/.mustache). All share the one grammar.
        languages: [
          { id: "flatbars", aliases: ["FlatBars"], extensions: [".flatbars"], configuration: "./language-configuration.json" },
          { id: "rawbars", aliases: ["RawBars"], extensions: [".rawbars"], configuration: "./language-configuration.json" },
          { id: "minbars", aliases: ["MinBars"], extensions: [".minbars"], configuration: "./language-configuration.json" },
          { id: "fullbars", aliases: ["FullBars"], extensions: [".fullbars"], configuration: "./language-configuration.json" },
          { id: "maxbars", aliases: ["MaxBars"], extensions: [".maxbars"], configuration: "./language-configuration.json" },
        ],
        grammars: ["flatbars", "rawbars", "minbars", "fullbars", "maxbars"].map((language) => ({
          language,
          scopeName: "source.flatbars",
          path: "./flatbars.tmLanguage.json",
        })),
      },
    },
    null,
    2,
  ) + "\n",
);

console.log("✓ jetbrains assets synced to src/main/resources (bundled server + TextMate bundle)");
