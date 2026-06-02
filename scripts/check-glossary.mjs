#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:glossary (ADR-019) — keep the two registers from drifting. The native
// model uses *operation* / *definition* / *scope* / *inline* / *block* /
// *operator* (concepts.adoc #glossary); the host API keeps the word *helper* for
// the same machinery (host-api.adoc §7.4). This gate asserts the glossary defines
// every native term WITH its host-API synonym, and that the host API agrees —
// it keeps `registerHelper`/"helper" and documents the renamed `Operation`
// contract. It checks *terms*, not prose, so it is cheap and not a writing tax.
//
//   node scripts/check-glossary.mjs
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const pages = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/modules/ROOT/pages");
const concepts = readFileSync(resolve(pages, "concepts.adoc"), "utf8");
const hostApi = readFileSync(resolve(pages, "host-api.adoc"), "utf8");
const rawbars = readFileSync(resolve(pages, "adr-0008-rawbars.adoc"), "utf8");
const maxbars = readFileSync(resolve(pages, "maxbars.adoc"), "utf8");

const fail = [];
const need = (cond, msg) => { if (!cond) fail.push(msg); };

// The glossary section: the `== Glossary` heading to the next top-level heading.
need(concepts.includes("[#glossary]"), "concepts.adoc: missing the [#glossary] anchor (the §1 xref target)");
const gi = concepts.indexOf("== Glossary");
need(gi >= 0, "concepts.adoc: missing the '== Glossary' section");
const after = gi >= 0 ? concepts.indexOf("\n== ", gi + 5) : -1;
const glossary = gi >= 0 ? concepts.slice(gi, after >= 0 ? after : concepts.length) : "";

// concepts §1 must point readers at the glossary (discoverability of the registers).
need(/xref:concepts\.adoc#glossary/.test(concepts), "concepts.adoc: §1 must xref the #glossary");

// Every native term is defined (as a bold `*term*` row) and carries its host-API
// synonym (the migrator's word). `operator` is surface-only — no host synonym.
const terms = [
  { term: "operation", synonym: "helper" },
  { term: "definition", synonym: "helper" }, // cell: "(registered) helper / partial"
  { term: "scope", synonym: "context" },
  { term: "inline operation", synonym: "inline helper" },
  { term: "block operation", synonym: "block helper" },
  { term: "operator", synonym: null },
];
for (const { term, synonym } of terms) {
  const boldTerm = new RegExp("\\*" + term.replace(/ /g, "\\s+") + "\\*");
  need(boldTerm.test(glossary), `glossary: native term "${term}" is not defined`);
  if (synonym) {
    need(glossary.includes(synonym), `glossary: term "${term}" must carry its host-API synonym "${synonym}"`);
  }
}

// The host API agrees: the boundary word `helper` is frozen (ADR-018/019), and
// the helper fn follows the renamed `Operation` contract.
need(/registerHelper/.test(hostApi), "host-api.adoc: must keep `registerHelper` (frozen boundary word)");
need(/\bhelper\b/i.test(hostApi), "host-api.adoc: must keep the word \"helper\" (the migrator's term)");
need(/`Operation`|Operation m /.test(hostApi), "host-api.adoc §7.3/§7.4: the helper fn must follow the `Operation` contract (renamed type)");

// The SECOND boundary spelling (ADR-019 addendum): the native dialects expose
// host-registered operations as `renderWithOperations`, NOT `renderWith`/
// `registerHelper` — the FullBars-frozen word. Both dialect pages must document
// the native spelling so the two registers cannot drift back together.
need(/renderWithOperations/.test(rawbars), "adr-0008-rawbars.adoc: must document `renderWithOperations` (native operation boundary, ADR-019 addendum)");
need(/\boperation/i.test(rawbars), "adr-0008-rawbars.adoc: must use the native word \"operation\" (not \"helper\") for RawBars");
need(/renderWithOperations/.test(maxbars), "maxbars.adoc: must document `renderWithOperations` (native operation boundary, ADR-019 addendum)");
need(/\boperation/i.test(maxbars), "maxbars.adoc: must use the native word \"operation\" (not \"helper\") for MaxBars");

if (fail.length) {
  console.error("✗ operation-vocabulary check failed (ADR-019):");
  for (const m of fail) console.error("  - " + m);
  console.error("  Fix the glossary (concepts.adoc) or host-api.adoc so the two registers agree.");
  process.exit(1);
}
console.log(`✓ operation vocabulary coherent — ${terms.length} native terms paired with their host-API synonyms; renderWithOperations documented for RawBars + MaxBars`);
