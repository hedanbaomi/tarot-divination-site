import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
}

// Release signing credentials live OUTSIDE the repository. Point the
// QUAREIA_KEYSTORE_PROPERTIES environment variable at a keystore.properties
// file, or drop the file at the fallback path below. Without it, a release
// build fails loudly instead of emitting an unsigned APK.
val releaseKeystoreProperties: Properties = Properties().apply {
    val fromEnv = System.getenv("QUAREIA_KEYSTORE_PROPERTIES")
    val propsFile = if (fromEnv != null) {
        File(fromEnv)
    } else {
        File("C:/Users/32735/Desktop/证书与密钥/占卜app/keystore.properties")
    }
    if (propsFile.isFile) {
        propsFile.reader(Charsets.UTF_8).use { load(it) }
    } else {
        setProperty("missing", "true")
    }
}
val hasReleaseKeystore = releaseKeystoreProperties.getProperty("missing") == null

android {
    namespace = "com.quareia.divination"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.quareia.divination"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"
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
            if (!hasReleaseKeystore) {
                throw GradleException(
                    "Release signing keystore not found. Set QUAREIA_KEYSTORE_PROPERTIES to the " +
                        "keystore.properties path or place it in the fallback directory."
                )
            }
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

dependencies {
  // Core Android dependencies — the app is a thin WebView host, so no UI
  // toolkit is required beyond the platform WebView.
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity)
  implementation(libs.androidx.appcompat)
  // WebViewAssetLoader: serves bundled assets over a virtual https origin so
  // the page is a secure context (required for fetch() and crypto.subtle).
  implementation(libs.androidx.webkit)

  // Local unit tests
  testImplementation(libs.junit)
  testImplementation(libs.robolectric)
}
