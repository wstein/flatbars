// SPDX-License-Identifier: Apache-2.0
//
// The compiler conformance harness — the gate that keeps the two execution
// paths from drifting. For every case it renders with the INTERPRETER
// (FullBars.renderWith, the executable spec) and with the COMPILED function
// (BareBars.Compile → JS, run against the runtime) and asserts byte-identical
// output. Sources: the inline corpus (conformance/cases.mjs) + the golden
// examples/ (core templates).
//
// Engine functions are imported from `output/` (the spago build product), so the
// harness always tests current source — not a possibly-stale bundle. Run:
//
//   npm run test:compile        # spago build && node packages/compile/conformance.mjs
//
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cases as corpus } from "./conformance/cases.mjs";
import rt from "./runtime/barebars-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const enginePath = resolve(root, "output/FullBars.JS/index.js");
if (!existsSync(enginePath)) {
  console.error("error: " + enginePath + " not found — run `spago build` first (npm run test:compile does).");
  process.exit(2);
}
const { compile, render } = await import(enginePath);

// Render with the interpreter (the spec). `render` is FullBars.renderWith over
// core syntax: render(template, data) -> { ok, value, error }.
const interpret = (t, d) => render(t, d == null ? null : d);

// Compile then execute against the runtime: -> { ok, value, error }.
async function runCompiled(t, d) {
  const c = compile(t);
  if (!c.ok) return { ok: false, value: "", error: "compile: " + c.error };
  try {
    const mod = await import("data:text/javascript," + encodeURIComponent(c.value));
    return { ok: true, value: mod.default(d == null ? null : d, rt), error: "" };
  } catch (e) {
    return { ok: false, value: "", error: "runtime: " + (e && e.message ? e.message : String(e)) };
  }
}

// Collect cases: the inline corpus + every examples/*/ (core templates).
function exampleCases() {
  const dir = resolve(root, "examples");
  return readdirSync(dir)
    .filter((n) => existsSync(resolve(dir, n, "template.hbs")))
    .map((n) => ({
      name: "example:" + n,
      t: readFileSync(resolve(dir, n, "template.hbs"), "utf8"),
      d: JSON.parse(readFileSync(resolve(dir, n, "data.json"), "utf8")),
    }));
}
const allCases = [...corpus, ...exampleCases()];

let pass = 0, fail = 0;
const fails = [];
for (const { name, t, d } of allCases) {
  const spec = interpret(t, d);
  const got = await runCompiled(t, d);
  if (!spec.ok) {
    // The interpreter itself errored — not a compiler conformance case.
    console.log(`  ?    ${name} — interpreter errored: ${spec.error}`);
    continue;
  }
  if (got.ok && got.value === spec.value) {
    pass++;
  } else {
    fail++;
    fails.push({ name, spec: spec.value, got: got.ok ? got.value : got.error, ok: got.ok });
  }
}

for (const f of fails) {
  console.log(`\n  FAIL ${f.name}`);
  console.log(`       interpreter: ${JSON.stringify(f.spec)}`);
  console.log(`       compiled:    ${f.ok ? JSON.stringify(f.got) : "ERROR " + f.got}`);
}

console.log(`\n${pass}/${pass + fail} cases conform (compiled === interpreter)`);
process.exit(fail === 0 ? 0 : 1);
