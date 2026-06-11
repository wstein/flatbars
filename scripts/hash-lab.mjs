#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Content-hashed cache-busting for the FlatBars Lab (Phase 1 of
// PLAN-registry-local-trussbars.md). Replaces the hand-bumped `?v=N` scheme (and the
// check:lab-cachebust lock) with AUTOMATIC content hashes: every local `?v=` on an
// import / string ref / <script src> is rewritten to `?v=<sha8>` of the imported
// module's content. Because hashing is LEAF-FIRST and a module's hash includes its
// already-rewritten import lines, a change to a leaf (e.g. dom.mjs) changes its hash,
// which rewrites its importers' import lines, which changes THEIR hashes — so a
// stale cache is structurally impossible and there is no version number to forget.
//
//   node scripts/hash-lab.mjs           # CI gate (in `npm test`): fail if any ?v= is stale
//   node scripts/hash-lab.mjs --write   # rewrite the ?v= to the current content hashes
//
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(root, "lab/index.html");
const write = process.argv.includes("--write");

// A local module ref: a quoted "./…​.mjs" or "./…​.mjs?v=<hex>" (covers `from "…"`,
// bare string refs like createHelperSandbox("…"), and <script src="…">). External
// (esm.sh / non-relative) refs don't start with `.` and are ignored.
const REF_RE = /(["'])(\.\.?\/[^"'?]+\.mjs)(\?v=[0-9a-f]+)?\1/g;

// Load the local module graph reachable from the entry.
const graph = new Map(); // abs -> { text, deps: Set<abs> } | null (external/missing)
function load(abs) {
  if (graph.has(abs)) return;
  if (!existsSync(abs)) { graph.set(abs, null); return; }
  const text = readFileSync(abs, "utf8");
  const deps = new Set();
  for (const m of text.matchAll(REF_RE)) {
    const target = resolve(dirname(abs), m[2]);
    deps.add(target);
  }
  graph.set(abs, { text, deps });
  for (const d of deps) load(d);
}
load(ENTRY);

// Leaf-first topological order over the .mjs modules (the entry HTML is rewritten
// but not itself hashed — browsers revalidate HTML).
const hash = new Map(); // abs -> sha8
const visiting = new Set();
const errors = [];
function rewriteRefs(abs, text) {
  return text.replace(REF_RE, (whole, q, path, _ver) => {
    const target = resolve(dirname(abs), path);
    const h = hash.get(target);
    return h ? `${q}${path}?v=${h}${q}` : whole; // external/missing → leave as-is
  });
}
function visit(abs) {
  if (hash.has(abs)) return;
  const node = graph.get(abs);
  if (!node) return; // external/missing
  if (visiting.has(abs)) { errors.push(`import cycle at ${rel(abs)}`); return; }
  visiting.add(abs);
  for (const d of node.deps) visit(d);
  visiting.delete(abs);
  const rewritten = rewriteRefs(abs, node.text);
  hash.set(abs, createHash("sha256").update(rewritten).digest("hex").slice(0, 8));
}
const rel = (abs) => abs.replace(root + "/", "");
for (const abs of graph.keys()) if (abs !== ENTRY) visit(abs);

if (errors.length) { for (const e of errors) console.error(`hash-lab: ${e}`); process.exit(1); }

// Apply: rewrite the ?v= in every module + the entry to the computed hashes.
let stale = 0;
const targets = [ENTRY, ...[...graph.keys()].filter((a) => a !== ENTRY && graph.get(a))];
for (const abs of targets) {
  const cur = readFileSync(abs, "utf8");
  const next = rewriteRefs(abs, cur);
  if (next !== cur) {
    stale++;
    if (write) writeFileSync(abs, next);
    else {
      // report which refs drifted
      const before = [...cur.matchAll(REF_RE)].map((m) => m[2] + (m[3] || ""));
      const after = [...next.matchAll(REF_RE)].map((m) => m[2] + (m[3] || ""));
      for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) console.error(`hash-lab: ${rel(abs)} — ${before[i]} → ${after[i]}`);
    }
  }
}

if (write) {
  console.log(`hash-lab — wrote content hashes to ${stale} file(s) across ${hash.size} modules`);
} else if (stale) {
  console.error(`hash-lab: ${stale} file(s) carry a stale ?v= — run \`npm run gen:lab-hashes\``);
  process.exit(1);
} else {
  console.log(`hash-lab — ${hash.size} Lab modules carry up-to-date content-hash ?v= ✓`);
}
