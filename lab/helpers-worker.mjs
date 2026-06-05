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
import { renderWith, safe } from "./vendor/flatbars-engine.mjs?v=43";

const DEPS = { buildHelpers, renderWith, safe };

// Render `req = { template, data, partials, helperSrc }` with the helpers built
// from `helperSrc`. Returns `{ ok, value, error }`. Pure (modulo the injected
// engine); never throws.
export function runHelperRequest(req, deps = DEPS) {
  const { buildHelpers: build, renderWith: render, safe: safeFn } = deps;
  const r = req || {};
  const built = build(r.helperSrc || "", safeFn);
  if (!built.ok) return { ok: false, value: "", error: "helper error — " + built.error };
  try {
    const out = render(built.helpers, r.partials || {}, r.template || "", r.data == null ? {} : r.data);
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
