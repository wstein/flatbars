// SPDX-License-Identifier: Apache-2.0
//
// Engine resolution — pure functions extracted from the index.html monolith
// (Phase 0 of the engine-registry plan, PLAN-registry-local-trussbars.md).
//
// The Lab exposes the FlatBars dialects as first-class engines, chosen once per
// page load from `?engine=` and fixed thereafter. These four helpers turn the
// raw `?engine=`/`?dialect=` query strings into the canonical engine id and its
// display/label derivatives. Kept pure (string in → string out, no DOM, no URL
// parsing) so they unit-test offline and so Phase 2's engine *provider* axis can
// reuse them verbatim.
//
//   resolveEngine(engineParam, dialectParam) → "rawbars" | "classicbars" | "maxbars" | "minbars"
//   engineLabel(engine)                       → "RawBars" | "ClassicBars" | "MaxBars" | "MinBars"
//   templateExt(engine)                       → file extension for this engine's surface
//   templateFence(engine)                     → the Markdown code-fence language

// Map the raw `?engine=` (and legacy `?dialect=`) params to the canonical engine
// id. Accepts the documented aliases (raw/core, mustache, full/surface, max) and
// the back-compat `?engine=flatbars[&dialect=…]` links (the former
// "FlatBars + Dialect" two-selector model, flattened into one engine choice).
// Native Handlebars is dropped — ClassicBars fills the Handlebars-like role.
// Anything unrecognised defaults to ClassicBars, the Handlebars-flavoured surface.
export function resolveEngine(engineParam, dialectParam) {
  const engine = String(engineParam || "").toLowerCase();
  const dialect = String(dialectParam || "").toLowerCase();
  if (["rawbars", "raw", "core"].includes(engine)) return "rawbars";
  if (["minbars", "mustache"].includes(engine)) return "minbars";
  if (["classicbars", "full", "surface"].includes(engine)) return "classicbars";
  if (["maxbars", "max"].includes(engine)) return "maxbars";
  if (["flatbars", "bb"].includes(engine)) {
    if (["core", "rawbars"].includes(dialect)) return "rawbars";
    if (dialect === "maxbars") return "maxbars";
    return "classicbars";
  }
  return "classicbars";
}

// The human-readable engine name shown in the brand strip.
export function engineLabel(engine) {
  if (engine === "rawbars") return "RawBars";
  if (engine === "classicbars") return "ClassicBars";
  if (engine === "maxbars") return "MaxBars";
  return "MinBars";
}

// The file extension shown for this engine's template/partial files — one per
// dialect, so a file name reflects the surface it is written in. Purely the
// label; the on-disk example files keep the catalog's own extension.
export function templateExt(engine) {
  return ({ rawbars: "rawbars", minbars: "mustache", classicbars: "hbs", maxbars: "maxbars" })[engine] || "hbs";
}

// The Markdown code-fence language for an exported template: only `mustache` and
// `handlebars` are languages a Markdown highlighter knows, so MinBars uses
// `mustache` and the rest fall back to the Handlebars-flavoured tag.
export function templateFence(engine) {
  return engine === "minbars" ? "mustache" : "handlebars";
}
