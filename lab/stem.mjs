// SPDX-License-Identifier: Apache-2.0
//
// Glue for the wasm32-unknown-unknown `stem_native` module — no WASI, runs in
// the browser and in Node. Built on wasm-bindgen: JS values (objects/arrays)
// cross the boundary directly via serde-wasm-bindgen, with no hand-rolled
// JSON-string marshalling through linear memory.
//
// `createRenderer(wasmInput)` initialises the module (pass the
// `stem_native_bg.wasm` bytes, a URL, or a Response) and returns
// `compile(source, partials?, opts?)` (template text -> bytecode, fully backend-free)
// and `render(program, data)`.

import init, {
  compile as wasmCompile,
  render as wasmRender,
  parse_ast as wasmParseAst,
  inspect_at as wasmInspectAt,
  version as wasmVersion,
  used_transformers as wasmUsedTransformers,
  required_assigns as wasmRequiredAssigns,
  partial_graph as wasmPartialGraph,
  all_transformers as wasmAllTransformers,
  engine_info as wasmEngineInfo,
  catalog as wasmCatalog,
} from "./wasm/stem_native.js";

// ADR-0013: the engine policy the playground hands to the wasm-bindgen exports.
// `allow: null` is the unconstrained default ("every built-in is callable"),
// matching the BEAM `transformers:` default. `eval: true` admits the dynamic
// `eval` transformer — the playground author is trusted, so the cheat-sheet
// can demonstrate every built-in including eval. The wasm-bindgen `render` /
// `inspect_at` take this shape as a single JS object.
const PLAYGROUND_POLICY = { allow: null, eval: true };

// ADR-0020: the full, honest Stem capability vector (engine-features/v1). Each
// token gates an optional playground panel; the UI hides a panel whose required
// features are absent. Stem backs every capability natively, so under the Stem
// adapter no panel hides — which is exactly what proves the gate is inert
// before any thinner (e.g. Handlebars) adapter exists. See ADR-0020 for the
// per-feature registry and the future Handlebars vector.
const STEM_FEATURES = [
  "escape-modes",
  "eval-opt-in",
  "partials",
  "source-map",
  "standalone",
  "context-inspect",
  "bytecode-wire",
  "catalog",
  "used-transformers",
  "required-assigns",
  "partial-graph",
  "stem-allow-list",
];

// Normalise the per-call policy. `null`/`undefined` falls back to the
// playground default (every built-in allowed, `eval` on). Otherwise the policy
// MUST be the Stem-shaped ADR-0013 `{ allow, eval }` object this engine can
// enforce; per ADR-0020 (Phase 2) an adapter handed a policy shape it cannot
// enforce throws a typed `unsupported-policy` Error rather than silently
// accepting it — so a host policy authored for a different engine fails loud,
// never as a false "allowed". `allow` is a string array or null; `eval` is a
// boolean. Unknown keys mark a foreign (e.g. Handlebars knownHelpers) shape.
const STEM_POLICY_KEYS = new Set(["allow", "eval"]);
function asPolicy(arg) {
  if (arg == null) return PLAYGROUND_POLICY;
  const reject = (why) => {
    const err = new Error(`unsupported policy for the Stem engine: ${why}`);
    err.kind = "unsupported-policy";
    throw err;
  };
  if (typeof arg !== "object") reject("expected an { allow, eval } object");
  for (const key of Object.keys(arg)) {
    if (!STEM_POLICY_KEYS.has(key)) reject(`unknown key '${key}' (not an { allow, eval } policy)`);
  }
  if ("allow" in arg && arg.allow !== null && !Array.isArray(arg.allow)) {
    reject("'allow' must be a string array or null");
  }
  if ("eval" in arg && typeof arg.eval !== "boolean") reject("'eval' must be a boolean");
  return arg;
}

export async function createRenderer(wasmInput) {
  await init({ module_or_path: wasmInput });

  // Compile template source to a wire program with no backend. `partials` is an
  // optional `{ name: source }` map expanded inline at `{{> name}}` sites.
  // Returns `{ program }` on success, or `{ errors: [{ message, file, start,
  // end }] }` listing every recoverable parse error (unsupported constructs,
  // unknown or recursive partials, bad arguments) in source order — `file`
  // ("main" or a partial name) and the byte span let the editor open the right
  // tab and underline each offending tag. With `{ map: true }` the program
  // carries `src` provenance for a source map; the unmapped wire stays
  // byte-identical to the BEAM reference. Pass `{ standalone: false }` to opt
  // out of ADR-0016 standalone-tag line stripping (default: true).
  function compile(source, partials = {}, { map = false, standalone = true } = {}) {
    try {
      return { program: wasmCompile(source, partials, map, standalone) };
    } catch (thrown) {
      // The Rust side throws `{ errors: [{ message, start, end }, ...] }`.
      const errors = thrown && Array.isArray(thrown.errors) ? thrown.errors : [thrown];
      return { errors };
    }
  }

  // Render a compiled program against data. By default returns the output
  // string. With `{ map: true }` it returns `{ output, segments }`, where each
  // segment ties a byte run of the output back to its source: `{ out, len, file,
  // start?, end? }`. Mapped rendering needs a program compiled with
  // `compile(.., { map: true })`. `policy` overrides the ADR-0013 host policy
  // (`{ allow, eval }`); omit to use the playground default (every built-in
  // allowed, `eval` on).
  //
  // ADR-0020 (Phase 2) single-shape contract: under `{ map: true }` an adapter
  // ALWAYS returns `{ output, segments }`. An engine without the `source-map`
  // capability returns `segments: []` rather than switching to a bare string,
  // so the host's segment consumers degrade to "no provenance" instead of
  // breaking on a missing destructure. Stem backs `source-map`, so it populates
  // segments natively.
  //
  // On a refusal or runtime failure, throws a proper `Error` whose `.kind` is
  // either `"policy"` (allow-list / `eval` gate) or `"render"` (runtime
  // failure). Hosts catch the throw rather than parsing a sentinel out of the
  // output string.
  function render(
    program,
    data,
    { map = false, policy } = {},
  ) {
    try {
      return wasmRender(program, data, asPolicy(policy), map);
    } catch (raw) {
      // wasm-bindgen surfaces structured throws as plain JS objects with
      // `{ kind, message }`. Re-wrap as a proper `Error` so `.message` is the
      // standard property and the kind tag rides along for the host's
      // policy-vs-render badging.
      if (raw && typeof raw === "object" && typeof raw.message === "string") {
        const err = new Error(raw.message);
        err.kind = raw.kind || "render";
        throw err;
      }
      throw raw;
    }
  }

  // Parse one template's source to its pre-expansion AST (`stem-ast/v1`),
  // `{ version, nodes }`. Unlike `compile`, `{{> name}}` tags stay as `partial`
  // nodes (the dependency-graph edges) and every node carries its byte `src`
  // span. Returns `{ ast }` on success or `{ error: { message, start, end } }`
  // on a parse error. No partials map: each file is parsed on its own.
  function parseAst(source) {
    try {
      return { ast: wasmParseAst(source) };
    } catch (error) {
      return { error };
    }
  }

  // Capture render-context snapshots at a source span, for the Context
  // Inspector. `target` is `{ file, start, end }` (an output segment's source
  // provenance). Returns an array of snapshots — `{ this, parent, root, index,
  // index1, key, first, last, locals }` (the UI renders them `@`-prefixed) — one
  // per execution of the matching instruction (so a loop body yields one per
  // iteration), empty when the span is never reached. Needs a program compiled
  // with `{ map: true }`.
  function inspectAt(program, data, target, { policy } = {}) {
    return wasmInspectAt(program, data, asPolicy(policy), target);
  }

  // The set of transformer names a compiled program calls, sorted (ADR-0013).
  // Returns a string array. Hosts use this to build a minimal `allow:` list.
  function usedTransformers(program) {
    return wasmUsedTransformers(program);
  }

  // The set of top-level assign names a compiled program reads, sorted.
  // Returns a string array. Hosts use this to declare the template's data
  // contract — schema-validate before render, drive "missing assigns" hints
  // in editors, or fail fast when a renamed key is no longer supplied.
  // Context vars (@this/@index/@key etc.) are not assigns and do not appear.
  // Mirrors `Stem.Bytecode.required_assigns/1`.
  function requiredAssigns(program) {
    return wasmRequiredAssigns(program);
  }

  // The partial-inclusion graph this program builds: `{ nodes, edges,
  // cycles }`, the same shape as the playground's `buildDependencyGraph`.
  // Hosts use this to render the dependency view without re-parsing every
  // partial. Mirrors `Stem.Bytecode.partial_graph/1` on the BEAM and
  // `Program::partial_graph` on Rust.
  function partialGraph(program) {
    return wasmPartialGraph(program);
  }

  // All built-in transformer names, sorted alphabetically. Use this to drive
  // a cheat sheet or build an allow-list without hard-coding the list in the
  // host. Returns a string array.
  function allTransformers() {
    return wasmAllTransformers();
  }
  // Full catalog of every built-in transformer: name, category, arity, summary,
  // and a minimal example snippet. Mirrors Stem.Transformers.Catalog.entries/0
  // on the BEAM. Returns an array of { name, category, arity, summary, example }.
  // Use this to drive a data-driven cheat sheet or any tooling that needs
  // per-transformer metadata without hard-coding it in the host.
  function catalog() {
    return wasmCatalog();
  }
  // A single-call handover object for version negotiation and feature
  // detection between components (mirrors Stem.engine_info/0 on the BEAM).
  // Returns { version, bcVersion, builtins: [...], features: [...] }.
  //
  // ADR-0020: the adapter is the canonical declaration boundary for the
  // capability vector (engine-features/v1). The Rust engine_info() now reports
  // the full vocabulary, so this union is a no-op safety net — it keeps the
  // adapter's honest set intact even when paired with an older WASM binary that
  // still advertises only the original five strings.
  function engineInfo() {
    const info = wasmEngineInfo();
    const features = Array.from(
      new Set([...(info.features || []), ...STEM_FEATURES]),
    ).sort();
    return { ...info, features };
  }

  // The compiled engine's version string, baked into the wasm at build time.
  const version = wasmVersion();

  return { render, compile, parseAst, inspectAt, usedTransformers, requiredAssigns, partialGraph, allTransformers, catalog, engineInfo, version };
}
