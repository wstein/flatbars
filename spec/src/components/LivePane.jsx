// SPDX-License-Identifier: Apache-2.0
//
// A live engine pane for the spec (ADR-031): edit a template + JSON data and see
// the *real* engine output, rendered by the committed lab bundle — the same
// engine the reference implementation ships, so the spec's examples can't drift
// from the implementation. Imported into MDX pages and hydrated client-side.
import { useState, useMemo } from "preact/hooks";
import {
  renderSurface,
  renderMinbars,
  renderMaxbars,
} from "../../../lab/vendor/flatbars-engine.mjs";

const RENDERERS = {
  classicbars: renderSurface,
  minbars: renderMinbars,
  maxbars: renderMaxbars,
};

export default function LivePane({ template = "", data = "{}", dialect = "classicbars" }) {
  const [tpl, setTpl] = useState(template);
  const [dataText, setDataText] = useState(data);

  const result = useMemo(() => {
    let parsed;
    try {
      parsed = JSON.parse(dataText);
    } catch (e) {
      return { ok: false, error: "data is not valid JSON — " + e.message };
    }
    const render = RENDERERS[dialect] || renderSurface;
    try {
      return render(tpl, parsed);
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }, [tpl, dataText, dialect]);

  return (
    <div class="live-pane" data-dialect={dialect}>
      <div class="live-pane-grid">
        <label>
          <span>Template · {dialect}</span>
          <textarea
            value={tpl}
            spellcheck={false}
            rows={Math.max(3, tpl.split("\n").length)}
            onInput={(e) => setTpl(e.currentTarget.value)}
          />
        </label>
        <label>
          <span>Data (JSON)</span>
          <textarea
            value={dataText}
            spellcheck={false}
            rows={Math.max(3, dataText.split("\n").length)}
            onInput={(e) => setDataText(e.currentTarget.value)}
          />
        </label>
      </div>
      <div class="live-pane-out">
        <span>Output</span>
        <pre class={result.ok ? "" : "live-pane-err"}>{result.ok ? result.value : result.error}</pre>
      </div>
    </div>
  );
}
