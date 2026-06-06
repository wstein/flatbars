// SPDX-License-Identifier: Apache-2.0
//
// The normative FlatBars spec as an Astro Starlight site (ADR-031). Standalone:
// it links to/from the tutorials app via the existing PUBLIC_SPEC_BASE seam, and
// shares the design system (tokens, wordmark) without sharing a build.
//
// Deploy target is env-driven, mirroring tutorials/astro.config.mjs: locally the
// base is `/spec`; under the GitHub Pages project page it is `/flatbars/spec`.
//   PUBLIC_BASE_PATH=/flatbars  PUBLIC_SITE=https://wstein.github.io
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import preact from "@astrojs/preact";
import starlightLinksValidator from "starlight-links-validator";

const PREFIX = (process.env.PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const BASE = `${PREFIX}/spec`;
const SITE = process.env.PUBLIC_SITE || undefined;

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    preact(),
    starlight({
      title: "FlatBars",
      description: "The normative specification for FlatBars — a template-engine construction kit.",
      // The design system: the generated token palette plus spec-local chrome.
      customCss: ["./src/styles/flatbars-tokens.css", "./src/styles/spec.css"],
      // Build-time link integrity — the replacement for Antora's xref guarantee.
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: "Introduction", link: "/" },
      ],
    }),
  ],
  // Let islands import the engine bundle from ../lab (live engine panes, ADR-031),
  // mirroring the tutorials build.
  vite: { server: { fs: { allow: [".."] } } },
});
