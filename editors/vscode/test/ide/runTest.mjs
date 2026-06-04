// SPDX-License-Identifier: Apache-2.0
//
// Real-IDE test driver (ADR-017, blocker 1): downloads a real VS Code, installs
// the extension from this folder, and runs test/ide/suite inside the Extension
// Host. Heavy (a VS Code download + a windowed run), so it is NOT in `npm test`;
// it runs in CI (under xvfb on Linux) and on demand via `npm run test:vscode:ide`.
import { runTests } from "@vscode/test-electron";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, "..", ".."); // editors/vscode

// The extension's `main` is ./dist/extension.js (a build product); build it first
// so the Extension Host can load the client + the bundled server + the grammar.
execFileSync(process.execPath, [resolve(extensionDevelopmentPath, "scripts", "sync-assets.mjs")], { stdio: "inherit" });

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: resolve(here, "suite", "index.cjs"),
    // Disable other extensions (the one under test still loads). The fixture is a
    // single file with no workspace folder, so Workspace Trust does not gate it.
    launchArgs: ["--disable-extensions"],
  });
} catch (err) {
  console.error("✗ real-IDE test failed:", err);
  process.exit(1);
}
