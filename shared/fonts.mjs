// SPDX-License-Identifier: Apache-2.0
//
// The ONE web-font stylesheet URL for the whole umbrella. IBM Plex Sans + Mono
// are the families named by the shared chrome tokens (--font-ui / --font-mono in
// shared/flatbars-chrome.css); this is the single source for *which weights* load,
// so the three heads can't drift (they used to: the Lab pulled Sans 300, the spec
// pulled Mono 700, the tutorials neither). The Astro apps import FONT_CSS_HREF
// (tutorials' BaseHead, the spec's Starlight `head`); the static Lab hard-codes
// the same string, pinned byte-identical by `check:fonts`.
//
// Weights are the UNION the apps need: Sans 300–700, Mono 400–700.
export const FONT_CSS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap";

// The two preconnect origins that pair with it (DNS/TLS warmup before the CSS).
export const FONT_PRECONNECT = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];
