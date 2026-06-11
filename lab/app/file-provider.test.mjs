// SPDX-License-Identifier: Apache-2.0
//
// Test for the HTTP FileProvider (Phase 0). Stubs global fetch to verify the
// read methods + the behaviour-preserving status handling. Run:
// node lab/app/file-provider.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { httpFileProvider, fsAccessFileProvider, supportsFsAccess, pickDirectory, localFileProvider, detectTransport, selectFileProvider } from "./file-provider.mjs";

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

// --- local provider + transport detection (Phase 5, the localhost FS bridge) ---

// A fetch double that records the request + serves a route table keyed by op.
function localFetch(routes) {
  const calls = [];
  const impl = async (urlStr, opts = {}) => {
    const u = new URL(urlStr, "http://x");
    const op = u.pathname.replace("/__fs/", "");
    const path = u.searchParams.get("path");
    calls.push({ op, path, headers: opts.headers || {} });
    const r = routes[`${op}:${path}`] ?? routes[op];
    if (!r) return { ok: false, status: 404, statusText: "Not Found", text: async () => "404 body", json: async () => { throw new Error("nf"); } };
    return { ok: true, status: 200, statusText: "OK", text: async () => r, json: async () => JSON.parse(r) };
  };
  return { impl, calls };
}

test("localFileProvider advertises local + read/list, sends the session token", async () => {
  const { impl, calls } = localFetch({ "read:hello.hbs": "Hi {{name}}", "list:.": '[{"name":"hello.hbs","kind":"file"}]' });
  const p = localFileProvider({ token: "secret-123", fetchImpl: impl });
  assert.equal(p.id, "local");
  assert.ok(p.capabilities.has("read") && p.capabilities.has("list"));
  assert.equal(await p.readText("hello.hbs"), "Hi {{name}}");
  assert.deepEqual(await p.list("."), [{ name: "hello.hbs", kind: "file" }]);
  assert.ok(calls.every((c) => c.headers["x-fb-token"] === "secret-123"), "every request carries the token");
  assert.equal(calls[0].op, "read");
  assert.equal(calls[0].path, "hello.hbs");
});

test("localFileProvider.readText returns the body regardless of status (matches http)", async () => {
  const { impl } = localFetch({});
  assert.equal(await localFileProvider({ fetchImpl: impl }).readText("missing"), "404 body");
});

test("localFileProvider.readJson / list throw on a non-OK response", async () => {
  const { impl } = localFetch({});
  const p = localFileProvider({ fetchImpl: impl });
  await assert.rejects(() => p.readJson("x.json"), /x\.json: 404 Not Found/);
  await assert.rejects(() => p.list("sub"), /sub: 404 Not Found/);
});

test("detectTransport: http by default, local when the meta tag is present", () => {
  const noMeta = { querySelector: () => null };
  assert.deepEqual(detectTransport(noMeta, {}), { id: "http" });

  const withMeta = { querySelector: (sel) => (sel.includes("fb-transport") ? { getAttribute: () => "local" } : null) };
  assert.deepEqual(detectTransport(withMeta, { __FB_TOKEN: "tok" }), { id: "local", token: "tok" });
});

test("selectFileProvider returns the provider matching the served transport", () => {
  const noMeta = { querySelector: () => null };
  assert.equal(selectFileProvider(noMeta, {}).id, "http");

  const withMeta = { querySelector: () => ({ getAttribute: () => "local" }) };
  assert.equal(selectFileProvider(withMeta, { __FB_TOKEN: "t" }).id, "local");
});
