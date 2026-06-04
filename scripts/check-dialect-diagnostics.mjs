#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:dialect-diagnostics — pin the LSP `dialectDiagnostics` RULE INVENTORY
// per dialect against a fixed witness corpus. Each rule fires on a small,
// well-known fixture and produces a recognisable message; if a refactor drops
// a rule (e.g. removes `findOperator` from the `finders` array), the
// corresponding fixture stops firing and the gate fails — every individual
// rule unit test would still pass for the OTHER rules, and the regression
// would only surface as a user-reported "the squiggle stopped appearing."
//
// New rule? Add a fixture below alongside the message regex.
// Removed a rule on purpose? Drop the fixture AND link the ADR justifying it.
import { dialectDiagnostics } from "../editors/lsp/src/tokens.mjs";

const fail = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  fail.push(msg);
};

// Each row: [dialect, source, message-regex, rule-name (for the failure message)].
// Order is intentional — most-specific rules first matches the `finders` array
// in `editors/lsp/src/tokens.mjs` `dialectRulesFor`, so any reordering there
// shows up here as a different rule matching a fixture.
const RULES = [
  // FullBars / RawBars / MaxBars all flag set-delim with the same message (the
  // dialect name in the middle varies).
  ["fullbars", "{{=<% %>=}}", /Set-delimiter directives.*FullBars.*Mustache feature.*MinBars/, "set-delim (fullbars)"],
  ["rawbars",  "{{=<% %>=}}", /Set-delimiter directives.*RawBars.*Mustache feature.*MinBars/,  "set-delim (rawbars)"],
  ["maxbars",  "{{=<% %>=}}", /Set-delimiter directives.*MaxBars.*Mustache feature.*MinBars/,  "set-delim (maxbars)"],
  // MinBars / RawBars share the rest of the dialect rules. RawBars stops here
  // because it also short-circuits on set-delim above; verify the cascading
  // rules for both dialects in MinBars (the engine accepts everything we test
  // through it without parser errors, so we see only the LSP-side messages).
  ["minbars", `{{#each (lookup x "y")}}{{/each}}`,    /Subexpressions/,             "subexpression"],
  ["minbars", "{{#each items as |item|}}{{/each}}",   /Block parameters/,           "block params"],
  ["minbars", `{{> p name="v"}}`,                     /Partial hash arguments/,     "partial hash args"],
  ["minbars", "{{ a ?? b }}",                         /Operator `\?\?`.*MaxBars/,   "MaxBars operator"],
  ["minbars", "{{lookup x y}}",                       /Helper invocations/,         "helper-args (catch-all)"],
];

console.log(`dialect-diagnostics rule inventory (${RULES.length} fixtures):`);
for (const [dialect, src, re, name] of RULES) {
  const ds = dialectDiagnostics(src, dialect);
  if (ds.some((d) => re.test(d.message))) {
    ok(`${name}: fires on ${JSON.stringify(src)} in ${dialect}`);
  } else {
    bad(`${name}: NOT firing on ${JSON.stringify(src)} in ${dialect} — got ${ds.length ? JSON.stringify(ds.map((d) => d.message)) : "no diagnostics"}`);
  }
}

// Negative parity: MinBars accepts everything except its own non-Mustache
// shapes; the directive itself MUST be silent under MinBars (it IS the
// supported dialect for set-delim).
const minSetDelim = dialectDiagnostics("{{=<% %>=}}", "minbars");
if (minSetDelim.length === 0) ok("set-delim: silent under MinBars (the supported dialect)");
else bad(`set-delim should be silent under MinBars; got ${JSON.stringify(minSetDelim.map((d) => d.message))}`);

if (fail.length) {
  console.error(`\n✗ check:dialect-diagnostics — ${fail.length} rule(s) failed inventory`);
  process.exit(1);
}
console.log(`\n✓ check:dialect-diagnostics — every rule fires on its witness fixture`);
