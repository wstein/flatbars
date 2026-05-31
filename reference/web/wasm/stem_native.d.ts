/* tslint:disable */
/* eslint-disable */

/**
 * All built-in transformer names, sorted alphabetically. Use this to
 * drive a cheat sheet or allow-list builder without hard-coding the list
 * in the host.
 */
export function all_transformers(): any;

/**
 * Full catalog of every built-in transformer — name, category, arity,
 * summary, and a minimal example snippet. Mirrors
 * `Stem.Transformers.Catalog.entries/0` on the BEAM; both are the
 * authoritative source for the playground cheat sheet, the Transformers
 * dock panel, and any tooling that needs per-transformer metadata without
 * hard-coding it in the host.
 *
 * Returns a JS array of `{ name, category, arity, summary, example }`
 * objects, sorted by name.
 */
export function catalog(): any;

/**
 * Compiles template source (plus an optional `{name: source}` partials map)
 * to a wire program, returned as a JS value. With `map`, the program carries
 * `src` provenance for the source-map view. Throws `{ errors: [{message,
 * file, start, end}, ...] }` on failure — every recoverable parse error in
 * source order, each naming the file ("main" or a partial) it occurred in —
 * so the editor can attribute it to the right tab and underline its span.
 */
export function compile(source: string, partials: any, map: boolean, standalone: boolean): any;

/**
 * A single-call handover object for version negotiation and capability
 * detection between components (mirrors `Stem.engine_info/0`):
 *
 * ```json
 * {
 *   "version":   "0.4.0",
 *   "bcVersion": "stem-bc/v1",
 *   "builtins":  ["at", "capitalize", ...],
 *   "features":  ["escape-modes", "eval-opt-in", "partials",
 *                 "source-map", "standalone"]
 * }
 * ```
 */
export function engine_info(): any;

/**
 * Captures the render context at a source span for the Context Inspector.
 * Re-runs `program` against `data` under the given `policy`
 * (`{ allow: string[] | null, eval: boolean }`) and snapshots the active
 * context (`@this`/`@parent`/`@root`/iteration vars/locals) each time a
 * `text`/`emit` instruction whose `src` equals `target` (`{file, start,
 * end}`) executes — one snapshot per loop iteration. Returns a JS array
 * of snapshots (empty when the span is never reached). `program` must be
 * compiled with spans (`compile(.., true)`).
 */
export function inspect_at(program: any, data: any, policy: any, target: any): any;

/**
 * Parses one template's `source` to its AST (`stem-ast/v1`), returned as a
 * JS object `{ version, nodes }`. Every node carries its byte `src` span.
 * Throws `{message, start, end}` on a parse error.
 */
export function parse_ast(source: string): any;

/**
 * The partial-inclusion graph this `program` builds. Returns a JS object
 * `{ nodes, edges, cycles }` matching the playground's existing
 * `buildDependencyGraph` shape — a host can render the dependency view
 * from the compiled wire alone, with no need to re-parse each partial.
 */
export function partial_graph(program: any): any;

/**
 * Renders a wire `program` against `data` under the host `policy`
 * (`{ allow: string[] | null, eval: boolean }`). With `map`, returns
 * `{ output, segments }` (the source map); otherwise the output string.
 * On a refusal or runtime failure, **throws** a structured `{ kind,
 * message }` object: `kind: "policy"` for an allow-list / `eval`-gate
 * refusal raised by the pre-render check, `kind: "render"` for a
 * runtime error. Hosts catch the throw rather than parsing a sentinel
 * out of the output string.
 */
export function render(program: any, data: any, policy: any, map: boolean): any;

/**
 * The set of top-level assign names a compiled `program` reads,
 * statically. Returned as a JS string array, sorted. Hosts use this to
 * declare a template's data contract: a caller can hand it to schema
 * validation, the playground turns it into a "missing assigns" hint,
 * and tooling can use it to fail fast when a renamed key is no longer
 * supplied.
 */
export function required_assigns(program: any): any;

/**
 * The set of transformer names a compiled `program` calls, statically
 * (ADR-0013). Returned as a JS string array, sorted. Hosts use this to
 * build a tight `allow:` list — a *report*, not a render-time refusal.
 */
export function used_transformers(program: any): any;

/**
 * The project version, baked in at build time from the repo-root `/VERSION`
 * file (the single source of truth, shared with the Elixir `mix.exs`), so
 * the playground can show the exact compiled-wasm build it loaded.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly main: (a: number, b: number) => number;
    readonly all_transformers: () => any;
    readonly catalog: () => any;
    readonly compile: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly engine_info: () => any;
    readonly inspect_at: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly parse_ast: (a: number, b: number) => [number, number, number];
    readonly partial_graph: (a: any) => [number, number, number];
    readonly render: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly required_assigns: (a: any) => [number, number, number];
    readonly used_transformers: (a: any) => [number, number, number];
    readonly version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
