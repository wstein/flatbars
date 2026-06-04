#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Build the VS Code extension and unzip the resulting .vsix to assert it ships
// every asset the manifest declares — grammar(s), bundled server, snippets,
// every contributed language extension. Catches accidental .vscodeignore drift
// and missing dist/ files that the shape-only smoke test (`existsSync + size`)
// cannot see.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../editors/shared/sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ext = resolve(root, "editors/vscode");
const vsix = resolve(ext, "flatbars-0.1.0.vsix");

// Build + package. `sync-assets.mjs` is idempotent; vsce overwrites the .vsix.
execFileSync(process.execPath, [resolve(ext, "scripts/sync-assets.mjs")], { stdio: "pipe" });
execFileSync(
  process.execPath,
  [resolve(root, "node_modules/@vscode/vsce/vsce"), "package", "--no-dependencies", "--out", vsix],
  { cwd: ext, stdio: "pipe" },
);

const work = mkdtempSync(join(tmpdir(), "flatbars-vsix-"));
try {
  // .vsix is a zip; use the system `unzip`.
  execFileSync("unzip", ["-q", vsix, "-d", work]);
  const fails = [];
  const has = (rel) => {
    if (!existsSync(join(work, "extension", rel))) fails.push(`missing: extension/${rel}`);
  };
  // Manifest + entrypoint.
  has("package.json");
  has("dist/extension.js");
  // Grammar + injection.
  has("dist/flatbars.tmLanguage.json");
  has("dist/flatbars-injection.tmLanguage.json");
  // Bundled server.
  has("dist/server/flatbars-lsp.cjs");
  // Snippets + icon + CHANGELOG.
  has("snippets/flatbars.json");
  has("icon.png");
  has("CHANGELOG.md");
  has("README.md");
  has("language-configuration.json");

  // Source-map files MUST NOT be in the shipped .vsix.
  const enumerated = execFileSync("find", [work, "-name", "*.map", "-type", "f"], { encoding: "utf8" });
  if (enumerated.trim()) fails.push(`stray source maps: ${enumerated.split("\n").filter(Boolean).join(", ")}`);

  // The packaged manifest must list every dialect + every extension.
  const pkg = JSON.parse(readFileSync(join(work, "extension", "package.json"), "utf8"));
  const declaredIds = pkg.contributes.languages.map((l) => l.id).sort();
  const expectedIds = LANGUAGES.map((l) => l.id).sort();
  if (JSON.stringify(declaredIds) !== JSON.stringify(expectedIds)) {
    fails.push(`language ids drift: ${declaredIds.join(",")} vs ${expectedIds.join(",")}`);
  }
  const declaredExts = pkg.contributes.languages.flatMap((l) => l.extensions).sort();
  const expectedExts = LANGUAGES.flatMap((l) => l.extensions).sort();
  if (JSON.stringify(declaredExts) !== JSON.stringify(expectedExts)) {
    fails.push(`extensions drift: ${declaredExts.join(",")} vs ${expectedExts.join(",")}`);
  }

  if (fails.length) {
    console.log("✗ .vsix integrity check failed:");
    for (const f of fails) console.log("  - " + f);
    process.exit(1);
  }
  console.log(`✓ .vsix integrity: every declared asset is shipped, no stray source maps`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
