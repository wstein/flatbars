// SPDX-License-Identifier: Apache-2.0
//
// Integration test for the Differential (Phase 7) — drives BOTH real engine providers
// (the PureScript oracle + the trussbars-wasm shipping engine, instantiated from the
// committed bytes) and asserts the verdict the panel would compute: a conformant
// template renders byte-identically (match), and a surface the candidate doesn't target
// is n/a (not a false divergence). Run: node lab/app/dock/differential-engines.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import init, { render, version } from "../../vendor/trussbars-engine.js";
import { oracleProvider } from "../engines/registry.mjs";
import { trussbarsProvider, __setWasmApi } from "../engines/trussbars.mjs";
import { verdictOf } from "./differential.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(resolve(here, "../../vendor/trussbars-engine_bg.wasm"));
__setWasmApi({ init: () => init({ module_or_path: wasmBytes }), render, version });

// Mirror the boot script's computeDifferential for one provider.
async function runThrough(provider, dialect, source, data) {
  try {
    const engine = await provider.create(dialect);
    const compiled = engine.compile(source, {}, { dialect });
    if (compiled.errors && compiled.errors.length) return { id: provider.id, error: compiled.errors[0].message };
    const out = engine.render(compiled.program, data);
    return { id: provider.id, output: typeof out === "string" ? out : out.output };
  } catch (err) {
    return { id: provider.id, error: (err && err.message) || String(err) };
  }
}

test("oracle and trussbars agree byte-for-byte on a conformant MaxBars template (verdict: match)", async () => {
  const src = "Hi {{ name }}! {{ name }}x{{ name }}";
  const data = { name: "Ada" };
  const ref = await runThrough(oracleProvider, "maxbars", src, data);
  const cand = await runThrough(trussbarsProvider, "maxbars", src, data);
  assert.equal(ref.output, "Hi Ada! AdaxAda");
  assert.equal(cand.output, ref.output, "trussbars matches the oracle reference");
  assert.equal(verdictOf(ref, cand), "match");
});

test("a surface trussbars does not target is n/a, not a false divergence", async () => {
  // ClassicBars {{#if}} block — the trussbars native grammar doesn't parse it, so the
  // candidate errors; the panel classifies that as n/a (the dialect boundary).
  const src = "{{#if on}}yes{{/if}}";
  const data = { on: true };
  const ref = await runThrough(oracleProvider, "classicbars", src, data);
  const cand = await runThrough(trussbarsProvider, "classicbars", src, data);
  assert.equal(ref.output, "yes");
  assert.ok(cand.error, "trussbars reports a parse error on the ClassicBars block");
  assert.equal(verdictOf(ref, cand), "na");
});
