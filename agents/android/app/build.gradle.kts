plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.smav.printagent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.smav.printagent"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        val rawServerUrl = (
            providers.gradleProperty("SMAV_SERVER_URL").orNull
                ?: System.getenv("SMAV_SERVER_URL")
                ?: ""
        ).trim().trimEnd('/')

        val isInvalidPlaceholder = rawServerUrl.contains("api.smav.internal", ignoreCase = true) ||
            rawServerUrl.contains("ais-dev-", ignoreCase = true) ||
            rawServerUrl.contains("localhost", ignoreCase = true) ||
            rawServerUrl.contains("127.0.0.1") ||
            rawServerUrl.contains("example.", ignoreCase = true)

        if (rawServerUrl.isBlank() ||
            !rawServerUrl.startsWith("https://") ||
            isInvalidPlaceholder ||
            rawServerUrl.any { it.isWhitespace() || it == '"' || it == '\\' }
        ) {
            throw GradleException(
                "SMAV_SERVER_URL Gradle property is missing or invalid ('$rawServerUrl'). " +
                    "Provide a valid HTTPS production backend URL via -PSMAV_SERVER_URL=https://<domain>."
            )
        }

        // Authoritative production backend base URL injected at build time
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$rawServerUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

    // Room SQLite Database
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // WorkManager
    implementation(libs.androidx.work.runtime.ktx)

    // Retrofit & OkHttp
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.okhttp.logging)

    // Security & EncryptedSharedPreferences
    implementation(libs.androidx.security.crypto)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))

    debugImplementation(libs.androidx.ui.tooling)
}
