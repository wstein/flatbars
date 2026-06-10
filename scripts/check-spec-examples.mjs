// SPDX-License-Identifier: Apache-2.0
//
// Render-check the spec's dialect-tagged fenced examples through the REAL engine, so
// a stale surface form can't silently drift past the docs (the maxbars.mdx rot of
// 2026-06: the whole reference showed pre-statement-tag `{{#each}}`/`{{#with}}`/… that
// the engine now rejects, because fenced examples were only MDX-validity-checked,
// never executed). This gate compiles every ```maxbars / ```rawbars / ```classicbars
// / ```handlebars / ```minbars / ```mustache block via its declared dialect's
// COMPILER (parse → desugar → surface-strict → emit). Compile needs no data and
// tolerates unknown helpers/partials, so the ONLY failures are parse errors /
// `DisallowedShape` — i.e. syntax invalid for the declared dialect (the drift signal).
//
// Imports the spago build product (`output/`), so it always checks current source —
// run `npm run build` first. A fence may opt out with a `{/* spec-example: skip */}`
// MDX comment on the line directly above it (for an intentional fragment).
//
//   node scripts/check-spec-examples.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const enginePath = resolve(root, "output/ClassicBars.JS/index.js");
if (!existsSync(enginePath)) {
  console.error("error: output/ not found — run `npm run build` first.");
  process.exit(2);
}
const E = await import(enginePath);

// Fenced language → the dialect's compiler (parse + desugar + strict-check + emit, no
// data). Languages not here (text/haskell/purescript/json/mermaid/js/sh) are skipped.
const COMPILE = {
  maxbars: E.compileMaxbars,
  rawbars: E.compile,
  classicbars: E.compileSurface,
  handlebars: E.compileSurface, // the `handlebars` fence label = the ClassicBars surface
  minbars: E.compileMinbars,
  mustache: E.compileMinbars,
};

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir)) {
    const p = resolve(dir, ent);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".mdx") || p.endsWith(".md")) out.push(p);
  }
  return out;
}

const docsDir = resolve(root, "spec/src/content/docs");
// ADRs are POINT-IN-TIME decision records — their fenced examples legitimately show
// the surface of their era (e.g. ADR-0024 shows the since-retired `{{#let}}`), and the
// ADR-0039 plan is to give superseded ADRs forward-pointers, not rewrites. Forcing the
// current surface on them would be revisionist, so the gate checks the MAINTAINED
// reference docs (engine/*, concepts, guides) — where drift is an actual bug.
const files = walk(docsDir).filter((f) => !f.includes("/adr/"));

let checked = 0;
const failures = [];

for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^```([a-z]+)\s*$/);
    if (!m || !(m[1] in COMPILE)) continue;
    // opt-out: an MDX comment `{/* spec-example: skip */}` on the preceding line.
    if (i > 0 && /spec-example:\s*skip/.test(lines[i - 1])) {
      // still consume the block so its closing fence isn't re-scanned
    }
    const lang = m[1];
    const start = i + 1;
    let j = start;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    const code = lines.slice(start, j).join("\n");
    i = j; // advance past the block
    if (i > start && /spec-example:\s*skip/.test(lines[start - 2] ?? "")) continue;
    let r;
    try {
      r = COMPILE[lang](code);
    } catch (e) {
      r = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    checked++;
    if (!r || !r.ok) {
      failures.push({
        file: f.replace(root + "/", ""),
        line: start, // 1-based line of the fence's first code line
        lang,
        error: String((r && r.error) || "compile returned no result").split("\n")[0],
        snippet: code.trim().split("\n")[0].slice(0, 72),
      });
    }
  }
}

if (failures.length) {
  console.error(
    `✗ check:spec-examples — ${failures.length} of ${checked} dialect-tagged spec example(s) do NOT compile in their declared dialect:`,
  );
  for (const x of failures) {
    console.error(`  ${x.file}:${x.line} [${x.lang}] ${x.error}`);
    console.error(`      ${JSON.stringify(x.snippet)}`);
  }
  console.error(
    "\nFix the example to the dialect's current surface, correct the fence language, or " +
      "(for an intentional fragment) add `{/* spec-example: skip */}` on the line above the fence.",
  );
  process.exit(1);
}
console.log(`✓ check:spec-examples — ${checked} dialect-tagged spec examples compile in their declared dialect`);
