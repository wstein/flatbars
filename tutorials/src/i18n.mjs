// SPDX-License-Identifier: Apache-2.0
//
// The "Localize" guide content — ONE source for the page (TryI18n cells) and the
// gate (scripts/check-i18n.mjs). It demonstrates ADR-029's i18n *seam*: FlatBars
// ships no i18n; the Lab acts as the HOST and wires a `t` helper to the browser's
// native `Intl` (the CLDR plural/format brain, zero bundle cost) through the
// ADR-018 registerHelper / renderWith path — no engine feature, no vendored lib
// (see the ADR-029 amendment, 2026-06-05).
//
// Each cell carries its `expect`, the string FullBars must render for
// {template, data} with the `t` helper bound to `locale`; the gate asserts it, so
// a snippet can never drift from what the engine produces. The Polish (`pl`) cells
// exercise a non-trivial plural set (one/few/many/other) and the locale-aware
// number grouping cells show `Intl.NumberFormat` per locale — both for free from
// the platform, which is exactly why i18next is NOT vendored.

import { dump as dumpYaml } from "../../lab/vendor/js-yaml.mjs";
import { makeI18nBag } from "../../lab/i18n.mjs";

// ── The host's message catalog ───────────────────────────────────────────────
// A plain object the host owns (ADR-029: the host supplies the brain). A string
// value is a direct message; an object value is keyed by CLDR plural category,
// selected at render time by Intl.PluralRules for the active locale.
export const catalog = {
  en: {
    greeting: "Hello, {name}!",
    "cart.items": { one: "{count} item in your cart", other: "{count} items in your cart" },
    "files.deleted": { one: "Deleted {count} file", other: "Deleted {count} files" },
  },
  de: {
    greeting: "Hallo, {name}!",
    "cart.items": { one: "{count} Artikel im Warenkorb", other: "{count} Artikel im Warenkorb" },
    "files.deleted": { one: "{count} Datei gelöscht", other: "{count} Dateien gelöscht" },
  },
  pl: {
    greeting: "Cześć, {name}!",
    "cart.items": {
      one: "{count} produkt w koszyku",
      few: "{count} produkty w koszyku",
      many: "{count} produktów w koszyku",
      other: "{count} produktu w koszyku",
    },
    "files.deleted": {
      one: "Usunięto {count} plik",
      few: "Usunięto {count} pliki",
      many: "Usunięto {count} plików",
      other: "Usunięto {count} pliku",
    },
  },
};

export const locales = Object.keys(catalog);

// ── The i18n helper bag for the page's TryI18n cells ──────────────────────────
// Built from the catalog above bound to a locale, reusing the Lab's single i18n
// core (lab/i18n.mjs makeI18nBag) — the translate/plural/format logic lives in ONE
// place, so the page and the Lab can't drift (the t/number/… helpers, the native
// `Intl` brain). For an inline helper the key=value hash arrives as a trailing
// object directly (FullBars convention), so `number n style="…"` calls
// number(n, { style: "…" }). Swap native Intl for i18next/ICU in production (see
// `escapeHatch`).
export const makeI18nHelpers = (locale) => makeI18nBag(catalog, locale);

// ── The teaching artifacts the page shows verbatim ───────────────────────────
// How a host wires the seam (the code behind every cell on this page). For an
// inline helper the key=value hash arrives as a trailing object directly.
export const integrationSource = `// The Lab acts as the HOST. FlatBars ships no i18n; wire \`t\` to native Intl —
// the browser's CLDR plural/format brain, at zero bundle cost (ADR-029).
registerHelper("t", (key, args) => translate(locale, key, args));`;

// The unbundled escape hatch: drop in your real stack instead of native Intl.
export const escapeHatch = `// i18next:
import i18next from "i18next";
registerHelper("t", (key, args) => i18next.t(key, args));

// or ICU MessageFormat (@formatjs/intl-messageformat):
import { IntlMessageFormat } from "intl-messageformat";
registerHelper("t", (key, args) =>
  new IntlMessageFormat(catalog[locale][key], locale).format(args));`;

// ── The runnable cells ───────────────────────────────────────────────────────
export const sections = [
  {
    id: "interpolate",
    title: "Interpolation — the seam",
    lead:
      "FlatBars has no i18n. The host registers a `t` helper that looks a key up in " +
      "its catalog and fills in {placeholders}. The template stays a plain operation " +
      "call — {{t \"key\" name=…}} — exactly like any other helper.",
    cells: [
      {
        id: "greeting",
        label: "A named placeholder",
        note: "{name} is a hash argument; the host's translate() substitutes it. Use the locale picker to switch.",
        locale: "en",
        template: '{{t "greeting" name=name}}',
        data: { name: "Ada" },
        expect: "Hello, Ada!",
      },
    ],
  },
  {
    id: "plurals",
    title: "Plurals — Intl.PluralRules, for free",
    lead:
      "Pluralization is not string concatenation: Polish has four categories " +
      "(one/few/many/other). The host picks the right variant with the browser's " +
      "native Intl.PluralRules — no plural data shipped, which is why i18next is not " +
      "vendored.",
    cells: [
      {
        id: "en-one",
        label: "English — singular",
        note: "count=1 selects the `one` category.",
        locale: "en",
        template: '{{t "cart.items" count=count}}',
        data: { count: 1 },
        expect: "1 item in your cart",
      },
      {
        id: "en-other",
        label: "English — plural",
        note: "count=3 selects `other`.",
        locale: "en",
        template: '{{t "cart.items" count=count}}',
        data: { count: 3 },
        expect: "3 items in your cart",
      },
      {
        id: "pl-one",
        label: "Polish — one",
        note: "count=1 → `one`.",
        locale: "pl",
        template: '{{t "files.deleted" count=count}}',
        data: { count: 1 },
        expect: "Usunięto 1 plik",
      },
      {
        id: "pl-few",
        label: "Polish — few",
        note: "count=2 → `few` (2–4).",
        locale: "pl",
        template: '{{t "files.deleted" count=count}}',
        data: { count: 2 },
        expect: "Usunięto 2 pliki",
      },
      {
        id: "pl-many",
        label: "Polish — many",
        note: "count=5 → `many` (0, 5–21, …). A category English doesn't have.",
        locale: "pl",
        template: '{{t "files.deleted" count=count}}',
        data: { count: 5 },
        expect: "Usunięto 5 plików",
      },
    ],
  },
  {
    id: "numbers",
    title: "Locale-aware numbers — Intl.NumberFormat",
    lead:
      "The {count} placeholder is formatted with Intl.NumberFormat for the locale, " +
      "so digit grouping follows the language — again, native and free.",
    cells: [
      {
        id: "en-grouping",
        label: "English grouping (comma)",
        note: "1000 → 1,000 in en.",
        locale: "en",
        template: '{{t "cart.items" count=count}}',
        data: { count: 1000 },
        expect: "1,000 items in your cart",
      },
      {
        id: "de-grouping",
        label: "German grouping (period)",
        note: "1000 → 1.000 in de.",
        locale: "de",
        template: '{{t "cart.items" count=count}}',
        data: { count: 1000 },
        expect: "1.000 Artikel im Warenkorb",
      },
    ],
  },
  {
    id: "formatting",
    title: "Formatting helpers — number, date, relative, selectPlural",
    lead:
      "All four are blessed prelude operations like t (ADR-029): catalogued and " +
      "painted, with pure fallbacks (plain text; the English one/other rule; \"N units " +
      "ago\"), overridden here by the host's native-Intl versions. number/date/relative " +
      "format through Intl.NumberFormat / DateTimeFormat / RelativeTimeFormat; " +
      "selectPlural exposes the raw CLDR category. Each takes an Intl options hash — the " +
      "trailing dict (style/currency, type=\"ordinal\", numeric=\"always\") passes straight " +
      "through, no arity change. All native, all locale-bound, no data shipped.",
    cells: [
      {
        id: "number",
        label: "number — Intl.NumberFormat",
        note: "Decimal + grouping per locale.",
        locale: "de",
        template: "{{number n}}",
        data: { n: 1234.5 },
        expect: "1.234,5",
      },
      {
        id: "number-currency",
        label: "number — with an Intl options hash",
        note: 'style="currency" currency="EUR" — the hash passes straight to Intl.NumberFormat.',
        locale: "en",
        template: '{{number n style="currency" currency="EUR"}}',
        data: { n: 1234.5 },
        expect: "€1,234.50",
      },
      {
        id: "date",
        label: "date — Intl.DateTimeFormat",
        note: "Numeric fields, UTC; the locale orders and separates them.",
        locale: "en",
        template: "{{date d}}",
        data: { d: "2026-06-05" },
        expect: "06/05/2026",
      },
      {
        id: "relative",
        label: "relative — Intl.RelativeTimeFormat",
        note: "numeric:auto yields the idiomatic word.",
        locale: "pl",
        template: "{{relative offset unit}}",
        data: { offset: -1, unit: "day" },
        expect: "wczoraj",
      },
      {
        id: "relative-always",
        label: "relative — with an Intl options hash",
        note: 'numeric="always" forces the numeric form over the idiom (auto → "yesterday").',
        locale: "en",
        template: '{{relative offset unit numeric="always"}}',
        data: { offset: -1, unit: "day" },
        expect: "1 day ago",
      },
      {
        id: "selectPlural",
        label: "selectPlural — the raw category",
        note: "count=2 in Polish is the `few` category (English would be `other`).",
        locale: "pl",
        template: "{{selectPlural n}}",
        data: { n: 2 },
        expect: "few",
      },
      {
        id: "selectPlural-ordinal",
        label: "selectPlural — with an Intl options hash",
        note: 'type="ordinal" switches to ordinal categories (English 2 → "two", for 2nd).',
        locale: "en",
        template: '{{selectPlural n type="ordinal"}}',
        data: { n: 2 },
        expect: "two",
      },
    ],
  },
  {
    id: "fallback",
    title: "Missing keys — fallback, never throw",
    lead:
      "ADR-029: a missing translation renders a visible fallback (the key itself) " +
      "rather than throwing, so one untranslated string never breaks a production " +
      "render. A strict CI mode that errors is opt-in.",
    cells: [
      {
        id: "missing",
        label: "Unknown key → the key",
        note: "No catalog entry, so the key surfaces verbatim — easy to spot and flag.",
        locale: "en",
        template: '{{t "checkout.title"}}',
        data: {},
        expect: "checkout.title",
        missing: true, // intentionally absent from the catalog (coverage exemption)
      },
    ],
  },
];

// A flagship: two helpers, one locale, the full plural+interpolation story.
export const flagship = {
  engine: "fullbars",
  locale: "pl",
  template: '{{t "greeting" name=user}}\n{{t "files.deleted" count=num}}',
  data: { user: "Ada", num: 5 },
  expect: "Cześć, Ada!\nUsunięto 5 plików",
};

// The catalog rendered as a `catalog.yaml` document (message DATA only — the
// locale travels separately as `flagship.locale`), for the Open-in-Lab round-trip
// into the Lab's LOCALIZATION/catalog.yaml view (ADR-029). Strings live as YAML,
// not code; check:i18n asserts they render the flagship.
export const flagshipCatalogYaml = dumpYaml(catalog).replace(/\n+$/, "");
