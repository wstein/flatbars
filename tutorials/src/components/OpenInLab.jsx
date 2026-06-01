// SPDX-License-Identifier: Apache-2.0
//
// The interactive lesson island: shows the template, renders a LIVE preview
// through the real engine bundle the Lab ships (dogfooding — consensus item 3),
// and offers an "Open in Lab" link built from the shared contract (item 1).
import { useEffect, useState } from "preact/hooks";
import { labHref } from "../../../lab/open-in-lab.mjs";
import { createBareBarsRenderer } from "../../../lab/barebars.mjs";
import { createMinBarsRenderer } from "../../../lab/minbars.mjs";

const DIALECT = { rawbars: "core", fullbars: "surface", maxbars: "maxbars" };

async function renderExample(engine, { template, data, partials }) {
  const r = engine === "minbars"
    ? await createMinBarsRenderer()
    : await createBareBarsRenderer(DIALECT[engine]);
  try {
    return { ok: true, out: r.render(r.compile(template, partials || {}).program, data ?? {}) };
  } catch (e) {
    return { ok: false, out: String((e && e.message) || e) };
  }
}

// Where the Lab is served. Same-origin `/lab/` in production (one host serves
// both); in local dev the tutorials run on their own port, so point this at the
// running `npm run lab` server, e.g. PUBLIC_LAB_URL=http://localhost:8000/lab/index.html.
const LAB_URL = import.meta.env.PUBLIC_LAB_URL || "/lab/index.html";

export default function OpenInLab({ engine, template, data = {}, partials = {}, labUrl = LAB_URL }) {
  const [href, setHref] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    labHref(engine, { template, data, partials }, { labUrl }).then((h) => live && setHref(h));
    renderExample(engine, { template, data, partials }).then((p) => live && setPreview(p));
    return () => { live = false; };
  }, []);

  return (
    <div class="oil">
      <div class="oil-grid">
        <figure class="oil-pane">
          <figcaption>template</figcaption>
          <pre><code>{template}</code></pre>
        </figure>
        <figure class="oil-pane">
          <figcaption>rendered ({engine})</figcaption>
          {preview == null
            ? <pre><em>rendering…</em></pre>
            : <pre class={preview.ok ? "" : "oil-err"}><code>{preview.out}</code></pre>}
        </figure>
      </div>
      <a class="oil-btn" href={href ?? "#"} target="_blank" rel="noopener noreferrer"
         aria-disabled={href == null}>Open in Lab ↗</a>
    </div>
  );
}
