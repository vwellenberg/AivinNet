import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

android {
    namespace = "net.aivinnet.auto"
    // okhttp-android 5.5.1 is an AAR that must be compiled against API 37 or later
    // (AGP's checkAarMetadata). compileSdk only selects the API surface we build against;
    // targetSdk (the runtime behaviour) stays at 36.
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "net.aivinnet.auto"
        minSdk = 26
        targetSdk = 36
        // Android refuses an update with a lower versionCode, so every CI build counts up
        // (the workflow's run number). Local builds stay at 1. Run numbers count per workflow:
        // only android.yml may build the APK people install, or a new workflow starting at 1
        // would be refused as a downgrade.
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
    }

    // The fixed key (#747). Every debug build signs with a fresh key on the runner, so a new APK
    // would not install over the old one: uninstalling first lost the login and every offline
    // download. The release key comes from the environment (in CI from repository secrets, see
    // android.yml), never from a file in the repo. Without it, assembleRelease stays unsigned.
    val releaseKeystore = System.getenv("AIVINNET_KEYSTORE_FILE")?.let(::file)?.takeIf { it.isFile }
    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("AIVINNET_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("AIVINNET_KEY_ALIAS")
                keyPassword = System.getenv("AIVINNET_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
    }

    // Robolectric (TileRendererTest) reads the merged resources and the manifest.
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.media3.datasource)
    implementation(libs.media3.datasource.okhttp)
    // StandaloneDatabaseProvider: the cache index and the download index live in one SQLite file.
    implementation(libs.media3.database)
    // Periodic offline sync (OfflineSyncWorker). Background work survives the app being closed.
    implementation(libs.work.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.appcompat)
    // PathParser turns the tile glyphs' path data into a Path (TileRenderer).
    implementation(libs.androidx.core)

    // android.jar ships org.json as stubs that throw in JVM unit tests; the real
    // implementation has to come from the test classpath.
    testImplementation(libs.org.json)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
