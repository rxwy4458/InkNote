plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.inknote.nativeapp"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.inknote.nativepreview"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-native-preview"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.00"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.ink:ink-authoring:1.1.0-alpha11")
    implementation("androidx.ink:ink-brush:1.1.0-alpha11")
    implementation("androidx.ink:ink-rendering:1.1.0-alpha11")
    implementation("androidx.ink:ink-storage:1.1.0-alpha11")
    implementation("androidx.ink:ink-strokes:1.1.0-alpha11")
    implementation("androidx.ink:ink-geometry:1.1.0-alpha11")
    implementation("androidx.input:input-motionprediction:1.0.0")
    implementation("androidx.graphics:graphics-core:1.1.0-beta01")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
