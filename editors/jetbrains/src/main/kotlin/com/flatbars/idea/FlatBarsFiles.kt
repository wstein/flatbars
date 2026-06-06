// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.vfs.VirtualFile

/**
 * File-extension recognition for FlatBars documents. Lives in the always-compiled
 * `src/main` source set because the Tools-menu actions and the Community-edition
 * notice need it with OR without the opt-in `-PwithLsp` layer — so `src/main`
 * never depends on the Ultimate-only `src/lsp` sources (the cause of the
 * `compileKotlin` "Unresolved reference 'FlatBarsSupport'" failure).
 *
 * The extension set is single-sourced via [FlatBarsLanguages] (generated from
 * editors/shared/sync.mjs); never inline an extension here.
 */
object FlatBarsFiles {
  /** True iff the file's extension belongs to a FlatBars dialect. */
  fun isSupported(file: VirtualFile): Boolean =
    file.extension?.lowercase() in FlatBarsLanguages.EXTENSIONS
}
