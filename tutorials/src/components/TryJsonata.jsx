// SPDX-License-Identifier: Apache-2.0
//
// A runnable JSONata cell for the "Data shaping" guide. Two editable panes —
// the input data (YAML, the Lab's native data format) and a JSONata expression —
// re-evaluate LIVE through the exact engine the Lab ships (lab/vendor/jsonata.mjs;
// `evaluate` is synchronous in this build), so a tutorial snippet and the Lab can
// never diverge. Output is the resulting view-model as pretty JSON. The chrome
// reuses the .oil-* classes from open-in-lab.css so the cell matches the template
// playground; the page that mounts this must import that stylesheet.
import { useEffect, useRef, useState } from "preact/hooks";
import jsonata from "../../../lab/vendor/jsonata.mjs";
import { load as loadYaml, dump as dumpYaml } from "../../../lab/vendor/js-yaml.mjs";
import { highlightYaml, highlightJsonata, esc } from "../lib/highlight.mjs";

// data prop may be an object (dumped to YAML for the editor) or a YAML string
// (taken verbatim — lets an example show specific formatting/comments).
function toYaml(data) {
  if (data == null) return "";
  // Trim the trailing newline (js-yaml's dump always appends one) so the editor
  // doesn't show an empty last line / extra height.
  if (typeof data === "string") return data.replace(/\n+$/, "");
  return dumpYaml(data).replace(/\n+$/, "");
}

// One editor: a highlight <pre> with a transparent <textarea> on top, height
// synced to content after each render (same technique as OpenInLab's CodeEditor).
function Editor({ lang, value, onInput }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const html = (lang === "yaml" ? highlightYaml(value) : lang === "jsonata" ? highlightJsonata(value) : esc(value)) + "\n";
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

export default function TryJsonata({ data = {}, expr = "" }) {
  const initialData = toYaml(data);
  const initialExpr = (expr || "").replace(/\n+$/, "");
  const [dataStr, setDataStr] = useState(initialData);
  const [exprStr, setExprStr] = useState(initialExpr);
  const [edited, setEdited] = useState(false);
  const [out, setOut] = useState({ ok: true, text: "" });

  useEffect(() => {
    let input;
    try {
      input = dataStr.trim() === "" ? {} : loadYaml(dataStr);
    } catch (e) {
      setOut({ ok: false, text: "⚠ data isn’t valid YAML — " + ((e && e.message) || e) });
      return;
    }
    if (exprStr.trim() === "") { setOut({ ok: true, text: "" }); return; }
    try {
      const result = jsonata(exprStr).evaluate(input);
      // undefined ⇒ the expression matched nothing (a real, teachable JSONata
      // outcome) — show it explicitly rather than a blank pane.
      setOut({ ok: true, text: result === undefined ? "(no match — undefined)" : JSON.stringify(result, null, 2) });
    } catch (e) {
      setOut({ ok: false, text: String((e && e.message) || e) });
    }
  }, [dataStr, exprStr]);

  const onData = (v) => { setDataStr(v); setEdited(true); };
  const onExpr = (v) => { setExprStr(v); setEdited(true); };
  const reset = () => { setDataStr(initialData); setExprStr(initialExpr); setEdited(false); };

  return (
    <figure class={"oil oil-jsonata" + (edited ? " is-edited" : "")}>
      <header class="oil-bar">
        <div class="oil-bar-l">
          <span class="oil-kicker">Runnable</span>
          <span class="oil-engine">jsonata</span>
          <span class="oil-live"><span class="oil-dot" />live</span>
        </div>
        <div class="oil-actions">
          <button type="button" class="oil-reset" title="Restore the original example" onClick={reset}>
            <span class="oil-ic">↺</span> Reset
          </button>
        </div>
      </header>

      <div class="oil-grid">
        <div class="oil-cell">
          <div class="oil-cell-head"><span class="oil-cap">JSONata</span></div>
          <Editor lang="jsonata" value={exprStr} onInput={onExpr} />
        </div>
        <div class="oil-cell">
          <div class="oil-cell-head"><span class="oil-cap">data · YAML</span></div>
          <Editor lang="yaml" value={dataStr} onInput={onData} />
        </div>
      </div>

      <div class="oil-out">
        <div class="oil-cell-head oil-out-head"><span class="oil-cap">result · JSON</span></div>
        <pre class={"oil-out-pre" + (out.ok ? "" : " err")}><code>{out.text}</code></pre>
      </div>
    </figure>
  );
}
