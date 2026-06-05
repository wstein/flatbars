#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// A tiny static file handler for the FlatBars Lab — used two ways:
//   * `npm run lab` runs it as a standalone server over the repo root (Lab at /lab/);
//   * the Astro tutorials dev server imports `makeHandler` to mount the Lab at /lab/
//     on its own origin, so "Open in Lab" works with no second server.
//
// The Lab needs HTTP (ES-module imports + fetch — file:// won't work) and correct
// MIME (.mjs must be text/javascript, .wasm application/wasm, or browsers refuse
// the module / streaming compile).
//
//   npm run lab            # → http://localhost:8000/lab/   (PORT=4000 to change)
//
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, extname, join, sep } from "node:path";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonc": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".hbs": "text/plain; charset=utf-8",
  ".stem": "text/plain; charset=utf-8",
  ".rawbars": "text/plain; charset=utf-8",
  ".mustache": "text/plain; charset=utf-8",
  ".maxbars": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
};

// A Connect-style static handler serving files under `root`. On a missing file
// it calls `next()` when chained as middleware (so the host server can take over),
// otherwise it sends 404. Resolves under `root` and rejects traversal escapes.
export function makeHandler(rootDir) {
  const root = resolve(rootDir);
  return (req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400);
      res.end("bad request");
      return;
    }
    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    try {
      if (statSync(file).isDirectory()) {
        // Redirect /dir → /dir/ so the page's relative imports (./x) resolve under
        // it; without the trailing slash the browser resolves them against the
        // parent (the cause of /lab → /stem.mjs 404s). Use the original (un-stripped)
        // URL so this is correct when mounted as middleware.
        const orig = req.originalUrl
          ? new URL(req.originalUrl, "http://localhost").pathname
          : pathname;
        if (!orig.endsWith("/")) {
          res.writeHead(301, { location: orig + "/" });
          res.end();
          return;
        }
        file = join(file, "index.html");
      }
    } catch { /* fall through to the read error */ }

    const stream = createReadStream(file);
    stream.on("open", () => {
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      stream.pipe(res);
    });
    stream.on("error", () => {
      if (typeof next === "function") return next();
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404 not found: ${pathname}`);
    });
  };
}

// Run as a standalone server only when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const PORT = Number(process.env.PORT) || 8000;
  createServer(makeHandler(ROOT)).listen(PORT, () => {
    console.log(`FlatBars Lab  → http://localhost:${PORT}/lab/`);
    console.log(`(serving ${ROOT}; Ctrl-C to stop)`);
  });
}
