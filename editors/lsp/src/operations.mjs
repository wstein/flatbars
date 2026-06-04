// SPDX-License-Identifier: Apache-2.0
//
// The prelude operations the LSP offers for hover + completion (ADR-017). The data
// is editors/operations.json — projected from FullBars.preludeSchema by
// scripts/gen-operations.mjs and kept honest by check:operations — imported here
// as data so the bundler inlines it into the self-contained server (like the token
// vocabulary). This module is pure (no transport, no server library), so the unit
// test drives it directly; server.mjs maps its plain shapes onto LSP types.
//
// Each operation carries only what the engine knows: name, the ADR-019 kind
// (value/inline/block), arity, source (registered/scoped/alias/synonym), and an
// alias/synonym target. There is no prose doc — that lives in the spec, and the
// signature below is SYNTHESISED structurally from the kind, never invented copy.
import operationsJson from "../../operations.json" with { type: "json" };

export const OPERATIONS = operationsJson.operations;

const byName = new Map(OPERATIONS.map((o) => [o.name, o]));
export function operationByName(name) {
  return byName.get(name) ?? null;
}

// The canonical rewrite for a name, or null. Offered for deprecated `alias`es
// (e.g. downcase → lowercase) and the non-canonical `scoped` spellings (index →
// index0, partial-block → yield) — NOT `synonym`s, which are endorsed equals.
// Returns { canonical, source } so the caller can dialect-scope the scoped case.
export function rewriteFor(name) {
  const op = byName.get(name);
  if (!op || !op.canonical) return null;
  if (op.source === "alias" || op.source === "scoped") return { canonical: op.canonical, source: op.source };
  return null;
}

// A one-line usage, derived from the ADR-019 kind. Engine-shaped, not prose.
export function signatureOf(op) {
  switch (op.kind) {
    case "block":
      return `{{#${op.name} …}}…{{/${op.name}}}`;
    case "value":
      return `{{${op.name}}}`;
    default: // inline
      return `{{${op.name} …}}`;
  }
}

// The hover body (Markdown): a heading (kind / alias / synonym), the operation's
// one-line prose doc from the prelude (when it has one — scoped variables don't), a
// synthesised signature, and the arity.
export function hoverMarkdown(op) {
  let head;
  if (op.source === "alias") head = `**${op.name}** — deprecated alias of \`${op.canonical}\``;
  else if (op.source === "synonym") head = `**${op.name}** — synonym of \`${op.canonical}\``;
  else if (op.source === "scoped") head = `**${op.name}** — ${op.kind} (scoped variable)`;
  else head = `**${op.name}** — ${op.kind} operation`;
  const parts = [head];
  if (op.doc) parts.push(op.doc);
  parts.push(`\`\`\`handlebars\n${signatureOf(op)}\n\`\`\``);
  parts.push(`arity: ${op.arity}`);
  return parts.join("\n\n");
}

// The completion detail (a one-liner shown beside the label).
export function completionDetail(op) {
  if (op.source === "synonym") return `synonym of ${op.canonical} · ${op.kind}`;
  if (op.source === "scoped") return `scoped · ${op.kind}`;
  return `${op.kind} · arity ${op.arity}`;
}

// Completion candidates: canonical names + scoped variables + synonyms, but NOT
// deprecated aliases (those still HOVER, so existing code is explained, but the
// editor never suggests writing them). Scoped variables sort after helpers.
export function completionItems() {
  return OPERATIONS.filter((o) => o.source !== "alias").map((o) => ({
    label: o.name,
    detail: completionDetail(o),
    kind: o.source === "scoped" ? "variable" : "function",
    sortText: (o.source === "scoped" ? "1" : "0") + o.name,
  }));
}
