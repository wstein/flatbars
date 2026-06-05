// SPDX-License-Identifier: Apache-2.0
//
// Parse the Lab's `config.yaml` tab — the reserved *settings* tab, distinct from
// the data-like `catalog.yaml` (the message catalog). Grouped by concern:
//
//   i18n:
//     locale: pl              # the active locale for catalog.yaml's messages
//   minbars:
//     truthiness: mustacheJs  # "mustacheJs" (0/"" falsy, default) | "spec" (0/"" truthy)
//
// Returns a normalised `{ locale, minbarsTruthiness }` with defaults applied, so
// callers never branch on missing keys. `loadYaml` is injected (the Lab's vendored
// js-yaml `load`) so this module is unit-testable in Node.

export const CONFIG_DEFAULTS = { locale: "en", minbarsTruthiness: "mustacheJs" };

export function parseConfig(configYaml, loadYaml) {
  if (!configYaml || !configYaml.trim()) return { ok: true, config: { ...CONFIG_DEFAULTS }, error: "" };
  let doc;
  try {
    doc = loadYaml(configYaml) || {};
  } catch (e) {
    return { ok: false, config: { ...CONFIG_DEFAULTS }, error: "config.yaml — " + ((e && e.message) || e) };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, config: { ...CONFIG_DEFAULTS }, error: "config.yaml — expected a mapping with `i18n` / `minbars` groups" };
  }
  const i18n = doc.i18n && typeof doc.i18n === "object" ? doc.i18n : {};
  const minbars = doc.minbars && typeof doc.minbars === "object" ? doc.minbars : {};
  const locale = typeof i18n.locale === "string" ? i18n.locale : CONFIG_DEFAULTS.locale;
  // Default mustacheJs (0/"" falsy) — what JS users expect; only an explicit
  // "spec" opts into the Ruby/spec semantics.
  const minbarsTruthiness = minbars.truthiness === "spec" ? "spec" : "mustacheJs";
  return { ok: true, config: { locale, minbarsTruthiness }, error: "" };
}

// The Lab's MinBars render flag (`compat`): true ⇒ mustache.js truthiness.
export function minbarsCompatFromConfig(config) {
  return (config && config.minbarsTruthiness) !== "spec";
}
