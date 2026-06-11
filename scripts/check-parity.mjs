#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Dialect-parity gate (ADR-005/008): RawBars and MaxBars are the SAME engine and
// differ only in surface syntax (+ nothing else — they share truthiness too). This
// machine-checks that contract so a future edit can't silently split them. Two
// parts, both run through the committed bundle (the artifact the editors/Lab ship):
//
//   1. TRUTHINESS — render a conditional through both dialects for a witness set of
//      values, assert (a) RawBars output == MaxBars output, and (b) the falsy set is
//      EXACTLY { false, null, "", [], {} } (so `0` stays truthy). Catches a dialect
//      drifting to a different callback (e.g. handlebars, where `0`/`""` flip).
//   2. RENDER SWEEP — render a corpus of *core-syntax* templates (valid and parsed
//      identically by both) through both dialects and assert byte-identical output.
//
// Core syntax only (explicit `lookup`, triple-stash output, `(gt …)` subexprs), so
// the two parse to the same AST; any output difference is an engine/policy split.
//
// DOCUMENTED EXCEPTIONS (NOT in the corpus — these are real surface divergences,
// not engine splits): the loop-variable *spelling* differs by the variable model
// (ADR-021) — RawBars installs bare `index`/`key`/`first`/`last`; MaxBars exposes
// loop state as `loop.index0`/`loop.key`/… and treats a bare `index` as a data
// field. (`this`/`root`/`parent` ARE shared.) Also MaxBars rejects the ClassicBars
// `{% *inline %}` decorator, and the context re-root is `{% with %}` in RawBars but
// renamed `{% scope %}` in MaxBars (ADR-039 item 9 — RawBars keeps the op-name head).
// The corpus avoids those constructs by design.
import { render, renderMaxbars } from "../lab/vendor/flatbars-engine.mjs";

const fail = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.error(`  ✗ ${m}`);
  fail.push(m);
};

// Render the same source through both dialects; returns { eq, raw, max }.
// Render the RawBars source through RawBars and the MaxBars source through MaxBars
// (the same string unless a case overrides `maxTpl` — used where the SURFACE legitimately
// diverges, e.g. RawBars `{% each %}` vs MaxBars `{% for %}`, ADR-039 — while the engine
// output must still match).
function both(rawTpl, maxTpl, data) {
  const r = render(rawTpl, data);
  const m = renderMaxbars(maxTpl, data);
  return { eq: r.ok && m.ok && r.value === m.value, ok: r.ok && m.ok, raw: r, max: m };
}

// ── 1. Truthiness: same callback, exact falsy set ────────────────────────────
console.log("Truthiness parity (RawBars ≡ MaxBars) + exact falsy set:");
const COND = `{% if (lookup this "v") %}truthy{% else %}falsy{% endif %}`;
// [label, value, expectedFalsy]. The falsy set is EXACTLY these five; everything
// else — crucially `0` and a non-empty string/array/object — is truthy.
const WITNESS = [
  ["false", false, true],
  ["null", null, true],
  ['""', "", true],
  ["[]", [], true],
  ["{}", {}, true],
  ["0", 0, false],
  ["-0", -0, false],
  ["1", 1, false],
  ["-1", -1, false],
  ['"x"', "x", false],
  ['" "', " ", false],
  ["[0]", [0], false],
  ["{a:1}", { a: 1 }, false],
  ["true", true, false],
];
for (const [label, value, expectFalsy] of WITNESS) {
  const { eq, ok: rendered, raw, max } = both(COND, COND, { v: value });
  if (!rendered) { bad(`v=${label}: render error (raw=${raw.error || "ok"}, max=${max.error || "ok"})`); continue; }
  if (!eq) { bad(`v=${label}: RawBars=${JSON.stringify(raw.value)} ≠ MaxBars=${JSON.stringify(max.value)}`); continue; }
  const expected = expectFalsy ? "falsy" : "truthy";
  if (raw.value !== expected) bad(`v=${label}: both rendered ${JSON.stringify(raw.value)}, expected ${expected} (falsy set must be exactly false/null/""/[]/{})`);
}
if (!fail.length) ok(`${WITNESS.length} witness values: identical in both, falsy set = { false, null, "", [], {} }, 0 truthy`);

// ── 2. Render sweep over a shared core corpus ────────────────────────────────
// MAINTAINER NOTE: this corpus is the cheap place to pin the parity contract —
// when a new construct lands that both dialects share (a new prelude op, a block
// form), add a line here so the contract keeps pace. Keep entries in *core syntax*
// only (so both parse to the same AST); a divergent surface form (operators,
// dialect-specific loop-var spelling) belongs in the documented exceptions, not here.
console.log("\nRender parity (RawBars ≡ MaxBars) over shared core syntax:");
const CORPUS = [
  // Unescaped output is a documented surface exception (ADR-039 item 8): RawBars keeps
  // the `{{{ … }}}` sigil; MaxBars spells it `{{ … | safe }}` (the `safe` final pipe). The
  // engine output must still match byte-for-byte.
  { id: "escape", tpl: `{{{escapeHtml (lookup this "h")}}}`, maxTpl: `{{ escapeHtml (lookup this "h") | safe }}`, data: { h: "<b>&\"'" } },
  { id: "lookup-path", tpl: `{{{lookup this "a" "b"}}}`, maxTpl: `{{ lookup this "a" "b" | safe }}`, data: { a: { b: "deep" } } },
  { id: "if-elif-else", tpl: `{% if (lookup this "a") %}A{% elif (lookup this "b") %}B{% else %}C{% endif %}`, data: { a: false, b: true } },
  { id: "unless", tpl: `{% unless (lookup this "x") %}none{% endunless %}`, data: { x: [] } },
  // `{{{this}}}` is shared; bare loop vars (index/key/…) are excluded — see the
  // documented variable-model exception above. The loop SURFACE diverges (RawBars
  // `{% each %}` vs MaxBars `{% for %}`, ADR-039 item 4), so `maxTpl` spells the
  // MaxBars form; the engine output must still match byte-for-byte.
  { id: "each-array", tpl: `{% each (lookup this "xs") %}[{{{this}}}]{% endeach %}`, maxTpl: `{% for (lookup this "xs") %}[{{ this | safe }}]{% endfor %}`, data: { xs: ["p", "q"] } },
  { id: "each-object", tpl: `{% each (lookup this "o") %}[{{{this}}}]{% endeach %}`, maxTpl: `{% for (lookup this "o") %}[{{ this | safe }}]{% endfor %}`, data: { o: { a: 1, b: 2 } } },
  // `with`/`scope` is a documented surface exception (RawBars `{% with %}` vs MaxBars
  // `{% scope %}`, ADR-039) — not in the shared corpus.
  { id: "compare", tpl: `{% if (gt (lookup this "n") 3) %}big{% else %}small{% endif %}`, data: { n: 5 } },
  { id: "arith", tpl: `{{{multiply (add (lookup this "a") 1) 2}}}`, maxTpl: `{{ multiply (add (lookup this "a") 1) 2 | safe }}`, data: { a: 4 } },
  { id: "coalesce", tpl: `{{{coalesce (lookup this "a") (lookup this "b")}}}`, maxTpl: `{{ coalesce (lookup this "a") (lookup this "b") | safe }}`, data: { a: null, b: "fallback" } },
  { id: "string-prim", tpl: `{{{uppercase (lookup this "s")}}}`, maxTpl: `{{ uppercase (lookup this "s") | safe }}`, data: { s: "hi" } },
  { id: "array-prim", tpl: `{{{join (lookup this "xs") ", "}}}`, maxTpl: `{{ join (lookup this "xs") ", " | safe }}`, data: { xs: ["a", "b", "c"] } },
  // RawBars spells the yield slot `{{{yield}}}` (raw output of the op); MaxBars spells it
  // `{% yield %}` (the structural slot, ADR-039 item 5) — both inject the caller's body.
  { id: "inline-yield", tpl: `{% inline "f" %}<{{{yield}}}>{% endinline %}{% partial "f" this %}{{{lookup this "n"}}}{% endpartial %}`, maxTpl: `{% inline "f" %}<{% yield %}>{% endinline %}{% partial "f" this %}{{ lookup this "n" | safe }}{% endpartial %}`, data: { n: "Z" } },
  { id: "nested-each-if", tpl: `{% each (lookup this "xs") %}{% if (gt this 1) %}{{{this}}}{% endif %}{% endeach %}`, maxTpl: `{% for (lookup this "xs") %}{% if (gt this 1) %}{{ this | safe }}{% endif %}{% endfor %}`, data: { xs: [1, 2, 3] } },
];
for (const c of CORPUS) {
  const { eq, ok: rendered, raw, max } = both(c.tpl, c.maxTpl ?? c.tpl, c.data);
  if (!rendered) bad(`${c.id}: render error (raw=${raw.error || "ok"}, max=${max.error || "ok"})`);
  else if (!eq) bad(`${c.id}: RawBars=${JSON.stringify(raw.value)} ≠ MaxBars=${JSON.stringify(max.value)}`);
}
if (!fail.some((m) => CORPUS.some((c) => m.startsWith(c.id)))) ok(`${CORPUS.length} core templates render identically in RawBars and MaxBars`);

console.log(fail.length ? `\n${fail.length} dialect-parity check(s) failed` : `\nall dialect-parity checks OK`);
process.exit(fail.length ? 1 : 0);
