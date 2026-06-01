#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// A tiny static server for playing with the FlatBars Lab locally. The Lab needs
// HTTP (ES-module imports + fetch — file:// won't work) and correct MIME types
// (.mjs must be text/javascript, .wasm application/wasm, or browsers refuse the
// module/streaming compile). It serves the repo root, so the Lab is at /lab/ and
// the tutorial "Open in Lab" deep-links (/lab/index.html#…) resolve on one origin.
//
//   npm run lab            # → http://localhost:8000/lab/
//   PORT=4000 npm run lab
//
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, join, sep } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
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
  ".yaml": "text/plain; charset=utf-8",
};

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  // Resolve under ROOT and reject any traversal escape.
  let file = resolve(ROOT, "." + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
  } catch { /* fall through to the read error below */ }

  const stream = createReadStream(file);
  stream.on("open", () => {
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    stream.pipe(res);
  });
  stream.on("error", () => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`404 not found: ${pathname}`);
  });
}).listen(PORT, () => {
  console.log(`FlatBars Lab  → http://localhost:${PORT}/lab/`);
  console.log(`(serving ${ROOT}; Ctrl-C to stop)`);
});
