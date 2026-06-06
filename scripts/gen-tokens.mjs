// SPDX-License-Identifier: Apache-2.0
//
// Single-source the seven-family syntax palette: read the canonical values from
// `shared/flatbars-tokens.css` and write them into the fenced `@palette` regions
// of the two consumers — `tutorials/src/styles/lab-tokens.css` (Astro bundles it)
// and `lab/index.html` (the static Lab inlines it). The consumers keep their own
// surrounding selectors and chip/`.cm-hb-*` rules; only the token VALUES are
// generated, so the legend can never drift from the examples.
//
//   node scripts/gen-tokens.mjs            # write the copies
//   node scripts/gen-tokens.mjs --check    # fail (exit 1) if any copy is stale
//
// This mirrors the repo's "generated, not asserted" gates (check:catalog,
// check:conformance): one editable source, gated copies. Run `npm run gen:tokens`
// after editing the shared file; `npm run check:tokens` is wired into `npm test`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "shared/flatbars-tokens.css";
const TARGETS = ["tutorials/src/styles/lab-tokens.css", "lab/index.html"];
const check = process.argv.includes("--check");

// Extract the `--name: value;` declarations from a `selector { … }` block.
function blockDecls(css, selector) {
  const re = new RegExp(selector.replace(/[[\]"]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}");
  const m = css.match(re);
  if (!m) throw new Error(`gen-tokens: ${SOURCE} is missing a \`${selector}\` block`);
  const decls = [];
  for (const line of m[1].split("\n")) {
    const d = line.match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (d) decls.push([d[1].trim(), d[2].trim()]);
  }
  return decls;
}

const src = readFileSync(resolve(root, SOURCE), "utf8");
const palette = { light: blockDecls(src, ":root"), dark: blockDecls(src, '[data-theme="dark"]') };

// Replace the body of a `/* @palette <mode> … */ … /* @palette end */` fence with
// the source declarations, indented to match the opening marker.
function fill(content, file) {
  let out = content;
  for (const mode of ["light", "dark"]) {
    const re = new RegExp(
      `([ \\t]*)/\\* @palette ${mode}\\b[^\\n]*\\*/\\n[\\s\\S]*?\\n([ \\t]*)/\\* @palette end \\*/`,
    );
    const m = out.match(re);
    if (!m) throw new Error(`gen-tokens: ${file} is missing the \`@palette ${mode}\` fence`);
    const indent = m[1];
    const body = palette[mode].map(([n, v]) => `${indent}${n}: ${v};`).join("\n");
    out = out.replace(
      re,
      `${indent}/* @palette ${mode} · generated from ${SOURCE} — edit there, run \`npm run gen:tokens\` */\n` +
        `${body}\n${m[2]}/* @palette end */`,
    );
  }
  return out;
}

let stale = 0;
for (const file of TARGETS) {
  const path = resolve(root, file);
  const before = readFileSync(path, "utf8");
  const after = fill(before, file);
  if (before === after) continue;
  stale++;
  if (check) console.error(`✗ ${file} — palette is stale (run \`npm run gen:tokens\`)`);
  else {
    writeFileSync(path, after);
    console.log(`✓ wrote ${file}`);
  }
}

// Verbatim copies: a consumer that can't fence the tokens into its own file gets a
// whole generated copy instead. The Starlight spec site loads the palette as a
// standalone stylesheet via its `customCss` (spec/astro.config.mjs).
const COPIES = ["spec/src/styles/flatbars-tokens.css"];
const banner = `/* @generated from ${SOURCE} by \`npm run gen:tokens\` — do not edit. */\n`;
const copyBody = banner + src;
for (const file of COPIES) {
  const path = resolve(root, file);
  let before = "";
  try { before = readFileSync(path, "utf8"); } catch {}
  if (before === copyBody) continue;
  stale++;
  if (check) console.error(`✗ ${file} — palette copy is stale (run \`npm run gen:tokens\`)`);
  else {
    writeFileSync(path, copyBody);
    console.log(`✓ wrote ${file}`);
  }
}

const consumers = TARGETS.length + COPIES.length;
if (check) {
  if (stale) {
    console.error(`check:tokens: ${stale} file(s) drifted from ${SOURCE}.`);
    process.exit(1);
  }
  console.log(`✓ palette current — ${consumers} consumer(s) match ${SOURCE}`);
} else if (!stale) {
  console.log("✓ palette already current — nothing to write");
}
