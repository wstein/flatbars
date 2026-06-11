// SPDX-License-Identifier: Apache-2.0
//
// Test for the HTTP FileProvider (Phase 0). Stubs global fetch to verify the
// read methods + the behaviour-preserving status handling. Run:
// node lab/app/file-provider.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { httpFileProvider, fsAccessFileProvider, supportsFsAccess, pickDirectory } from "./file-provider.mjs";

// A minimal in-memory FileSystemDirectoryHandle, enough to exercise the provider.
// `tree` is a nested object: string leaf = file content, object = subdirectory.
function fakeDir(name, tree) {
  return {
    name,
    kind: "directory",
    getDirectoryHandle: async (seg) => {
      const sub = tree[seg];
      if (sub === undefined || typeof sub === "string") throw new Error(`no dir ${seg}`);
      return fakeDir(seg, sub);
    },
    getFileHandle: async (seg) => {
      const f = tree[seg];
      if (typeof f !== "string") throw new Error(`no file ${seg}`);
      return { name: seg, kind: "file", getFile: async () => ({ text: async () => f }) };
    },
    async *entries() {
      for (const [k, v] of Object.entries(tree)) {
        yield [k, { kind: typeof v === "string" ? "file" : "directory" }];
      }
    },
  };
}

function stubFetch(map) {
  globalThis.fetch = async (path) => {
    const e = map[path];
    if (!e) return { ok: false, status: 404, statusText: "Not Found", text: async () => "404 body", json: async () => { throw new Error("not json"); } };
    return { ok: true, status: 200, statusText: "OK", text: async () => e, json: async () => JSON.parse(e) };
  };
}

test("httpFileProvider advertises the http id + read capability", () => {
  const p = httpFileProvider();
  assert.equal(p.id, "http");
  assert.ok(p.capabilities.has("read"));
});

test("readText returns the body", async () => {
  stubFetch({ "/a.txt": "hello" });
  assert.equal(await httpFileProvider().readText("/a.txt"), "hello");
});

test("readText returns the 404 body regardless of status (matches the old raw fetch)", async () => {
  stubFetch({});
  assert.equal(await httpFileProvider().readText("/missing"), "404 body");
});

test("readJson parses an OK response", async () => {
  stubFetch({ "/x.json": '{"a":1}' });
  assert.deepEqual(await httpFileProvider().readJson("/x.json"), { a: 1 });
});

test("readJson throws on a non-OK response (matches the old fetchJson)", async () => {
  stubFetch({});
  await assert.rejects(() => httpFileProvider().readJson("/missing.json"), /\/missing\.json: 404 Not Found/);
});

// --- fs-access provider (Phase 3, the second real transport) ---

const TREE = {
  "examples.json": '{"ids":["hello"]}',
  "hello.hbs": "Hi {{name}}",
  sub: { "a.txt": "nested" },
};

test("fsAccessFileProvider advertises fs-access + read+list capabilities", () => {
  const p = fsAccessFileProvider(fakeDir("proj", TREE));
  assert.equal(p.id, "fs-access");
  assert.equal(p.root, "proj");
  assert.ok(p.capabilities.has("read") && p.capabilities.has("list"));
});

test("fsAccessFileProvider rejects a non-handle", () => {
  assert.throws(() => fsAccessFileProvider({}), /FileSystemDirectoryHandle/);
});

test("readText / readJson resolve top-level + nested paths", async () => {
  const p = fsAccessFileProvider(fakeDir("proj", TREE));
  assert.equal(await p.readText("hello.hbs"), "Hi {{name}}");
  assert.equal(await p.readText("./sub/a.txt"), "nested");
  assert.deepEqual(await p.readJson("examples.json"), { ids: ["hello"] });
});

test("list enumerates a directory, dirs first then files, sorted", async () => {
  const p = fsAccessFileProvider(fakeDir("proj", TREE));
  assert.deepEqual(await p.list("."), [
    { name: "sub", kind: "dir" },
    { name: "examples.json", kind: "file" },
    { name: "hello.hbs", kind: "file" },
  ]);
  assert.deepEqual(await p.list("sub"), [{ name: "a.txt", kind: "file" }]);
});

test("paths that escape the picked root are rejected (the jail)", async () => {
  const p = fsAccessFileProvider(fakeDir("proj", TREE));
  await assert.rejects(() => p.readText("../outside"), /escapes the folder/);
});

test("supportsFsAccess / pickDirectory reflect the absence of the API in Node", async () => {
  assert.equal(supportsFsAccess(), false);
  await assert.rejects(() => pickDirectory(), /no File System Access API/);
});

test("pickDirectory returns an fs-access provider when the API is present", async () => {
  globalThis.showDirectoryPicker = async () => fakeDir("picked", TREE);
  try {
    const p = await pickDirectory();
    assert.equal(p.id, "fs-access");
    assert.equal(p.root, "picked");
    assert.equal(await p.readText("hello.hbs"), "Hi {{name}}");
  } finally {
    delete globalThis.showDirectoryPicker;
  }
});
