// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.EditorNotificationProvider
import com.intellij.util.PlatformUtils
import java.util.function.Function
import javax.swing.JComponent

/**
 * On non-Ultimate IDEs, surface a single dismissable banner the first time the
 * user opens a FlatBars file so the absence of diagnostics / hover / completion /
 * the canonicalisation quick-fix is never a silent gap. Ultimate users (LSP path
 * active) see nothing.
 *
 * The notice is per-file and per-session: dismissing it sets a transient key on
 * the file's user-data, so reopening the project clears it.
 */
class FlatBarsCommunityNoticeProvider : EditorNotificationProvider {
  override fun collectNotificationData(
    project: Project,
    file: VirtualFile,
  ): Function<in FileEditor, out JComponent?>? {
    if (!FlatBarsSupport.isSupported(file)) return null
    if (PlatformUtils.isIntelliJ() && ApplicationInfo.getInstance().build.productCode == "IU") return null
    if (file.getUserData(DISMISSED) == true) return null
    return Function { _ ->
      EditorNotificationPanel().apply {
        text = "FlatBars language server requires IntelliJ IDEA Ultimate. " +
          "TextMate syntax highlighting is active here; diagnostics, hover, completion, " +
          "and the canonicalisation quick-fix need Ultimate (2024.2+)."
        createActionLabel("Compare editions") {
          com.intellij.ide.BrowserUtil.browse("https://www.jetbrains.com/idea/buy/")
        }
        createActionLabel("Dismiss") {
          file.putUserData(DISMISSED, true)
          com.intellij.ui.EditorNotifications.getInstance(project).updateNotifications(file)
        }
      }
    }
  }

  private companion object {
    val DISMISSED = Key.create<Boolean>("com.flatbars.idea.communityNoticeDismissed")
  }
}
