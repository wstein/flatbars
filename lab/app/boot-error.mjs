// SPDX-License-Identifier: Apache-2.0
//
// Boot defence — a visible failure overlay when a required asset (the engine
// bundle, the example catalog) fails to load, instead of a blank page (Phase 0
// extraction from index.html). DOM-only, no app state. The browser smoke
// (lab/test/provenance_smoke.mjs, "boot defence" case) exercises this directly.
//
// Styled with the inline design tokens (CSS vars) — no external CSS, so it works
// even when a failed fetch is what triggered it.

export function showBootError(err) {
  if (document.querySelector(".boot-error")) return; // show once
  const el = (tag, css, text) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  };
  const wrap = el("div", "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.6 var(--font-ui,system-ui,sans-serif)");
  wrap.className = "boot-error";
  wrap.setAttribute("role", "alert");
  const card = el("div", "max-width:560px");
  card.append(
    el("div", "font-size:18px;font-weight:600;margin-bottom:8px;color:var(--danger)", "The FlatBars Lab failed to start"),
    el("div", "color:var(--fg-muted);margin-bottom:12px", "A required asset could not load. Build the engine bundle (npm run gen:bundle) and serve from the repo root (npm run lab) so /lab/ resolves."),
    el("pre", "white-space:pre-wrap;color:var(--danger);background:var(--bg);border:1px solid var(--border);padding:10px;border-radius:6px;margin:0;font-size:12px", String((err && err.message) || err)),
  );
  wrap.append(card);
  document.body.appendChild(wrap);
}

// Stop a fatal boot step with a visible message (the rest of the page depends on
// it, so re-throw after painting the overlay).
export const bootFail = (err) => { showBootError(err); throw err; };
