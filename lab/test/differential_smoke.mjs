// SPDX-License-Identifier: Apache-2.0
//
// Differential panel browser smoke (Phase 7) — boots the hosted Lab in MaxBars, opens
// the Differential dock tab, and confirms the panel runs the current template through
// BOTH real engines in-browser (the PureScript oracle + the trussbars-wasm shipping
// engine) and shows a directional verdict for the Trussbars candidate. Opt-in (needs a
// Chromium-family browser); not in `npm test`.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { makeHandler } from "../../scripts/serve-lab.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../..");

function resolveBrowser() {
  const explicit = process.env.FLATBARS_BROWSER || process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  if (explicit) return explicit;
  if (process.platform === "darwin") return "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  return "/usr/bin/google-chrome";
}

const server = createServer(makeHandler(ROOT));
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const URL_ = `http://localhost:${PORT}/lab/index.html?engine=maxbars`;

const browser = await puppeteer.launch({
  executablePath: resolveBrowser(),
  headless: true,
  args: ["--no-sandbox", "--disable-extensions", "--no-first-run", "--disable-gpu"],
});

let failed = false;
const fail = (msg) => { failed = true; console.error("  ✗ " + msg); };

const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#output-text", { timeout: 15000 });

  // Open the dock + the Differential tab (gated visible: oracle + trussbars registered).
  await page.evaluate(() => {
    const dock = document.getElementById("dock");
    if (dock && dock.hidden) document.getElementById("dock-toggle")?.click();
  });
  await page.waitForSelector('.dock-tab[data-tab="differential"]', { timeout: 10000 });
  await page.click('.dock-tab[data-tab="differential"]');
  console.log("  ✓ tab — the Differential panel is registered + opens");

  // The async compare runs both engines (trussbars-wasm instantiates here) and paints
  // the reference header + a Trussbars candidate row with a verdict.
  await page.waitForSelector(".diff-head", { timeout: 15000 });
  const verdict = await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll(".diff-row")];
      const truss = rows.find((r) => /Trussbars/.test(r.textContent));
      if (!truss) return null;
      if (truss.className.includes("diff-match")) return "match";
      if (truss.className.includes("diff-diverge")) return "diverge";
      if (truss.className.includes("diff-na")) return "na";
      return null;
    },
    { timeout: 15000 },
  ).then((h) => h.jsonValue()).catch(() => null);
  assert.ok(verdict, "the Trussbars candidate row painted with a verdict");
  console.log(`  ✓ compare — oracle (reference) vs Trussbars (candidate): verdict "${verdict}"`);

  const refShown = await page.$eval(".diff-ref-label", (el) => /Reference/.test(el.textContent)).catch(() => false);
  assert.ok(refShown, "the oracle is labelled the reference engine");
  console.log("  ✓ directional — oracle is the green reference, Trussbars the candidate");

  assert.equal(errors.length, 0, `no page errors (saw: ${errors.join(" | ")})`);
} catch (e) {
  fail(e && e.message ? e.message : String(e));
  if (errors.length) console.error("  page errors:\n   " + errors.join("\n   "));
} finally {
  await browser.close();
  server.close();
}

if (failed) { console.error("✗ differential smoke FAILED"); process.exit(1); }
console.log("✓ differential smoke — the multi-engine compare runs in a real browser");
