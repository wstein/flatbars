// SPDX-License-Identifier: Apache-2.0
//
// Tests for the trussbars-wasm provider (Phase 4). Drives the REAL wasm engine by
// instantiating it from the committed `_bg.wasm` bytes (the browser path fetches it;
// Node injects the bytes via __setWasmApi). Run: node lab/app/engines/trussbars.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import init, { render, version } from "../../vendor/trussbars-engine.js";
import { trussbarsProvider, __setWasmApi } from "./trussbars.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(resolve(here, "../../vendor/trussbars-engine_bg.wasm"));

// Inject a wasm API that instantiates from local bytes (no browser fetch).
__setWasmApi({ init: () => init({ module_or_path: wasmBytes }), render, version });

const SEAM = [
  "render", "compile", "compileToJs", "parseAst", "inspectAt",
  "usedTransformers", "requiredAssigns", "partialGraph",
  "analyze", "analyzeWith", "lint", "migrate",
  "allTransformers", "catalog", "engineInfo", "version",
];

test("the trussbars provider advertises shipping identity", () => {
  assert.equal(trussbarsProvider.id, "trussbars");
  assert.equal(trussbarsProvider.kind, "shipping");
  assert.match(trussbarsProvider.label, /Rust|WASM/i);
});

test("create() yields the FROZEN Engine seam", async () => {
  const e = await trussbarsProvider.create("maxbars");
  for (const m of SEAM) assert.ok(m in e, `seam missing: ${m}`);
});

test("the v1 feature vector is empty (render-only, honest)", async () => {
  const e = await trussbarsProvider.create("maxbars");
  const info = e.engineInfo();
  assert.deepEqual(info.features, []);
  assert.match(info.version, /\d+\.\d+/);
});

test("render() renders a native template against data (real wasm)", async () => {
  const e = await trussbarsProvider.create("maxbars");
  const { program } = e.compile("Hi {{ name }}!");
  assert.equal(e.render(program, { name: "Ada" }), "Hi Ada!");
});

test("render({map:true}) returns the {output, segments} shape render.mjs expects", async () => {
  const e = await trussbarsProvider.create("maxbars");
  const { program } = e.compile("x={{ n }}");
  assert.deepEqual(e.render(program, { n: 1 }, { map: true }), { output: "x=1", segments: [] });
});

test("a render/parse error throws an Error with the located message", async () => {
  const e = await trussbarsProvider.create("maxbars");
  const { program } = e.compile("{% for %}");
  assert.throws(() => e.render(program, {}), (err) => err instanceof Error && err.message.length > 0);
});

test("the inert stubs never throw (render.mjs calls some unconditionally)", async () => {
  const e = await trussbarsProvider.create("maxbars");
  const { program } = e.compile("x");
  assert.deepEqual(e.usedTransformers(program), []);
  assert.deepEqual(e.requiredAssigns(program), []);
  assert.deepEqual(e.catalog(), []);
  assert.equal(e.compileToJs("x").ok, false);
  assert.equal(e.migrate("x").ok, false);
});

test("null data renders as an empty object (no crash)", async () => {
  const e = await trussbarsProvider.create("rawbars");
  const { program } = e.compile("[{{ missing }}]");
  assert.equal(e.render(program, null), "[]");
});
