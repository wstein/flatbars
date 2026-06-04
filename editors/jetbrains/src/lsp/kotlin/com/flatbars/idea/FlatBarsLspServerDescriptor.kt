// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import java.io.IOException

/**
 * Describes the flatbars-lsp process. The JetBrains LSP client consumes every
 * capability the server advertises — semantic tokens, diagnostics, hover,
 * completion, codeAction, foldingRange, documentSymbol, formatting — automatically
 * (IDEA 2023.3+); none needs an opt-in, so this descriptor just starts the server
 * and says which files it covers. The semantic tokens override the TextMate
 * fallback and correct the stateful regions (set delimiters, dialects, MaxBars
 * operators) a grammar cannot track (ADR-017). See ADR-026 for the full capability
 * matrix and the principled omissions (definition / references / rename).
 *
 * `node` is looked up on `PATH`; if missing the user gets a single dismissable
 * notification with a link to the FlatBars Configurable for a node path override.
 */
class FlatBarsLspServerDescriptor(project: Project) :
  ProjectWideLspServerDescriptor(project, "FlatBars") {

  override fun isSupportedFile(file: VirtualFile): Boolean = FlatBarsSupport.isSupported(file)

  override fun createCommandLine(): GeneralCommandLine {
    val node = FlatBarsSupport.resolveNode() ?: run {
      notifyNodeMissing()
      throw IOException(
        "FlatBars language server requires Node.js on PATH (or a configured override). " +
          "See Settings ▸ Languages & Frameworks ▸ FlatBars.",
      )
    }
    return GeneralCommandLine(node, FlatBarsSupport.serverScript().toString())
  }

  // Pass the user's default dialect to the server (parity with the VS Code client).
  // The server uses it as a fallback when the URI extension does not resolve;
  // dialect-specific extensions resolve from the file name. Read at server start.
  override fun createInitializationOptions(): Any =
    mapOf("defaultDialect" to FlatBarsSettings.instance.defaultDialect)

  private fun notifyNodeMissing() {
    NotificationGroupManager.getInstance()
      .getNotificationGroup("FlatBars")
      .createNotification(
        "Node.js not found",
        "FlatBars language server needs `node` on PATH. " +
          "Install Node.js 18+ or configure a custom path under Settings ▸ Languages & Frameworks ▸ FlatBars.",
        NotificationType.ERROR,
      )
      .addAction(object : AnAction("Open FlatBars Settings") {
        override fun actionPerformed(e: AnActionEvent) {
          ShowSettingsUtil.getInstance().showSettingsDialog(project, FlatBarsConfigurable::class.java)
        }
      })
      .notify(project)
  }
}
