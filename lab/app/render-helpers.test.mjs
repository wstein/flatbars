// SPDX-License-Identifier: Apache-2.0
//
// Tests for the pure render-path helpers (Phase 0). Offline, zero-dependency.
// Run with: node lab/app/render-helpers.test.mjs (also in test:lab).

import test from "node:test";
import assert from "node:assert/strict";
import { previewDoc, applyEscape, outputHasContent } from "./render-helpers.mjs";

// ── outputHasContent: empty-state gating over a cache snapshot ─────────────────

test("outputHasContent gates each view on the right cache", () => {
  const empty = { lastData: null, lastProgram: null, lastOutput: "" };
  assert.equal(outputHasContent("data", empty), false);
  assert.equal(outputHasContent("data", { ...empty, lastData: {} }), true);
  assert.equal(outputHasContent("bytecode", empty), false);
  assert.equal(outputHasContent("bytecode", { ...empty, lastProgram: {} }), true);
  // compiled / migrated depend only on the template source → always have content
  assert.equal(outputHasContent("compiled", empty), true);
  assert.equal(outputHasContent("migrated", empty), true);
  // every other view needs rendered output
  assert.equal(outputHasContent("source", empty), false);
  assert.equal(outputHasContent("source", { ...empty, lastOutput: "x" }), true);
});

// ── previewDoc: the iframe sandbox document + CSP boundary ────────────────────

test("previewDoc embeds the body and is a full HTML document", () => {
  const doc = previewDoc("<p>hi</p>");
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(doc.includes("<p>hi</p>"));
  assert.ok(doc.includes("<body>"));
});

test("previewDoc applies the strict CSP when scripts are OFF (default)", () => {
  const doc = previewDoc("x");
  assert.ok(doc.includes("Content-Security-Policy"), "CSP present by default");
  assert.ok(doc.includes("default-src 'none'"), "scripts blocked at the CSP layer");
});

test("previewDoc drops the CSP when the author opts INTO scripts", () => {
  const doc = previewDoc("x", true);
  assert.ok(!doc.includes("Content-Security-Policy"), "no CSP — sandbox is the boundary");
});

// ── applyEscape: stem-bc emit rewrite, gated on the capability ────────────────

const prog = () => ({
  instructions: [
    { t: "emit", escape: "html" },
    { t: "text", value: "x" },
    { t: "if", then: [{ t: "emit", escape: "html" }], else: [{ t: "emit", escape: "html" }] },
    { t: "each", body: [{ t: "emit", escape: "html" }] },
  ],
});

test("applyEscape is a no-op without a mode or without the capability", () => {
  const p = prog();
  assert.equal(applyEscape(p, "", true), p, "no mode → unchanged reference");
  assert.equal(applyEscape(p, "json", false), p, "no escape-modes capability → unchanged");
});

test("applyEscape rewrites every emit (incl. then/else/body) when supported", () => {
  const out = applyEscape(prog(), "json", true);
  assert.equal(out.instructions[0].escape, "json");
  assert.equal(out.instructions[2].then[0].escape, "json");
  assert.equal(out.instructions[2].else[0].escape, "json");
  assert.equal(out.instructions[3].body[0].escape, "json");
  // non-emit instruction untouched
  assert.equal(out.instructions[1].value, "x");
  assert.equal(out.instructions[1].escape, undefined);
});

test("applyEscape does not mutate the input program", () => {
  const p = prog();
  applyEscape(p, "json", true);
  assert.equal(p.instructions[0].escape, "html", "original emit unchanged");
});
