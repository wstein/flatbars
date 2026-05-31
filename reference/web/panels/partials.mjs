// SPDX-License-Identifier: Apache-2.0
//
// Partials dock panel: the partial-inclusion graph view. Lists every partial
// referenced or defined in the workspace with its incoming/outgoing call
// weights, then paints the dependency graph alongside. Recognises missing
// partials (offers a "+ Create partial" action) and cycles (legal, since
// recursion is depth-capped at runtime — ADR-0014).
//
// Pure renderer — state and DOM/host helpers arrive via `deps`. Companion
// to `transformers.mjs` in the post-0.6.0 dock-modularization pilot.

export function renderPartials(body, deps) {
  const {
    partialDeps,
    makeEl,
    openOrCreatePartial,
    tabIndexByFile,
    selectTemplateTab,
    renderDepsGraph,
  } = deps;

  const section = makeEl("div", { class: "pg-section" });
  if (!partialDeps) {
    section.append(makeEl("div", { class: "pg-empty" }, "No partials in this workspace."));
    body.append(section);
    return;
  }
  const partials = partialDeps.nodes.filter((n) => !n.isMain);
  const missing = partials.filter((n) => n.missing);
  const defined = partials.length - missing.length;
  const cycles = partialDeps.cycles;
  section.append(makeEl("div", { class: "pg-head" }, [
    makeEl("strong", {}, "Partials"),
    " — ", String(defined), defined === 1 ? " defined" : " defined",
    missing.length ? makeEl("span", { class: "pg-warn" }, ` · ${missing.length} unresolved`) : "",
    cycles.length ? makeEl("span", { class: "pg-cycle" }, ` · ${cycles.length} cycle${cycles.length === 1 ? "" : "s"}`) : "",
  ]));
  if (partials.length === 0) {
    // No partials referenced or defined — main is rendering alone.
    // Skip the split/graph entirely.
    section.append(makeEl("div", { class: "pg-empty" }, [
      "This template uses no partials. Reference one with ",
      makeEl("code", { class: "pg-code" }, '{{partial "name"}}'),
      ".",
    ]));
    body.append(section);
    return;
  }
  // Aggregated call counts per partial: one number per `(from, to)`, summed
  // over both incoming (callers) and outgoing (callees) sides.
  const callers = new Map(), callees = new Map();
  for (const n of partials) { callers.set(n.id, 0); callees.set(n.id, 0); }
  for (const e of partialDeps.edges) {
    if (callees.has(e.from)) callees.set(e.from, callees.get(e.from) + e.count);
    if (callers.has(e.to)) callers.set(e.to, callers.get(e.to) + e.count);
  }
  const split = makeEl("div", { class: "pg-split" });
  // Left column: the list of partials only (main has no row).
  const list = makeEl("div", { class: "pg-rows" });
  for (const n of partials) {
    const tags = [];
    if (n.missing) tags.push("missing");
    if (cycles.some((c) => c.includes(n.id))) tags.push("recursive");
    const incoming = callers.get(n.id) || 0;
    const outgoing = callees.get(n.id) || 0;
    const row = makeEl("div", { class: "pg-row" + (n.missing ? " missing" : "") }, [
      makeEl("span", { class: "pg-name" }, n.id),
      makeEl("span", { class: "pg-tags" }, tags.join(" · ")),
      makeEl("span", { class: "pg-deg" },
        `${incoming} call${incoming === 1 ? "" : "s"} in · ` +
        `${outgoing} call${outgoing === 1 ? "" : "s"} out`),
    ]);
    if (n.missing) {
      const btn = makeEl("button", { class: "problem-action" }, "＋ Create partial");
      btn.addEventListener("click", (e) => { e.stopPropagation(); openOrCreatePartial(n.id); });
      row.append(btn);
    } else {
      row.title = "open this file";
      row.addEventListener("click", () => {
        const idx = tabIndexByFile(n.id);
        if (idx >= 0) selectTemplateTab(idx);
      });
    }
    list.append(row);
  }
  split.append(list);
  // Right column: the SVG graph painter. Aggregated `count` per edge labels
  // each arrow with the call weight when > 1 — the snapshot call-graph
  // reading.
  const graphCell = makeEl("div", { class: "pg-graph" });
  renderDepsGraph(graphCell, partialDeps);
  split.append(graphCell);
  section.append(split);
  if (cycles.length) {
    const cyc = makeEl("div", { class: "pg-cycles" });
    cyc.append(makeEl("strong", {}, "Cycles (legal — recursion is depth-capped at runtime):"));
    for (const c of cycles) cyc.append(makeEl("div", { class: "pg-cycle-row" }, c.join(" → ")));
    section.append(cyc);
  }
  body.append(section);
}
