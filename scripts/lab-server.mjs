#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The FlatBars Lab local dev transport (Phase 5 of PLAN-registry-local-trussbars.md)
// — the Node REFERENCE for `trussbars lab [dir]`. It serves the static Lab bundle AND
// exposes a narrow, root-jailed FS bridge (`/__fs/*`) over a launch directory, so the
// Lab can render/analyse local templates on disk. The engine is in-page wasm, so this
// server NEVER renders — it is purely a file transport (the `local` FileProvider in
// lab/app/file-provider.mjs talks to it).
//
//   node scripts/lab-server.mjs [projectDir] [--write] [--port N]
//
// Security baseline (all three are non-negotiable — Phase 5's hard line):
//   1. Root-jail   — every `/__fs/*` path resolves under the launch dir; escapes 403.
//   2. Session token — a per-run secret is required (x-fb-token header) on every
//      `/__fs/*` request; the server injects it into the page (window.__FB_TOKEN).
//   3. Read-only by default — writes only behind `--write`.
//   Plus: bind 127.0.0.1 only; reject cross-origin requests (CSRF) via the Origin
//   header. (Watch/SSE + the project model are Phase 6; this ships read/list/write.)
//
// NOTE: this Phase-5 server does NOT yet inject `<meta name="fb-transport=local">` —
// the Lab's example loader still uses the app's `http` assets; the project model that
// consumes the `local` provider lands in Phase 6. The bridge is live + token-injected.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeHandler } from "./serve-lab.mjs";

// Resolve `relPath` under `root`, or return null if it escapes the jail. The exact
// resolve+startsWith guard makeHandler uses for static files.
export function jail(root, relPath) {
  const decoded = (() => { try { return decodeURIComponent(relPath || ""); } catch { return null; } })();
  if (decoded == null) return null;
  const abs = resolve(root, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

// The `/__fs/*` request handler over `projectRoot`. Enforces the token + the CSRF
// Origin guard + the jail; serves read/list, and write only when `allowWrite`. Factored
// out (pure but for fs) so the server test can drive it without a socket.
export function makeFsHandler(projectRoot, { token, allowWrite = false, origin } = {}) {
  const root = resolve(projectRoot);
  return async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };

    // (2) Session token — required on every bridge request.
    if (token && req.headers["x-fb-token"] !== token) return send(403, "forbidden: bad or missing token");
    // CSRF — reject a cross-origin caller (a malicious page hitting localhost). A
    // same-origin fetch omits Origin (GET) or sends our own; anything else is rejected.
    const reqOrigin = req.headers["origin"];
    if (reqOrigin && origin && reqOrigin !== origin) return send(403, "forbidden: cross-origin");

    const op = url.pathname.replace(/^\/__fs\//, "");
    const abs = jail(root, url.searchParams.get("path") ?? "");
    if (op !== "write" && abs == null) return send(403, "forbidden: path escapes the launch directory");

    try {
      if (op === "read" && req.method === "GET") {
        return send(200, await readFile(abs, "utf8"));
      }
      if (op === "list" && req.method === "GET") {
        const entries = await readdir(abs, { withFileTypes: true });
        const out = entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? "dir" : "file" }));
        out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
        return send(200, JSON.stringify(out), "application/json; charset=utf-8");
      }
      if (op === "write" && req.method === "POST") {
        if (!allowWrite) return send(403, "forbidden: server is read-only (start with --write)");
        const target = jail(root, url.searchParams.get("path") ?? "");
        if (target == null) return send(403, "forbidden: path escapes the launch directory");
        const body = await readBody(req);
        await writeFile(target, body);
        return send(200, "ok");
      }
      return send(404, `no such bridge op: ${req.method} ${op}`);
    } catch (e) {
      const code = e && e.code === "ENOENT" ? 404 : 500;
      return send(code, `${op} failed: ${e && e.message ? e.message : e}`);
    }
  };
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

// Inject the session token into the served Lab page so the in-page `local` provider can
// authenticate. (Phase 6 adds the `<meta fb-transport=local>` that flips boot to the
// local provider, together with the project model.)
export function injectToken(html, token) {
  const tag = `<script>window.__FB_TOKEN=${JSON.stringify(token)};</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}\n</head>`) : tag + html;
}

// Compose the full server: static Lab (over `labRoot`, the repo root → /lab/) + the
// `/__fs/*` bridge (over `projectRoot`). Returns { server, token } unstarted-listen-able.
export function createLabServer({ labRoot, projectRoot, allowWrite = false }) {
  const token = randomBytes(24).toString("hex");
  const fsHandler = makeFsHandler(projectRoot, { token, allowWrite });
  const staticHandler = makeHandler(labRoot);
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path.startsWith("/__fs/")) {
      // Stamp the live origin for the CSRF check now that we know the bound port.
      const origin = `http://${req.headers.host}`;
      return makeFsHandler(projectRoot, { token, allowWrite, origin })(req, res);
    }
    // Token-inject the Lab index page; everything else streams straight through.
    if (path === "/lab/" || path === "/lab/index.html") {
      try {
        const html = await readFile(resolve(labRoot, "lab/index.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
        return res.end(injectToken(html, token));
      } catch { /* fall through to static */ }
    }
    return staticHandler(req, res);
  });
  return { server, token, fsHandler };
}

// CLI entry — `node scripts/lab-server.mjs [projectDir] [--write] [--port N]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowWrite = args.includes("--write");
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 0; // 0 → random free port
  const projectDir = resolve(args.find((a) => !a.startsWith("--") && a !== String(port)) || ".");
  const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { server, token } = createLabServer({ labRoot, projectRoot: projectDir, allowWrite });
  server.listen(port, "127.0.0.1", () => {
    const p = server.address().port;
    console.log(`FlatBars Lab (local)  → http://127.0.0.1:${p}/lab/`);
    console.log(`  FS bridge   /__fs/*  jailed to ${projectDir}  (${allowWrite ? "read+write" : "read-only"})`);
    console.log(`  session token: ${token.slice(0, 8)}…  (injected as window.__FB_TOKEN)`);
    console.log("  bound to 127.0.0.1 only · Ctrl-C to stop");
  });
}
