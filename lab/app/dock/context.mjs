// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel — Context Inspector (ADR-035). Migrated from index.html (Phase 0,
// ctx form). Snapshots of the render context at the last-clicked output span,
// from the engine's `inspect_at` — one card per execution (loop bodies yield one
// per iteration). Re-execute-on-demand, not a live trace.
//
// Reads ctxTarget (the clicked span) and the lastProgram/lastData caches, and
// takes an injected `inspectAt` (renderer.inspectAt) + the MinBars compat flag.
// The pure label/snippet/title helpers live here (used only by this panel).

import { makeEl } from "../dom.mjs?v=24f57cfe";

// Collapse whitespace and cap the length for a one-line span label.
export function oneLineLabel(text, max = 60) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

// Title a snapshot by its loop iteration when the engine hoisted @index/@key onto
// it, so 50 cards read as "@index 0 · @key …" not an anonymous "#1..#50".
export function snapTitle(snap, i) {
  if (snap.index === null || snap.index === undefined) return "#" + (i + 1);
  const key = snap.key === null || snap.key === undefined
    ? ""
    : " · @key " + (typeof snap.key === "string" ? snap.key : String(snap.key));
  return "@index " + snap.index + key;
}

// Full value preview (pretty-printed for objects/arrays) — the inspector exists to
// see the scope, so values are shown in full and the cell wraps/scrolls.
export function ctxSnippet(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 2); } catch { return "[object]"; }
  }
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

export function ctxType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

function renderSnap(snap, i, ctxTarget) {
  const head = makeEl("div", { class: "ctx-snap-head" }, [
    makeEl("span", { class: "ix" }, snapTitle(snap, i)),
    makeEl("span", { class: "src" }, oneLineLabel(ctxTarget.label)),
  ]);
  const rows = [
    ["@this", snap.this], ["@parent", snap.parent], ["@root", snap.root],
    ["@index", snap.index], ["@index1", snap.index1], ["@key", snap.key],
    ["@first", snap.first], ["@last", snap.last],
  ].filter(([, v]) => v !== null && v !== undefined);
  for (const [k, v] of Object.entries(snap.locals || {})) rows.push([k, v]);
  const table = makeEl("div", { class: "ctx-snap-table" });
  for (const [k, v] of rows) {
    table.append(makeEl("span", { class: "key" }, k));
    table.append(makeEl("span", { class: "val" }, [
      ctxSnippet(v),
      makeEl("span", { class: "ty" }, ctxType(v)),
    ]));
  }
  return makeEl("div", { class: "ctx-snap" }, [head, table]);
}

export function renderContext(body, { ctxTarget, program, data, inspectAt, minbarsCompat }) {
  const pane = makeEl("div", { class: "ctx-pane" });
  if (!ctxTarget || !program) {
    pane.append(makeEl("div", { class: "ctx-hint" },
      "Click an expression in the Plain Text output to inspect its scope here. " +
      "Loop bodies produce one snapshot per iteration."));
    body.append(pane);
    return;
  }
  let snaps;
  try {
    snaps = inspectAt(
      program, data,
      { file: ctxTarget.file, start: ctxTarget.start, end: ctxTarget.end },
      // MinBars only: the inspector rule must match the source map that produced
      // the clicked target. FlatBars dialects ignore the opts argument.
      { compat: minbarsCompat },
    );
  } catch (err) {
    pane.append(makeEl("div", { class: "ctx-hint" }, "inspect error: " + err.message));
    body.append(pane);
    return;
  }
  pane.append(makeEl("div", { class: "ctx-hint" },
    `${snaps.length} snapshot${snaps.length === 1 ? "" : "s"} at \`${oneLineLabel(ctxTarget.label)}\`` +
    " · re-execute-on-demand, no live trace"));
  snaps.forEach((s, i) => pane.append(renderSnap(s, i, ctxTarget)));
  if (!snaps.length) {
    pane.append(makeEl("div", { style: "padding:8px 2px;color:var(--fg-muted);font-size:12px" },
      "This span was never reached during render."));
  }
  body.append(pane);
}
