// SPDX-License-Identifier: Apache-2.0
//
// The Lab's application state — the single mutable record the inline index.html
// app keeps as a wall of module-level `let`s (Phase 0 of the engine-registry
// plan, PLAN-registry-local-trussbars.md). This is the **unblocker** the
// EXTRACTION-MAP names: the stateful sections (editors / tabs / explorer / render
// `run()` / dock) can only move out of index.html once their shared state lives
// in one importable place.
//
// ADOPTION IS INCREMENTAL, NOT BIG-BANG. Each `let x` in index.html is read and
// written in dozens of places; flipping them all to `state.x` at once would be an
// unverifiable sweep. Instead a section adopts the store WHEN it is extracted —
// its readers/writers move into the new module together, so the rename stays
// contained and the browser smoke (lab/test/provenance_smoke.mjs) verifies each
// step. Until a field's owning section is extracted, index.html keeps its `let`.
//
// The model is deliberately the SAME imperative one index.html already uses: a
// plain mutable object plus explicit re-render calls (`run()` / `renderX()`). No
// reactive subscriptions are introduced here — that would be a paradigm change,
// out of scope for a behaviour-preserving extraction.

// Build a fresh application-state record with the faithful index.html defaults.
// `engine` is the resolved engine id (see ./engine-config.mjs); it only affects
// the initial open-editor strip (MinBars has no helpers editor).
export function createAppState(engine) {
  return {
    // Template tabs — index 0 is the pinned entry ("main"); 1.. are partials.
    tabs: [{ name: "main", source: "" }],
    activeTabIdx: 0,

    // Example loading.
    loadedExampleIdx: -1, // -1 = custom/edited
    exampleModified: false,

    // Active pane / view selection.
    activeView: "tmpl", // "tmpl" | "data" | "config" | "catalog"
    dataPaneMode: "data", // what the shared bottom pane DISPLAYS
    outputView: "source", // Plain Text is the default landing view
    dataTab: "edit", // "edit" | "context" | "ast"
    dataFile: "data",

    // Open-editor strip (VS Code-style): only the files the user has opened.
    openEditors: ["main", "data", "transform", ...(engine !== "minbars" ? ["helpers"] : [])],

    // Preview / escape / compat policy.
    allowScripts: true, // preview runs <script> in a null-origin sandbox
    escapeMode: "",
    minbarsCompat: true, // MinBars: default mustacheJs (ADR-029)

    // Compiler + runtime options (ADR-0016 / ADR-0013).
    standalone: true,
    allowList: null, // null = unconstrained

    // Layout.
    focusMode: null,

    // Diagnostics.
    templateDiagnostics: [],

    // Editor source buffers + dirty flags.
    yamlSrc: "",
    yamlDirty: false,
    transformSrc: "",
    transformDirty: false,
    helpersSrc: "",
    helpersDirty: false,
    catalogSource: "",
    catalogDirty: false,

    // i18n (ADR-029) + analyse host schema (ADR-030).
    labLocale: "en",
    labPathSchema: [],

    // Out-of-band custom-helper render cache (worker-backed).
    helperCache: { key: null, output: "", error: "" },
    helperInFlight: null,

    // Data overlays merged onto data.yaml before JSONata runs.
    dataOverlays: [],
  };
}

// Stable cache key for an out-of-band custom-helper render. Pure: the same inputs
// always produce the same key; an unserialisable input yields null (cache miss).
export function helperKey(tmpl, partials, data, src, catalog, locale, dialect) {
  try {
    return JSON.stringify([tmpl, partials, data, src, catalog, locale, dialect]);
  } catch {
    return null;
  }
}
