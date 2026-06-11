// SPDX-License-Identifier: Apache-2.0
//
// The project model (Phase 6 of PLAN-registry-local-trussbars.md) — the toy→workbench
// jump. Given a FileProvider that backs `list` + `read` (the `local` localhost bridge,
// or `fs-access`), it walks the launch directory, classifies the files, and assembles a
// workspace the Lab loads exactly like an example: a `main` template, its sibling
// templates as partials (keyed by relative path), and a data file. Multi-file partials
// are resolved across the whole tree (not a flat example folder).
//
// Pure but for the injected provider, so it is unit-testable with a fake.

// Template surfaces the Lab understands (the dialect file extensions + common ones).
const TEMPLATE_EXTS = new Set(["hbs", "mustache", "stem", "rawbars", "maxbars", "truss", "django", "handlebars", "html", "htm", "md"]);
// Data documents (the first one found seeds the data pane).
const DATA_EXTS = new Set(["json", "yaml", "yml", "toml"]);
// Directories never worth walking in a template project.
const IGNORE_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "dist", "build", "target", "output", ".cache", "vendor"]);

const extOf = (path) => {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1).toLowerCase() : "";
};
// A partial's name is its path without the template extension (so `cards/item.hbs` is
// the partial `cards/item` — the cross-tree key).
const partialKey = (path) => path.replace(/\.[^.]+$/, "");

// Walk the provider tree breadth-unimportant, collecting file paths (`/`-relative to the
// root). Bounded by `maxFiles` so a mistargeted huge directory can't hang the Lab; the
// cap is surfaced (truncated:true) rather than silently swallowing files.
export async function walkTree(provider, { root = ".", maxFiles = 2000 } = {}) {
  const files = [];
  let truncated = false;
  const visit = async (dir) => {
    if (truncated) return;
    let entries;
    try { entries = await provider.list(dir); } catch { return; }
    for (const e of entries) {
      const rel = dir === "." || dir === "" ? e.name : `${dir}/${e.name}`;
      if (e.kind === "dir") {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith(".")) await visit(rel);
      } else {
        if (files.length >= maxFiles) { truncated = true; return; }
        files.push(rel);
      }
    }
  };
  await visit(root);
  return { files, truncated };
}

// Classify a flat file list into templates + data documents (sorted for determinism).
export function classify(files) {
  const templates = files.filter((f) => TEMPLATE_EXTS.has(extOf(f))).sort();
  const dataFiles = files.filter((f) => DATA_EXTS.has(extOf(f))).sort();
  return { templates, dataFiles };
}

// Pick the entry template: prefer one named `index`/`main`/`template` (any depth),
// else the shallowest, alphabetically-first template.
export function pickMain(templates) {
  const named = templates.find((t) => /(^|\/)(index|main|template)\.[^.]+$/.test(t));
  if (named) return named;
  return [...templates].sort((a, b) => {
    const da = a.split("/").length, db = b.split("/").length;
    return da !== db ? da - db : a.localeCompare(b);
  })[0];
}

// Pick the data document: prefer `data.*`, else the first.
export function pickData(dataFiles) {
  return dataFiles.find((f) => /(^|\/)data\.[^.]+$/.test(f)) || dataFiles[0] || null;
}

// Load a workspace from the provider: read the main template, its sibling templates as
// partials, and the data document. Returns the shape the Lab maps onto its tabs/data —
// `tabs[0]` is `main`, the rest are partials keyed by cross-tree path. Throws a clear
// error if the directory holds no template.
export async function loadProject(provider, { root = ".", maxFiles = 2000 } = {}) {
  const { files, truncated } = await walkTree(provider, { root, maxFiles });
  const { templates, dataFiles } = classify(files);
  if (!templates.length) {
    throw new Error("no template files found in this folder (looked for .hbs/.mustache/.stem/.maxbars/.truss/…)");
  }
  const mainPath = pickMain(templates);
  const partialPaths = templates.filter((t) => t !== mainPath);
  const dataPath = pickData(dataFiles);

  const [mainSource, ...partialSources] = await Promise.all([
    provider.readText(mainPath),
    ...partialPaths.map((p) => provider.readText(p)),
  ]);
  const dataSource = dataPath ? await provider.readText(dataPath) : "";

  const tabs = [{ name: "main", path: mainPath, source: mainSource }];
  partialPaths.forEach((p, i) => tabs.push({ name: partialKey(p), path: p, source: partialSources[i] }));

  return {
    root,
    mainPath,
    tabs,
    dataPath,
    dataSource,
    dataKind: dataPath ? extOf(dataPath) : "",
    files,
    truncated,
  };
}
