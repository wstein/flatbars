// SPDX-License-Identifier: Apache-2.0
// DO NOT EDIT — generated from editors/shared/sync.mjs by editors/scripts/sync-manifests.mjs.
// Run `npm run gen:editors-manifests` after editing LANGUAGES.
package com.flatbars.idea

/**
 * Every FlatBars-native file extension, projected from the shared LANGUAGES table
 * so the JetBrains plugin's file-recognition set cannot drift from the VS Code
 * manifest or the LSP's URI → dialect map. We deliberately do NOT claim .hbs /
 * .handlebars / .mustache — those belong to their own ecosystems.
 */
object FlatBarsLanguages {
  val EXTENSIONS: Set<String> = setOf(
    "rawbars",
    "rbars",
    "minbars",
    "mbars",
    "mustache",
    "fullbars",
    "fbars",
    "hbs",
    "handlebars",
    "maxbars",
    "xbars",
  )
}
