// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.vfs.VirtualFile
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Shared bits for the FlatBars JetBrains plugin (ADR-017): the supported file
 * extensions and the one-time extraction of the bundled, engine-backed server so
 * `node` can run it.
 */
object FlatBarsSupport {
  /** The FlatBars surfaces; the LSP resolves the dialect from the extension. */
  val EXTENSIONS = setOf("hbs", "handlebars", "flatbars", "mustache", "rawbars", "maxbars")

  fun isSupported(file: VirtualFile): Boolean = file.extension?.lowercase() in EXTENSIONS

  @Volatile private var serverPath: Path? = null

  /**
   * The flatbars-lsp bundle is shipped inside the plugin jar (resources/server);
   * extract it once to a temp file the spawned `node` process can read.
   */
  fun serverScript(): Path {
    serverPath?.let { return it }
    return synchronized(this) {
      serverPath ?: run {
        val out = Files.createTempDirectory("flatbars-lsp").resolve("flatbars-lsp.cjs")
        val stream = javaClass.getResourceAsStream("/server/flatbars-lsp.cjs")
          ?: error("flatbars-lsp server bundle missing from plugin resources (run scripts/sync-assets.mjs)")
        stream.use { input -> Files.copy(input, out, StandardCopyOption.REPLACE_EXISTING) }
        out.toFile().deleteOnExit()
        serverPath = out
        out
      }
    }
  }
}
