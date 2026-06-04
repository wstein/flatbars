// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import javax.swing.JComponent

/**
 * Settings ▸ Languages & Frameworks ▸ FlatBars (Ultimate-only, since the
 * settings only affect the engine-backed server). Two fields:
 *
 *   * Default dialect — fallback for URIs that don't resolve via extension.
 *     Mirrors the VS Code `flatbars.defaultDialect` setting.
 *   * Node executable — blank means "look up `node` on PATH". Overriding lets
 *     users on `nvm` / `volta` / corporate workstations point at a specific
 *     install. Validated on next server start.
 *
 * Both changes take effect for servers started afterwards (reopen the file /
 * restart), the same way the VS Code client reads its settings at activation.
 */
class FlatBarsConfigurable : Configurable {
  private var dialectCombo: ComboBox<String>? = null
  private var nodeField: TextFieldWithBrowseButton? = null

  override fun getDisplayName(): String = "FlatBars"

  override fun createComponent(): JComponent {
    val initialDialect = FlatBarsSettings.instance.defaultDialect
    val initialNode = FlatBarsSettings.instance.nodePath
    val dialect = ComboBox(FlatBarsSettings.DIALECTS).apply { selectedItem = initialDialect }
    val node = TextFieldWithBrowseButton().apply { text = initialNode }
    dialectCombo = dialect
    nodeField = node
    return panel {
      row("Default dialect:") {
        cell(dialect).align(AlignX.LEFT)
      }.comment("Used when the file's URI extension does not pick a dialect on its own.")
      row("Node executable:") {
        cell(node).align(AlignX.FILL)
      }.comment("Leave blank to use <code>node</code> on PATH. Required for the LSP server to start.")
    }
  }

  override fun isModified(): Boolean {
    val s = FlatBarsSettings.instance
    return dialectCombo?.selectedItem != s.defaultDialect ||
      (nodeField?.text ?: "") != s.nodePath
  }

  override fun apply() {
    val s = FlatBarsSettings.instance
    s.defaultDialect = dialectCombo?.selectedItem as? String ?: FlatBarsSettings.DEFAULT_DIALECT
    s.nodePath = nodeField?.text ?: ""
  }

  override fun reset() {
    val s = FlatBarsSettings.instance
    dialectCombo?.selectedItem = s.defaultDialect
    nodeField?.text = s.nodePath
  }

  override fun disposeUIResources() {
    dialectCombo = null
    nodeField = null
  }
}
