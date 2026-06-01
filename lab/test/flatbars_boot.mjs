// Boot check: load the lab with ?engine=flatbars in headless Brave, assert it
// mounts with FlatBars as the active engine and reports no page errors.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const BROWSER = process.env.STEM_BROWSER || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const MIME = { ".html":"text/html;charset=utf-8", ".mjs":"text/javascript;charset=utf-8", ".js":"text/javascript;charset=utf-8", ".wasm":"application/wasm", ".json":"application/json", ".svg":"image/svg+xml", ".css":"text/css", ".stem":"text/plain", ".yaml":"text/plain", ".jsonata":"text/plain" };
const { server, port } = await new Promise((res) => {
  const s = createServer(async (req, r) => {
    try { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
      const body = await readFile(join(WEB_ROOT, p)); r.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); r.end(body);
    } catch { r.writeHead(404); r.end("nf"); }
  });
  s.listen(0, "127.0.0.1", () => res({ server: s, port: s.address().port }));
});
const url = `http://127.0.0.1:${port}/?engine=flatbars`;
console.log("boot: " + url);
const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, defaultViewport: { width: 1440, height: 900 }, args: ["--no-sandbox","--disable-extensions"] });
let code = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console.error: " + m.text()); });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#brand-ver", { timeout: 10000 });
  const brand = await page.$eval("#brand-ver", (e) => e.textContent);
  console.log("brand-ver:", JSON.stringify(brand));
  await mkdir(resolve(HERE, "screenshots"), { recursive: true });
  await page.screenshot({ path: resolve(HERE, "screenshots", "flatbars-boot.png") });
  const ok = /FlatBars/.test(brand) && errs.length === 0;
  if (errs.length) { console.log("PAGE ERRORS:"); for (const e of errs.slice(0, 8)) console.log("  " + e); }
  console.log(ok ? "\n✓ booted with FlatBars engine, no page errors" : "\n✗ boot check failed");
  code = ok ? 0 : 1;
} catch (e) { console.log("✗ boot threw: " + e.message); code = 2; }
finally { await browser.close(); server.close(); }
process.exit(code);
