// SPDX-License-Identifier: Apache-2.0
//
// openInLab — the shared "load this example into the FlatBars Lab" contract.
//
// Both the Lab (lab/index.html) and the tutorial pages import this, so
// the deep-link format lives in ONE place. An example is `{ template, data,
// partials }` plus the engine (surface) it runs under. We encode the workspace
// with the Lab's own share-state codec (`encodeState`) into the URL *fragment*
// and put the surface on `?engine=`; the Lab resolves the engine from the query
// at boot and `restoreHash()` decodes the fragment as a custom workspace.
//
// The transport is self-contained — no vendoring, no server fetch, no SSRF
// surface (example-loader-spec.md non-goals): the example travels inside the URL.

import { encodeState } from "./playground_utils.mjs";
import { dump as dumpYaml } from "./vendor/js-yaml.mjs";

// The engines the Lab accepts on `?engine=` (the four FlatBars surfaces + Stem).
export const LAB_ENGINES = ["rawbars", "minbars", "fullbars", "maxbars", "stem"];

// Render an example's data as the Lab's data-editor text. The Lab's native data
// format is YAML (data.yaml), so an object/array is dumped to YAML; a string is
// taken verbatim (already YAML the author wrote); nullish → an empty editor.
// Exported so the tutorial preview shows exactly what the Lab will load.
export function dataText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  // js-yaml's dump() always appends a trailing newline; drop it so the data
  // editor (tutorial preview and Lab alike) has no dangling blank last line.
  return dumpYaml(data).replace(/\n+$/, "");
}

// The Lab workspace snapshot for a one-off example. `x: -1` marks a custom edit
// (restoreHash restores it verbatim rather than reloading a catalog example);
// tab 0 is the main template, the rest are named partials. Mirrors the field
// shape `restoreHash` reads (`tabs:[{n,s}]`, `d`, `av`, `ai`).
export function workspaceState({ template = "", data, partials, helpers, transform, catalog, locale, view, dock } = {}) {
  const tabs = [{ s: template }];
  const p = partials || {};
  for (const name of Object.keys(p)) tabs.push({ n: name, s: p[name] });
  const st = { x: -1, tabs, d: dataText(data), av: "tmpl", ai: 0 };
  // Custom-helper JS (ADR-018) — a separate field `h` from the data transform
  // (`t`). The Lab loads it into its FullBars-only helpers.js editor and runs it
  // in a sandboxed Worker (no DOM access), so a shared link cannot touch the page.
  if (helpers && helpers.trim()) st.h = helpers;
  // A JSONata data transform (the data → view-model preprocess `restoreHash`
  // reads as `s.t`). Lets a "Data shaping" example land in the Lab's transform
  // tab with the expression already loaded.
  if (transform && transform.trim()) st.t = transform;
  // i18n (ADR-029): the message catalog (`restoreHash` reads `s.cat` → the
  // LOCALIZATION/catalog.yaml view) and the active locale (`s.loc` → config.yaml's
  // i18n.locale). Lets a "Localize" example land with its strings + locale loaded.
  if (catalog && catalog.trim()) st.cat = catalog;
  if (locale && locale !== "en") st.loc = locale;
  // The output view to land on (`restoreHash` reads `s.v`, gated by the engine's
  // features). Lets a "Migrate" example open straight into the "Migrated MaxBars"
  // view instead of HTML Preview.
  if (view) st.v = view;
  // The dock panel to open (`restoreHash` reads `s.dk`, feature-gated). Lets a
  // "Lint" example land with the Lint panel already showing its findings.
  if (dock) st.dk = dock;
  return st;
}

// Build the Lab URL for an example. `labUrl` is the Lab's index.html, relative
// or absolute per how the host site is served (default: same dir). Async because
// the share-state codec is. The encoded payload is base64url (URL-fragment safe).
export async function labHref(engine, example, { labUrl = "index.html" } = {}) {
  if (!LAB_ENGINES.includes(engine)) {
    throw new Error(`openInLab: unknown engine '${engine}' (expected one of ${LAB_ENGINES.join(", ")})`);
  }
  const encoded = await encodeState(workspaceState(example));
  const sep = labUrl.includes("?") ? "&" : "?";
  return `${labUrl}${sep}engine=${engine}#${encoded}`;
}

// Imperative convenience: open the example in a new tab. Opens the tab
// synchronously (preserving the click gesture, so popup blockers don't fire),
// then navigates it once the async encode resolves. Returns the URL. In a
// non-browser context it just returns the URL.
export async function openInLab(engine, example, opts = {}) {
  const win = (typeof window !== "undefined" && typeof window.open === "function")
    ? window.open("about:blank", "_blank")
    : null;
  try {
    const href = await labHref(engine, example, opts);
    if (win) win.location.href = href;
    return href;
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
