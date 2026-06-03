// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Registers the bundled TextMate fallback grammar (ADR-017's floor) so FlatBars
 * files get coloured even without the LSP — Community IDEs, first paint, a server
 * that hasn't attached. The grammar ships as a VS Code-style bundle in resources;
 * extract it once to a temp dir and hand the path to the TextMate engine.
 */
class FlatBarsTextMateBundleProvider : TextMateBundleProvider {
  override fun getBundles(): List<TextMateBundleProvider.PluginBundle> =
    listOf(TextMateBundleProvider.PluginBundle("FlatBars", extractBundle()))

  private fun extractBundle(): Path {
    cached?.let { return it }
    return synchronized(this) {
      cached ?: run {
        val dir = Files.createTempDirectory("flatbars-textmate")
        for (name in BUNDLE_FILES) {
          val stream = javaClass.getResourceAsStream("/textmate-bundle/$name")
            ?: error("FlatBars TextMate bundle resource missing: $name (run scripts/sync-assets.mjs)")
          stream.use { Files.copy(it, dir.resolve(name), StandardCopyOption.REPLACE_EXISTING) }
        }
        cached = dir
        dir
      }
    }
  }

  companion object {
    private val BUNDLE_FILES = listOf("package.json", "flatbars.tmLanguage.json", "language-configuration.json")
    @Volatile private var cached: Path? = null
  }
}
