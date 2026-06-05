// SPDX-License-Identifier: Apache-2.0
//
// Build the i18n helper bag from the Lab's `catalog.yaml` tab — pure message
// DATA (locale-keyed strings), distinct from the `config.yaml` settings tab that
// supplies the active `locale`. The catalog is parsed into the blessed-operation
// overrides (t / number / date / selectPlural / relative), each backed by the
// browser's native `Intl` — FlatBars ships no CLDR data. The host (the Lab)
// supplies the brain; this is that brain, authored as strings instead of code.
// These run in RawBars / FullBars / MaxBars (the t-supporting surfaces), not
// MinBars (ADR-029).
//
// `loadYaml` is injected (the Lab's vendored js-yaml `load`) so this module has no
// bundle/vendor dependency and is unit-testable in Node.
//
// catalog.yaml shape (just the messages; the locale lives in config.yaml):
//   en:
//     greeting: "Hello, {name}!"
//     files.deleted: { one: "Deleted {count} file", other: "Deleted {count} files" }
//   pl:
//     greeting: "Cześć, {name}!"
//     files.deleted: { one: "…", few: "…", many: "…", other: "…" }
//
// A string message interpolates {placeholders}; an object message is keyed by
// CLDR plural category, selected by Intl.PluralRules. A missing key returns the
// key itself (ADR-029 fallback-and-flag).

// The i18n helper bag from a messages object (locale → key → message) + a locale.
// This is the single source of the t/number/date/relative/selectPlural logic,
// reused by the Lab (parsing catalog.yaml) and the tutorials (a JS catalog const).
export function makeI18nBag(messages, locale) {
  const loc = typeof locale === "string" && locale ? locale : "en";
  const table = (messages && messages[loc]) || {};

  function translate(key, args) {
    const m = table[key];
    if (m === undefined) return key; // fallback-and-flag (ADR-029)
    const variant =
      typeof m === "string"
        ? m
        : m[new Intl.PluralRules(loc).select(Number(args.count))] ?? m.other ?? key;
    return variant.replace(/\{(\w+)\}/g, (_, name) =>
      name === "count" && args.count !== undefined
        ? new Intl.NumberFormat(loc).format(Number(args.count))
        : args[name] !== undefined
          ? String(args[name])
          : `{${name}}`,
    );
  }

  return {
    t: (key, args) => translate(key, args || {}),
    number: (n, opts) => new Intl.NumberFormat(loc, opts || {}).format(Number(n)),
    date: (iso, opts) =>
      new Intl.DateTimeFormat(
        loc,
        opts && Object.keys(opts).length ? { timeZone: "UTC", ...opts } : { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" },
      ).format(new Date(iso)),
    relative: (v, u, opts) => new Intl.RelativeTimeFormat(loc, { numeric: "auto", ...(opts || {}) }).format(Number(v), u),
    selectPlural: (n, opts) => new Intl.PluralRules(loc, opts || {}).select(Number(n)),
  };
}

// Wrap a helper bag as the ADR-029 translator seam: a single (name, args) =>
// string|undefined the engine seeds via withTranslator / rt.registerTranslator.
// The op's positional Value args arrive marshalled; each bag fn takes them
// directly (t(key, hash), number(n, opts), …), so spreading is the dispatch.
function bagToTranslator(bag) {
  return (name, args) => {
    const fn = bag[name];
    return fn ? fn(...(args || [])) : undefined;
  };
}

// The host translator from a messages object + locale (the page's JS catalog).
export function makeTranslator(messages, locale) {
  return bagToTranslator(makeI18nBag(messages, locale));
}

// The host translator from the Lab's `catalog.yaml` tab (the LOCALIZATION view).
export function buildTranslator(catalogYaml, locale, loadYaml) {
  const b = buildI18nHelpers(catalogYaml, locale, loadYaml);
  return b.ok
    ? { ok: true, translator: bagToTranslator(b.helpers), error: "" }
    : { ok: false, translator: null, error: b.error };
}

export function buildI18nHelpers(catalogYaml, locale, loadYaml) {
  if (!catalogYaml || !catalogYaml.trim()) return { ok: true, helpers: {}, error: "" };
  let messages;
  try {
    messages = loadYaml(catalogYaml) || {};
  } catch (e) {
    return { ok: false, helpers: {}, error: "catalog.yaml — " + ((e && e.message) || e) };
  }
  if (typeof messages !== "object" || Array.isArray(messages)) {
    return { ok: false, helpers: {}, error: "catalog.yaml — expected a mapping of locale → messages" };
  }
  return { ok: true, helpers: makeI18nBag(messages, locale), error: "" };
}
