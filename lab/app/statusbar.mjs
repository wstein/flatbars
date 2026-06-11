// SPDX-License-Identifier: Apache-2.0
//
// The Lab's status bar (Phase 0) — the caret location + active filename readout.
// updateStatusMeta is rebuilt on every selection change / focus / tab switch, so a
// factory binds the live state getters + the two CM views once and returns the
// same arg-free function the call sites use.

import { byId } from "./dom.mjs?v=24f57cfe";

// HTML-escape for the filename shown in the status bar (its only consumer).
export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createStatusBar({ getActiveView, getDataTab, isInspectTab, dataView, templateView, overlayByName, getDataFile, getTemplateMode, activeTab }) {
  return function updateStatusMeta() {
    const activeView = getActiveView();
    const dataTab = getDataTab();
    // The inspector tabs have no editor/caret — show a plain label.
    if (activeView === "data" && isInspectTab(dataTab)) {
      const name = dataTab === "context" ? "Context Inspector" : "Syntax Tree";
      byId("status-meta").innerHTML = `<b>${name}</b>  ·  read-only`;
      return;
    }
    const view = (activeView === "data" || activeView === "config" || activeView === "catalog") ? dataView : templateView;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const col = sel.head - line.from + 1;
    // Active source filename: in the template pane, an overlay name, the JSONata
    // transform, or the current template tab; in the data pane, an overlay name or
    // `data.yaml`.
    const overlay = activeView === "data" ? overlayByName(getDataFile()) : null;
    const fileName = activeView === "config" ? "config.yaml"
      : activeView === "catalog" ? "catalog.yaml"
      : activeView !== "data"
        ? (getTemplateMode() === "transform" ? "transform" : getTemplateMode() === "helpers" ? "helpers.js" : activeTab().name)
        : overlay ? overlay.name + ".yaml" : "data.yaml";
    // Just the caret location — the language is implied by the active tab and the
    // encoding is always UTF-8.
    byId("status-meta").innerHTML = `<b>${escapeHtml(fileName)} · Ln ${line.number}, Col ${col}</b>`;
  };
}
