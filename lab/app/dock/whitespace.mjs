// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel #2 — Whitespace trim trace. Migrated from index.html (Phase 0, ctx
// form). Lists every `{{~` / `~}}` marker and ADR-0016 standalone-tag line,
// jump-linked. Reads one cache (`lastWhitespace`, passed as `rows`) and takes two
// injected deps: `openProblem` (jump-to-source) and `standaloneOn` (the global
// trim toggle — note the original used a `standaloneState()` accessor because the
// local `standalone` rows shadow that flag).

import { makeEl } from "../dom.mjs?v=24f57cfe";

export function renderWhitespace(body, rows, { openProblem, standaloneOn }) {
  const explicit = rows.filter((r) => r.kind === "leading" || r.kind === "trailing");
  const standalone = rows.filter((r) => r.kind === "standalone");
  const section = makeEl("div", { class: "wt-section" });
  section.append(makeEl("div", { class: "wt-head" }, [
    makeEl("strong", {}, "Whitespace control"),
    " — ", String(explicit.length), " explicit `~` marker", explicit.length === 1 ? "" : "s",
    " · ", String(standalone.length), " standalone-tag line", standalone.length === 1 ? "" : "s",
    standalone.length && !standalone[0].stripped ? " (currently stripped by ADR-0016 default)" : "",
  ]));
  if (rows.length === 0) {
    section.append(makeEl("div", { class: "wt-empty" },
      "No `~` trim markers and no standalone-tag lines in the templates."));
    body.append(section);
    return;
  }
  const list = makeEl("div", { class: "wt-rows" });
  for (const r of rows) {
    const kindLabel = r.kind === "leading" ? "{{~"
      : r.kind === "trailing" ? "~}}"
      : "standalone";
    const desc = r.kind === "leading"
      ? "trim whitespace before this tag (up to and including the preceding newline)"
      : r.kind === "trailing"
        ? "trim whitespace after this tag (up to and including the following newline)"
        : `line stripped by ADR-0016 standalone rule — ${r.desc} tag with only whitespace around it`;
    const row = makeEl("div", { class: `wt-row wt-${r.kind}` }, [
      makeEl("span", { class: "wt-kind" }, kindLabel),
      makeEl("span", { class: "wt-where" }, `${r.file}:${r.line}:${r.col}`),
      makeEl("span", { class: "wt-desc" }, desc),
    ]);
    row.title = "jump to source";
    row.addEventListener("click", () => openProblem({ file: r.file, line: r.line, col: r.col }));
    list.append(row);
  }
  section.append(list);
  if (standalone.length && !standalone[0].stripped && !standaloneOn) {
    section.append(makeEl("div", { class: "wt-hint" },
      "Trim whitespace is OFF — these standalone lines render as-is. Toggle it on to apply ADR-0016."));
  }
  body.append(section);
}
