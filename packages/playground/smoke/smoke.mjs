// Headless smoke test for the BareBars playground.
//
// Serves the built dist/ over HTTP (ES modules + iframe srcdoc need http, not
// file://), drives it with puppeteer-core against a locally installed Brave,
// and asserts the Halogen app mounted and rendered. Exits non-zero on failure.
//
//   npm --workspace packages/playground run smoke
//
// Override the browser with BRAVE_PATH=/path/to/browser.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "..", "dist");

const braveCandidates = [
  process.env.BRAVE_PATH,
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/brave-browser",
  "/usr/bin/brave",
].filter(Boolean);
const exe = braveCandidates.find(existsSync);
if (!exe) {
  console.error("smoke: no Brave browser found. Set BRAVE_PATH=/path/to/brave.");
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  if (path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const buf = await readFile(join(dist, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const fail = (msg) => {
  console.error("smoke: FAIL —", msg);
  process.exitCode = 1;
};

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/index.html`;

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  // Uncaught JS exceptions are fatal; benign resource-load chatter is not.
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on(
    "console",
    (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text())
  );

  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(".wm", { timeout: 5000 });

  const wm = await page.$eval(".wm", (el) => el.textContent.trim());
  const tabs = await page.$$eval(".tabs button", (els) => els.map((e) => e.textContent));
  const hasIframe = (await page.$("iframe.preview")) !== null;
  const status = await page.$eval("footer.status", (el) => el.textContent);

  if (errors.length) fail(`page errors: ${errors.slice(0, 3).join(" | ")}`);
  if (!/playground/i.test(wm)) fail(`brand text unexpected: ${JSON.stringify(wm)}`);
  const wantTabs = ["Rendered", "HTML", "Parse tree", "Real AST", "Validation"];
  if (!wantTabs.every((t) => tabs.includes(t))) fail(`tabs missing: got ${JSON.stringify(tabs)}`);
  if (!hasIframe) fail("rendered-preview iframe not found");
  if (!/valid against prelude schema/.test(status)) fail(`status not clean: ${JSON.stringify(status)}`);

  // Geometry: header at the top, footer below the editors — catches a broken
  // (e.g. inverted) layout that "mounted" but is positioned wrong.
  const box = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().top);
  const vh = await page.evaluate(() => window.innerHeight);
  const headerTop = await box("header.bar");
  const footerTop = await box("footer.status");
  if (headerTop > 80) fail(`header not at top (top=${headerTop})`);
  if (footerTop < vh / 2) fail(`footer not in lower half (top=${footerTop}, vh=${vh})`);
  if (headerTop >= footerTop) fail(`header/footer order wrong (header=${headerTop}, footer=${footerTop})`);

  // Switch to the Validation tab and confirm the default example validates.
  const vIdx = tabs.indexOf("Validation");
  await page.$$eval(".tabs button", (els, i) => els[i].click(), vIdx);
  await page.waitForSelector(".issues .none", { timeout: 5000 }).catch(() =>
    fail("validation view did not show a clean result")
  );

  // Tree views: load the conditional example and confirm the Parse tree and
  // Real AST expand expressions into an indented tree (App/Lit on their own
  // lines, RIf with labelled then/else branches), not a single dense line.
  await page.select("select", "conditional");
  const treeText = async (tabLabel) => {
    const i = (await page.$$eval(".tabs button", (e) => e.map((b) => b.textContent))).indexOf(tabLabel);
    await page.$$eval(".tabs button", (els, idx) => els[idx].click(), i);
    await page.waitForSelector("pre.code", { timeout: 5000 });
    return page.$eval("pre.code", (el) => el.textContent);
  };
  const parseTree = await treeText("Parse tree");
  if (!/(^|\n) {2}App "lookup"\n {4}App "this" \[\]/.test(parseTree))
    fail(`Parse tree not expanded as a tree: ${JSON.stringify(parseTree.slice(0, 160))}`);
  const realAst = await treeText("Real AST");
  if (!/(^|\n)RIf\n {2}App "lookup"/.test(realAst) || !/\n {2}then:\n/.test(realAst) || !/\n {2}else:\n/.test(realAst))
    fail(`Real AST not expanded with RIf/then/else: ${JSON.stringify(realAst.slice(0, 160))}`);

  // Truthiness example: 0 is falsy in both engines (parity), and the
  // includeZero row flips it to truthy — proving the engine computed both the
  // default verdict and the includeZero option live.
  await page.select("select", "truthiness");
  const truthHtml = await treeText("HTML");
  if (!/number 0<\/td><td>falsy<\/td><td>falsy<\/td>/.test(truthHtml))
    fail(`Truthiness: 0 should be falsy in both: ${JSON.stringify(truthHtml.slice(0, 200))}`);
  if (!/0 \+ includeZero<\/td><td>truthy<\/td>/.test(truthHtml))
    fail(`Truthiness: includeZero should make 0 truthy: ${JSON.stringify(truthHtml.slice(0, 200))}`);

  // Lint wiring: typing an if-condition headed by `safe` surfaces the
  // "testing an escaped/safe value" warning in the Validation tab.
  await page.$eval("textarea", (el) => {
    el.value = '{{#if (safe (lookup this "x"))}}y{{/if}}';
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const valIdx = (await page.$$eval(".tabs button", (e) => e.map((b) => b.textContent))).indexOf("Validation");
  await page.$$eval(".tabs button", (els, i) => els[i].click(), valIdx);
  await page.waitForSelector(".issues", { timeout: 5000 });
  const issues = await page.$eval(".issues", (el) => el.textContent);
  if (!/escaped\/safe value/.test(issues))
    fail(`lint warning not surfaced in Validation tab: ${JSON.stringify(issues.slice(0, 200))}`);

  if (process.exitCode) {
    console.error("smoke: one or more checks failed.");
  } else {
    console.log(`smoke: OK — mounted, 5 tabs, preview iframe, expanded AST trees, truthiness parity, safe-value lint (${exe.split("/").pop()}).`);
  }
} finally {
  await browser.close();
  server.close();
}
