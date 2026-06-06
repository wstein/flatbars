// SPDX-License-Identifier: Apache-2.0
//
// Runtime smoke test for <flatbars-topbar> in a real (jsdom) DOM — the behaviour
// the source-pinned gates (check:topbar) can't see: the switcher resolves links
// and fires a cancelable flatbars:navigate, the Theme control writes the single
// `flatbars-theme` key + sets html[data-theme], and a cross-tab `storage` event
// syncs the theme. (The review's "the most-used code is the least-tested" gap.)

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// A real DOM with custom-element + shadow-DOM support. Wire the globals the
// element reads, BEFORE importing it (its define() guard checks customElements).
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "https://example.test/",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const k of ["window", "document", "HTMLElement", "customElements", "CustomEvent", "MouseEvent", "localStorage", "matchMedia"]) {
  if (window[k] !== undefined) globalThis[k] = window[k];
}
// jsdom has no matchMedia; the element doesn't use it, but be safe.
if (!globalThis.matchMedia) globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

await import("./flatbars-topbar.mjs");

const mount = (attrs = "") => {
  window.document.documentElement.removeAttribute("data-theme");
  window.document.body.innerHTML = `<flatbars-topbar ${attrs}></flatbars-topbar>`;
  return window.document.querySelector("flatbars-topbar");
};

test("switcher renders the four peers with base-resolved hrefs", () => {
  const el = mount('base="/flatbars"');
  const links = [...el.shadowRoot.querySelectorAll("nav.ctx a")];
  assert.deepEqual(
    links.map((a) => [a.dataset.section, a.getAttribute("href")]),
    [
      ["home", "/flatbars/"],
      ["tutorials", "/flatbars/tutorials/"],
      ["spec", "/flatbars/spec/"],
      ["lab", "/flatbars/lab/"],
    ],
  );
});

test("the active section is marked aria-current", () => {
  const el = mount('section="lab" base="/flatbars"');
  const current = el.shadowRoot.querySelector('nav.ctx a[aria-current="page"]');
  assert.equal(current.dataset.section, "lab");
});

test("lab-engine is forwarded to the Lab pill as ?engine=", () => {
  const el = mount('base="/flatbars" lab-engine="minbars"');
  const lab = el.shadowRoot.querySelector('nav.ctx a[data-section="lab"]');
  assert.equal(lab.getAttribute("href"), "/flatbars/lab/?engine=minbars");
});

test("clicking a switcher link fires a cancelable flatbars:navigate", () => {
  const el = mount('section="home" base="/flatbars"');
  let detail = null;
  el.addEventListener("flatbars:navigate", (e) => {
    detail = e.detail;
    assert.equal(e.cancelable, true);
  });
  el.shadowRoot.querySelector('nav.ctx a[data-section="spec"]').click();
  assert.deepEqual(detail, { section: "spec", href: "/flatbars/spec/" });
});

test("the Theme control writes flatbars-theme + sets html[data-theme] + fires themechange", () => {
  const el = mount("");
  let themed = null;
  el.addEventListener("flatbars:themechange", (e) => (themed = e.detail.theme));
  el.shadowRoot.querySelector('#theme button[data-val="dark"]').click();
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  assert.equal(window.localStorage.getItem("flatbars-theme"), "dark");
  assert.equal(themed, "dark");
  // pressed-state reflects the choice
  assert.equal(
    el.shadowRoot.querySelector('#theme button[data-val="dark"]').getAttribute("aria-pressed"),
    "true",
  );
});

test("a cross-tab storage event syncs the theme", () => {
  const el = mount("");
  window.document.documentElement.dataset.theme = "light";
  el._syncTheme();
  const ev = new window.Event("storage");
  ev.key = "flatbars-theme";
  ev.newValue = "dark";
  window.dispatchEvent(ev);
  assert.equal(window.document.documentElement.dataset.theme, "dark");
});
