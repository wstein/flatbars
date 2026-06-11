// SPDX-License-Identifier: Apache-2.0
//
// Test for the HTTP FileProvider (Phase 0). Stubs global fetch to verify the
// read methods + the behaviour-preserving status handling. Run:
// node lab/app/file-provider.test.mjs (in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { httpFileProvider } from "./file-provider.mjs";

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
