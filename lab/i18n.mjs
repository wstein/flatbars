// SPDX-License-Identifier: Apache-2.0
//
// Build the i18n helper bag from a `catalog.yaml` document (ADR-029, the Lab's
// dedicated catalog tab). The Lab reserves a tab named `catalog.yaml`; its YAML
// is parsed here into the blessed-operation overrides (t / number / date /
// selectPlural / relative), each backed by the browser's native `Intl` — FlatBars
// ships no CLDR data. The host (the Lab) supplies the brain; this is that brain,
// authored as strings instead of code.
//
// `loadYaml` is injected (the Lab's vendored js-yaml `load`) so this module has no
// bundle/vendor dependency and is unit-testable in Node.
//
// Catalog shape:
//   locale: pl                       # the active locale (default "en")
//   messages:
//     en:
//       greeting: "Hello, {name}!"
//       files.deleted: { one: "Deleted {count} file", other: "Deleted {count} files" }
//     pl:
//       greeting: "Cześć, {name}!"
//       files.deleted: { one: "…", few: "…", many: "…", other: "…" }
//
// A string message interpolates {placeholders}; an object message is keyed by
// CLDR plural category, selected by Intl.PluralRules. A missing key returns the
// key itself (ADR-029 fallback-and-flag).

export function buildI18nHelpers(catalogYaml, loadYaml) {
  if (!catalogYaml || !catalogYaml.trim()) return { ok: true, helpers: {}, error: "" };
  let doc;
  try {
    doc = loadYaml(catalogYaml) || {};
  } catch (e) {
    return { ok: false, helpers: {}, error: "catalog.yaml — " + ((e && e.message) || e) };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, helpers: {}, error: "catalog.yaml — expected a mapping with `locale` and `messages`" };
  }
  const locale = typeof doc.locale === "string" ? doc.locale : "en";
  const messages = doc.messages && typeof doc.messages === "object" ? doc.messages : {};

  function translate(key, args) {
    const table = messages[locale] || {};
    const m = table[key];
    if (m === undefined) return key; // fallback-and-flag (ADR-029)
    const variant =
      typeof m === "string"
        ? m
        : m[new Intl.PluralRules(locale).select(Number(args.count))] ?? m.other ?? key;
    return variant.replace(/\{(\w+)\}/g, (_, name) =>
      name === "count" && args.count !== undefined
        ? new Intl.NumberFormat(locale).format(Number(args.count))
        : args[name] !== undefined
          ? String(args[name])
          : `{${name}}`,
    );
  }

  const helpers = {
    t: (key, args) => translate(key, args || {}),
    number: (n, opts) => new Intl.NumberFormat(locale, opts || {}).format(Number(n)),
    date: (iso, opts) =>
      new Intl.DateTimeFormat(
        locale,
        opts && Object.keys(opts).length ? { timeZone: "UTC", ...opts } : { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" },
      ).format(new Date(iso)),
    relative: (v, u, opts) => new Intl.RelativeTimeFormat(locale, { numeric: "auto", ...(opts || {}) }).format(Number(v), u),
    selectPlural: (n, opts) => new Intl.PluralRules(locale, opts || {}).select(Number(n)),
  };
  return { ok: true, helpers, error: "" };
}
