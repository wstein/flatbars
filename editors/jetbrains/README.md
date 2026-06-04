# FlatBars for JetBrains IDEs

Syntax support for FlatBars templates (and the Handlebars / Mustache surfaces it
covers) in IntelliJ IDEA, WebStorm, and the other JetBrains IDEs, implementing
ADR-017's two-layer model (`docs/modules/ROOT/pages/adr-0017-editor-support-lsp.adoc`):

- **TextMate grammar — the floor.** Bundled via a `TextMateBundleProvider`, it
  colours the default-delimiter forms in **every** JetBrains IDE, Community
  included. Best-effort and non-authoritative: it leaves set-delimiter regions and
  MaxBars operators plain rather than mis-colouring them.
- **`flatbars-lsp` semantic tokens — the ceiling.** On IntelliJ **Ultimate**
  (2023.2+, which has the platform LSP API), the plugin starts the same
  engine-backed server the VS Code extension ships; the IDE consumes its semantic
  tokens automatically and they **override** the grammar, correcting the stateful
  regions a grammar cannot track. The engine always wins where it runs.

The server is the committed `flatbars-js` engine bundle run as a language server —
no second grammar to drift.

## Building

```sh
gradle buildPlugin            # default: the TextMate plugin (works in ALL IDEs)
gradle buildPlugin -PwithLsp  # adds the LSP layer (needs the Ultimate LSP API SDK)
```

`scripts/sync-assets.mjs` runs first (wired into `processResources`) and bundles
the self-contained server into `src/main/resources/server/` and the grammar into a
VS Code-style bundle under `src/main/resources/textmate-bundle/`. Both, plus
`build/` and `.gradle/`, are git-ignored build products. The build needs a **JDK 17
toolchain** (the IntelliJ Platform baseline) — Gradle can auto-provision it.

### Why the LSP layer is opt-in

The IntelliJ Platform LSP API (`com.intellij.platform.lsp`) is **Ultimate-only**
and is not present in the openly-resolvable `ideaIU` SDK artifact, so it cannot be
compiled in a generic build environment. `-PwithLsp` adds the `src/lsp/` source set
and resources (`FlatBarsLspServerSupportProvider`, `FlatBarsLspServerDescriptor`,
`flatbars-lsp.xml`) and injects the Ultimate-gated optional dependency into
`plugin.xml`; it requires a build environment whose SDK provides the LSP API. The
default build deliberately omits it so the TextMate plugin builds anywhere.

## Verification

The repo's offline gate (`npm run test:jetbrains`, in `npm test`) needs no JVM: it
drives the **bundled server** over real LSP, asserts the synced grammar equals the
canonical one, and checks the descriptors register the right extension points. The
full `gradle buildPlugin -PwithLsp` (the TextMate floor **and** the Ultimate-only
LSP layer) compiles and packages against the real IntelliJ IDEA Ultimate 2024.2 SDK
in CI — `.github/workflows/editors.yml`, on JDK 17 with a provisioned Gradle (there
is no wrapper in-repo).

## Status / follow-ups

Marketplace publishing and a live-IDE check of the LSP override *running* inside a
real IntelliJ (the CI build compiles it; it does not launch an IDE) are tracked
follow-ups. Diagnostics ship from the recovering parser (ADR-023); hover/completion
remain the open follow-on.
