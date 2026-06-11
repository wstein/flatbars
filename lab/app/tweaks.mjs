// SPDX-License-Identifier: Apache-2.0
//
// The Lab's Appearance tweaks — the option catalog + the load/normalize of the
// persisted preferences (Phase 0). Pure: the apply logic (applyTweaks, CM
// reconfigure + CSS vars) and the Preact panel stay in index.html and read these.
// Theme is NOT a tweak — the umbrella topbar owns it (single flatbars-theme key).

export const TWEAK_OPTS = {
  // Monospace families only — code reads best fixed-width. Each is a stack that
  // degrades gracefully when the preferred face isn't installed.
  font: [
    { value: "plex", label: "Plex Mono", stack: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace' },
    { value: "system", label: "System", stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
    { value: "courier", label: "Courier", stack: '"Courier New", Courier, monospace' },
  ],
  fontSize: [12, 13, 14, 16],
};

const DEFAULTS = { layout: "split", lineNumbers: true, font: "plex", fontSize: 13, compactToolbar: false };

// Merge persisted tweaks (a parsed object, or null/garbage) over the defaults,
// drop retired keys (theme/mood/chipstyle), and clamp font/fontSize to the valid
// catalog so a stale or hand-edited value can't break the editor.
export function normalizeTweaks(raw) {
  const t = { ...DEFAULTS, ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) };
  delete t.theme; // retired (was light|dark|system) — the shared topbar owns it
  delete t.mood;
  delete t.chipstyle; // retired (was tint|outline|solid) — tags use the fixed tint look
  t.lineNumbers = t.lineNumbers !== false; // default on
  if (!TWEAK_OPTS.font.some((o) => o.value === t.font)) t.font = "plex";
  if (!TWEAK_OPTS.fontSize.includes(t.fontSize)) t.fontSize = 13;
  return t;
}
