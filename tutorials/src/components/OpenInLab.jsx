// SPDX-License-Identifier: Apache-2.0
//
// The runnable example card — the redesigned "Open in Lab" lesson island.
// One cohesive unit: header toolbar · editable template/data/partials · dark
// output. The template AND data are editable INLINE and re-render LIVE through
// the real engine bundle the Lab ships (dogfooding — a preview and the Lab can
// never diverge); data is YAML, the Lab's native format. The fat dangling CTA is
// gone: "Open in Lab" is demoted to a quiet, labelled control DOCKED in the
// header toolbar (the affordance chosen from the design's four; the others —
// inline/corner/foot — were collapsed). Accent + chrome come from lab-tokens.css.
import { useEffect, useRef, useState } from "preact/hooks";
import { labHref, dataText } from "../../../lab/open-in-lab.mjs";
import { load as loadYaml } from "../../../lab/vendor/js-yaml.mjs";
import { createFlatBarsRenderer } from "../../../lab/flatbars.mjs";
import { createMinBarsRenderer } from "../../../lab/minbars.mjs";
import { renderWith, safe } from "../../../lab/vendor/flatbars-engine.mjs";
import { buildHelpers } from "../../../lab/helpers.mjs";
import jsonata from "../../../lab/vendor/jsonata.mjs";
import { highlightTemplate, highlightYaml, highlightJsonata, esc } from "../lib/highlight.mjs";

const DIALECT = { rawbars: "core", fullbars: "surface", maxbars: "maxbars" };

// Where the Lab is served. Same-origin `/lab/` in production (one host serves
// both); in local dev the tutorials run on their own port, so point this at the
// running `npm run lab` server, e.g. PUBLIC_LAB_URL=http://localhost:8000/lab/index.html.
const LAB_URL = import.meta.env.PUBLIC_LAB_URL || "/lab/index.html";

// One code editor: a syntax-highlight layer with a transparent textarea atop, so
// the reader edits real text while seeing colour. Heights are synced after every
// render (the textarea auto-grows; the highlight <pre> follows it).
function CodeEditor({ lang, value, onInput, dialect = "fullbars" }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  // template → engine highlighter; yaml → data highlighter; js (custom helpers)
  // → plain escaped text (no JS grammar — the source has no FlatBars tags).
  const html =
    (lang === "yaml" ? highlightYaml(value) : lang === "jsonata" ? highlightJsonata(value) : lang === "js" ? esc(value) : highlightTemplate(value, dialect)) + "\n";

  useEffect(() => {
    const ta = taRef.current, pre = preRef.current;
    if (!ta || !pre) return;
    ta.style.height = "auto";
    const h = ta.scrollHeight;
    ta.style.height = h + "px";
    pre.style.height = h + "px";
  });

  return (
    <div class="oil-ed" data-lang={lang}>
      <pre class="oil-ed-hl" aria-hidden="true" ref={preRef}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea
        ref={taRef}
        class="oil-ed-input"
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
        onScroll={(e) => {
          const pre = preRef.current;
          if (!pre) return;
          pre.scrollTop = e.currentTarget.scrollTop;
          pre.scrollLeft = e.currentTarget.scrollLeft;
        }}
      />
    </div>
  );
}

export default function OpenInLab({ engine, template, data = {}, partials = {}, helpers = "", transform = "", labUrl = LAB_URL, compile = false }) {
  const initialData = dataText(data); // object → YAML; string → verbatim
  const [tpl, setTpl] = useState(template);
  const [dataStr, setDataStr] = useState(initialData);
  const [transformStr, setTransformStr] = useState(transform || "");
  const [parts, setParts] = useState(partials || {});
  // Custom-helper JS source (ADR-018). Only the FullBars/Handlebars surface has
  // user helpers; the cell shows when an example supplies them.
  const [helpersStr, setHelpersStr] = useState(helpers || "");
  const [edited, setEdited] = useState(false);
  const [renderer, setRenderer] = useState(null);
  const [out, setOut] = useState({ ok: true, text: null }); // text === null ⇒ "rendering…"
  const [js, setJs] = useState(null); // compiled-JS pane (opt-in via `compile`)
  const [href, setHref] = useState(null);
  // Only the compiling dialects (RawBars/FullBars/MaxBars) expose compileToJs;
  // MinBars doesn't, so the pane is gated on the method actually existing.
  const canCompile = compile && !!renderer && typeof renderer.compileToJs === "function";

  // Load the real engine bundle once (client-side only).
  useEffect(() => {
    let live = true;
    const p = engine === "minbars"
      ? createMinBarsRenderer()
      : createFlatBarsRenderer(DIALECT[engine]);
    p.then((r) => { if (live) setRenderer(r); });
    return () => { live = false; };
  }, []);

  // Live render: parse the YAML data, then run the template through the engine.
  useEffect(() => {
    if (!renderer) return;
    let data;
    try {
      data = dataStr.trim() === "" ? {} : loadYaml(dataStr);
    } catch (e) {
      setOut({ ok: false, text: "⚠ data isn’t valid YAML — " + ((e && e.message) || e) });
      return;
    }
    // Optional JSONata data-shaping pass (data → view-model) before rendering —
    // the same preprocess the Lab's transform tab runs (sync evaluate).
    if ((transformStr || "").trim()) {
      try {
        data = jsonata(transformStr).evaluate(data);
      } catch (e) {
        setOut({ ok: false, text: "⚠ transform error — " + ((e && e.message) || e) });
        return;
      }
    }
    // With custom helpers, render through the engine facade's `renderWith`
    // (which marshals the JS helpers into the interpreter); otherwise the
    // adapter's plain render. `safe(html)` is available to the helper source.
    const hsrc = (helpersStr || "").trim();
    if (hsrc) {
      const built = buildHelpers(hsrc, safe);
      if (!built.ok) { setOut({ ok: false, text: "⚠ helper error — " + built.error }); return; }
      const r = renderWith(built.helpers, parts || {}, tpl, data ?? {});
      setOut(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error });
      return;
    }
    try {
      const text = renderer.render(renderer.compile(tpl, parts || {}).program, data ?? {});
      setOut({ ok: true, text });
    } catch (e) {
      setOut({ ok: false, text: String((e && e.message) || e) });
    }
  }, [renderer, tpl, dataStr, transformStr, parts, helpersStr]);

  // Optional: compile the template to a JS module (RawBars/FullBars/MaxBars only).
  useEffect(() => {
    if (!canCompile) return;
    const r = renderer.compileToJs(tpl);
    setJs(r && r.ok ? { ok: true, text: r.value } : { ok: false, text: (r && r.error) || "compile failed" });
  }, [canCompile, renderer, tpl]);

  // Rebuild the Open-in-Lab deep link from the (possibly edited) workspace.
  useEffect(() => {
    let live = true;
    labHref(engine, { template: tpl, data: dataStr, partials: parts, helpers: helpersStr, transform: transformStr }, { labUrl })
      .then((h) => { if (live) setHref(h); })
      .catch(() => {});
    return () => { live = false; };
  }, [tpl, dataStr, transformStr, parts, helpersStr]);

  // A full-width template row only pays off when the template is actually wide
  // (multi-line or long); a short one-liner like `{{> card}}` would just leave a
  // near-empty band, so it shares the row with data + partials instead.
  const partialNames = Object.keys(parts);
  const wideTemplate = tpl.includes("\n") || tpl.length > 30;
  const hasHelpers = (helpersStr || "").trim().length > 0;
  const hasTransform = (transformStr || "").trim().length > 0;
  // With a JSONata transform (and no partials) the cell uses a dedicated layout:
  // transform + data side by side on top, template spanning both columns below
  // (see open-in-lab.css).
  const gridClass =
    "oil-grid" + (partialNames.length ? " has-partials" : "") + (partialNames.length && wideTemplate ? " wide-tpl" : "") +
    (hasTransform && !partialNames.length ? " has-transform" : "");

  const onTpl = (v) => { setTpl(v); setEdited(true); };
  const onData = (v) => { setDataStr(v); setEdited(true); };
  const onPart = (name, v) => { setParts((p) => ({ ...p, [name]: v })); setEdited(true); };
  const onHelpers = (v) => { setHelpersStr(v); setEdited(true); };
  const onTransform = (v) => { setTransformStr(v); setEdited(true); };
  const reset = () => {
    setTpl(template);
    setDataStr(initialData);
    setTransformStr(transform || "");
    setParts(partials || {});
    setHelpersStr(helpers || "");
    setEdited(false);
  };

  return (
    <figure class={"oil" + (edited ? " is-edited" : "")} data-affordance="dock">
      {/* Floating actions (design Option C): reveal on hover/focus-within; Reset
          appears only once edited — a pristine card shows just Open-in-Lab. */}
      <div class="oil-actions">
        {edited && (
          <button type="button" class="oil-reset" title="Restore the original example" onClick={reset}>
            <span class="oil-ic">↺</span> Reset
          </button>
        )}
        {/* A named target reuses one Lab tab across every "Open in Lab" click. */}
        <a class="oil-lab oil-lab-dock" href={href ?? "#"} target="flatbars-lab" rel="noopener"
           aria-disabled={href == null} title="Open this example in the full Lab editor">
          <span class="oil-lab-txt">Open in Lab</span>
          <span class="oil-lab-ic" aria-hidden="true">↗</span>
        </a>
      </div>

      <div class={gridClass}>
        <div class="oil-cell oil-tpl">
          <div class="oil-cell-head"><span class="oil-cap">template</span></div>
          <CodeEditor lang="template" value={tpl} onInput={onTpl} dialect={engine} />
        </div>
        <div class="oil-cell oil-data">
          <div class="oil-cell-head"><span class="oil-cap">data</span></div>
          <CodeEditor lang="yaml" value={dataStr} onInput={onData} />
        </div>
        {hasTransform && (
          <div class="oil-cell oil-transform">
            <div class="oil-cell-head"><span class="oil-cap">transform · JSONata</span><span class="oil-js-note">— data → view-model</span></div>
            <CodeEditor lang="jsonata" value={transformStr} onInput={onTransform} />
          </div>
        )}
        {Object.keys(parts).map((name) => (
          <div class="oil-cell" key={name}>
            <div class="oil-cell-head"><span class="oil-cap">partial · {name}</span></div>
            <CodeEditor lang="template" value={parts[name]} onInput={(v) => onPart(name, v)} dialect={engine} />
          </div>
        ))}
        {hasHelpers && (
          <div class="oil-cell">
            <div class="oil-cell-head"><span class="oil-cap">helpers · JS</span><span class="oil-js-note">— registerHelper</span></div>
            <CodeEditor lang="js" value={helpersStr} onInput={onHelpers} />
          </div>
        )}
      </div>

      <div class="oil-out">
        <div class="oil-cell-head oil-out-head"><span class="oil-cap">output</span></div>
        {out.text == null
          ? <pre class="oil-out-pre"><em>rendering…</em></pre>
          : <pre class={"oil-out-pre" + (out.ok ? "" : " err")}><code>{out.text}</code></pre>}
      </div>

      {canCompile && (
        <div class="oil-out oil-js">
          <div class="oil-cell-head oil-out-head">
            <span class="oil-cap">compiled JS</span>
            <span class="oil-js-note">— byte-identical output to the interpreter</span>
          </div>
          {js == null
            ? <pre class="oil-out-pre"><em>compiling…</em></pre>
            : <pre class={"oil-out-pre" + (js.ok ? "" : " err")}><code>{js.text}</code></pre>}
        </div>
      )}
    </figure>
  );
}
