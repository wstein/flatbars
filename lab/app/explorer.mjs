// SPDX-License-Identifier: Apache-2.0
//
// The Lab's file explorer + editor tab strips (Phase 0) — the largest UI cluster:
// the explorer tree (renderExplorerImpl), inline rename (beginExpRename), and the
// two VS Code-style tab strips (renderTmplStrip / renderDataStrip), orchestrated by
// renderTabs. Reads ctx.state.* directly (the migration payoff); the host handlers
// (select*/add*/remove*/closeEditor/overlayByName/markCustom/scheduleRun/
// validateOverlayName), the live templateMode getter, and the TEMPLATE_EXT/ENGINE
// constants are injected. The explorer-private state (expCollapsed, pendingExpRename,
// expRenameFinishing, renderingExplorer) and the EXP_* constants live here.

import { byId } from "./dom.mjs";

export function createExplorer(ctx, host) {
  const {
    selectTemplateTab, addPartial, removeTab, selectDataTab, addOverlay, removeOverlay,
    selectTransformTab, selectHelpersTab, selectCatalogTab, selectConfigTab,
    closeEditor, overlayByName, markCustom, scheduleRun, validateOverlayName,
    getTemplateMode, TEMPLATE_EXT, ENGINE,
  } = host;

        const EXP_LS = "stem.explorer.collapsed";
        let expCollapsed = (() => {
          try { return new Set(JSON.parse(localStorage.getItem(EXP_LS) || "[]")); }
          catch { return new Set(); }
        })();
        function saveExpCollapsed() {
          try { localStorage.setItem(EXP_LS, JSON.stringify([...expCollapsed])); } catch {}
        }
        // When non-null, `renderExplorer` opens the matching row in inline-rename
        // mode after the tree is built. `addPartial` / `addOverlay` set this so a
        // freshly-created file lands ready to be named, in the explorer — no
        // detour through the editor tab.
        let pendingExpRename = null;
        // Set by beginExpRename's finish() so the immediate rebuild that follows an
        // explicit commit/cancel does NOT reopen the rename input (see finish()).
        let expRenameFinishing = false;
        // True while renderExplorer is rebuilding the tree. Tearing down a focused
        // `.exp-rename` input fires its blur listener synchronously; if that blur
        // committed and re-rendered, renderExplorer → finish → blur → renderExplorer
        // would recurse until the stack overflows. The blur listener checks this and
        // skips while a rebuild is in flight (a real click-away blur still commits).
        let renderingExplorer = false;
        // Which key starts an inline rename on a focused Explorer row. Mirrors the
        // host OS file managers: Enter on macOS (Finder), F2 on Windows/Linux. F2
        // is also accepted on macOS since it's the universal rename key and does no
        // harm there. The double-click affordance was dropped in favour of this.
        const IS_MAC = /mac|iphone|ipad/i.test(
          (navigator.platform || "") + " " + (navigator.userAgent || "")
        );
        const EXP_RENAME_KEYS = IS_MAC ? ["Enter", "F2"] : ["F2"];
        const EXP_ICONS = {
          stem: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L2.5 8 6 12.5"/><path d="M10 3.5L13.5 8 10 12.5"/></svg>',
          yaml: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="4" rx="4.5" ry="1.8"/><path d="M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4"/><path d="M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8"/></svg>',
          fn:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13c0-7 .5-10 3-10 1 0 1.5.5 1.7 1.2"/><path d="M3.5 7.2h5"/></svg>',
          cfg:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>',
        };
        const EXP_GROUP_KEYS = ["template", "partials", "data", "overlays", "transform", "helpers", "localization", "config"];

        function renderExplorer() {
          if (renderingExplorer) return; // re-entrancy guard (see renderingExplorer)
          renderingExplorer = true;
          try { renderExplorerImpl(); }
          finally { renderingExplorer = false; }
        }
        function renderExplorerImpl() {
          const tree = byId("explorer-tree");
          if (!tree) return;
          // If a rename input is currently open, treat its associated file as a
          // pending rename target for the rebuild so the tree refresh doesn't
          // close the edit mid-typing.
          const activeRename = tree.querySelector(".exp-rename");
          const activeRow = activeRename?.closest(".exp-row");
          const activeRenameFile = activeRow?._expFile;
          if (activeRenameFile?.renameValue && !pendingExpRename && !expRenameFinishing) {
            pendingExpRename = activeRenameFile.renameValue;
          }
          // One-shot: only the rebuild directly following finish() skips the reopen.
          expRenameFinishing = false;
          const tmplActive = ctx.state.activeView === "tmpl" && getTemplateMode() === "tmpl";
          const xfActive   = ctx.state.activeView === "tmpl" && getTemplateMode() === "transform";
          const hlpActive  = ctx.state.activeView === "tmpl" && getTemplateMode() === "helpers";
          const cfgNonDefault = !!ctx.state.escapeMode || !ctx.state.standalone || ctx.state.allowList !== null;

          const groups = [
            { key: "template", label: "TEMPLATE", files: [
              { icon: "stem", name: "main." + TEMPLATE_EXT, active: tmplActive && ctx.state.activeTabIdx === 0,
                dirty: !!(ctx.state.tabs[0] && ctx.state.tabs[0].dirty), title: "entry template", on: () => selectTemplateTab(0) },
            ]},
            { key: "partials", label: "PARTIALS", add: addPartial, addTitle: "New partial",
              files: ctx.state.tabs.slice(1).map((t, idx) => {
                const i = idx + 1;
                return { icon: "stem", name: (t.name || "(unnamed)") + "." + TEMPLATE_EXT,
                  active: tmplActive && ctx.state.activeTabIdx === i, dirty: !!t.dirty,
                  title: `partial · {{partial "${t.name}"}}`,
                  on: () => selectTemplateTab(i),
                  renameValue: t.name, onDelete: () => removeTab(i),
                  onRename: (v) => {
                    v = v.trim();
                    if (!v || ctx.state.tabs.some((o, j) => j !== i && o.name === v)) return false;
                    const prev = t.name; t.name = v;
                    const k = ctx.state.openEditors.indexOf(prev); if (k >= 0) ctx.state.openEditors[k] = v;
                    markCustom(); renderTabs(); scheduleRun(); return true;
                  } };
              })},
            { key: "data", label: "DATA", files: [
              { icon: "yaml", name: "data.yaml", active: ctx.state.activeView === "data" && ctx.state.dataTab === "edit" && ctx.state.dataFile === "data",
                dirty: ctx.state.yamlDirty, title: "root data context · @root", on: () => selectDataTab("data") },
            ]},
            { key: "overlays", label: "OVERLAYS", add: addOverlay, addTitle: "New overlay",
              files: ctx.state.dataOverlays.map((ov, oi) => (
                { icon: "yaml", name: ov.name + ".yaml",
                  active: ctx.state.activeView === "data" && ctx.state.dataTab === "edit" && ctx.state.dataFile === ov.name, dirty: !!ov.dirty,
                  title: `overlay · mounts at ${ov.name.replace(/\//g, ".")}`, on: () => selectDataTab(ov.name),
                  renameValue: ov.name, onDelete: () => removeOverlay(oi),
                  onRename: (v) => {
                    v = v.trim();
                    const err = validateOverlayName(v);
                    const collision = ctx.state.dataOverlays.some((o, j) => j !== oi && o.name === v);
                    if (err || collision) return false;
                    if (ctx.state.dataFile === ov.name) ctx.state.dataFile = v;
                    ov.name = v; ov.dirty = true; markCustom(); scheduleRun(); return true;
                  } }
              ))},
            // The "Controller" editor. On the ClassicBars surface it is the custom-helper
            // file (registerHelper source, run in the Worker sandbox — ADR-018); on
            // The transform is a data → view-model preprocess (JSONata), all engines.
            { key: "transform", label: "TRANSFORM", files: [
              { icon: "fn",
                name: "transform.jsonata",
                active: xfActive, dirty: ctx.state.transformDirty,
                title: "data → view-model transform (JSONata)",
                on: () => selectTransformTab() },
            ]},
            // Custom helpers/operations (ADR-018; ADR-019 for the native dialects)
            // are a separate editor that extends the engine, not the data — available
            // for every FlatBars dialect (RawBars/ClassicBars/MaxBars), MinBars excluded
            // (Mustache is logic-less). The Worker routes to the dialect's registrar.
            ...(ENGINE !== "minbars" ? [{ key: "helpers", label: "HELPERS", files: [
              { icon: "fn",
                name: "helpers.js",
                active: hlpActive, dirty: ctx.state.helpersDirty,
                title: "custom helpers — registerHelper(name, fn[, arity]); runs in a sandboxed Worker (ADR-018)",
                on: () => selectHelpersTab() },
            ]}] : []),
            // i18n message catalog (ADR-029) — every surface except MinBars (no t there).
            ...(ENGINE === "minbars" ? [] : [{ key: "localization", label: "LOCALIZATION", files: [
              { icon: "yaml", name: "catalog.yaml", active: ctx.state.activeView === "catalog", dirty: ctx.state.catalogDirty,
                title: "i18n message catalog (locale → key → message); the locale is set in config.yaml",
                on: () => selectCatalogTab() },
            ]}]),
            { key: "config", label: "CONFIG", files: [
              { icon: "cfg", name: "config.yaml", active: ctx.state.activeView === "config", dirty: cfgNonDefault,
                title: "render config — escape · trim · allow-list · i18n locale · MinBars truthiness · analyse pathSchema",
                on: () => selectConfigTab() },
            ]},
          ];

          tree.innerHTML = "";
          for (const g of groups) {
            const collapsed = expCollapsed.has(g.key);
            const gh = document.createElement("div");
            gh.className = "exp-gh";
            gh.innerHTML =
              `<svg class="exp-caret${collapsed ? " closed" : ""}" viewBox="0 0 12 12"><path d="M3 2l5 4-5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
              `<span class="exp-glabel">${g.label}</span>`;
            // Addable groups get an always-visible ＋; the count is always last so
            // counts align in a consistent right-hand column across every group.
            if (g.add) {
              const add = document.createElement("button");
              add.className = "exp-add"; add.type = "button"; add.title = g.addTitle || "New"; add.textContent = "＋";
              add.addEventListener("click", (e) => { e.stopPropagation(); g.add(); });
              gh.append(add);
            }
            const count = document.createElement("span");
            count.className = "exp-count"; count.textContent = g.files.length;
            gh.append(count);
            gh.addEventListener("click", () => {
              if (expCollapsed.has(g.key)) expCollapsed.delete(g.key); else expCollapsed.add(g.key);
              saveExpCollapsed(); renderExplorer();
            });

            const rows = document.createElement("div");
            rows.className = "exp-rows"; rows.hidden = collapsed;
            if (g.files.length === 0) {
              const empty = document.createElement("div");
              empty.className = "exp-empty";
              empty.textContent = g.key === "partials" ? "No partials yet" : g.key === "overlays" ? "No overlays yet" : "—";
              rows.append(empty);
            }
            for (const f of g.files) {
              const row = document.createElement("div");
              row.className = "exp-row" + (f.active ? " active" : "");
              row.title = f.title || f.name;
              row._expFile = f; // pendingExpRename lookup walks rows by file descriptor
              const ico = document.createElement("span");
              ico.className = "exp-ico t-" + f.icon; ico.innerHTML = EXP_ICONS[f.icon];
              const nm = document.createElement("span");
              nm.className = "exp-name"; nm.textContent = f.name;
              row.append(ico, nm);
              // Highlight files modified from their original/default state: bold
              // name + a small neutral "M" marker (the old dirty ● dot was dropped;
              // this is the replacement). Driven by the same f.dirty flags.
              if (f.dirty) {
                row.classList.add("mod");
                const m = document.createElement("span");
                m.className = "exp-m"; m.textContent = "M"; m.title = "Modified";
                row.append(m);
              }
              // Inline filename rename for partials/overlays is keyboard-driven
              // (F2 on Windows/Linux, Enter on macOS) on the focused row — no
              // double-click. Renameable rows are focusable; opening one from the
              // Explorer keeps keyboard focus on the row (VS Code-style) so the
              // rename key works immediately. f.on() re-renders the tree, so after
              // it we re-focus whichever row ends up active.
              if (f.onRename) {
                row.tabIndex = 0;
                row.addEventListener("click", () => {
                  f.on();
                  tree.querySelector(".exp-row.active")?.focus();
                });
                row.addEventListener("keydown", (e) => {
                  if (EXP_RENAME_KEYS.includes(e.key)) {
                    e.preventDefault();
                    const liveNm = (e.currentTarget).querySelector(".exp-name");
                    if (liveNm) beginExpRename(liveNm, f);
                  }
                });
              } else {
                row.addEventListener("click", f.on);
              }
              // Delete the file (× on hover) — distinct from closing an editor tab.
              if (f.onDelete) {
                const del = document.createElement("button");
                del.className = "exp-del"; del.type = "button"; del.title = "Delete file"; del.textContent = "×";
                del.addEventListener("click", (e) => { e.stopPropagation(); f.onDelete(); });
                row.append(del);
              }
              rows.append(row);
            }
            tree.append(gh, rows);
          }

          // After the tree is built, if a create-flow asked us to start renaming
          // a specific file, find its row's name span and open it. Clears even
          // when the row isn't found so a stale request can't survive a re-render.
          if (pendingExpRename) {
            const want = pendingExpRename;
            pendingExpRename = null;
            const rows = tree.querySelectorAll(".exp-row");
            for (const row of rows) {
              const nm = row.querySelector(".exp-name");
              const f = row._expFile;
              if (nm && f && f.renameValue === want && f.onRename) {
                beginExpRename(nm, f);
                break;
              }
            }
          }
        }

        // Inline filename rename for an explorer row (partials / overlays). Swaps
        // the name label for a text input; Enter/blur commits via f.onRename (which
        // returns false to reject invalid/duplicate names), Esc cancels.
        function beginExpRename(nm, f) {
          const input = document.createElement("input");
          input.className = "exp-rename";
          input.value = f.renameValue;
          input.spellcheck = false;
          nm.replaceWith(input);
          input.focus(); input.select();
          let done = false;
          const finish = (save) => {
            if (done) return; done = true;
            if (save) f.onRename(input.value);
            renderExplorer();
          };
          input.addEventListener("click", (e) => e.stopPropagation());
          input.addEventListener("keydown", (e) => {
            // Enter commits, Escape cancels — both explicitly CLOSE the editor.
            // renderExplorer() captures a live `.exp-rename` at its top and re-arms
            // `pendingExpRename` so an incidental rebuild (the debounced run, or the
            // blur from selectDataTab's editor-focus during auto-open) keeps the edit
            // alive. But on an explicit Enter/Escape that same capture would
            // immediately REOPEN the input — so accepting the default name (Enter on
            // an unchanged name) or cancelling (Escape) looked like it did nothing.
            // The one-shot flag suppresses the reopen for this commit/cancel only; a
            // plain blur keeps the normal reopen behaviour (the auto-open dance).
            if (e.key === "Enter") { e.preventDefault(); expRenameFinishing = true; finish(true); }
            else if (e.key === "Escape") { e.preventDefault(); expRenameFinishing = true; finish(false); }
          });
          input.addEventListener("blur", () => finish(true));
        }

        // ── Tabs ──────────────────────────────────────────────────────────
        // A close-button (×) for an open-editor tab.
        function tabCloseBtn(onClose) {
          const x = document.createElement("span");
          x.className = "close"; x.title = "Close editor — the file stays in the explorer";
          x.textContent = "×";
          x.addEventListener("click", (e) => { e.stopPropagation(); onClose(); });
          return x;
        }

        // Repaint both editor tab strips (top = template + transform; bottom =
        // data + overlays + config) and the explorer. The two panes are visible at
        // once, each editing its own active file.
        function renderTabs() {
          renderTmplStrip();
          renderDataStrip();
          renderExplorer();
        }

        // TOP strip (#tmpl-tabs): the template files (main + partials) and the
        // `transform` controller — everything edited in `templateView`.
        function renderTmplStrip() {
          const bar = byId("tmpl-tabs");
          bar.innerHTML = "";
          for (const key of ctx.state.openEditors) {
            if (key === "transform") {
              const isTfm = ctx.state.activeView === "tmpl" && getTemplateMode() === "transform";
              const tfm = document.createElement("div");
              tfm.className = "tab tab-transform" + (isTfm ? " active" : "");
              tfm.title = "data → view-model transform (JSONata)";
              tfm.append(document.createTextNode("transform.jsonata"));
              tfm.addEventListener("click", selectTransformTab);
              tfm.append(tabCloseBtn(() => closeEditor("transform")));
              bar.append(tfm);
              continue;
            }
            if (key === "helpers") {
              const isHlp = ctx.state.activeView === "tmpl" && getTemplateMode() === "helpers";
              const hlp = document.createElement("div");
              hlp.className = "tab tab-transform" + (isHlp ? " active" : "");
              hlp.title = "custom helpers — registerHelper(name, fn[, arity]); runs in a sandboxed Worker (ADR-018)";
              hlp.append(document.createTextNode("helpers.js"));
              hlp.addEventListener("click", selectHelpersTab);
              hlp.append(tabCloseBtn(() => closeEditor("helpers")));
              bar.append(hlp);
              continue;
            }
            if (key === "config" || key === "catalog" || key === "data" || overlayByName(key)) continue; // bottom strip
            const i = key === "main" ? 0 : ctx.state.tabs.findIndex((t) => t.name === key);
            if (i < 0) continue; // a partial that no longer exists
            const tab = ctx.state.tabs[i];
            const isActive = ctx.state.activeView === "tmpl" && getTemplateMode() === "tmpl" && i === ctx.state.activeTabIdx;
            const t = document.createElement("div");
            t.className = "tab" + (isActive ? " active" : "") + (i === 0 ? " is-main" : "");
            t.title = i === 0 ? "entry template" : `partial · {{partial "${tab.name}"}}`;
            t.addEventListener("click", () => selectTemplateTab(i));
            // Tabs render as plain text — the strip is navigation only; rename lives
            // in the Explorer (PARTIALS group + the rename key).
            t.append(document.createTextNode(
              (i === 0 ? "main" : (tab.name || "(unnamed)")) + "." + TEMPLATE_EXT));
            t.append(tabCloseBtn(() => closeEditor(i === 0 ? "main" : tab.name)));
            bar.append(t);
          }
        }

        // BOTTOM strip (#data-tabs): data.yaml, overlays, and config.yaml —
        // everything edited in the YAML editor `dataView`.
        function renderDataStrip() {
          const bar = byId("data-tabs");
          if (!bar) return;
          bar.innerHTML = "";
          for (const key of ctx.state.openEditors) {
            if (key === "config") {
              const isActive = ctx.state.activeView === "config";
              const t = document.createElement("div");
              t.className = "tab tab-transform" + (isActive ? " active" : "");
              t.title = "render config — escape · trim · allow-list";
              t.append(document.createTextNode("config.yaml"));
              t.addEventListener("click", () => selectConfigTab());
              t.append(tabCloseBtn(() => closeEditor("config")));
              bar.append(t);
              continue;
            }
            if (key === "catalog") {
              const isActive = ctx.state.activeView === "catalog";
              const t = document.createElement("div");
              t.className = "tab tab-transform" + (isActive ? " active" : "");
              t.title = "i18n message catalog (locale → key → message)";
              t.append(document.createTextNode("catalog.yaml"));
              t.addEventListener("click", () => selectCatalogTab());
              t.append(tabCloseBtn(() => closeEditor("catalog")));
              bar.append(t);
              continue;
            }
            if (key !== "data" && !overlayByName(key)) continue; // top strip
            const isOv = key !== "data";
            const isActive = ctx.state.activeView === "data" && ctx.state.dataTab === "edit" && ctx.state.dataFile === key;
            const t = document.createElement("div");
            t.className = "tab" + (isActive ? " active" : "");
            t.title = isOv ? `overlay · mounts at ${key.replace(/\//g, ".")}` : "root data context · @root";
            t.addEventListener("click", () => selectDataTab(key));
            t.append(document.createTextNode(isOv ? key + ".yaml" : "data.yaml"));
            t.append(tabCloseBtn(() => closeEditor(key)));
            bar.append(t);
          }
        }

  return { renderExplorer, renderTabs, renderTmplStrip, renderDataStrip };
}
