// SPDX-License-Identifier: Apache-2.0
//
// Output-view *decisions* for the FlatBars Lab, extracted from index.html so the
// view system is testable without a browser (the `playground_utils.mjs` pattern).
//
// Three layers (see docs/playground-smoke.md):
//   1. DECISION — VIEW_TABS / visibleViews / validView / viewKind: pure
//      functions, unit-tested in Node.
//   2. WIRING   — applyView: mutates the DOM *interface* (`hidden` flags) given
//      injected elements; tested against a hand-rolled fake document. It touches
//      no layout/CodeMirror — that is deliberately out of scope here.
//   3. PIXELS   — does CodeMirror actually render it? Only a real browser; a
//      manual checklist in docs/playground-smoke.md.

import { tabVisibleUnder } from "./playground_utils.mjs";

// The output view tabs, mirroring the data sub-pane tab strip. `requires` is the
// ADR-0020 capability gate: a view shows only when the engine advertises every
// listed feature (no `requires` ⇒ always shown).
export const VIEW_TABS = [
  { view: "source", label: "Plain Text" },
  { view: "rendered", label: "HTML Preview" },
  { view: "markdown", label: "Markdown Preview" },
  { view: "st4", label: "ST4 Preview", requires: ["st4-modes"] },
  { view: "data", label: "Render Data" },
  { view: "bytecode", label: "Bytecode", requires: ["bytecode-wire"] },
  { view: "compiled", label: "Compiled JS", requires: ["compile-js"] },
  { view: "migrated", label: "Migrated MaxBars", requires: ["migrate"] },
];

// The views the loaded engine actually exposes (ADR-0020 gate applied).
export function visibleViews(features) {
  return VIEW_TABS.filter((t) => tabVisibleUnder(features, t.requires));
}

// Coerce a (possibly stale/invalid) view name to one the engine exposes, else
// fall back to the always-present "rendered" preview.
export function validView(view, features) {
  return visibleViews(features).some((t) => t.view === view) ? view : "rendered";
}

// Whether a view paints into the read-only text editor (vs the preview iframe).
// The text views: Plain Text, Render Data, Bytecode, ST4, Compiled JS, Migrated.
export function viewKind(view) {
  const text =
    view === "source" || view === "data" || view === "bytecode" || view === "st4" ||
    view === "compiled" || view === "migrated";
  return text ? "text" : "preview";
}

// WIRING (layer 2): show the text pane or the preview iframe for `view` by
// toggling each element's `hidden`. `els` is `{ text, preview }` — the two
// output containers (or fakes in a test). Returns the chosen kind. This is the
// DOM *interface* only; it never reads layout.
export function applyView(els, view) {
  const kind = viewKind(view);
  els.text.hidden = kind !== "text";
  els.preview.hidden = kind === "text";
  return kind;
}
