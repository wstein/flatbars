// SPDX-License-Identifier: Apache-2.0
//
// FlatBars anti-flash THEME SEED.
//
// This must run in <head>, BEFORE first paint and BEFORE any stylesheet that
// branches on [data-theme]. It sets html[data-theme] from the one shared
// localStorage key so the page paints in the right theme immediately — no flash
// of the wrong theme while <flatbars-topbar> (or any framework) hydrates.
//
// It is deliberately tiny and self-contained so it can be INLINED verbatim into
// every head (the Astro apps via a <script is:inline>, the static Lab as a
// literal <script>). The drift gate `check:theme-seed` (modelled on
// check:topbar) asserts those inline copies match the canonical form below.
//
// ── Inline form (copy this into <head>) ──────────────────────────────────────
//   <script>
//     (function () {
//       try {
//         var k = "flatbars-theme";
//         var t = localStorage.getItem(k);
//         if (t !== "light" && t !== "dark") {
//           t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
//         }
//         document.documentElement.dataset.theme = t;
//       } catch (e) {}
//     })();
//   </script>
// ─────────────────────────────────────────────────────────────────────────────
//
// The same logic is exported below for tooling/tests and for the rare host that
// prefers a module import over an inline copy.

export const THEME_KEY = "flatbars-theme";

/** Resolve the theme to apply on first paint: stored value, else OS preference. */
export function resolveTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch (e) {}
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch (e) {}
  return "light";
}

/** Seed html[data-theme] now. Safe to call more than once. */
export function seedTheme() {
  document.documentElement.dataset.theme = resolveTheme();
}

// Auto-seed when imported as a module (the inline form above is preferred for
// the no-flash guarantee, but this covers module-only hosts).
if (typeof document !== "undefined") seedTheme();
