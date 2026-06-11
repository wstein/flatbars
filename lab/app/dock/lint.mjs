// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel — Lint (ADR-019). Migrated from index.html (Phase 0, ctx form). The
// deprecated-alias + non-canonical scoped-variable findings for the active
// dialect — the same canonicalization the editor quick-fix and `flatbars lint`
// surface. Each row names the canonical spelling; a clean template is positive
// evidence. Reuses the Coverage panel's `cv-*` styling.
//
// Reads the lint cache (`lastLint`) and takes openProblem for jump-to-source.

import { makeEl } from "../dom.mjs?v=24f57cfe";

export function renderLint(body, lint, { openProblem }) {
  const a = lint;
  const section = makeEl("div", { class: "cv-section" });
  const plain = (s) => String(s).replace(/`/g, "");
  if (!a.ok) {
    section.append(makeEl("div", { class: "cv-empty" },
      "Lint unavailable: " + (a.error || "the template did not parse.")));
    body.append(section);
    return;
  }
  const rows = a.findings;
  section.append(makeEl("div", { class: "cv-head" }, [
    makeEl("strong", {}, "Lint"),
    " — ", String(rows.length), " canonicalization finding", rows.length === 1 ? "" : "s",
  ]));
  if (rows.length === 0) {
    section.append(makeEl("div", { class: "cv-empty" },
      "Every name is canonical — no deprecated aliases or legacy scoped variables."));
    body.append(section);
    return;
  }
  section.append(makeEl("div", { class: "cv-hint" },
    "Each finding renders identically today, but a canonical spelling keeps the template portable. The editor quick-fix and flatbars lint steer to it."));
  const list = makeEl("div", { class: "cv-rows" });
  for (const f of rows) {
    const row = makeEl("div", { class: "cv-row" }, [
      makeEl("span", { class: "cv-kind" }, f.name || f.severity),
      makeEl("span", { class: "cv-label" }, plain(f.message)),
      makeEl("span", { class: "cv-where" }, `main:${f.line}:${f.column}`),
    ]);
    row.title = "jump to source";
    row.addEventListener("click", () => openProblem({ file: "main", line: f.line, col: f.column }));
    list.append(row);
  }
  section.append(list);
  body.append(section);
}
