# Ardia for phones (Expo)

One Expo app for both phones, replacing `apps/ios` (SwiftUI) and `apps/android` (Compose) step by step (issue #1556).
Screens, app state and the data store are TypeScript; what has to be native is an Expo module wrapping the Kotlin and
Swift code that already exists. Both phones run it: Android and the iPhone.

## Layout

```
apps/phone/                 the app: Expo 54, React Native 0.81.6 (the Mac's versions), new architecture, Hermes
  android/                  the Android project, checked in (application id com.ardia.browser.android, minSdk 29,
                            arm64-v8a and x86_64)
  src/                      the Mac's folder rules (docs/conventions.md): components/ui, components/<feature>,
                            state/<domain>, platform, lib
  ios/                      the iPhone project, checked in (bundle id com.ardia.browser.ios, the SwiftUI app's, iOS 27,
                            iPhone only, React Native's prebuilt core)
  scripts/gradle-locked     Gradle under the same lock as apps/android, so one Android build runs at a time
packages/phone/             @ardia/phone-native, the Expo module package
  src/                      the TypeScript side: PageView and its types
  android/                  the Kotlin side. Its Gradle build compiles apps/android/browser's sources, assets and
                            resources directly (namespace com.ardia.browser), so both apps run one PageEngine
  ios/                      the Swift side, pod ArdiaPhoneNative. It builds against ArdiaKit's ArdiaBrowser, so the
                            SwiftUI app and this app run one WebEngine and WebTab
```

`@ardia/core` is imported straight from `src/mobile.ts`; no bundle, no script engine.

## The page view

`PageView` (`packages/phone/src`) is the page. Android backs it with `PageEngine` from `apps/android/browser`
(`DevelopmentWebViewEngine` over the system WebView today). The iPhone backs it with `WebEngine` and `WebTab` from
`apps/ios/Packages/ArdiaKit` (WKWebView with the SwiftUI app's content blocking, popups, downloads and page requests),
in an in-memory tab store until this app takes over the SwiftUI app's data. Its tone is `PageTone.resolve` and
`ToneSampler` in ArdiaBrowser, the code the SwiftUI app's bar uses. The page takes iOS's edge swipes for back and
forward.

- Props: `pageId` (a page lives in the native engine under this id and survives remounts), `initialUrl` (loaded when
  the page is first opened), `toneInsets` (dp at the top and bottom to leave out when sampling the page's tone).
- Events: `onPageState` (`url`, `title`, `progress`, `isLoading`, `canGoBack`, `canGoForward`) and `onPageTone`
  (`top`, `bottom` as `#RRGGBB`, already resolved from theme colour, background colour and the sampled bands). Native
  sends both on one `onPageEvent` channel; the wrapper splits them.
- Handle: `loadUrl`, `goBack`, `goForward`, `reload`, `stopLoading`. `closePage(pageId)` ends a page.

`browser`'s `Omnibox.kt` (the ScriptEngine bridge) and `PageSurface.kt` (Compose) are left out of the module's build:
the Expo app calls `@ardia/core` itself and hosts the page's view natively.

## Sync on Android

Sync is a native subsystem with its own script runtime; the app's JavaScript never sees the host functions,
keys, the phrase's entropy or sealed bytes. `@ardia/phone-native` compiles `apps/android/sync` and
`apps/android/shared` in place, and `ArdiaPhoneSync` (`packages/phone/src/sync.ts`) wraps `SyncController` whole:
status and the synced view as getters and events, connect and change folder with the system folder picker, sync
now, stop, the reset notice, device name, profile, send, pin to Mac, incoming sends. One controller owns every
cycle on its own thread; `MainApplication` is the `SyncControllerOwner`, so WorkManager's `SyncWorker` (every 15
minutes, and a flush after the app leaves the screen) runs it without React Native.

- **Runtime.** `ardia_hermes.cpp` builds against React Native 0.81's prefab Hermes, JSI and fbjni
  (`ARDIA_REACT_NATIVE_HERMES` picks the runtime options that Hermes has), so the process has one Hermes and sync
  gets its own runtime instance. `libardiahermes.so` needs only the `libhermes.so`, `libjsi.so` and
  `libfbjni.so` the app ships.
- **Bytecode.** React Native 0.81's `hermesc` rejects `async` functions and classes in `ardia-sync.js`, and
  its hidden `-block-scoping` flag crashes on it; there is no `-Xes6-block-scoping` in that compiler. So
  `CompileSyncBundle` (`packages/phone/android/build.gradle`) runs the bundle through Babel's class, block-scoping
  and async-to-generator transforms, the ones React Native applies to app code for this Hermes, then compiles it
  with React Native 0.81's `hermesc`, pinned by sha256. The Compose app compiles the same source with
  `hermes-compiler` 0.88.1 and `-Xes6-block-scoping`. The step proves the two cannot differ: Babel must leave
  no `let`, `const`, class, `async` or `await` (each loop variable a closure captures becomes its own `_loop`
  function, so a binding per pass does not depend on the engine); closures in loops, through the same
  transform, must keep each pass's value; the whole companion suite (`packages/sync/src/companion`) runs
  against the transpiled bundle; and the transpiled bundle must make the same host calls as the original.
- **The phone's data.** Sync reads the app's `browser.db` (`filesDir/SQLite`, written by expo-sqlite) read-only
  on its own thread: open web tabs, the 30 newest per profile, and visits grouped by address and profile. A
  missing database is an empty phone; one that cannot be read fails the cycle. The app never writes private
  tabs or their visits to it. Its tables are the Kotlin store's: `tabs`, `tab_state` and `visits` have the
  same columns and indexes, `PRAGMA user_version` is 1 in both and both use WAL. The differences: the Expo
  file adds a `preferences` table (the Kotlin app keeps preferences in SharedPreferences), Android's
  `SQLiteOpenHelper` adds `android_metadata` to the Kotlin file, and nothing marks a row as private in either
  file (the Kotlin app keeps private tabs in memory, the Expo app never writes them). The Kotlin `store`
  module's readers are not reused: `BrowserDatabase` opens the file to write and migrate, and `TabStore`
  answers sync from its in-memory state.
- **Sync's writes to the phone's data.** Tabs a Mac sent and history a Mac removed go to an inbox file next to
  the sync state (`noBackupFilesDir/PhoneSync`), written whole and renamed into place, until the app applies
  them to its store (`sync.inbox()`, `sync.inboxApplied(ids)`, the `sync.inbox` event). Visits waiting to be
  removed are left out of what sync reads, so they never go back to the Mac.
- **Lab.** The page lab's Sync button connects with a typed phrase and a picked folder and shows the status and
  the synced view's counts. Runtime checks runs semantic fixtures (closures in loops, microtask order around a
  host call, sort stability, Map and Set order, large integers, string comparison) in a second sync runtime and
  prints `PAGELAB PASS` or `PAGELAB FAIL` per check against Node's results from the build.

#### Sync tester script (lab build, a Mac with sync on)

Watch `adb logcat -s PAGELAB ArdiaJS` throughout. Each step passes when the app keeps working, the status
says what happened, and no tab or removed visit is lost or shows up twice.

1. **Connect.** Sync › connect with the Mac's phrase and its folder. Status reaches `updated`; the view lists
   the Mac, its profiles and its tabs.
2. **Runtime checks.** Every check prints PASS.
3. **Next profile.** Each tap moves `›` to the next profile, and `shown` follows it.
4. **Two runtimes under teardown and reload.** Tap Runtime checks, and while it runs tap Sync now; then reload
   the JavaScript (debug build: `r` in Metro; release: kill the app with `adb shell am kill` after leaving it).
   Repeat three times. Sync keeps cycling, the checks still pass, and nothing crashes (`adb logcat -b crash`).
5. **A slow or revoked folder.** Point sync at a folder on a provider that lags (a cloud drive's folder with
   the phone on a slow network): status shows `updating`, then `updated` or `stalled`, never a hang past a
   minute. Then revoke the grant (Settings › Apps › Ardia › clear the folder permission, or remove the folder in
   the provider): status turns `needsFolderAccess`, and Change folder recovers it.
6. **WorkManager with the app process dead.** Make a change on the Mac, leave the app, run
   `adb shell am kill com.ardia.browser.android`, then
   `adb shell cmd jobscheduler run -f com.ardia.browser.android <job id>` (ids from
   `adb shell dumpsys jobscheduler com.ardia.browser.android`). Open the app: the change is there before the
   first foreground cycle, and the inbox holds any tabs the Mac sent.
7. **Stalled age.** Turn on airplane mode and wait three minutes: the status reads `Last synced N minutes ago`
   and N moves each minute.
- **Scanning the phrase.** The Compose app scans the Mac's QR code with CameraX and ZXing in Compose. The Expo
  screens should scan in JavaScript (expo-camera reads QR codes) and pass the text to `sync.connect`.

## System entry points on Android

The Expo app has the Compose app's entry points (`docs/android.md`), from its own code where it can be shared.
- **Links.** `MainActivity` hands every intent to `PhoneSystemLinks` (`@ardia/phone-native`), which maps it to
  a `SystemLink` with the Compose app's `SystemLink` parser and queues it until the app listens
  (`system.initialLink()`, `system.addLinkListener`). http and https `VIEW` (default browser) is `open`, source
  `web`; `ardia://` from widgets and the tile is its kind, source `system`, and from launcher shortcuts, source
  `shortcut`; `WEB_SEARCH` and `PROCESS_TEXT` (Search in Ardia on selected text) search, or open a web
  address, source `intent`; `SEND` text opens its first link or searches the text, source `share`. A link is
  delivered once, not again on recreate or from Recents. `system.setHidesFromRecents(hidden)` is the Compose
  app's Recents screenshot and `FLAG_SECURE` handling, for the screens to call while a private tab shows.
- **Default browser.** `defaultBrowser` uses the Compose app's `AndroidSystemActions` (`RoleManager.ROLE_BROWSER`).
- **Tile, widgets and shortcuts.** The Compose app's `SearchTileService`, Glance widgets (Search, Your Mac's Tabs)
  and `SystemSnapshots` compile in place in the Expo app, with its `res-system` resources and a small
  `ardia-design` library for `ProfileLook`, `Monogram` and `Colors`. `SystemExport` writes the widgets'
  snapshot from the wrapped sync controller, as the Compose app does; demo mode feeds no widgets.
- **Not ported.** The share sheet's Send to Your Mac (sharing opens the page in Ardia instead), and the Color
  setting's tint of the widgets.
- **Files.** A file request carries `offersPhoto`, `offersVideo` and `capturesDirectly` (the Compose app's
  `FileChooserPlan`); the answers `takePhoto` and `recordVideo` capture through the shared capture provider.
- **Open App Links In.** A global default (`pages.appLinksDefault`, `setAppLinksDefault`) with each site on,
  off or following it (`setOpensLinksInApps(host, null)`).

#### Entry points tester script (lab build)

`P=com.ardia.browser.android/.MainActivity`. Open the lab
(`adb shell am start -n $P --ez com.ardia.phone.PAGE_LAB true`), tap System, and watch
`adb logcat -s ReactNativeJS:I | grep "PAGELAB system"`. Each command should print one `PAGELAB system link`
line with the kind and source shown. The lab also prints `PAGELAB system default browser` once when it opens
and again only when that status changes.

1. **Web link:** `adb shell am start -a android.intent.action.VIEW -d https://example.com/a -n $P`: open, web.
2. **Ardia links:** the same with `-d ardia://search?q=otters` (search, query otters), `ardia://voice`
   (voiceSearch), `ardia://incognito`, `ardia://mac-tabs` (macTabs), `ardia://tab/t1` (tab, id t1),
   `ardia://open?url=https%3A%2F%2Fexample.com%2F` (open), `ardia://inbox`: each with source system.
3. **Shortcuts:** long-press the app icon: Search, Voice Search, Incognito Tab, Synced Tabs each give their kind
   with source shortcut.
4. **Web search:** `adb shell am start -a android.intent.action.WEB_SEARCH --es query "red pandas" -n $P`:
   search, intent. With `--es query https://example.com/`: open.
5. **Selected text:** select words in any app, choose Search in Ardia: search with the words, intent. Or
   `adb shell am start -a android.intent.action.PROCESS_TEXT -t text/plain --es android.intent.extra.PROCESS_TEXT "two words" -n $P`.
6. **Share:** share a page from another app and pick Ardia: open, share. Or
   `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "Look https://example.com/b." -n $P`
   (open https://example.com/b) and with `"just words"` (search).
7. **Once only:** after a link, go to Recents and back to Ardia, and rotate if the screen allows: no new line.
8. **Cold start:** force-stop the app, then run step 1 with `--ez com.ardia.phone.PAGE_LAB true` added: open
   System; the initial link line shows the link.
9. **Default browser:** the status line shows isDefault and canAsk; Request role shows the system dialog and
   the line follows the answer; Default apps settings opens the settings page.
   `adb shell cmd role get-role-holders android.app.role.BROWSER` agrees. With Ardia as the default, step 1
   without `-n` opens Ardia directly.
10. **Recents:** Hide from Recents, then open Recents: Ardia's card is blank. Show in Recents restores it.
11. **Quick Settings tile:** add Ardia's Search tile; tapping it opens Ardia with a search link (system). With
    the phone locked it asks to unlock first.
12. **Widgets:** add Search and Your Mac's Tabs from the launcher's widget picker. Search: the field gives
    search, the mic gives voiceSearch. Your Mac's Tabs with sync off: "Sync With Your Mac"; with real sync
    connected, the Mac's tabs within a cycle, and a row opens its page (open, system). Dark mode switches the
    Search widget's backdrop.
13. **Take Photo and Record Video:** load
    `data:text/html,<input type=file accept=image/*><input type=file accept=video/* capture>` in the lab and
    tap each input: the request line shows photo/video/direct; Take photo asks for the camera once, opens the
    camera, and the page gets the picture; the second input (capture) records video.
14. **Desktop Site on the POCO F4** (it failed there on `sync3`): Desktop on for google.com, github.com,
    wikipedia.org and bbc.com. The `PAGELAB desktop` lines should show `switched on`, then `pageFinished` at
    the tag's scale (visualViewport.scale about 0.38, not 1.0000) with no visible jump, and each page fitting
    the width. GitHub at 980 px shows its narrow layout, as Chrome's desktop mode does on phones.
15. **Sync, demo mode:** Stop Syncing turns the demo off (the card and the deck show the disconnected state);
    the next demo launch is on again. A rename shows in the devices list; Pin to Mac fills the star. Damage inbox
    in the Sync section sets the status's `inboxProblem` (the Sync section's status lines show it) and the app
    shows its notice; after a force-stop and relaunch the notice is still there, until sync next writes the
    inbox.
16. **Shortcuts with the app in the background:** open the System section, press Home (don't swipe the app
    away), and use each launcher shortcut. Ardia comes back without restarting (the lab is still open, no
    splash) and prints one link line with source shortcut. `adb logcat -b main | grep -c "Unable to find viewState"`
    stays 0.
17. **Not yet covered:** the tile with the phone locked behind a PIN (it asks to unlock, then opens the
    search); the Search widget's mic (at its medium size, 4×2: the Compose widget shows the mic only from 250 dp
    wide); Search in Ardia on text selected in a real app; a share from a real app (Chrome's Share › Ardia).
18. **Widgets and dark mode:** with the app in the background, switch the phone between light and dark: both
    widgets' backdrops follow within a second.
19. **Scanner:** Scanner section › Ask for camera, then point at the Mac's sync code: one
    `PAGELAB scan code: N characters, 24 words, valid true` line and nothing with the words; another QR code
    gives `rejected`. Pause stops the camera (its light goes off). The phrase never appears in logcat.
20. **Voice:** Voice section › Ask for mic, Start, speak: `PAGELAB voice partial "…"` lines and one `final`
    line; Stop ends it; a silent start ends with `failure nothing heard`. In airplane mode, note whether words
    still arrive (they do when the phone has an on-device recognizer).
21. **Swipe and pull:** on the lab's page after two navigations, with Swipe anywhere: a drag right from mid-page
    goes back, left goes forward, short drags spring back; a horizontally scrolling area (a carousel) scrolls
    instead. Swipe edges: only drags from within a finger's width of the edge navigate. Pull on: at the top, a
    pull past the arrow's full turn taps a haptic and reloads with the spinner; scrolled down, a downward drag
    scrolls.
22. **Online again and favicons:** System › Favicon looks prints three lines with tones and backings; turn
    airplane mode on and off: `network lost`, then `online again` once.
23. **Accessibility dump:** in the app (not the lab), open the tray, the page menu, a long-press menu, Spaces
    and the Archive sheet in turn, and with each open run
    `adb shell am broadcast -a com.ardia.phone.A11Y_DUMP -p com.ardia.browser.android` and
    `adb logcat -d -s PAGELAB | grep "PAGELAB a11y"`. The lines between `begin` and `end` are what TalkBack can
    reach; the surface behind a cover should not be among them.

## Telemetry

Off until the user chooses, in Settings (Share anonymous usage stats, with What's Sent) or on onboarding's last step. The consent model is the Mac's: nothing is sent, queued or counted while sharing is off, turning it off drops the queue, the day's counts and any request in flight at once, and an install ID is made only the first time sharing is turned on. Unlike the Mac, the phone sends no `daily_active` ping while sharing is off.

The gate is one file, `apps/phone/src/lib/telemetryGate.ts` (`createGate`): every capture, count and send goes through `isSharing()` there, and `state/telemetry/telemetry.ts` makes the app's one instance on the preferences table (`telemetry.sharing`, `telemetry.installId`, `telemetry.daily`, none of which the old iPhone app's import can set). The schema is `lib/telemetrySchema.ts`: every field is a fixed value, an enum, a bounded count or duration, or a version or UUID pattern, and a record that fails it is never queued. The OTLP encoding is shared with the Mac through `packages/core/src/telemetryWire.ts`.

Events (service `ardia-phone`, `$lib` `ardia-phone-telemetry`, tags `app: phone` and `platform: android|ios` on every one):

| Event | Fields | When |
| --- | --- | --- |
| `sharing_turned_on` | `source` (settings, onboarding) | turning sharing on |
| `app_launched` | `legacy_import` (imported, skipped, none) | each launch with sharing on |
| `perf_launch` | `launch_ms`, `js_ms` | each launch, once the module gives the process start (`ArdiaPhoneSystem.processStartedAt()`, epoch ms) |
| `usage_counts` | `tabs_opened`, `searches`, `pins_to_mac`, `tabs_sent`, `page_processes_gone` | once a day, for the previous UTC day, when anything was counted; private tabs are never counted |

On the dashboard they are kept out of every Mac section by source and lib (`PHONE_APP_SOURCE` in `apps/dashboard/src/server/sql.ts`).

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

### The lab switch

The page lab (`com.ardia.phone.PAGE_LAB`) and sync's demo mode (`com.ardia.phone.SYNC_DEMO`) exist only in lab
builds. `gradle-locked` makes them: it passes `-PardiaLab=true`, which `@ardia/phone-native` turns into
`BuildConfig.ARDIA_LAB` (checked before either launch extra is read), and sets `EXPO_PUBLIC_ARDIA_LAB=true`, which
`index.js` reads at bundle time, so a build without it has no lab JavaScript at all and never makes the demo
controller. Even in a lab build the demo is refused while real sync is set up. The app's Gradle file fails the build
when the property and the variable disagree, and Metro's cache is keyed on the variable.

A store build leaves both off:

```
ARDIA_LAB=0 apps/phone/scripts/gradle-locked :app:bundleRelease
```

To see the lab with Metro, start it with `EXPO_PUBLIC_ARDIA_LAB=true pnpm -C apps/phone dev` and run a debug
build from `gradle-locked`.

### iPhone

```
scripts/agent/locked pod -- bash -c 'cd apps/phone/ios && pod install'     after native dependencies change
scripts/agent/locked xcodebuild -- xcodebuild -workspace apps/phone/ios/Ardia.xcworkspace -scheme Ardia \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath <your own dir> ARCHS=arm64 CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- \
  DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= build                                   JS bundled in
agent-device install com.ardia.browser.ios <dir>/Build/Products/Release-iphonesimulator/Ardia.app
```

The ad hoc identity signs locally for the simulator with each target's entitlements (the app group, so the app and
its extensions share the SwiftUI app's container) and needs no account or profile. The Podfile adds
`apps/ios/Packages/ArdiaKit` to the `ArdiaPhoneNative` pod as a local Swift package (ArdiaBrowser and ArdiaDesign);
Xcode links ArdiaKit into the pod's library and copies its resource bundles into the app. The app target must not
link ArdiaKit itself, or every symbol is linked twice; it finds ArdiaDesign's module for its intents through
`SWIFT_INCLUDE_PATHS`. iOS 27 refuses to launch an app without the scene lifecycle, which Expo 54's template lacks, so
`SceneDelegate` starts React Native in the scene's window and hands links, quick actions and Handoff to the module.

The project carries the SwiftUI app's extensions, compiled from `apps/ios/Share`, `Action` and `Widgets` in place with
that project's Info.plists and entitlement files: the Share extension, Open in Ardia and the widgets, under the same
bundle ids. The SwiftUI app's intents need its `AppModel`, so the app target has its own copies with the same names,
titles and phrases that post links instead.

- `system.initialLink()` and `system.addLinkListener()`: `{ kind, source }` with kind `open` (url), `search` (query),
  `voiceSearch`, `incognito`, `tab` (id), `macTabs` or `inbox`, and source `web` (an http link from another app),
  `system` (an `ardia://` link from a widget, the share sheet or the action), `shortcut`, `share` (the share
  sheet's inbox, when it couldn't open the app), `handoff` or `intent`.
- `defaultBrowser`: `status()` from ArdiaBrowser's `DefaultBrowserStatus`, shared with the SwiftUI app;
  `requestRole()` is always false on iPhone, which has no role prompt; `openDefaultAppsSettings()`.
- `legacy.available()` and `legacy.read()`: the SwiftUI app's tabs, archive, history and preferences, read from a
  copy of its SwiftData store so the store itself is never opened. `-ArdiaLegacyDump YES` logs what `read()` returns
  (`ARDIA_LEGACY` lines) and `-ArdiaLegacyRestore YES` also opens the first saved tab, for checking an import;
  `-ArdiaLogSystemLinks YES` logs each link (`ARDIA_SYSTEM_LINK`). These need a test build (below).

#### Sync on iPhone

`ArdiaPhoneSync` on iPhone wraps the SwiftUI app's `SyncService` (ArdiaKit's ArdiaSync) whole, behind the same
interface and events as Android. `PhoneSyncHost` owns the one service: `AppDelegate` creates it in
`didFinishLaunching`, registers the background refresh task (`com.ardia.browser.ios.sync`) and starts it, so a
background launch with no scene runs a cycle without React Native. `SceneDelegate` tells it when the app becomes
active and resigns. Keys, the phrase's entropy and sealed bytes stay in Swift; only the typed phrase crosses, to
`connect`.

- **Continuing the SwiftUI app's sync.** Same bundle id, same container: the service reads `Application
  Support/Sync` (`sync.json`, `sync-state.nns`, `sync-journal.nns`, `sync-snapshot.nns`) and the `Ardia Sync Key`
  Keychain item, so a tester's phone keeps its device id and folder with no new connect.
- **The phone's data.** `packages/phone/ios/PhoneSync` (a Swift package the Podfile links into the pod) reads
  `Documents/SQLite/browser.db` read-only, one connection and one read transaction per cycle, with a busy timeout;
  the same rules as Android (open web tabs, 30 newest per profile, visits by page and profile, a missing file is an
  empty phone, a newer `user_version` fails the cycle). When the `-wal` and `-shm` files are gone it opens
  read-write with `query_only` on, since a read-only open can't start then. SyncService calls it on the main actor.
- **Sync's writes.** The inbox is `Application Support/PhoneSync/inbox.json` (excluded from backup), in Android's
  format and with its rules: replays add nothing, removals are merged and never dropped, an unreadable file is set
  aside, the next write refused and `inboxProblem` set.
- **Waiting for the import.** While the SwiftUI app's `Browser.store` exists and `legacy.markImported()` hasn't
  written `Application Support/PhoneSync/legacy-imported.json`, the source refuses to read and no cycle runs, in
  the foreground or in the background task; status says it is waiting. `legacy.imported()` reads the marker.
- **Widgets.** The host writes the Mac tabs widget's app-group snapshot with ArdiaDesign's `WidgetExporter`, the
  SwiftUI app's code, whenever the synced view changes.
- **Test build.** `ARDIA_TEST_BUILD=YES` on the xcodebuild line sets `ArdiaTestBuild` in Info.plist and
  `EXPO_PUBLIC_ARDIA_LAB=true` in the JS bundle phase; it is `NO` in the project, so a store build has no lab, no
  demo and no logging hooks. In a test build, `-ArdiaSyncDemo YES` swaps in `SyncService.demo` unless sync is set up,
  and `-ArdiaPageLab YES` opens the page lab. With Metro, start it with `EXPO_PUBLIC_ARDIA_LAB=true`.
- **Background refresh.** The app registers the task at launch and submits a request each time it resigns
  (the simulator's log shows `submitTaskRequest: <BGAppRefreshTaskRequest: com.ardia.browser.ios.sync …>`). On the
  iOS 27 simulator, `_simulateLaunchForTaskWithIdentifier:` from lldb on a backgrounded, suspended app did not run
  the handler. To check it on a device: run from Xcode, send the app to the background, pause, run
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.ardia.browser.ios.sync"]`,
  continue, and look for the Mac's latest send in `Application Support/PhoneSync/inbox.json`.

Edge swipes for back and forward are WebKit's own gesture. Simulator automation (agent-device swipes and pans from
the edge) has never triggered it; check it with a finger on a device or with the mouse in the Simulator window.

The first build takes about 25 minutes on a busy Mac; a native-only change rebuilds in 3 to 5, since the codegen and
Expo provider phases publish only files that changed.
