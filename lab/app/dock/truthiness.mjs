// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel — Truthiness (ADR-022). Migrated from index.html (Phase 0, ctx form).
// The conditions whose branch would differ on another engine, from the engine's
// analyse mode. Each row jump-links to the source tag; the fix is the portable
// rewrite. Reuses the Coverage panel's `cv-*` styling.
//
// Reads the analyse cache (`lastAnalyse`), the ADR-030 suppressed-count
// (`lastAnalyseSuppressed`), and the host path schema (`labPathSchema`), and takes
// `openProblem` for jump-to-source.

import { makeEl } from "../dom.mjs";

export function renderTruthiness(body, { analyse, suppressed, pathSchema }, { openProblem }) {
  const a = analyse;
  const section = makeEl("div", { class: "cv-section" });
  // strip markdown code-ticks — this is a plain diagnostics panel, not markdown.
  const plain = (s) => String(s).replace(/`/g, "");
  if (!a.ok) {
    section.append(makeEl("div", { class: "cv-empty" },
      "Analyse unavailable: " + (a.error || "the template did not render.")));
    body.append(section);
    return;
  }
  // ADR-030 coverage honesty: observed findings the data actually hit, the
  // potential same-type ambiguous value any condition could hold, and advisory
  // data-access misses (a bare path absent from a present object).
  const observed = a.findings.filter((f) => f.kind === "observed");
  const potential = a.findings.filter((f) => f.kind === "potential");
  const misses = a.findings.filter((f) => f.kind === "miss");
  section.append(makeEl("div", { class: "cv-head" }, [
    makeEl("strong", {}, "Truthiness"),
    " — ", String(observed.length), " observed, ", String(potential.length), " potential",
    misses.length ? `, ${misses.length} miss` : "",
  ]));
  // ADR-030: when config.yaml declares safe paths, say so — the panel's
  // potential/miss findings for those paths are suppressed, so this explains why
  // they're absent (the interactive suppression demo).
  if (pathSchema.length) {
    section.append(makeEl("div", { class: "cv-hint" },
      `PathSchema active (${suppressed} suppressed) — hiding potential & miss findings for ${pathSchema.map((p) => "`" + p + "`").join(", ")} (config.yaml → analyse.pathSchema).`));
  }
  if (a.findings.length === 0) {
    section.append(makeEl("div", { class: "cv-empty" },
      "Every condition agrees across engines for this data — portable."));
    body.append(section);
    return;
  }
  // A finding row; `label(f)` formats the middle column (truthiness findings name
  // the flips; misses describe the absent path).
  const findingGroup = (rows, label) => {
    const list = makeEl("div", { class: "cv-rows" });
    for (const f of rows) {
      const row = makeEl("div", { class: "cv-row dead" }, [
        makeEl("span", { class: "cv-kind" }, f.tag),
        makeEl("span", { class: "cv-label" }, label(f)),
        makeEl("span", { class: "cv-where" }, `main:${f.line}:${f.column}`),
      ]);
      row.title = "jump to source";
      row.addEventListener("click", () => openProblem({ file: "main", line: f.line, col: f.column }));
      list.append(row);
      list.append(makeEl("div", { class: "cv-hint" },
        [makeEl("strong", {}, "Fix: "), plain(f.fix)]));
    }
    return list;
  };
  const flipLabel = (verb) => (f) => `${verb} ${plain(f.value)} — flips under ${f.flips.join(", ")}`;
  if (observed.length) {
    section.append(makeEl("div", { class: "cv-hint" },
      "Observed — this data drove the condition into an ambiguous value that branches differently on another engine. Branch explicitly."));
    section.append(findingGroup(observed, flipLabel("tested")));
  }
  if (potential.length) {
    section.append(makeEl("div", { class: "cv-hint" },
      "Potential — portable for this data, but the same-type ambiguous value would diverge (independent of the sample). Branch explicitly to be safe for all data."));
    section.append(findingGroup(potential, flipLabel("would diverge if it held")));
  }
  if (misses.length) {
    section.append(makeEl("div", { class: "cv-hint" },
      "Possible misses (advisory) — a bare path resolved to absent from a present object, for this data. Likely a typo or a missing field."));
    section.append(findingGroup(misses, (f) => `\`${f.path}\` ${plain(f.value)}`));
  }
  body.append(section);
}
