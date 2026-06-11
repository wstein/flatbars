// SPDX-License-Identifier: Apache-2.0
//
// Tests for the project model (Phase 6) — walking a FileProvider tree into a workspace.
// Run: node lab/app/project.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { walkTree, classify, pickMain, pickData, loadProject } from "./project.mjs";

// A fake FileProvider over an in-memory tree: string leaf = file content, object = dir.
function fakeProvider(tree) {
  const at = (dir) => {
    if (dir === "." || dir === "") return tree;
    return dir.split("/").reduce((node, seg) => (node && typeof node === "object" ? node[seg] : undefined), tree);
  };
  return {
    id: "fake",
    capabilities: new Set(["read", "list"]),
    readText: async (path) => {
      const v = path.split("/").reduce((n, s) => (n && typeof n === "object" ? n[s] : undefined), tree);
      if (typeof v !== "string") throw new Error(`no file ${path}`);
      return v;
    },
    list: async (dir = ".") => {
      const node = at(dir);
      if (!node || typeof node !== "object") throw new Error(`no dir ${dir}`);
      return Object.entries(node).map(([name, v]) => ({ name, kind: typeof v === "string" ? "file" : "dir" }));
    },
  };
}

const TREE = {
  "index.hbs": "Hi {{> cards/item}}",
  "data.json": '{"name":"Ada"}',
  cards: { "item.hbs": "[{{name}}]", "head.hbs": "H" },
  "notes.md": "ignore? no, md is a template",
  node_modules: { "junk.hbs": "SHOULD BE SKIPPED" },
  ".git": { "config.hbs": "SKIP" },
  README: "no extension → ignored",
};

test("walkTree collects files, skips node_modules + dotdirs", async () => {
  const { files, truncated } = await walkTree(fakeProvider(TREE));
  assert.equal(truncated, false);
  assert.ok(files.includes("index.hbs"));
  assert.ok(files.includes("cards/item.hbs"));
  assert.ok(!files.some((f) => f.includes("node_modules")), "node_modules skipped");
  assert.ok(!files.some((f) => f.includes(".git")), "dotdirs skipped");
});

test("walkTree honours maxFiles (truncation is surfaced, not silent)", async () => {
  const big = {};
  for (let i = 0; i < 50; i++) big[`t${i}.hbs`] = "x";
  const { files, truncated } = await walkTree(fakeProvider(big), { maxFiles: 10 });
  assert.equal(files.length, 10);
  assert.equal(truncated, true);
});

test("classify splits templates from data documents", () => {
  const { templates, dataFiles } = classify(["index.hbs", "cards/item.hbs", "data.json", "x.yaml", "README"]);
  assert.deepEqual(templates, ["cards/item.hbs", "index.hbs"]);
  assert.deepEqual(dataFiles, ["data.json", "x.yaml"]);
});

test("pickMain prefers index/main; pickData prefers data.*", () => {
  assert.equal(pickMain(["cards/item.hbs", "index.hbs"]), "index.hbs");
  assert.equal(pickMain(["a/deep.hbs", "b.hbs"]), "b.hbs"); // shallowest when unnamed
  assert.equal(pickData(["x.json", "data.yaml"]), "data.yaml");
});

test("loadProject assembles main + cross-tree partials + data", async () => {
  const ws = await loadProject(fakeProvider(TREE));
  assert.equal(ws.mainPath, "index.hbs");
  assert.equal(ws.tabs[0].name, "main");
  assert.equal(ws.tabs[0].source, "Hi {{> cards/item}}");
  // partials keyed by path-without-extension, across the tree
  const partialNames = ws.tabs.slice(1).map((t) => t.name).sort();
  assert.deepEqual(partialNames, ["cards/head", "cards/item", "notes"]);
  assert.equal(ws.dataPath, "data.json");
  assert.equal(ws.dataSource, '{"name":"Ada"}');
  assert.equal(ws.dataKind, "json");
});

test("loadProject throws a clear error on a folder with no templates", async () => {
  await assert.rejects(() => loadProject(fakeProvider({ "data.json": "{}", "readme.txt": "x" })), /no template files found/);
});
