// SPDX-License-Identifier: Apache-2.0
//
// FFI for ADR-018 user-defined helpers. `callJsHelperImpl` invokes a host JS
// helper with the Handlebars-style positional convention (`fn(...args)`) over
// already-marshalled (JSON / plain-JS) arguments, catching throws and detecting
// the `safe` sentinel. The PureScript side (FullBars.JS) marshals `Value`
// arguments to JSON and the result back to a `Value`.

export const callJsHelperImpl = (fn) => (args) => {
  try {
    const r = fn.apply(null, args);
    // `safe(str)` (below) marks raw markup — the VSafe analogue, recognised by
    // both this marshaller and the compiled runtime's rt.call.
    if (r && typeof r === "object" && typeof r.__fbSafe === "string") {
      return { tag: "safe", payload: r.__fbSafe };
    }
    return { tag: "ok", payload: r === undefined ? null : r };
  } catch (e) {
    return { tag: "error", payload: String((e && e.message) || e) };
  }
};

// The SafeString equivalent a helper returns to emit raw (un-escaped) markup in
// `{{ … }}` (ADR-018). A plain sentinel object so it travels across the engine
// bundle and the separate compiled runtime without an instanceof dependency.
export const safe = (s) => ({ __fbSafe: typeof s === "string" ? s : String(s) });
