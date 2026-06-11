// SPDX-License-Identifier: Apache-2.0
//
// Tests for the Lab local dev transport (Phase 5) — the `/__fs/*` bridge's security
// baseline + read/list/write, driven through makeFsHandler with fake req/res (no
// socket), plus one end-to-end listen. Run: node scripts/lab-server.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { jail, makeFsHandler, injectToken, createLabServer } from "./lab-server.mjs";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "fb-lab-"));
  await writeFile(join(dir, "hello.hbs"), "Hi {{name}}");
  await writeFile(join(dir, "data.json"), '{"name":"Ada"}');
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "a.txt"), "nested");
  return dir;
}

// Drive the handler with a fake req/res, returning { code, body, type }.
async function call(handler, { url, method = "GET", headers = {}, body }) {
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const out = {};
  const req = { url, method, headers, on: (ev, cb) => { if (ev === "data" && body) cb(Buffer.from(body)); if (ev === "end") cb(); } };
  const res = {
    writeHead(code, h) { out.code = code; out.type = h["content-type"]; },
    end(b) { out.body = b; resolveDone(); },
  };
  await handler(req, res);
  await done;
  return out;
}

const TOKEN = "tok-abc";
const ok = (extra = {}) => ({ "x-fb-token": TOKEN, ...extra });

test("jail() resolves under root and rejects escapes", async () => {
  const root = await fixture();
  assert.equal(jail(root, "hello.hbs"), resolve(root, "hello.hbs"));
  assert.equal(jail(root, "./sub/a.txt"), resolve(root, "sub/a.txt"));
  assert.equal(jail(root, "../../etc/passwd"), null);
  assert.equal(jail(root, "/../../etc/passwd"), null);
});

test("read returns a jailed file; missing → 404; escape → 403", async () => {
  const h = makeFsHandler(await fixture(), { token: TOKEN });
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs", headers: ok() })).body, "Hi {{name}}");
  assert.equal((await call(h, { url: "/__fs/read?path=nope", headers: ok() })).code, 404);
  assert.equal((await call(h, { url: "/__fs/read?path=../../etc/passwd", headers: ok() })).code, 403);
});

test("list enumerates a directory, dirs first then files, sorted", async () => {
  const h = makeFsHandler(await fixture(), { token: TOKEN });
  const r = await call(h, { url: "/__fs/list?path=.", headers: ok() });
  assert.equal(r.code, 200);
  assert.deepEqual(JSON.parse(r.body), [
    { name: "sub", kind: "dir" },
    { name: "data.json", kind: "file" },
    { name: "hello.hbs", kind: "file" },
  ]);
});

test("(2) a missing/wrong token is forbidden", async () => {
  const h = makeFsHandler(await fixture(), { token: TOKEN });
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs" })).code, 403);
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs", headers: { "x-fb-token": "wrong" } })).code, 403);
});

test("CSRF: a cross-origin request is rejected", async () => {
  const h = makeFsHandler(await fixture(), { token: TOKEN, origin: "http://127.0.0.1:9000" });
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs", headers: ok({ origin: "http://evil.test" }) })).code, 403);
  // same-origin (or no Origin header) is allowed
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs", headers: ok({ origin: "http://127.0.0.1:9000" }) })).code, 200);
  assert.equal((await call(h, { url: "/__fs/read?path=hello.hbs", headers: ok() })).code, 200);
});

test("(3) writes are forbidden by default, allowed under --write, and jailed", async () => {
  const root = await fixture();
  const ro = makeFsHandler(root, { token: TOKEN, allowWrite: false });
  assert.equal((await call(ro, { url: "/__fs/write?path=new.txt", method: "POST", headers: ok(), body: "x" })).code, 403);

  const rw = makeFsHandler(root, { token: TOKEN, allowWrite: true });
  assert.equal((await call(rw, { url: "/__fs/write?path=new.txt", method: "POST", headers: ok(), body: "written" })).code, 200);
  assert.equal(await readFile(join(root, "new.txt"), "utf8"), "written");
  // a write that escapes the jail is still 403 even with --write
  assert.equal((await call(rw, { url: "/__fs/write?path=../escape.txt", method: "POST", headers: ok(), body: "x" })).code, 403);
});

test("injectToken inserts window.__FB_TOKEN into the page head", () => {
  const out = injectToken("<html><head><title>x</title></head><body></body></html>", "secret");
  assert.match(out, /window\.__FB_TOKEN="secret"/);
  assert.ok(out.indexOf("__FB_TOKEN") < out.indexOf("</head>"));
});

test("end-to-end: the server serves the bridge over a real socket", async () => {
  const root = await fixture();
  const labRoot = resolve(import.meta.dirname, "..");
  const { server, token } = createLabServer({ labRoot, projectRoot: root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const good = await fetch(`http://127.0.0.1:${port}/__fs/read?path=hello.hbs`, { headers: { "x-fb-token": token } });
    assert.equal(await good.text(), "Hi {{name}}");
    const bad = await fetch(`http://127.0.0.1:${port}/__fs/read?path=hello.hbs`);
    assert.equal(bad.status, 403);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
