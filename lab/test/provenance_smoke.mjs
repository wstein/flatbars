// SPDX-License-Identifier: Apache-2.0
//
// Real-browser smoke test for the source-map provenance UI (ADR-035). Drives a
// headless Brave Browser (Chromium) via puppeteer-core — no bundled Chromium
// download — over a local HTTP server, and confirms the three-way editor↔output
// linking the tiling map drives:
//
//   * boot — the FullBars engine loads with no uncaught console error;
//   * output → source (hover) — hovering an emit run highlights its tag in the
//     template editor (`.cm-link-highlight`) and shows the provenance tooltip;
//   * output → editor (click) — clicking an emit run selects its tag span;
//   * source → output (caret) — placing the caret in the template lights up the
//     output run(s) it produced (`.cm-out-linked`).
//
// The Node-level gate (`check:provenance`) proves the segments tile; this proves
// the browser actually paints and links them. Run from lab/test/:
//
//   npm install
//   node provenance_smoke.mjs                 # uses Brave at the macOS default path
//   FLATBARS_BROWSER=/path/to/chrome node provenance_smoke.mjs   # or any Chromium

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
const URL_ = `http://localhost:${PORT}/lab/index.html?engine=fullbars`;

const browser = await puppeteer.launch({
  executablePath: resolveBrowser(),
  headless: true,
  args: ["--no-sandbox", "--disable-extensions", "--no-first-run", "--disable-gpu"],
});

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error("  ✗ " + msg);
};

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 30000 });

  // boot — the engine resolved and stamped its version into the brand.
  const brand = await page.$eval("#brand-ver", (el) => el.textContent.trim());
  assert.match(brand, /FullBars v\d/, `brand shows the FullBars engine (got "${brand}")`);

  // provenance painted — the default `hello` example ({{name}}) yields emit runs.
  await page.waitForSelector("#output-text .seg-expr", { timeout: 15000 });
  const emitCount = await page.$$eval("#output-text .seg-expr", (els) => els.length);
  assert.ok(emitCount >= 1, `at least one emit run is painted (got ${emitCount})`);
  console.log(`  ✓ boot + provenance — FullBars loaded, ${emitCount} emit run(s) painted`);

  // output → source (hover): the emit run highlights its tag in the editor.
  await page.hover("#output-text .seg-expr");
  await page.waitForSelector(".cm-link-highlight", { timeout: 5000 });
  const tipShown = await page.$eval("#seg-tip", (el) => !el.hasAttribute("hidden"));
  assert.ok(tipShown, "the provenance tooltip is shown on hover");
  console.log("  ✓ hover — emit run highlights its source tag + shows the tooltip");

  // output → editor (click): selects the tag span, focusing the template editor.
  // The editor uses native browser selection (not drawSelection), so the tag shows
  // up as a non-collapsed window selection.
  await page.click("#output-text .seg-expr");
  const selected = await page
    .waitForFunction(
      () => {
        const s = window.getSelection();
        return !!s && !s.isCollapsed && s.toString().length > 0;
      },
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  assert.ok(selected, "clicking an emit run selects its source tag in the editor");
  console.log("  ✓ click — emit run selects its source tag in the editor");

  // source → output (caret): collapse the selection into the tag (the caret lands
  // inside its span) and assert the output run it produced lights up.
  await page.keyboard.press("ArrowLeft");
  const outLinked = await page
    .waitForSelector("#output-text .cm-out-linked", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  assert.ok(outLinked, "a template caret in the tag lights up the output run it produced");
  console.log("  ✓ caret — template caret lights up the output run it produced");

  if (consoleErrors.length) fail("console errors during the run:\n    " + consoleErrors.join("\n    "));
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.error("✗ provenance browser smoke FAILED");
  process.exit(1);
}
console.log("✓ provenance browser smoke — three-way linking works in a real browser");
