#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Sync the JetBrains plugin assets and assert the generated TextMate bundle
// manifest declares the right languages, extensions, grammars, and injection
// host list. The shape-only smoke test (`test:jetbrains`) verifies the
// scopeName matches the canonical grammar; this gate verifies the whole
// contribution surface.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../editors/shared/sync.mjs";
import { INJECTION_HOSTS } from "../editors/scripts/sync-manifests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const plugin = resolve(root, "editors/jetbrains");

execFileSync(process.execPath, [resolve(plugin, "scripts/sync-assets.mjs")], { stdio: "pipe" });
const manifest = JSON.parse(
  readFileSync(resolve(plugin, "src/main/resources/textmate-bundle/package.json"), "utf8"),
);

const fails = [];
const langIds = manifest.contributes.languages.map((l) => l.id).sort();
const expectedIds = LANGUAGES.map((l) => l.id).sort();
if (JSON.stringify(langIds) !== JSON.stringify(expectedIds)) {
  fails.push(`language ids drift: bundle=${langIds.join(",")} expected=${expectedIds.join(",")}`);
}
const exts = manifest.contributes.languages.flatMap((l) => l.extensions).sort();
const expectedExts = LANGUAGES.flatMap((l) => l.extensions).sort();
if (JSON.stringify(exts) !== JSON.stringify(expectedExts)) {
  fails.push(`extensions drift: bundle=${exts.join(",")} expected=${expectedExts.join(",")}`);
}
const grammarLangs = manifest.contributes.grammars
  .filter((g) => g.language)
  .map((g) => g.language)
  .sort();
if (JSON.stringify(grammarLangs) !== JSON.stringify(expectedIds)) {
  fails.push(`grammar contributions drift: ${grammarLangs.join(",")}`);
}
const injection = manifest.contributes.grammars.find((g) => g.scopeName === "flatbars.injection");
if (!injection) {
  fails.push(`flatbars.injection grammar missing from bundle`);
} else {
  const declaredHosts = [...injection.injectTo].sort();
  const expectedHosts = [...INJECTION_HOSTS].sort();
  if (JSON.stringify(declaredHosts) !== JSON.stringify(expectedHosts)) {
    fails.push(`injection host list drift (${declaredHosts.length} vs ${expectedHosts.length})`);
  }
}

if (fails.length) {
  console.log("✗ jetbrains TextMate-bundle integrity failed:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`✓ jetbrains bundle: ${langIds.length} languages, ${exts.length} extensions, injection covers ${INJECTION_HOSTS.length} hosts`);
