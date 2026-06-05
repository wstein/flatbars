// SPDX-License-Identifier: Apache-2.0
//
// The ONE shared message catalog, shown once at the top of the Localize guide and
// edited in place. Every example card (I18nCard) reads the same catalog through the
// cross-island store, so the examples don't each carry their own copy — edit a
// translation (or add a key) here and every `t` card below re-renders live. Chrome
// reuses the .oil-* classes from open-in-lab.css so it matches the example cards.
import { useEffect, useRef } from "preact/hooks";
import { useCatalog, setCatalog, resetCatalog, initialCatalog } from "../lib/catalog-store.mjs";
import { highlightYaml } from "../lib/highlight.mjs";

export default function CatalogReference() {
  const value = useCatalog();
  const taRef = useRef(null);
  const preRef = useRef(null);
  const html = highlightYaml(value) + "\n";
  useEffect(() => {
    const ta = taRef.current, pre = preRef.current;
    if (!ta || !pre) return;
    ta.style.height = "auto";
    const h = ta.scrollHeight;
    ta.style.height = h + "px";
    pre.style.height = h + "px";
  });
  const edited = value !== initialCatalog;
  return (
    <figure class={"oil oil-catalog-ref" + (edited ? " is-edited" : "")}>
      <div class="oil-actions">
        {edited && (
          <button type="button" class="oil-reset" title="Restore the original catalog" onClick={resetCatalog}>
            <span class="oil-ic">↺</span> Reset
          </button>
        )}
      </div>
      <div class="oil-cell">
        <div class="oil-cell-head">
          <span class="oil-cap">catalog · YAML</span>
          <span class="oil-js-note">— shared by every example below · locale → key → message</span>
        </div>
        <div class="oil-ed" data-lang="yaml">
          <pre class="oil-ed-hl" aria-hidden="true" ref={preRef}>
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          <textarea
            ref={taRef}
            class="oil-ed-input"
            aria-label="Shared message catalog — YAML, editable"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            value={value}
            onInput={(e) => setCatalog(e.currentTarget.value)}
            onScroll={(e) => {
              const pre = preRef.current;
              if (!pre) return;
              pre.scrollTop = e.currentTarget.scrollTop;
              pre.scrollLeft = e.currentTarget.scrollLeft;
            }}
          />
        </div>
      </div>
    </figure>
  );
}
