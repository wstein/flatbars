// SPDX-License-Identifier: Apache-2.0
//
// Transformers dock panel: the "what built-ins does this template reach?"
// view. Lists every transformer name referenced by the compiled program with
// its call sites, then the catalog of every available built-in (engine-
// driven) so the panel doubles as a quick reference — visible even when the
// template uses no transformers, because that is exactly the moment the user
// wants to browse what is available.
//
// Pure renderer — all state and DOM helpers arrive via `deps` so the module
// keeps no globals.

// ADR-0013 dropped the capability-group tiers, so the catalog now groups
// built-ins by *purpose* (encoding, strings, collections, …). The order
// flows from "fundamentals" (encoding, defaults) outward to specialised
// domains (logic, predicates), ending with the lone policy-relevant
// transformer (`eval`).
const PURPOSE_ORDER = [
  "encoding",
  "strings",
  "collections",
  "access",
  "logic",
  "predicates",
  "dynamic",
  "host",
];

const PURPOSE_LABEL = {
  encoding:   ["encoding",   "escape & serialise"],
  strings:    ["strings",    "text shape"],
  collections:["collections","list / map shape"],
  access:     ["access",     "read & default"],
  logic:      ["logic",      "pure-value ops"],
  predicates: ["predicates", "bool tests"],
  dynamic:    ["dynamic",    "opt-in (data-scope disclosure risk)"],
  host:       ["host",       "custom"],
};

// Purpose categorisation independent of the engine catalog's coarse
// `:minimum` bucket. Reads as a glossary: each name listed once, in the
// purpose the author would search for it under.
const PURPOSE_OF_BUILTIN = (() => {
  const m = Object.create(null);
  const tag = (purpose, ...names) => names.forEach((n) => { m[n] = purpose; });
  tag("encoding",    "escape_html", "escape_json", "json", "inspect");
  tag("strings",     "capitalize", "downcase", "replace", "trim", "truncate", "upcase", "t", "translate");
  tag("collections", "compact", "dict", "filter", "flatten", "group_by", "join", "list", "map", "reverse", "sort", "sort_by", "split", "uniq");
  tag("access",      "at", "default", "drop", "first", "last", "len", "log", "lookup", "slice", "take");
  tag("logic",       "add", "sub", "mul", "div", "mod", "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not");
  tag("predicates",  "contains", "empty?", "present?", "starts_with", "ends_with");
  tag("dynamic",     "eval");
  return m;
})();

export function renderTransformers(body, deps) {
  const {
    usedTransformers: txs,
    calls,
    engineBuiltins,
    makeEl,
    fileSource,
    charToLineColumn,
    byteRangeToCharRange,
    openProblem,
    // ADR-0020 Phase 4: true when the engine derives `used-transformers`
    // heuristically (a static AST walk) rather than from a compiled wire — the
    // case for Handlebars, where the `{{helper}}`-vs-data ambiguity means the
    // list can be incomplete. The "Copy allow-list" export is gated OFF in that
    // case (a wrong allow-list would break rendering under knownHelpersOnly),
    // replaced by an "approximate" badge.
    usedTransformersApproximate,
  } = deps;

  const section = makeEl("div", { class: "tx-section" });
  const usedSet = new Set(txs);

  // ── Left column: Used transformers ──────────────────────────────────
  const usedCol = makeEl("div", { class: "tx-used-col" });
  const usedHead = makeEl("div", { class: "tx-used-head" }, [
    makeEl("strong", {}, `Used transformers`),
    makeEl("span", { class: "tx-avail-count" },
      txs.length === 0 ? "none" : txs.length === 1 ? "1 transformer" : `${txs.length} transformers`),
  ]);
  if (usedTransformersApproximate) {
    // Heuristic report (e.g. Handlebars): badge it and withhold the allow-list
    // export until a render round-trip can verify it (ADR-0020 Phase 4).
    usedHead.append(makeEl("span", {
      class: "tx-avail-count",
      title: "Approximate (static AST estimate) — the {{helper}}-vs-data ambiguity means this list may be incomplete, so the allow-list export is disabled until a render round-trip can verify it.",
    }, "≈ approximate"));
  } else if (txs.length > 0) {
    const copyBtn = makeEl("button", { class: "tx-copy", title: "Copy as JSON allow-list" }, "Copy allow-list");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify(txs)).catch(() => {});
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy allow-list"; }, 1500);
    });
    usedHead.append(copyBtn);
  }
  usedCol.append(usedHead);

  if (txs.length === 0) {
    usedCol.append(makeEl("div", { class: "tx-empty" },
      "No transformers referenced. Browse the catalog → and call one in your template."));
  } else {
    // Group the call-site array by transformer name; each name expands to its
    // jump-linked sites.
    const sitesByName = new Map();
    for (const c of calls) {
      if (!sitesByName.has(c.name)) sitesByName.set(c.name, []);
      sitesByName.get(c.name).push(c);
    }
    const list = makeEl("div", { class: "tx-rows" });
    for (const name of txs) {
      const purpose = PURPOSE_OF_BUILTIN[name] || "host";
      const sites = sitesByName.get(name) || [];
      const row = makeEl("div", { class: "tx-row" });
      // Reuse the catalog's chip class so the Used-transformer chips read
      // visually identical to their Available-catalog counterparts on the
      // right (same shape, padding). `tx-avail-used` lifts the opacity to
      // 1 since these are by definition all "used here". Only `eval` keeps
      // a distinct colour: it is the one policy-relevant built-in (ADR-0013).
      row.append(makeEl("span", {
        class: `tx-avail-chip tx-avail-used tx-purpose-${purpose}`,
        title: `purpose: ${purpose}`,
      }, name));
      row.append(makeEl("span", { class: "tx-sites-count" }, sites.length === 1 ? "1 call" : `${sites.length} calls`));
      const sitesEl = makeEl("div", { class: "tx-sites" });
      for (const s of sites) {
        const src = fileSource(s.file);
        const pos = (typeof s.start === "number") ? charToLineColumn(src, byteRangeToCharRange(src, s.start, s.end)[0]) : { line: 1, column: 1 };
        const link = makeEl("button", { class: "tx-site", title: "jump to source" },
          `${s.file}:${pos.line}:${pos.column}`);
        link.addEventListener("click", () => openProblem({ file: s.file, line: pos.line, col: pos.column }));
        sitesEl.append(link);
      }
      row.append(sitesEl);
      list.append(row);
    }
    usedCol.append(list);
  }
  section.append(usedCol);

  // ── Right column: Available transformers catalog ────────────────────
  // Driven by allTransformers() from the loaded WASM — always in sync with
  // the engine binary. Used chips are highlighted so the catalog doubles as
  // a "what else is available?" reference. Rendered whether or not the
  // template currently uses any transformer — discovery matters most when
  // the answer is "none yet." Grouped by purpose (encoding, strings, …) so
  // an author can find a name by what it *does*; `eval` is the only chip
  // that keeps a distinct colour (ADR-0013 policy signal).
  const byPurpose = {};
  for (const name of engineBuiltins) {
    const purpose = PURPOSE_OF_BUILTIN[name] || "host";
    if (!byPurpose[purpose]) byPurpose[purpose] = [];
    byPurpose[purpose].push(name);
  }
  // Within each purpose, sort names alphabetically — the catalog reads as a
  // glossary, so predictable order beats catalog-emission order.
  for (const names of Object.values(byPurpose)) names.sort();

  const availDetail = makeEl("details", { class: "tx-avail" });
  availDetail.open = true;
  const usedCount = engineBuiltins.filter((n) => usedSet.has(n)).length;
  availDetail.append(makeEl("summary", {}, [
    `Available transformers `,
    makeEl("span", { class: "tx-avail-count" },
      `${engineBuiltins.length} built-ins` + (usedCount ? ` · ${usedCount} used here` : "")),
  ]));

  // Purpose sections flow as a responsive grid (CSS handles the breakpoint).
  const tiers = makeEl("div", { class: "tx-avail-tiers" });
  for (const purpose of PURPOSE_ORDER) {
    const names = byPurpose[purpose];
    if (!names || names.length === 0) continue;
    const [label, sub] = PURPOSE_LABEL[purpose];
    const tier = makeEl("div", { class: "tx-avail-tier" });
    tier.append(makeEl("div", { class: "tx-avail-tier-head" }, [
      label,
      makeEl("span", { class: "tx-avail-tier-sub" }, sub),
    ]));
    const chips = makeEl("div", { class: "tx-avail-chips" });
    for (const name of names) {
      const cls = `tx-avail-chip tx-purpose-${purpose}` + (usedSet.has(name) ? " tx-avail-used" : "");
      const chip = makeEl("span", {
        class: cls,
        title: usedSet.has(name) ? "used in this template" : "",
        "data-tx-name": name,
      }, name);
      chips.append(chip);
    }
    tier.append(chips);
    tiers.append(tier);
  }
  availDetail.append(tiers);

  section.append(availDetail);
  body.append(section);
}
