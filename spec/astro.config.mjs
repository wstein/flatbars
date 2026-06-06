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
import remarkGfm from "remark-gfm";
import starlightLinksValidator from "starlight-links-validator";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { sidebar } from "./src/sidebar.ts";
import { FONT_CSS_HREF, FONT_PRECONNECT } from "../shared/fonts.mjs";

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
      // The umbrella brand mark (public/favicon.svg, copied from shared/).
      favicon: "/favicon.svg",
      // The design system: the generated chrome tokens (what the shared topbar
      // reads) + the syntax palette, plus spec-local chrome. The two token files
      // are generated copies of the shared sources (`npm run gen:tokens`).
      customCss: [
        "./src/styles/flatbars-chrome.css",
        "./src/styles/flatbars-tokens.css",
        "./src/styles/spec.css",
      ],
      // Join the umbrella chrome: the shared <flatbars-topbar> replaces the native
      // header, the umbrella anti-flash seed replaces Starlight's theme provider,
      // and the native theme picker is suppressed (the element owns it). The
      // sidebar, TOC and Pagefind search are unchanged.
      components: {
        Header: "./src/components/Header.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      // IBM Plex — the umbrella's UI/mono families the shared topbar reads. The
      // stylesheet URL is the single source `shared/fonts.mjs` (check:fonts).
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: FONT_PRECONNECT[0] } },
        { tag: "link", attrs: { rel: "preconnect", href: FONT_PRECONNECT[1], crossorigin: true } },
        { tag: "link", attrs: { rel: "stylesheet", href: FONT_CSS_HREF } },
      ],
      // Build-time link integrity — the replacement for Antora's xref guarantee.
      // It is the GATE, run in the base-less build (`npm run build:spec`), where
      // authored root-absolute links match routes 1:1. The production build sets a
      // base, so routes carry the `/flatbars/spec` prefix that the authored links
      // do not (the base-href pass adds it afterwards) — validating there would
      // false-positive, so the validator is skipped when a base is set.
      //
      // Versioning (starlight-versions) is deferred until releases diverge: while
      // content/docs IS 0.1.0, a snapshot is a byte-identical duplicate of the
      // whole contract (46→91 pages) with no reader value — the bloat ADR-031 D3
      // limits. Enable at the 0.2.0 cut: `npm i starlight-versions` + add
      // `starlightVersions({ versions: [{ slug: "0.1.0" }] })` here, then build.
      plugins: BASE ? [] : [starlightLinksValidator()],
      // Maintained in src/sidebar.ts; check:adr-nav asserts every ADR is linked.
      sidebar,
    }),
    ...(BASE ? [normalizeBaseHrefs(BASE)] : []),
  ],
  // Astro's `gfm: true` default does not reach `.mdx` content (only `.md`), so
  // GFM tables/strikethrough were rendering as literal pipe text. Wire remark-gfm
  // in explicitly; astro-mermaid spreads existing remarkPlugins, so this composes.
  markdown: { remarkPlugins: [remarkGfm] },
  // Let islands import the engine bundle from ../lab (live engine panes, ADR-031),
  // mirroring the tutorials build.
  vite: { server: { fs: { allow: [".."] } } },
});
