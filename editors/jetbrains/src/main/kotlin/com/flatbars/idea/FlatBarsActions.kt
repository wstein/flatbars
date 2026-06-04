// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileEditorManager
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * "Open current template in FlatBars Lab" — deep-links the active editor's
 * contents to the FlatBars Lab playground via the documented `?source=` query
 * parameter (URL-encoded; the Lab seeds its template pane with the value). Only
 * enabled when the active file is a FlatBars document.
 */
class OpenInLabAction : AnAction("Open in FlatBars Lab") {
  override fun update(e: AnActionEvent) {
    val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
    e.presentation.isEnabledAndVisible = file != null && FlatBarsSupport.isSupported(file)
  }

  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
    val text = FileEditorManager.getInstance(project).getSelectedTextEditor()?.document?.text
      ?: String(file.contentsToByteArray())
    val encoded = URLEncoder.encode(text, StandardCharsets.UTF_8)
    BrowserUtil.browse("https://flatbars.dev/lab/?source=$encoded")
  }
}

/**
 * "Show FlatBars catalogue" — points the user at the helper-catalogue doc.
 * A lightweight bridge from the IDE to the project's reference material.
 */
class OpenCatalogueAction : AnAction("Show Helper Catalogue") {
  override fun actionPerformed(e: AnActionEvent) {
    BrowserUtil.browse("https://flatbars.dev/spec/catalog.html")
  }
}

/**
 * "Report a FlatBars issue" — opens the issues tracker with a pre-filled
 * dialect + file-extension context line for triage.
 */
class ReportIssueAction : AnAction("Report a FlatBars Issue") {
  override fun actionPerformed(e: AnActionEvent) {
    val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
    val context = file?.let { " (file: *.${it.extension ?: "?"})" } ?: ""
    BrowserUtil.browse(
      "https://github.com/wstein/flatbars/issues/new?body=" +
        URLEncoder.encode("Describe the issue$context\n\nSteps to reproduce:\n", StandardCharsets.UTF_8),
    )
    NotificationGroupManager.getInstance().getNotificationGroup("FlatBars")
      .createNotification("Issue tracker opened", NotificationType.INFORMATION)
      .notify(e.project)
  }
}
