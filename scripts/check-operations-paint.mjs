#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Catalog-vs-painter parity gate — for every name in operations.json, render it
// at the head position of an `expr` tag through the LSP `tokensOf` and assert it
// paints as `operation`. Conversely a fixture of NON-catalog identifiers must
// stay default-coloured. Keeps the catalog and the painter from silently
// diverging (e.g. a new prelude op the painter doesn't recognise, or a painter
// refactor that drops the head-paint behaviour).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensOf } from "../editors/lsp/src/tokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const catalogue = JSON.parse(readFileSync(resolve(root, "editors/operations.json"), "utf8"));
const operations = catalogue.operations;

const fails = [];

// Positive: each catalogued operation in head position MUST paint as `operation`.
// Catalogue entries that are CLAUSE SEPARATORS (engine `keyword` tag class) — they
// live in the catalogue for hover/completion but are NOT helper invocations, so
// the painter correctly leaves them to the engine's keyword-kind paint. `when` is the
// `{{#case}}` arm separator (RawBars/MaxBars); `else`/`elif` are the `{{#if}}` clauses.
const KEYWORD_NAMES = new Set(["else", "elif", "when"]);

for (const op of operations) {
  const text = `{{${op.name} x}}`;
  // A separator paints as a keyword only in a dialect that treats it as one — `when` is
  // a separator in MaxBars (its `clauseSeps`), not in FullBars. Tokenize the keyword
  // names through MaxBars (where else/elif/when are all separators), the helper
  // operations through FullBars.
  const tokens = tokensOf(text, KEYWORD_NAMES.has(op.name) ? "maxbars" : "fullbars");
  // Find any token that covers the head identifier's first character (offset 2,
  // after `{{`). For `operation`-kind paints the token covers just the name;
  // for `keyword`-kind paints (else / elif / when) the token covers the whole inner
  // trimmed body. Either way, the token at offset 2 carries the kind we care about.
  const opTok = tokens.find((t) => t.char <= 2 && t.char + t.length > 2);
  const expectedKind = KEYWORD_NAMES.has(op.name) ? "keyword" : "operation";
  if (!opTok || opTok.kind !== expectedKind) {
    fails.push(`positive: '${op.name}' should paint as ${expectedKind} in '${text}' (got ${opTok?.kind ?? "no token"})`);
  }
}

// Negative: bare identifiers NOT in the catalogue must NOT paint as `operation`.
const knownNames = new Set(operations.map((o) => o.name));
const fakes = ["xyzzy", "totallyMadeUp", "notAHelper", "userVariable", "myCustomName"]
  .filter((n) => !knownNames.has(n));
if (fakes.length === 0) throw new Error("test setup: every made-up name happens to be in the catalogue");
for (const name of fakes) {
  const text = `{{${name} x}}`;
  const tokens = tokensOf(text, "fullbars");
  const opTok = tokens.find((t) => t.kind === "operation");
  if (opTok) {
    fails.push(`negative: '${name}' should NOT paint as operation in '${text}'`);
  }
}

if (fails.length) {
  console.log(`✗ operations-paint parity failed (${fails.length} of ${operations.length} positive + ${fakes.length} negative cases):`);
  for (const f of fails.slice(0, 10)) console.log("  - " + f);
  if (fails.length > 10) console.log(`  ... and ${fails.length - 10} more`);
  process.exit(1);
}
const kwCount = [...KEYWORD_NAMES].filter((n) => operations.some((o) => o.name === n)).length;
console.log(
  `✓ operations-paint parity: ${operations.length - kwCount} catalog names paint as operation, ` +
  `${kwCount} as keyword (else/elif/when), ${fakes.length} non-catalog names stay default`,
);
