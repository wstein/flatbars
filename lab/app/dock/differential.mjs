// SPDX-License-Identifier: Apache-2.0
//
// The Differential panel (Phase 7 of PLAN-registry-local-trussbars.md) — runs the
// current template+data through every registered engine provider and byte-diffs each
// CANDIDATE against the oracle REFERENCE. The verdict is directional: oracle = green
// reference, a shipping engine (trussbars-wasm) = a candidate flagged only on a true
// divergence (both engines rendered, outputs differ). An engine that can't render the
// active surface at all (e.g. trussbars on a ClassicBars template) is "n/a", not a
// divergence — the dialect boundary, not a bug. A "Report divergence" affordance emits
// a corpus-shaped fixture, closing the loop into the conformance suite.
//
// Pure renderer: `renderDifferential(body, model, host)` paints a computed model; the
// async compute (provider.create → render) lives in the boot script.

// The verdict comparing a candidate to the reference (see `compareOutputs` below).
export function verdictOf(reference, candidate) {
  if (candidate.error != null) return "na"; // engine doesn't target this surface
  if (reference.error != null) return "na"; // no reference output to compare against
  return reference.output === candidate.output ? "match" : "diverge";
}

// The first byte index where two strings differ (or -1 if equal), plus a short context
// window around it for the panel's "first difference" hint.
export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  if (i === n && a.length === b.length) return { index: -1 };
  const from = Math.max(0, i - 16);
  return { index: i, refSnippet: a.slice(from, i + 16), candSnippet: b.slice(from, i + 16) };
}

const BADGE = { match: "success", diverge: "danger", na: "" };
const VERDICT_LABEL = { match: "match", diverge: "diverges", na: "n/a (surface not rendered)" };

// Render the computed differential model:
//   model = { ready, dialect, reference:{id,label,output?,error?},
//             candidates:[{id,label,output?,error?,verdict}] }
//   host  = { makeEl, onReport(candidate) }
// `ready:false` shows the comparing state.
export function renderDifferential(body, model, host) {
  const { makeEl } = host;
  body.textContent = "";

  if (!model || !model.ready) {
    body.append(makeEl("p", { class: "muted dock-empty" }, ["Comparing engines…"]));
    return;
  }

  const { reference, candidates, dialect } = model;
  const head = makeEl("div", { class: "diff-head" }, [
    makeEl("span", { class: "diff-ref-label" }, [`Reference: ${reference.label}`]),
    makeEl("span", { class: "muted" }, [`  ·  ${dialect}`]),
  ]);
  body.append(head);

  if (reference.error != null) {
    body.append(makeEl("p", { class: "diff-row diff-na" }, [`The reference engine could not render this template: ${reference.error}`]));
  }

  if (!candidates.length) {
    body.append(makeEl("p", { class: "muted dock-empty" }, ["No other engine registered to compare against."]));
    return;
  }

  for (const cand of candidates) {
    const row = makeEl("div", { class: `diff-row diff-${cand.verdict}` });
    row.append(makeEl("div", { class: "diff-row-head" }, [
      makeEl("span", { class: `badge ${BADGE[cand.verdict]}` }, [VERDICT_LABEL[cand.verdict]]),
      makeEl("span", { class: "diff-cand-label" }, [` ${cand.label}`]),
    ]));

    if (cand.verdict === "na") {
      row.append(makeEl("div", { class: "diff-detail muted" }, [cand.error || "this engine does not render the active surface"]));
    } else if (cand.verdict === "diverge") {
      const d = firstDiff(reference.output ?? "", cand.output ?? "");
      row.append(makeEl("div", { class: "diff-detail" }, [
        makeEl("div", { class: "diff-at" }, [`First difference at byte ${d.index}:`]),
        makeEl("pre", { class: "diff-snip diff-snip-ref" }, [`reference  ${JSON.stringify(d.refSnippet)}`]),
        makeEl("pre", { class: "diff-snip diff-snip-cand" }, [`candidate  ${JSON.stringify(d.candSnippet)}`]),
      ]));
      const report = makeEl("button", { class: "diff-report fb-btn" }, ["Report divergence ▸ fixture"]);
      report.addEventListener("click", () => host.onReport(cand));
      row.append(report);
    } else {
      row.append(makeEl("div", { class: "diff-detail muted" }, ["byte-identical to the reference ✓"]));
    }
    body.append(row);
  }
}
