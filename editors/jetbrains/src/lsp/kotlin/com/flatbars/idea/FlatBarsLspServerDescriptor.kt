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
}
