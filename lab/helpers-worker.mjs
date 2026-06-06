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
import { buildI18nHelpers, buildTranslator } from "./i18n.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";
import { renderWith, renderRawWith, renderMaxWith, renderSurfaceI18n, safe } from "./vendor/flatbars-engine.mjs?v=59";

// The dialect → operations-aware render entry. MinBars has no helper path (its
// catalog/`t` are excluded, ADR-029), so it never reaches the worker.
const RENDER_BY_DIALECT = { rawbars: renderRawWith, fullbars: renderWith, maxbars: renderMaxWith };

const DEPS = { buildHelpers, buildI18nHelpers, buildTranslator, loadYaml, renderByDialect: RENDER_BY_DIALECT, renderSurfaceI18n, safe };

// Render `req = { dialect, template, data, partials, helperSrc, catalogSrc, locale }`.
// i18n (t/number/…) is driven by the `catalog.yaml` messages bound to the active
// `locale` (from config.yaml, ADR-029). When the request has i18n but NO custom
// helpers (the common LOCALIZATION case, FullBars) it renders through the
// first-class translator seam (`renderSurfaceI18n`, ADR-029). When custom helpers
// are also present — or the dialect is RawBars/MaxBars — it merges the i18n bag
// with the custom helpers and renders by dialect; the registered i18n ops shadow
// the seamed prelude op, so the result is identical. (A combined translator+helpers
// entry across all dialects is a tracked follow-up.) Returns `{ ok, value, error }`.
// Pure (modulo the injected engine); never throws.
export function runHelperRequest(req, deps = DEPS) {
  const {
    buildHelpers: build, buildI18nHelpers: buildI18n, buildTranslator: buildTr,
    loadYaml: yaml, renderByDialect, renderSurfaceI18n: renderI18n, safe: safeFn,
  } = deps;
  const r = req || {};
  const built = build(r.helperSrc || "", safeFn);
  if (!built.ok) return { ok: false, value: "", error: "helper error — " + built.error };
  const hasI18n = !!(r.catalogSrc && r.catalogSrc.trim());
  const hasHelpers = Object.keys(built.helpers).length > 0;
  const dialect = r.dialect || "fullbars";
  const data = r.data == null ? {} : r.data;
  try {
    // The common path: i18n, no custom helpers, FullBars → the seam.
    if (hasI18n && !hasHelpers && dialect === "fullbars") {
      const tr = buildTr(r.catalogSrc, r.locale || "en", yaml);
      if (!tr.ok) return { ok: false, value: "", error: tr.error };
      const out = renderI18n(tr.translator, r.template || "", data);
      return { ok: !!out.ok, value: out.value || "", error: out.error || "" };
    }
    // Combined (i18n + custom helpers) or RawBars/MaxBars i18n: merge the bag — the
    // registered i18n ops shadow the seamed prelude op (identical output).
    const i18n = buildI18n(r.catalogSrc || "", r.locale || "en", yaml);
    if (!i18n.ok) return { ok: false, value: "", error: i18n.error };
    const helpers = { ...i18n.helpers, ...built.helpers };
    const render = renderByDialect[dialect] || renderByDialect.fullbars;
    const out = render(helpers, r.partials || {}, r.template || "", data);
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
