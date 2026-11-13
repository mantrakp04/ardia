# Ardia for phones (Expo)

One Expo app for both phones, replacing `apps/ios` (SwiftUI) and `apps/android` (Compose) step by step (issue #1556).
Screens, app state and the data store are TypeScript; what has to be native is an Expo module wrapping the Kotlin and
Swift code that already exists. Android runs today; the iPhone project comes next.

## Layout

```
apps/phone/                 the app: Expo 54, React Native 0.81.6 (the Mac's versions), new architecture, Hermes
  android/                  the Android project, checked in (application id com.ardia.browser.android, minSdk 29,
                            arm64-v8a and x86_64)
  src/                      the Mac's folder rules (docs/conventions.md): components/ui, components/<feature>,
                            state/<domain>, platform, lib
  scripts/gradle-locked     Gradle under the same lock as apps/android, so one Android build runs at a time
packages/phone/             @ardia/phone-native, the Expo module package
  src/                      the TypeScript side: PageView and its types
  android/                  the Kotlin side. Its Gradle build compiles apps/android/browser's sources, assets and
                            resources directly (namespace com.ardia.browser), so both apps run one PageEngine
```

`@ardia/core` is imported straight from `src/mobile.ts`; no bundle, no script engine.

## The page view

`PageView` (`packages/phone/src`) is the page. Android backs it with `PageEngine` from `apps/android/browser`
(`DevelopmentWebViewEngine` over the system WebView today); the iPhone will back the same interface with WKWebView.

- Props: `pageId` (a page lives in the native engine under this id and survives remounts), `initialUrl` (loaded when
  the page is first opened), `toneInsets` (dp at the top and bottom to leave out when sampling the page's tone).
- Events: `onPageState` (`url`, `title`, `progress`, `isLoading`, `canGoBack`, `canGoForward`) and `onPageTone`
  (`top`, `bottom` as `#RRGGBB`, already resolved from theme colour, background colour and the sampled bands). Native
  sends both on one `onPageEvent` channel; the wrapper splits them.
- Handle: `loadUrl`, `goBack`, `goForward`, `reload`, `stopLoading`. `closePage(pageId)` ends a page.

`browser`'s `Omnibox.kt` (the ScriptEngine bridge) and `PageSurface.kt` (Compose) are left out of the module's build:
the Expo app calls `@ardia/core` itself and hosts the page's view natively.

## Build and run

```
scripts/agent/locked pod -- pnpm install             once, from the repo root
apps/phone/scripts/gradle-locked :app:assembleRelease   JS bundled in, app/build/outputs/apk/release/app-release.apk
apps/phone/scripts/gradle-locked :app:assembleDebug     loads JS from Metro
pnpm -C apps/phone dev                               Metro on :8091 (the Mac's Metro keeps :8081); adb reverse tcp:8091 tcp:8091
pnpm -C apps/phone typecheck
```

Needs JDK 17 and the Android SDK (`local.properties` or `ANDROID_HOME`). The first build compiles React Native's and
Expo's Gradle plugins and the C++ of every native module, about 15 minutes on a busy Mac; JS-only changes rebuild the
release APK in about 2.
