// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import {
  analyseCalls,
  analyseCoverage,
  analyseDataAccess,
  analyseEscapeRuns,
  analyseWhitespace,
  buildCheatSheetData,
  buildDependencyGraph,
  byteToChar,
  byteRangeToCharRange,
  charToByte,
  charToLineColumn,
  decodeState,
  disassemble,
  encodeState,
  featureFidelity,
  hasFeature,
  mergeDataOverlays,
  stemTruthy,
  partialNameAt,
  scanTruthinessPragma,
  tabVisibleUnder,
  transpileSt4,
  validateOverlayName,
  vendoredWorkspace,
  vendoredVerdict,
  vendoredMenuItems,
  vendoredHref,
} from "./playground_utils.mjs";

// ── ADR-0020 capability gating ─────────────────────────────────────────────

// The two adapter vectors the gate must discriminate (ADR-0020): Stem's full
// honest set, and a deliberately thinner Handlebars-style set with two
// `:approximate` capabilities.
const STEM_VECTOR = [
  "escape-modes", "eval-opt-in", "partials", "source-map", "standalone",
  "context-inspect", "bytecode-wire", "catalog", "used-transformers",
  "required-assigns", "partial-graph", "st4-modes", "stem-allow-list",
];
const HBS_VECTOR = [
  "partials", "catalog", "used-transformers:approximate",
  "required-assigns:approximate", "partial-graph:approximate",
  "hbs-known-helpers", "html-escape",
];

test("hasFeature matches a base name at any fidelity", () => {
  assert.equal(hasFeature(STEM_VECTOR, "bytecode-wire"), true);
  assert.equal(hasFeature(STEM_VECTOR, "nope"), false);
  // `:approximate` still counts as present.
  assert.equal(hasFeature(HBS_VECTOR, "partial-graph"), true);
  assert.equal(hasFeature(HBS_VECTOR, "bytecode-wire"), false);
  assert.equal(hasFeature([], "partials"), false);
  assert.equal(hasFeature(undefined, "partials"), false);
});

test("featureFidelity reports native | approximate | null", () => {
  assert.equal(featureFidelity(STEM_VECTOR, "partial-graph"), "native");
  assert.equal(featureFidelity(HBS_VECTOR, "partial-graph"), "approximate");
  assert.equal(featureFidelity(HBS_VECTOR, "used-transformers"), "approximate");
  assert.equal(featureFidelity(STEM_VECTOR, "missing"), null);
});

test("tabVisibleUnder: no requires is always visible (core surface)", () => {
  assert.equal(tabVisibleUnder(STEM_VECTOR, undefined), true);
  assert.equal(tabVisibleUnder(STEM_VECTOR, []), true);
  assert.equal(tabVisibleUnder([], []), true);
});

test("tabVisibleUnder gates panels per the engine vector", () => {
  // Every Stem panel's requirement is met under the full vector — the gate is
  // inert under Stem (the Phase 1 proof).
  const PANEL_REQUIRES = [
    ["catalog"], ["required-assigns"], ["standalone"], ["partial-graph"],
    ["stem-allow-list"], ["st4-modes"], ["bytecode-wire"],
  ];
  for (const requires of PANEL_REQUIRES) {
    assert.equal(tabVisibleUnder(STEM_VECTOR, requires), true, requires.join());
  }
  // Under the thin Handlebars vector the Stem-only panels drop out, while the
  // shared ones (catalog, partial-graph at approximate fidelity) stay.
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["bytecode-wire"]), false);
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["st4-modes"]), false);
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["stem-allow-list"]), false);
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["standalone"]), false);
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["catalog"]), true);
  assert.equal(tabVisibleUnder(HBS_VECTOR, ["partial-graph"]), true);
});

test("stemTruthy: falsy on null/false/\"\"/0/[]/{}; truthy on non-empty", () => {
  for (const v of [null, undefined, false, "", 0, [], {}]) {
    assert.equal(stemTruthy(v), false, `stem ${JSON.stringify(v)}`);
  }
  for (const v of ["x", [1], { a: 1 }, 1, true]) {
    assert.equal(stemTruthy(v), true, `stem ${JSON.stringify(v)}`);
  }
});

test("byteToChar maps UTF-8 byte offsets to JS character indices", () => {
  const source = "A😀B";

  assert.equal(byteToChar(source, 0), 0);
  assert.equal(byteToChar(source, 1), 1);
  assert.equal(byteToChar(source, 2), 1);
  assert.equal(byteToChar(source, 5), 3);
  assert.equal(byteToChar(source, 6), 4);
});

test("charToByte maps JS character indices to UTF-8 byte offsets", () => {
  const source = "A😀B";

  assert.equal(charToByte(source, 0), 0);
  assert.equal(charToByte(source, 1), 1); // after "A"
  assert.equal(charToByte(source, 3), 5); // after "A😀" (😀 is 4 bytes)
  assert.equal(charToByte(source, 4), 6); // after "A😀B"
  // Inverts byteToChar on character boundaries.
  for (const byte of [0, 1, 5, 6]) {
    assert.equal(charToByte(source, byteToChar(source, byte)), byte);
  }
});

test("byteRangeToCharRange returns a safe non-empty range", () => {
  const source = "line 1\nline 2";

  const [from, to] = byteRangeToCharRange(source, 0, 0);
  assert.equal(from, 0);
  assert.equal(to, 1);

  const [from2, to2] = byteRangeToCharRange(source, 2, 6);
  assert.equal(from2, 2);
  assert.equal(to2, 6);
});

test("charToLineColumn reports 1-based line and column", () => {
  const source = "ab\ncd\nef";

  assert.deepEqual(charToLineColumn(source, 0), { line: 1, column: 1 });
  assert.deepEqual(charToLineColumn(source, 3), { line: 2, column: 1 });
  assert.deepEqual(charToLineColumn(source, 7), { line: 3, column: 2 });
});

test("partialNameAt finds the partial under the caret", () => {
  const src = "a {{> card}} b\n{{> row x=1}}";
  //          0         1         2
  //          0123456789012345678901234567
  assert.equal(partialNameAt(src, 0), null);    // on "a"
  assert.equal(partialNameAt(src, 2), "card");  // at the opening "{"
  assert.equal(partialNameAt(src, 5), "card");  // inside the name
  assert.equal(partialNameAt(src, 11), "card"); // on the closing "}"
  assert.equal(partialNameAt(src, 12), null);   // the space after "}}"
  assert.equal(partialNameAt(src, 20), "row");  // inside {{> row x=1}}
});

test("partialNameAt strips whitespace-control tildes from the name", () => {
  // The compiler trims `~`, so the run's file is "header" either way; the name
  // detection must agree so caret→output sync still matches.
  assert.equal(partialNameAt("{{> header~}}", 5), "header");
  assert.equal(partialNameAt("{{~> header}}", 7), "header");
  assert.equal(partialNameAt("{{~>header~}}", 6), "header");
});

test("state encode/decode round-trips (compressed)", async () => {
  const state = {
    tabs: [{ n: "main", s: "Hello {{name}} — café ☕" }, { n: "card", s: "<div>{{name}}</div>" }],
    d: "{\n  \"name\": \"Ada\"\n}",
    e: "html",
    v: "rendered"
  };

  const encoded = await encodeState(state);
  assert.ok(encoded.startsWith("~"), "compressed links are tagged with a leading ~");
  const decoded = await decodeState(encoded);

  assert.deepEqual(decoded, state);
});

test("decodeState still reads legacy plain-base64 links", async () => {
  const state = { tabs: [{ n: "main", s: "Hi {{name}}" }], d: "", e: "", v: "rendered" };
  // The pre-compression encoding: UTF-8-safe base64 of the JSON, no "~" tag.
  const legacy = btoa(unescape(encodeURIComponent(JSON.stringify(state))));

  assert.deepEqual(await decodeState(legacy), state);
});

// ── Diagnostic analyses ──────────────────────────────────────────────────
// These tests use hand-written `stem-ast/v1` node lists rather than calling the
// WASM `parseAst`, so they exercise only the JS analyses (no engine boundary).

const span = (start, end) => ({ start, end });

test("analyseDataAccess classifies hits, misses, type-mismatch and OOB", () => {
  const asts = {
    main: [
      { t: "emit", expr: { t: "path", segments: ["user", "name"] }, src: span(0, 10) },
      { t: "emit", expr: { t: "path", segments: ["user", "ghost"] }, src: span(11, 20) },
      { t: "emit", expr: { t: "path", segments: ["items", "5"] }, src: span(21, 30) },
      { t: "emit", expr: { t: "path", segments: ["user", "name", "first"] }, src: span(31, 40) },
    ],
  };
  const data = { user: { name: "Ada" }, items: [1, 2, 3] };
  const rows = analyseDataAccess(asts, data);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].status, "hit");
  assert.equal(rows[0].value, "Ada");
  assert.equal(rows[1].status, "miss");
  assert.equal(rows[2].status, "oob");
  assert.equal(rows[3].status, "type-mismatch");
});

test("analyseDataAccess marks loop-body lookups as scoped", () => {
  const asts = {
    main: [{
      t: "each",
      subject: { t: "identifier", name: "items" },
      body: [{ t: "emit", expr: { t: "identifier", name: "label" }, src: span(10, 20) }],
      src: span(0, 30),
    }],
  };
  const rows = analyseDataAccess(asts, { items: [{ label: "x" }] });
  // The subject is classified against the root; the loop body's `label` is scoped.
  assert.equal(rows.find((r) => r.path === "items").status, "hit");
  assert.equal(rows.find((r) => r.path === "label").status, "scoped");
});

test("analyseDataAccess walks partial-tag context and hash-arg expressions", () => {
  // `{{> row name=ghost.field}}` — the partial hash arg is evaluated in the
  // caller's scope, so `ghost.field` is a real lookup that should be
  // classified. Regression catch — the original walker skipped `partial`
  // nodes entirely and the smoke test caught it.
  const asts = {
    main: [{
      t: "partial",
      name: "row",
      hash: { name: { t: "path", segments: ["ghost", "field"] } },
      src: { start: 0, end: 30 },
    }],
  };
  const rows = analyseDataAccess(asts, { other: 1 });
  const ghost = rows.find((r) => r.path === "ghost.field");
  assert.ok(ghost, "ghost.field lookup should be reported");
  assert.equal(ghost.status, "miss");
});

test("analyseDataAccess descends into transformer arg trees", () => {
  const asts = {
    main: [{
      t: "emit",
      expr: {
        t: "call",
        name: "upcase",
        args: [{ value: { t: "path", segments: ["user", "name"] } }],
      },
      src: span(0, 30),
    }],
  };
  const rows = analyseDataAccess(asts, { user: { name: "Ada" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "user.name");
  assert.equal(rows[0].status, "hit");
});

test("analyseWhitespace finds both leading and trailing trim markers", () => {
  const src = "x {{~ name }} y\n  {{ greeting ~}} z";
  const rows = analyseWhitespace(src, "main");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "leading");
  assert.equal(rows[0].line, 1);
  assert.equal(rows[1].kind, "trailing");
  assert.equal(rows[1].line, 2);
});

test("analyseWhitespace returns empty for a marker-free, all-inline template", () => {
  assert.deepEqual(analyseWhitespace("{{name}} {{greeting}}", "main"), []);
});

test("analyseWhitespace flags ADR-0016 standalone-tag lines", () => {
  // `{{#each items}}` on its own line is standalone — the line vanishes.
  // The inner `{{name}}` is an inline emit, not a standalone trigger.
  const src = "before\n{{#each items}}\n{{name}}\n{{/each}}\nafter";
  const rows = analyseWhitespace(src, "main");
  const standalone = rows.filter((r) => r.kind === "standalone");
  assert.equal(standalone.length, 2);
  assert.equal(standalone[0].desc, "block open");
  assert.equal(standalone[0].line, 2);
  assert.equal(standalone[1].desc, "block close");
  assert.equal(standalone[1].line, 4);
});

test("analyseWhitespace excludes lines with inline emit, raw, or text from standalone", () => {
  const src = [
    "<p>{{name}}</p>",       // inline emit + text — not standalone
    "{{{raw}}}",             // raw triple-stash — not standalone
    "x{{#each items}}y",     // block tag with surrounding text — not standalone
    "{{> partial}}",         // standalone partial — IS standalone
  ].join("\n");
  const rows = analyseWhitespace(src, "main");
  const standalone = rows.filter((r) => r.kind === "standalone");
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].desc, "partial");
  assert.equal(standalone[0].line, 4);
});

test("analyseCalls enumerates each pipeline stage and nested call", () => {
  const asts = {
    main: [{
      t: "emit",
      expr: {
        t: "pipeline",
        lhs: { t: "identifier", name: "title" },
        stages: [
          { name: "upcase", args: [] },
          { name: "truncate", args: [{ value: { t: "lit", value: 10 } }] },
        ],
      },
      src: span(0, 30),
    }],
  };
  const calls = analyseCalls(asts);
  assert.deepEqual(calls.map((c) => c.name), ["upcase", "truncate"]);
});

test("analyseEscapeRuns counts emits by escape mode", () => {
  const asts = {
    main: [
      { t: "emit", expr: { t: "lit", value: "a" }, escape: "html", src: span(0, 5) },
      { t: "emit", expr: { t: "lit", value: "b" }, escape: "html", src: span(6, 10) },
      { t: "emit", expr: { t: "lit", value: "c" }, escape: "none", src: span(11, 15) },
      { t: "text", text: "literal" },
    ],
  };
  const r = analyseEscapeRuns(asts);
  assert.deepEqual(r, { html: 2, plain: 0, raw: 1, total: 3 });
});

test("analyseCoverage marks executed and dead branches", () => {
  const asts = {
    main: [
      {
        t: "if",
        cond: { t: "identifier", name: "ready" },
        then: [{ t: "text", text: "yes" }],
        else: [{ t: "text", text: "no" }],
        src: span(0, 30),
      },
      {
        t: "each",
        subject: { t: "identifier", name: "items" },
        body: [{ t: "text", text: "item" }],
        else: [],
        src: span(31, 60),
      },
    ],
  };
  const rows = analyseCoverage(asts, { ready: true, items: [1, 2, 3] });
  const ifRow = rows.find((r) => r.kind === "if");
  const eachRow = rows.find((r) => r.kind === "each");
  assert.equal(ifRow.executed, true);
  assert.equal(eachRow.executed, true);
  assert.equal(eachRow.count, 3);
});

test("analyseCoverage marks loops over empty data as not executed", () => {
  const asts = {
    main: [{
      t: "each",
      subject: { t: "identifier", name: "items" },
      body: [{ t: "text", text: "row" }],
      else: [],
      src: span(0, 30),
    }],
  };
  const rows = analyseCoverage(asts, { items: [] });
  assert.equal(rows[0].executed, false);
  assert.equal(rows[0].count, 0);
});

test("buildDependencyGraph aggregates repeat invocations into a single weighted edge", () => {
  // main references `row` three times — one edge with count: 3, not three.
  const asts = {
    main: [
      { t: "partial", name: "row", src: { start: 0, end: 9 } },
      { t: "partial", name: "row", src: { start: 9, end: 18 } },
      { t: "partial", name: "row", src: { start: 18, end: 27 } },
    ],
    row: [{ t: "text", text: "x" }],
  };
  const g = buildDependencyGraph(asts);
  const mainRow = g.edges.filter((e) => e.from === "main" && e.to === "row");
  assert.equal(mainRow.length, 1);
  assert.equal(mainRow[0].count, 3);
});

test("analyseCoverage flags scoped branches as unknown", () => {
  const asts = {
    main: [{
      t: "each",
      subject: { t: "identifier", name: "items" },
      // Inside the loop body, `flag` is unknown — could be a field on the item.
      body: [{
        t: "if",
        cond: { t: "identifier", name: "flag" },
        then: [{ t: "text", text: "y" }],
        else: [],
        src: span(10, 25),
      }],
      else: [],
      src: span(0, 30),
    }],
  };
  const rows = analyseCoverage(asts, { items: [1, 2] });
  const inner = rows.find((r) => r.kind === "if");
  assert.equal(inner.executed, true); // unknown is treated as executed
  assert.match(inner.label, /unknown/);
});

// ── buildCheatSheetData ───────────────────────────────────────────────────

const MOCK_CATALOG = [
  { name: "upcase",     category: "strings",    arity: "1",   summary: "Convert to upper case.", example: "{{upcase name}}" },
  { name: "downcase",   category: "strings",    arity: "1",   summary: "Convert to lower case.", example: "{{downcase name}}" },
  { name: "escape_html",category: "minimum",    arity: "1",   summary: "HTML-encode unsafe characters.", example: "{{escape_html raw}}" },
  { name: "lookup",     category: "minimum",    arity: "2",   summary: "Read a map key.", example: '{{lookup obj "first-name"}}' },
  { name: "eval",       category: "eval",       arity: "1",   summary: "Render as template.", example: "{{eval body}}" },
];

test("buildCheatSheetData populates transformers from catalog by category", () => {
  const data = {
    main_groups: [
      { name: "format", categories: ["strings"] },
      { name: "default", categories: ["minimum"] },
    ],
    narrow_groups: [
      { name: "eval", categories: ["eval"] },
    ],
  };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  const format = result.main_groups[0].transformers;
  assert.equal(format.length, 2);
  assert.equal(format[0].name, "upcase");
  assert.equal(format[0].desc, "Convert to upper case.");
  assert.equal(format[0].example, "{{upcase name}}");
  assert.equal(format[0].result, null);
  assert.equal(format[0].cap, false);
  assert.equal(format[1].name, "downcase");

  const def = result.main_groups[1].transformers;
  assert.equal(def.length, 2); // escape_html + lookup
  assert.equal(def[0].name, "escape_html");

  const ev = result.narrow_groups[0].transformers;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].name, "eval");
});

test("buildCheatSheetData preserves catalog order within a category", () => {
  const data = { main_groups: [{ name: "g", categories: ["strings"] }], narrow_groups: [] };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  const names = result.main_groups[0].transformers.map((t) => t.name);
  assert.deepEqual(names, ["upcase", "downcase"]); // catalog order preserved
});

test("buildCheatSheetData applies scalar overrides", () => {
  const data = {
    main_groups: [{
      name: "default",
      categories: ["minimum"],
      overrides: {
        escape_html: { example: "{{escape_html unsafe}}", result: "&lt;script&gt;", cap: true },
      },
    }],
    narrow_groups: [],
  };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  const entry = result.main_groups[0].transformers.find((t) => t.name === "escape_html");
  assert.ok(entry, "escape_html row must exist");
  assert.equal(entry.example, "{{escape_html unsafe}}");
  assert.equal(entry.result, "&lt;script&gt;");
  assert.equal(entry.cap, true);
  // Un-overridden field falls back to catalog value
  assert.equal(entry.desc, "HTML-encode unsafe characters.");
});

test("buildCheatSheetData expands array overrides into multiple rows", () => {
  const data = {
    main_groups: [{
      name: "default",
      categories: ["minimum"],
      overrides: {
        lookup: [
          { example: '{{lookup data "host"}}' },
          { example: "{{lookup items 2}}", desc: "Look up by index." },
        ],
      },
    }],
    narrow_groups: [],
  };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  const rows = result.main_groups[0].transformers.filter((t) => t.name === "lookup");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].example, '{{lookup data "host"}}');
  assert.equal(rows[0].desc, "Read a map key."); // falls back to catalog summary
  assert.equal(rows[1].example, "{{lookup items 2}}");
  assert.equal(rows[1].desc, "Look up by index."); // override applied
});

test("buildCheatSheetData appends manual entries for escape group", () => {
  const data = {
    main_groups: [],
    narrow_groups: [{
      name: "escape",
      categories: [],
      entries: [
        { name: "\\{{ }}", desc: "Backslash rule.", example: "\\{{name}}", result: "{{name}}" },
        { name: "{{{{#raw}}}}", desc: "Raw block.", example: "{{{{#raw}}}}{{name}}{{{{/raw}}}}", result: "{{name}}" },
      ],
    }],
  };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  const transformers = result.narrow_groups[0].transformers;
  assert.equal(transformers.length, 2);
  assert.equal(transformers[0].name, "\\{{ }}");
  assert.equal(transformers[0].result, "{{name}}");
  assert.equal(transformers[0].cap, false); // default applied
  assert.equal(transformers[1].name, "{{{{#raw}}}}");
});

test("buildCheatSheetData leaves groups without categories unchanged (empty transformers)", () => {
  const data = {
    main_groups: [{ name: "custom", categories: [] }],
    narrow_groups: [],
  };
  const result = buildCheatSheetData(data, MOCK_CATALOG);
  assert.deepEqual(result.main_groups[0].transformers, []);
});

test("buildCheatSheetData does not mutate the original data object", () => {
  const data = {
    main_groups: [{ name: "format", categories: ["strings"] }],
    narrow_groups: [],
  };
  const original = JSON.stringify(data);
  buildCheatSheetData(data, MOCK_CATALOG);
  assert.equal(JSON.stringify(data), original);
});

test("buildCheatSheetData handles missing main_groups or narrow_groups", () => {
  const result1 = buildCheatSheetData({ narrow_groups: [] }, MOCK_CATALOG);
  assert.deepEqual(result1.main_groups, []);

  const result2 = buildCheatSheetData({ main_groups: [] }, MOCK_CATALOG);
  assert.deepEqual(result2.narrow_groups, []);

  const result3 = buildCheatSheetData({}, MOCK_CATALOG);
  assert.deepEqual(result3.main_groups, []);
  assert.deepEqual(result3.narrow_groups, []);
});

// ── Data overlays (Phase 1) ──────────────────────────────────────────────

test("validateOverlayName accepts simple and nested identifiers", () => {
  assert.equal(validateOverlayName("users"), null);
  assert.equal(validateOverlayName("users/active"), null);
  assert.equal(validateOverlayName("config/db/replicas"), null);
  assert.equal(validateOverlayName("_private"), null);
  assert.equal(validateOverlayName("users_2/active"), null);
});

test("validateOverlayName rejects malformed names", () => {
  assert.match(validateOverlayName(""), /required/);
  assert.match(validateOverlayName("1st"), /identifiers/);
  assert.match(validateOverlayName("users.active"), /identifiers/);
  assert.match(validateOverlayName("users/2"), /identifiers/);
  assert.match(validateOverlayName("a//b"), /identifiers/);
  assert.match(validateOverlayName("/leading"), /identifiers/);
  assert.match(validateOverlayName("trailing/"), /identifiers/);
});

test("validateOverlayName rejects reserved names", () => {
  assert.match(validateOverlayName("main"), /reserved/);
  assert.match(validateOverlayName("data"), /reserved/);
  assert.match(validateOverlayName("transform"), /reserved/);
});

test("mergeDataOverlays mounts each overlay at its slash-path", () => {
  const main = { title: "Stem", items: [1, 2] };
  const overlays = [
    { name: "users/active", value: [{ name: "ada" }, { name: "grace" }] },
    { name: "config/host", value: { production: "example.com" } },
  ];
  const { merged, clashes } = mergeDataOverlays(main, overlays);
  assert.equal(merged.title, "Stem");
  assert.deepEqual(merged.items, [1, 2]);
  assert.deepEqual(merged.users.active, [{ name: "ada" }, { name: "grace" }]);
  assert.deepEqual(merged.config.host, { production: "example.com" });
  assert.deepEqual(clashes, []);
});

test("mergeDataOverlays deep-merges objects, extras win for scalars", () => {
  const main = { user: { name: "Ada", role: "engineer" } };
  // The overlay sits at user/role — note the user object in main keeps
  // `name` (deep merge) while `role` is overridden by the overlay's value.
  const overlays = [{ name: "user/role", value: "admin" }];
  const { merged, clashes } = mergeDataOverlays(main, overlays);
  assert.equal(merged.user.name, "Ada");
  assert.equal(merged.user.role, "admin");
  assert.deepEqual(clashes, []);
});

test("mergeDataOverlays records a type clash on object-vs-scalar collisions", () => {
  // Main has a *string* at user.role; overlay mounts an *object*. Last-write-
  // wins keeps the overlay value, but the clash is reported so the host can
  // raise it as a Problems row.
  const main = { user: { role: "admin" } };
  const overlays = [{ name: "user/role", value: { kind: "owner" } }];
  const { merged, clashes } = mergeDataOverlays(main, overlays);
  assert.deepEqual(merged.user.role, { kind: "owner" });
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].path, "user.role");
  assert.equal(clashes[0].was, "string");
  assert.equal(clashes[0].now, "object");
});

test("mergeDataOverlays applies overlays in order — later overrides earlier", () => {
  const main = { config: { port: 8080 } };
  const overlays = [
    { name: "config/port", value: 9090 },
    { name: "config/port", value: 9091 },
  ];
  const { merged } = mergeDataOverlays(main, overlays);
  assert.equal(merged.config.port, 9091);
});

test("mergeDataOverlays does not mutate the main value", () => {
  const main = Object.freeze({ user: Object.freeze({ name: "Ada" }) });
  const overlays = [{ name: "user/role", value: "admin" }];
  // The merge clones main first — the freeze on the original survives.
  assert.doesNotThrow(() => mergeDataOverlays(main, overlays));
});

test("mergeDataOverlays handles a missing/empty main gracefully", () => {
  // Common new-workspace shape: no data.yaml yet.
  const overlays = [{ name: "users", value: [{ name: "ada" }] }];
  const { merged } = mergeDataOverlays(undefined, overlays);
  assert.deepEqual(merged.users, [{ name: "ada" }]);
});

test("mergeDataOverlays clashes when main is a non-object", () => {
  // A scalar main can't compose with an overlay; report the clash and
  // fall back to the overlay-only tree.
  const { merged, clashes } = mergeDataOverlays("scalar main", [
    { name: "users", value: [1, 2] },
  ]);
  assert.deepEqual(merged.users, [1, 2]);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].path, "");
  assert.equal(clashes[0].was, "string");
});

test("encode/decode round-trips a workspace with data overlays", async () => {
  // Phase 4 share-link extension: the encoded state carries `do` (data
  // overlays) alongside the existing `d` scalar. Legacy links without
  // `do` continue to decode unchanged (covered by the earlier round-trip
  // test); this case covers the new shape.
  const state = {
    tabs: [{ n: "main", s: "{{title}} {{user.name}}" }],
    d: "title: Stem",
    do: [
      { n: "user", s: "name: Ada" },
      { n: "config/host", s: "production: example.com" },
    ],
    e: "html",
    v: "rendered",
  };
  const encoded = await encodeState(state);
  assert.ok(encoded.startsWith("~"));
  const decoded = await decodeState(encoded);
  assert.deepEqual(decoded, state);
});

// ── disassemble (Bytecode view in the playground) ────────────────────────

test("disassemble renders invoke_partial with name, context, and hash", () => {
  // Mirrors `Stem.Bytecode.disasm/1` for `:invoke_partial` — the BEAM reference
  // emits `INVOKE_PARTIAL <name> [<context>] [{kw=val, ...}]`. The JS port had
  // no case for it and was falling through to `default`, which printed the bare
  // opcode (no name, no args), making `{{> sheet}}` / `{{> row @this}}` /
  // `{{> badge @this label="VIP"}}` indistinguishable in the Bytecode view.
  const program = {
    version: "stem-bc/v1",
    instructions: [
      { t: "invoke_partial", name: "sheet", context: null, hash: {} },
      { t: "invoke_partial", name: "row", context: { t: "this" }, hash: {} },
      {
        t: "invoke_partial",
        name: "badge",
        context: { t: "this" },
        hash: { label: { t: "lit", value: "VIP" } },
      },
    ],
  };
  const out = disassemble(program);
  assert.match(out, /INVOKE_PARTIAL sheet\n/);
  assert.match(out, /INVOKE_PARTIAL row THIS\n/);
  assert.match(out, /INVOKE_PARTIAL badge THIS \{label=LIT "VIP"\}\n/);
});

test("disassemble dumps each compiled partial body after the main listing", () => {
  // Wire programs that reference partials (ADR-0014 runtime registry) carry
  // each compiled body alongside `instructions` as `partials: {name: [...]}`.
  // The playground's Bytecode view dumps them inline so the user can see what
  // each `INVOKE_PARTIAL` resolves to without leaving the disasm — sibling
  // sections similar to how the ST4 Preview emits a `.stg` group file with
  // one entry per partial. Names are listed alphabetically for a stable scan.
  const program = {
    version: "stem-bc/v1",
    instructions: [
      { t: "invoke_partial", name: "footer", context: null, hash: {} },
      { t: "invoke_partial", name: "header", context: null, hash: {} },
    ],
    partials: {
      header: [{ t: "text", text: "<h1>" }, { t: "emit", value: { t: "assign", name: "title" }, escape: "html" }, { t: "text", text: "</h1>" }],
      footer: [{ t: "text", text: "<footer />" }],
    },
  };
  const out = disassemble(program);
  // Main listing comes first.
  assert.match(out, /^; stem-bc\/v1\nINVOKE_PARTIAL footer\nINVOKE_PARTIAL header\n/);
  // Then alphabetical partial sections.
  assert.match(out, /\n\n; partial: footer\nEMIT_TEXT "<footer \/>"\n/);
  assert.match(out, /\n\n; partial: header\nEMIT_TEXT "<h1>"\nEMIT ASSIGN title ESCAPE=html\nEMIT_TEXT "<\/h1>"\n/);
  // footer < header alphabetically, so its section comes first.
  assert.ok(out.indexOf("; partial: footer") < out.indexOf("; partial: header"));
});

test("disassemble omits the partials section when none are referenced", () => {
  // A program without a partials registry should disasm identically to the
  // BEAM reference — no trailing blank line, no `; partial:` header.
  const out = disassemble({
    version: "stem-bc/v1",
    instructions: [{ t: "text", text: "hi" }],
  });
  assert.equal(out, '; stem-bc/v1\nEMIT_TEXT "hi"\n');
});

// ── scanTruthinessPragma + transpileSt4 (playground live preview) ────────

test("scanTruthinessPragma reads {{! @truthiness: st4 }} at the top", () => {
  assert.equal(scanTruthinessPragma("{{! @truthiness: st4 }}\nhi"), "st4");
  assert.equal(scanTruthinessPragma("{{! @truthiness: elixir }}foo"), "elixir");
  assert.equal(scanTruthinessPragma("{{!-- @truthiness: stem --}}"), "stem");
});

test("scanTruthinessPragma returns null when absent or not at the top", () => {
  assert.equal(scanTruthinessPragma("Hello {{name}}!"), null);
  assert.equal(scanTruthinessPragma("hello {{! @truthiness: st4 }}"), null);
  assert.equal(scanTruthinessPragma(""), null);
});

test("scanTruthinessPragma does not match plain comments without @", () => {
  assert.equal(scanTruthinessPragma("{{! truthiness: st4 }}<x>"), null);
});

test("transpileSt4 emits plain text verbatim", () => {
  const nodes = [{ t: "text", text: "Hello, world!" }];
  assert.equal(transpileSt4(nodes, { truthiness: "st4" }), "Hello, world!");
});

test("transpileSt4 emits {{{name}}} as <name>", () => {
  const nodes = [
    { t: "emit", expr: { t: "identifier", name: "name" }, escape: "none" },
  ];
  assert.equal(transpileSt4(nodes, { truthiness: "st4" }), "<name>");
});

test("transpileSt4 emits {{name}} as <name; format=stem.escape.html>", () => {
  const nodes = [
    { t: "emit", expr: { t: "identifier", name: "name" }, escape: "html" },
  ];
  assert.equal(
    transpileSt4(nodes, { truthiness: "st4" }),
    '<name; format="stem.escape.html">',
  );
});

test("transpileSt4 emits {{#if cond}}A{{else}}B{{/if}} → <if(cond)>A<else>B<endif>", () => {
  const nodes = [
    {
      t: "if",
      cond: { t: "identifier", name: "cond" },
      then: [{ t: "text", text: "A" }],
      else: [{ t: "text", text: "B" }],
    },
  ];
  assert.equal(
    transpileSt4(nodes, { truthiness: "st4" }),
    "<if(cond)>A<else>B<endif>",
  );
});

test("transpileSt4 emits {{#each items}}-{{{@this}}}{{/each}} → <items:{ it | -<it>}>", () => {
  const nodes = [
    {
      t: "each",
      subject: { t: "identifier", name: "items" },
      body: [
        { t: "text", text: "-" },
        { t: "emit", expr: { t: "context", kind: "this", path: [] }, escape: "none" },
      ],
      else: [],
    },
  ];
  assert.equal(
    transpileSt4(nodes, { truthiness: "st4" }),
    "<items:{ it | -<it>}>",
  );
});

test("transpileSt4 emits {{upcase name}} → <name; format=upper>", () => {
  const nodes = [
    {
      t: "emit",
      expr: {
        t: "call",
        name: "upcase",
        args: [{ kind: "positional", value: { t: "identifier", name: "name" } }],
      },
      escape: "none",
    },
  ];
  assert.equal(
    transpileSt4(nodes, { truthiness: "st4" }),
    '<name; format="upper">',
  );
});

test("transpileSt4 flags an incompatible transformer as <! transpile-error: ... !>", () => {
  const nodes = [
    {
      t: "emit",
      expr: {
        t: "call",
        name: "filter",
        args: [{ kind: "positional", value: { t: "identifier", name: "items" } }],
      },
      escape: "none",
    },
  ];
  const out = transpileSt4(nodes, { truthiness: "st4" });
  assert.match(out, /<! transpile-error: transformer `filter`/);
});

test("transpileSt4 flags missing truthiness pragma with a leading comment", () => {
  const nodes = [{ t: "text", text: "hi" }];
  const out = transpileSt4(nodes, { truthiness: "stem" });
  assert.match(out, /^<! Stem→ST4 transpile gate: source must declare/);
  assert.match(out, /hi/);
});

test("transpileSt4 with {map:true} returns segments mapping output ranges back to source spans", () => {
  // Stem source: `{{name}}{{filter items}}` (paths/spans are illustrative).
  const nodes = [
    {
      t: "emit",
      expr: { t: "identifier", name: "name" },
      escape: "none",
      src: { start: 0, end: 8 },
    },
    {
      t: "emit",
      expr: {
        t: "call",
        name: "filter",
        args: [{ kind: "positional", value: { t: "identifier", name: "items" } }],
      },
      escape: "none",
      src: { start: 8, end: 24 },
    },
  ];
  const result = transpileSt4(nodes, { truthiness: "st4", map: true });

  assert.equal(typeof result.output, "string");
  assert.ok(Array.isArray(result.segments));

  // Two segments — one emit + one error — each covering its own
  // contiguous range of the output and carrying its original source span.
  assert.equal(result.segments.length, 2);

  const [s1, s2] = result.segments;
  assert.equal(s1.kind, "emit");
  assert.equal(s1.start, 0);
  assert.equal(s1.end, 8);
  assert.equal(result.output.slice(s1.outBegin, s1.outEnd), "<name>");

  assert.equal(s2.kind, "error");
  assert.equal(s2.start, 8);
  assert.equal(s2.end, 24);
  assert.match(result.output.slice(s2.outBegin, s2.outEnd), /^<! transpile-error: /);
});

test("transpileSt4 map mode tags partials with file=<partial-name>", () => {
  const main = [{ t: "partial", name: "row", context: null, hash: {}, src: { start: 0, end: 9 } }];
  const partials = {
    row: [{ t: "text", text: "- item", src: { start: 5, end: 11 } }],
  };
  const result = transpileSt4(main, { truthiness: "st4", map: true }, partials);

  const fileTags = new Set(result.segments.map((s) => s.file));
  assert.ok(fileTags.has("main"));
  assert.ok(fileTags.has("row"));

  const rowSeg = result.segments.find((s) => s.file === "row" && s.kind === "text");
  assert.equal(rowSeg.start, 5);
  assert.equal(rowSeg.end, 11);
});

test("transpileSt4 wraps partials into a .stg group file", () => {
  const main = [{ t: "partial", name: "row", context: null, hash: {} }];
  const partials = { row: [{ t: "text", text: "- item" }] };
  const out = transpileSt4(main, { truthiness: "st4" }, partials);
  assert.match(out, /^delimiters "<", ">"/);
  assert.match(out, /main\(\) ::= <</);
  assert.match(out, /<row\(\)>/);
  assert.match(out, /row\(\) ::= <</);
  assert.match(out, /- item/);
});

test("vendoredWorkspace maps a fixture to a Lab workspace payload", () => {
  const fx = {
    id: "mustache/partials/context",
    dialect: "minbars",
    template: "{{>p}}",
    data: { name: "Ada" },
    partials: { p: "Hi {{name}}" },
    expected: "Hi Ada",
    divergenceMeaning: "conformance-failure",
  };
  const ws = vendoredWorkspace(fx);
  assert.equal(ws.engine, "minbars");
  assert.equal(ws.template, "{{>p}}");
  assert.equal(ws.expected, "Hi Ada");
  assert.equal(ws.divergenceMeaning, "conformance-failure");
  // data → editor text (JSON is valid YAML); partials object → {name, source} pairs.
  assert.equal(JSON.parse(ws.dataText).name, "Ada");
  assert.deepEqual(ws.partials, [{ name: "p", source: "Hi {{name}}" }]);
});

test("vendoredWorkspace tolerates absent data/partials", () => {
  const ws = vendoredWorkspace({ dialect: "minbars", template: "x", expected: "x" });
  assert.equal(ws.dataText, "null");
  assert.deepEqual(ws.partials, []);
  assert.equal(ws.divergenceMeaning, "conformance-failure");
});

test("vendoredVerdict classifies match and divergence by meaning", () => {
  const mus = { expected: "ok", divergenceMeaning: "conformance-failure" };
  assert.deepEqual(vendoredVerdict(mus, "ok"), { match: true, severity: "ok" });
  // a Mustache miss is a defect; a Handlebars miss is a by-design divergence.
  assert.deepEqual(vendoredVerdict(mus, "no"), { match: false, severity: "conformance-failure" });
  const hbs = { expected: "ok", divergenceMeaning: "expected-difference" };
  assert.deepEqual(vendoredVerdict(hbs, "no"), { match: false, severity: "expected-difference" });
});

test("vendoredMenuItems maps a manifest to picker entries", () => {
  const manifest = { commit: "abc", fixtures: [
    { id: "mustache/sections/truthy", dialect: "minbars", category: "sections", name: "truthy" },
    { id: "mustache/partials/context", dialect: "minbars", category: "partials", name: "context" },
  ]};
  assert.deepEqual(vendoredMenuItems(manifest), [
    { id: "mustache/sections/truthy", dialect: "minbars", label: "sections/truthy" },
    { id: "mustache/partials/context", dialect: "minbars", label: "partials/context" },
  ]);
  assert.deepEqual(vendoredMenuItems(null), []);
  assert.deepEqual(vendoredMenuItems({}), []);
});

test("vendoredHref sets engine + vendored, preserving the rest", () => {
  const href = vendoredHref("mustache/sections/truthy", "minbars", "http://x/app?engine=stem&foo=1");
  const u = new URL(href);
  assert.equal(u.searchParams.get("engine"), "minbars");
  assert.equal(u.searchParams.get("vendored"), "mustache/sections/truthy");
  assert.equal(u.searchParams.get("foo"), "1"); // unrelated params preserved
});

