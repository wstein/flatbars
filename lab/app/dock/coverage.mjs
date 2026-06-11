// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel #7 — Coverage map. Migrated from index.html (Phase 0, ctx form).
// Static branch coverage from the current data: each if/unless/each/with block
// reports whether it would execute. Reads one cache (`lastCoverage`, passed as
// `rows`) and takes two injected deps:
//   - `rowPosition(r)` → { line, column } — resolves a row's source position
//     (index.html closes it over fileSource + charToLineColumn/spanRange, so this
//     module needs no playground_utils import / no dual-instance ?v= hazard);
//   - `openProblem({ file, line, col })` — jump-to-source.

import { makeEl } from "../dom.mjs?v=24f57cfe";

export function renderCoverage(body, rows, { rowPosition, openProblem }) {
  const section = makeEl("div", { class: "cv-section" });
  section.append(makeEl("div", { class: "cv-head" }, [
    makeEl("strong", {}, "Coverage"),
    " — ", String(rows.length), " block", rows.length === 1 ? "" : "s",
    " · ", String(rows.filter((r) => r.executed).length), " executed",
    " · ", String(rows.filter((r) => !r.executed).length), " skipped",
  ]));
  if (rows.length === 0) {
    section.append(makeEl("div", { class: "cv-empty" },
      "No conditional or iteration blocks in this template."));
    body.append(section);
    return;
  }
  section.append(makeEl("div", { class: "cv-hint" },
    "Static against the current data — a block in a scoped subtree (loop body or partial-scope) is flagged unknown."));
  const list = makeEl("div", { class: "cv-rows" });
  for (const r of rows) {
    const cls = r.executed ? "ok" : "dead";
    const pos = rowPosition(r);
    const row = makeEl("div", { class: `cv-row ${cls}` }, [
      makeEl("span", { class: "cv-kind" }, r.kind),
      makeEl("span", { class: "cv-label" }, r.label),
      makeEl("span", { class: "cv-where" }, `${r.file}:${pos.line}:${pos.column}`),
    ]);
    row.title = "jump to source";
    row.addEventListener("click", () => openProblem({ file: r.file, line: pos.line, col: pos.column }));
    list.append(row);
  }
  section.append(list);
  body.append(section);
}
