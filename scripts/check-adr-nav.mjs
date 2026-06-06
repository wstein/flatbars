#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:adr-nav — assert every ADR page in the Starlight spec is linked from the
// sidebar, and every sidebar ADR link points at a real ADR page. Catches the
// silent-drift failure mode where a new ADR is committed but never surfaced in the
// site navigation, so readers never find it.
//
// The `adr-final-review` synthesis page is exempt from the numbered-ADR
// projection (it is linked, but is not an `adr-NNNN-*` decision record).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const adrDir = resolve(root, "spec/src/content/docs/adr");
const sidebarPath = resolve(root, "spec/src/sidebar.ts");

const ADR_FILE = /^adr-\d{4,}-[a-z0-9-]+\.mdx$/;
const adrPages = readdirSync(adrDir)
  .filter((f) => ADR_FILE.test(f))
  .map((f) => f.replace(/\.mdx$/, ""))
  .sort();

const sidebar = readFileSync(sidebarPath, "utf8");
// Sidebar links are `/adr/<slug>/`; collect the slugs it references.
const linked = new Set();
for (const m of sidebar.matchAll(/"\/adr\/(adr-[0-9a-z-]+)\/"/g)) linked.add(m[1]);

const missing = adrPages.filter((p) => !linked.has(p));
const dangling = [...linked].filter((p) => /^adr-\d{4,}-/.test(p) && !adrPages.includes(p));

let failed = false;
if (missing.length) {
  console.error("✗ ADR page(s) present but missing from spec/src/sidebar.ts:");
  for (const p of missing) console.error(`    ${p}`);
  failed = true;
}
if (dangling.length) {
  console.error("✗ sidebar link(s) point at non-existent ADR page(s):");
  for (const p of dangling) console.error(`    ${p}`);
  failed = true;
}
if (failed) {
  console.error("\n  fix: add the missing entry to spec/src/sidebar.ts (or remove the stale link)");
  process.exit(1);
}
console.log(`✓ check:adr-nav — ${adrPages.length} ADR pages, all linked from the sidebar`);
