// SPDX-License-Identifier: Apache-2.0
//
// End-to-end smoke test for every diagnostic dock panel — compiles a fixture
// workspace through the WASM, then exercises every panel analysis on the
// result the same way the playground's `run()` does. Catches data-path
// regressions across the boundary between the engine and the analyses.
//
// This DOES NOT verify visual rendering of the panels — Maya's "real browser"
// pass is documented as a manual checklist in `docs/playground-smoke.md`.
// This script covers the failure mode that's actually likely: an engine wire
// change that breaks a panel's input shape.
//
// Run from the repo root:
//
//   node native/web/smoke.mjs

import { readFile } from "node:fs/promises";
import { createRenderer } from "./stem.mjs";
import {
  analyseCalls,
  analyseCoverage,
  analyseDataAccess,
  analyseEscapeRuns,
  analyseWhitespace,
  buildDependencyGraph,
  tabVisibleUnder,
} from "./playground_utils.mjs";

const WASM = "native/web/wasm/stem_native_bg.wasm";

// A small workspace exercised by every panel. Each ingredient is deliberate:
//   - `title` lookup that hits, `ghost.field` lookup that misses, an array
//     index that goes out of bounds (Data Access).
//   - `{{~` leading trim, `~}}` trailing trim, and a standalone `{{#if}}`
//     line (Whitespace).
//   - `{{partial "row"}}` referenced twice — aggregated edge with count: 2 (Partials).
//   - `upcase`, `join`, `eval` calls — three risk tiers in one workspace
//     (Transformers + Capabilities).
//   - A truthy `#if` and a falsy `#if` against the data (Coverage).
//   - One `{{{raw}}}` triple-stash emit (Capabilities escape mix).
const FIXTURE_MAIN = [
  "<h1>{{title}}</h1>",
  "{{~upcase title~}}",
  "{{#each items}}",
  "{{partial \"row\" (dict \"name\" @this)}}",
  "{{/each}}",
  "{{partial \"row\" (dict \"name\" ghost.field)}}",
  "<p>{{at items 99}}</p>",
  "{{#if active}}on{{/if}}",
  "{{#if missing_flag}}dead{{/if}}",
  "{{{join (upcase title) \", \"}}}",
  "{{eval expr}}",
].join("\n");
const FIXTURE_PARTIAL = "<li>{{name}}</li>";
const FIXTURE_DATA = {
  title: "Stem",
  items: ["a", "b"],
  active: true,
  expr: "{{title}}",
};

const ASSERTIONS = [];
function check(label, ok, detail = "") {
  ASSERTIONS.push({ label, ok, detail });
  console.log(`  ${ok ? "ok " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) { check(label, false, detail); }

const { compile, render, parseAst, usedTransformers, requiredAssigns, partialGraph, engineInfo } =
  await createRenderer(await readFile(WASM));

// ── ADR-0020 capability gate (Phase 1 proof) ──────────────────────────────
// The Stem adapter must advertise every capability its panels gate on, so the
// gate is inert under Stem (no panel hides). This proves the seam before any
// thinner adapter exists.
const features = engineInfo().features;
const PANEL_REQUIRES = {
  "view:Bytecode": ["bytecode-wire"],
  "dock:Transformers": ["catalog"],
  "dock:Data Access": ["required-assigns"],
  "dock:Whitespace": ["standalone"],
  "dock:Partials": ["partial-graph"],
  "dock:Capabilities": ["stem-allow-list"],
};
const hidden = Object.entries(PANEL_REQUIRES)
  .filter(([, req]) => !tabVisibleUnder(features, req))
  .map(([name]) => name);
check("capability gate — Stem advertises every gated panel's features", hidden.length === 0, hidden.join(", "));

// ── ADR-0020 Phase 2: engine-namespaced policy contract ────────────────────
// The Stem adapter enforces an { allow, eval } policy and MUST reject a foreign
// (e.g. Handlebars knownHelpers) shape with a typed `unsupported-policy` throw,
// never silently accept it.
{
  const { program } = compile("{{upcase title}}", {}, {});
  let kind = null;
  try {
    render(program, { title: "x" }, { policy: { knownHelpers: ["upcase"] } });
  } catch (e) {
    kind = e.kind;
  }
  check("policy contract — foreign policy shape throws unsupported-policy", kind === "unsupported-policy", String(kind));
  // A valid Stem policy still renders.
  check("policy contract — { allow, eval } is accepted",
    render(program, { title: "x" }, { policy: { allow: ["upcase"], eval: false } }) === "X");
}

console.log("smoke: compiling fixture workspace");
const compiled = compile(FIXTURE_MAIN, { row: FIXTURE_PARTIAL }, { map: true });
if (compiled.errors) {
  fail("fixture compiles", JSON.stringify(compiled.errors));
  console.error("\nsmoke: fixture failed to compile — aborting");
  process.exit(1);
}
check("fixture compiles", true);

// Parse-AST per file for the AST-driven analyses.
const astsByFile = { main: parseAst(FIXTURE_MAIN).ast.nodes };
astsByFile.row = parseAst(FIXTURE_PARTIAL).ast.nodes;

// ── Panel #1: Data Access ─────────────────────────────────────────────────
const dataAccess = analyseDataAccess(astsByFile, FIXTURE_DATA);
const hits = dataAccess.filter((r) => r.status === "hit").length;
const misses = dataAccess.filter((r) => r.status === "miss").length;
check("data access — title hit", dataAccess.some((r) => r.path === "title" && r.status === "hit"));
check("data access — ghost.field miss (walked inside partial hash arg)",
  dataAccess.some((r) => r.path === "ghost.field" && r.status === "miss"));
check("data access — items hit (subject of #each)",
  dataAccess.some((r) => r.path === "items" && r.status === "hit"));
check("data access — at least 3 hits + 1 miss", hits >= 3 && misses >= 1,
  `${hits} hit / ${misses} miss`);

// ── Engine reflection: required + used transformers + partial graph ──────
const required = requiredAssigns(compiled.program);
check("required_assigns — includes title and items", required.includes("title") && required.includes("items"));
check("required_assigns — includes ghost (referenced but missing in data)", required.includes("ghost"));
// `name` IS expected — partials are root-scoped (ADR-0014), so `{{name}}`
// inside row.stem reads from whatever the partial's hash binds. The reflection
// reports the name read, not where it came from. That's the engine's contract.
check("required_assigns — excludes pure context vars (@this/@index)",
  !required.includes("this") && !required.includes("index") && !required.includes("@this"));

const usedTx = usedTransformers(compiled.program);
check("used_transformers — has upcase, join, eval, at",
  ["upcase", "join", "eval", "at"].every((n) => usedTx.includes(n)));

// ── Panel #3: Partials (engine + JS aggregation parity) ───────────────────
const engineGraph = partialGraph(compiled.program);
const jsGraph = buildDependencyGraph(astsByFile);
check("partial_graph engine — 1 partial (row) + main",
  engineGraph.nodes.length === 2 && engineGraph.nodes.some((n) => n.id === "row"));
const engineMainRow = engineGraph.edges.find((e) => e.from === "main" && e.to === "row");
check("partial_graph engine — main→row edge with count 2", engineMainRow && engineMainRow.count === 2);
const jsMainRow = jsGraph.edges.find((e) => e.from === "main" && e.to === "row");
check("buildDependencyGraph JS — main→row edge with count 2", jsMainRow && jsMainRow.count === 2);

// ── Panel #2: Whitespace ──────────────────────────────────────────────────
const whitespace = analyseWhitespace(FIXTURE_MAIN, "main");
const leading = whitespace.filter((r) => r.kind === "leading").length;
const trailing = whitespace.filter((r) => r.kind === "trailing").length;
const standalone = whitespace.filter((r) => r.kind === "standalone").length;
check("whitespace — leading + trailing markers present", leading >= 1 && trailing >= 1, `${leading}/${trailing}`);
check("whitespace — standalone block lines flagged", standalone >= 2, `${standalone} standalone`);

// ── Panel #4: Transformers v2 (call sites with risk tiers) ────────────────
const calls = analyseCalls(astsByFile);
const callNames = new Set(calls.map((c) => c.name));
check("call sites — upcase, join, eval, at all enumerated",
  ["upcase", "join", "eval", "at"].every((n) => callNames.has(n)));

// ── Panel #5: Capabilities (escape modes mix) ─────────────────────────────
const escapeRuns = analyseEscapeRuns(astsByFile);
check("escape runs — at least one raw emit (the {{{…}}})", escapeRuns.raw >= 1);
check("escape runs — at least one html emit", escapeRuns.html >= 1);

// ── Panel #6: Performance (covered structurally — timings are runtime) ────
// No assertion here: performance values are non-deterministic. The smoke
// test trusts the per-phase timing structure is wired correctly via the
// playground's own JS — exercised by the rendering pass below.

// ── Panel #7: Coverage ────────────────────────────────────────────────────
const coverage = analyseCoverage(astsByFile, FIXTURE_DATA);
const activeIf = coverage.find((r) => r.kind === "if" && r.label === "truthy");
const deadIf = coverage.find((r) => r.kind === "if" && r.label.includes("falsy"));
const eachOver2 = coverage.find((r) => r.kind === "each" && r.count === 2);
check("coverage — active #if classified as truthy", activeIf !== undefined);
check("coverage — missing_flag #if classified as falsy → else", deadIf !== undefined);
check("coverage — items #each reports 2 iterations", eachOver2 !== undefined);

// ── Render + segment provenance round-trip ────────────────────────────────
const { output, segments } = render(compiled.program, FIXTURE_DATA, { map: true });
check("render — output is non-empty", typeof output === "string" && output.length > 0);
check("render — output contains 'STEM' (upcase title)", output.includes("STEM"));
check("render — every segment attributes to main or row",
  segments.every((s) => s.file === "main" || s.file === "row"));

console.log("");
const failed = ASSERTIONS.filter((a) => !a.ok);
if (failed.length) {
  console.error(`smoke: ${failed.length}/${ASSERTIONS.length} assertions failed`);
  process.exit(1);
}
console.log(`smoke: ${ASSERTIONS.length}/${ASSERTIONS.length} panel assertions pass`);
