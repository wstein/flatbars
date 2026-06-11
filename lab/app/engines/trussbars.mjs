// SPDX-License-Identifier: Apache-2.0
//
// The `trussbars` engine provider (Phase 4 of PLAN-registry-local-trussbars.md) —
// the SHIPPING engine citizen, the Rust Trussbars interpreter compiled to wasm
// (../../vendor/trussbars-engine.js + _bg.wasm, built by scripts/gen-trussbars-wasm.mjs).
// It runs in-page on both transports (decided 2026-06-11): one Trussbars render
// path everywhere, byte-identical to the native binary and the oracle.
//
// It targets the FROZEN Engine seam (../engines/contract.md) so it is a drop-in
// alongside the oracle — but it is honest about what it backs: its v1 feature vector
// is EMPTY (render-only). The capability gate then hides every analysis panel
// (Transformers, Data Access, Truthiness, Lint, Context Inspector, Compiled JS, …)
// with no UI change — those members exist on the seam but are inert stubs until the
// wasm engine grows the provenance / catalog / tooling surfaces (a fast-follow).

import init, { render as bgRender, version as bgVersion } from "../../vendor/trussbars-engine.js?v=f714f730";

// The wasm API, indirected so a test can inject a fake (the real `init()` fetches the
// `_bg.wasm` next to the glue — a browser-only path). Replace via `__setWasmApi`.
let api = { init, render: bgRender, version: bgVersion };
let ready = null;
let VERSION = "0";

// Test seam: inject a wasm API (e.g. one that instantiates from local bytes in Node).
export function __setWasmApi(custom) {
  api = custom;
  ready = null;
}

// Lazily instantiate the wasm module once (oracle first-paints; trussbars loads on
// demand). Idempotent — concurrent callers share the one in-flight promise.
async function ensureLoaded() {
  if (!ready) {
    ready = Promise.resolve(api.init ? api.init() : undefined).then(() => {
      VERSION = String(api.version ? api.version() : "0");
    });
  }
  await ready;
}

// The Lab dialect → the interpreter's truthiness policy (docs/16). The native family
// is NonEmpty; ClassicBars maps to Handlebars. (MinBars' mustache rule has no
// Trussbars mode — it renders under NonEmpty, flagged by the differential later.)
const DIALECT_TRUTH = {
  maxbars: "NonEmpty", rawbars: "NonEmpty", truss: "NonEmpty", django: "NonEmpty",
  core: "NonEmpty", classicbars: "Handlebars", minbars: "NonEmpty",
};
const truthFor = (dialect) => DIALECT_TRUTH[dialect] || "NonEmpty";

// Build the frozen Engine seam over the loaded wasm. `dialect` fixes the truthiness
// policy; `create()` (below) awaits the load so `render` here is synchronous, exactly
// like the oracle's — render.mjs calls it the same way.
function makeEngine(dialect) {
  // compile is a thin source envelope (like the oracle): the wasm re-parses on render.
  const compile = (source, partials = {}, opts = {}) => ({
    program: { source, dialect: opts.dialect || dialect, partials: partials || {} },
  });

  const render = (program, data, { map = false } = {}) => {
    let out;
    try {
      out = api.render(program.source, JSON.stringify(data == null ? {} : data), truthFor(program.dialect));
    } catch (e) {
      // The wasm throws a string (`line:col: …`); normalise to an Error so render.mjs
      // can read `.message` and lift the position into the Problems panel.
      throw new Error(typeof e === "string" ? e : e && e.message ? e.message : String(e));
    }
    return map ? { output: out, segments: [] } : out;
  };

  const unsupported = (what) => ({ ok: false, error: `trussbars-wasm (v1) does not back ${what}` });

  return {
    render,
    compile,
    // render-only v1: every member below the line is an inert, gated-off stub. They
    // exist because the seam is frozen; the empty feature vector hides their panels.
    compileToJs: () => unsupported("a JS compile target (it is the wasm render path)"),
    parseAst: () => ({ ast: null }),
    inspectAt: () => [],
    usedTransformers: () => [],
    requiredAssigns: () => [],
    partialGraph: () => ({ nodes: [], edges: [] }),
    analyze: () => ({ ok: true, findings: [] }),
    analyzeWith: () => ({ ok: true, findings: [] }),
    lint: () => ({ ok: true, findings: [] }),
    migrate: () => unsupported("Handlebars → MaxBars migration"),
    allTransformers: () => [],
    catalog: () => [],
    engineInfo: () => ({ version: VERSION, builtins: [], features: [] }),
    get version() { return VERSION; },
  };
}

// The EngineProvider (registered in ./registry.mjs). `create` is async — it awaits the
// one-time wasm instantiation, then returns the synchronous Engine seam.
export const trussbarsProvider = {
  id: "trussbars",
  label: "Trussbars (Rust/WASM)",
  kind: "shipping",
  async create(dialect, _opts) {
    await ensureLoaded();
    return makeEngine(dialect);
  },
};
