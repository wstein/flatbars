#!/usr/bin/env node
// `trussbars infer` — Trussbars docs/03 schema inference, L1 (PureScript engine,
// the prototype of the G2 Rust tool that will replace ctxgen.mjs). Imports the
// `inferMaxbars` facade from `output/` (run `npx spago build` first).
//
//   node infer.mjs <template-file> [data.json]   infer one template (+ sample)
//   node infer.mjs --corpus                       coverage over cases.mjs
//   --strict                                      exit non-zero if conflicts > 0
//
// Output: the Rust context type(s), a JSON data scaffold, and a report.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = resolve(here, "../..", "output/ClassicBars.JS/index.js");
const { inferMaxbars, inferMaxbarsData } = await import(enginePath);

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const args = argv.filter((a) => a !== "--strict");

if (args[0] === "--corpus") {
  const { cases } = await import(resolve(here, "cases.mjs"));
  let withSchema = 0;
  let conflicts = 0;
  let withData = 0;
  for (const c of cases) {
    const r = c.data ? inferMaxbarsData(c.template, c.data) : inferMaxbars(c.template);
    if (r.ok && r.schema.includes("struct")) withSchema++;
    if (c.data) withData++;
    if (r.ok) conflicts += r.conflicts;
  }
  console.log(`schema inference over ${cases.length} corpus templates (template-symbolic L1):`);
  console.log(`  ${withSchema} produced a struct schema · ${withData} had sample data · ${conflicts} total conflicts`);
  console.log(`  (the Rust port — \`trussbars infer\` native — is docs/13 G2; it supersedes ctxgen.mjs)`);
  if (strict && conflicts > 0) {
    console.error(`infer --strict: ${conflicts} type conflict(s) across the corpus`);
    process.exit(1);
  }
  process.exit(0);
}

if (args.length === 0) {
  console.error("usage: node infer.mjs [--strict] <template-file> [data.json]   |   node infer.mjs [--strict] --corpus");
  process.exit(2);
}

const template = readFileSync(args[0], "utf8");
const data = args[1] ? JSON.parse(readFileSync(args[1], "utf8")) : null;
const r = data ? inferMaxbarsData(template, data) : inferMaxbars(template);

if (!r.ok) {
  console.error("infer error: " + r.error);
  process.exit(1);
}

console.log(r.report.split("\n").map((l) => (l ? "// " + l : "//")).join("\n"));
console.log();
console.log(r.schema);
console.log();
console.log("// data scaffold (" + (args[1] ? "refined by " + args[1] : "no data — bare outputs are guessed String") + "):");
console.log(r.dataScaffold);

if (strict && r.conflicts > 0) {
  console.error(`\ninfer --strict: ${r.conflicts} type conflict(s) — a path is used at two incompatible types.`);
  process.exit(1);
}
