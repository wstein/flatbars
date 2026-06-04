// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.ComboBox
import java.awt.FlowLayout
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

/**
 * Settings ▸ Languages & Frameworks ▸ FlatBars: pick the default dialect for the
 * `.flatbars` umbrella extension. Mirrors the VS Code `flatbars.defaultDialect`
 * setting. Registered only on the Ultimate LSP path (flatbars-lsp.xml), since the
 * dialect only matters to the engine-backed server; the change takes effect for
 * servers started afterwards (reopen a file / restart, like the VS Code client,
 * which reads its setting at activation).
 */
class FlatBarsConfigurable : Configurable {
  private var combo: ComboBox<String>? = null

  override fun getDisplayName(): String = "FlatBars"

  override fun createComponent(): JComponent {
    val box = ComboBox(FlatBarsSettings.DIALECTS)
    box.selectedItem = FlatBarsSettings.instance.defaultDialect
    combo = box
    val panel = JPanel(FlowLayout(FlowLayout.LEFT))
    panel.add(JLabel("Default dialect for .flatbars files:"))
    panel.add(box)
    return panel
  }

  override fun isModified(): Boolean = combo?.selectedItem != FlatBarsSettings.instance.defaultDialect

  override fun apply() {
    FlatBarsSettings.instance.defaultDialect = combo?.selectedItem as? String ?: FlatBarsSettings.DEFAULT_DIALECT
  }

  override fun reset() {
    combo?.selectedItem = FlatBarsSettings.instance.defaultDialect
  }

  override fun disposeUIResources() {
    combo = null
  }
}
