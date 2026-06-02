// SPDX-License-Identifier: Apache-2.0
//
// FFI for ADR-018 user-defined helpers. `callJsHelperImpl` invokes a host JS
// helper with the Handlebars-style positional convention (`fn(...args)`) over
// already-marshalled (JSON / plain-JS) arguments, catching throws and detecting
// the `safe` sentinel. A helper may declare an arity (`registerHelper(name, fn,
// arity)`); when it does, an arity mismatch is reported with the SAME message
// the prelude's arity-checked helpers produce, so a custom helper's diagnostics
// read like a built-in's. The PureScript side (FullBars.JS) marshals `Value`
// arguments to JSON and the result back to a `Value`.

// Arity descriptor → text, matching Kernel.Walk.arityText. `arity` is a number
// (exactly N), `[min, max]` (max null/Infinity ⇒ at-least), or undefined (any).
function arityText(arity) {
  if (arity === undefined || arity === null) return "any number of";
  if (typeof arity === "number") return "exactly " + arity;
  const [lo, hi] = arity;
  return hi == null || hi === Infinity ? "at least " + lo : lo + "–" + hi;
}
function arityOk(arity, n) {
  if (arity === undefined || arity === null) return true;
  if (typeof arity === "number") return n === arity;
  const [lo, hi] = arity;
  return n >= lo && (hi == null || hi === Infinity || n <= hi);
}

export const callJsHelperImpl = (name) => (descriptor) => (args) => {
  // A bag entry is either a bare function (any arity) or `{ fn, arity }`.
  const fn = typeof descriptor === "function" ? descriptor : descriptor.fn;
  const arity = typeof descriptor === "function" ? undefined : descriptor.arity;
  if (!arityOk(arity, args.length)) {
    return { tag: "arity", payload: name + ": expected " + arityText(arity) + " argument(s), got " + args.length };
  }
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
