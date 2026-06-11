// SPDX-License-Identifier: Apache-2.0
//
// Tests for the engine registry (Phase 2). Verifies the provider axis + that the
// oracle provider yields the frozen Engine seam. Run:
// node lab/app/engines/registry.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { oracleProvider, getProvider, registerProvider, listProviders } from "./registry.mjs";

const SEAM = [
  "render", "compile", "compileToJs", "parseAst", "inspectAt",
  "usedTransformers", "requiredAssigns", "partialGraph",
  "analyze", "analyzeWith", "lint", "migrate",
  "allTransformers", "catalog", "engineInfo", "version",
];

test("the oracle provider is registered + advertises its identity", () => {
  assert.equal(oracleProvider.id, "oracle");
  assert.equal(oracleProvider.kind, "reference");
  assert.equal(getProvider(), oracleProvider); // default id
  assert.equal(getProvider("oracle"), oracleProvider);
  assert.ok(listProviders().includes(oracleProvider));
});

test("getProvider throws on an unknown id", () => {
  assert.throws(() => getProvider("nope"), /unknown engine provider: nope/);
});

test("the oracle provider's create() returns the FROZEN Engine seam", async () => {
  const engine = await oracleProvider.create("classicbars");
  for (const m of SEAM) assert.ok(m in engine, `Engine seam missing: ${m}`);
  // the capability vector is honest (an array of features)
  const info = engine.engineInfo();
  assert.ok(Array.isArray(info.features));
  assert.match(info.version, /\d+\.\d+/);
});

test("registerProvider adds a citizen; bad providers are rejected", () => {
  const stub = { id: "stub", label: "Stub", kind: "shipping", create: () => ({}) };
  registerProvider(stub);
  assert.equal(getProvider("stub"), stub);
  assert.ok(listProviders().some((p) => p.id === "stub"));
  assert.throws(() => registerProvider({ id: "x" }), /needs an `id` and a `create/);
  assert.throws(() => registerProvider(null), /needs an `id`/);
});
