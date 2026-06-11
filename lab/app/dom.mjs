// SPDX-License-Identifier: Apache-2.0
//
// DOM lookup helpers — the two one-liners the index.html app used everywhere,
// extracted so the app modules share one import (Phase 0 of the engine-registry
// plan). Intentionally trivial; they exist only to give the extracted modules a
// single canonical `byId`/`qs` rather than re-declaring them per module.

export const byId = (id) => document.getElementById(id);
export const qs = (sel) => document.querySelector(sel);

// Build a DOM node from a tag, an attribute map, and children. `class`/`style`
// get the fast path (className / cssText); everything else is setAttribute.
// Children may be a single value or an array; strings become text nodes, null/
// undefined are skipped. The Lab's dock panels build their DOM through this.
export function makeEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
