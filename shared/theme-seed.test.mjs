// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the shared anti-flash theme seed. Resolution order: a stored
// light/dark preference wins; otherwise fall back to the OS preference; a bad or
// missing value resolves to light. localStorage / matchMedia are stubbed.

import test from "node:test";
import assert from "node:assert/strict";

// Stub the browser globals the seed reads, BEFORE importing it (the module
// auto-seeds on import only when `document` exists, which it does not here).
function withEnv({ stored, prefersDark }, run) {
  globalThis.localStorage = {
    _v: stored,
    getItem(k) {
      return k === "flatbars-theme" ? (this._v ?? null) : null;
    },
  };
  globalThis.matchMedia = () => ({ matches: !!prefersDark });
  try {
    run();
  } finally {
    delete globalThis.localStorage;
    delete globalThis.matchMedia;
  }
}

const { resolveTheme, THEME_KEY } = await import("./theme-seed.js");

test("THEME_KEY is the single shared key", () => {
  assert.equal(THEME_KEY, "flatbars-theme");
});

test("a stored preference wins over the OS preference", () => {
  withEnv({ stored: "dark", prefersDark: false }, () => assert.equal(resolveTheme(), "dark"));
  withEnv({ stored: "light", prefersDark: true }, () => assert.equal(resolveTheme(), "light"));
});

test("with no stored preference it follows the OS preference", () => {
  withEnv({ stored: null, prefersDark: true }, () => assert.equal(resolveTheme(), "dark"));
  withEnv({ stored: null, prefersDark: false }, () => assert.equal(resolveTheme(), "light"));
});

test("a junk stored value falls back to the OS preference", () => {
  withEnv({ stored: "dim", prefersDark: true }, () => assert.equal(resolveTheme(), "dark"));
});
