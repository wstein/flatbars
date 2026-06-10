// SPDX-License-Identifier: Apache-2.0
//
// Build a custom-operation bag from user JS source, shared by the Lab's helpers
// panel and the tutorials' runnable cards (ADR-018). The source registers via
// one of two dialect-scoped names (ADR-019 addendum), both aliasing the *same*
// registrar into the same bag:
//   • `registerHelper(name, fn)`    — the ClassicBars / Handlebars-migration word;
//   • `registerOperation(name, fn)` — the native word the RawBars / MaxBars docs
//     use, since those dialects reject the "helper" framing (concepts §1).
// It may call `safe(str)` to emit raw markup; `buildHelpers` runs the source and
// returns `{ ok, helpers, error }`, where `helpers` is the `{ name: fn }` bag the
// engine facade's `renderWith` / `renderRawWith` / `renderMaxWith` (interpreter)
// and `rt.register` (compiled) all consume. The runtime registrar is the neutral
// `register`; these two are its source-level, dialect-scoped twins.
//
// `safe` is injected (the engine bundle's `safe`) so this module carries no
// dependency on the bundle and can be unit-tested in isolation.
//
// SECURITY (ADR-018): this evaluates the user's own JS via `new Function` — the
// playground model (CodePen/JSFiddle). It is NOT a sandbox against hostile code;
// the threat that matters is a *shared* link auto-running someone else's
// helpers, which the Lab guards separately (helper source is not auto-applied
// from a shared workspace without explicit consent — see index.html).

// Evaluate `source` into a helper bag. Returns `{ ok, helpers, error }`.
// `safe` is the engine's SafeString constructor, exposed to the user's code.
export function buildHelpers(source, safe) {
  if (!source || !source.trim()) return { ok: true, helpers: {}, error: "" };
  const helpers = Object.create(null);
  // `register(name, fn)` or `register(name, fn, arity)` (ADR-018), where `arity`
  // is a number (exactly N), `[min, max]` (max null/Infinity ⇒ at-least), or
  // omitted (any). A declared arity gives the operation the same arity
  // diagnostics as a built-in.
  const register = (name, fn, arity) => {
    if (typeof name !== "string" || !name) throw new Error("register(name, fn): name must be a non-empty string");
    if (typeof fn !== "function") throw new Error("register('" + name + "', fn): fn must be a function");
    helpers[name] = arity === undefined ? fn : { fn, arity };
  };
  try {
    // `registerHelper` (ClassicBars) and `registerOperation` (native RawBars/MaxBars)
    // are dialect-scoped aliases of the one `register` above — both fill the same
    // bag, so a card teaches its dialect's word while every card stays runnable
    // (ADR-019 addendum). `safe` is the third injected name; the source runs for
    // its side effects (registering operations).
    // eslint-disable-next-line no-new-func
    const run = new Function("registerHelper", "registerOperation", "safe", source);
    run(register, register, safe);
    return { ok: true, helpers, error: "" };
  } catch (e) {
    return { ok: false, helpers: {}, error: String((e && e.message) || e) };
  }
}
