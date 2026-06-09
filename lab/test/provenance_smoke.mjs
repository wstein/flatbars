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

  // context inspector: clicking the emit (above) also set the inspect target and
  // opened the dock tab, which snapshots the render context at that span.
  const ctxShown = await page
    .waitForSelector(".ctx-snap", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  assert.ok(ctxShown, "the Context Inspector renders a render-context snapshot for the clicked run");
  console.log("  ✓ context — clicking an emit shows its render-context snapshot");

  // source → output (caret): collapse the selection into the tag (the caret lands
  // inside its span) and assert the output run it produced lights up.
  await page.keyboard.press("ArrowLeft");
  const outLinked = await page
    .waitForSelector("#output-text .cm-out-linked", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  assert.ok(outLinked, "a template caret in the tag lights up the output run it produced");
  console.log("  ✓ caret — template caret lights up the output run it produced");

  // ── Data Access: real positions + jump-to-source (the 1:1 regression) ──
  // The lowered AST now carries each node's opening-tag span, so the panel
  // reports the true file:line:column instead of the old 1:1 fallback, and a row
  // click moves the template caret there. Switch to the multi-line "card"
  // example, whose `{{#each people}}` (line 2) gives a `people` lookup at line 2.
  await page.click("#example-trigger");
  await page.waitForSelector("#example-menu li.dropdown-item", { visible: true });
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("#example-menu li.dropdown-item"))
      .find((el) => /html card/i.test(el.textContent || ""))?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const dock = document.querySelector("#dock");
    if (!dock || dock.hidden) document.querySelector("#dock-toggle")?.click();
  });
  await page.click('#dock-tabs button[data-tab="data-access"]');
  await page.waitForSelector("#dock-body .dx-row .dx-where", { timeout: 5000 });
  const rows = await page.$$eval("#dock-body .dx-row", (els) =>
    els.map((r) => ({
      status: r.querySelector(".dx-status")?.textContent || "",
      where: r.querySelector(".dx-where")?.textContent || "",
    })),
  );
  const wheres = rows.map((r) => r.where);
  assert.ok(rows.length > 0, "Data Access lists lookup rows");
  assert.ok(
    wheres.some((w) => !/:1:1$/.test(w)),
    `Data Access reports real positions, not the 1:1 fallback (got ${wheres.join(", ")})`,
  );
  console.log(`  ✓ data access — ${rows.length} row(s) at real positions (${wheres.join(", ")})`);

  // The card partial is mounted inside `{{#each people}}`, so its bare
  // `name`/`role`/`lead` are element fields — they must read "scoped", not a
  // false "miss" against the root dictionary. `people` (in main) stays a hit.
  const cardRows = rows.filter((r) => /^card:/.test(r.where));
  assert.ok(cardRows.length > 0, "the card partial contributes lookup rows");
  assert.ok(
    cardRows.every((r) => r.status === "scoped"),
    `partial-body lookups are scoped, not miss (got ${JSON.stringify(cardRows)})`,
  );
  assert.equal(
    rows.find((r) => /^main:/.test(r.where))?.status,
    "hit",
    "the main-file `people` lookup is still root-classified as a hit",
  );
  console.log(`  ✓ partial scope — ${cardRows.length} card lookup(s) read "scoped", not "miss"`);

  // Jump-to-source: click a main-file row past line 1 and assert the template
  // editor's active line follows.
  const jumpWhere = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("#dock-body .dx-row")).find((r) => {
      const m = (r.querySelector(".dx-where")?.textContent || "").match(/^main:(\d+):/);
      return m && Number(m[1]) > 1;
    });
    if (!row) return null;
    const w = row.querySelector(".dx-where").textContent;
    row.click();
    return w;
  });
  assert.ok(jumpWhere, "a main-file lookup past line 1 exists to jump to");
  await new Promise((r) => setTimeout(r, 250));
  const wantLine = jumpWhere.match(/^main:(\d+):/)[1];
  const gutterLine = await page
    .$eval("#template-editor-container .cm-activeLineGutter", (g) => (g.textContent || "").trim())
    .catch(() => null);
  assert.equal(
    gutterLine,
    wantLine,
    `jump-to-source moved the template caret to line ${wantLine} (active gutter=${gutterLine})`,
  );
  console.log(`  ✓ jump-to-source — clicking ${jumpWhere} moved the template caret to line ${wantLine}`);

  if (consoleErrors.length) fail("console errors during the run:\n    " + consoleErrors.join("\n    "));

  // boot defence: a missing asset shows a visible overlay, not a blank page. Fail
  // the examples catalog fetch and assert the `.boot-error` banner appears.
  const badPage = await browser.newPage();
  await badPage.setRequestInterception(true);
  badPage.on("request", (req) =>
    req.url().endsWith("examples.json") ? req.respond({ status: 404, body: "nope" }) : req.continue(),
  );
  await badPage.goto(URL_, { waitUntil: "domcontentloaded", timeout: 30000 });
  const overlay = await badPage
    .waitForSelector(".boot-error", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  assert.ok(overlay, "a missing example catalog shows the boot-error overlay (not a blank page)");
  console.log("  ✓ boot defence — a missing asset shows a visible error, not a blank page");
  await badPage.close();
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
