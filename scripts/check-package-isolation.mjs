// SPDX-License-Identifier: Apache-2.0
//
// Package-isolation regression check (ADR-003 lazy extraction / ADR-008 strict
// dialect separation). The dialect packages must not depend on each other; in
// particular RawBars — the austere substrate — must NOT pull in FullBars, even
// transitively. This guards the boundary the `fullbars-compile` split (driver +
// emit vs. surface compile) was made to keep: RawBars compiles through
// `barebars-compile`, which carries no `fullbars` dependency.
//
// It reads each packages/*/spago.yaml, takes the package's *library*
// dependencies (the first `dependencies:` block — test deps are exempt),
// restricts them to workspace packages, and asserts each forbidden edge is
// absent from the dependency closure. Run: `node scripts/check-package-isolation.mjs`.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgsDir = resolve(here, "../packages");

// The library `dependencies:` list (the first one — before `test:`/`run:`).
function libDeps(yaml) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^\s*dependencies:\s*$/.test(l));
  if (start < 0) return [];
  const deps = [];
  for (let j = start + 1; j < lines.length; j++) {
    const item = lines[j].match(/^\s*-\s*(\S+)\s*$/);
    if (item) deps.push(item[1]);
    else if (/^\s*\S/.test(lines[j])) break; // the next key (test:/run:/…) ends the block
  }
  return deps;
}
const pkgName = (yaml) => (yaml.match(/^\s*name:\s*(\S+)/m) || [])[1];

// Build name -> workspace library deps.
const graph = {};
for (const dir of readdirSync(pkgsDir)) {
  const f = resolve(pkgsDir, dir, "spago.yaml");
  if (!existsSync(f)) continue;
  const yaml = readFileSync(f, "utf8");
  const name = pkgName(yaml);
  if (name) graph[name] = libDeps(yaml);
}
const workspace = new Set(Object.keys(graph));
for (const name of workspace) graph[name] = graph[name].filter((d) => workspace.has(d));

// Transitive workspace-dependency closure of a package (excluding itself).
function closure(root) {
  const seen = new Set();
  const stack = [...(graph[root] || [])];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    for (const d of graph[p] || []) if (!seen.has(d)) stack.push(d);
  }
  return seen;
}

// The forbidden edges (ADR-008): a package -> a package its closure must exclude.
const FORBIDDEN = [
  { from: "rawbars", to: "fullbars" },
  { from: "rawbars", to: "fullbars-compile" },
  { from: "rawbars", to: "maxbars" },
  { from: "rawbars", to: "minbars" },
];

let failed = 0;
for (const { from, to } of FORBIDDEN) {
  if (!workspace.has(from)) {
    console.error(`  ? ${from} — package not found`);
    failed++;
    continue;
  }
  const cl = closure(from);
  if (cl.has(to)) {
    console.error(`  ✘ ${from} depends (transitively) on ${to} — closure: {${[...cl].sort().join(", ")}}`);
    failed++;
  } else {
    console.log(`  ✓ ${from} closure excludes ${to}`);
  }
}

console.log(`\npackage isolation: ${FORBIDDEN.length - failed}/${FORBIDDEN.length} invariants hold`);
process.exit(failed === 0 ? 0 : 1);
