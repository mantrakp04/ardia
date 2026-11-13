import java.net.URI
import java.security.MessageDigest
import java.util.Base64
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.library)
}

abstract class FetchHermesCompiler : DefaultTask() {
    @get:Input
    abstract val version: Property<String>

    @get:Input
    abstract val integrity: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val archives: ArchiveOperations

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun fetch() {
        val target = outputDir.get().asFile
        val url = URI("https://registry.npmjs.org/hermes-compiler/-/hermes-compiler-${version.get()}.tgz").toURL()
        val bytes = url.openStream().use { it.readBytes() }
        val digest = "sha512-" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-512").digest(bytes))
        check(digest == integrity.get()) { "hermes-compiler ${version.get()} doesn't match its integrity: $digest" }
        val archive = File(temporaryDir, "hermes-compiler.tgz")
        archive.writeBytes(bytes)
        files.delete { delete(target) }
        files.copy {
            from(archives.tarTree(archives.gzip(archive)))
            into(target)
        }
        target.walkTopDown().filter { it.isFile && it.name == "hermesc" }.forEach { it.setExecutable(true) }
    }
}

abstract class CompileSharedBundles : DefaultTask() {
    @get:InputDirectory
    abstract val compiler: DirectoryProperty

    @get:InputFiles
    abstract val bundles: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun compile() {
        val os = System.getProperty("os.name").lowercase()
        val platform = when {
            os.contains("mac") -> "osx-bin/hermesc"
            os.contains("win") -> "win64-bin/hermesc.exe"
            else -> "linux64-bin/hermesc"
        }
        val hermesc = compiler.get().file("package/hermesc/$platform").asFile
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        for (bundle in bundles.files.sortedBy { it.name }) {
            exec.exec {
                commandLine(hermesc.absolutePath, "-emit-binary", "-O", "-Xes6-block-scoping", "-w", "-out", File(out, bundle.nameWithoutExtension + ".hbc").absolutePath, bundle.absolutePath)
            }
        }
    }
}

abstract class ExtractJsi : DefaultTask() {
    @get:InputFiles
    abstract val archive: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val headers: DirectoryProperty

    @get:OutputDirectory
    abstract val libraries: DirectoryProperty

    @get:Inject
    abstract val archives: ArchiveOperations

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun extract() {
        val root = headers.get().asFile
        val aar = archive.singleFile
        files.delete { delete(root, libraries) }
        files.copy {
            from(archives.zipTree(aar)) {
                include("prefab/modules/jsi/include/**")
                eachFile { relativePath = RelativePath(true, *relativePath.segments.drop(3).toTypedArray()) }
                includeEmptyDirs = false
            }
            into(root)
        }
        files.copy {
            from(archives.zipTree(aar)) {
                include("jni/*/libjsi.so")
                eachFile { relativePath = RelativePath(true, *relativePath.segments.drop(1).toTypedArray()) }
                includeEmptyDirs = false
            }
            into(libraries)
        }
    }
}

val bundleSources = rootProject.layout.projectDirectory.dir("../ios/Packages/ArdiaKit/Sources/ArdiaShared/Scripts")

val jsiArchive = configurations.create("jsiArchive") {
    isTransitive = false
    isCanBeConsumed = false
}

dependencies {
    jsiArchive("${libs.react.android.get()}:release@aar")
    implementation(libs.hermes.android)
    implementation(libs.fbjni)
    implementation("androidx.annotation:annotation:1.9.1")
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
}

val fetchHermesCompiler = tasks.register<FetchHermesCompiler>("fetchHermesCompiler") {
    version.set(libs.versions.hermes)
    integrity.set(libs.versions.hermesCompilerIntegrity)
    outputDir.set(layout.buildDirectory.dir("hermes-compiler/${libs.versions.hermes.get()}"))
}

val compileSharedBundles = tasks.register<CompileSharedBundles>("compileSharedBundles") {
    compiler.set(fetchHermesCompiler.flatMap { it.outputDir })
    bundles.from(bundleSources.file("ardia-sync.js"), bundleSources.file("ardia-core.js"))
    outputDir.set(layout.buildDirectory.dir("generated/hermes"))
}

val extractJsi = tasks.register<ExtractJsi>("extractJsi") {
    archive.from(jsiArchive)
    headers.set(layout.buildDirectory.dir("jsi/headers"))
    libraries.set(layout.buildDirectory.dir("jsi/libs"))
}

android {
    namespace = "com.ardia.shared"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared", "-DJSI_ROOT=${layout.buildDirectory.dir("jsi").get().asFile.absolutePath}")
            }
        }
    }

    buildFeatures {
        prefab = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = libs.versions.cmake.get()
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(compileSharedBundles, CompileSharedBundles::outputDir)
    }
}

tasks.configureEach {
    if (name.startsWith("configureCMake") || name.startsWith("buildCMake")) dependsOn(extractJsi)
}
