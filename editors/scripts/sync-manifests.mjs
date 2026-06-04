#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Codegen the editor manifests from editors/shared/sync.mjs LANGUAGES so the
// VS Code extension's contribution arrays and the JetBrains plugin's Kotlin
// extension set can never drift from the single source of truth.
//
//   * editors/vscode/package.json
//     contributes.languages and contributes.grammars are regenerated; the
//     surrounding manifest (publisher, scripts, devDependencies, …) is
//     preserved verbatim. Drop a key by removing it here.
//
//   * editors/jetbrains/src/main/kotlin/com/flatbars/idea/FlatBarsLanguages.kt
//     The full extension set (long + short forms, every dialect) generated as
//     a Kotlin `object`. FlatBarsSupport consults this set.
//
// Usage:
//   node editors/scripts/sync-manifests.mjs            # write the files
//   node editors/scripts/sync-manifests.mjs --check    # diff; exit 1 if stale
//
// Wired into `npm run gen:editors-manifests` / `npm run check:editors-manifests`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LANGUAGES } from "../shared/sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const CHECK = process.argv.includes("--check");

// Host scope set the injection grammar attaches to. Single-sourced here so the
// VS Code manifest and the JetBrains TextMate-bundle manifest never drift.
const INJECTION_HOSTS = [
  "source.java", "source.ruby", "source.python", "source.go",
  "source.js", "source.ts", "source.jsx", "source.tsx",
  "source.css", "source.scss", "source.less",
  "source.sql", "source.shell", "source.yaml", "source.json",
  "source.rust", "source.cpp", "source.cs", "source.kotlin", "source.swift",
  "source.php", "source.lua", "source.elixir",
  "text.html.basic", "text.html.markdown", "text.xml",
];

export { INJECTION_HOSTS };

// ── 1. VS Code package.json (contributes block only) ─────────────────────────
function genVscodePackageJson() {
  const path = resolve(root, "editors/vscode/package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.contributes.languages = LANGUAGES.map((l) => ({
    id: l.id,
    aliases: l.aliases,
    extensions: l.extensions,
    configuration: "./language-configuration.json",
  }));
  pkg.contributes.grammars = [
    ...LANGUAGES.map((l) => ({
      language: l.id,
      scopeName: "source.flatbars",
      path: "./dist/flatbars.tmLanguage.json",
    })),
    {
      path: "./dist/flatbars-injection.tmLanguage.json",
      scopeName: "flatbars.injection",
      injectTo: INJECTION_HOSTS,
    },
  ];
  return [path, JSON.stringify(pkg, null, 2) + "\n"];
}

// ── 2. JetBrains FlatBarsLanguages.kt ────────────────────────────────────────
function genKotlinLanguages() {
  const path = resolve(
    root,
    "editors/jetbrains/src/main/kotlin/com/flatbars/idea/FlatBarsLanguages.kt",
  );
  const exts = LANGUAGES.flatMap((l) => l.extensions.map((e) => e.replace(/^\./, "").toLowerCase()));
  const seen = new Set();
  const uniq = exts.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));
  const body = `// SPDX-License-Identifier: Apache-2.0
// DO NOT EDIT — generated from editors/shared/sync.mjs by editors/scripts/sync-manifests.mjs.
// Run \`npm run gen:editors-manifests\` after editing LANGUAGES.
package com.flatbars.idea

/**
 * Every FlatBars-native file extension, projected from the shared LANGUAGES table
 * so the JetBrains plugin's file-recognition set cannot drift from the VS Code
 * manifest or the LSP's URI → dialect map. We deliberately do NOT claim .hbs /
 * .handlebars / .mustache — those belong to their own ecosystems.
 */
object FlatBarsLanguages {
  val EXTENSIONS: Set<String> = setOf(
${uniq.map((e) => `    "${e}",`).join("\n")}
  )
}
`;
  return [path, body];
}

const targets = [genVscodePackageJson(), genKotlinLanguages()];

if (CHECK) {
  let failed = false;
  for (const [path, expected] of targets) {
    const actual = readFileSync(path, "utf8");
    if (actual !== expected) {
      console.log(`✗ stale: ${path}`);
      console.log("  run: npm run gen:editors-manifests");
      failed = true;
    } else {
      console.log(`✓ current: ${path.replace(root + "/", "")}`);
    }
  }
  process.exit(failed ? 1 : 0);
} else {
  for (const [path, body] of targets) {
    writeFileSync(path, body);
    console.log(`✓ wrote: ${path.replace(root + "/", "")}`);
  }
}
