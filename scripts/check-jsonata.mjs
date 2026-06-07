// SPDX-License-Identifier: Apache-2.0
//
// Gate for the "Data shaping" (JSONata) guide. Three assertions, all against the
// SAME engine the Lab and the tutorial cells run (lab/vendor/jsonata.mjs), so the
// page can never claim a result the engine doesn't produce:
//
//   1. every cell  {expr, data} ⟶ deepEqual(expect)         (snippets are honest)
//   2. the flagship transform ⟶ MaxBars render === expect    (round-trip works)
//   3. coverage: every $fn the page USES is TAUGHT, and every taught fn is used
//      (the "all used functions covered" contract — no dangling, no over-claim)
//
// Mirrors check-tutorial-links: imports the one content source, exits non-zero on
// any failure, prints a per-item ✓/✗ log.
import assert from "node:assert/strict";
import { sections, flagship, taughtFunctions } from "../tutorials/src/jsonata.mjs";
import jsonata from "../lab/vendor/jsonata.mjs";
import { createRenderer } from "../lab/renderer.mjs";

let fail = 0;
const used = new Set();
// A $fn(...) call: a $-name immediately followed by "(" — lambda params like
// $a / $acc / $i are followed by operators or ")", so they don't match.
function collectFns(src) {
  for (const m of src.matchAll(/\$[A-Za-z]+(?=\s*\()/g)) used.add(m[0]);
}

console.log("JSONata cells (vendored engine):");
for (const sec of sections) {
  for (const c of sec.cells) {
    collectFns(c.expr);
    try {
      const raw = jsonata(c.expr).evaluate(c.data);
      // JSONata returns a "sequence" (an Array subclass carrying hidden markers)
      // for multi-value path results; normalise through JSON — the same view the
      // engine consumes and the live cell shows — before comparing.
      const out = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
      assert.deepEqual(out, c.expect);
      console.log(`  ✓ ${sec.id}/${c.id} → ${JSON.stringify(out)}`);
    } catch (e) {
      console.error(`  ✗ ${sec.id}/${c.id}: ${e && e.message ? e.message.split("\n")[0] : e}`);
      fail++;
    }
  }
}

console.log("\nFlagship round-trip (data → JSONata → MaxBars):");
collectFns(flagship.transform);
try {
  const vm = jsonata(flagship.transform).evaluate(flagship.data);
  const r = await createRenderer(flagship.engine);
  const out = r.render(r.compile(flagship.template, {}).program, vm);
  assert.equal(out, flagship.expect);
  console.log(`  ✓ flagship renders ${JSON.stringify(out.slice(0, 40))}…`);
} catch (e) {
  console.error(`  ✗ flagship: ${e && e.message ? e.message.split("\n")[0] : e}`);
  fail++;
}

console.log("\nFunction-coverage contract:");
const taught = new Set(taughtFunctions);
const untaught = [...used].filter((f) => !taught.has(f)).sort();
const unused = [...taught].filter((f) => !used.has(f)).sort();
if (untaught.length) {
  console.error(`  ✗ used but NOT taught (add a section/cell): ${untaught.join(" ")}`);
  fail++;
}
if (unused.length) {
  console.error(`  ✗ taught but never demonstrated (over-claim — drop or use): ${unused.join(" ")}`);
  fail++;
}
if (!untaught.length && !unused.length) {
  console.log(`  ✓ ${taught.size} functions taught, all used; ${used.size} used, all taught`);
}

console.log(fail ? `\n${fail} JSONata check(s) failed` : `\nall JSONata cells + flagship + coverage OK`);
process.exit(fail ? 1 : 0);
