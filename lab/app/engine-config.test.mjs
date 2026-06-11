// SPDX-License-Identifier: Apache-2.0
//
// Pure unit tests for the engine-resolution helpers extracted from index.html
// (Phase 0). Offline, zero-dependency — run with: node lab/app/engine-config.test.mjs
// (also part of the `test:lab` runner).

import test from "node:test";
import assert from "node:assert/strict";
import { resolveEngine, engineLabel, templateExt, templateFence } from "./engine-config.mjs";

// ── resolveEngine: canonical ids + aliases ────────────────────────────────────

test("resolveEngine maps each engine and its documented aliases", () => {
  for (const alias of ["rawbars", "raw", "core"]) assert.equal(resolveEngine(alias), "rawbars");
  for (const alias of ["minbars", "mustache"]) assert.equal(resolveEngine(alias), "minbars");
  for (const alias of ["classicbars", "full", "surface"]) assert.equal(resolveEngine(alias), "classicbars");
  for (const alias of ["maxbars", "max"]) assert.equal(resolveEngine(alias), "maxbars");
});

test("resolveEngine is case-insensitive", () => {
  assert.equal(resolveEngine("RawBars"), "rawbars");
  assert.equal(resolveEngine("MUSTACHE"), "minbars");
});

test("resolveEngine honours the legacy ?engine=flatbars&dialect= back-compat links", () => {
  assert.equal(resolveEngine("flatbars", "core"), "rawbars");
  assert.equal(resolveEngine("flatbars", "rawbars"), "rawbars");
  assert.equal(resolveEngine("flatbars", "maxbars"), "maxbars");
  assert.equal(resolveEngine("flatbars", ""), "classicbars"); // no dialect ⇒ ClassicBars
  assert.equal(resolveEngine("bb", "maxbars"), "maxbars");
});

test("resolveEngine defaults unknown / empty input to ClassicBars", () => {
  assert.equal(resolveEngine(""), "classicbars");
  assert.equal(resolveEngine(undefined), "classicbars");
  assert.equal(resolveEngine("handlebars"), "classicbars"); // native HBS dropped
  assert.equal(resolveEngine("nonsense"), "classicbars");
});

// ── label / extension / fence derivatives ─────────────────────────────────────

test("engineLabel names each engine", () => {
  assert.equal(engineLabel("rawbars"), "RawBars");
  assert.equal(engineLabel("classicbars"), "ClassicBars");
  assert.equal(engineLabel("maxbars"), "MaxBars");
  assert.equal(engineLabel("minbars"), "MinBars");
});

test("templateExt gives each surface its own extension, hbs as the fallback", () => {
  assert.equal(templateExt("rawbars"), "rawbars");
  assert.equal(templateExt("minbars"), "mustache");
  assert.equal(templateExt("classicbars"), "hbs");
  assert.equal(templateExt("maxbars"), "maxbars");
  assert.equal(templateExt("bogus"), "hbs");
});

test("templateFence is mustache for MinBars and handlebars otherwise", () => {
  assert.equal(templateFence("minbars"), "mustache");
  for (const e of ["rawbars", "classicbars", "maxbars"]) assert.equal(templateFence(e), "handlebars");
});
