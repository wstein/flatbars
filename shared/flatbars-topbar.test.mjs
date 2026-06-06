// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the shared <flatbars-topbar> pure helpers. The element itself
// is DOM-heavy (shadow DOM, custom-element upgrade) and is exercised live in the
// apps + the `check:topbar` source gate; here we pin the link-resolution and
// section contract that every host and router depends on, with no DOM.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveHref, SECTIONS, LABELS, THEME_KEY, rankSearch } from "./flatbars-topbar.mjs";

const IDX = [
  { kind: "page", title: "MaxBars reference", sub: "", terms: "maxbars reference operators pipes flagship" },
  { kind: "surface", title: "MaxBars", sub: "", terms: "maxbars dialect surface flagship" },
  { kind: "op", title: "upcase", sub: "", terms: "upcase operation helper inline" },
  { kind: "adr", title: "ADR-014: Highlighting", sub: "", terms: "adr-014 highlighting decision" },
  { kind: "feature", title: "Pipes — MaxBars", sub: "", terms: "maxbars pipes value helper" },
  { kind: "example", title: "Sugar example", sub: "", terms: "rawbars example sugar" },
];

test("rankSearch: empty query returns the curated page/surface default", () => {
  const r = rankSearch(IDX, "");
  assert.ok(r.length > 0);
  assert.ok(r.every((e) => e.kind === "page" || e.kind === "surface"), "only pages/surfaces by default");
});

test("rankSearch: all query words must be present (AND semantics)", () => {
  // "value" appears only in the feature entry's terms; "maxbars" is shared.
  const r = rankSearch(IDX, "pipes value");
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "feature");
  assert.equal(rankSearch(IDX, "maxbars nonexistentword").length, 0);
});

test("rankSearch: exact title beats prefix beats kind, and limit is honoured", () => {
  const r = rankSearch(IDX, "maxbars");
  // exact title "MaxBars" (surface) ranks above the longer "MaxBars reference" page.
  assert.equal(r[0].title, "MaxBars");
  assert.ok(rankSearch(IDX, "maxbars", 1).length === 1, "limit caps results");
});

test("rankSearch: matches operations and ADRs by term", () => {
  assert.equal(rankSearch(IDX, "upcase")[0].kind, "op");
  assert.equal(rankSearch(IDX, "adr-014")[0].kind, "adr");
});

test("SECTIONS is the four-peer umbrella IA in switcher order", () => {
  assert.deepEqual(SECTIONS, ["home", "tutorials", "spec", "lab"]);
  for (const s of SECTIONS) assert.ok(LABELS[s], `${s} has a label`);
});

test("resolveHref maps each section under a deploy base", () => {
  assert.equal(resolveHref("home", "/flatbars"), "/flatbars/");
  assert.equal(resolveHref("tutorials", "/flatbars"), "/flatbars/tutorials/");
  assert.equal(resolveHref("spec", "/flatbars"), "/flatbars/spec/");
  assert.equal(resolveHref("lab", "/flatbars"), "/flatbars/lab/");
});

test("resolveHref normalises a trailing slash on base", () => {
  assert.equal(resolveHref("spec", "/flatbars/"), "/flatbars/spec/");
  assert.equal(resolveHref("home", "/flatbars/"), "/flatbars/");
});

test("resolveHref resolves at the root origin (empty base)", () => {
  assert.equal(resolveHref("home", ""), "/");
  assert.equal(resolveHref("tutorials", ""), "/tutorials/");
  assert.equal(resolveHref("lab"), "/lab/");
});

test("an unknown section falls back to home", () => {
  assert.equal(resolveHref("nope", "/flatbars"), "/flatbars/");
});

test("THEME_KEY is the single shared persistence key", () => {
  assert.equal(THEME_KEY, "flatbars-theme");
});
