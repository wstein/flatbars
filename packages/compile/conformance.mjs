// SPDX-License-Identifier: Apache-2.0
// Conformance harness: compile every example and assert the compiled output ==
// the interpreter's output (the executable spec). Run: node packages/compile/conformance.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compile, render } from "../../reference/web/vendor/barebars-engine.mjs";
import rt from "./runtime/barebars-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "../../examples");
const names = readdirSync(examplesDir).filter((n) => {
  try { return readFileSync(resolve(examplesDir, n, "template.hbs")); } catch { return false; }
});

let pass = 0, fail = 0;
for (const name of names) {
  const dir = resolve(examplesDir, name);
  const tmpl = readFileSync(resolve(dir, "template.hbs"), "utf8");
  const data = JSON.parse(readFileSync(resolve(dir, "data.json"), "utf8"));
  const interp = render(tmpl, data);
  const c = compile(tmpl);
  if (!c.ok) { console.log(`  SKIP ${name} — compile error: ${c.error}`); fail++; continue; }
  let compiled;
  try {
    const mod = await import("data:text/javascript," + encodeURIComponent(c.value));
    compiled = mod.default(data, rt);
  } catch (e) {
    console.log(`  FAIL ${name} — runtime threw: ${e.message}`); fail++; continue;
  }
  if (!interp.ok) { console.log(`  ?    ${name} — interpreter errored: ${interp.error}`); continue; }
  if (compiled === interp.value) { console.log(`  ok   ${name}`); pass++; }
  else {
    console.log(`  FAIL ${name}`);
    console.log(`       interp:   ${JSON.stringify(interp.value).slice(0, 90)}`);
    console.log(`       compiled: ${JSON.stringify(compiled).slice(0, 90)}`);
    fail++;
  }
}
console.log(`\n${pass}/${pass + fail} examples conform (compiled === interpreter)`);
process.exit(fail === 0 ? 0 : 1);
