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
import { renderWith, renderRawWith, renderMaxWith, safe, lint as runLint } from "../../../lab/vendor/flatbars-engine.mjs";
import { buildHelpers } from "../../../lab/helpers.mjs";
import { makeI18nBag } from "../../../lab/i18n.mjs";
import jsonata from "../../../lab/vendor/jsonata.mjs";
import { highlightTemplate, highlightYaml, highlightJsonata, esc } from "../lib/highlight.mjs";

const DIALECT = { rawbars: "core", fullbars: "surface", maxbars: "maxbars" };
// The operations-aware render entry per surface (for the catalog/helpers path).
const RENDER_WITH = { rawbars: renderRawWith, fullbars: renderWith, maxbars: renderMaxWith };

// Where the Lab is served. Same-origin `/lab/` in production (one host serves
// both); in local dev the tutorials run on their own port, so point this at the
// running `npm run lab` server, e.g. PUBLIC_LAB_URL=http://localhost:8000/lab/index.html.
const LAB_URL = import.meta.env.PUBLIC_LAB_URL || "/lab/index.html";

// One code editor: a syntax-highlight layer with a transparent textarea atop, so
// the reader edits real text while seeing colour. Heights are synced after every
// render (the textarea auto-grows; the highlight <pre> follows it).
function CodeEditor({ lang, value, onInput, dialect = "fullbars", label }) {
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
        aria-label={label}
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

export default function OpenInLab({ engine, template, data = {}, partials = {}, helpers = "", transform = "", catalog = "", locale = "en", locales = null, localeNames = {}, sharedCatalog = false, labUrl = LAB_URL, compile = false, lint = false }) {
  const initialData = dataText(data); // object → YAML; string → verbatim
  const [tpl, setTpl] = useState(template);
  const [dataStr, setDataStr] = useState(initialData);
  // i18n cards (ADR-029) get a live locale switcher; `loc` drives the render, the
  // deep-link, and the output caption. The message `catalog.yaml` is editable too —
  // shown as its own pane (below) so the example is self-contained — so it is state.
  // `isI18n` = a catalog or a locale switcher is present, so the t/number/date/… bag
  // is built even when the catalog is empty (the formatting cells use no `t` key but
  // still need the native-Intl helpers).
  const [loc, setLoc] = useState(locale);
  const [catalogStr, setCatalogStr] = useState(catalog || "");
  // `sharedCatalog` cards take the catalog from a shared store (passed live via the
  // `catalog` prop, re-supplied on every edit) and show no catalog pane — the
  // catalog lives once, at the top of the page. Plain cards own an editable copy
  // (`catalogStr`) shown as a pane.
  const effectiveCatalog = sharedCatalog ? (catalog || "") : catalogStr;
  const isI18n = !!(effectiveCatalog && effectiveCatalog.trim()) || !!(locales && locales.length);
  const [transformStr, setTransformStr] = useState(transform || "");
  const [parts, setParts] = useState(partials || {});
  // Custom-helper JS source (ADR-018). Only the FullBars/Handlebars surface has
  // user helpers; the cell shows when an example supplies them.
  const [helpersStr, setHelpersStr] = useState(helpers || "");
  const [edited, setEdited] = useState(false);
  const [renderer, setRenderer] = useState(null);
  const [out, setOut] = useState({ ok: true, text: null }); // text === null ⇒ "rendering…"
  const [js, setJs] = useState(null); // compiled-JS pane (opt-in via `compile`)
  const [lintRes, setLintRes] = useState(null); // live lint pane (opt-in via `lint`)
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
    // The i18n catalog (ADR-029) builds the t/number/… bag, bound to the active
    // `loc`; explicit helpers.js overrides it — the same merge the Lab's worker
    // does. The bag is built whenever this is an i18n card, even with an empty
    // catalog, so the pure-formatting cells (number/date/…) get their helpers.
    let i18nHelpers = {};
    if (isI18n) {
      let messages = {};
      if (effectiveCatalog && effectiveCatalog.trim()) {
        try {
          messages = loadYaml(effectiveCatalog) || {};
        } catch (e) {
          setOut({ ok: false, text: "⚠ catalog.yaml — " + ((e && e.message) || e) });
          return;
        }
      }
      i18nHelpers = makeI18nBag(messages, loc);
    }
    const hsrc = (helpersStr || "").trim();
    if (hsrc || Object.keys(i18nHelpers).length) {
      const built = buildHelpers(hsrc, safe);
      if (!built.ok) { setOut({ ok: false, text: "⚠ helper error — " + built.error }); return; }
      const render = RENDER_WITH[engine] || renderWith;
      const r = render({ ...i18nHelpers, ...built.helpers }, parts || {}, tpl, data ?? {});
      setOut(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error });
      return;
    }
    try {
      const text = renderer.render(renderer.compile(tpl, parts || {}).program, data ?? {});
      setOut({ ok: true, text });
    } catch (e) {
      setOut({ ok: false, text: String((e && e.message) || e) });
    }
  }, [renderer, tpl, dataStr, transformStr, parts, helpersStr, effectiveCatalog, loc, isI18n]);

  // Optional: compile the template to a JS module (RawBars/FullBars/MaxBars only).
  useEffect(() => {
    if (!canCompile) return;
    const r = renderer.compileToJs(tpl);
    setJs(r && r.ok ? { ok: true, text: r.value } : { ok: false, text: (r && r.error) || "compile failed" });
  }, [canCompile, renderer, tpl]);

  // Optional: run `flatbars lint` live as the template is edited, so the canonical-
  // ization findings track every keystroke (the same `lint` the CLI/CI gate uses).
  // Pure analysis — no render needed, so it doesn't wait on the engine adapter.
  useEffect(() => {
    if (!lint) return;
    try {
      const r = runLint(tpl, engine);
      setLintRes(r && r.ok
        ? { ok: true, report: r.report, findings: r.findings || [] }
        : { ok: false, report: (r && r.error) || "lint failed", findings: [] });
    } catch (e) {
      setLintRes({ ok: false, report: String((e && e.message) || e), findings: [] });
    }
  }, [lint, tpl, engine]);

  // Rebuild the Open-in-Lab deep link from the (possibly edited) workspace. The
  // i18n catalog + locale round-trip into the Lab's LOCALIZATION/catalog.yaml and
  // config.yaml views (ADR-029).
  useEffect(() => {
    let live = true;
    labHref(engine, { template: tpl, data: dataStr, partials: parts, helpers: helpersStr, transform: transformStr, catalog: effectiveCatalog, locale: loc }, { labUrl })
      .then((h) => { if (live) setHref(h); })
      .catch(() => {});
    return () => { live = false; };
  }, [tpl, dataStr, transformStr, parts, helpersStr, effectiveCatalog, loc]);

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
  const showCatalog = !sharedCatalog && (catalogStr || "").trim().length > 0;
  const gridClass =
    "oil-grid" + (partialNames.length ? " has-partials" : "") + (partialNames.length && wideTemplate ? " wide-tpl" : "") +
    (hasTransform && !partialNames.length ? " has-transform" : "") + (showCatalog ? " has-catalog" : "");

  // i18n controls: a locale switcher (when `locales` is given) and a ± stepper for
  // every numeric data field the template references (count, num, offset, …) — a
  // quick way to explore plural categories and formatting without hand-editing the
  // YAML. Each stepper writes its field back to the data YAML (one source of truth:
  // it stays visible/editable in the data pane and rides the deep-link).
  const showLocales = isI18n && locales && locales.length > 1;
  const numFields = (() => {
    if (!isI18n) return [];
    let d;
    try { d = dataStr.trim() === "" ? {} : loadYaml(dataStr); } catch { return []; }
    if (!d || typeof d !== "object" || Array.isArray(d)) return [];
    return Object.keys(d)
      .filter((k) => typeof d[k] === "number" && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(tpl))
      .map((k) => ({ name: k, value: d[k] }));
  })();

  const onTpl = (v) => { setTpl(v); setEdited(true); };
  const onData = (v) => { setDataStr(v); setEdited(true); };
  const onPart = (name, v) => { setParts((p) => ({ ...p, [name]: v })); setEdited(true); };
  const onHelpers = (v) => { setHelpersStr(v); setEdited(true); };
  const onTransform = (v) => { setTransformStr(v); setEdited(true); };
  const onCatalog = (v) => { setCatalogStr(v); setEdited(true); };
  const onLoc = (v) => { setLoc(v); setEdited(true); };
  // A `count` is a non-negative quantity, so its stepper floors at 0; a genuinely
  // signed field — a relative-time `offset`, a value to `number`-format — is left
  // free to go negative.
  const minForField = (field) => (field.toLowerCase() === "count" ? 0 : -Infinity);
  const onNum = (field, v) => {
    let d;
    try { d = dataStr.trim() === "" ? {} : loadYaml(dataStr); } catch { return; }
    setDataStr(dataText({ ...(d || {}), [field]: Math.max(minForField(field), Number(v) || 0) }));
    setEdited(true);
  };
  const reset = () => {
    setTpl(template);
    setDataStr(initialData);
    setTransformStr(transform || "");
    setParts(partials || {});
    setHelpersStr(helpers || "");
    setCatalogStr(catalog || "");
    setLoc(locale);
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
        {/* A named target reuses one Lab tab across every "Open in Lab" click.
            Rendered only once the deep-link is built — `aria-disabled` doesn't
            actually disable an <a>, so a null-href link would just be a focusable
            dead control. The link resolves near-instantly on the client. */}
        {href && (
          <a class="oil-lab oil-lab-dock" href={href} target="flatbars-lab" rel="noopener"
             title="Open this example in the full Lab editor">
            <span class="oil-lab-txt">Open in Lab</span>
            <span class="oil-lab-ic" aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {(showLocales || numFields.length > 0) && (
        <div class="oil-i18n-bar">
          {showLocales && (
            <div class="oil-loc-field">
              <span class="oil-cap">locale</span>
              <div class="oil-loc-seg" role="group" aria-label="Locale">
                {locales.map((l) => (
                  <button type="button" key={l} class={"oil-loc" + (l === loc ? " is-active" : "")}
                          aria-pressed={l === loc} onClick={() => onLoc(l)}>
                    {localeNames[l] || l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {numFields.map(({ name, value }) => (
            <div class="oil-count-field" key={name}>
              <span class="oil-cap">{name}</span>
              <div class="oil-count">
                <button type="button" class="oil-count-btn" aria-label={`Decrease ${name}`}
                        disabled={value <= minForField(name)}
                        onClick={() => onNum(name, value - 1)}>−</button>
                <input type="number" class="oil-count-in" value={value}
                       min={minForField(name) === -Infinity ? undefined : minForField(name)}
                       aria-label={`${name} — numeric value`}
                       onInput={(e) => onNum(name, e.currentTarget.value)} />
                <button type="button" class="oil-count-btn" aria-label={`Increase ${name}`}
                        onClick={() => onNum(name, value + 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div class={gridClass}>
        <div class="oil-cell oil-tpl">
          <div class="oil-cell-head"><span class="oil-cap">template</span></div>
          <CodeEditor lang="template" value={tpl} onInput={onTpl} dialect={engine} label="Template — editable" />
        </div>
        <div class="oil-cell oil-data">
          <div class="oil-cell-head"><span class="oil-cap">data</span></div>
          <CodeEditor lang="yaml" value={dataStr} onInput={onData} label="Data — YAML, editable" />
        </div>
        {showCatalog && (
          <div class="oil-cell oil-catalog">
            <div class="oil-cell-head"><span class="oil-cap">catalog · YAML</span><span class="oil-js-note">— host messages, by locale</span></div>
            <CodeEditor lang="yaml" value={catalogStr} onInput={onCatalog} label="Message catalog — YAML, editable" />
          </div>
        )}
        {hasTransform && (
          <div class="oil-cell oil-transform">
            <div class="oil-cell-head"><span class="oil-cap">transform · JSONata</span><span class="oil-js-note">— data → view-model</span></div>
            <CodeEditor lang="jsonata" value={transformStr} onInput={onTransform} label="Transform — JSONata, editable" />
          </div>
        )}
        {Object.keys(parts).map((name) => (
          <div class="oil-cell" key={name}>
            <div class="oil-cell-head"><span class="oil-cap">partial · {name}</span></div>
            <CodeEditor lang="template" value={parts[name]} onInput={(v) => onPart(name, v)} dialect={engine} label={`Partial ${name} — editable`} />
          </div>
        ))}
        {hasHelpers && (
          <div class="oil-cell">
            <div class="oil-cell-head"><span class="oil-cap">helpers · JS</span><span class="oil-js-note">— registerHelper</span></div>
            <CodeEditor lang="js" value={helpersStr} onInput={onHelpers} label="Helpers — JavaScript, editable" />
          </div>
        )}
      </div>

      <div class="oil-out">
        <div class="oil-cell-head oil-out-head">
          <span class="oil-cap">output</span>
          {isI18n && <span class="oil-js-note">— {localeNames[loc] || loc}</span>}
        </div>
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

      {lint && (
        <div class="oil-out oil-lint">
          <div class="oil-cell-head oil-out-head">
            <span class="oil-cap">flatbars lint</span>
            <span class="oil-js-note">— live canonicalization findings</span>
          </div>
          {lintRes == null
            ? <pre class="oil-out-pre"><em>linting…</em></pre>
            : <pre class={"oil-out-pre" + (lintRes.ok ? "" : " err")}>
                <code class={lintRes.findings.length ? "oil-lint-warn" : "oil-lint-ok"}>{lintRes.report}</code>
              </pre>}
        </div>
      )}
    </figure>
  );
}
