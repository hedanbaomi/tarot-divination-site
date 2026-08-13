import java.util.Properties
import java.util.zip.ZipFile
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.TaskAction
import org.gradle.api.tasks.testing.Test
import org.gradle.work.DisableCachingByDefault

plugins {
  alias(libs.plugins.android.application)
}

@DisableCachingByDefault(because = "Verifies a packaged APK without producing an output")
abstract class VerifyPrivateLxxxiApkTask : DefaultTask() {
    @get:InputFile
    abstract val apkFile: RegularFileProperty

    @TaskAction
    fun verify() {
        val apk = apkFile.get().asFile
        if (!apk.isFile) throw GradleException("Expected APK was not produced for private LXXXI verification")

        val failure = ZipFile(apk).use { zip ->
            val qvCount = zip.entries().asSequence()
                .count { !it.isDirectory && it.name.startsWith("assets/qv/") }
            if (qvCount != 82) {
                return@use "Private LXXXI APK record count is invalid: $qvCount"
            }

            val providerDescriptor = "Lcom/quareia/divination/PrivateLxxxiAssetProvider;"
                .toByteArray(Charsets.US_ASCII)
            val providerPresent = zip.entries().asSequence()
                .filter { !it.isDirectory && it.name.matches(Regex("classes(\\d*)?\\.dex")) }
                .any { entry ->
                    val dex = zip.getInputStream(entry).use { it.readBytes() }
                    dex.containsSequence(providerDescriptor)
                }
            if (!providerPresent) "Private LXXXI provider is absent from the packaged APK" else null
        }
        if (failure != null) failAndRemove(apk, failure)
    }

    private fun failAndRemove(apk: File, message: String): Nothing {
        if (apk.exists() && !apk.delete()) {
            throw GradleException("$message; invalid APK could not be removed")
        }
        throw GradleException(message)
    }

    private fun ByteArray.containsSequence(needle: ByteArray): Boolean {
        if (needle.isEmpty() || needle.size > size) return false
        outer@ for (start in 0..size - needle.size) {
            for (offset in needle.indices) {
                if (this[start + offset] != needle[offset]) continue@outer
            }
            return true
        }
        return false
    }
}

@DisableCachingByDefault(because = "Verifies ignored local-only integration inputs")
abstract class VerifyPrivateLxxxiSourceTask : DefaultTask() {
    @get:Internal
    abstract val providerFile: RegularFileProperty

    @get:Internal
    abstract val vaultFile: RegularFileProperty

    @get:Internal
    abstract val materialFile: RegularFileProperty

    @get:Internal
    abstract val recordsDirectory: DirectoryProperty

    @TaskAction
    fun verify() {
        if (!providerFile.get().asFile.isFile) {
            throw GradleException("Private LXXXI provider is missing")
        }
        if (!vaultFile.get().asFile.isFile || !materialFile.get().asFile.isFile) {
            throw GradleException("Private LXXXI vault implementation is incomplete")
        }
        val records = recordsDirectory.get().asFile.listFiles()
        if (records == null || records.size != 82 || records.any { !it.isFile }) {
            throw GradleException("Private LXXXI record set must contain exactly 82 files")
        }
    }
}

// Release signing credentials live OUTSIDE the repository and are only ever
// supplied through the environment or Gradle properties, never hard-coded:
//   - QUAREIA_KEYSTORE_PROPERTIES: path to a keystore.properties file with
//     storeFile / storePassword / keyAlias / keyPassword, or
//   - Gradle properties: quareia.keystore.storeFile / storePassword /
//     keyAlias / keyPassword (gradle.properties or ~/.gradle/gradle.properties).
// When no credentials are configured, debug builds, unit tests, the hardened
// local variant and IDE sync all keep working; only a real release build
// fails, with a clear message, instead of emitting an unsigned APK.
val releaseKeystoreProperties: Properties = Properties().apply {
    System.getenv("QUAREIA_KEYSTORE_PROPERTIES")
        ?.takeIf { File(it).isFile }
        ?.let { File(it).reader(Charsets.UTF_8).use { reader -> load(reader) } }
    if (!containsKey("storeFile")) {
        setProperty("storeFile", project.findProperty("quareia.keystore.storeFile")?.toString().orEmpty())
    }
    if (!containsKey("storePassword")) {
        setProperty("storePassword", project.findProperty("quareia.keystore.storePassword")?.toString().orEmpty())
    }
    if (!containsKey("keyAlias")) {
        setProperty("keyAlias", project.findProperty("quareia.keystore.keyAlias")?.toString().orEmpty())
    }
    if (!containsKey("keyPassword")) {
        setProperty("keyPassword", project.findProperty("quareia.keystore.keyPassword")?.toString().orEmpty())
    }
}
val hasReleaseKeystore = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !releaseKeystoreProperties.getProperty(it).isNullOrBlank() } &&
    File(releaseKeystoreProperties.getProperty("storeFile")).isFile

val privateLxxxiAdapter = file(
    "src/main/java/com/quareia/divination/PrivateLxxxiAssetProvider.kt",
)
val privateLxxxiVault = file(
    "src/main/java/com/quareia/divination/LxxxiVault.kt",
)
val privateLxxxiMaterial = file(
    "src/main/java/com/quareia/divination/VaultMaterial.kt",
)
val privateLxxxiRecords = file("src/main/assets/qv")
val privateLxxxiDetected = privateLxxxiAdapter.isFile ||
    privateLxxxiVault.isFile ||
    privateLxxxiMaterial.isFile ||
    privateLxxxiRecords.isDirectory
val forcePrivateLxxxi = providers.gradleProperty("quareia.requirePrivateLxxxi")
    .map(String::toBoolean)
    .getOrElse(false)
val enforcePrivateLxxxi = forcePrivateLxxxi || privateLxxxiDetected

android {
    namespace = "com.quareia.divination"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.quareia.divination"
        minSdk = 24
        targetSdk = 36
        versionCode = 7
        versionName = "1.3.2"
    }

    signingConfigs {
        create("release") {
            if (hasReleaseKeystore) {
                storeFile = File(releaseKeystoreProperties.getProperty("storeFile"))
                storePassword = releaseKeystoreProperties.getProperty("storePassword")
                keyAlias = releaseKeystoreProperties.getProperty("keyAlias")
                keyPassword = releaseKeystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        create("hardened") {
            initWith(getByName("release"))
            isDebuggable = false
            signingConfig = signingConfigs.getByName("debug")
            applicationIdSuffix = ".hardened"
            versionNameSuffix = "-hardened-local"
            matchingFallbacks += listOf("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = false
      aidl = false
      buildConfig = false
      shaders = false
    }
    testOptions {
      unitTests.isIncludeAndroidResources = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    androidResources {
        // Avoid an extra decompression copy when the WebView route opens a
        // single opaque record. This is a packaging/performance choice, not a
        // secrecy boundary.
        noCompress += "dat"
    }
}

kotlin {
    jvmToolchain(17)
}

// Only an actual release build requires release signing credentials; all
// other tasks (debug, unit tests, hardened, IDE sync) keep working without a
// keystore. Because the release signing config is intentionally left without
// a storeFile, AGP fails :app:packageRelease with a clear
// "SigningConfig 'release' is missing required property 'storeFile'" error
// and never emits an unsigned release APK. See README.md for how to supply
// the credentials via QUAREIA_KEYSTORE_PROPERTIES or the quareia.keystore.*
// Gradle properties.

dependencies {
  // Core Android dependencies — the app is a thin WebView host, so no UI
  // toolkit is required beyond the platform WebView.
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity)
  implementation(libs.androidx.appcompat)
  // LifecycleEventObserver: binds the update flow to the activity lifecycle.
  implementation(libs.androidx.lifecycle.runtime)
  // WebViewAssetLoader: serves bundled assets over a virtual https origin so
  // the page is a secure context (required for fetch() and crypto.subtle).
  implementation(libs.androidx.webkit)

  // Local unit tests
  testImplementation(libs.junit)
  testImplementation(libs.robolectric)
}

// A public checkout has no private provider and ordinary debug/tests remain
// buildable and fail closed. Hardened/release packaging is always a complete
// build and therefore always requires the private integration preflight.
// -Pquareia.requirePrivateLxxxi=true also makes a direct debug unit-test run
// strict for official validation automation.
tasks.withType<Test>().configureEach {
    if (name == "testDebugUnitTest") {
        systemProperty("quareia.requirePrivateLxxxi", enforcePrivateLxxxi.toString())
    }
}

fun registerPrivateLxxxiApkGate(variantTitle: String, apkName: String) {
    val packageTask = "package$variantTitle"
    // AGP creates local unit tests only for debug in this project. The test is
    // variant-independent and loads the same ignored provider/assets used by
    // hardened/release, while the packaged APK is checked separately below.
    val unitTestTask = "testDebugUnitTest"
    val preflightTask = tasks.register<VerifyPrivateLxxxiSourceTask>(
        "verify${variantTitle}PrivateLxxxiSources",
    ) {
        group = "verification"
        description = "Fails before $variantTitle packaging when private LXXXI inputs are incomplete."
        providerFile.set(privateLxxxiAdapter)
        vaultFile.set(privateLxxxiVault)
        materialFile.set(privateLxxxiMaterial)
        recordsDirectory.set(privateLxxxiRecords)
    }
    val verifyTask = tasks.register<VerifyPrivateLxxxiApkTask>("verify${variantTitle}PrivateLxxxiApk") {
        group = "verification"
        description = "Fails a complete $variantTitle build when private LXXXI integration is incomplete."
        apkFile.set(layout.buildDirectory.file("outputs/apk/${variantTitle.lowercase()}/$apkName"))
        mustRunAfter(packageTask)
    }

    tasks.named(packageTask).configure {
        dependsOn(preflightTask, unitTestTask)
        finalizedBy(verifyTask)
    }
    tasks.named("assemble$variantTitle").configure {
        dependsOn(packageTask, verifyTask)
    }
}

afterEvaluate {
    registerPrivateLxxxiApkGate("Hardened", "app-hardened.apk")
    registerPrivateLxxxiApkGate("Release", "app-release.apk")
}
