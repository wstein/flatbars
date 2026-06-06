#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Phase-4 driver for the spec migration (ADR-031): convert every AsciiDoc page
// under docs/modules/ROOT/pages/ to its MDX home in spec/src/content/docs/, and
// regenerate the Starlight sidebar from nav.adoc so order + labels match. The
// per-file transform lives in migrate-spec.mjs (unit-tested); this script is the
// I/O + routing + sidebar shell around it.
//
//   node scripts/migrate-spec-all.mjs            # convert + write sidebar
//   node scripts/migrate-spec-all.mjs --check     # fail if any output is stale
//
// Idempotent: re-running produces byte-identical output, so --check gates drift.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import { convert, routeFor } from "./migrate-spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pagesDir = resolve(root, "docs/modules/ROOT/pages");
const docsDir = resolve(root, "spec/src/content/docs");
const partial = resolve(root, "spec/src/partials/helper-catalog.mdx");
const navFile = resolve(root, "docs/modules/ROOT/nav.adoc");

const check = process.argv.includes("--check");

// route ("/engine/prelude/") → content file path ("engine/prelude.mdx"); "/" is
// the home page index.mdx.
function contentPathForRoute(route) {
  if (route === "/") return "index.mdx";
  return route.replace(/^\/|\/$/g, "") + ".mdx";
}

// Assemble the final MDX: frontmatter, the catalog import (relative to this file's
// depth) when used, then the body.
function assemble(file, conv) {
  const parts = [conv.frontmatter, ""];
  if (conv.needsCatalog) {
    const rel = relative(dirname(file), partial).replace(/\\/g, "/");
    parts.push(`import HelperCatalog from "${rel}";`, "");
  }
  parts.push(conv.body);
  return parts.join("\n");
}

const adocFiles = readdirSync(pagesDir).filter((f) => f.endsWith(".adoc"));
let stale = 0;
let warnings = 0;
const written = [];

for (const f of adocFiles) {
  const page = f.replace(/\.adoc$/, "");
  const route = routeFor(page);
  if (!route) {
    console.error(`error: no route for ${f} — add it to ROUTE in migrate-spec.mjs`);
    process.exit(2);
  }
  const conv = convert(readFileSync(resolve(pagesDir, f), "utf8"));
  for (const w of conv.warnings) {
    warnings++;
    console.error(`warn: ${f}: ${w}`);
  }
  const outFile = resolve(docsDir, contentPathForRoute(route));
  const mdx = assemble(outFile, conv);
  written.push(outFile);
  if (check) {
    const cur = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    if (cur !== mdx) {
      stale++;
      console.error(`stale: ${relative(root, outFile)}`);
    }
  } else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, mdx);
  }
}

// ── Sidebar from nav.adoc ────────────────────────────────────────────────────
// `.Group label` opens a group; `* xref:page.adoc[Label]` is an item. Nested
// `**` entries are same-page anchors (the in-page TOC covers them) and are
// skipped. `.xref:index.adoc[…]` opens the first, link-titled group.
function buildSidebar() {
  const lines = readFileSync(navFile, "utf8").split("\n");
  const groups = [];
  let cur = null;
  const labelOf = (s) => {
    const x = s.match(/xref:[^[]+\[([^\]]*)\]/);
    return x ? x[1] : s;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith(".") && line.length > 1) {
      cur = { label: labelOf(line.slice(1)) || "FlatBars", items: [] };
      groups.push(cur);
    } else if (/^\* xref:/.test(line)) {
      const m = line.match(/xref:([a-z0-9-]+)\.adoc(#[a-zA-Z0-9-_]+)?\[([^\]]*)\]/);
      if (m && cur) {
        const link = (routeFor(m[1]) || "/") + (m[2] || "");
        cur.items.push({ label: m[3], link });
      }
    }
  }
  // The first group is titled with the home link; rename it for clarity.
  if (groups.length && /flatbars/i.test(groups[0].label)) groups[0].label = "Introduction";
  return groups;
}

const sidebar = buildSidebar();
const sidebarFile = resolve(root, "spec/src/sidebar.ts");
const sidebarSrc =
  "// SPDX-License-Identifier: Apache-2.0\n" +
  "// Generated from docs/modules/ROOT/nav.adoc by scripts/migrate-spec-all.mjs — do not edit.\n" +
  "// After the Antora cutover this file becomes the maintained source.\n" +
  "export const sidebar = " +
  JSON.stringify(sidebar, null, 2) +
  ";\n";

if (check) {
  const cur = existsSync(sidebarFile) ? readFileSync(sidebarFile, "utf8") : null;
  if (cur !== sidebarSrc) {
    stale++;
    console.error("stale: spec/src/sidebar.ts");
  }
} else {
  writeFileSync(sidebarFile, sidebarSrc);
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} file(s) stale — run \`npm run gen:spec\` and commit.`);
    process.exit(1);
  }
  console.log(`spec is up to date (${adocFiles.length} pages).`);
} else {
  console.log(`converted ${written.length} pages; sidebar has ${sidebar.length} groups.`);
  if (warnings) console.log(`(${warnings} warning(s) — see above)`);
}
