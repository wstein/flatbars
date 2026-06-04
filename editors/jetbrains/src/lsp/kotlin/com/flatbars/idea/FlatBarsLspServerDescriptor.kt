// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor

/**
 * Describes the flatbars-lsp process. The JetBrains LSP client consumes every
 * capability the server advertises — semantic tokens, diagnostics, hover,
 * completion, and the canonicalization code-action quick-fix — automatically and
 * by default (IDEA 2023.3+); none needs an opt-in, and `LspCustomization` is only
 * for *disabling* a feature, so this descriptor just starts the server and says
 * which files it covers. The semantic tokens override the TextMate fallback and
 * correct the stateful regions (set delimiters, dialects, MaxBars operators) a
 * grammar cannot track (ADR-017).
 */
class FlatBarsLspServerDescriptor(project: Project) :
  ProjectWideLspServerDescriptor(project, "FlatBars") {

  override fun isSupportedFile(file: VirtualFile): Boolean = FlatBarsSupport.isSupported(file)

  override fun createCommandLine(): GeneralCommandLine =
    GeneralCommandLine("node", FlatBarsSupport.serverScript().toString())

  // Pass the user's default dialect to the server (parity with the VS Code client).
  // The server uses it for the `.flatbars` umbrella; dialect-specific extensions
  // resolve from the file name. Read at server start, like the VS Code client.
  override fun createInitializationOptions(): Any =
    mapOf("defaultDialect" to FlatBarsSettings.instance.defaultDialect)
}
