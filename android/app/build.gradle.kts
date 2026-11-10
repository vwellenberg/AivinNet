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
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
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

    // android.jar ships org.json as stubs that throw in JVM unit tests; the real
    // implementation has to come from the test classpath.
    testImplementation(libs.org.json)
    testImplementation(libs.junit)
}
