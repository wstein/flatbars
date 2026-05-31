// SPDX-License-Identifier: Apache-2.0
//
// Headless contract test for the Handlebars adapter (ADR-0020 Phase 3). Drives
// `createHandlebarsRenderer()` exactly as the playground does and asserts the
// engine-neutral seam: the same object shape, an honest thinner feature vector,
// the Phase-1 panel gate, the single render shape, and the typed errors for the
// capabilities Handlebars does not back. Run from the repo root:
//
//   node native/web/handlebars_smoke.mjs

import { createHandlebarsRenderer } from "./handlebars.mjs";
import { buildDependencyGraph, tabVisibleUnder } from "./playground_utils.mjs";

const checks = [];
const check = (label, ok, detail = "") => {
  checks.push({ label, ok });
  console.log(`  ${ok ? "ok " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const r = await createHandlebarsRenderer();

// Same 11-method shape as the Stem adapter (createRenderer).
const SHAPE = ["render", "compile", "parseAst", "inspectAt", "usedTransformers",
  "requiredAssigns", "partialGraph", "allTransformers", "catalog", "engineInfo", "version"];
check("adapter exposes the same seam shape as createRenderer",
  SHAPE.every((k) => k in r), SHAPE.filter((k) => !(k in r)).join(",") || "all present");

// ── CORE: compile + render with partials ──────────────────────────────────
// Handlebars-native syntax: partials are `{{> name}}` (the engine-native form,
// not Stem's `{{partial "name"}}` transformer call).
const MAIN = `{{> header}}\n<ul>{{#each people}}{{> row}}{{/each}}</ul>\n{{#if note}}<p>{{note}}</p>{{/if}}`;
const PARTIALS = { header: "<h2>{{title}}</h2>", row: "<li>{{name}} — {{role}}</li>" };
const DATA = { title: "Team & Co", people: [{ name: "Ada", role: "Compiler" }, { name: "Grace", role: "Runtime" }], note: "<hi>" };

const compiled = r.compile(MAIN, PARTIALS);
check("fixture compiles", !compiled.errors, compiled.errors ? JSON.stringify(compiled.errors) : "");
if (compiled.errors) process.exit(1);

const { output, segments } = r.render(compiled.program, DATA, { map: true });
check("render returns single { output, segments } shape", typeof output === "string" && Array.isArray(segments));
check("render: segments is [] (no source-map capability)", segments.length === 0);
check("render: partials expand", output.includes("<h2>Team &amp; Co</h2>") && output.includes("<li>Ada — Compiler</li>"));
check("render: data is HTML-escaped by default", output.includes("&lt;hi&gt;") && !output.includes("<hi>"));

// A compile error is reported with file attribution.
const bad = r.compile("{{#each xs}}oops");
check("compile reports a syntax error with file attribution",
  !!bad.errors && bad.errors[0].file === "main", JSON.stringify(bad.errors && bad.errors[0]));

// ── parseAst + dependency graph (the Partials panel path) ──────────────────
const astsByFile = { main: r.parseAst(MAIN).ast.nodes, header: r.parseAst(PARTIALS.header).ast.nodes, row: r.parseAst(PARTIALS.row).ast.nodes };
const graph = buildDependencyGraph(astsByFile);
const edges = graph.edges.map((e) => `${e.from}->${e.to}`).sort().join(",");
check("parseAst -> buildDependencyGraph finds partial edges", edges === "main->header,main->row", edges);

// ── approximate static analyses ────────────────────────────────────────────
const used = r.usedTransformers(compiled.program);
check("usedTransformers reports the block helpers used", used.includes("each") && used.includes("if"), used.join(","));
const assigns = r.requiredAssigns(compiled.program);
check("requiredAssigns reports top-level data reads", assigns.includes("people") && assigns.includes("note"), assigns.join(","));
check("requiredAssigns excludes helper names", !assigns.includes("each") && !assigns.includes("if"), assigns.join(","));
const pg = r.partialGraph(compiled.program);
check("partialGraph returns call-site edges", pg.edges.length === 2 && pg.nodes.some((n) => n.id === "header"));

// ── catalog / engineInfo ───────────────────────────────────────────────────
check("allTransformers excludes framework internals",
  r.allTransformers().includes("each") && !r.allTransformers().includes("helperMissing"));
check("catalog carries per-helper metadata", r.catalog().some((e) => e.name === "each" && e.example));

const features = r.engineInfo().features;
// Honest vector: HB backs these…
const PRESENT = ["partials", "catalog", "used-transformers", "required-assigns", "partial-graph"];
// …and MUST NOT claim these Stem-only capabilities.
const ABSENT = ["source-map", "standalone", "eval-opt-in", "bytecode-wire", "context-inspect", "st4-modes", "stem-allow-list"];
const has = (name) => features.some((f) => f.split(":")[0] === name);
check("engineInfo: advertises the capabilities HB backs", PRESENT.every(has), PRESENT.filter((n) => !has(n)).join(","));
check("engineInfo: does NOT claim Stem-only capabilities", ABSENT.every((n) => !has(n)), ABSENT.filter(has).join(","));
check("engineInfo: approximate analyses are tagged :approximate",
  features.includes("used-transformers:approximate") && features.includes("partial-graph:approximate"));

// ── Phase-1 panel gate under the HB vector ─────────────────────────────────
// Stem-only panels hide; the shared/approximate ones stay. (Capabilities is NOT
// gated off — it always shows a per-engine security profile; under Handlebars
// that's the helper-whitelist / prototype-hardening / global-escaping view.)
const GATED_OFF = { "view:Bytecode": ["bytecode-wire"], "view:ST4 Preview": ["st4-modes"], "dock:Whitespace": ["standalone"] };
const STAYS = { "dock:Transformers": ["catalog"], "dock:Data Access": ["required-assigns"], "dock:Partials": ["partial-graph"] };
const wronglyShown = Object.entries(GATED_OFF).filter(([, req]) => tabVisibleUnder(features, req)).map(([n]) => n);
const wronglyHidden = Object.entries(STAYS).filter(([, req]) => !tabVisibleUnder(features, req)).map(([n]) => n);
check("gate: Stem-only panels hide under Handlebars", wronglyShown.length === 0, wronglyShown.join(","));
check("gate: shared/approximate panels stay", wronglyHidden.length === 0, wronglyHidden.join(","));

// ── typed errors for unsupported capabilities ──────────────────────────────
let inspectKind = null;
try { r.inspectAt(compiled.program, DATA, { file: "main", start: 0, end: 1 }); } catch (e) { inspectKind = e.kind; }
check("inspectAt throws a typed 'unsupported' error (no context-inspect)", inspectKind === "unsupported", String(inspectKind));

let policyKind = null;
try { r.render(compiled.program, DATA, { policy: { allow: ["each"], eval: false } }); } catch (e) { policyKind = e.kind; }
check("render rejects a Stem { allow, eval } policy with 'unsupported-policy'", policyKind === "unsupported-policy", String(policyKind));

// ── controller: custom helpers + data transform ────────────────────────────
{
  const ctl = r.applyController(
    'helper("shout", (s) => String(s).toUpperCase() + "!"); return { ...data, extra: "x" };',
    { who: "ada" },
  );
  check("applyController transforms the view-model", ctl.data && ctl.data.extra === "x");
  const out = r.render(r.compile("{{shout who}}{{extra}}").program, ctl.data, { map: true }).output;
  check("applyController registers a usable custom helper", out === "ADA!x", out);
  // `Handlebars` is pre-bound (no import) — Handlebars.registerHelper works.
  r.applyController('Handlebars.registerHelper("yell", (s) => s + "!!");', {});
  const yelled = r.render(r.compile("{{yell who}}").program, { who: "hi" }, { map: true }).output;
  check("controller exposes Handlebars directly (no import)", yelled === "hi!!", yelled);
  // An empty controller clears the previous run's helpers (no accumulation).
  r.applyController("", {});
  let cleared = false;
  try { r.render(r.compile("{{shout who}}").program, { who: "z" }, {}); } catch (e) { cleared = e.kind === "render"; }
  check("applyController clears prior helpers on the next run", cleared);
  // A controller syntax/runtime error is reported, not thrown.
  const bad = r.applyController("this is ((( not js", {});
  check("applyController reports an error instead of throwing", !!(bad && bad.error));
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\nhandlebars adapter: ${checks.length - failed}/${checks.length} contract checks pass`);
if (failed) process.exit(1);
