// SPDX-License-Identifier: Apache-2.0
//
// Validates the wasm32-unknown-unknown module + browser glue without a browser.
// For each example it loads the same individual files the browser fetches
// (examples/<id>/main.stem, one .stem per partial, and data.yaml), compiles them
// through the glue, renders, and checks against the expected output. Node uses
// the same WebAssembly API as browsers, so a pass here proves the browser path.
// Run from the repo root:
//
//   node native/web/validate.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRenderer } from "./stem.mjs";
import { astOutline, buildCheatSheetData, buildDependencyGraph, disassemble, mergeDataOverlays } from "./playground_utils.mjs";
import { load as loadYaml } from "./vendor/js-yaml.mjs";
import jsonata from "./vendor/jsonata.mjs";

const WASM = "native/web/wasm/stem_native_bg.wasm";

// Pinned expected outputs. These reflect ADR-0016 standalone-tag stripping on
// the default `compile(...)` path (no `{ standalone: false }`) — a line that
// contains only a block/partial/comment tag is removed in full, including its
// indentation and trailing newline. When a template emits a partial inline
// (`{{> row}}` on its own line), the line vanishes; when one is embedded inline
// (`<div>{{> tag}}</div>`), only the surrounding whitespace is preserved.
const expected = {
  // A data-driven infographic: a JSONata transform turns raw stats into
  // geometry (donut arcs, % bars, waffle grid, sparkline) for an SVG/HTML view.
  infographic: "<style>\n  .ig { font-family: system-ui, sans-serif; color: #1e293b; max-width: 760px; }\n  .ig-hero h1 { margin: 0 0 4px; font-size: 1.6rem; letter-spacing: -.01em; }\n  .ig-hero p { margin: 0 0 16px; color: #64748b; }\n  .ig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }\n  .ig-card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.04); }\n  .ig-card.ig-wide { grid-column: 1 / -1; }\n  .ig-card h2 { margin: 0 0 12px; font-size: .92rem; color: #334155; }\n  .ig-donut { display: flex; align-items: center; gap: 16px; }\n  .ig-donut svg { width: 132px; height: 132px; flex: 0 0 auto; }\n  .ig-legend { list-style: none; margin: 0; padding: 0; font-size: 13px; color: #475569; }\n  .ig-legend li { display: flex; align-items: center; gap: 8px; margin: 5px 0; }\n  .ig-legend .sw { width: 11px; height: 11px; border-radius: 3px; flex: 0 0 auto; }\n  .ig-bars { display: flex; flex-direction: column; gap: 10px; }\n  .ig-bar-row { display: flex; align-items: center; gap: 9px; font-size: 13px; }\n  .ig-bar-label { flex: 0 0 80px; color: #475569; }\n  .ig-bar-track { flex: 1 1 auto; height: 10px; background: #f1f5f9; border-radius: 5px; overflow: hidden; }\n  .ig-bar-fill { display: block; height: 100%; border-radius: 5px; }\n  .ig-bar-val { flex: 0 0 26px; text-align: right; font-weight: 600; color: #334155; }\n  .ig-waffle { display: flex; align-items: center; gap: 16px; }\n  .ig-waffle svg { width: 134px; height: 134px; flex: 0 0 auto; }\n  .ig-dot { fill: #e5e7eb; }\n  .ig-dot.on { fill: #7c4dff; }\n  .ig-waffle-pct { font-size: 2.1rem; font-weight: 700; color: #5a2ea6; }\n  .ig-spark { display: block; width: 100%; height: auto; }\n</style>\n<div class=\"ig\">\n  <header class=\"ig-hero\">\n    <h1>Stem by the numbers</h1>\n    <p>One engine, two backends, byte-for-byte the same output.</p>\n  </header>\n  <div class=\"ig-grid\">\n    <section class=\"ig-card\">\n      <h2>Render time by phase</h2>\n<div class=\"ig-donut\">\n  <svg viewBox=\"0 0 140 140\" role=\"img\" aria-label=\"Render time by phase\">\n    <g transform=\"rotate(-90 70 70)\">\n        <circle cx=\"70\" cy=\"70\" r=\"52\" fill=\"none\" stroke=\"#c4b5fd\" stroke-width=\"22\" stroke-dasharray=\"110.78 326.73\" stroke-dashoffset=\"0\"></circle>\n        <circle cx=\"70\" cy=\"70\" r=\"52\" fill=\"none\" stroke=\"#8b6dff\" stroke-width=\"22\" stroke-dasharray=\"58.89 326.73\" stroke-dashoffset=\"-110.78\"></circle>\n        <circle cx=\"70\" cy=\"70\" r=\"52\" fill=\"none\" stroke=\"#5a2ea6\" stroke-width=\"22\" stroke-dasharray=\"157.05 326.73\" stroke-dashoffset=\"-169.67\"></circle>\n    </g>\n  </svg>\n  <ul class=\"ig-legend\">\n      <li><span class=\"sw\" style=\"background:#c4b5fd\"></span>Compile · 34%</li>\n      <li><span class=\"sw\" style=\"background:#8b6dff\"></span>Parse · 18%</li>\n      <li><span class=\"sw\" style=\"background:#5a2ea6\"></span>Render · 48%</li>\n  </ul>\n</div>\n    </section>\n    <section class=\"ig-card\">\n      <h2>Transformer stdlib by group</h2>\n<div class=\"ig-bars\">\n      <div class=\"ig-bar-row\">\n    <span class=\"ig-bar-label\">Collections</span>\n    <span class=\"ig-bar-track\"><span class=\"ig-bar-fill\" style=\"width:240px;background:#c4b5fd\"></span></span>\n    <span class=\"ig-bar-val\">13</span>\n  </div>\n\n      <div class=\"ig-bar-row\">\n    <span class=\"ig-bar-label\">Strings</span>\n    <span class=\"ig-bar-track\"><span class=\"ig-bar-fill\" style=\"width:240px;background:#a98bff\"></span></span>\n    <span class=\"ig-bar-val\">13</span>\n  </div>\n\n      <div class=\"ig-bar-row\">\n    <span class=\"ig-bar-label\">Minimum</span>\n    <span class=\"ig-bar-track\"><span class=\"ig-bar-fill\" style=\"width:147.7px;background:#8b6dff\"></span></span>\n    <span class=\"ig-bar-val\">8</span>\n  </div>\n\n      <div class=\"ig-bar-row\">\n    <span class=\"ig-bar-label\">Predicates</span>\n    <span class=\"ig-bar-track\"><span class=\"ig-bar-fill\" style=\"width:55.4px;background:#7c4dff\"></span></span>\n    <span class=\"ig-bar-val\">3</span>\n  </div>\n\n      <div class=\"ig-bar-row\">\n    <span class=\"ig-bar-label\">I18n</span>\n    <span class=\"ig-bar-track\"><span class=\"ig-bar-fill\" style=\"width:36.9px;background:#5a2ea6\"></span></span>\n    <span class=\"ig-bar-val\">2</span>\n  </div>\n\n</div>\n    </section>\n    <section class=\"ig-card\">\n      <h2>Test coverage</h2>\n<div class=\"ig-waffle\">\n  <svg viewBox=\"0 0 135 135\" role=\"img\" aria-label=\"Test coverage\">\n      <circle cx=\"5\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"5\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"18\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"31\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"44\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"57\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"70\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"83\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"96\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"18\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"31\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"44\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"57\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"70\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"83\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"96\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"109\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"122\" cy=\"109\" r=\"4.6\" class=\"ig-dot on\"></circle>\n      <circle cx=\"5\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"18\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"31\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"44\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"57\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"70\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"83\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"96\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"109\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n      <circle cx=\"122\" cy=\"122\" r=\"4.6\" class=\"ig-dot\"></circle>\n  </svg>\n  <div class=\"ig-waffle-pct\">90%</div>\n</div>\n    </section>\n    <section class=\"ig-card ig-wide\">\n      <h2>Throughput · commits / sprint · last 38</h2>\n<svg class=\"ig-spark\" viewBox=\"-6 -6 262 74\" role=\"img\" aria-label=\"Throughput per sprint\">\n  <polyline points=\"0,40.3 50,31.5 100,34.4 150,18.2 200,12.3 250,2\" fill=\"none\" stroke=\"#7c4dff\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"></polyline>\n    <circle cx=\"0\" cy=\"40.3\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n    <circle cx=\"50\" cy=\"31.5\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n    <circle cx=\"100\" cy=\"34.4\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n    <circle cx=\"150\" cy=\"18.2\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n    <circle cx=\"200\" cy=\"12.3\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n    <circle cx=\"250\" cy=\"2\" r=\"3.5\" fill=\"#5a2ea6\"></circle>\n</svg>\n    </section>\n  </div>\n</div>\n",
  // A data-driven changelog: a JSONata transform groups the flat commit list
  // by type into ordered sections; the template emits Markdown (table + lists).
  markdown: "# Stem v0.5.0\n\n_Released 2026-05-24 · 6 changes_\n\n| Section | Count |\n| --- | ---: |\n| Features | 3 |\n| Fixes | 2 |\n| Documentation | 1 |\n## Features\n\n- **playground**: editable JSONata transform tab\n- **parser**: literal segment keys\n- **native**: zero-arity getter hook\n\n## Fixes\n\n- **renderer**: trailing-tilde partial sync\n- **playground**: single-pass source view\n\n## Documentation\n\n- **notes**: MVC pipeline write-up\n\n",
  greeting: "Hello World!",
  pipeline: "NINA",
  list: "<ul><li>1. first</li><li>2. second</li><li>3. third</li></ul>",
  // Looping a list of objects into table rows; {{@index1}} is the 1-based counter.
  table: "<table>\n  <thead>\n    <tr><th>#</th><th>Language</th><th>Paradigm</th><th>First release</th></tr>\n  </thead>\n  <tbody>\n      <tr><td>1</td><td>Elixir</td><td>Functional</td><td>2011</td></tr>\n      <tr><td>2</td><td>Rust</td><td>Systems</td><td>2010</td></tr>\n      <tr><td>3</td><td>Python</td><td>Scripting</td><td>1991</td></tr>\n  </tbody>\n</table>\n",
  // Interpolation + a loop straight into Markdown (no transform).
  "markdown-basic": "# Stem\n\n> A tiny, logic-less template engine.\n\n## Features\n\n- Compiles templates to portable bytecode\n- Runs on Elixir and Rust / WebAssembly\n- Escapes output by default\nBuilt with **Stem**. Pick an example from the dropdown to keep exploring.\n",
  // Branching with {{#if}}/{{else}}, value-presence {{#if}}, and empty-state {{#unless}}.
  conditionals: "<ul class=\"tasks\">\n    <li>\n      [x] Write the parser\n      <span class=\"pri\">priority: high</span>\n    </li>\n    <li>\n      [ ] Add more tests\n      <span class=\"pri\">priority: high</span>\n    </li>\n    <li>\n      [ ] Polish the docs\n      \n    </li>\n</ul>\n\n",
  // A team grid composed from several partials (styles, header, card, avatar, lead_badge).
  "html-cards": "<style>\n  .banner { font-family: system-ui; margin: 0 0 12px; }\n  .banner h2 { margin: 0; font-size: 1.1rem; }\n  .banner p { margin: 2px 0 0; color: #6b7280; font-size: 13px; }\n  .team { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-family: system-ui; }\n  .card { position: relative; display: block; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; background: #fff; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }\n  .card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(24, 24, 27, 0.08); border-color: #c4b5fd; }\n  .card.lead { background: #faf5ff; }\n  .card:has(.pick:checked) { border-color: #7c3aed; box-shadow: 0 0 0 2px #ddd6fe; }\n  .pick { position: absolute; opacity: 0; pointer-events: none; }\n  .tip { position: absolute; left: 14px; bottom: calc(100% + 6px); max-width: 90%; background: #18181b; color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 6px; opacity: 0; transform: translateY(4px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; }\n  .card:hover .tip { opacity: 1; transform: translateY(0); }\n  .head { display: flex; align-items: center; gap: 10px; }\n  .avatar { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #ede9fe; font-size: 18px; }\n  .name { font-weight: 600; }\n  .role { color: #6b7280; font-size: 13px; }\n  .badge { color: #7c3aed; }\n</style><header class=\"banner\">\n  <h2>Engineering team</h2>\n  <p>Who builds Stem · hover for a note, click cards to select</p>\n</header>\n<div class=\"team\">\n  \n<label class=\"card lead\">\n  <input class=\"pick\" type=\"checkbox\" />\n  <span class=\"tip\">Lowers templates to portable bytecode</span>\n  <div class=\"head\">\n<div class=\"avatar\">⚙️</div>    \n<div>\n\n<div class=\"name\">1. ADA LOVELACE <span class=\"badge\">★ lead</span></div>  <div class=\"role\">Compiler</div>\n</div>\n  </div>\n</label>\n<label class=\"card \">\n  <input class=\"pick\" type=\"checkbox\" />\n  <span class=\"tip\">Renders bytecode on every host</span>\n  <div class=\"head\">\n<div class=\"avatar\">🚀</div>    \n<div>\n\n<div class=\"name\">2. GRACE HOPPER</div>  <div class=\"role\">Runtime</div>\n</div>\n  </div>\n</label>\n<label class=\"card \">\n  <input class=\"pick\" type=\"checkbox\" />\n  <span class=\"tip\">Turns source into a clean AST</span>\n  <div class=\"head\">\n<div class=\"avatar\">🧩</div>    \n<div>\n\n<div class=\"name\">3. ALAN TURING</div>  <div class=\"role\">Parser</div>\n</div>\n  </div>\n</label>\n<label class=\"card lead\">\n  <input class=\"pick\" type=\"checkbox\" />\n  <span class=\"tip\">Keeps the contracts honest</span>\n  <div class=\"head\">\n<div class=\"avatar\">🔭</div>    \n<div>\n\n<div class=\"name\">4. BARBARA LISKOV <span class=\"badge\">★ lead</span></div>  <div class=\"role\">Type systems</div>\n</div>\n  </div>\n</label>\n</div>",
  // Entry template that pulls in two partials via {{> name}}. The row partial
  // takes `@this` (each loop item) as its context, since runtime partials are
  // root-scoped and no longer inherit the caller's #each item (ADR-0014).
  partials: "<h2>Our team</h2><ul>\n  <li>Ada — Compiler</li>\n  <li>Grace — Runtime</li>\n  \n</ul>\n",
  // A partial invoked with a context (`this`) and a hash argument (`badge`).
  "partial-arguments": "<ul><li>Ada — member</li><li>Grace — member</li></ul>",
  // ADR-0014: a self-referential `node` partial walks a nested tree to any depth,
  // with #each over an empty `children` as the base case. The runtime invokes it
  // (no compile-time inlining), so the recursion is legal.
  recursion:
    '<ul class="tree"><li>src<ul><li>parser.ex</li><li>bytecode<ul><li>vm.ex</li><li>compiler.ex</li></ul></li><li>README.md</li></ul></li></ul>',
};

// Required substrings for render-only examples (no pinned full output). Without
// these, a regression that empties the output — e.g. partials losing their
// `#each` context and rendering blank cards — would still "render without
// erroring" and pass. The cheat-sheet's groups and rows come from partials
// invoked inside `#each`, so we assert real group titles and a couple of
// `eval`-rendered results actually appear.
const mustContain = {
  "cheat-sheet": [
    "<h2>escape", // a group title (the group partial got its loop item)
    "<h2>format",
    ">WORLD<",   // {{upcase name}} → name = "World" (strings/format group)
    ">banana<", // {{at items 0}} → items[0] = "banana" (minimum/default group)
  ],
};

const EXAMPLES_DIR = "native/web/examples/stem";

const { render, compile, parseAst, inspectAt, catalog } = await createRenderer(await readFile(WASM));
const manifest = JSON.parse(await readFile(path.join(EXAMPLES_DIR, "examples.json"), "utf8"));

// Load an example's individual files: main.stem, one .stem per partial, and
// data.yaml — the same files the browser fetches at runtime. The data is YAML,
// parsed with the vendored js-yaml so this matches the browser's parser.
async function loadExample(ex) {
  const dir = path.join(EXAMPLES_DIR, ex.id);
  const main = await readFile(path.join(dir, ex.main), "utf8");
  let data = loadYaml(await readFile(path.join(dir, ex.data), "utf8"));
  // Data overlays — additional YAML files mounted at the given path inside
  // the merged data tree before JSONata runs, matching the playground's
  // run() loop. Each `{ name, file }` entry is loaded from the example dir.
  if (Array.isArray(ex.overlays) && ex.overlays.length) {
    const parsed = await Promise.all(
      ex.overlays.map(async (o) => ({
        name: o.name,
        value: loadYaml(await readFile(path.join(dir, o.file), "utf8")),
      }))
    );
    const { merged, clashes } = mergeDataOverlays(data, parsed);
    if (clashes.length) {
      console.error(`  WARN ${ex.label} (overlays): ${clashes.length} clash(es): ${JSON.stringify(clashes)}`);
    }
    data = merged;
  }
  // An optional JSONata transform (the Controller) turns raw stats into the
  // drawable view-model the template renders — same step the playground runs.
  if (ex.transform) {
    const expr = await readFile(path.join(dir, ex.transform), "utf8");
    data = jsonata(expr).evaluate(data);
  }
  const partials = {};
  for (const name of ex.partials) {
    partials[name] = await readFile(path.join(dir, `${name}.stem`), "utf8");
  }
  return { main, partials, data };
}

let failures = 0;
for (const ex of manifest) {
  const want = expected[ex.id];
  let { main, partials, data } = await loadExample(ex);

  // Inject catalog-driven transformer lists for the cheat-sheet so the
  // validator uses the same data the browser renders.
  if (ex.id === "cheat-sheet") data = buildCheatSheetData(data, catalog());

  // Compile the entry (with its partials) through the engine, then render.
  const compiled = compile(main, partials);
  if (compiled.errors) {
    failures++;
    console.error(`  FAIL ${ex.label} (compile): ${JSON.stringify(compiled.errors)}`);
    continue;
  }

  // Honor the example's declared host policy. Per ADR-0013 every built-in
  // is callable by default; only `eval` is opt-in (some examples — e.g. the
  // cheat-sheet — need it to render at all).
  const policy = ex.eval ? { allow: null, eval: true } : undefined;
  const rendered = render(compiled.program, data, { policy });
  if (want === undefined) {
    // No pinned expected output (e.g. the large, data-driven cheat-sheet):
    // it must render without erroring AND contain its required substrings.
    const missing = (mustContain[ex.id] || []).filter((s) => !rendered.includes(s));
    if (missing.length) {
      failures++;
      console.error(`  FAIL ${ex.label} (render-only): missing ${JSON.stringify(missing)}`);
    } else {
      console.log(`  ok  ${ex.label} (render-only): ${rendered.length} bytes`);
    }
  } else if (rendered === want) {
    console.log(`  ok  ${ex.label}: ${JSON.stringify(rendered)}`);
  } else {
    failures++;
    console.error(`  FAIL ${ex.label}: got ${JSON.stringify(rendered)}, want ${JSON.stringify(want)}`);
  }
}

if (failures > 0) {
  console.error(`browser glue: ${failures} check(s) diverged`);
  process.exit(1);
}
console.log(`browser glue: ${manifest.length}/${manifest.length} examples compile + render correctly`);

// Source-map pass: compile + render each example with `map: true` and assert the
// segments tile the output (ordered, contiguous, no gaps/overlaps, covering the
// whole output in bytes) and attribute every run to a known file. This guards
// the provenance the playground's Source view relies on. Mapped rendering must
// reproduce the same output bytes as the plain path.
const enc = new TextEncoder();
let mapFailures = 0;
for (const ex of manifest) {
  let { main, partials, data } = await loadExample(ex);
  if (ex.id === "cheat-sheet") data = buildCheatSheetData(data, catalog());
  const known = new Set(["main", ...Object.keys(partials)]);

  const compiled = compile(main, partials, { map: true });
  if (compiled.error) {
    mapFailures++;
    console.error(`  FAIL ${ex.label} (map compile): ${compiled.error.message}`);
    continue;
  }

  const policy = ex.eval ? { allow: null, eval: true } : undefined;
  const { output, segments } = render(compiled.program, data, { map: true, policy });
  if (output !== render(compiled.program, data, { policy })) {
    mapFailures++;
    console.error(`  FAIL ${ex.label} (map output): diverged from the plain render`);
    continue;
  }

  const total = enc.encode(output).length;
  let cursor = 0;
  let problem = null;
  for (const s of segments) {
    if (s.out !== cursor) { problem = `gap/overlap at byte ${cursor} (segment starts ${s.out})`; break; }
    if (!(s.len > 0)) { problem = `empty segment at byte ${s.out}`; break; }
    if (!known.has(s.file)) { problem = `unknown file '${s.file}'`; break; }
    cursor += s.len;
  }
  if (!problem && cursor !== total) problem = `segments cover ${cursor}/${total} output bytes`;

  if (problem) {
    mapFailures++;
    console.error(`  FAIL ${ex.label} (source map): ${problem}`);
  } else {
    console.log(`  ok  ${ex.label}: ${segments.length} segment(s) tile ${total} bytes`);
  }
}

if (mapFailures > 0) {
  console.error(`source map: ${mapFailures} check(s) diverged`);
  process.exit(1);
}
console.log(`source map: ${manifest.length}/${manifest.length} examples tile their output with valid provenance`);

// Disassembly pass: the playground's Bytecode view renders `disassemble(program)`,
// which must reproduce the text `Stem.Bytecode.disasm/1` emits on the BEAM. The
// expected strings below are that reference output (the BEAM is the spec oracle),
// so this guards the JS disassembler against the reference, no Elixir at runtime.
const disasmCases = [
  {
    source: "Hi {{user.name}}!",
    expected: '; stem-bc/v1\nEMIT_TEXT "Hi "\nEMIT GET ASSIGN user name ESCAPE=html\nEMIT_TEXT "!"\n',
  },
  {
    source: "{{#each items}}{{@index1}}. {{@this.name}}{{/each}}",
    expected:
      "; stem-bc/v1\nEACH ASSIGN items\n  DO\n    EMIT INDEX1 ESCAPE=html\n" +
      '    EMIT_TEXT ". "\n    EMIT GET THIS name ESCAPE=html\n',
  },
  {
    source: "{{trim (upcase name)}}",
    expected: "; stem-bc/v1\nEMIT CALL trim(CALL upcase(ASSIGN name)) ESCAPE=html\n",
  },
];

let disasmFailures = 0;
for (const { source, expected } of disasmCases) {
  const compiled = compile(source);
  if (compiled.error) {
    disasmFailures++;
    console.error(`  FAIL disasm (compile): ${source} — ${compiled.error.message}`);
    continue;
  }
  const got = disassemble(compiled.program);
  if (got === expected) {
    console.log(`  ok  disasm: ${JSON.stringify(source)}`);
  } else {
    disasmFailures++;
    console.error(`  FAIL disasm ${JSON.stringify(source)}: got ${JSON.stringify(got)}`);
  }
}

if (disasmFailures > 0) {
  console.error(`disassembly: ${disasmFailures} check(s) diverged`);
  process.exit(1);
}
console.log(`disassembly: ${disasmCases.length}/${disasmCases.length} match Stem.Bytecode.disasm/1`);

// Dependency-graph pass: the Dependencies inspector builds its DAG from the
// engine's `parse_ast` (which keeps `{{partial "name"}}` calls as `partial`
// transformer emits). This checks the edge/cycle/missing-node derivation
// end-to-end through the wasm.
function astsOf(files) {
  const asts = {};
  for (const [name, source] of Object.entries(files)) {
    const { ast, error } = parseAst(source);
    if (error) throw new Error(`parse_ast ${name}: ${error.message}`);
    asts[name] = ast.nodes;
  }
  return asts;
}

let depFailures = 0;
const chain = buildDependencyGraph(
  astsOf({
    main: '{{partial "a"}} {{#each xs}}{{partial "ghost"}}{{/each}}',
    a: 'A {{partial "b"}}',
    b: "B",
  })
);
const chainEdges = chain.edges.map((e) => `${e.from}->${e.to}${e.missing ? "?" : ""}`).sort().join(",");
if (chainEdges !== "a->b,main->a,main->ghost?") {
  depFailures++;
  console.error(`  FAIL dep graph edges: ${chainEdges}`);
} else if (!chain.nodes.some((n) => n.id === "ghost" && n.missing) || chain.cycles.length !== 0) {
  depFailures++;
  console.error(`  FAIL dep graph missing/cycle derivation`);
} else {
  console.log(`  ok  dep graph: chain edges + missing partial`);
}

const cyclic = buildDependencyGraph(
  astsOf({ main: '{{partial "a"}}', a: '{{partial "b"}}', b: '{{partial "a"}}' }),
);
if (cyclic.cycles.length === 1 && cyclic.cycles[0].join("->") === "a->b->a") {
  console.log(`  ok  dep graph: cycle detected (a->b->a)`);
} else {
  depFailures++;
  console.error(`  FAIL dep graph cycle: ${JSON.stringify(cyclic.cycles)}`);
}

if (depFailures > 0) {
  console.error(`dependency graph: ${depFailures} check(s) diverged`);
  process.exit(1);
}
console.log(`dependency graph: 2/2 derive edges, missing nodes, and cycles from parse_ast`);

// AST outline pass: the AST inspector tab flattens `parse_ast` into an indented
// outline with byte spans for click-to-source. Check the shape end-to-end.
const outlineAst = parseAst("{{#each items}}{{@this.name}}{{/each}}");
if (outlineAst.error) {
  console.error(`  FAIL ast outline parse: ${outlineAst.error.message}`);
  process.exit(1);
}
const outline = astOutline(outlineAst.ast.nodes);
const shape = outline.map((r) => `${r.depth}:${r.text}`).join(" | ");
if (shape === "0:each items | 1:emit @this.name" && outline.every((r) => typeof r.start === "number")) {
  console.log(`  ok  ast outline: indented rows + byte spans`);
} else {
  console.error(`  FAIL ast outline: ${shape}`);
  process.exit(1);
}
console.log(`ast outline: 1/1 flattens parse_ast with spans`);

// Context Inspector pass: inspect_at re-runs the VM and snapshots the context at
// a source span. Compile with spans, find the emit segment for `{{name}}`, then
// assert one snapshot per loop iteration with the right @this / @index.
{
  const source = "{{#each items}}{{name}}{{/each}}";
  const data = { items: [{ name: "a" }, { name: "b" }] };
  const compiled = compile(source, {}, { map: true });
  const { segments } = render(compiled.program, data, { map: true });
  const emit = segments.find((s) => s.start != null);
  const snaps = inspectAt(compiled.program, data, { file: emit.file, start: emit.start, end: emit.end });
  const ok =
    snaps.length === 2 &&
    snaps[0].this.name === "a" &&
    snaps[0].index === 0 &&
    snaps[0].index1 === 1 &&
    snaps[1].this.name === "b" &&
    snaps[1].last === true;
  if (ok) {
    console.log(`context inspector: 1/1 inspect_at snapshots each iteration`);
  } else {
    console.error(`  FAIL context inspector: ${JSON.stringify(snaps)}`);
    process.exit(1);
  }
}

// Render-error contract: a refusal must throw a structured `Error` whose
// `.kind` is `"policy"` (allow-list / eval gate) or `"render"` (runtime
// failure). The playground branches on `.kind` to badge problems; embedding
// the message in the output string instead would silently render the error as
// if it were the body.
{
  const compiled = compile("{{eval body}}", {});
  let policyErr;
  try {
    render(compiled.program, { body: "x" }, { policy: { allow: null, eval: false } });
  } catch (err) {
    policyErr = err;
  }
  const policyOk =
    policyErr instanceof Error &&
    policyErr.kind === "policy" &&
    /eval/.test(policyErr.message);
  if (policyOk) {
    console.log(`  ok  render error: gate refusal throws { kind: "policy" }`);
  } else {
    console.error(`  FAIL render error: expected policy throw, got ${policyErr}`);
    process.exit(1);
  }

  // An allow-list refusal also surfaces as kind: "policy".
  const compiled2 = compile("{{trim x}}", {});
  let allowErr;
  try {
    render(compiled2.program, { x: " a " }, { policy: { allow: ["upcase"], eval: false } });
  } catch (err) {
    allowErr = err;
  }
  const allowOk =
    allowErr instanceof Error &&
    allowErr.kind === "policy" &&
    /allow-list/.test(allowErr.message);
  if (allowOk) {
    console.log(`  ok  render error: allow-list refusal throws { kind: "policy" }`);
  } else {
    console.error(`  FAIL render error: expected allow-list throw, got ${allowErr}`);
    process.exit(1);
  }

  console.log(`render error contract: 2/2 refusals throw structured Errors`);
}
