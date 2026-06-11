// SPDX-License-Identifier: Apache-2.0
//
// Small self-contained UI chrome extracted from index.html (Phase 0): the
// transient toast and the share-menu open/close toggles. DOM-only, no app state.
//
// The share *actions* themselves (copyShareLink / copyMarkdown / downloadWorkspace
// wiring) stay inline for now — they depend on still-inline helpers (saveHash,
// buildMarkdownDoc, downloadWorkspace) and consume the `toast` exported here.

import { byId, qs } from "./dom.mjs?v=24f57cfe";

// A transient bottom toast. Reuses the single `.toast` node, shows it for ~1.4s,
// and resets the hide timer on each call so rapid toasts don't flicker out early.
export function toast(msg) {
  let t = qs(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.append(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove("show"), 1400);
}

// The share/export dropdown — open and close set the same three bits of state
// (the menu's hidden flag, the container's data-open, and the button's
// aria-expanded) so the visual state and the a11y state never drift.
export function openShareMenu() {
  byId("share-menu").hidden = false;
  byId("share").dataset.open = "true";
  byId("share-btn").setAttribute("aria-expanded", "true");
}

export function closeShareMenu() {
  byId("share-menu").hidden = true;
  byId("share").dataset.open = "false";
  byId("share-btn").setAttribute("aria-expanded", "false");
}
