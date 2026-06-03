// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerSupportProvider

/**
 * Starts flatbars-lsp for FlatBars files (ADR-017). Registered only under the
 * Ultimate-gated optional descriptor (flatbars-lsp.xml), since the platform LSP
 * API is Ultimate-only; Community IDEs fall back to the TextMate bundle.
 */
class FlatBarsLspServerSupportProvider : LspServerSupportProvider {
  override fun fileOpened(
    project: Project,
    file: VirtualFile,
    serverStarter: LspServerSupportProvider.LspServerStarter,
  ) {
    if (FlatBarsSupport.isSupported(file)) {
      serverStarter.ensureServerStarted(FlatBarsLspServerDescriptor(project))
    }
  }
}
