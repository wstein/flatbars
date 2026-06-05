// SPDX-License-Identifier: Apache-2.0
//
// The custom-helper sandbox Worker (ADR-018, the "floor" isolation). User helper
// JavaScript is evaluated and executed HERE, off the main thread — a Worker has
// no DOM, no `window`, and no access to the page — so a shared workspace's
// helper code cannot read or deface the playground page. (A Worker is not a full
// capability jail — it still has `fetch` — which ADR-018 records; it removes the
// page-takeover surface, which is the point.) The Worker imports the engine
// bundle, builds the helper bag from the source, and renders with `renderWith`,
// returning only a result string.
//
// `runHelperRequest` is exported and dependency-injected so it can be unit-tested
// in Node (where there is no `Worker`/`self`); the `self.onmessage` wiring at the
// bottom is guarded so importing the module in Node is side-effect-free.

import { buildHelpers } from "./helpers.mjs";
import { buildI18nHelpers } from "./i18n.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";
import { renderWith, renderRawWith, renderMaxWith, safe } from "./vendor/flatbars-engine.mjs?v=55";

// The dialect → operations-aware render entry. MinBars has no helper path (its
// catalog/`t` are excluded, ADR-029), so it never reaches the worker.
const RENDER_BY_DIALECT = { rawbars: renderRawWith, fullbars: renderWith, maxbars: renderMaxWith };

const DEPS = { buildHelpers, buildI18nHelpers, loadYaml, renderByDialect: RENDER_BY_DIALECT, safe };

// Render `req = { dialect, template, data, partials, helperSrc, catalogSrc, locale }`.
// The i18n bag (t/number/…) is built from the `catalog.yaml` messages bound to the
// active `locale` (from config.yaml, ADR-029); explicit `helpers.js` overrides it.
// The render entry is picked by dialect (RawBars/FullBars/MaxBars). Returns
// `{ ok, value, error }`. Pure (modulo the injected engine); never throws.
export function runHelperRequest(req, deps = DEPS) {
  const { buildHelpers: build, buildI18nHelpers: buildI18n, loadYaml: yaml, renderByDialect, safe: safeFn } = deps;
  const r = req || {};
  const i18n = buildI18n(r.catalogSrc || "", r.locale || "en", yaml);
  if (!i18n.ok) return { ok: false, value: "", error: i18n.error };
  const built = build(r.helperSrc || "", safeFn);
  if (!built.ok) return { ok: false, value: "", error: "helper error — " + built.error };
  const helpers = { ...i18n.helpers, ...built.helpers };
  const render = renderByDialect[r.dialect] || renderByDialect.fullbars;
  try {
    const out = render(helpers, r.partials || {}, r.template || "", r.data == null ? {} : r.data);
    return { ok: !!out.ok, value: out.value || "", error: out.error || "" };
  } catch (e) {
    return { ok: false, value: "", error: String((e && e.message) || e) };
  }
}

// Worker message wiring (browser only). Each request is `{ id, req }`; the reply
// is `{ id, res }`. Guarded so a Node `import` (the unit test) does not touch a
// non-existent `self`.
if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("message", (e) => {
    const { id, req } = e.data || {};
    let res;
    try {
      res = runHelperRequest(req, DEPS);
    } catch (err) {
      res = { ok: false, value: "", error: String((err && err.message) || err) };
    }
    self.postMessage({ id, res });
  });
}
