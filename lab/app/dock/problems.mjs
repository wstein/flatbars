// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel — Problems. Migrated from index.html (Phase 0, ctx form) — the last
// inline dock tab. Compile + capability + missing-assign diagnostics for the last
// run, each jump-linked. An unknown-partial message grows a "Create partial"
// action. Reads the dockProblems cache and takes two injected callbacks:
// openOrCreatePartial(name) and openProblem(p).

import { makeEl } from "../dom.mjs";

export function renderProblems(body, dockProblems, { openOrCreatePartial, openProblem }) {
  if (!dockProblems.length) {
    body.append(makeEl("div", { class: "problem-empty" }, [
      makeEl("b", {}, "✓ No errors. "),
      "Compile and capability checks passed.",
    ]));
    return;
  }
  for (const p of dockProblems) {
    const sev = p.severity === "cap" ? "cap"
      : p.severity === "missing" ? "cap"
      : p.severity === "render" ? "render"
      : "error";
    const sourceLabel = p.severity === "cap" ? "capability"
      : p.severity === "missing" ? "missing assign"
      : "compile";
    const unknownPartial = p.message.match(/unknown partial ['"](.*?)['"]/);
    const msgChildren = [p.message];
    if (unknownPartial) {
      const name = unknownPartial[1];
      const btn = makeEl("button", { class: "problem-action", title: `Open or create partial "${name}"` }, "＋ Create partial");
      btn.addEventListener("click", (e) => { e.stopPropagation(); openOrCreatePartial(name); });
      msgChildren.push(btn);
    }
    const row = makeEl("div", { class: `problem ${sev}`, title: "jump to source" }, [
      makeEl("span", { class: "sev" }, sev === "cap" ? "!" : "×"),
      makeEl("span", { class: "where" }, `${p.file}:${p.line}:${p.col}`),
      makeEl("span", { class: "msg" }, msgChildren),
      makeEl("span", { class: "src" }, sourceLabel),
    ]);
    row.addEventListener("click", () => openProblem(p));
    body.append(row);
  }
}
