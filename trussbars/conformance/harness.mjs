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
const enginePath = resolve(root, "output/FullBars.JS/index.js");
const emitterPath = resolve(root, "output/MaxBars.Rust/index.js");
const genDir = resolve(here, "gen");

for (const p of [enginePath, emitterPath]) {
  if (!existsSync(p)) {
    console.error(`error: ${p} not found — run \`npx spago build\` first.`);
    process.exit(2);
  }
}

const { renderMaxbars } = await import(enginePath);
const { compileMaxRust } = await import(emitterPath);

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

  const emit = compileMaxRust("Ctx")(c.template);
  if (!emit.ok) {
    excluded.push({ id: c.id, reason: emit.err });
    continue;
  }

  const ident = c.id.replace(/-/g, "_");
  const data = rawString(JSON.stringify(c.data));
  modules.push(
    `pub mod ${ident} {\n` +
      `${genCtx(c.data)}\n\n` +
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
