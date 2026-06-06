// SPDX-License-Identifier: Apache-2.0
//
// The normative FlatBars spec as an Astro Starlight site (ADR-031). Standalone:
// it links to/from the tutorials app via the existing PUBLIC_SPEC_BASE seam, and
// shares the design system (tokens, wordmark) without sharing a build.
//
// Deploy target is env-driven, mirroring tutorials/astro.config.mjs. Locally the
// base is root ("/") so authored links (`/concepts/`) match routes 1:1 and the
// link validator passes; in production the spec mounts at `/flatbars/spec` via
// PUBLIC_SPEC_BASE, and the base-href pass prefixes the authored root-absolute
// links that Astro itself does not rewrite.
//   PUBLIC_SPEC_BASE=/flatbars/spec  PUBLIC_SITE=https://wstein.github.io
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import preact from "@astrojs/preact";
import mermaid from "astro-mermaid";
import starlightLinksValidator from "starlight-links-validator";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sidebar } from "./src/sidebar.ts";

const BASE = process.env.PUBLIC_SPEC_BASE || undefined;
const SITE = process.env.PUBLIC_SITE || undefined;

// Prefix the hand-authored root-absolute links (`/concepts/`, `/adr/…`) in the
// built HTML with the deploy base — Astro only rewrites its own route/asset
// output, not markdown link hrefs. No-op when BASE is root. Mirrors tutorials.
function normalizeBaseHrefs(base) {
  const prefix = base.replace(/\/$/, "");
  const re = /\b(href)="(\/(?!\/)[^"]*)"/g;
  return {
    name: "flatbars-spec-base-href",
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
        logger.info(`base-href: prefixed root-absolute links with ${prefix}/ in ${touched} file(s)`);
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    // Renders ```mermaid fences client-side, theme-synced to Starlight's
    // light/dark. Must precede the starlight integration (astro-mermaid).
    mermaid({ autoTheme: true }),
    preact(),
    starlight({
      title: "FlatBars",
      description: "The normative specification for FlatBars — a template-engine construction kit.",
      // The design system: the generated token palette plus spec-local chrome.
      customCss: ["./src/styles/flatbars-tokens.css", "./src/styles/spec.css"],
      // Build-time link integrity — the replacement for Antora's xref guarantee.
      plugins: [starlightLinksValidator()],
      // Maintained in src/sidebar.ts; check:adr-nav asserts every ADR is linked.
      sidebar,
    }),
    ...(BASE ? [normalizeBaseHrefs(BASE)] : []),
  ],
  // Let islands import the engine bundle from ../lab (live engine panes, ADR-031),
  // mirroring the tutorials build.
  vite: { server: { fs: { allow: [".."] } } },
});
