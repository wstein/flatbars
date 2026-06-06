// SPDX-License-Identifier: Apache-2.0
//
// "Portability at scale" — a compact gallery that runs analyse mode over several
// realistic templates at once (../analyse.mjs `gallery`), so the tool is shown
// beyond the single-value teaching cards. Each tile renders the LIVE finding
// summary from the engine bundle (the same `analyze` the Lab and the gate use) and
// links into the Lab's Truthiness panel. Read-only by design — the editable cards
// are the dedicated examples above; this is breadth, not depth.
import { useEffect, useState } from "preact/hooks";
import { analyze } from "../../../lab/vendor/flatbars-engine.mjs";
import { labHref } from "../../../lab/open-in-lab.mjs";

// A finding-kind badge (count + label), hidden at zero.
function Badge({ n, kind, label }) {
  if (!n) return null;
  return <span class={"ag-badge ag-" + kind}>{n} {label}</span>;
}

function Tile({ item }) {
  const [res, setRes] = useState(null);
  const [href, setHref] = useState(null);
  useEffect(() => {
    try { setRes(analyze(item.template, item.data)); }
    catch (e) { setRes({ ok: false, error: String((e && e.message) || e), findings: [] }); }
    let live = true;
    // Land in the Lab on the Truthiness dock panel (ADR-022), with the example loaded.
    labHref(item.engine, { template: item.template, data: item.data, dock: "truthiness" })
      .then((h) => { if (live) setHref(h); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const by = (k) => (res && res.ok ? res.findings.filter((f) => f.kind === k).length : 0);
  const clean = res && res.ok && res.findings.length === 0;
  return (
    <figure class="ag-tile">
      <figcaption class="ag-head">
        <b class="ag-name">{item.name}</b>
        {href && <a class="ag-lab" href={href} target="flatbars-lab" rel="noopener" title="Open in the Lab's Truthiness panel">Lab ↗</a>}
      </figcaption>
      <pre class="ag-tpl"><code>{item.template}</code></pre>
      <p class="ag-desc">{item.desc}</p>
      <div class="ag-badges">
        {res == null && <span class="ag-badge ag-pending">analysing…</span>}
        {res && !res.ok && <span class="ag-badge ag-err">⚠ {res.error}</span>}
        {clean && <span class="ag-badge ag-portable">portable</span>}
        <Badge n={by("observed")} kind="observed" label="observed" />
        <Badge n={by("potential")} kind="potential" label="potential" />
        <Badge n={by("miss")} kind="miss" label="miss" />
      </div>
    </figure>
  );
}

export default function AnalyseGallery({ items = [] }) {
  return (
    <div class="ag-grid">
      {items.map((item) => <Tile key={item.name} item={item} />)}
    </div>
  );
}
