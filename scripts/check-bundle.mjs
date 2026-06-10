#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Bundle-staleness guard (consensus item 3). The FlatBars Lab and the tutorial
// previews run the COMMITTED engine bundle lab/vendor/flatbars-engine.mjs,
// so it must track the PureScript source. This regenerates the bundle from the
// compiled output with a PINNED esbuild and byte-diffs it against the committed
// file: a difference means someone changed the engine without re-bundling, and CI
// fails with the one-line fix. If esbuild can't be obtained (offline, no dep) the
// check SKIPS with a warning rather than false-failing.
//
//   spago build -p flatbars-js && node scripts/check-bundle.mjs
//
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { ESBUILD_VERSION } from "../editors/shared/sync.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(root, "output/ClassicBars.JS/index.js");
const COMMITTED = resolve(root, "lab/vendor/flatbars-engine.mjs");
// Pinned so the regen is byte-reproducible regardless of the local toolchain;
// the committed bundle is produced by this exact command. The version is the
// repo-wide pin from `editors/shared/sync.mjs` (the same `gen:bundle` and the
// editor packagers use) — imported, not duplicated, so the gate can never drift
// from it again.
const ESBUILD = `esbuild@${ESBUILD_VERSION}`;
const REGEN_CMD = `npx --yes ${ESBUILD} output/ClassicBars.JS/index.js --bundle --format=esm --platform=browser --outfile=lab/vendor/flatbars-engine.mjs`;

if (!existsSync(ENTRY)) {
  console.error("check:bundle: output/ClassicBars.JS not found — run `spago build` first.");
  process.exit(2);
}

const out = join(mkdtempSync(join(tmpdir(), "bb-bundle-")), "engine.mjs");
try {
  execFileSync(
    "npx",
    ["--yes", ESBUILD, "output/ClassicBars.JS/index.js", "--bundle", "--format=esm", "--platform=browser", `--outfile=${out}`],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (e) {
  console.warn(`check:bundle: skipped — couldn't run ${ESBUILD} (${String(e.message || e).split("\n")[0]}).`);
  process.exit(0);
}

if (Buffer.compare(readFileSync(out), readFileSync(COMMITTED)) === 0) {
  console.log("check:bundle: lab/vendor/flatbars-engine.mjs is current ✓");
  process.exit(0);
}
console.error(
  "check:bundle: the committed Lab engine bundle is STALE — the engine source changed but the\n" +
    "bundle was not regenerated, so the Lab/tutorials would run an old engine. Regenerate it:\n\n  " +
    REGEN_CMD + "\n",
);
process.exit(1);
