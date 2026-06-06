// SPDX-License-Identifier: Apache-2.0
//
// <flatbars-topbar> — the ONE app topbar, shared by all three FlatBars front
// ends (the Astro tutorials app, the Astro Starlight spec, and the hand-written
// static Lab). It is a zero-dependency custom element so it is the only artifact
// the static Lab can share at RUNTIME — a build-time Astro component could never
// reach the Lab, which is why the wordmark used to be hand-copied. This element
// retires that copy: `check:topbar` pins that every surface mounts it.
//
// Design decisions baked in (from the umbrella-migration consensus):
//   • Hydrates CONTROLS ONLY. It never owns first paint of the theme — that is
//     theme-seed.js, inlined in each <head>. So there is no FOUC even before
//     this script loads/upgrades.
//   • Reads its links from a `base` attribute (the deploy base, e.g. "/flatbars"
//     in prod, "" at root/dev) so the same element resolves correct cross-app
//     URLs on every origin — nothing is hard-coded.
//   • Owns the context switcher [Home · Tutorials · Spec · Lab]; the active one
//     is the `section` attribute, marked aria-current. The wordmark is "home".
//   • Styles live in shadow DOM but READ the page's design tokens (var(--accent)
//     …) which inherit through the shadow boundary — so the bar always matches
//     whichever app it sits in, light or dark.
//   • A <slot name="tools"> lets a host inject extra controls (e.g. the docs
//     colour-legend popover) before the search affordance.
//
// Attributes (all optional; `data-*` aliases accepted):
//   section   "home" | "tutorials" | "spec" | "lab" — which app we're in (active state)
//   base      deploy base path, e.g. "/flatbars" (default "")
//   suffix    small wordmark suffix, e.g. "Lab" or "Docs" (default none)
//   version   plain version label beside the wordmark, e.g. "v0.1.0" (default none)
//   repo      GitHub URL (default the FlatBars repo)
//   search    where the search affordance routes (default `${base}/spec/`)
//   lab-engine default engine for the Lab link, e.g. "minbars"
//
// Events (both bubble + composed; cancelable):
//   flatbars:navigate    detail {section, href} — fired before a switcher link
//                        navigates. preventDefault() to handle routing yourself.
//   flatbars:themechange detail {theme} — fired after the theme toggles.
//
// Usage:
//   <script type="module" src="/shared/flatbars-topbar.mjs"></script>
//   <flatbars-topbar section="tutorials" base="/flatbars" version="v0.1.0"></flatbars-topbar>

export const THEME_KEY = "flatbars-theme";
export const SECTIONS = ["home", "tutorials", "spec", "lab"];
export const LABELS = { home: "Home", tutorials: "Tutorials", spec: "Spec", lab: "Lab" };
const DEFAULT_REPO = "https://github.com/wstein/flatbars";

// Pure link resolver — exported so tests (and any host router) can reason about
// the same mapping the element uses, without a DOM. `base` may carry a trailing
// slash; it is normalised away. Home/the wordmark resolve to `${base}/`.
export function resolveHref(section, base = "") {
  const b = String(base).replace(/\/$/, "");
  if (section === "tutorials") return `${b}/tutorial/`;
  if (section === "spec") return `${b}/spec/`;
  if (section === "lab") return `${b}/lab/`;
  return `${b}/` || "/"; // home (and any unknown section)
}

const TEMPLATE = `
<style>
  :host {
    /* The bar inherits the page tokens; these are only fallbacks for a bare host. */
    display: block;
    position: sticky;
    top: 0;
    z-index: 30;
    font-family: var(--font-ui, system-ui, sans-serif);
  }
  *, *::before, *::after { box-sizing: border-box; }

  .bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    height: 52px;
    padding: 0 1.25rem;
    background: color-mix(in srgb, var(--bg, #fff) 85%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border, #ddd6f8);
  }

  /* Canonical wordmark lockup — identical markup/classes to the apps' wordmark. */
  .brand {
    color: var(--fg, #18181b);
    text-decoration: none;
    font-weight: 600;
    font-size: 1.63rem; /* wordmark scaled to 160% */
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
    flex: none;
  }
  .brand .mark { width: 1.15em; height: 1.15em; color: var(--accent, #6d28d9); flex: none; }
  .brand .wm { display: inline-flex; align-items: baseline; }
  .brand .flat { color: var(--accent, #6d28d9); }
  .brand .suffix {
    font: 600 0.62rem/1 var(--font-mono, ui-monospace, monospace);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--fg-faint, #6f5f99);
    margin-left: 0.4rem;
  }
  .brand:focus-visible { outline: 2px solid var(--accent, #6d28d9); outline-offset: 3px; border-radius: 4px; }

  /* Version label — e.g. "v0.1.0", plain text beside the wordmark. */
  .version {
    font: 500 0.88rem/1 var(--font-mono, ui-monospace, monospace); /* shrunk to 80% of wordmark-scaled size */
    letter-spacing: 0.02em;
    color: var(--fg-faint, #6f5f99);
    white-space: nowrap;
    flex: none;
    margin-left: -0.6rem; /* tighten the gap to the wordmark */
  }
  .version[hidden] { display: none; }

  /* Context switcher — the seam-removing control. */
  nav.ctx {
    display: inline-flex;
    background: var(--bg-2, #f2effc);
    border: 1px solid var(--border, #ddd6f8);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    flex: none;
  }
  nav.ctx a {
    font: 500 12.5px/1 var(--font-ui, sans-serif);
    color: var(--fg-muted, #5b4d92);
    text-decoration: none;
    padding: 6px 11px;
    border-radius: 6px;
    white-space: nowrap;
  }
  nav.ctx a:hover { color: var(--fg, #18181b); }
  nav.ctx a[aria-current="page"] {
    background: var(--bg, #fff);
    color: var(--accent-2, #4c1d95);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 0 0 1px var(--border, #ddd6f8);
  }
  nav.ctx a:focus-visible { outline: 2px solid var(--accent, #6d28d9); outline-offset: 2px; }

  .spacer { margin-left: auto; }

  .tools { display: flex; align-items: center; gap: 0.85rem; }

  .search {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font: 500 12px/1 var(--font-ui, sans-serif);
    color: var(--fg-faint, #6f5f99);
    background: var(--bg, #fff);
    border: 1px solid var(--border-strong, #c8bff2);
    border-radius: 7px;
    padding: 6px 11px;
    text-decoration: none;
    white-space: nowrap;
  }
  .search:hover { color: var(--accent-2, #4c1d95); border-color: var(--accent, #6d28d9); }
  .search .ico { font-size: 13px; }
  .search kbd {
    font: 600 10px/1 var(--font-mono, monospace);
    color: var(--fg-faint, #6f5f99);
    background: var(--bg-2, #f2effc);
    border: 1px solid var(--border, #ddd6f8);
    border-radius: 4px;
    padding: 2px 5px;
    margin-left: 0.15rem;
  }

  /* Theme segmented control. */
  .seg {
    display: inline-flex;
    background: var(--bg-2, #f2effc);
    border: 1px solid var(--border, #ddd6f8);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    flex: none;
  }
  .seg button {
    font: 500 12px/1 var(--font-ui, sans-serif);
    color: var(--fg-muted, #5b4d92);
    background: none;
    border: none;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .seg button:hover { color: var(--fg, #18181b); }
  .seg button:focus-visible { outline: 2px solid var(--accent, #6d28d9); outline-offset: 2px; }
  .seg button[aria-pressed="true"] {
    background: var(--bg, #fff);
    color: var(--accent-2, #4c1d95);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 0 0 1px var(--border, #ddd6f8);
  }

  .gh {
    color: var(--fg-muted, #5b4d92);
    text-decoration: none;
    font: 600 13px/1 var(--font-ui, sans-serif);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
  }
  .gh:hover { color: var(--accent-2, #4c1d95); }
  .gh svg { width: 17px; height: 17px; fill: currentColor; }

  /* Hamburger for narrow viewports. */
  .more {
    display: none;
    background: none;
    border: 1px solid var(--border-strong, #c8bff2);
    border-radius: var(--radius, 6px);
    color: var(--fg, #18181b);
    font-size: 1.05rem;
    line-height: 1;
    padding: 6px 9px;
    cursor: pointer;
  }
  .more:focus-visible { outline: 2px solid var(--accent, #6d28d9); outline-offset: 2px; }

  /* Responsive: collapse tools behind a menu under 760px; keep brand+switcher. */
  @media (max-width: 760px) {
    .bar { gap: 0.65rem; padding: 0 0.9rem; }
    .search .label { display: none; }
    .gh .label { display: none; }
  }
  @media (max-width: 560px) {
    .more { display: inline-block; }
    .tools {
      position: absolute;
      top: 52px;
      right: 0.6rem;
      flex-direction: column;
      align-items: stretch;
      gap: 0.7rem;
      background: var(--bg, #fff);
      border: 1px solid var(--border-strong, #c8bff2);
      border-radius: var(--radius-lg, 10px);
      box-shadow: var(--shadow-pop, 0 12px 32px -8px rgba(0,0,0,.2));
      padding: 0.9rem;
      width: min(260px, 86vw);
    }
    .tools[hidden] { display: none; }
    .search .label { display: inline; }
    .gh .label { display: inline; }
    .search { justify-content: center; }
    nav.ctx { font-size: 12px; }
  }

  @media (prefers-reduced-motion: reduce) { .bar { backdrop-filter: none; } }
</style>

<header class="bar" part="bar">
  <slot name="start"></slot>
  <a class="brand" part="brand" id="brand"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M26 13 H18 V29 H12 V35 H18 V51 H26"/><path d="M38 13 H46 V29 H52 V35 H46 V51 H38"/></g></svg><span class="wm"><b class="flat">Flat</b>Bars</span><span class="suffix" id="suffix" hidden></span></a>
  <span class="version" part="version" id="version" hidden></span>

  <nav class="ctx" part="switcher" aria-label="FlatBars sections" id="ctx"></nav>

  <span class="spacer"></span>

  <button class="more" id="more" type="button" aria-expanded="false" aria-controls="tools" aria-label="Menu">≡</button>

  <div class="tools" id="tools" part="tools">
    <slot name="tools"></slot>
    <a class="search" id="search" part="search">
      <span class="ico" aria-hidden="true">⌕</span><span class="label">Search</span><kbd>/</kbd>
    </a>

    <div class="seg" id="theme" role="group" aria-label="Theme">
      <button type="button" data-val="light" aria-pressed="true">Light</button>
      <button type="button" data-val="dark" aria-pressed="false">Dark</button>
    </div>

    <a class="gh" id="gh" target="_blank" rel="noopener" aria-label="FlatBars on GitHub">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      <span class="label">GitHub</span>
    </a>
  </div>
</header>
`;

// Conditional base so the module is importable in plain Node (where HTMLElement
// is absent) to reach the exported pure helpers in tests; in a browser this is
// the real HTMLElement and the element upgrades normally.
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class FlatBarsTopbar extends Base {
  static get observedAttributes() {
    return ["section", "base", "suffix", "version", "repo", "search", "lab-engine"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = TEMPLATE;
    this._onThemeClick = this._onThemeClick.bind(this);
    this._onCtxClick = this._onCtxClick.bind(this);
    this._onBrandClick = this._onBrandClick.bind(this);
    this._onMore = this._onMore.bind(this);
    this._onStorage = this._onStorage.bind(this);
    this._onKey = this._onKey.bind(this);
  }

  // ── attribute helpers (accept `x` or `data-x`) ──
  _attr(name, fallback = "") {
    return this.getAttribute(name) ?? this.getAttribute("data-" + name) ?? fallback;
  }
  get section() {
    const s = this._attr("section", "tutorials").toLowerCase();
    return SECTIONS.includes(s) ? s : "tutorials";
  }
  get base() {
    // normalise: strip a trailing slash so we can append cleanly
    return this._attr("base", "").replace(/\/$/, "");
  }
  _home() {
    return resolveHref("home", this.base);
  }
  _href(section) {
    return resolveHref(section, this.base);
  }

  connectedCallback() {
    this._render();
    this.shadowRoot.getElementById("theme").addEventListener("click", this._onThemeClick);
    this.shadowRoot.getElementById("ctx").addEventListener("click", this._onCtxClick);
    this.shadowRoot.getElementById("brand").addEventListener("click", this._onBrandClick);
    this.shadowRoot.getElementById("more").addEventListener("click", this._onMore);
    window.addEventListener("storage", this._onStorage);
    document.addEventListener("keydown", this._onKey);
    this._syncTheme();
  }

  disconnectedCallback() {
    window.removeEventListener("storage", this._onStorage);
    document.removeEventListener("keydown", this._onKey);
  }

  attributeChangedCallback() {
    if (this.isConnected) this._render();
  }

  _render() {
    const root = this.shadowRoot;

    // Brand → landing hub (home), with optional suffix.
    const brand = root.getElementById("brand");
    brand.href = this._home();
    const suffix = root.getElementById("suffix");
    const sfx = this._attr("suffix", "");
    suffix.hidden = !sfx;
    suffix.textContent = sfx;

    // Version label (e.g. "v0.1.0").
    const version = root.getElementById("version");
    const ver = this._attr("version", "");
    version.hidden = !ver;
    version.textContent = ver;

    // Context switcher.
    const ctx = root.getElementById("ctx");
    const active = this.section;
    const labEngine = this._attr("lab-engine", "");
    ctx.innerHTML = SECTIONS.map((s) => {
      const cur = s === active ? ' aria-current="page"' : "";
      // The Lab honours a starting `?engine=` (its own URL parsing) — forward it.
      const eng = s === "lab" && labEngine ? `?engine=${encodeURIComponent(labEngine)}` : "";
      return `<a href="${this._href(s)}${eng}" data-section="${s}"${cur}>${LABELS[s]}</a>`;
    }).join("");

    // Search affordance — defaults to the spec index (Pagefind lives there).
    const search = root.getElementById("search");
    search.href = this._attr("search", `${this.base}/spec/`);
    search.title = "Search the FlatBars docs";

    // GitHub.
    root.getElementById("gh").href = this._attr("repo", DEFAULT_REPO);
  }

  // ── theme ──
  _currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }
  _syncTheme() {
    const cur = this._currentTheme();
    this.shadowRoot.querySelectorAll("#theme button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.val === cur));
    });
  }
  _setTheme(val) {
    document.documentElement.dataset.theme = val;
    try { localStorage.setItem(THEME_KEY, val); } catch (e) {}
    this._syncTheme();
    this.dispatchEvent(new CustomEvent("flatbars:themechange", {
      detail: { theme: val }, bubbles: true, composed: true,
    }));
  }
  _onThemeClick(e) {
    const btn = e.target.closest("button[data-val]");
    if (btn) this._setTheme(btn.dataset.val);
  }
  _onStorage(e) {
    // Another subsite/tab changed the theme — follow it.
    if (e.key === THEME_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      document.documentElement.dataset.theme = e.newValue;
      this._syncTheme();
    }
  }

  // ── context navigation ──
  // Fire a cancelable flatbars:navigate so a host router can intercept; if it
  // calls preventDefault() we stop the anchor's default navigation.
  _navigate(section, href, anchorEvent) {
    const ev = new CustomEvent("flatbars:navigate", {
      detail: { section, href }, bubbles: true, composed: true, cancelable: true,
    });
    if (!this.dispatchEvent(ev)) anchorEvent.preventDefault();
  }
  _onCtxClick(e) {
    const a = e.target.closest("a[data-section]");
    if (!a) return;
    this._navigate(a.dataset.section, a.getAttribute("href"), e);
  }
  _onBrandClick(e) {
    // The wordmark is "home" navigation too.
    this._navigate("home", this._home(), e);
  }

  // ── responsive menu + keyboard ──
  _onMore() {
    const tools = this.shadowRoot.getElementById("tools");
    const more = this.shadowRoot.getElementById("more");
    const open = tools.hasAttribute("hidden");
    tools.toggleAttribute("hidden", !open);
    more.setAttribute("aria-expanded", String(open));
  }
  _onKey(e) {
    // "/" focuses search (unless typing in a field).
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.shadowRoot.getElementById("search").focus();
    }
  }
}

// Guard the define so the module is also importable in plain Node (tests reach
// the exported pure helpers; `customElements`/`HTMLElement` are absent there).
if (typeof customElements !== "undefined" && !customElements.get("flatbars-topbar")) {
  customElements.define("flatbars-topbar", FlatBarsTopbar);
}

export { FlatBarsTopbar };
