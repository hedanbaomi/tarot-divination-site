plugins {
  alias(libs.plugins.android.application)
}

android {
    namespace = "com.example.quareiadivination"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.example.quareiadivination"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
