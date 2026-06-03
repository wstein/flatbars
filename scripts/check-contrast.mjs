// SPDX-License-Identifier: Apache-2.0
//
// Contrast gate (WCAG AA = 4.5:1 for this bold-mono ~13px text — NOT "large").
// The brief that introduced the Dracula/Alucard palette certified AA by hand and
// shipped a false claim (it measured against the wrong background); this makes
// the budget machine-checked so a palette change can never regress it silently.
//
// For every syntax-palette colour (read from the single source
// `shared/flatbars-tokens.css`), in light AND dark, assert ≥ 4.5:1 on:
//   • TINT   — the chip case: the colour over its own `color-mix(c, bg, tint-mix)`
//   • PAGE   — inline prose / untinted legend: the colour over the page `--bg`
//   • SOLID  — the solid-chip case: the chip text over the colour as a fill
// Page `--bg` is read from tutorials/src/styles/lab-tokens.css (the chrome source).
// Documented sub-AA values go in EXCEPTIONS with a reason (e.g. a Dracula token a
// product decision keeps muted). Wired into `npm test` as `check:contrast`.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// ── colour math ──
const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
// CSS `color-mix(in srgb, c p%, bg)` — linear interp of the gamma-encoded channels.
const mix = (c, bg, p) => toHex(hex(c).map((v, i) => v * p + hex(bg)[i] * (1 - p)));

// ── read the palette + the page background from their single sources ──
function blockDecls(css, selector) {
  const m = css.match(new RegExp(selector.replace(/[[\]"]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}"));
  const out = {};
  for (const line of (m ? m[1] : "").split("\n")) {
    const d = line.match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (d) out[d[1].trim()] = d[2].trim();
  }
  return out;
}
const tokensCss = read("shared/flatbars-tokens.css");
const chromeCss = read("tutorials/src/styles/lab-tokens.css");

const MODES = {
  light: { tokens: blockDecls(tokensCss, ":root"), bg: blockDecls(chromeCss, ":root")["--bg"], solidText: "#ffffff" },
  dark: {
    tokens: blockDecls(tokensCss, '[data-theme="dark"]'),
    bg: blockDecls(chromeCss, '[data-theme="dark"]')["--bg"],
    solidText: "#0e0c16",
  },
};

// The seven tag families take TINT + PAGE + SOLID (each tag is coloured as one
// span by its meaning; there are no separate interior-ink tokens).
const FAMILIES = ["--c-expr", "--c-raw", "--c-block", "--c-partial", "--c-inherit", "--c-delim", "--c-comment"];

// Documented, product-approved sub-AA exceptions: `${token} ${mode} ${surface}` → reason.
const EXCEPTIONS = {
  // (none — the palette clears AA everywhere)
};

const AA = 4.5;
let fails = 0;
const rows = [];
for (const [mode, { tokens, bg, solidText }] of Object.entries(MODES)) {
  const tint = parseFloat(tokens["--tint-mix"]) / 100;
  for (const tok of FAMILIES) {
    const c = tokens[tok];
    const checks = [
      ["tint", ratio(c, mix(c, bg, tint))],
      ["page", ratio(c, bg)],
      ["solid", ratio(solidText, c)],
    ];
    for (const [surface, r] of checks) rows.push({ tok, mode, surface, r });
  }
}

for (const { tok, mode, surface, r } of rows) {
  const key = `${tok} ${mode} ${surface}`;
  const ok = r >= AA;
  const excused = key in EXCEPTIONS;
  if (!ok && !excused) {
    fails++;
    console.error(`✗ ${key.padEnd(28)} ${r.toFixed(2)}:1  < ${AA} (WCAG AA)`);
  } else if (!ok && excused) {
    console.warn(`⚠ ${key.padEnd(28)} ${r.toFixed(2)}:1  (documented exception: ${EXCEPTIONS[key]})`);
  }
}

const worst = Math.min(...rows.filter((x) => !(`${x.tok} ${x.mode} ${x.surface}` in EXCEPTIONS)).map((x) => x.r));
if (fails) {
  console.error(`\ncheck:contrast: ${fails} token/surface pair(s) below WCAG AA (4.5:1).`);
  process.exit(1);
}
console.log(
  `✓ check:contrast — ${rows.length} token×surface pairs clear WCAG AA (worst ${worst.toFixed(2)}:1)` +
    (Object.keys(EXCEPTIONS).length ? `, ${Object.keys(EXCEPTIONS).length} documented exception(s)` : ""),
);
