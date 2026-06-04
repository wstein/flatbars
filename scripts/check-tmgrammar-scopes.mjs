#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// check:tmgrammar-scopes — assert specific TextMate scope assignments at
// specific offsets. `check:tmgrammar` only verifies tag BOUNDARIES (which
// chars are inside a tag); some bugs corrupt SCOPES without changing
// boundaries. This gate pins targeted invariants that the boundary check
// cannot see.
//
// Current invariants (each a regression test for a real bug):
//
// 1. `>=` greedy-consume regression (d76e093 → 31cce1a). The `set_delimiter`
//    rule's END pattern is `=}}`; if `tag_interior` is ever re-included on
//    the rule, `tag_operator`'s `>=` / `<=` / `==` regex pre-consumes the
//    `=` the END needs, leaving the rule unclosed and dragging
//    `meta.embedded.line.flatbars` state across subsequent text. The
//    grammar boundaries don't change (every char is still "in a tag" in
//    SOME sense), but the closing `}}` loses its `punctuation.section.embedded.end`
//    scope. Pin that scope explicitly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(import.meta.url);
const onigPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const { Registry, parseRawGrammar, INITIAL } = (await import("vscode-textmate")).default;
const oniguruma = (await import("vscode-oniguruma")).default;
await oniguruma.loadWASM(readFileSync(onigPath));
const registry = new Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (s) => new oniguruma.OnigScanner(s),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scope) => {
    if (scope !== "source.flatbars") return null;
    return parseRawGrammar(readFileSync(resolve(root, "editors/flatbars.tmLanguage.json"), "utf8"), "flatbars.tmLanguage.json");
  },
});
const grammar = await registry.loadGrammar("source.flatbars");

let failures = 0;
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

// Run a per-line tokenization (state-preserving) and return the scopes that
// cover a given (line, char) coordinate.
function scopesAt(lines, line, char) {
  let state = INITIAL;
  for (let i = 0; i < line; i++) {
    state = grammar.tokenizeLine(lines[i], state).ruleStack;
  }
  const r = grammar.tokenizeLine(lines[line], state);
  for (const t of r.tokens) {
    if (char >= t.startIndex && char < t.endIndex) return t.scopes;
  }
  return [];
}

// ── 1. set_delimiter END scope on the trailing `}}` ──
// `{{=<% %>=}}` has a `>` immediately before `=}}`; the closing `}}` MUST
// carry `punctuation.section.embedded.end.flatbars`. Pre-d76e093 it did not.
{
  const src = "{{=<% %>=}}";
  const scopes = scopesAt([src], 0, src.length - 2); // first `}` of `}}`
  if (scopes.some((s) => s === "punctuation.section.embedded.end.flatbars")) {
    pass(`set_delimiter END: trailing }} carries punctuation.section.embedded.end.flatbars in ${JSON.stringify(src)}`);
  } else {
    fail(`set_delimiter END: trailing }} missing punctuation.section.embedded.end.flatbars in ${JSON.stringify(src)} — scopes were ${JSON.stringify(scopes)}`);
  }
}

// State-release check: a `{{=<% %>=}}` directive followed by a default-delim
// `{{ }}` (the engine has switched back to default by then, or this is a
// dialect that doesn't switch). The grammar's set_delimiter rule MUST close
// on its own line so the next `{{` matches a fresh `variable` rule with
// `punctuation.section.embedded.begin.flatbars`. Pre-d76e093 the `>=` consume
// left the rule open and the subsequent `{{` was a sub-region inside it.
{
  const lines = ["{{=<% %>=}}", "{{ name }}"];
  const scopes = scopesAt(lines, 1, 0); // first `{` of line 1's `{{`
  if (scopes.some((s) => s === "punctuation.section.embedded.begin.flatbars")) {
    pass("set_delimiter releases state: subsequent default-delim {{ picks up punctuation.section.embedded.begin.flatbars");
  } else {
    fail(`set_delimiter leaks state: line 1's {{ has scopes ${JSON.stringify(scopes)}, missing punctuation.section.embedded.begin.flatbars`);
  }
}

if (failures) {
  console.error(`\n✗ check:tmgrammar-scopes — ${failures} invariant(s) failed`);
  process.exit(1);
}
console.log(`\n✓ check:tmgrammar-scopes — all targeted scope invariants hold`);
