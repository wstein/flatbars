// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { makeHandler } from "../scripts/serve-lab.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const labDir = resolve(repoRoot, "lab");
const specDistDir = resolve(repoRoot, "spec", "dist");

// Deploy target is env-driven so local dev and a local `npm run build` stay at
// the root, while CI (the GitHub Pages *project* page) builds under a sub-path:
//   PUBLIC_BASE_PATH=/flatbars  PUBLIC_SITE=https://wstein.github.io
// Unset ⇒ base "/", which is what the dev server and the test gates expect.
const BASE = process.env.PUBLIC_BASE_PATH || undefined;
const SITE = process.env.PUBLIC_SITE || undefined;

// Mount the Lab's static files at /lab/ on the Astro dev server so the tutorials
// and the Lab share one origin — "Open in Lab" deep-links (/lab/index.html#…)
// resolve with no second server and no PUBLIC_LAB_URL. Reuses the same static
// handler `npm run lab` uses (correct .mjs/.wasm MIME, /lab → /lab/ redirect).
function serveLab() {
  return {
    name: "flatbars-serve-lab",
    configureServer(server) {
      server.middlewares.use("/lab", makeHandler(labDir));
    },
  };
}

// Mount the BUILT Starlight spec at /spec/ on the dev server too, so the shared
// topbar's "Spec" pill resolves locally — the umbrella switcher then works end to
// end in `npm run dev` (Home/Tutorials are this app, Lab via serveLab, Spec here).
// Unlike the Lab (static source), the spec must be BUILT first, and under a base
// that matches this /spec/ mount or its assets (/_astro/…) 404. One command does
// both:  `npm run build:spec:local`  (PUBLIC_SPEC_BASE=/spec).
// If spec/dist is absent the handler simply falls through (Astro 404), exactly as
// before — nothing here requires the spec to be built.
function serveSpec() {
  return {
    name: "flatbars-serve-spec",
    configureServer(server) {
      const handler = makeHandler(specDistDir);
      server.middlewares.use("/spec", (req, res, next) => {
        if (!existsSync(specDistDir)) return next();
        return handler(req, res, next);
      });
    },
  };
}

// When building under a sub-path, the site's hand-written root-absolute links
// (`/minbars`, `/lab/index.html?engine=…`, the prose cross-links) are NOT
// rewritten by Astro — it only prefixes its own asset/route output. Normalise
// them in the built HTML so one place owns the base and the source links stay
// readable and deploy-portable. Skips already-based, protocol-relative (`//`),
// and external (`http(s):`) URLs. Client-rendered Lab deep-links go through
// PUBLIC_LAB_URL instead (runtime JS this build-time pass can't reach).
function normalizeBaseHrefs(base) {
  const prefix = base.replace(/\/$/, ""); // "/flatbars"
  const re = /\b(href|src)="(\/(?!\/)[^"]*)"/g;
  return {
    name: "flatbars-base-href",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        let touched = 0;
        const walk = async (d) => {
          for (const ent of await readdir(d, { withFileTypes: true })) {
            const p = resolve(d, ent.name);
            if (ent.isDirectory()) await walk(p);
            else if (ent.name.endsWith(".html")) {
              const html = await readFile(p, "utf8");
              const out = html.replace(re, (m, attr, val) =>
                val === prefix || val.startsWith(prefix + "/") ? m : `${attr}="${prefix}${val}"`,
              );
              if (out !== html) {
                await writeFile(p, out);
                touched++;
              }
            }
          }
        };
        await walk(fileURLToPath(dir));
        logger.info(`base-href: normalised root-absolute links to ${prefix}/ in ${touched} file(s)`);
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [preact(), ...(BASE && BASE !== "/" ? [normalizeBaseHrefs(BASE)] : [])],
  // fs.allow lets the Open-in-Lab island import the engine/helper from ../lab.
  vite: { plugins: [serveLab(), serveSpec()], server: { fs: { allow: [".."] } } },
});
