// SPDX-License-Identifier: Apache-2.0
//
// Local-mode browser smoke (Phase 6) — boots the `trussbars lab` transport
// (createLabServer) over a temp project directory and drives the real Lab in headless
// Brave to confirm: it enters PROJECT MODE off the injected fb-transport meta, renders
// the on-disk template against the on-disk data, surfaces the cross-tree partial, and
// RE-RENDERS ON SAVE when a file changes on disk. Opt-in (needs a Chromium-family
// browser); not in `npm test`. Set FLATBARS_BROWSER to override the binary.

import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { createLabServer } from "../../scripts/lab-server.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../..");

function resolveBrowser() {
  const explicit = process.env.FLATBARS_BROWSER || process.env.CHROME_BIN || process.env.CHROMIUM_BIN;
  if (explicit) return explicit;
  if (process.platform === "darwin") return "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  return "/usr/bin/google-chrome";
}

// A temp project: an entry template that pulls a partial, plus JSON data.
const project = await mkdtemp(join(tmpdir(), "fb-proj-"));
await writeFile(join(project, "index.hbs"), "Greeting: {{name}} {{> cards/badge}}");
await mkdir(join(project, "cards"));
await writeFile(join(project, "cards", "badge.hbs"), "<{{role}}>");
await writeFile(join(project, "data.json"), '{"name":"Ada","role":"admin"}');

const { server, token } = createLabServer({ labRoot: ROOT, projectRoot: project });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const URL_ = `http://127.0.0.1:${PORT}/lab/?engine=classicbars`;

const browser = await puppeteer.launch({
  executablePath: resolveBrowser(),
  headless: true,
  args: ["--no-sandbox", "--disable-extensions", "--no-first-run", "--disable-gpu"],
});

let failed = false;
const fail = (msg) => { failed = true; console.error("  ✗ " + msg); };

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // domcontentloaded (not networkidle0): the watch SSE holds a connection open, so the
  // network never idles. We wait on explicit selectors below.
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 30000 });

  // It entered PROJECT MODE: the example label reflects the launch dir.
  const label = await page.waitForFunction(
    () => { const el = document.querySelector("#example-label, #ex-label, [data-example-label]"); return el && /Project/.test(el.textContent) ? el.textContent : null; },
    { timeout: 15000 },
  ).then((h) => h.jsonValue()).catch(() => null);
  assert.ok(label, "the Lab entered project mode (label shows 'Project ·')");
  console.log(`  ✓ project mode — ${label.trim()}`);

  // It rendered the on-disk template against the on-disk data, partial included.
  await page.waitForFunction(() => /Greeting: Ada/.test(document.querySelector("#output-text")?.textContent || ""), { timeout: 15000 });
  const out1 = await page.$eval("#output-text", (el) => el.textContent);
  assert.match(out1, /Greeting: Ada <admin>/, `renders template + data + partial (got "${out1}")`);
  console.log("  ✓ render — on-disk template + data + cross-tree partial rendered");

  // RENDER ON SAVE: change the entry template on disk; the watch stream reloads + re-runs.
  await writeFile(join(project, "index.hbs"), "Hello {{name}}! role={{role}}");
  const out2 = await page.waitForFunction(
    () => { const t = document.querySelector("#output-text")?.textContent || ""; return /Hello Ada! role=admin/.test(t) ? t : null; },
    { timeout: 15000 },
  ).then((h) => h.jsonValue()).catch(() => null);
  assert.ok(out2, "the output re-rendered after the on-disk template changed (render-on-save)");
  console.log("  ✓ render-on-save — editing the file on disk re-rendered the output");

  assert.equal(errors.length, 0, `no page errors (saw: ${errors.join(" | ")})`);
} catch (e) {
  fail(e && e.message ? e.message : String(e));
} finally {
  await browser.close();
  server.close();
  await rm(project, { recursive: true, force: true });
}

if (failed) { console.error("✗ local project smoke FAILED"); process.exit(1); }
console.log("✓ local project smoke — project mode + render-on-save work in a real browser");
