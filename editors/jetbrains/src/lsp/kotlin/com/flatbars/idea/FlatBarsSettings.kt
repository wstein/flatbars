// SPDX-License-Identifier: Apache-2.0
package com.flatbars.idea

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/**
 * The plugin's persistent settings (ADR-017). Currently just the default dialect
 * for the `.flatbars` umbrella extension — parity with the VS Code
 * `flatbars.defaultDialect` setting. The dialect-specific extensions (.rawbars,
 * .minbars, .classicbars, .maxbars) resolve themselves; this is the fallback the LSP
 * uses for `.flatbars` files, passed to the server as an initialization option.
 *
 * Application-level (a user preference, like the VS Code one). Auto-registered via
 * @Service — no plugin.xml entry needed. Lives in the Ultimate LSP source set
 * because the dialect only affects the engine-backed server.
 */
@Service(Service.Level.APP)
@State(name = "FlatBarsSettings", storages = [Storage("flatbars.xml")])
class FlatBarsSettings : PersistentStateComponent<FlatBarsSettings.State> {
  data class State(
    var defaultDialect: String = DEFAULT_DIALECT,
    var nodePath: String = "",
  )

  private var state = State()

  override fun getState(): State = state

  override fun loadState(s: State) {
    state = s
  }

  var defaultDialect: String
    get() = state.defaultDialect.ifBlank { DEFAULT_DIALECT }
    set(value) {
      state.defaultDialect = if (value in DIALECTS) value else DEFAULT_DIALECT
    }

  /**
   * Override for the `node` executable. Blank means "look it up on `PATH`"
   * (`FlatBarsSupport.resolveNode()` consults this first, then PATH).
   */
  var nodePath: String
    get() = state.nodePath
    set(value) {
      state.nodePath = value.trim()
    }

  companion object {
    const val DEFAULT_DIALECT = "trussbars"

    /** The shipped language — Trussbars-only, matching the VS Code setting's enum. */
    val DIALECTS = arrayOf("trussbars")

    val instance: FlatBarsSettings
      get() = ApplicationManager.getApplication().getService(FlatBarsSettings::class.java)
  }
}
