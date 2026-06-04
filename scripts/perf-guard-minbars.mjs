// SPDX-License-Identifier: Apache-2.0
//
// Coarse MinBars render perf guard (review follow-up P7). The unified tokenizer's
// one piece of *added* work is MinBars' standalone pass re-tokenizing the tags
// whose interior string it rewrites (partials / parents / override-blocks). This
// script renders a standalone-tag-heavy MinBars template many times and fails if
// the median per-iteration time regresses past a committed baseline by > the
// tolerance.
//
// ADVISORY, machine-dependent. Absolute-time perf gates are noisy across
// machines, so this is NOT in `npm test` — run it (`npm run perf:minbars`) in a
// consistent environment (a CI runner, or your own box vs. its own baseline).
// Update the baseline intentionally with `--update` when a change legitimately
// shifts it. Override with PERF_BASELINE_MS / PERF_TOLERANCE for a noisy host.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = resolve(here, "perf-minbars-baseline.json");
const { renderMinbars } = await import(resolve(here, "../lab/vendor/flatbars-engine.mjs"));

// A standalone-partial / standalone-section heavy template — every `{{> p}}`,
// `{{! … }}`, and block tag on its own indented line drives the standalone pass
// (and, for the partials, the re-tokenize). Repeated to dominate timing noise.
const UNIT = [
  "{{#rows}}",
  "  {{> row}}",
  "  {{! a standalone comment }}",
  "  {{<base}}",
  "    {{$cell}}{{value}}{{/cell}}",
  "  {{/base}}",
  "{{/rows}}",
  "",
].join("\n");
const TEMPLATE = UNIT.repeat(200);
const DATA = { rows: Array.from({ length: 8 }, (_, i) => ({ value: i })) };

const ITERS = 40;
const ROUNDS = 9;
const WARMUP = 30;

const once = () => renderMinbars(TEMPLATE, DATA);

// Sanity: it must actually render (a throw or hard error would void the timing).
try {
  once();
} catch (e) {
  console.error("perf-guard: renderMinbars threw — cannot measure:", e?.message ?? e);
  process.exit(2);
}

for (let i = 0; i < WARMUP; i++) once();

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const rounds = [];
for (let r = 0; r < ROUNDS; r++) {
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) once();
  rounds.push((performance.now() - t0) / ITERS);
}
const perIter = median(rounds);

const update = process.argv.includes("--update");
if (update) {
  writeFileSync(baselinePath, JSON.stringify({ perIterMs: Number(perIter.toFixed(4)), iters: ITERS, rounds: ROUNDS, template: "200×standalone-unit" }, null, 2) + "\n");
  console.log(`perf-guard: baseline updated → ${perIter.toFixed(3)} ms/iter`);
  process.exit(0);
}

const baseline = Number(process.env.PERF_BASELINE_MS) || JSON.parse(readFileSync(baselinePath, "utf8")).perIterMs;
// The review's *target* is +5%, but same-machine jitter alone is ~4% here, so a
// 5% gate false-alarms. Default to +10% — loose enough to ignore noise, tight
// enough to catch a real regression (a returning double-lex, an O(n²) re-tokenize
// are tens of %). Pin PERF_TOLERANCE=0.05 in a stable CI to enforce the target.
const tol = Number(process.env.PERF_TOLERANCE) || 0.1;
const ratio = perIter / baseline;

console.log(`perf-guard (MinBars standalone-heavy render):`);
console.log(`  median ${perIter.toFixed(3)} ms/iter  vs baseline ${baseline.toFixed(3)} ms/iter  (×${ratio.toFixed(3)}, tol +${(tol * 100).toFixed(0)}%)`);

if (ratio > 1 + tol) {
  console.error(`✘ perf-guard: ${((ratio - 1) * 100).toFixed(1)}% slower than baseline (> ${(tol * 100).toFixed(0)}%). Investigate, or re-baseline with --update if intended.`);
  process.exit(1);
}
console.log(`✓ perf-guard: within +${(tol * 100).toFixed(0)}% of baseline`);
