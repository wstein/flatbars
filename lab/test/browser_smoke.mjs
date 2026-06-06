// SPDX-License-Identifier: Apache-2.0
//
// Real-browser smoke test for the playground dock panels.
// Drives a headless Brave Browser (Chromium) via puppeteer-core — no bundled
// Chromium download. Loads the playground over a local HTTP server, walks
// every dock tab in order, asserts the panel renders content, and captures
// a screenshot per tab into ./screenshots/.
//
// Run from native/web/test/:
//
//   npm install
//   node browser_smoke.mjs
//
// Or from the repo root:
//
//   node --prefix native/web/test browser_smoke.mjs       # not supported
//   ( cd native/web/test && node browser_smoke.mjs )      # supported

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const SCREENSHOT_DIR = resolve(HERE, "screenshots");

// Resolve a Chromium-family browser executable. Local devs default to Brave
// at the standard macOS path; CI sets STEM_BROWSER (or the conventional
// `CHROME_BIN`) to wherever the runner's pre-installed Chrome lives. The
// fallback list is OS-dependent so neither side needs to set anything.
function resolveBrowser() {
  const explicit = process.env.STEM_BROWSER || process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  if (explicit) return explicit;
  if (process.platform === "darwin") {
    return "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  }
  // Linux: GitHub Actions ubuntu runners pre-install google-chrome here.
  return "/usr/bin/google-chrome";
}
const BROWSER = resolveBrowser();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".stem": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".jsonata": "text/plain; charset=utf-8",
};

// A small static file server scoped to native/web. Returns 404 cleanly so
// puppeteer doesn't choke on a missing asset.
function startServer(root) {
  return new Promise((resolveFn, rejectFn) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === "/") pathname = "/index.html";
        const filePath = join(root, pathname);
        if (!filePath.startsWith(root)) {
          res.writeHead(403); res.end("forbidden"); return;
        }
        const body = await readFile(filePath);
        const type = MIME[extname(filePath)] || "application/octet-stream";
        res.writeHead(200, { "content-type": type });
        res.end(body);
      } catch {
        res.writeHead(404); res.end("not found");
      }
    });
    server.on("error", rejectFn);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveFn({ server, port });
    });
  });
}

// The dock panels the DEFAULT engine (FullBars) advertises. Whitespace (the
// `trim` panel, gated on the `standalone` capability) is Stem-only and is not
// shown under FullBars, so it is not asserted here.
const PANELS = [
  { id: "problems",     label: "Problems" },
  { id: "transformers", label: "Transformers" },
  { id: "data-access",  label: "Data Access" },
  { id: "partials",     label: "Partials" },
  { id: "capabilities", label: "Capabilities" },
  { id: "perf",         label: "Performance" },
  { id: "coverage",     label: "Coverage" },
];

const ASSERTIONS = [];
function check(label, ok, detail = "") {
  ASSERTIONS.push({ label, ok, detail });
  console.log(`  ${ok ? "ok " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("browser-smoke: starting local server");
const { server, port } = await startServer(WEB_ROOT);
const playgroundUrl = `http://127.0.0.1:${port}/`;
console.log(`browser-smoke: serving ${WEB_ROOT} at ${playgroundUrl}`);

console.log(`browser-smoke: launching ${BROWSER}`);
const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  args: [
    "--no-sandbox",
    "--disable-extensions",
    "--disable-features=PrivacySandboxAdsAPIs",
  ],
});

let exitCode = 0;
try {
  const page = await browser.newPage();
  // Surface page console errors to the test output — a JS-side regression
  // (e.g. a broken Preact mount or an undefined function in a renderer)
  // shows up here.
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
  });

  console.log("browser-smoke: loading playground");
  await page.goto(playgroundUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // Pick a representative example so every panel has interesting content to
  // render. "Real-world - profile cards" exercises each-loops, partials, and
  // conditionals — the heaviest workout in the FullBars (handlebars) example set.
  await page.waitForSelector("#example-trigger", { visible: true });
  await page.click("#example-trigger");
  await page.waitForSelector("#example-menu li.dropdown-item", { visible: true });
  const picked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#example-menu li.dropdown-item"));
    const item = items.find((el) => /profile cards/i.test(el.textContent || ""));
    if (item) { item.click(); return item.textContent; }
    return null;
  });
  check("loaded the profile-cards example", !!picked, picked || "no matching menu item");
  // Wait for the run loop to finish: the dock toggle becomes pressed once
  // there's at least one populated panel, and segments tile the output.
  await new Promise((r) => setTimeout(r, 800));

  // Open the dock if it's not already.
  await page.evaluate(() => {
    const dock = document.querySelector("#dock");
    if (!dock || dock.hidden) document.querySelector("#dock-toggle")?.click();
  });
  await page.waitForSelector("#dock", { visible: true });

  await mkdir(SCREENSHOT_DIR, { recursive: true });

  // For each panel: click its tab, wait for the body to repaint, assert a
  // non-empty body, capture a screenshot of the dock.
  for (const panel of PANELS) {
    const tabSel = `#dock-tabs button[data-tab="${panel.id}"]`;
    const tab = await page.$(tabSel);
    check(`tab "${panel.label}" exists`, !!tab);
    if (!tab) continue;
    await tab.click();
    // The dock body re-renders on click; give it a tick.
    await new Promise((r) => setTimeout(r, 120));
    const dockHandle = await page.$("#dock");
    const body = await page.evaluate(() => {
      const b = document.querySelector("#dock-body");
      return { text: b?.textContent || "", childCount: b?.children.length || 0 };
    });
    check(`panel "${panel.label}" has content`,
      body.text.trim().length > 0 || body.childCount > 0,
      `${body.childCount} children, ${body.text.length} chars`);
    const file = join(SCREENSHOT_DIR, `dock-${panel.id}.png`);
    await dockHandle.screenshot({ path: file });
    console.log(`  saved ${file}`);
  }

  // Data overlay end-to-end — load the Hello World example, add an overlay
  // named `name` whose body is `Overlay`, and assert the rendered output picks
  // up the overlay value (the greeting template emits `{{name}}`, so the
  // override should appear in the preview).
  await page.click("#example-trigger");
  await page.waitForSelector("#example-menu li.dropdown-item", { visible: true });
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#example-menu li.dropdown-item"));
    const item = items.find((el) => /hello world/i.test(el.textContent || ""));
    if (item) item.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  // New IDE layout: overlays are created via the Explorer's OVERLAYS group
  // `＋` adder, not a tab strip. The headers are `.exp-gh` (each carries a
  // `.exp-glabel` for the group name, plus `.exp-add` on addable groups);
  // the rows below are `.exp-row`.
  await page.waitForSelector("#explorer .exp-gh", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  const addedOverlay = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("#explorer .exp-gh"));
    const overlaysHeader = headers.find((h) =>
      /OVERLAYS/i.test(h.querySelector(".exp-glabel")?.textContent || "")
    );
    const add = overlaysHeader?.querySelector(".exp-add");
    if (add) { add.click(); return true; }
    return false;
  });
  check("overlay add button clicked", addedOverlay);
  await new Promise((r) => setTimeout(r, 300));
  // `addOverlay` (and `addPartial`) now auto-open the new row's inline-rename
  // input in the explorer, so the user lands ready to name. The smoke just
  // types into the input and commits with Enter — no explicit dblclick needed.
  const renamedOk = await page.evaluate(() => {
    const input = document.querySelector("#explorer .exp-rename");
    if (!input) return false;
    input.focus();
    input.value = "";
    for (const ch of "name") {
      input.value += ch;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Commit via Enter.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  });
  check("overlay renamed to `name`", renamedOk);
  await new Promise((r) => setTimeout(r, 300));
  // The design uses two editor containers swapped per file kind: template
  // (#template-editor-container) and data/overlay/config (#data-editor-container).
  // After renaming the new overlay, the data editor is the visible one.
  await page.click("#data-editor-container .cm-content");
  await page.keyboard.type("Overlay");
  await new Promise((r) => setTimeout(r, 500));
  const overlayApplied = await page.evaluate(() => {
    const frame = document.querySelector("#output-preview");
    if (!frame) return null;
    // Read the iframe's `srcdoc` attribute (always same-origin readable) rather
    // than contentDocument: the rendered preview runs in an `allow-scripts`
    // (null-origin) sandbox when "Allow scripts" is on — the default — which makes
    // contentDocument cross-origin and unreadable. srcdoc carries the same HTML.
    return frame.getAttribute("srcdoc") || "";
  });
  // The greeting template is `Hello, {{name}}!` with data `name: Ada`.
  // After mounting overlay `name` = "Overlay", the render should swap to
  // `Hello, Overlay!` — proves the overlay merge actually fires and the
  // type-clash diagnostic does NOT cause an abort (scalar→scalar replaces
  // silently per Phase 1 semantics).
  check("overlay value reaches the rendered output",
    typeof overlayApplied === "string" && overlayApplied.includes("Hello, Overlay!"),
    overlayApplied ? overlayApplied.slice(0, 60) : "no preview body");
  // Editing the overlay marks it modified-from-default; the Explorer highlights
  // such files (amber name + an "M" marker, class `mod` on the row). Assert the
  // `name.yaml` overlay row picked up the highlight after the edit above.
  const overlayHighlighted = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#explorer .exp-row"));
    const row = rows.find((r) => /^name\.yaml$/.test(r.querySelector(".exp-name")?.textContent || ""));
    return !!row && row.classList.contains("mod") && !!row.querySelector(".exp-m");
  });
  check("modified overlay is highlighted in the Explorer", overlayHighlighted);
  // Capture an overlays screenshot for the docs.
  await page.screenshot({ path: join(SCREENSHOT_DIR, "playground-overlays.png") });

  // Renaming an *existing* file is keyboard-driven now (no double-click): focus
  // its Explorer row and press the rename key (F2 on Windows/Linux, Enter on
  // macOS; F2 also works on macOS). Assert F2 on the focused overlay row opens
  // the inline-rename input, then cancel with Escape so the name stays `name`.
  const f2Renamed = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#explorer .exp-row"));
    const row = rows.find((r) => /^name\.yaml$/.test(r.querySelector(".exp-name")?.textContent || ""));
    if (!row) return false;
    row.focus();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    return !!document.querySelector("#explorer .exp-rename");
  });
  check("F2 on a focused overlay row opens inline rename", f2Renamed);
  await new Promise((r) => setTimeout(r, 100));
  // Escape must actually CLOSE the rename input (the editor must not immediately
  // reopen via renderExplorer's mid-edit capture) and leave the name unchanged.
  const escClosed = await page.evaluate(() => {
    const input = document.querySelector("#explorer .exp-rename");
    if (!input) return false;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return !document.querySelector("#explorer .exp-rename");
  });
  check("Escape closes (cancels) the inline rename", escClosed);
  await new Promise((r) => setTimeout(r, 150));
  const nameKept = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#explorer .exp-name"))
      .some((n) => /^name\.yaml$/.test(n.textContent || "")));
  check("cancelled rename keeps the original name", nameKept);
  await new Promise((r) => setTimeout(r, 100));
  // Regression (recursion): a partial's inline rename keeps the rename input
  // FOCUSED (addPartial uses showActiveTab, which — unlike overlays — does not
  // move focus to the code editor). The debounced run() that follows then fires
  // a renderExplorer rebuild that tears down a still-focused input, whose blur
  // used to commit + re-render → renderExplorer → finish → blur → … until the
  // stack overflowed. The end-of-run "no browser errors" gate catches it.
  const partialAdded = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("#explorer .exp-gh"))
      .find((x) => /PARTIALS/i.test(x.querySelector(".exp-glabel")?.textContent || ""));
    const add = h?.querySelector(".exp-add");
    if (!add) return false;
    add.click();
    return true;
  });
  check("partial add button clicked", partialAdded);
  // Wait out the debounced run() so its rebuild lands while the input is focused.
  await new Promise((r) => setTimeout(r, 600));
  const partialRenameSurvived = await page.evaluate(() => {
    const input = document.querySelector("#explorer .exp-rename");
    const alive = !!input; // page is responsive and the edit survived the rebuild
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return alive;
  });
  check("partial inline-rename survives a re-render without recursing", partialRenameSurvived);
  await new Promise((r) => setTimeout(r, 150));
  // Regression: ＋ overlay then Enter to ACCEPT THE DEFAULT name must CLOSE the
  // inline edit. The unchanged name used to re-arm renderExplorer's reopen, so
  // the editor sprang straight back open and Enter looked like it did nothing.
  const overlay2Added = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("#explorer .exp-gh"))
      .find((x) => /OVERLAYS/i.test(x.querySelector(".exp-glabel")?.textContent || ""));
    const add = h?.querySelector(".exp-add");
    if (!add) return false;
    add.click();
    return true;
  });
  check("second overlay add button clicked", overlay2Added);
  await new Promise((r) => setTimeout(r, 350)); // let the auto-open dance settle
  const enterAcceptedDefault = await page.evaluate(() => {
    const input = document.querySelector("#explorer .exp-rename");
    if (!input) return false;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  });
  check("Enter pressed on the default overlay name", enterAcceptedDefault);
  await new Promise((r) => setTimeout(r, 250));
  const defaultNameClosed = await page.evaluate(() =>
    !document.querySelector("#explorer .exp-rename"));
  check("Enter accepting the default name closes the inline rename", defaultNameClosed);
  await new Promise((r) => setTimeout(r, 100));

  // Also capture the whole playground in its final state — the dock open
  // on the last clicked tab, the editor showing the profile-cards example, the
  // rendered preview alive — as an "overview" screenshot.
  await page.click("#example-trigger");
  await page.waitForSelector("#example-menu li.dropdown-item", { visible: true });
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#example-menu li.dropdown-item"));
    const item = items.find((el) => /profile cards/i.test(el.textContent || ""));
    if (item) item.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: join(SCREENSHOT_DIR, "playground-overview.png") });
  console.log(`  saved ${join(SCREENSHOT_DIR, "playground-overview.png")}`);

  // A page-level error during the panel walk is a fail — print every one,
  // not just the first.
  for (const err of consoleErrors) check(`no browser error: ${err}`, false);
  if (consoleErrors.length === 0) check("no browser errors during the run", true);

  const failed = ASSERTIONS.filter((a) => !a.ok);
  if (failed.length) {
    console.error(`\nbrowser-smoke: ${failed.length}/${ASSERTIONS.length} assertions failed`);
    exitCode = 1;
  } else {
    console.log(`\nbrowser-smoke: ${ASSERTIONS.length}/${ASSERTIONS.length} assertions pass`);
  }

  // Write a small manifest so a CI consumer (or `git diff`) can see at a
  // glance which panels were captured and how big each screenshot is.
  const manifest = {
    capturedAt: new Date().toISOString(),
    panels: PANELS.map((p) => ({ id: p.id, label: p.label, file: `screenshots/dock-${p.id}.png` })),
    overview: "screenshots/playground-overview.png",
  };
  await writeFile(
    join(SCREENSHOT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);
