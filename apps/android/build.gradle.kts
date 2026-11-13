import com.android.build.api.dsl.CommonExtension

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

val sharedNativeLibraries = listOf("libc++_shared.so", "libfbjni.so", "libhermesvm.so", "libjsi.so")
val phoneAbis = listOf("arm64-v8a", "x86_64")
val ndk = libs.versions.ndk.get()

subprojects {
    listOf("com.android.application", "com.android.library").forEach { id ->
        pluginManager.withPlugin(id) {
            extensions.configure(CommonExtension::class.java) {
                ndkVersion = ndk
                defaultConfig.ndk.abiFilters += phoneAbis
                packaging.jniLibs.pickFirsts += sharedNativeLibraries.map { "**/$it" }
            }
        }
    }
}
