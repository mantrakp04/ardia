# Ardia for Android

The first slice of Ardia for Android phones: native Kotlin and Jetpack Compose screens around the same two TypeScript
bundles the iPhone runs, in Hermes. It joins the Mac's end-to-end-encrypted sync (`docs/sync.md`) as one more phone,
exactly as the iPhone does (`docs/ios.md`). There is no real UI yet: one screen loads a page.

## Layout

```
apps/android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml, gradlew   Gradle 9.9 with the wrapper checked in
  shared/     Hermes and the shared bundles: ScriptEngine.kt, a JNI shim (src/main/cpp) over Hermes's JSI
  sync/       the sync device. core/ is the byte-for-byte port of packages/sync/ios/Core (phrase, keys, file
              names, sealed format, vault); the rest hosts the companion cycle (SyncHost, SyncEngine, SyncService,
              SyncSnapshot, SyncFiles)
  browser/    PageEngine, the page engine interface, and DevelopmentWebViewEngine, its stand-in; the Omnibox bridge
  design/     tokens and the Compose theme
  app/        com.ardia.browser.android: one Compose screen that loads a URL through PageEngine
  scripts/    swift-crosscheck.sh and the Swift package it runs against packages/sync
```

Targets: minSdk 29, compileSdk and targetSdk 36, phone layouts only, arm64-v8a and x86_64.

## The brain: Hermes

- **Engine.** `com.facebook.hermes:hermes-android` 260318099.0.5 from Maven Central, the Hermes React Native 0.88.1
  ships, so it is the engine family the Mac app runs this code in. Its `libhermesvm.so` needs `libjsi.so`, which only
  `react-android` ships: the build takes that one library and the JSI headers out of `react-android` 0.88.1 (the same
  release) and adds nothing else from React Native.
- **Bytecode.** The build compiles `ardia-sync.js` and `ardia-core.js` from `apps/ios/Packages/ArdiaKit/Sources/ArdiaShared/Scripts`
  (the checked-in bundles; there is no Android copy) with `hermesc` from the npm package `hermes-compiler` at the same
  version, fetched by Gradle and checked against its npm integrity hash. The versions live once, in the version catalog.
  `-Xes6-block-scoping` is required: without it hermesc gives every `let` in a loop one shared slot.
- **ScriptEngine** has the Swift one's contract: load the bundles, `register` synchronous host functions under `__host`,
  `call` with JSON arguments, `callAsync` that drains microtasks until the promise settles. Strings cross JNI as UTF-16.
- **Device logic stays thin.** Kotlin touches files, keys and the page engine; the rules are the shared TypeScript.

## Sync on Android

- **Format.** `sync/core` is held to the reference vectors, the 0.2.32 fixture and the real Swift code (below).
- **Folder.** The vault reads and writes through `SyncStorage` (names, read, write, remove of sealed files);
  `FolderStorage` is a local folder. How a real phone reaches the Mac's folder is undecided; a cloud transport is one
  more `SyncStorage`.
- **Keys.** The phrase's entropy is sealed with an AES key in the Android Keystore (`KeystoreKeyStore`, no user
  authentication, so background sync can read it). Test instances use `FileKeyStore`, a 0600 file, like the Mac's.
- **What it writes and reads.** The same as the iPhone, from the same code: device kind `phone`, its own `dev:`,
  `tabs:` and `h:` records, `send:` records, and new bookmarks; it keeps every record it doesn't use untouched.
- **Not ported yet.** Timers, foreground and background scheduling (WorkManager), the folder picker. `SyncService` is
  blocking; call it off the main thread.

## Page engine

`PageEngine` is the seam for Ardia's own Chromium, which is separate work. `DevelopmentWebViewEngine` wraps the system
WebView so the app runs in the emulator today; it is development only and the screen says so.

## Build

```
cd apps/android
./gradlew assembleDebug                         app at app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17+, the Android SDK (`ANDROID_HOME` or `local.properties`), NDK 27.1.12297006 and CMake 3.22.1. The first
build downloads Gradle, Hermes, `react-android` (for `libjsi.so`) and `hermes-compiler`.

## Test

- `./gradlew :sync:testDebugUnitTest`: the sync core on the JVM (vectors, fixture, tampering, vault, key file).
- `scripts/swift-crosscheck.sh`: the real Swift `packages/sync` writes a vault that Kotlin opens, and Kotlin writes one
  that Swift opens (payloads, tags, passwords, the phrase). Set `ARDIA_CROSSCHECK_DIR` to keep the files.
- `./gradlew connectedDebugAndroidTest` on an emulator or phone:
  - `shared`: the ScriptEngine contract, `let` scoping in bytecode, bytecode version, and `KeystrokeTimingTest`
    (`adb logcat -s ArdiaTiming` prints the numbers).
  - `sync`: `SyncEndToEndTest` (a fake Mac in Hermes writing every record kind; joining, sending both ways,
    stopping, damaged files, a relaunch, the Keystore) and `SyncThroughACarrierTest` (two folders and a carrier that
    delivers late, out of order and half written, with seeded soaks).
- `node apps/ios/scripts/bundle-shared.mjs --check` still guards the bundles both phones run.

## Agent notes

- Boot emulators headless (`emulator -avd <name> -no-window`), keep AVDs and scratch under your own folder, and shut
  down what you boot. Use T3's device tools for anything interactive.
- No comments in code, no em dashes anywhere.
