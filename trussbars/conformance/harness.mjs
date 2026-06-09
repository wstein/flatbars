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

const { renderMaxbars, maxbarsCompat } = await import(enginePath);
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

// `--vm-compat`: render through the VM's AOT-compat (strict) mode and assert it is a
// VERIFYING PROXY for AOT (docs/11 §7/§9) — it ACCEPTS iff AOT accepts (`compileMaxRust`),
// and on the accepted cases its output byte-matches the golden. A construct AOT rejects
// (numeric truthiness, bare-struct output) must be rejected here too, and every accepted
// case must render identically.
if (process.argv.includes("--vm-compat")) {
  console.error("building truss-vm (VM CLI)…");
  execFileSync("cargo", ["+1.96.0", "build", "--quiet", "--bin", "truss-vm"], {
    cwd: resolve(root, "trussbars/crates/trussbars-vm"),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const binPath = resolve(root, "trussbars/target/debug/truss-vm");
  const snapPath = resolve(here, "snapshots.json");
  const golden = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, "utf8")) : {};

  let agreed = 0;
  const divergences = [];
  for (const c of cases) {
    const o = renderMaxbars(c.template, c.data);
    if (!o.ok) continue;
    const aotAccepts = compileMaxRust("Ctx")(c.template).ok; // AOT's verdict
    let vmOut = null;
    let vmAccepts = true;
    try {
      vmOut = execFileSync(binPath, ["--compat"], {
        input: JSON.stringify({ template: c.template, data: c.data }),
        encoding: "utf8",
      });
    } catch {
      vmAccepts = false;
    }
    const expected = c.id in golden ? golden[c.id] : o.value;
    if (vmAccepts !== aotAccepts) {
      divergences.push({ id: c.id, kind: "accept/reject", aot: aotAccepts, vm: vmAccepts });
    } else if (aotAccepts && vmOut !== expected) {
      divergences.push({ id: c.id, kind: "byte", expected, vm: vmOut });
    } else {
      agreed++;
    }
  }
  console.log(
    `Trussbars VM AOT-compat (verifying proxy): ${agreed}/${cases.length} agree with AOT ` +
      `(accept⇔accept + byte-identical), ${divergences.length} divergence(s).`,
  );
  for (const d of divergences) {
    if (d.kind === "accept/reject") {
      console.error(`  DIVERGENCE ${d.id}: AOT accepts=${d.aot} but VM-compat accepts=${d.vm}`);
    } else {
      console.error(`  BYTE DIVERGENCE ${d.id}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.vm)}`);
    }
  }
  process.exit(divergences.length === 0 ? 0 : 1);
}

// `--compat-parity`: the *drift gate* between the two AOT-compat verdicts — the
// PureScript Lab lint (`MaxBars.Compat` via `maxbarsCompat`, the verdict the
// "FlatBars Studio" Trussbars panel shows) and the Rust VM's verifying proxy
// (`truss-vm --compat`, i.e. `render_compat`). For every case the two must AGREE on
// accept/reject, so the lint can never tell a Lab author "AOT-compatible" when the
// production engine would reject it (or vice-versa). Unlike `--vm-compat` (which
// keys on `compileMaxRust.ok`, the *structural* front-end verdict only), this keys
// on the FULL lint verdict — structural PLUS the data-driven rules (numeric
// truthiness, struct output) — so it needs cases that exercise those, which the
// shared `cases` corpus cannot hold (a numeric-truthiness positive would fail the
// byte-emit gate's batched `cargo build`). Hence the extra curated negatives below.
if (process.argv.includes("--compat-parity")) {
  console.error("building truss-vm (VM CLI)…");
  execFileSync("cargo", ["+1.96.0", "build", "--quiet", "--bin", "truss-vm"], {
    cwd: resolve(root, "trussbars/crates/trussbars-vm"),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const binPath = resolve(root, "trussbars/target/debug/truss-vm");

  // The shared corpus plus negatives that exercise the two *data-driven* rules the
  // structural front-end can't see without a value (numeric truthiness, struct output).
  const extra = [
    { id: "compat-numeric-truthiness", template: "{{#if count}}x{{/if}}", data: { count: 3 } },
    { id: "compat-numeric-truthiness-zero", template: "{{#if count}}x{{/if}}", data: { count: 0 } },
    { id: "compat-struct-output", template: "{{user}}", data: { user: { name: "Ada" } } },
    { id: "compat-host-helper", template: '{{t "hi"}}', data: {} },
    { id: "compat-ok-bool", template: "{{#if active}}{{name}}{{/if}}", data: { active: true, name: "Ada" } },
  ];
  const parityCases = [...cases, ...extra];

  let agreed = 0;
  const divergences = [];
  for (const c of parityCases) {
    // The PureScript Lab lint verdict (what the Studio panel reports).
    const ps = maxbarsCompat(c.template, c.data);
    const psCompatible = ps.ok && ps.compatible;
    // The Rust verifying-proxy verdict: render_compat accepts iff it does not throw.
    let vmAccepts = true;
    try {
      execFileSync(binPath, ["--compat"], {
        input: JSON.stringify({ template: c.template, data: c.data }),
        encoding: "utf8",
      });
    } catch {
      vmAccepts = false;
    }
    if (psCompatible === vmAccepts) agreed++;
    else divergences.push({ id: c.id, ps: psCompatible, vm: vmAccepts, rules: ps.findings?.map((f) => f.rule) ?? [] });
  }
  console.log(
    `Trussbars AOT-compat drift gate (PureScript lint ⇔ Rust render_compat): ` +
      `${agreed}/${parityCases.length} agree, ${divergences.length} divergence(s).`,
  );
  for (const d of divergences) {
    console.error(`  DIVERGENCE ${d.id}: PS compatible=${d.ps} but VM-compat accepts=${d.vm} (PS rules: ${d.rules.join(", ") || "none"})`);
  }
  writeFileSync(
    resolve(here, "compat-parity.json"),
    JSON.stringify({ agreed, total: parityCases.length, divergences }, null, 2) + "\n",
  );
  process.exit(divergences.length === 0 ? 0 : 1);
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
      `${genCtx(c.data, c.maps, c.enums)}\n\n` +
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
