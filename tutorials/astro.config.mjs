// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeHandler } from "../scripts/serve-lab.mjs";

const labDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "lab");

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

export default defineConfig({
  integrations: [preact()],
  // fs.allow lets the Open-in-Lab island import the engine/helper from ../lab.
  vite: { plugins: [serveLab()], server: { fs: { allow: [".."] } } },
});
