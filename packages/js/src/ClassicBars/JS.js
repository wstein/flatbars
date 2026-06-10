// SPDX-License-Identifier: Apache-2.0
//
// FFI for ADR-018 user-defined helpers. `callJsHelperImpl` invokes a host JS
// helper with the Handlebars-style positional convention (`fn(...args)`) over
// already-marshalled (JSON / plain-JS) arguments, catching throws and detecting
// the `safe` sentinel. A helper may declare an arity (`registerHelper(name, fn,
// arity)`); when it does, an arity mismatch is reported with the SAME message
// the prelude's arity-checked helpers produce, so a custom helper's diagnostics
// read like a built-in's. The PureScript side (ClassicBars.JS) marshals `Value`
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

// Block (section) helper — ADR-020. Like `callJsHelperImpl`, but the helper is
// called Handlebars-style with a trailing `options` object: `options.fn(ctx)`
// renders the block body (with `ctx` as the new context; no arg ⇒ the current
// context), `options.inverse(ctx)` the `{{else}}` clause. Those callbacks
// re-enter the *pure* interpreter via PureScript thunks returning
// `{ ok, value, error }`; we unwrap and throw IN JS (caught here), so the engine
// never throws across the FFI. A block helper's return is RAW (the VSafe
// analogue) — Handlebars treats block output as already-safe markup. `this` is
// the current context, so `options.fn(this)` works. `args` is already the
// trimmed positional list (the hash + block-param values are split off by the
// engine). `hash` is the surface `k=v` object (`{}` when none). `options.fn(ctx,
// { data, blockParams })` shifts context and, via the PureScript thunk, layers
// `data` as scoped `@vars` and binds the declared `as |…|` names to `blockParams`
// (ADR-020 Phase 3). Reading any other `options.*` throws rather than silently
// returning `undefined`.
export const callJsBlockHelperImpl =
  (name) => (descriptor) => (args) => (currentCtx) => (hash) => (renderBody) => (renderInverse) => {
    const fn = typeof descriptor === "function" ? descriptor : descriptor.fn;
    const arity = typeof descriptor === "function" ? undefined : descriptor.arity;
    if (!arityOk(arity, args.length)) {
      return { tag: "arity", payload: name + ": expected " + arityText(arity) + " argument(s), got " + args.length };
    }
    const unwrap = (r) => {
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    const options = {
      hash: hash && typeof hash === "object" ? hash : {},
      fn: function (ctx, opts) { return unwrap(renderBody(arguments.length === 0 ? currentCtx : ctx)(opts || {})); },
      inverse: function (ctx, opts) { return unwrap(renderInverse(arguments.length === 0 ? currentCtx : ctx)(opts || {})); },
    };
    for (const k of ["ids", "loc", "lookupProperty"]) {
      Object.defineProperty(options, k, {
        get() { throw new Error("options." + k + " is not supported in a FlatBars block helper"); },
      });
    }
    try {
      const r = fn.apply(currentCtx, args.concat([options]));
      if (r && typeof r === "object" && typeof r.__fbSafe === "string") return { tag: "safe", payload: r.__fbSafe };
      return { tag: "safe", payload: r === undefined || r === null ? "" : String(r) };
    } catch (e) {
      return { tag: "error", payload: String((e && e.message) || e) };
    }
  };

// The SafeString equivalent a helper returns to emit raw (un-escaped) markup in
// `{{ … }}` (ADR-018). A plain sentinel object so it travels across the engine
// bundle and the separate compiled runtime without an instanceof dependency.
export const safe = (s) => ({ __fbSafe: typeof s === "string" ? s : String(s) });

// FFI for the ADR-029 i18n seam. Call a host `translator(name, args)` over
// already-marshalled (JSON / plain-JS) op arguments; a string return is a hit,
// `null`/`undefined` (or a throw, defensively) means "no translation" so the
// engine falls back to the key. Returns a tagged record the PureScript side maps
// to `Maybe String`. Curried to match the `callJsHelperImpl` calling convention.
export const callJsTranslatorImpl = (translator) => (name) => (args) => {
  try {
    const r = translator(name, args);
    return r === undefined || r === null ? { hit: false, value: "" } : { hit: true, value: String(r) };
  } catch (_e) {
    return { hit: false, value: "" };
  }
};

// FFI for the ADR-030 path-schema seam. Call a host `schema(path, value)` asking
// "could this path hold this candidate ambiguous value?"; a falsy return suppresses
// the matching *potential* finding. A throw (defensively) admits the what-if, so a
// buggy schema never hides a real divergence. Curried to match the other seams.
export const callJsPathSchemaImpl = (schema) => (path) => (value) => {
  try {
    return schema(path, value) !== false;
  } catch (_e) {
    return true;
  }
};
