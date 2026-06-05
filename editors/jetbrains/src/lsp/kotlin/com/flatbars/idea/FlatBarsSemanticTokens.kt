// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.colors.DefaultLanguageHighlighterColors as D
import com.intellij.platform.lsp.api.customization.LspSemanticTokensSupport

/**
 * Render the WHOLE FlatBars tag — the brace clusters and everything between
 * them, the "isle in the ocean" — in BOLD, on the LSP ceiling (IntelliJ IDEA
 * Ultimate 2024.2+). This is the JetBrains counterpart to the VS Code
 * `configurationDefaults` bold (editors/scripts/sync-manifests.mjs).
 *
 * Why only the ceiling: a TextMate grammar carries no font weight, and the
 * JetBrains TextMate integration paints scopes from the active *color scheme* —
 * there is no plugin-side hook to force bold on the Community floor. So bold is
 * a property of the LSP-emitted semantic tokens, which already override the
 * TextMate floor wherever the server runs (ADR-017). Community IDEs keep the
 * theme-controlled floor; see editors/README.md for the importable scheme.
 *
 * HOW: each FlatBars semantic-token TYPE (the server's legend, derived from
 * editors/token-vocabulary.json) maps to a [TextAttributesKey] that FALLS BACK
 * to the matching standard highlighter colour (so the FOREGROUND tracks the
 * user's scheme) and is overlaid with FONT_TYPE = bold via the
 * `additionalTextAttributes` scheme delta in flatbars-lsp.xml
 * (resources/colorSchemes/FlatBarsBold.xml). Adding a colour, not replacing it,
 * keeps us theme-agnostic — same principle as the VS Code side.
 *
 * ── API CONTACT POINT (verified in CI, not offline) ──────────────────────────
 * `LspSemanticTokensSupport` / its `getTextAttributesKey` hook and the
 * `LspServerDescriptor.lspCustomization` property that installs it live in the
 * closed Ultimate LSP API (`$IDEA$/lib/src/src_lsp-openapi.zip`); they compile
 * only under `-PwithLsp` against a real SDK. The token-type → key MAP below is
 * the stable, owned part. If a platform bump changes the override signature,
 * this is the single method to adjust — the map and the keys are unaffected.
 */
class FlatBarsSemanticTokensSupport : LspSemanticTokensSupport() {
  override fun getTextAttributesKey(tokenType: String, tokenModifiers: List<String>): TextAttributesKey? =
    BOLD_KEYS[tokenType] ?: super.getTextAttributesKey(tokenType, tokenModifiers)

  companion object {
    private fun bold(name: String, fallback: TextAttributesKey) =
      TextAttributesKey.createTextAttributesKey("FLATBARS_$name", fallback)

    /**
     * The legend the server advertises (token-vocabulary.json `lsp.type` values
     * + the `embeddedDelimiter` custom type). Each maps to a bold key whose
     * colour falls back to the closest standard semantic colour. Keep in sync
     * with the vocabulary; `check:jetbrains-bundle` / the offline smoke test pin
     * the set's presence in the scheme delta.
     */
    val BOLD_KEYS: Map<String, TextAttributesKey> = mapOf(
      "variable" to bold("VARIABLE", D.IDENTIFIER),
      "function" to bold("FUNCTION", D.FUNCTION_CALL),
      "macro" to bold("MACRO", D.METADATA),
      "keyword" to bold("KEYWORD", D.KEYWORD),
      "operator" to bold("OPERATOR", D.OPERATION_SIGN),
      "string" to bold("STRING", D.STRING),
      "number" to bold("NUMBER", D.NUMBER),
      "comment" to bold("COMMENT", D.BLOCK_COMMENT),
      "embeddedDelimiter" to bold("EMBEDDED_DELIMITER", D.KEYWORD),
    )
  }
}
