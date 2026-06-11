// SPDX-License-Identifier: Apache-2.0
//
// The share-URL state snapshot (Phase 0): serialise the live workspace into the
// compact object that `encodeState` (playground_utils) turns into the `#hash`.
// Pure — reads ctx.state + the active template-pane mode, returns the object.
// Defaults are OMITTED so shared links stay short (the restore side fills them);
// keep this in sync with restoreHash's reader in index.html.

export function snapshotState(ctx, templateMode) {
  const st = ctx.state;
  return {
    tabs: st.tabs.map((t) => ({ n: t.name, s: t.source })),
    d: st.yamlSrc,
    t: st.transformSrc,
    // Custom-helper source (ADR-018), a separate field from the transform.
    ...(st.helpersSrc.trim() ? { h: st.helpersSrc } : {}),
    // i18n (ADR-029): the message catalog + the active locale (default en omitted).
    ...(st.catalogSource.trim() ? { cat: st.catalogSource } : {}),
    ...(st.labLocale && st.labLocale !== "en" ? { loc: st.labLocale } : {}),
    // ADR-030 analyse path schema — persisted so a "watch suppression" link round-trips.
    ...(st.labPathSchema.length ? { ps: st.labPathSchema } : {}),
    // Data overlays — each entry is { n: name, s: source }. Omitted when there are
    // none so legacy/short links stay compact.
    ...(st.dataOverlays.length ? { do: st.dataOverlays.map((o) => ({ n: o.name, s: o.source })) } : {}),
    e: st.escapeMode, v: st.outputView,
    sa: st.standalone ? 1 : 0, // ADR-0016 standalone flag
    ...(st.allowList !== null ? { al: st.allowList } : {}), // ADR-0013 transformer allow-list
    av: st.activeView, ai: st.activeTabIdx,
    // MinBars truthiness toggle (ADR-022 S2); omitted when off so links stay compact.
    ...(st.minbarsCompat ? {} : { mj: 0 }), // default mustacheJs; persist only the spec opt-out
    // Active template-pane mode (1 = transform / helpers tab, 0/omitted = tmpl).
    ...(templateMode === "transform" ? { tm: 1 } : {}),
    ...(templateMode === "helpers" ? { hm: 1 } : {}),
    x: st.loadedExampleIdx, // which example (or -1 for an edited "custom" state)
  };
}

// Build a conformance vector capturing the current workspace + the actual rendered
// output — the shape the Data Access panel's "Save vector" copies (a one-click
// bug → regression test). Pure; `row` (optional) is a data-access row that names
// the vector after the failing path. The caller handles the clipboard/toast.
export function buildVector(ctx, row) {
  const partials = {};
  for (const t of ctx.state.tabs.slice(1)) partials[t.name] = t.source;
  return {
    name: row ? `data access: ${row.status} ${row.path}` : "playground capture",
    template: ctx.state.tabs[0].source,
    partials,
    data: ctx.caches.lastData == null ? {} : ctx.caches.lastData,
    escape: ctx.state.escapeMode,
    expected: ctx.caches.lastOutput,
    transformers: ctx.caches.lastUsedTransformers,
  };
}
