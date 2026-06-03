// SPDX-License-Identifier: Apache-2.0
//
// Benchmark: the standalone `purescript-parsing` spike (FlatBars.Lab.Lexer)
// vs. the incumbent index-slicing scanner (FlatBars.Lexer), on a realistic
// template at several sizes. Imports both from `output/` (the spago build
// product), like the other Node harnesses — run `spago build` first.
//
//   node packages/lexer-lab/bench.mjs
//
// NB: not an apples-to-apples token model (the spike emits a finer-grained,
// trivia-carrying stream; the incumbent emits opaque-interior RawToks). This
// measures end-to-end scan throughput on the same bytes, which is the figure
// that gates adoption (README L4).

import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = (m) => resolve(here, "../../output", m, "index.js");

const spike = await import(out("FlatBars.Lab.Lexer"));
const incumbent = await import(out("FlatBars.Lexer"));
const token = await import(out("FlatBars.Token"));

// Curried PureScript entry points.
const lexSpike = spike.tokenize(spike.defaultLexConfig);
const lexL1 = incumbent.tokenizeTemplate(incumbent.defaultLexConfig);
const lexInterior = token.tokenizeInterior(token.defaultLexOptions);

// The incumbent's FULL pipeline: the level-1 structural scan, then the level-2
// interior lexer over each tag's interior text — the same total work the spike
// does in one pass. Where the interior (`base`, `text`) lives depends on the
// RawTok constructor; comments/content/set-delim/raw-fence carry nothing to
// re-lex (the spike doesn't tokenize those interiors either).
function incumbentFull(input) {
  const r = lexL1(input);
  const toks = r.value0;
  if (!Array.isArray(toks)) throw new Error("L1 returned Left");
  let count = 0;
  for (const t of toks) {
    const n = t.constructor.name;
    let base, text;
    if (n === "ROpen" || n === "RRaw") {
      base = t.value2;
      text = t.value3;
    } else if (n === "ROutput" || n === "RAmp" || n === "RSep" || n === "RClose") {
      base = t.value1;
      text = t.value2;
    } else {
      count += 1; // RContent / RComment / RSetDelim / RLongComment
      continue;
    }
    const ir = lexInterior(base)(text);
    if (!Array.isArray(ir.value0)) throw new Error("L2 returned Left on: " + text);
    count += 1 + ir.value0.length;
  }
  return count;
}

// Three ~50 KiB corpus profiles, because tokenizer throughput is dominated by
// tag *density*, not byte count:
//   • ocean — pure host text, no tags (measures the raw scan / ocean skip)
//   • prose — realistic: mostly text with the odd interpolation (~1 tag/90 B)
//   • dense — pathological: nothing but tags (~1 tag/6 B), the worst case
// All three are valid for both lexers (neither returns Left).
const TARGET = 50_000;
const rep = (s) => s.repeat(Math.ceil(TARGET / s.length));
const CORPORA = {
  ocean: rep("Lorem ipsum dolor sit amet consectetur adipiscing elit sed do. "),
  prose: rep("Lorem ipsum dolor sit amet, consectetur adipiscing elit. {{name}} "),
  dense: rep("{{a}}{{b.c}}{{#x}}{{y}}{{/x}}"),
};

// Force the result and return a cheap checksum so the work can't be elided.
function force(either) {
  // Right is `{ value0: Array }`, Left is `{ value0: error }`.
  const v = either.value0;
  if (Array.isArray(v)) return v.length;
  throw new Error("lexer returned Left: " + JSON.stringify(v));
}

// `run` returns a checksum (token count) so the work can't be elided.
function bench(run, input) {
  for (let i = 0; i < 5; i++) run(input); // warm up the JIT
  let iters = 0;
  let acc = 0;
  const t0 = performance.now();
  let elapsed = 0;
  do {
    acc += run(input);
    iters++;
    elapsed = performance.now() - t0;
  } while (elapsed < 750);
  const perIter = elapsed / iters;
  return { perIter, mbPerSec: input.length / 1e6 / (perIter / 1e3), tokens: acc / iters };
}

console.log(`FlatBars FULL-pipeline benchmark — spike vs. incumbent (node ${process.version})\n`);
console.log("Spike: single-pass full tokenization. Incumbent-L1: structural scan only");
console.log("(interiors opaque). Incumbent-full: L1 + level-2 interior lexer = same work.\n");
console.log("profile  bytes   incumbent-L1   incumbent-full  spike          full÷spike");
console.log("───────  ──────  ─────────────  ──────────────  ─────────────  ──────────");

for (const [name, input] of Object.entries(CORPORA)) {
  force(lexSpike(input)); // sanity: all succeed
  force(lexL1(input));
  incumbentFull(input);
  const l1 = bench((x) => force(lexL1(x)), input);
  const full = bench(incumbentFull, input);
  const s = bench((x) => force(lexSpike(x)), input);
  const mb = (b) => `${b.mbPerSec.toFixed(1).padStart(5)} MB/s`;
  const ratio = (full.perIter / s.perIter).toFixed(2);
  console.log(
    `${name.padEnd(7)}  ${String(input.length).padStart(6)}  ${mb(l1)}     ${mb(full)}      ${mb(s)}     ${ratio}×`,
  );
}
