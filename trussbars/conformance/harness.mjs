// Trussbars cross-language conformance harness (docs/04).
//
// For each corpus case it renders through the interpreter (the ORACLE,
// `renderMaxbars` from the spago build) and through the EMITTED Rust
// (`compileMaxRust`), then asserts the two are byte-identical. All positive
// (emittable) cases are batched into ONE generated crate — one `cargo build`, one
// run — for speed. Cases the emitter cannot compile are recorded in the exclusion
// ledger (never silently dropped). Floats are a strict diff: the default profile
// uses `ecma-float` (dragonbox_ecma), which is byte-identical to JS `String(n)`.
//
//   node trussbars/conformance/harness.mjs      # gate: exits non-zero on any mismatch
//
// Requires `output/` (run `spago build` first) and the pinned Rust toolchain.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cases } from "./cases.mjs";
import { genCtx } from "./ctxgen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const enginePath = resolve(root, "output/ClassicBars.JS/index.js");
const emitterPath = resolve(root, "output/MaxBars.Rust/index.js");
const genDir = resolve(here, "gen");

for (const p of [enginePath, emitterPath]) {
  if (!existsSync(p)) {
    console.error(`error: ${p} not found — run \`npx spago build\` first.`);
    process.exit(2);
  }
}

const { renderMaxbars, inferMaxbarsData } = await import(enginePath);

// Ctx source (docs/03 G2 step): prefer schema *inference* from the template
// (Kernel.Schema), falling back to the data-only `genCtx` only where the case
// declares manual `maps`/`enums` hints inference does not yet derive, where the
// case opts out via `ctxFromData` (a known inference gap — see below), or where
// inference fails. Tracks how many cases each path served (the G2-readiness
// signal — inference supersedes ctxgen as its coverage grows).
//
// `ctxFromData: true` marks a case whose template inference produces a *struct*
// but an INCOMPLETE one: a collection produced by a `where`/`reject`/`find`/
// `groupBy` filter does not yet thread the body's element-field accesses
// (`{{this.name}}`) onto the inferred element type — the §3 rule table is a
// follow-on increment (docs/03 §"Not yet"). Those cases use the complete
// data-driven `genCtx`; drop the flag as inference grows to cover them.
let ctxInferred = 0;
let ctxFallback = 0;
function ctxFor(c) {
  if (!c.maps && !c.enums && !c.ctxFromData) {
    const r = inferMaxbarsData(c.template, c.data);
    if (r.ok && r.schema.includes("struct Ctx")) {
      ctxInferred++;
      return r.schema;
    }
  }
  ctxFallback++;
  return genCtx(c.data, c.maps, c.enums);
}
const { compileMaxRust } = await import(emitterPath);

// `--vm`: render through the Trussbars VM backend (`trussbars-vm`, docs/11) — a
// dynamic-Value tree-walk, no codegen. The SPIKE is lenient + a subset, so cases the
// VM doesn't yet implement are reported as `unsupported` (honest coverage), and the
// gate is: every COVERED case must byte-match the golden. The CLI renders directly.
if (process.argv.includes("--vm")) {
  console.error("building truss-vm (VM CLI)…");
  execFileSync("cargo", ["+1.96.0", "build", "--quiet", "--bin", "truss-vm"], {
    cwd: resolve(root, "trussbars/crates/trussbars-vm"),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const binPath = resolve(root, "trussbars/target/debug/truss-vm");
  const snapPath = resolve(here, "snapshots.json");
  const golden = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, "utf8")) : {};

  let matched = 0,
    oracleErrors = 0;
  const fails = [];
  const unsup = [];
  for (const c of cases) {
    const o = renderMaxbars(c.template, c.data);
    if (!o.ok) {
      oracleErrors++;
      continue;
    }
    const expected = c.id in golden ? golden[c.id] : o.value;
    let actual;
    try {
      actual = execFileSync(binPath, [], {
        input: JSON.stringify({ template: c.template, data: c.data }),
        encoding: "utf8",
      });
    } catch (e) {
      unsup.push({ id: c.id, reason: (e.stderr || e.message || "").toString().trim() });
      continue;
    }
    if (actual === expected) matched++;
    else fails.push({ id: c.id, expected, actual });
  }
  const covered = matched + fails.length;
  console.log(
    `Trussbars VM spike (lenient tree-walk): ${matched}/${covered} covered byte-matched, ` +
      `${unsup.length} unsupported (spike subset), ${oracleErrors} oracle errors, of ${cases.length} total.`,
  );
  for (const u of unsup) console.log(`  unsupported ${u.id}: ${u.reason}`);
  for (const m of fails) {
    console.error(`  MISMATCH ${m.id}:`);
    console.error(`    expected: ${JSON.stringify(m.expected)}`);
    console.error(`    vm:       ${JSON.stringify(m.actual)}`);
  }
  // Spike gate: every COVERED case must match; unsupported is reported, not failed.
  process.exit(fails.length === 0 && oracleErrors === 0 ? 0 : 1);
}

// `--v2`: emit through the Rust pipeline (`trussbars-template`, docs/08) instead of
// the PureScript v1 emitter, asserting v2 hits the SAME byte-for-byte golden. The
// CLI (`truss-emit`) is built once; each template is then emitted by a fast spawn.
const useV2 = process.argv.includes("--v2");
let v2Emit;
if (useV2) {
  const tmplDir = resolve(root, "trussbars/crates/trussbars-template");
  console.error("building truss-emit (v2 CLI)…");
  execFileSync("cargo", ["+1.96.0", "build", "--quiet", "--bin", "truss-emit"], {
    cwd: tmplDir,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const binPath = resolve(root, "trussbars/target/debug/truss-emit");
  v2Emit = (template) => {
    try {
      const out = execFileSync(binPath, ["Ctx"], { input: template, encoding: "utf8" });
      return { ok: true, out };
    } catch (e) {
      return { ok: false, err: (e.stderr || e.message || "emit failed").toString().trim() };
    }
  };
}

// A Rust raw-string literal with enough hashes to be unambiguous for `s`.
function rawString(s) {
  let h = "#";
  while (s.includes(`"${h}`)) h += "#";
  return `r${h}"${s}"${h}`;
}

const modules = [];
const inserts = [];
const excluded = [];
const oracle = {}; // id → expected string
let oracleErrors = 0;

for (const c of cases) {
  const o = renderMaxbars(c.template, c.data);
  if (!o.ok) {
    console.error(`oracle error on ${c.id}: ${o.error}`);
    oracleErrors++;
    continue;
  }
  oracle[c.id] = o.value;

  const emit = useV2 ? v2Emit(c.template) : compileMaxRust("Ctx")(c.template);
  if (!emit.ok) {
    excluded.push({ id: c.id, reason: emit.err });
    continue;
  }

  const ident = c.id.replace(/-/g, "_");
  const data = rawString(JSON.stringify(c.data));
  modules.push(
    `pub mod ${ident} {\n` +
      `${ctxFor(c)}\n\n` +
      `${emit.out}\n` +
      `    pub fn run() -> String {\n` +
      `        let ctx: Ctx = serde_json::from_str(${data}).expect("deserialize ${c.id}");\n` +
      `        render(&ctx)\n` +
      `    }\n}`,
  );
  inserts.push(
    `    out.insert("${c.id}", ` +
      `std::panic::catch_unwind(|| ${ident}::run()).unwrap_or_else(|_| "<<PANIC>>".to_string()));`,
  );
}

// ── assemble the generated crate ──────────────────────────────────────────────
mkdirSync(resolve(genDir, "src"), { recursive: true });
writeFileSync(
  resolve(genDir, "Cargo.toml"),
  `[package]
name = "trussbars-conformance-gen"
version = "0.0.0"
edition = "2024"
publish = false

# Own workspace, so it is independent of the trussbars/ workspace.
[workspace]

[dependencies]
trussbars-core = { path = "../../crates/trussbars-core", features = ["derive"] }
trussbars-std = { path = "../../crates/trussbars-std" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`,
);
writeFileSync(
  resolve(genDir, "src/main.rs"),
  `#![allow(dead_code, unused)]
${modules.join("\n\n")}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let mut out: std::collections::BTreeMap<&str, String> = std::collections::BTreeMap::new();
${inserts.join("\n")}
    println!("{}", serde_json::to_string(&out).unwrap());
}
`,
);

// ── build & run (one compile, all cases) ──────────────────────────────────────
let actual;
try {
  const stdout = execFileSync(
    "cargo",
    ["+1.96.0", "run", "--quiet", "--manifest-path", resolve(genDir, "Cargo.toml")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  actual = JSON.parse(stdout);
} catch (e) {
  console.error("error: the generated crate failed to build/run (see cargo output above).");
  process.exit(1);
}

// ── golden snapshots: detect ORACLE drift separately from Rust divergence ─────
// The committed `snapshots.json` is the contract: emitted Rust is diffed against
// it, and the LIVE oracle is also checked against it, so a change in the
// interpreter (oracle drift) is reported distinctly — not misattributed to Rust.
// Regenerate the golden when the interpreter legitimately changes: `--update`.
const update = process.argv.includes("--update");
const snapPath = resolve(here, "snapshots.json");
const golden = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, "utf8")) : {};

const drift = [];
const missing = [];
for (const c of cases) {
  if (oracle[c.id] === undefined) continue;
  if (update) golden[c.id] = oracle[c.id];
  else if (!(c.id in golden)) missing.push(c.id);
  else if (golden[c.id] !== oracle[c.id]) {
    drift.push({ id: c.id, golden: golden[c.id], oracle: oracle[c.id] });
  }
}
if (update) {
  const sorted = {};
  for (const c of cases) if (oracle[c.id] !== undefined) sorted[c.id] = oracle[c.id];
  writeFileSync(snapPath, JSON.stringify(sorted, null, 2) + "\n");
}

// ── diff: emitted Rust vs the committed golden (the contract) ─────────────────
let matched = 0;
const mismatches = [];
for (const c of cases) {
  if (excluded.some((x) => x.id === c.id) || oracle[c.id] === undefined) continue;
  const expected = c.id in golden ? golden[c.id] : oracle[c.id];
  if (actual[c.id] === expected) matched++;
  else mismatches.push({ id: c.id, expected, actual: actual[c.id] });
}

const positiveCount = matched + mismatches.length;
const report = {
  profile: "perf (ecma-float, default)",
  total: cases.length,
  positive: { count: positiveCount, byte_matched: matched, mismatched: mismatches.length },
  excluded: { count: excluded.length, cases: excluded },
  oracle_drift: drift.length,
};
writeFileSync(resolve(here, "report.json"), JSON.stringify(report, null, 2) + "\n");

// ── report ────────────────────────────────────────────────────────────────────
console.log(
  `Trussbars conformance (${report.profile}): ` +
    `${matched}/${positiveCount} positive byte-matched vs golden, ` +
    `${excluded.length} excluded, ${drift.length} oracle-drift, ${oracleErrors} oracle errors.`,
);
console.log(
  `  Ctx source (docs/03 G2): ${ctxInferred} inferred (Kernel.Schema), ${ctxFallback} via genCtx fallback (maps/enums hints or infer-miss).`,
);
for (const x of excluded) console.log(`  excluded ${x.id}: ${x.reason}`);
for (const id of missing) console.error(`  MISSING snapshot for ${id} (run with --update)`);
for (const d of drift) {
  console.error(
    `  ORACLE DRIFT ${d.id}: golden ${JSON.stringify(d.golden)} != live ${JSON.stringify(d.oracle)}`,
  );
}
for (const m of mismatches) {
  console.error(`  MISMATCH ${m.id}:`);
  console.error(`    expected (golden): ${JSON.stringify(m.expected)}`);
  console.error(`    actual   (rust):   ${JSON.stringify(m.actual)}`);
}

const ok =
  mismatches.length === 0 && drift.length === 0 && missing.length === 0 && oracleErrors === 0;
process.exit(ok ? 0 : 1);
