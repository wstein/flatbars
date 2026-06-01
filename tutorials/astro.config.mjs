// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// The Open-in-Lab island imports the shared deep-link helper and engine adapters
// from reference/web/ (outside this project root), so dev-server fs access is
// widened to the repo root. The production build bundles them via rollup.
export default defineConfig({
  integrations: [preact()],
  vite: { server: { fs: { allow: [".."] } } },
});
