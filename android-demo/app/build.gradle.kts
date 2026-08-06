import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
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

android {
    namespace = "com.quareia.divination"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.quareia.divination"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.1.1"
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
