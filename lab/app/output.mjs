// SPDX-License-Identifier: Apache-2.0
//
// The Lab's output subsystem — the first CORE function moved out of index.html
// (Phase 0, CTX-DESIGN.md step 3). `setOutput` is the hub that writes the output
// caches and refreshes everything downstream of a render.
//
// It writes ctx.caches (lastOutput/lastSegments) and fans out to five host
// functions still in index.html (paintTextView / renderPreview / renderDock /
// renderDataInspect / refreshSearchPanel) plus the active output view. Rather than
// thread all of that through every one of setOutput's ~10 call sites, a factory
// binds the deps once and returns the SAME `setOutput(str, segments)` signature —
// the call sites are unchanged (the createRenderer/createHelperSandbox pattern).

import { qs } from "./dom.mjs";
import { outputHasContent } from "./render-helpers.mjs";

export function createSetOutput(ctx, { getOutputView, paintTextView, renderPreview, renderDock, renderDataInspect, refreshSearchPanel }) {
  return function setOutput(str, segments = []) {
    ctx.caches.lastOutput = str;
    ctx.caches.lastSegments = segments;
    paintTextView();
    renderPreview();
    qs(".output-body").dataset.empty = outputHasContent(getOutputView(), ctx.caches) ? "false" : "true";
    renderDock();
    renderDataInspect();
    refreshSearchPanel();
  };
}
