// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel #1 — Data Access. Migrated from index.html (Phase 0, ctx form).
// Static analysis of every data lookup against the current data dictionary, plus
// the engine-reported "required assigns" contract. Reads three caches (passed in
// `caches`) and takes injected deps:
//   - rowPosition(r) → { line, column } (fileSource + charToLineColumn/spanRange);
//   - openProblem({ file, line, col }) — jump-to-source;
//   - saveAsVector(row) — copy a conformance vector for a failing lookup.

import { makeEl } from "../dom.mjs?v=24f57cfe";

// One-line value preview for a hit row. Pure.
export function dxSnippet(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return JSON.stringify(v).slice(0, 60);
  if (typeof v === "object") {
    try { return JSON.stringify(v).slice(0, 60); } catch { return "[object]"; }
  }
  return String(v);
}

export function renderDataAccess(body, { rows, requiredAssigns, missingAssigns }, { rowPosition, openProblem, saveAsVector }) {
  const counts = { hit: 0, miss: 0, "type-mismatch": 0, oob: 0, scoped: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const section = makeEl("div", { class: "dx-section" });
  const head = makeEl("div", { class: "dx-head" }, [
    makeEl("strong", {}, "Data access"),
    " — ", String(rows.length), " lookups · ",
    makeEl("span", { class: "dx-pill ok" }, `${counts.hit} hit`), " ",
    makeEl("span", { class: "dx-pill warn" }, `${counts.miss} miss`), " ",
    makeEl("span", { class: "dx-pill danger" }, `${counts["type-mismatch"] + counts.oob} type/oob`), " ",
    makeEl("span", { class: "dx-pill muted" }, `${counts.scoped} scoped`),
  ]);
  section.append(head);
  // Engine-reported assign contract — programs report which top-level keys they
  // read; missing ones are real bugs (renamed key, dropped field), not heuristics.
  if (requiredAssigns.length) {
    const contract = makeEl("div", { class: "dx-contract" });
    contract.append(makeEl("strong", {}, "Required assigns"), ": ");
    for (const n of requiredAssigns) {
      const cls = missingAssigns.includes(n) ? "dx-assign missing" : "dx-assign";
      contract.append(makeEl("span", { class: cls, title: missingAssigns.includes(n) ? "missing from data" : "present in data" }, n));
    }
    if (missingAssigns.length) {
      contract.append(makeEl("span", { class: "dx-contract-warn" },
        ` — ${missingAssigns.length} missing from data`));
    }
    section.append(contract);
  }
  if (rows.length === 0) {
    section.append(makeEl("div", { class: "dx-empty" },
      "No data lookups — template renders only literals."));
    body.append(section);
    return;
  }
  section.append(makeEl("div", { class: "dx-hint" }, [
    "Static analysis against the current data dictionary. ",
    "“scoped” means the lookup sits inside a loop or partial-scope, where the head identifier may be a block param. ",
    makeEl("strong", {}, "Save vector"),
    " (next to a miss/oob row) copies a JSON conformance vector capturing the current template + data + actual output — a one-click way to turn a bug into a regression test.",
  ]));
  const list = makeEl("div", { class: "dx-rows" });
  for (const r of rows) {
    const cls = r.status === "hit" ? "ok"
      : r.status === "scoped" ? "muted"
      : r.status === "miss" ? "warn"
      : "danger";
    const row = makeEl("div", { class: `dx-row ${cls}` });
    row.append(makeEl("span", { class: "dx-status" }, r.status));
    row.append(makeEl("span", { class: "dx-path" }, r.path));
    row.append(makeEl("span", { class: "dx-val" },
      r.status === "hit" ? dxSnippet(r.value) : ""));
    const pos = rowPosition(r);
    row.append(makeEl("span", { class: "dx-where" }, `${r.file}:${pos.line}:${pos.column}`));
    // Save-as-vector button on every non-hit row — only the failure modes are
    // worth promoting to a regression vector.
    if (r.status !== "hit") {
      const save = makeEl("button", { class: "dx-save", title: "Copy a conformance vector for this case" }, "Save vector");
      save.addEventListener("click", (e) => { e.stopPropagation(); saveAsVector(r); });
      row.append(save);
    }
    row.title = "jump to source";
    row.addEventListener("click", () => openProblem({ file: r.file, line: pos.line, col: pos.column }));
    list.append(row);
  }
  section.append(list);
  body.append(section);
}
