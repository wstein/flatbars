// SPDX-License-Identifier: Apache-2.0
//
// Single-source the design tokens. Two canonical sources feed fenced regions in
// the consumers, so the tutorials, the Starlight spec and the static Lab can't
// drift on either the syntax palette or the chrome:
//   • `shared/flatbars-tokens.css`  → the seven-family `@palette` region (--c-*)
//   • `shared/flatbars-chrome.css`  → the `@chrome` region (palette / IBM Plex /
//                                      violet accent / light+dark, the topbar reads it)
// Only the token VALUES are generated; the consumers keep their own surrounding
// selectors, IDE-specific tokens and class rules.
//
//   node scripts/gen-tokens.mjs            # write the copies
//   node scripts/gen-tokens.mjs --check    # fail (exit 1) if any copy is stale
//
// This mirrors the repo's "generated, not asserted" gates (check:catalog,
// check:conformance): editable sources, gated copies. Run `npm run gen:tokens`
// after editing a shared file; `npm run check:tokens` is wired into `npm test`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

// Each kind = a fenced region name → its canonical source file.
const SOURCES = {
  palette: "shared/flatbars-tokens.css",
  chrome: "shared/flatbars-chrome.css",
};
// Consumers that fence the tokens into their own file (both regions in each).
const TARGETS = ["tutorials/src/styles/lab-tokens.css", "lab/index.html"];
// Consumers that can't fence the tokens (the Starlight spec loads stylesheets via
// `customCss`): a whole generated copy of each source instead.
const COPIES = {
  "spec/src/styles/flatbars-tokens.css": "shared/flatbars-tokens.css",
  "spec/src/styles/flatbars-chrome.css": "shared/flatbars-chrome.css",
};

// Extract the `--name: value;` declarations from a `selector { … }` block.
function blockDecls(css, selector, srcPath) {
  const re = new RegExp(selector.replace(/[[\]"]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}");
  const m = css.match(re);
  if (!m) throw new Error(`gen-tokens: ${srcPath} is missing a \`${selector}\` block`);
  const decls = [];
  for (const line of m[1].split("\n")) {
    const d = line.match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (d) decls.push([d[1].trim(), d[2].trim()]);
  }
  return decls;
}

// Read every source's light (:root) + dark ([data-theme="dark"]) declarations.
const blocks = {};
for (const [kind, srcPath] of Object.entries(SOURCES)) {
  const css = readFileSync(resolve(root, srcPath), "utf8");
  blocks[kind] = {
    src: srcPath,
    light: blockDecls(css, ":root", srcPath),
    dark: blockDecls(css, '[data-theme="dark"]', srcPath),
  };
}

// Replace the body of each `/* @<kind> <mode> … */ … /* @<kind> end */` fence with
// the source declarations, indented to match the opening marker.
function fill(content, file) {
  let out = content;
  for (const [kind, b] of Object.entries(blocks)) {
    for (const mode of ["light", "dark"]) {
      const re = new RegExp(
        `([ \\t]*)/\\* @${kind} ${mode}\\b[^\\n]*\\*/\\n[\\s\\S]*?\\n([ \\t]*)/\\* @${kind} end \\*/`,
      );
      const m = out.match(re);
      if (!m) throw new Error(`gen-tokens: ${file} is missing the \`@${kind} ${mode}\` fence`);
      const indent = m[1];
      const body = b[mode].map(([n, v]) => `${indent}${n}: ${v};`).join("\n");
      out = out.replace(
        re,
        `${indent}/* @${kind} ${mode} · generated from ${b.src} — edit there, run \`npm run gen:tokens\` */\n` +
          `${body}\n${m[2]}/* @${kind} end */`,
      );
    }
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
  if (check) console.error(`✗ ${file} — tokens are stale (run \`npm run gen:tokens\`)`);
  else {
    writeFileSync(path, after);
    console.log(`✓ wrote ${file}`);
  }
}

for (const [file, srcPath] of Object.entries(COPIES)) {
  const path = resolve(root, file);
  const copyBody =
    `/* @generated from ${srcPath} by \`npm run gen:tokens\` — do not edit. */\n` +
    readFileSync(resolve(root, srcPath), "utf8");
  let before = "";
  try { before = readFileSync(path, "utf8"); } catch {}
  if (before === copyBody) continue;
  stale++;
  if (check) console.error(`✗ ${file} — copy is stale (run \`npm run gen:tokens\`)`);
  else {
    writeFileSync(path, copyBody);
    console.log(`✓ wrote ${file}`);
  }
}

const consumers = TARGETS.length + Object.keys(COPIES).length;
if (check) {
  if (stale) {
    console.error(`check:tokens: ${stale} file(s) drifted from the shared token sources.`);
    process.exit(1);
  }
  console.log(`✓ tokens current — ${consumers} consumer(s) match the shared sources`);
} else if (!stale) {
  console.log("✓ tokens already current — nothing to write");
}
