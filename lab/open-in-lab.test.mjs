// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { labHref, openInLab, workspaceState, LAB_ENGINES } from "./open-in-lab.mjs";
import { decodeState } from "./playground_utils.mjs";

// Pull the encoded workspace back out of a labHref URL (the fragment after #).
function decodeFragment(href) {
  return decodeState(href.slice(href.indexOf("#") + 1));
}

test("labHref puts the surface on ?engine= and the workspace in the fragment", async () => {
  const href = await labHref("fullbars", { template: "{{ name }}", data: { name: "Ada" } }, { labUrl: "lab.html" });
  assert.match(href, /^lab\.html\?engine=fullbars#/);
  const state = await decodeFragment(href);
  assert.equal(state.x, -1); // custom edit → restored verbatim
  assert.equal(state.tabs[0].s, "{{ name }}");
  assert.equal(state.d, "name: Ada"); // object → YAML (the Lab's native data format), no trailing newline
  assert.equal(state.av, "tmpl");
});

test("labHref round-trips named partials as extra tabs", async () => {
  const href = await labHref("minbars", {
    template: "{{> row}}",
    data: { x: 1 },
    partials: { row: "[{{x}}]" },
  });
  const state = await decodeFragment(href);
  assert.equal(state.tabs.length, 2);
  assert.deepEqual(state.tabs[1], { n: "row", s: "[{{x}}]" });
});

test("labHref takes string data verbatim and preserves existing query params", async () => {
  const href = await labHref("maxbars", { template: "x", data: "name: Ada\n" }, { labUrl: "lab.html?embed=1" });
  assert.match(href, /^lab\.html\?embed=1&engine=maxbars#/);
  const state = await decodeFragment(href);
  assert.equal(state.d, "name: Ada\n");
});

test("labHref rejects an unknown engine", async () => {
  await assert.rejects(() => labHref("handlebars", { template: "x" }), /unknown engine/);
});

test("labHref carries a JSONata transform as s.t (lands in the Lab's transform tab)", async () => {
  const href = await labHref("maxbars", {
    template: "{{name}}",
    data: { raw: 1 },
    transform: "{ \"name\": raw }",
  });
  const state = await decodeFragment(href);
  assert.equal(state.t, '{ "name": raw }');
  // Absent transform leaves t unset (no empty-string noise in the workspace).
  const bare = await decodeFragment(await labHref("maxbars", { template: "x", data: {} }));
  assert.equal(bare.t, undefined);
});

test("workspaceState defaults are Lab-restorable", () => {
  const s = workspaceState({ template: "hi" });
  assert.equal(s.x, -1);
  assert.equal(s.d, ""); // no data → empty editor
  assert.equal(s.tabs.length, 1);
  assert.equal(s.h, undefined); // no helpers → no `h` field
});

test("workspaceState carries custom-helper source in its own field `h` (ADR-018)", () => {
  const src = "registerHelper('loud', (s) => s.toUpperCase())";
  const s = workspaceState({ template: "{{loud x}}", helpers: src });
  assert.equal(s.h, src);
  assert.equal(s.t, undefined); // separate from the data transform
  // whitespace-only helpers are treated as none
  assert.equal(workspaceState({ template: "x", helpers: "  \n" }).h, undefined);
});


test("workspaceState carries an output view (`v`) and dock panel (`dk`)", async () => {
  // A "Migrate" example lands in the Migrated MaxBars output view; a "Lint"
  // example opens the Lint dock panel. Both are feature-gated on restore.
  const mig = workspaceState({ template: "{{^x}}y{{/x}}", view: "migrated" });
  assert.equal(mig.v, "migrated");
  assert.equal(mig.dk, undefined);
  const lint = workspaceState({ template: "{{ plus a b }}", dock: "lint" });
  assert.equal(lint.dk, "lint");
  assert.equal(lint.v, undefined);
  // both absent → no noise in the workspace (short links stay compact).
  const bare = workspaceState({ template: "x" });
  assert.equal(bare.v, undefined);
  assert.equal(bare.dk, undefined);
  // and they survive the share-state round-trip through a labHref.
  const href = await labHref("maxbars", { template: "{{ plus a b }}", dock: "lint" });
  const state = await decodeFragment(href);
  assert.equal(state.dk, "lint");
});

test("openInLab returns the URL when there is no window (SSR/build)", async () => {
  const href = await openInLab("rawbars", { template: "{{{ this }}}" }, { labUrl: "/lab/index.html" });
  assert.match(href, /^\/lab\/index\.html\?engine=rawbars#/);
});

test("LAB_ENGINES are exactly the four surfaces plus Stem", () => {
  assert.deepEqual([...LAB_ENGINES].sort(), ["fullbars", "maxbars", "minbars", "rawbars", "stem"]);
});
