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

// The editor language set. The VS Code / JetBrains plugins are **Trussbars-only**: one
// language for `.truss` templates (the production Trussbars engine — the MaxBars→Rust AOT
// compiler, `trussbars/`). The other surfaces (RawBars / MinBars / ClassicBars / MaxBars)
// remain first-class in the engine and the FlatBars Lab, but are NOT shipped as editor
// languages — the extensions present explicitly as Trussbars. Single source for the VS
// Code manifest (asserted by its smoke test) and the JetBrains TextMate bundle manifest;
// it uses the one `source.flatbars` grammar. Internally the LSP tokenizes / diagnoses a
// `trussbars` document with the engine's `maxbars` dialect (Trussbars' surface).
export const LANGUAGES = [
  { id: "trussbars", aliases: ["Trussbars"], extensions: [".truss"] },
];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id);
