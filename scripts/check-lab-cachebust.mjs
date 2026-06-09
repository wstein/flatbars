#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Cache-bust freshness guard for the FlatBars Lab. The Lab loads two committed
// JS modules through a hand-bumped `?v=N` query so a returning browser never
// runs a stale cached copy: the engine bundle (`vendor/flatbars-engine.mjs`)
// and the analyses module (`playground_utils.mjs`). The invariant the Lab
// relies on is simple:
//
//   if a module's content changes, its ?v= must change too.
//
// Forgetting the bump silently ships a stale Lab — the exact class of bug
// `check:bundle` does NOT catch (it pins the bundle *content*, not the version
// token), and the one that shipped a stale Data Access analysis until caught.
//
// This gate records each module's (version, sha256) in `lab/cachebust.lock.json`
// and fails when a module's content drifts from the lock while its version did
// NOT — with the one-line fix. `--write` regenerates the lock, refusing to do so
// while a changed module still carries its old version (so the fix is to bump
// the `?v=`, not to silence the gate).
//
//   node scripts/check-lab-cachebust.mjs            # CI gate (in `npm test`)
//   node scripts/check-lab-cachebust.mjs --write    # after bumping a ?v=
//
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = resolve(root, "lab/cachebust.lock.json");

// Each cache-busted module and the files that import it with a `?v=` query.
// Every importer of a module must agree on the version (drift across the three
// engine importers is itself a bug).
const TRACKED = [
  {
    module: "lab/vendor/flatbars-engine.mjs",
    importers: ["lab/index.html", "lab/renderer.mjs", "lab/helpers-worker.mjs"],
  },
  {
    module: "lab/playground_utils.mjs",
    importers: ["lab/index.html"],
  },
];

const write = process.argv.includes("--write");

const sha256 = (path) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");

// The agreed `?v=` for `module` across its importers, or an error string.
function versionOf(module, importers) {
  const base = basename(module).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(base + "\\?v=(\\d+)", "g");
  const seen = new Map(); // version -> [importers]
  for (const imp of importers) {
    const text = readFileSync(resolve(root, imp), "utf8");
    for (const m of text.matchAll(re)) {
      const v = Number(m[1]);
      if (!seen.has(v)) seen.set(v, []);
      if (!seen.get(v).includes(imp)) seen.get(v).push(imp);
    }
  }
  if (seen.size === 0) return { error: `no \`?v=\` import of ${basename(module)} found in ${importers.join(", ")}` };
  if (seen.size > 1) {
    const detail = [...seen].map(([v, imps]) => `v=${v} (${imps.join(", ")})`).join("; ");
    return { error: `version drift for ${basename(module)} across importers — ${detail}; align them` };
  }
  return { version: [...seen.keys()][0] };
}

const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {};
const errors = [];
const nextLock = {};

for (const { module, importers } of TRACKED) {
  const v = versionOf(module, importers);
  if (v.error) {
    errors.push(v.error);
    continue;
  }
  const version = v.version;
  const sha = sha256(module);
  const rec = lock[module];

  if (write) {
    // Refuse to bless a content change that did not bump the version — the fix
    // is to bump the `?v=`, not to re-record the old one against new bytes.
    if (rec && sha !== rec.sha && version === rec.v) {
      errors.push(
        `${module} content changed but ?v=${version} is unchanged — bump it in ${importers.join(", ")} first, then re-run \`npm run gen:cachebust\``,
      );
    }
    nextLock[module] = { v: version, sha };
    continue;
  }

  if (!rec) {
    errors.push(`${module} has no cachebust lock entry — run \`npm run gen:cachebust\``);
  } else if (sha === rec.sha && version === rec.v) {
    // fresh — nothing to do
  } else if (sha !== rec.sha && version === rec.v) {
    errors.push(
      `${module} changed but ?v=${version} was not bumped — bump it in ${importers.join(", ")} and run \`npm run gen:cachebust\``,
    );
  } else {
    errors.push(
      `${module} cachebust lock is stale (lock v=${rec.v}, tree v=${version}) — run \`npm run gen:cachebust\``,
    );
  }
}

if (errors.length) {
  for (const e of errors) console.error(`check:lab-cachebust: ${e}`);
  process.exit(1);
}

if (write) {
  // Stable key order so the lock diffs cleanly.
  const ordered = Object.fromEntries(Object.keys(nextLock).sort().map((k) => [k, nextLock[k]]));
  writeFileSync(LOCK, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`gen:cachebust — wrote ${LOCK.replace(root + "/", "")} (${TRACKED.length} modules)`);
} else {
  console.log(`check:lab-cachebust — ${TRACKED.length} Lab modules carry an up-to-date \`?v=\` ✓`);
}
