// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.vfs.VirtualFile
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/**
 * Shared bits for the FlatBars JetBrains plugin (ADR-017): file-extension
 * recognition and one-time extraction of the bundled, engine-backed server.
 *
 * The extension set is single-sourced via [FlatBarsLanguages] (generated from
 * editors/shared/sync.mjs); never inline an extension here.
 */
object FlatBarsSupport {
  /** True iff the file's extension belongs to a FlatBars dialect. */
  fun isSupported(file: VirtualFile): Boolean =
    file.extension?.lowercase() in FlatBarsLanguages.EXTENSIONS

  @Volatile private var serverPath: Path? = null

  /**
   * Extract `flatbars-lsp.cjs` from plugin resources to a stable, content-addressed
   * path under the IDE's system directory, then return it for `node` to execute.
   * The path includes the bundle's SHA-256 prefix, so upgrading the plugin (which
   * changes the bytes) routes to a fresh file — no `deleteOnExit` race on JVM
   * crash, no stale-server-from-a-prior-version risk, and re-opening the same
   * version reuses the existing extraction.
   */
  fun serverScript(): Path {
    serverPath?.let { return it }
    return synchronized(this) {
      serverPath ?: run {
        val bytes = javaClass.getResourceAsStream("/server/flatbars-lsp.cjs")?.use { it.readAllBytes() }
          ?: error("flatbars-lsp server bundle missing from plugin resources (run scripts/sync-assets.mjs)")
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }.take(16)
        val dir = PathManager.getSystemDir().resolve("flatbars-lsp").resolve(hash)
        Files.createDirectories(dir)
        val out = dir.resolve("flatbars-lsp.cjs")
        if (!Files.exists(out) || Files.size(out) != bytes.size.toLong()) {
          val tmp = Files.createTempFile(dir, "flatbars-lsp.", ".cjs")
          Files.write(tmp, bytes)
          Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
        serverPath = out
        out
      }
    }
  }
}
