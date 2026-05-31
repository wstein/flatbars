// SPDX-License-Identifier: Apache-2.0
//
// Cross-engine compare smoke test (Brace Lab). Loads compare.html in headless
// Brave, lets all three adapters (Handlebars, Stem, BareBars) render the default
// shared template, and asserts: every engine loads and renders without a page
// error, and BareBars' surface output matches Handlebars (its compatibility
// target). Stem may differ (its iteration semantics) — that divergence is the
// point of the view, so it is reported, not asserted.
//
// Run from native/web/test/:  node compare_smoke.mjs   (or set STEM_BROWSER)

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = resolve(HERE, "..");
const BROWSER = process.env.STEM_BROWSER || process.env.CHROME_BIN ||
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css" };

const { server, port } = await new Promise((res) => {
  const s = createServer(async (q, r) => {
    try {
      let p = decodeURIComponent(new URL(q.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const b = await readFile(join(WEB, p));
      r.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
      r.end(b);
    } catch { r.writeHead(404); r.end("nf"); }
  });
  s.listen(0, "127.0.0.1", () => res({ server: s, port: s.address().port }));
});

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ["--no-sandbox", "--disable-extensions"] });
let code = 0;
const ASSERT = [];
const check = (label, ok, detail = "") => { ASSERT.push(ok); console.log(`  ${ok ? "ok " : "FAIL"} ${label}${detail ? " — " + detail : ""}`); };

try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/compare.html`, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction("window.__braceLabCompareReady === true", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));

  const res = await page.evaluate(() => {
    const out = (id) => document.getElementById("out-" + id).textContent;
    const st = (id) => document.getElementById("st-" + id).className.includes("ok");
    const ver = (id) => document.getElementById("ver-" + id).textContent;
    return {
      agree: document.getElementById("agree").textContent,
      engines: ["handlebars", "stem", "barebars"].map((id) => ({ id, out: out(id), ok: st(id), ver: ver(id) })),
    };
  });

  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  for (const e of res.engines) check(`${e.id} renders${e.ver}`, e.ok, JSON.stringify(e.out).slice(0, 60));
  const hbs = res.engines.find((e) => e.id === "handlebars");
  const bb = res.engines.find((e) => e.id === "barebars");
  check("BareBars surface output matches Handlebars", hbs.out === bb.out);
  console.log(`  info: agreement = ${JSON.stringify(res.agree)} (Stem may differ by design)`);

  await mkdir(resolve(HERE, "screenshots"), { recursive: true });
  await page.screenshot({ path: resolve(HERE, "screenshots", "compare.png") });
  code = ASSERT.every(Boolean) ? 0 : 1;
} catch (e) {
  console.log("compare-smoke threw: " + e.message);
  code = 2;
} finally {
  await browser.close();
  server.close();
}
console.log(code === 0 ? "\n✓ cross-engine compare smoke passed" : "\n✗ cross-engine compare smoke failed");
process.exit(code);
