// SPDX-License-Identifier: Apache-2.0
//
// Minimal engine throughput benchmark — render renders/s and output MB/s for a
// few representative templates. NOT a gate (absolute numbers are machine- and
// load-dependent, so failing CI on them is noise); it is a runnable yardstick to
// catch a gross regression by eye, replacing the perf coverage the retired
// `lexer-lab` spike carried. Imports the spago build product (`output/`), so it
// always measures current source — run `npm run build` first.
//
//   npm run bench          # or: node scripts/bench-engine.mjs [budgetMs]
//
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = resolve(here, "../output/ClassicBars.JS/index.js");
if (!existsSync(enginePath)) {
  console.error("error: output/ not found — run `npm run build` first.");
  process.exit(2);
}
const E = await import(enginePath);

// Per-case wall-clock budget (ms): loop renders until it elapses, then report.
const BUDGET = Math.max(200, Number(process.argv[2]) || 1000);

const row = (n) => ({ name: "row" + n, score: n });
const cases = [
  {
    name: "plain (surface)",
    render: (t, d) => E.renderSurface(t, d),
    t: "Hello {{name}}, you have {{count}} messages and {{unread}} unread.",
    d: { name: "Ada", count: 5, unread: 2 },
  },
  {
    name: "loop 1k (maxbars)",
    render: (t, d) => E.renderMaxbars(t, d),
    t: "<ul>{{#each x in items}}<li>{{loop.index1}}: {{x.name}} = {{x.score}}{{#if x.score > 500}} *{{/if}}</li>{{/each}}</ul>",
    d: { items: Array.from({ length: 1000 }, (_, i) => row(i)) },
  },
  {
    name: "nested 100x10 (maxbars)",
    render: (t, d) => E.renderMaxbars(t, d),
    t: "{{#each r in rows label outer}}<tr>{{#each c in r}}<td>{{outer.index0}}:{{c}}</td>{{/each}}</tr>{{/each}}",
    d: { rows: Array.from({ length: 100 }, () => Array.from({ length: 10 }, (_, i) => "c" + i)) },
  },
  {
    name: "let + literals (maxbars)",
    render: (t, d) => E.renderMaxbars(t, d),
    // `let` (no re-root) + a glued list-of-dicts literal + each…in with a 1-based
    // index + the `..` range + arithmetic, over 200 iterations.
    t: "{{#let tiers=[{n: \"gold\", at: 3}, {n: \"silver\", at: 6}]}}{{#each t i in tiers}}<h>{{add i 1}}. {{t.n}}</h>{{#each k in 1..t.at}}<i>{{k}}</i>{{/each}}{{/each}}{{/let}}",
    d: {},
  },
];

console.log(`engine throughput (budget ${BUDGET}ms/case, ${process.version}):\n`);
for (const c of cases) {
  const first = c.render(c.t, c.d);
  if (!first.ok) {
    console.log(`  ${c.name.padEnd(26)} ERROR: ${String(first.error).split("\n")[0]}`);
    continue;
  }
  const bytes = first.value.length;
  for (let i = 0; i < 50; i++) c.render(c.t, c.d); // warm
  const start = performance.now();
  let iters = 0;
  while (performance.now() - start < BUDGET) {
    c.render(c.t, c.d);
    iters++;
  }
  const secs = (performance.now() - start) / 1000;
  const rps = iters / secs;
  const mbps = (bytes * iters) / secs / 1e6;
  console.log(
    `  ${c.name.padEnd(26)} ${rps.toFixed(0).padStart(8)} renders/s   ${mbps.toFixed(1).padStart(6)} MB/s out   (${bytes}B/render)`,
  );
}
