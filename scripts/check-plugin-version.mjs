#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Pin every place that names the plugin version against the single source
// (editors/shared/sync.mjs PLUGIN_VERSION). Run after bumping the version.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_VERSION } from "../editors/shared/sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const checks = [
  {
    path: "editors/vscode/package.json",
    extract: (s) => JSON.parse(s).version,
    label: "VS Code extension manifest",
  },
  {
    path: "editors/lsp/package.json",
    extract: (s) => JSON.parse(s).version,
    label: "flatbars-lsp package",
  },
  {
    path: "editors/jetbrains/build.gradle.kts",
    extract: (s) => (s.match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1],
    label: "JetBrains Gradle build",
  },
];

let failed = false;
for (const c of checks) {
  const fullPath = resolve(root, c.path);
  const actual = c.extract(readFileSync(fullPath, "utf8"));
  if (actual !== PLUGIN_VERSION) {
    console.log(`  ✗ ${c.label} (${c.path}) is ${actual}, expected ${PLUGIN_VERSION}`);
    failed = true;
  } else {
    console.log(`  ✓ ${c.label}: ${actual}`);
  }
}
if (failed) {
  console.log();
  console.log(`Bump PLUGIN_VERSION in editors/shared/sync.mjs and run npm run gen:editors-manifests, or update the listed files to match.`);
  process.exit(1);
}
console.log();
console.log(`All version stamps current: ${PLUGIN_VERSION}`);
