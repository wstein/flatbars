// SPDX-License-Identifier: Apache-2.0
//
// The "Localize" guide content — ONE source for the page (OpenInLab i18n cards) and the
// gate (scripts/check-i18n.mjs). It demonstrates ADR-029's i18n *seam*: FlatBars
// ships no i18n; the Lab acts as the HOST and wires a `t` helper to the browser's
// native `Intl` (the CLDR plural/format brain, zero bundle cost) through the
// ADR-018 registerHelper / renderWith path — no engine feature, no vendored lib
// (see the ADR-029 amendment, 2026-06-05).
//
// Each cell carries its `expect`, the string ClassicBars must render for
// {template, data} with the `t` helper bound to `locale`; the gate asserts it, so
// a snippet can never drift from what the engine produces. The Polish (`pl`) cells
// exercise a non-trivial plural set (one/few/many/other) and the locale-aware
// number grouping cells show `Intl.NumberFormat` per locale — both for free from
// the platform, which is exactly why i18next is NOT vendored.

import { dump as dumpYaml } from "../../lab/vendor/js-yaml.mjs";
import { makeTranslator as labMakeTranslator } from "../../lab/i18n.mjs";

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

// Human labels for the locale switcher (the page's OpenInLab i18n cards).
export const localeNames = { en: "English", de: "Deutsch", pl: "Polski" };

// ── The i18n helper bag (still used by the gate's live-render check) ──────────
// Built from the catalog above bound to a locale, reusing the Lab's single i18n
// core (lab/i18n.mjs makeI18nBag) — the translate/plural/format logic lives in ONE
// place, so the page and the Lab can't drift (the t/number/… helpers, the native
// `Intl` brain). For an inline helper the key=value hash arrives as a trailing
// object directly (ClassicBars convention), so `number n style="…"` calls
// number(n, { style: "…" }). Swap native Intl for i18next/ICU in production (see
// `escapeHatch`).
export const makeTranslator = (locale) => labMakeTranslator(catalog, locale);

// ── The teaching artifacts the page shows verbatim ───────────────────────────
// How a host wires the seam (the code behind every cell on this page). For an
// inline helper the key=value hash arrives as a trailing object directly.
export const integrationSource = `// The Lab acts as the HOST. FlatBars ships no i18n; seed ONE translator (the
// first-class seam — NOT registerHelper) that drives t / number / date, backed
// by native Intl — the browser's CLDR plural/format brain, zero bundle (ADR-029).
registerTranslator((name, args) => translate(locale, name, args));`;

// The unbundled escape hatch: drop in your real stack behind the same seam.
export const escapeHatch = `// i18next:
import i18next from "i18next";
registerTranslator((name, args) => name === "t" ? i18next.t(args[0], args[1]) : args[0]);

// or ICU MessageFormat (@formatjs/intl-messageformat):
import { IntlMessageFormat } from "intl-messageformat";
registerTranslator((name, args) =>
  name === "t" ? new IntlMessageFormat(catalog[locale][args[0]], locale).format(args[1]) : args[0]);`;

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
        note: "{name} is a hash argument the host's translate() substitutes. Flip the locale picker — en/de/pl all read from the one catalog above.",
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
      "(one/few/many/other), English two. The host picks the right variant with the " +
      "browser's native Intl.PluralRules — no plural data shipped, which is why " +
      "i18next is not vendored. One interactive card covers every case.",
    cells: [
      {
        id: "plural",
        label: "Plural categories — try the count and locale",
        note: "Bump the count to 1 (one), 2 (few), 5 (many) and flip to Polski: English collapses 2 and 5 into `other`, Polish keeps them distinct. The variants all live in the catalog above.",
        locale: "pl",
        template: '{{t "files.deleted" count=count}}',
        data: { count: 2 },
        expect: "Usunięto 2 pliki",
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
        id: "grouping",
        label: "Digit grouping — flip the locale",
        note: "Switch English ↔ Deutsch and watch 1,000 (comma) become 1.000 (period). Same count, grouped per locale.",
        locale: "en",
        template: '{{t "cart.items" count=count}}',
        data: { count: 1000 },
        expect: "1,000 items in your cart",
      },
    ],
  },
  {
    id: "formatting",
    title: "Formatting helpers — number, date, relative, selectPlural",
    lead:
      "Four more blessed prelude operations (ADR-029), overridden here by the host's " +
      "native-Intl versions: number/date/relative format through Intl.NumberFormat / " +
      "DateTimeFormat / RelativeTimeFormat; selectPlural exposes the raw CLDR category. " +
      "Each also takes a trailing Intl options hash (noted inline to try). Flip the " +
      "locale on any card to watch it re-derive — these use no catalog, only the platform.",
    cells: [
      {
        id: "number",
        label: "number — Intl.NumberFormat",
        note: 'Decimal + grouping per locale. Add an options hash to format money — try style="currency" currency="EUR".',
        locale: "de",
        template: "{{number num}}",
        data: { num: 1234.5 },
        expect: "1.234,5",
      },
      {
        id: "date",
        label: "date — Intl.DateTimeFormat",
        note: "Numeric fields, UTC. Flip the locale to reorder day/month/year and swap the separators.",
        locale: "en",
        template: "{{date d}}",
        data: { d: "2026-06-05" },
        expect: "06/05/2026",
      },
      {
        id: "relative",
        label: "relative — Intl.RelativeTimeFormat",
        note: 'numeric:auto yields the idiom (pl "wczoraj", en "yesterday"). Add numeric="always" to force the numeric form ("1 day ago").',
        locale: "pl",
        template: "{{relative offset unit}}",
        data: { offset: -1, unit: "day" },
        expect: "wczoraj",
      },
      {
        id: "selectPlural",
        label: "selectPlural — the raw category",
        note: 'The CLDR category itself (Polish 2 → `few`; English → `other`). Add type="ordinal" for ordinal categories.',
        locale: "pl",
        template: "{{selectPlural count}}",
        data: { count: 2 },
        expect: "few",
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
        note: "`checkout.title` has no catalog entry, so the key surfaces verbatim — easy to spot and flag. Add it to the catalog above and watch this resolve live.",
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
  engine: "classicbars",
  locale: "pl",
  template: '{{t "greeting" name=user}}\n{{t "files.deleted" count=count}}',
  data: { user: "Ada", count: 5 },
  expect: "Cześć, Ada!\nUsunięto 5 plików",
};

// The catalog rendered as a `catalog.yaml` document (message DATA only — the
// locale travels separately as `flagship.locale`), for the Open-in-Lab round-trip
// into the Lab's LOCALIZATION/catalog.yaml view (ADR-029). Strings live as YAML,
// not code; check:i18n asserts they render the flagship.
export const flagshipCatalogYaml = dumpYaml(catalog).replace(/\n+$/, "");
