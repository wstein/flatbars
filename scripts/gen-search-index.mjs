#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Generate the UNIFIED GLOBAL SEARCH index — one client-side palette index spanning
// the whole umbrella (tutorials + spec + Lab). It is ASSEMBLED from the existing
// single sources, never hand-maintained, and drift-gated by check:search-index
// (mirroring the catalog / surface-syntax gen:/check: pattern):
//
//   • prelude operations   ← editors/operations.json        (kind "op")
//   • surface deltas        ← shared/surface-syntax.json      (kind "surface" + "feature")
//   • ADRs                  ← spec/src/content/docs/adr/*.mdx (kind "adr")
//   • spec pages            ← spec/src/content/docs/**/*.mdx  (kind "page")
//   • runnable examples     ← tutorials/src/{rawbars,fullbars,maxbars,mustache}.mjs (kind "example")
//   • tutorial pages + Lab  ← the curated list below          (kind "page")
//
// URLs are base-relative root-absolute (e.g. "/maxbars", "/spec/concepts/", "/lab/");
// the shared <flatbars-topbar> prepends its deploy `base` at navigation time, so the
// one index works in dev (base "") and under /flatbars in production. The file is
// emitted to tutorials/public/ so it serves at the umbrella root (/search-index.json,
// /flatbars/search-index.json deployed) — the topbar fetches it lazily on first open.
//
//   node scripts/gen-search-index.mjs           # regenerate
//   node scripts/gen-search-index.mjs --check    # CI: fail if it drifted
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(root, "tutorials", "public", "search-index.json");

const read = (p) => readFileSync(resolve(root, p), "utf8");
const frontTitle = (mdx) => {
  const m = mdx.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const t = m[1].match(/^title:\s*(.+)$/m);
  return t ? t[1].trim().replace(/^["']|["']$/g, "") : null;
};
const humanize = (id) =>
  id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

const entries = [];
const push = (kind, title, sub, url, terms) =>
  entries.push({ kind, title, sub, url, terms: [title, sub, terms].filter(Boolean).join(" ").toLowerCase() });

// ── tutorial pages + Lab (curated; routes are integrity-checked below) ──────────
const TUTORIAL_PAGES = [
  ["Home", "The FlatBars landing", "/", "home landing overview thesis"],
  ["Getting started", "The 10-minute on-ramp", "/start", "start onboarding first render"],
  ["RawBars reference", "The desugared core surface", "/rawbars", "rawbars core skeleton no sugar"],
  ["FullBars reference", "Handlebars-faithful surface", "/fullbars", "fullbars handlebars auto-escape paths"],
  ["MaxBars reference", "Operators, pipes — the flagship", "/maxbars", "maxbars operators pipes infix"],
  ["MinBars / Mustache reference", "Mustache-compatible surface", "/minbars", "minbars mustache sections set delimiters"],
  ["Truthiness portability", "Analyse mode", "/analyse", "analyse analyze truthiness portability ambiguous"],
  ["Linting & migration", "flatbars lint + migrate", "/lint", "lint migrate canonical alias"],
  ["Localization (i18n)", "Blessed i18n ops", "/localize", "localize i18n intl translate locale plural"],
  ["Data shaping (JSONata)", "Reshape data before render", "/transform", "transform jsonata data reshape"],
  ["FlatBars Lab", "The interactive playground", "/lab/", "lab playground editor try compile"],
];
for (const [title, sub, url, terms] of TUTORIAL_PAGES) push("page", title, sub, url, terms);

// ── spec pages (titles from frontmatter; routes from the file tree) ─────────────
const specDocs = resolve(root, "spec", "src", "content", "docs");
const walkMdx = (dir, rel = "") => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) walkMdx(resolve(dir, ent.name), `${rel}${ent.name}/`);
    else if (ent.name.endsWith(".mdx") && !rel.startsWith("adr/")) {
      const slug = ent.name === "index.mdx" ? rel : `${rel}${ent.name.replace(/\.mdx$/, "")}/`;
      const title = frontTitle(readFileSync(resolve(dir, ent.name), "utf8")) || slug;
      push("page", title, "Spec", `/spec/${slug}`, "spec specification normative");
    }
  }
};
walkMdx(specDocs);

// ── ADRs (title from frontmatter; slug = filename) ──────────────────────────────
const adrDir = resolve(specDocs, "adr");
for (const f of readdirSync(adrDir).filter((f) => /^adr-\d{4,}-[a-z0-9-]+\.mdx$/.test(f)).sort()) {
  const title = frontTitle(readFileSync(resolve(adrDir, f), "utf8")) || f;
  push("adr", title, "Architecture decision", `/spec/adr/${f.replace(/\.mdx$/, "")}/`, "adr decision record");
}

// ── prelude operations (operations.json) ────────────────────────────────────────
const ops = JSON.parse(read("editors/operations.json")).operations;
for (const o of ops) {
  push("op", o.name, `${o.kind} · ${o.doc}`, "/spec/engine/prelude/", `operation helper ${o.kind} ${o.arity}`);
}

// ── surfaces + their syntax deltas (surface-syntax.json) ────────────────────────
const surfaces = JSON.parse(read("shared/surface-syntax.json")).surfaces;
for (const s of surfaces) {
  push("surface", s.label, s.tagline, s.route, `dialect surface ${s.id} truthiness ${s.truthiness.rule}`);
  for (const r of s.rows) {
    push("feature", `${r.feature} — ${s.label}`, r.syntax, `${s.route}#reference`, `${s.id} ${r.note}`);
  }
}

// ── runnable examples (the dialect example modules) → their reference page ──────
const EXAMPLE_MODULES = [
  ["rawbars", "/rawbars", "RawBars"],
  ["fullbars", "/fullbars", "FullBars"],
  ["maxbars", "/maxbars", "MaxBars"],
  ["mustache", "/minbars", "MinBars"],
];
const examples = await Promise.all(
  EXAMPLE_MODULES.map(async ([mod, route, label]) => {
    const { examples: ex } = await import(`../tutorials/src/${mod}.mjs`);
    return Object.keys(ex).map((id) => push("example", `${humanize(id)} example`, `${label} runnable example`, route, `${label.toLowerCase()} example ${id.toLowerCase()}`));
  }),
);

// ── deep-link integrity for the curated tutorial routes ─────────────────────────
for (const [, , url] of TUTORIAL_PAGES) {
  if (url === "/" || url === "/lab/") continue; // index.astro / the static Lab
  const page = resolve(root, "tutorials", "src", "pages", url.replace(/^\//, "") + ".astro");
  if (!existsSync(page)) {
    console.error(`✗ search-index: page route ${url} has no tutorial page (${url.replace(/^\//, "")}.astro).`);
    process.exit(1);
  }
}

const text = JSON.stringify({ _generated: "by scripts/gen-search-index.mjs — do not edit; run `npm run gen:search-index`", entries }, null, 0) + "\n";

if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch {}
  if (cur !== text) {
    console.error("✗ tutorials/public/search-index.json is stale.\n  Run `npm run gen:search-index` and commit the result.");
    process.exit(1);
  }
  console.log(`✓ search-index current — ${entries.length} entries`);
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  const by = entries.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {});
  console.log(`✓ wrote tutorials/public/search-index.json — ${entries.length} entries`, by);
}
