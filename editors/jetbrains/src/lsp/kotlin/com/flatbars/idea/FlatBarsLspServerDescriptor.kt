// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor

/**
 * Describes the flatbars-lsp process. The JetBrains LSP client consumes semantic
 * tokens automatically from the server's advertised `semanticTokensProvider`
 * capability — no opt-in needed — so this descriptor only has to start the server
 * and say which files it covers. Those tokens override the TextMate fallback and
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
