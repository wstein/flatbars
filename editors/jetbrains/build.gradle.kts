// The FlatBars JetBrains plugin (ADR-017). Two layers:
//
//   * TextMate fallback (the floor) — bundled here, works in EVERY JetBrains IDE
//     (Community + Ultimate). This is the default, gated build.
//   * flatbars-lsp semantic tokens (the ceiling) — the SAME engine-backed server
//     the VS Code extension ships, consumed via the platform LSP API. That API is
//     Ultimate-only and is NOT in the openly-resolvable SDK, so the LSP layer is an
//     OPT-IN build (`-PwithLsp`) that requires an IDE/SDK providing
//     `com.intellij.platform.lsp`. See README.md.
//
// Build (default, TextMate only):  gradle buildPlugin
// Build (with LSP, needs the API):  gradle buildPlugin -PwithLsp
//
// Either way `node scripts/sync-assets.mjs` first bundles the server + grammar
// into resources (wired via processResources below).
plugins {
  kotlin("jvm") version "2.0.21"
  id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.flatbars"
version = "0.1.0"

val withLsp = (project.findProperty("withLsp") as String?)?.toBoolean() ?: false

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  intellijPlatform {
    // Ultimate is requested so the LSP API is present WHEN it is shipped in the
    // SDK; the TextMate-only default build uses only the bundled textmate plugin.
    intellijIdeaUltimate("2024.2")
    bundledPlugin("org.jetbrains.plugins.textmate")
    instrumentationTools()
  }
}

// The IntelliJ Platform baseline is JDK 17; provision and compile on it (the JDK
// running Gradle here is too new for the bundled Kotlin compiler).
kotlin {
  jvmToolchain(17)
}

// The LSP layer is an opt-in source set + resources, only compiled with -PwithLsp
// (the platform LSP API must be on the compile classpath for it to build).
if (withLsp) {
  sourceSets["main"].java.srcDir("src/lsp/kotlin")
  sourceSets["main"].resources.srcDir("src/lsp/resources")
}

intellijPlatform {
  pluginConfiguration {
    id = "com.flatbars.flatbars"
    name = "FlatBars"
    version = project.version.toString()
    ideaVersion {
      sinceBuild = "242"
      untilBuild = provider { null }
    }
  }
}

// Sync the engine-backed server bundle + the TextMate grammar into resources before
// they are packaged, so the plugin can never drift from the canonical sources.
val syncAssets = tasks.register<Exec>("syncAssets") {
  commandLine("node", layout.projectDirectory.file("scripts/sync-assets.mjs").asFile.absolutePath)
}
tasks.named("processResources") {
  dependsOn(syncAssets)
}

// Inject the Ultimate-gated optional LSP dependency into the patched plugin.xml,
// but ONLY in the -PwithLsp build — so the default plugin never references LSP
// classes it does not bundle. patchPluginXml owns the final plugin.xml, so the
// replacement happens on its output (a processResources filter would be bypassed).
if (withLsp) {
  tasks.named("patchPluginXml").configure {
    doLast {
      val out = outputs.files.singleFile
      out.writeText(
        out.readText().replace(
          "<!--LSP_DEPENDS-->",
          """<depends optional="true" config-file="flatbars-lsp.xml">com.intellij.modules.ultimate</depends>""",
        ),
      )
    }
  }
}
