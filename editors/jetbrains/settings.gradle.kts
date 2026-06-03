plugins {
  // Auto-provisions the JDK 17 toolchain the IntelliJ Platform builds against,
  // independent of the JDK running Gradle.
  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "flatbars-jetbrains"
