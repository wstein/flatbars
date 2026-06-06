// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the shared <flatbars-topbar> pure helpers. The element itself
// is DOM-heavy (shadow DOM, custom-element upgrade) and is exercised live in the
// apps + the `check:topbar` source gate; here we pin the link-resolution and
// section contract that every host and router depends on, with no DOM.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveHref, SECTIONS, LABELS, THEME_KEY } from "./flatbars-topbar.mjs";

test("SECTIONS is the four-peer umbrella IA in switcher order", () => {
  assert.deepEqual(SECTIONS, ["home", "tutorials", "spec", "lab"]);
  for (const s of SECTIONS) assert.ok(LABELS[s], `${s} has a label`);
});

test("resolveHref maps each section under a deploy base", () => {
  assert.equal(resolveHref("home", "/flatbars"), "/flatbars/");
  assert.equal(resolveHref("tutorials", "/flatbars"), "/flatbars/tutorial/");
  assert.equal(resolveHref("spec", "/flatbars"), "/flatbars/spec/");
  assert.equal(resolveHref("lab", "/flatbars"), "/flatbars/lab/");
});

test("resolveHref normalises a trailing slash on base", () => {
  assert.equal(resolveHref("spec", "/flatbars/"), "/flatbars/spec/");
  assert.equal(resolveHref("home", "/flatbars/"), "/flatbars/");
});

test("resolveHref resolves at the root origin (empty base)", () => {
  assert.equal(resolveHref("home", ""), "/");
  assert.equal(resolveHref("tutorials", ""), "/tutorial/");
  assert.equal(resolveHref("lab"), "/lab/");
});

test("an unknown section falls back to home", () => {
  assert.equal(resolveHref("nope", "/flatbars"), "/flatbars/");
});

test("THEME_KEY is the single shared persistence key", () => {
  assert.equal(THEME_KEY, "flatbars-theme");
});
