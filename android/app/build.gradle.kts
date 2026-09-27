import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

// Release signing reads the private keystore credentials from
// android/local.properties (gitignored, never committed).
val keystoreProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}

// versionName comes from the single VERSION file at the repository root, which
// the backend also serves via /health/version. versionCode stays here because it
// must be an integer that increases monotonically: Android refuses to install an
// update whose versionCode is not higher than the installed one, and a fleet
// update that silently fails looks like a "blocked" install. Release checks
// assert the two move together (scripts/check-version.sh).
// Deliberately NOT named `versionName`: inside defaultConfig { } the right-hand
// side would resolve to DefaultConfig's own property and self-assign to empty.
val releaseVersion: String = rootProject.file("../VERSION")
    .takeIf { it.exists() }
    ?.readText()
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?: error("VERSION file not found at ${rootProject.file("../VERSION")} — cannot build a release")

android {
    namespace = "org.opensource.tracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.opensource.tracker"
        minSdk = 26
        targetSdk = 35
        // Must increase on every release. 7 was published as 0.3.3 (code 6);
        // 0.3.4 is the first release built from the VERSION file.
        versionCode = 7
        versionName = releaseVersion
    }

    signingConfigs {
        create("release") {
            val storeFilePath = keystoreProps.getProperty("storeFile") ?: "release.keystore"
            storeFile = rootProject.file(storeFilePath).takeIf { it.exists() }
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias") ?: "tracker"
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures { buildConfig = true; compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.compose.ui:ui:1.7.6")
    implementation("androidx.compose.foundation:foundation:1.7.6")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.osmdroid:osmdroid-android:6.1.18")
}
