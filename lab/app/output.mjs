// SPDX-License-Identifier: Apache-2.0
//
// The Lab's output subsystem (Phase 0, CTX-DESIGN.md step 3) — the cluster that
// turns a render into what the output pane shows: setOutput (the hub),
// paintTextView (per-view text painting), renderPreview (the iframe), and
// setOutputDoc (the read-only editor transaction), with buildProvenance as a
// module-internal helper.
//
// These are heavily CodeMirror/iframe-coupled, so a single `createOutputView(ctx,
// host)` factory binds the live handles once and returns the same function
// signatures the call sites already use. App-local pure deps (qs/byId,
// outputHasContent/previewDoc) are imported; the CM handles, the engine, the
// still-inline host fns, and the library helpers (disassemble/dumpYaml/marked/
// segmentRanges — injected to reuse the page's single instances) arrive via host.

import { qs, byId } from "./dom.mjs?v=24f57cfe";
import { outputHasContent, previewDoc } from "./render-helpers.mjs?v=bf6bc3dd";

export function createOutputView(ctx, host) {
  const {
    // live view/flag getters (they change between renders)
    getView, getMinbarsCompat, getAllowScripts,
    // engine + CodeMirror output-editor handles
    renderer, outputEditor, Decoration, setProvenance, setOutLink,
    // host fns still in index.html (hoisted)
    renderDock, renderDataInspect, refreshSearchPanel, updateOutLang,
    templateSourceFor, partialsMap, resetCaretLink,
    // library helpers (injected to reuse the page's single instances)
    disassemble, dumpYaml, marked, segmentRanges,
  } = host;

  // Build the provenance mark decorations from the renderer's segments. Output
  // offsets are UTF-16 code units (JS string indices), so segmentRanges uses them
  // directly — no byte↔char conversion (which drifts marks after a multibyte char).
  function buildProvenance(output, segments) {
    if (!segments.length) return { segViews: [], deco: Decoration.none };
    const segViews = segmentRanges(output, segments);
    const ranges = segViews.map((v, i) =>
      Decoration.mark({
        class: "seg" + (v.kind === "emit" ? " seg-expr" : ""),
        attributes: { "data-i": String(i) },
      }).range(v.from, v.to));
    return { segViews, deco: Decoration.set(ranges, true) };
  }

  // Swap the output editor's document and provenance in one programmatic
  // transaction (and clear any stale caret-link highlight). Language is applied
  // separately by updateOutLang, which may lazy-load a grammar.
  function setOutputDoc(text, provenanceDeco) {
    const cur = outputEditor.state.doc.toString();
    outputEditor.dispatch({
      changes: cur === text ? undefined : { from: 0, to: cur.length, insert: text },
      effects: [
        setProvenance.of(provenanceDeco),
        setOutLink.of(Decoration.none),
      ],
    });
    resetCaretLink();
  }

  function paintTextView() {
    const view = getView();
    if (view === "bytecode") {
      ctx.caches.lastSegViews = [];
      setOutputDoc(ctx.caches.lastProgram ? disassemble(ctx.caches.lastProgram) : "", Decoration.none);
    } else if (view === "data") {
      let text = "";
      if (ctx.caches.lastData != null) {
        try { text = dumpYaml(ctx.caches.lastData, { indent: 2, lineWidth: -1, noRefs: true }); }
        catch { text = String(ctx.caches.lastData); }
      }
      ctx.caches.lastSegViews = [];
      setOutputDoc(text, Decoration.none);
    } else if (view === "compiled") {
      // The template compiled to a JS module (the `compile-js` engine extension).
      // Errors come back as a `// …` comment so the pane stays valid-looking JS.
      ctx.caches.lastSegViews = [];
      let text = "// this engine has no compiler";
      if (typeof renderer.compileToJs === "function") {
        const r = renderer.compileToJs(templateSourceFor("main"), partialsMap(), { compat: getMinbarsCompat() });
        text = r.ok ? r.value : "// compile error: " + r.error;
      }
      setOutputDoc(text, Decoration.none);
    } else if (view === "migrated") {
      // The template rewritten to MaxBars source (the `migrate` engine extension).
      // Residuals the migrator could not safely rewrite are surfaced as leading
      // `{{! … }}` comments, so the pane stays valid MaxBars.
      ctx.caches.lastSegViews = [];
      let text = "{{! this engine has no migrator }}";
      if (typeof renderer.migrate === "function") {
        const r = renderer.migrate(templateSourceFor("main"));
        if (!r.ok) {
          text = "{{! migrate error: " + r.error + " }}";
        } else {
          const head = (r.residuals || []).map((x) =>
            "{{! residual — " + x.kind + ": " + x.message +
            (x.suggestion ? " — " + x.suggestion : "") + " }}").join("\n");
          text = head ? head + "\n" + r.source : r.source;
        }
      }
      setOutputDoc(text, Decoration.none);
    } else {
      const { segViews, deco } = buildProvenance(ctx.caches.lastOutput, ctx.caches.lastSegments);
      ctx.caches.lastSegViews = segViews;
      setOutputDoc(ctx.caches.lastOutput, deco);
    }
    updateOutLang();
  }

  // Fill the iframe for the current iframe view: raw output HTML for "Preview", or
  // the output interpreted as Markdown for "Markdown". Both honour the "Allow
  // scripts" toggle, swapping to an isolated `allow-scripts` sandbox.
  function renderPreview() {
    const view = getView();
    const scripts = (view === "rendered" || view === "markdown") && getAllowScripts();
    const frame = byId("output-preview");
    // Only (re)assign `sandbox` when it actually changes — re-setting it reloads
    // the iframe async, racing the srcdoc set below (the blank-first-paint bug).
    const wantSandbox = scripts ? "allow-scripts" : "allow-same-origin";
    if (frame.getAttribute("sandbox") !== wantSandbox) frame.setAttribute("sandbox", wantSandbox);
    const body = view === "markdown" ? marked.parse(ctx.caches.lastOutput) : ctx.caches.lastOutput;
    frame.srcdoc = previewDoc(body, scripts);
  }

  function setOutput(str, segments = []) {
    ctx.caches.lastOutput = str;
    ctx.caches.lastSegments = segments;
    paintTextView();
    renderPreview();
    qs(".output-body").dataset.empty = outputHasContent(getView(), ctx.caches) ? "false" : "true";
    renderDock();
    renderDataInspect();
    refreshSearchPanel();
  }

  return { setOutput, paintTextView, renderPreview, setOutputDoc, buildProvenance };
}
