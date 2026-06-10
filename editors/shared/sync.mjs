// SPDX-License-Identifier: Apache-2.0
//
// Shared, pinned packaging helpers for the editor integrations (ADR-017, blocker
// 3). The VS Code extension and the JetBrains plugin each assemble the SAME
// self-contained `flatbars-lsp` server with esbuild; this module is the one place
// that bundle step and the editor language set live, so the two packagers cannot
// drift and cannot float onto an unpinned esbuild.
import { resolve } from "node:path";

// The shipped plugin version. Single source for VS Code's package.json, the
// JetBrains Gradle build, the LSP server package, and every other place that
// would otherwise hand-replicate it. Bump here and run `npm run gen:editors-manifests`
// + `npm run check:plugin-version` to validate the propagation.
export const PLUGIN_VERSION = "0.1.0";

// Pinned esbuild version — the same one `gen:bundle` pins for the engine bundle
// (package.json: `npx esbuild@0.28.0`). One esbuild across the repo keeps the
// shipped server bytes reproducible. Bump here AND in the gen:bundle script
// together.
export const ESBUILD_VERSION = "0.28.0";

export function assertEsbuildVersion(esbuild) {
  if (esbuild.version !== ESBUILD_VERSION) {
    throw new Error(
      `esbuild ${esbuild.version} is installed but the editor packagers pin ${ESBUILD_VERSION} ` +
        `(see editors/shared/sync.mjs). Install the pinned version (npm i -D -E esbuild@${ESBUILD_VERSION}) ` +
        `or, if the bump is intended, update ESBUILD_VERSION here and the gen:bundle script together.`,
    );
  }
}

// Bundle the engine-backed LSP server to one self-contained CJS file. CJS output:
// the server embeds vscode-languageserver, which is CJS and dynamically `require`s
// node builtins — that breaks under an ESM bundle. `repoRoot` is the monorepo root
// (the directory holding `editors/`).
export async function bundleServer(esbuild, { repoRoot, outfile, sourcemap = false }) {
  assertEsbuildVersion(esbuild);
  await esbuild.build({
    entryPoints: [resolve(repoRoot, "editors", "lsp", "bin", "flatbars-lsp.mjs")],
    bundle: true,
    platform: "node",
    format: "cjs",
    sourcemap,
    outfile,
    logLevel: "warning",
  });
}

// The editor language set — one language per surface dialect. Single source for
// the VS Code manifest (asserted by its smoke test) and the JetBrains TextMate
// bundle manifest. All four share the one `source.flatbars` grammar.
//
// Each dialect ships TWO native extensions: the long form (`.rawbars`) and a
// short alias (`.rbars`). ClassicBars and MinBars additionally claim the
// Handlebars / Mustache extensions they're semantically compatible with —
// `.hbs` / `.handlebars` for ClassicBars (Handlebars surface), `.mustache` for
// MinBars (Mustache spec). MaxBars additionally claims `.truss` — the on-disk
// extension for Trussbars templates (the MaxBars→Rust AOT compiler, `trussbars/`);
// a Trussbars template is MaxBars source, so it highlights through the same
// grammar. Users who already have a Handlebars or Mustache extension installed
// should choose one via `files.associations` to disambiguate; the FlatBars plugin
// is happy to defer.
export const LANGUAGES = [
  { id: "rawbars", aliases: ["RawBars"], extensions: [".rawbars", ".rbars"] },
  { id: "minbars", aliases: ["MinBars"], extensions: [".minbars", ".mbars", ".mustache"] },
  { id: "classicbars", aliases: ["ClassicBars"], extensions: [".classicbars", ".fbars", ".hbs", ".handlebars"] },
  { id: "maxbars", aliases: ["MaxBars"], extensions: [".maxbars", ".xbars", ".truss"] },
];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id);
