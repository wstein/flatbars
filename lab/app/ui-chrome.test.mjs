// SPDX-License-Identifier: Apache-2.0
//
// Tests for the extracted UI chrome (Phase 0) — toast + share-menu toggles —
// against a hand-rolled fake `document` (no jsdom, interface only). Run with:
// node lab/app/ui-chrome.test.mjs (also in test:lab).

import test from "node:test";
import assert from "node:assert/strict";

// ── Minimal DOM fakes ─────────────────────────────────────────────────────────

function fakeEl() {
  const classes = new Set();
  return {
    className: "",
    textContent: "",
    hidden: null,
    dataset: {},
    _attrs: {},
    _hide: undefined,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
    setAttribute(k, v) { this._attrs[k] = v; },
  };
}

// Install a fresh fake document + timer stubs; returns a teardown.
function installDom(byIdMap = {}, querySelectorEl = null) {
  const body = { children: [], append(n) { this.children.push(n); } };
  globalThis.document = {
    body,
    getElementById: (id) => byIdMap[id] || null,
    querySelector: () => querySelectorEl,
    createElement: () => fakeEl(),
  };
  const rafCalls = [];
  globalThis.requestAnimationFrame = (fn) => { rafCalls.push(fn); fn(); return 1; };
  globalThis.setTimeout = () => 42;
  globalThis.clearTimeout = () => {};
  return { body, rafCalls };
}

// Import AFTER the stubs exist? No — ui-chrome reads globals at call time, not
// import time, so a top-level import is fine.
const { toast, openShareMenu, closeShareMenu } = await import("./ui-chrome.mjs");

test("toast creates a .toast node, sets the text, and shows it", () => {
  const { body } = installDom();
  toast("hello");
  assert.equal(body.children.length, 1, "one toast node appended");
  const t = body.children[0];
  assert.equal(t.className, "toast");
  assert.equal(t.textContent, "hello");
  assert.ok(t.classList.has("show"), "show class added via rAF");
});

test("toast reuses the existing node instead of stacking new ones", () => {
  const existing = fakeEl();
  existing.className = "toast";
  const { body } = installDom({}, existing);
  toast("again");
  assert.equal(body.children.length, 0, "no new node — reused the queried one");
  assert.equal(existing.textContent, "again");
});

test("openShareMenu / closeShareMenu keep visual + a11y state in sync", () => {
  const menu = fakeEl(), share = fakeEl(), btn = fakeEl();
  installDom({ "share-menu": menu, share, "share-btn": btn });

  openShareMenu();
  assert.equal(menu.hidden, false);
  assert.equal(share.dataset.open, "true");
  assert.equal(btn._attrs["aria-expanded"], "true");

  closeShareMenu();
  assert.equal(menu.hidden, true);
  assert.equal(share.dataset.open, "false");
  assert.equal(btn._attrs["aria-expanded"], "false");
});
