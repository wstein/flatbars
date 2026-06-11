// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel #6 — Performance. The first dock panel migrated out of index.html
// (Phase 0, the ctx restructure per CTX-DESIGN.md). It is a leaf of the render
// graph: it only READS one cache (`lastTimings`) and builds DOM via makeEl —
// nothing calls back into run(). So instead of the full ctx it takes the one
// cache it needs as an argument (the minimal-ctx form; in the final shape this is
// `ctx.caches.lastTimings`).
//
// Coarse per-phase wall-clock for the last run — a cheap regression canary during
// interactive edits.

import { makeEl } from "../dom.mjs";

// Render the Performance panel into `body`. `timings` is the last run's timing
// record `{ parseMs, compileMs, renderMs, totalMs, outBytes }`, or null before
// the first run.
export function renderPerformance(body, timings) {
  const t = timings;
  const section = makeEl("div", { class: "pf-section" });
  if (!t) {
    section.append(makeEl("div", { class: "pf-empty" }, "No run yet."));
    body.append(section);
    return;
  }
  const fmt = (ms) => `${ms.toFixed(2)} ms`;
  section.append(makeEl("div", { class: "pf-head" }, [
    makeEl("strong", {}, "Performance"),
    " — wall-clock per phase, this run",
  ]));
  const grid = makeEl("div", { class: "pf-grid" });
  const row = (k, v, sub) => {
    grid.append(makeEl("div", { class: "pf-k" }, k));
    grid.append(makeEl("div", { class: "pf-v" }, fmt(v)));
    grid.append(makeEl("div", { class: "pf-sub" }, sub || ""));
  };
  row("Parse (parse_ast × N)", t.parseMs, "static analysis for every dock panel");
  row("Compile", t.compileMs, "source → wire program (span-mapped)");
  row("Render", t.renderMs, `output: ${t.outBytes.toLocaleString()} bytes`);
  row("Total", t.totalMs, "");
  section.append(grid);
  if (t.totalMs > 100) {
    section.append(makeEl("div", { class: "pf-warn" },
      "⚠ Total run > 100 ms. Most of the cost is usually Parse on N partials — collapse small partials inline or simplify expressions."));
  }
  body.append(section);
}
