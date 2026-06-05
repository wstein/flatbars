// SPDX-License-Identifier: Apache-2.0
//
// A runnable i18n cell for the "Localize" guide (ADR-029 C+). The Lab acts as the
// HOST: it binds a `t` helper (../i18n.mjs `makeTHelper`, backed by the browser's
// native Intl) and renders an editable FullBars template LIVE through the exact
// engine the Lab ships (lab/vendor/flatbars-engine.mjs `renderWith`). Flip the
// locale or bump the count and the plural/number formatting re-derives from Intl —
// no i18next vendored, no engine feature. Chrome reuses the .oil-* classes from
// open-in-lab.css (imported by the Reference layout) so the cell matches the rest.
import { useEffect, useRef, useState } from "preact/hooks";
import { makeI18nHelpers, locales } from "../i18n.mjs";
import { renderWith } from "../../../lab/vendor/flatbars-engine.mjs";
import { highlightTemplate, esc } from "../lib/highlight.mjs";

const LOCALE_NAMES = { en: "English", de: "Deutsch", pl: "Polski" };

// One template editor: a highlight <pre> with a transparent <textarea> on top,
// height synced after each render (same technique as TryJsonata's Editor).
function Editor({ value, onInput, label }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const html = highlightTemplate(value, "fullbars") + "\n";
  useEffect(() => {
    const ta = taRef.current, pre = preRef.current;
    if (!ta || !pre) return;
    ta.style.height = "auto";
    const h = ta.scrollHeight;
    ta.style.height = h + "px";
    pre.style.height = h + "px";
  });
  return (
    <div class="oil-ed" data-lang="flatbars">
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

export default function TryI18n({ template = "", data = {}, locale = "en" }) {
  const initialTemplate = (template || "").replace(/\n+$/, "");
  const initialCount = typeof data.count === "number" ? data.count : 1;
  const [tpl, setTpl] = useState(initialTemplate);
  const [loc, setLoc] = useState(locale);
  const [count, setCount] = useState(initialCount);
  const [edited, setEdited] = useState(false);
  const [out, setOut] = useState({ ok: true, text: "" });

  const usesCount = /\bcount\b/.test(tpl);

  useEffect(() => {
    if (tpl.trim() === "") { setOut({ ok: true, text: "" }); return; }
    try {
      const renderData = usesCount ? { ...data, count } : data;
      const r = renderWith(makeI18nHelpers(loc), {}, tpl, renderData ?? {});
      setOut(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error });
    } catch (e) {
      setOut({ ok: false, text: String((e && e.message) || e) });
    }
  }, [tpl, loc, count]);

  const onTpl = (v) => { setTpl(v); setEdited(true); };
  const onLoc = (v) => { setLoc(v); setEdited(true); };
  const onCount = (v) => { setCount(Number(v)); setEdited(true); };
  const reset = () => { setTpl(initialTemplate); setLoc(locale); setCount(initialCount); setEdited(false); };

  return (
    <figure class={"oil oil-i18n" + (edited ? " is-edited" : "")}>
      <div class="oil-actions">
        {edited && (
          <button type="button" class="oil-reset" title="Restore the original example" onClick={reset}>
            <span class="oil-ic">↺</span> Reset
          </button>
        )}
      </div>

      <div class="i18n-controls">
        <div class="i18n-locales" role="group" aria-label="Locale">
          {locales.map((l) => (
            <button
              type="button"
              class={"i18n-loc" + (l === loc ? " is-active" : "")}
              aria-pressed={l === loc}
              onClick={() => onLoc(l)}
            >
              {LOCALE_NAMES[l] || l}
            </button>
          ))}
        </div>
        {usesCount && (
          <label class="i18n-count">
            count
            <input
              type="number"
              min="0"
              value={count}
              onInput={(e) => onCount(e.currentTarget.value)}
              aria-label="count — drives the plural category"
            />
          </label>
        )}
      </div>

      <div class="oil-cell">
        <div class="oil-cell-head"><span class="oil-cap">template · FullBars</span></div>
        <Editor value={tpl} onInput={onTpl} label="FullBars template — editable" />
      </div>

      <div class="oil-out">
        <div class="oil-cell-head oil-out-head"><span class="oil-cap">output · {LOCALE_NAMES[loc] || loc}</span></div>
        <pre class={"oil-out-pre" + (out.ok ? "" : " err")}><code>{out.text}</code></pre>
      </div>
    </figure>
  );
}
