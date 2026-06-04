#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:adr-nav — assert every adr-*.adoc page is referenced by docs/modules/ROOT/nav.adoc
// AND every nav xref points at a real ADR file. Catches the silent-drift failure
// mode where a new ADR is committed (e.g. ADR-026/027/028 from the June 2026
// editor round) but never linked from the nav, so the Antora-built site never
// surfaces it to readers — every per-page gate stays green and the omission is
// only noticed when someone searches the rendered site for the title.
//
// Counts only `^\* xref:adr-…` rows; the `adr-final-review.adoc` synthesis page
// (and any explicit non-`adr-NNNN-*.adoc` reference) is exempt from the pages
// projection.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pagesDir = resolve(root, "docs", "modules", "ROOT", "pages");
const navPath = resolve(root, "docs", "modules", "ROOT", "nav.adoc");

const ADR_FILE = /^adr-\d{4,}-[a-z0-9-]+\.adoc$/;
const NAV_XREF = /^\* xref:(adr-[0-9a-z-]+\.adoc)/gm;

const pageFiles = readdirSync(pagesDir).filter((f) => ADR_FILE.test(f)).sort();
const nav = readFileSync(navPath, "utf8");
const navRefs = new Set();
for (const m of nav.matchAll(NAV_XREF)) navRefs.add(m[1]);

const missingFromNav = pageFiles.filter((f) => !navRefs.has(f));
const navWithoutFile = [...navRefs].filter((f) => f.startsWith("adr-") && /^adr-\d{4,}-/.test(f) && !pageFiles.includes(f));

let failed = false;
if (missingFromNav.length) {
  console.error(`✗ ADR page(s) present but missing from docs/modules/ROOT/nav.adoc:`);
  for (const f of missingFromNav) console.error(`    ${f}`);
  failed = true;
}
if (navWithoutFile.length) {
  console.error(`✗ nav.adoc xref(s) point at non-existent ADR file(s):`);
  for (const f of navWithoutFile) console.error(`    ${f}`);
  failed = true;
}
if (failed) {
  console.error(`\n  fix: add the missing entry to docs/modules/ROOT/nav.adoc (or remove the stale xref)`);
  process.exit(1);
}
console.log(`✓ check:adr-nav — ${pageFiles.length} ADR pages, all linked from nav.adoc`);
