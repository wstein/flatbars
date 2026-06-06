// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.application.ApplicationManager
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/**
 * LSP-layer support for the FlatBars JetBrains plugin (ADR-017): Node executable
 * resolution and one-time extraction of the bundled engine-backed server. Lives
 * in the Ultimate-only `src/lsp` source set. File-extension recognition is
 * [FlatBarsFiles] in `src/main` (the Community paths need it without this layer).
 */
object FlatBarsSupport {
  /**
   * Find the `node` executable to run the LSP server with. Honours the user's
   * explicit override (Settings ▸ FlatBars ▸ Node executable) first; if blank,
   * walks `PATH` for `node` / `node.exe`. Returns null if nothing resolves —
   * callers surface a notification (see FlatBarsLspServerDescriptor).
   *
   * The override is read via service lookup so this stays callable from the
   * Ultimate-only LSP code path; Community paths never call this.
   */
  fun resolveNode(): String? {
    val configured = runCatching {
      ApplicationManager.getApplication()
        ?.getService(FlatBarsSettings::class.java)
        ?.nodePath
    }.getOrNull()?.takeIf { it.isNotBlank() }
    if (configured != null && File(configured).canExecute()) return configured

    val pathEnv = System.getenv("PATH") ?: return null
    val sep = File.pathSeparator
    val exe = if (System.getProperty("os.name").lowercase().contains("win")) "node.exe" else "node"
    for (dir in pathEnv.split(sep)) {
      if (dir.isBlank()) continue
      val candidate = File(dir, exe)
      if (candidate.canExecute()) return candidate.absolutePath
    }
    return null
  }

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
