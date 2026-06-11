#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Build the Trussbars engine to WebAssembly for the FlatBars Lab's `trussbars`
// engine citizen (PLAN-registry-local-trussbars.md, Phase 4 — the check:bundle analog
// for the wasm artifact). Like `gen:bundle`, this is the reproducible source of the
// committed `lab/vendor/trussbars-engine.{js,_bg.wasm}` artifacts:
//
//   1. cargo build -p trussbars-wasm --release --target wasm32-unknown-unknown
//   2. wasm-bindgen --target web → glue .js + processed _bg.wasm in lab/vendor/
//   3. content-stamp the glue's `new URL('…_bg.wasm', import.meta.url)` with the
//      wasm's sha8 so a rebuilt engine busts the browser cache (the glue's own hash
//      then propagates through scripts/hash-lab.mjs to its importer).
//
// Requires the wasm32-unknown-unknown target + wasm-bindgen on PATH (as gen:bundle
// requires esbuild). NOT wired into `npm test` — it is a local regenerator; the
// committed artifacts are what CI consumes (hash-lab keeps their ?v= honest).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trussbars = resolve(root, "trussbars");
const vendor = resolve(root, "lab/vendor");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

console.log("gen:trussbars-wasm — cargo build (wasm32-unknown-unknown, release)…");
run("cargo", ["build", "-p", "trussbars-wasm", "--release", "--target", "wasm32-unknown-unknown"], trussbars);

console.log("gen:trussbars-wasm — wasm-bindgen (target web)…");
run("wasm-bindgen", [
  "--target", "web", "--no-typescript",
  "--out-dir", vendor, "--out-name", "trussbars-engine",
  resolve(trussbars, "target/wasm32-unknown-unknown/release/trussbars_wasm.wasm"),
]);

// Content-stamp the glue's wasm URL: `new URL('trussbars-engine_bg.wasm', import.meta.url)`
// drops any query off import.meta.url, so the wasm fetch is otherwise uncacheable-busting.
const wasmPath = resolve(vendor, "trussbars-engine_bg.wasm");
const gluePath = resolve(vendor, "trussbars-engine.js");
const wasmHash = createHash("sha256").update(readFileSync(wasmPath)).digest("hex").slice(0, 8);
const glue = readFileSync(gluePath, "utf8");
const stamped = glue.replace(
  /new URL\('trussbars-engine_bg\.wasm(?:\?v=[0-9a-f]+)?', import\.meta\.url\)/,
  `new URL('trussbars-engine_bg.wasm?v=${wasmHash}', import.meta.url)`,
);
if (stamped === glue && !glue.includes(`?v=${wasmHash}`)) {
  console.error("gen:trussbars-wasm: could not stamp the wasm URL in the glue (wasm-bindgen output changed shape?)");
  process.exit(1);
}
writeFileSync(gluePath, stamped);
console.log(`gen:trussbars-wasm — stamped glue → trussbars-engine_bg.wasm?v=${wasmHash}`);
console.log("gen:trussbars-wasm — done. Run `npm run gen:lab-hashes` to propagate the glue hash to its importer.");
