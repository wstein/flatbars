// SPDX-License-Identifier: Apache-2.0
//
// The engine registry (Phase 2 of PLAN-registry-local-trussbars.md) — the keystone
// that turns the Lab's single `createRenderer(dialect)` into a PROVIDER axis, so a
// second engine (trussbars-wasm, Phase 4) drops in without touching the loaders or
// any call site. Today the only registered provider is `oracle` (the PureScript
// flatbars-js reference engine); the differential view (Phase 7) compares providers.
//
//   EngineProvider = {
//     id:    "oracle" | "trussbars",
//     label: string,                 // shown in the UI engine/provider picker
//     kind:  "reference" | "shipping",
//     create(dialect, opts): Promise<Engine>,   // the FROZEN ADR-0020 Engine seam
//   }
//
// The Engine seam is FROZEN (see ./contract.md): every provider's create() returns
// the identical object shape — { render, compile, parseAst, inspectAt,
// usedTransformers, requiredAssigns, partialGraph, analyze, analyzeWith, lint,
// migrate, compileToJs, allTransformers, catalog, engineInfo, version }. A provider
// may advertise a SMALLER engineInfo().features vector; the capability gate then
// hides the panels it doesn't back (honest by construction).

import { createRenderer } from "../../renderer.mjs?v=448b21fb";

// The oracle provider — the PureScript flatbars-js engine, the spec/reference
// engine. create(dialect, opts) is the existing ADR-0020 factory, unchanged.
export const oracleProvider = {
  id: "oracle",
  label: "Reference (PureScript)",
  kind: "reference",
  create: (dialect, opts) => createRenderer(dialect, opts),
};

const PROVIDERS = new Map([[oracleProvider.id, oracleProvider]]);

// Register an engine provider (Phase 4: the trussbars-wasm citizen registers here).
export function registerProvider(provider) {
  if (!provider || typeof provider.id !== "string" || typeof provider.create !== "function") {
    throw new TypeError("an EngineProvider needs an `id` and a `create(dialect, opts)`");
  }
  PROVIDERS.set(provider.id, provider);
}

// Resolve a provider by id (default: the oracle). Throws on an unknown id.
export function getProvider(id = oracleProvider.id) {
  const p = PROVIDERS.get(id);
  if (!p) throw new Error(`unknown engine provider: ${id} (have: ${[...PROVIDERS.keys()].join(", ")})`);
  return p;
}

// Every registered provider (for the UI picker + the differential view).
export function listProviders() {
  return [...PROVIDERS.values()];
}
