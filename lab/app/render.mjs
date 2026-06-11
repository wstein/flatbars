// SPDX-License-Identifier: Apache-2.0
//
// The Lab's render root — run() and scheduleRun, the most-coupled functions in the
// app (Phase 0, CTX-DESIGN.md step 4, the last core move). run() compiles, runs
// the static + data-aware analyses, applies the JSONata transform + data overlays,
// renders (in-process or via the helper Worker), and writes every result into
// ctx.caches for the dock to read.
//
// Because it touches ~40 things, `createRun(ctx, host)` binds them once and returns
// { run, scheduleRun } with the same signatures the call sites already use. Live
// state arrives as getters (the index.html `let`s mutate); engine/host fns and the
// library helpers are injected (the libs to reuse the page's single instances);
// applyEscape + helperKey are app-local imports. `performance` is a global.

import { applyEscape } from "./render-helpers.mjs?v=bf6bc3dd";
import { helperKey } from "./state.mjs?v=9f8876ec";

export function createRun(ctx, host) {
  const {
    // live state getters
    getYamlSrc, getTabs, getActiveTabIdx, getStandalone, getTransformSrc,
    getHelpersSrc, getCatalogSource, getAllowList, getEscapeMode, getMinbarsCompat,
    getLabLocale, getLabPathSchema, getDataOverlays, getLoadedExampleIdx, getHelperCache,
    // stable constants
    examples, ENGINE,
    // engine + host fns (still in index.html)
    renderer, partialsMap, fileSource, engineHas,
    setError, setOutput, renderDock, saveHash, clearDiagnostics, updateDiagnostics,
    setRecomputing, setRenderPending, refreshCoverageGutter, requestHelperRender,
    resetCaretLink, syncOutputToCaret, markCustom, debounce,
    // library helpers (injected to reuse the page's single instances)
    loadYaml, jsonata, spanRange, charToLineColumn, mergeDataOverlays,
    analyseCalls, analyseEscapeRuns, analyseWhitespace, analyseDataAccess, analyseCoverage,
    buildDependencyGraph, buildCheatSheetData,
  } = host;

  function run() {
    // run() is synchronous, so once it returns the output and its segments match
    // the current sources again — clear the stale-offset guard.
    setRenderPending(false);
    setRecomputing(false); // I-1 · debounce window ended; clear before sync work
    ctx.caches.lastData = null; // reset; reassigned once data is parsed + transformed below
    ctx.caches.dockProblems = []; // success leaves this empty; error paths populate it below
    // Reset per-run analyses so a stale value never leaks into the dock.
    ctx.caches.lastTimings = null; ctx.caches.lastAst = null; ctx.caches.lastDataAccess = []; ctx.caches.lastWhitespace = [];
    ctx.caches.lastDeps = null; ctx.caches.lastCalls = []; ctx.caches.lastEscapeRuns = null; ctx.caches.lastCoverage = [];
    ctx.caches.lastAnalyse = { ok: true, findings: [] };
    ctx.caches.lastLint = { ok: true, findings: [] };
    ctx.caches.lastRequiredAssigns = []; ctx.caches.lastMissingAssigns = [];
    const dataSource = getYamlSrc(); // the YAML tab's source (editor may show the transform)
    const tabs = getTabs();
    const mainSource = tabs[0].source;
    const tCompileStart = performance.now();
    // Compile with span provenance so the rendered output can be mapped back to its
    // source files/tags in the Source view.
    const compiled = renderer.compile(mainSource, partialsMap(), { map: true, standalone: getStandalone() });
    const tCompileEnd = performance.now();

    if (compiled.errors) {
      ctx.caches.lastProgram = null;
      ctx.caches.lastUsedTransformers = [];
      // The compiler reports every recoverable parse error in one pass, in source
      // order. Each names the file ("main" or a partial); map its byte span into
      // that file's source for line/column, and underline only the errors in the
      // tab currently shown.
      const activeFile = tabs[getActiveTabIdx()]?.name;
      const diags = [];
      const seen = new Set();
      const problems = [];
      for (const e of compiled.errors) {
        const file = e.file || "main";
        const src = fileSource(file);
        const [from, to] = spanRange(src, e.start, e.end);
        const pos = charToLineColumn(src, from);
        // Dedupe identical errors (e.g. a partial expanded at several sites).
        const key = `${file}:${pos.line}:${pos.column}:${e.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (file === activeFile) diags.push({ from, to, severity: "error", message: e.message });
        problems.push({ severity: "error", file, line: pos.line, col: pos.column, message: e.message });
      }
      updateDiagnostics(diags);
      const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : "";
      const first = problems[0];
      setError(`compile error: ${first.file} · ${first.message} (Ln ${first.line}, Col ${first.col})${more}`);
      ctx.caches.dockProblems = problems;
      renderDock();
      setOutput(""); saveHash(); return;
    }

    ctx.caches.lastProgram = compiled.program;
    ctx.caches.lastUsedTransformers = renderer.usedTransformers(compiled.program);
    ctx.caches.lastRequiredAssigns = renderer.requiredAssigns(compiled.program);
    clearDiagnostics();

    // Static analyses — every panel that doesn't need rendered output runs here.
    // parseAst is best-effort: a parse error on a partial leaves an empty AST for
    // that file so the dock degrades gracefully.
    const tParseStart = performance.now();
    const astsByFile = {};
    const mainAst = renderer.parseAst(mainSource);
    astsByFile.main = mainAst.ast ? mainAst.ast.nodes : [];
    for (const [name, src] of Object.entries(partialsMap())) {
      const a = renderer.parseAst(src);
      astsByFile[name] = a.ast ? a.ast.nodes : [];
    }
    ctx.caches.lastAst = astsByFile;
    ctx.caches.lastCalls = analyseCalls(astsByFile);
    ctx.caches.lastEscapeRuns = analyseEscapeRuns(astsByFile);
    ctx.caches.lastDeps = buildDependencyGraph(astsByFile);
    ctx.caches.lastWhitespace = [];
    for (const [file, src] of [["main", mainSource]].concat(Object.entries(partialsMap()))) {
      for (const w of analyseWhitespace(src, file)) ctx.caches.lastWhitespace.push(w);
    }
    const tParseEnd = performance.now();

    let data;
    try {
      data = loadYaml(dataSource || "null");
      if (typeof data === "undefined") data = null;
    } catch (err) {
      setError("invalid YAML: " + err.message);
      ctx.caches.dockProblems = [{ severity: "error", file: "data.yaml", line: (err.mark?.line ?? 0) + 1, col: (err.mark?.column ?? 0) + 1, message: "YAML · " + err.message }];
      setOutput(""); saveHash(); return;
    }

    // Data overlays (Phase 3) — parse each overlay's YAML, then deep-merge them
    // onto `data` in tab order. A per-overlay YAML parse error fails the whole
    // render the same way `data.yaml` does, attributed to the overlay's tab. Type
    // clashes become warn-severity Problems rows but don't abort the render.
    const parsedOverlays = [];
    for (const ov of getDataOverlays()) {
      if (!ov.source.trim()) continue;
      try {
        const value = loadYaml(ov.source);
        parsedOverlays.push({ name: ov.name, value });
      } catch (err) {
        setError("invalid YAML: " + ov.name + " · " + err.message);
        ctx.caches.dockProblems = [{
          severity: "error", file: ov.name,
          line: (err.mark?.line ?? 0) + 1, col: (err.mark?.column ?? 0) + 1,
          message: "YAML · " + err.message,
        }];
        setOutput(""); saveHash(); return;
      }
    }
    const overlayResult = mergeDataOverlays(data, parsedOverlays);
    data = overlayResult.merged;
    for (const c of overlayResult.clashes) {
      ctx.caches.dockProblems.push({
        severity: "missing", // re-use the warn-colour Problems styling
        file: "data.yaml", line: 1, col: 1,
        message: `overlay clash at \`${c.path || "(root)"}\` — ${c.was} replaced by ${c.now}`,
      });
    }

    // Transform step: a JSONata data → view-model preprocess (all engines). Custom
    // helpers are a separate concern, applied at render below.
    if (getTransformSrc().trim()) {
      try {
        data = jsonata(getTransformSrc()).evaluate(data);
      } catch (err) {
        ctx.caches.lastData = null;
        const message = "transform · " + (err.message || err.code || "invalid JSONata");
        setError("transform error: " + (err.message || err.code || "invalid JSONata"));
        ctx.caches.dockProblems = [{ severity: "error", file: "transform", line: 1, col: 1, message }];
        setOutput(""); saveHash(); return;
      }
    }
    ctx.caches.lastData = data; // expose the view-model to the "Render Data" output view

    // Inject catalog-driven transformer lists for the cheat-sheet example so the
    // template never hard-codes transformer metadata.
    if (getLoadedExampleIdx() >= 0 && examples[getLoadedExampleIdx()]?.id === "cheat-sheet") {
      data = buildCheatSheetData(data, renderer.catalog());
      ctx.caches.lastData = data;
    }

    // Data-aware analyses, now that the view-model is finalized. Coverage uses the
    // engine's default truthiness for dead-branch classification.
    ctx.caches.lastDataAccess = analyseDataAccess(astsByFile, data);
    ctx.caches.lastCoverage = analyseCoverage(astsByFile, data);
    // ADR-022: trace the render and collect the truthiness portability findings for
    // the Truthiness dock panel (FlatBars engine only). ADR-030: when config.yaml
    // declares safe paths, route through analyzeWith so the panel suppresses those
    // paths' potential + miss findings.
    ctx.caches.lastAnalyseSuppressed = 0;
    const labPathSchema = getLabPathSchema();
    if (typeof renderer.analyze !== "function") {
      ctx.caches.lastAnalyse = { ok: true, findings: [] };
    } else if (labPathSchema.length && typeof renderer.analyzeWith === "function") {
      // ADR-030: the schema'd pass is what the panel shows; an unschema'd pass
      // counts how many potential/miss findings the schema removed (advisory
      // findings only — observed findings are never suppressed).
      ctx.caches.lastAnalyse = renderer.analyzeWith((p) => !labPathSchema.includes(p), { source: mainSource }, data);
      const unsch = renderer.analyze({ source: mainSource }, data);
      const advisory = (r) => (r.findings || []).filter((f) => f.kind === "potential" || f.kind === "miss").length;
      if (ctx.caches.lastAnalyse.ok && unsch.ok) ctx.caches.lastAnalyseSuppressed = Math.max(0, advisory(unsch) - advisory(ctx.caches.lastAnalyse));
    } else {
      ctx.caches.lastAnalyse = renderer.analyze({ source: mainSource }, data);
    }
    // ADR-019: deprecated-alias + non-canonical scoped-variable findings for the
    // active dialect (the Lint dock panel; FlatBars engines only).
    ctx.caches.lastLint = typeof renderer.lint === "function"
      ? renderer.lint(mainSource)
      : { ok: true, findings: [] };
    refreshCoverageGutter();
    // Engine-reported assigns that aren't present at the data root — a tight,
    // false-positive-free "missing assigns" signal (Data Access).
    const dataKeys = (data && typeof data === "object" && !Array.isArray(data))
      ? new Set(Object.keys(data)) : new Set();
    ctx.caches.lastMissingAssigns = ctx.caches.lastRequiredAssigns.filter((n) => !dataKeys.has(n));
    // Promote each missing assign to a Problems row at warn severity, so the dock's
    // auto-open behaviour fires for a missing key just like for compile errors. The
    // first source span that references the assign is the jump target.
    for (const name of ctx.caches.lastMissingAssigns) {
      const firstHit = ctx.caches.lastDataAccess.find((r) => r.path === name || r.path.startsWith(name + "."));
      const file = firstHit?.file || "main";
      const src = fileSource(file);
      const pos = firstHit && typeof firstHit.start === "number"
        ? charToLineColumn(src, spanRange(src, firstHit.start, firstHit.end)[0])
        : { line: 1, column: 1 };
      ctx.caches.dockProblems.push({
        severity: "missing",
        file, line: pos.line, col: pos.column,
        message: `missing assign '${name}' — referenced by the template but not present in data`,
      });
    }

    const tRenderStart = performance.now();
    // Transformer allow-list (Render Config, ADR-0013) — refuse to render when the
    // compiled program calls a name outside the configured positive list.
    // `allowList === null` (the default) means "no constraint".
    const allowList = getAllowList();
    const denied = allowList !== null
      ? [...new Set(ctx.caches.lastUsedTransformers.filter((n) => !allowList.includes(n)))]
      : [];
    if (denied.length) {
      const plural = denied.length > 1 ? "s" : "";
      setError(`not in allow-list: transformer${plural} '${denied.join("', '")}'`);
      ctx.caches.dockProblems.push({
        severity: "cap", file: "main", line: 1, col: 1,
        message: `transformer${plural} '${denied.join("', '")}' not in the render-config allow-list — add to \`transformers.allow\` to render`,
      });
      setOutput(""); renderDock(); saveHash();
      ctx.caches.lastTimings = null;
      return;
    }
    try {
      const program = applyEscape(compiled.program, getEscapeMode(), engineHas("escape-modes"));
      // Custom-helper render (ADR-018/019): the registerHelper source runs in the
      // Worker sandbox, out of band. Use the cached result when it matches the
      // current inputs; otherwise show "rendering…" and let the async render re-run.
      // Both helpers.js and the catalog work on every FlatBars dialect (t-surfaces
      // RawBars/ClassicBars/MaxBars, ADR-029) — MinBars excluded (logic-less).
      const helperSrc = (ENGINE !== "minbars") ? (getHelpersSrc() || "").trim() : "";
      const catSrc = (ENGINE !== "minbars") ? (getCatalogSource() || "").trim() : "";
      let output, segments;
      if (helperSrc || catSrc) {
        const key = helperKey(mainSource, partialsMap(), data, helperSrc, catSrc, getLabLocale(), ENGINE);
        const helperCache = getHelperCache();
        if (helperCache.key !== key) {
          requestHelperRender(key, { dialect: ENGINE, template: mainSource, data, partials: partialsMap(), helperSrc, catalogSrc: catSrc, locale: getLabLocale() });
          setOutput("rendering…"); setError(""); renderDock(); saveHash(); ctx.caches.lastTimings = null;
          return;
        }
        if (helperCache.error) {
          setError(helperCache.error); setOutput(""); renderDock(); saveHash(); ctx.caches.lastTimings = null;
          return;
        }
        output = helperCache.output; segments = [];
      } else {
        ({ output, segments } = renderer.render(program, data, { map: true, compat: getMinbarsCompat() }));
      }
      setOutput(output, segments);
      setError("");
    } catch (err) {
      // `err.kind === "policy"` flags an allow-list / `eval`-gate refusal (badged
      // amber); anything else is a runtime render error (red).
      const isPolicy = err && err.kind === "policy";
      // The engine prefixes a located error with `line:col: ` — lift that into the
      // problem's position so the header reads e.g. `main:15:1`, and drop the prefix.
      let line = 1, col = 1, message = (err && err.message) || String(err);
      const at = /^(\d+):(\d+):\s*/.exec(message);
      if (at) { line = +at[1]; col = +at[2]; message = message.slice(at[0].length); }
      setError("render error: " + message);
      ctx.caches.dockProblems = [{ severity: isPolicy ? "cap" : "render", file: "main", line, col, message }];
      setOutput("");
    }
    const tRenderEnd = performance.now();
    ctx.caches.lastTimings = {
      parseMs: tParseEnd - tParseStart,
      compileMs: tCompileEnd - tCompileStart,
      renderMs: tRenderEnd - tRenderStart,
      totalMs: (tCompileEnd - tCompileStart) + (tParseEnd - tParseStart) + (tRenderEnd - tRenderStart),
      outBytes: (ctx.caches.lastOutput || "").length,
    };
    renderDock();
    saveHash();
    // Re-apply the caret→output highlight against the freshly rendered runs.
    resetCaretLink();
    syncOutputToCaret();
  }

  const debouncedRun = debounce(run, 100);

  function scheduleRun() { markCustom(); setRenderPending(true); setRecomputing(true); debouncedRun(); }

  return { run, scheduleRun };
}
