# Ardia for Android

A native Kotlin and Jetpack Compose browser for Android phones that does what the iPhone app does (`docs/ios.md`),
in the Mac's colours. It joins the Mac's end-to-end-encrypted sync (`docs/sync.md`) as one more phone, so your Mac's
tabs, pinned tabs, bookmarks and history are on the phone and the phone's tabs are on your Mac.

## Layout

```
apps/android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml, gradlew   Gradle 9.9 with the wrapper checked in
  shared/     Hermes and ScriptEngine: loads the shared bundles, a JNI shim (src/main/cpp) over Hermes's JSI
  sync/       the sync device. core/ is the port of packages/sync/ios/Core (phrase, keys, file names, sealed
              format, vault); the rest is the folder (Storage Access Framework), the Keystore, the cycle and WorkManager
  browser/    PageEngine and the system WebView behind it, page scripts, snapshots, downloads, the Omnibox bridge
  store/      tabs, history, archive, snapshots and preferences in SQLite, and the omnibox model over ardia-core.js
  blocking/   the filter list parser and matcher, the list catalogue and downloads, the consent script
  design/     tokens, the profile look, the theme, frosted surfaces, symbols, toasts and shared Compose components
  appmodel/   the app's state and actions, the port of the iPhone's AppModel; no screens
  search/     the start screen, the search tray and voice search
  browsing/   the page, the bottom bar, the page menu, find on page, Reader, page prompts
  tabs/       the tab deck, the Archive and the Mac's Spaces
  settings/   Settings and its pages, sync setup with the code scanner, onboarding
  app/        MainActivity, the root view, the manifest and icons, widgets, the share target, the Quick Settings tile
  scripts/    gradle-locked, swift-crosscheck.sh and the Swift package it runs against packages/sync
```

The dependencies point one way. `shared` is at the bottom; `sync`, `browser` and `store` build on it, and `blocking`
and `design` stand alone. `appmodel` joins those six and re-exports them. Each screen module (`search`, `browsing`,
`tabs`, `settings`) depends only on `appmodel`, never on another screen module: what one screen needs from another goes
through `AppModel` state. `app` depends on `appmodel` and the four screen modules. Only `browser` touches
`android.webkit`.

Targets: minSdk 29, compileSdk and targetSdk 36, phone layouts only, arm64-v8a and x86_64. The application id is
`com.ardia.browser.android`.

## Code shared with the Mac and the iPhone

- **The bundles.** The phone runs the same `ardia-sync.js` (the merge and the companion cycle, from
  `packages/sync/src/companion/index.ts`) and `ardia-core.js` (the omnibox: URL fixup, search engines, bangs,
  calculator, suggestions, from `packages/core/src/mobile.ts`) as the iPhone. There is no Android copy: the build reads
  them from `apps/ios/Packages/ArdiaKit/Sources/ArdiaShared/Scripts`, where `node apps/ios/scripts/bundle-shared.mjs`
  writes them.
- **Hermes.** `com.facebook.hermes:hermes-android` from Maven Central, the Hermes React Native 0.88.1 ships, so it is
  the engine family the Mac app runs this code in. Its `libhermesvm.so` needs `libjsi.so`, which only `react-android`
  ships: the build takes that one library and the JSI headers out of `react-android` 0.88.1 and nothing else.
- **Bytecode.** The `shared` module's Gradle tasks fetch `hermesc` from the npm package `hermes-compiler` at the same
  version, check it against its npm integrity hash, compile both bundles to `.hbc` with `-O -Xes6-block-scoping` and
  put them in the module's assets. `-Xes6-block-scoping` is required: without it hermesc gives every `let` in a loop one
  shared slot. The versions live once, in `gradle/libs.versions.toml`.
- **ScriptEngine** has the Swift one's contract: load the bundles, `register` synchronous host functions under
  `__host`, `call` with JSON arguments, `callAsync` that drains microtasks until the promise settles.
- **What stays Kotlin.** Files, keys, Android APIs and the page engine. A rule the shared TypeScript has is called
  through ScriptEngine, never written again in Kotlin. The sync file format (`sync/core`) is Kotlin because the Mac's is
  Swift, and it is held to the Swift code byte for byte (Build and test, below).

So a merge or omnibox rule changed on the Mac is the phone's rule after the next bundle, as on the iPhone.

## The page engine

`com.ardia.browser.PageEngine` is the seam: it opens, finds and closes `Page`s, and a `Page` loads, navigates, finds,
zooms, downloads, extracts readable content, draws a snapshot, samples its tone and saves its state. Nothing outside
`browser` sees what is behind it.

Today it is `DevelopmentWebViewEngine` over the system WebView (`isDevelopmentOnly` is true). That costs, against the
iPhone's WebKit:

- **No blur behind the bottom bar.** A Compose layer can't blur the WebView under it, so the bar takes the page's tone
  as a solid colour. Frosted surfaces over Compose content blur on Android 12 and later.
- **Page zoom scales text only** (`textZoom`), not the layout.
- **Mixed content is blocked** (`MIXED_CONTENT_NEVER_ALLOW`): an http image on an https page doesn't load.
- **Snapshots are drawn from the view**, so video and other hardware layers come out blank on the tab cards.
- **Private pages need a WebView with multi-profile support** (`WebViewFeature.MULTI_PROFILE`). Without it Incognito
  is off and says it needs a newer Android System WebView. Each private session gets a new profile. Its cookies, storage
  and cache are cleared when private browsing ends, but its folder stays on disk until the next start: androidx.webkit
  cannot delete a profile that was loaded in the running process, so leftover private profiles are deleted when the
  app next starts, before any is loaded. An app that is killed in the middle of a private session leaves that profile
  until then.
- **Private tabs keep the window out of Recents.** While any private tab is open, or Incognito is on, the window is
  hidden from Android's Recents preview (`setRecentsScreenshotEnabled(false)` on Android 13 and later, `FLAG_SECURE`
  below that, which also blocks screenshots).
- **Downloads run in the app** (`SystemDownloads`, into the shared Downloads folder through MediaStore), with a toast
  and no system notification, and they end with the process. Private downloads stop when private browsing ends.

Ardia's own Chromium is planned to replace the WebView behind the same interface; the screens won't change.

## Sync on Android

The phone is a device in the same chain as the iPhone: its own device id, its own logs, the same file format, device
kind `phone`. A Mac that has never heard of it reads its files.

- **Folder.** Android can't reach iCloud Drive. The phone asks for the folder once with the system folder picker
  (`ACTION_OPEN_DOCUMENT_TREE`) and keeps a persisted permission to it. Picking the parent works too: the app looks
  for Ardia Sync (or Netnyahoo Sync) inside it. Every read and write goes through the folder's documents provider
  (`DocumentTreeStorage`); files the provider reports as partial or virtual are pending, as on the Mac.
- **What a provider can and can't guarantee.** The app writes each file under a staging name, reads it back, renames
  it into place and reads it back again; a provider that can't rename gets the file written in place and read back.
  A write that doesn't read back as the same bytes fails and is retried, so a provider that drops or truncates files
  can't break the chain. What the read-back can't prove is delivery: when and in what order the provider carries the
  files to the Mac is up to the provider. `SyncThroughACarrierTest` holds the cycle to late, out-of-order and
  half-written delivery.
- **Joining.** The Mac's Settings › Sync › Connect Another Device shows a QR code of the phrase. The phone scans it
  with the camera (CameraX and ZXing) or takes the 24 words typed or pasted, checks the checksum, and checks that the
  folder holds that phrase's chain before saving anything.
- **Keys.** The phrase's entropy is sealed with an AES-GCM key in the Android Keystore (`Ardia Sync Key`, no user
  authentication, so background sync can read it). Test instances use `FileKeyStore`, a 0600 file, like the Mac's.
- **What it writes and reads.** The same as the iPhone, from the same code: `dev:`, `tabs:` and `h:` records, `send:`
  records, and a new bookmark when you Pin to Mac; it keeps every record it doesn't use untouched.
- **Cycle.** On launch, on returning to the foreground, every 15 s in the foreground, 3 s after a local change, and on
  pull to refresh. In the background, WorkManager runs it every 15 minutes on a network with the battery not low, and a
  one-time job finishes a pending write after the app leaves the screen.
- **Open question.** The Mac writes to iCloud Drive, and the phone can't read that, so the Mac's folder has to reach
  the phone through a provider the user chooses (another cloud drive the Mac also syncs, or a folder sync app). Which
  one to recommend, or whether the Mac should offer a second location, is not decided.

## What the app does

The iPhone app is the spec: the same screens, copy and defaults, on Material's controls where Android has its own
manner, in the Mac's colours. Where Android differs it says so on the line.

- **Launch.** The first frame draws before the store, Hermes, the page engine and sync are ready: `AppModel` starts
  them in the background and the screens fill in. `ArdiaApplication` starts loading the two preference files on a
  background thread first thing (`AppEnvironment.preloadPreferences`); if the model is built before that finishes,
  its first preference read still waits for it on the main thread. `StartupTiming` logs time to first frame under
  `ArdiaTiming`.
- **Colours.** `ProfileLook` (`design`) is the Mac's profile look: the nine profile colours (plum is the default) and
  the Mac's window tint for each, checked against the Mac's values in `ProfileLookTest`. Settings picks one of the nine;
  with sync on, Match My Mac follows the selected profile's colour or custom theme. `ProfileBackdrop` draws the tint
  behind every screen, with the system's cells on top. Dark and light both follow the system.
- **Start.** The app opens on the search tray over the window tint, keyboard up. Suggestions come from the Mac's own
  omnibox code: open tabs, local and synced history, bookmarks, the Mac's tabs, network suggestions, bangs and the
  calculator. Dragging along the rows scrubs them. A copied link or text is offered as a row to paste.
- **Voice search.** Android's `SpeechRecognizer` with the web search model, where the iPhone uses Apple's dictation.
  It asks for the microphone the first time.
- **Browsing.** No URL bar: the page runs under the status bar, with the bottom bar (tab stack, +, chevron) in the
  page's tone (solid, not frosted; The page engine, above). Swipe the bar to switch tabs, swipe the page to go back.
  System back goes back in the page, then closes what is open; predictive back previews it. The chevron opens the page
  menu: back, forward, title, Pin to Mac, reload; Reader, Copy Link (without trackers), Share; Find on Page, Send to a
  device, Night Shade, Page Zoom (text only on Android), Desktop Site, Translate, Site Settings. Touching and holding a
  link offers Open in New Tab, Open in Background, Copy Link, Share and Download Linked File; an image, Save Image.
- **Copy and share.** Every Copy Link in the app copies the link without trackers and says so, as on the iPhone; Share
  is the system share sheet.
- **Tabs.** A deck of snapshots; flick a card up to close it. Closing archives; tabs left alone archive after a chosen
  interval (24 hours by default). Private tabs live in memory in their own WebView profile (The page engine, above).
  The Mac's Spaces (profiles), pinned tiles, rows and groups, and its open tabs sit behind the deck's leading button.
- **Downloads.** In the app, into Downloads, announced with a toast (The page engine, above).
- **Settings.** The iPhone's pages: the colour, sync and connecting a device, search engine, filter lists, My Filters,
  Trusted Sites, site settings, clearing data, the default browser, where app links open, Export Open Tabs, About and
  licences.
- **Default browser.** Android lets any browser ask for the browser role, so onboarding and Settings show the step
  and the button opens the system's role dialog (or Default Apps where the role can't be asked for). The iPhone hides
  the step until Apple grants its entitlement.
- **Onboarding.** Welcome, blocking, default browser, sync, all set. System back on the first run finishes onboarding.
- **Accessibility.** Every control has a label, large font sizes wrap instead of clipping, and what a sheet or a
  full-screen cover hides is hidden from TalkBack too.

## Blocking

Ads, trackers and cookie banners, off per site from the page menu. The iPhone converts lists to WebKit content rules;
the WebView has no such thing, so the `blocking` module parses filter lists and matches requests itself.

- **Lists.** The same uBlock Origin catalogue as the iPhone (`FilterListCatalog.json`, a copy of the iPhone's), with
  the same default selection: the default lists, the lists for your languages, the mobile lists, and the EasyList
  Cookie List always on. Seed rules cover the first launch before any list has downloaded, and lists refresh on their
  catalogue schedule. My Filters takes your own rules.
- **Matching.** `FilterParser` turns a list into network rules (with domain, party and resource type options and
  exceptions) and cosmetic rules; lists are compiled once to a file and loaded from it. The page engine asks the
  matcher about every request and injects the element hiding CSS and the reject-all consent script.
- **Budgets.** A list over 16 MB is refused, a line over 16 KB or a pattern over 2 KB is skipped, a cosmetic rule
  takes up to 100 selectors, and regular expressions are checked for catastrophic patterns before they are kept. Per
  request, regex reads are capped at 50,000 and wildcard steps at 2,000,000, over at most 4 KB of URL, so no rule can
  stall a page load.
- **Skipped.** Scriptlets (`##+js`), procedural and extended cosmetics (`#?#`, `#$#`, `##^`), and options that rewrite
  or need what the WebView doesn't expose (`csp`, `removeparam`, `redirect-rule`, `header`, `cname`, `denyallow` and
  the like). Each skipped line is counted by reason, so a list's detail page shows how much of it applies.

## System entry points

| iPhone | Android |
| --- | --- |
| Default browser and http/https links | the browser role and `VIEW` intent filters for http, https and `ardia://` |
| Home Screen widgets (search, the Mac's tabs) | Glance widgets: Search and Your Mac's Tabs |
| Lock Screen widgets | none |
| Control Center controls | a Quick Settings tile: Search |
| Home Screen quick actions | app shortcuts: Search, Voice Search, New Incognito Tab, Open Synced Tabs |
| Share extension | a share target (`ShareActivity`): Open in Ardia, Search in Ardia, Send to Your Mac |
| Open in Ardia action | the same share target, and Search in Ardia in the text selection menu (`PROCESS_TEXT`) |
| App Intents and Siri phrases | `WEB_SEARCH` intents; no assistant phrases |
| Spotlight for open and archived tabs | none |
| Handoff of the current page | none: Android has no counterpart |

## Launch arguments and demo mode

The iPhone's launch arguments are intent extras on Android, with the same names. They are read only in debuggable
builds (`ArdiaApplication.acceptsLaunchArguments`), so a release build ignores them.

```
adb shell am start -n com.ardia.browser.android/.MainActivity --ez ArdiaDemo true --es BrowseQuery otters
```

`ArdiaDemo` runs on an in-memory store with the demo snapshot (two Macs, two profiles) and never touches real data.
The rest drive captures without touch: `BrowseOpen <url>`, `BrowseQuery <text>`, `BrowseSurface browsing`,
`BrowseTab <n>`, `BrowseToolbar`, `BrowseReader`, `BrowseIncognito`, `BrowseDelay <s>`, `BrowseDeck`,
`BrowseDeckOpen <n>`, `BrowsePlus`, `BrowseOverlay <text>`, `BrowseSteps <n,n>` with `BrowseStepGap <s>`,
`ArdiaDeck <script>`, `ArdiaOnboarding`, `ArdiaOpenSheet <sheet>`, `ArdiaOpenSettings`, `ArdiaRestingStart`,
`ArdiaColor <name>`, `ArdiaToast <text>` and `ArdiaTrustedSites`. Motion captures, demo only: `BrowsePagerFreeze
<fraction>`, `BrowsePagerScript` and `BrowseLoadFreeze <progress>`. Flags take `--ez` (or any string but false, no
and 0); everything else can be `--es`. `LaunchArguments.kt` in `appmodel` is the list.

## Build and test

Run Gradle from `apps/android` through `scripts/gradle-locked` (Agent notes, below):

```
scripts/gradle-locked :app:assembleDebug                app at app/build/outputs/apk/debug/app-debug.apk
scripts/gradle-locked :app:installDebug                 on the connected emulator or phone
scripts/gradle-locked :<module>:testDebugUnitTest       one module's JVM and Robolectric tests
scripts/gradle-locked :<module>:assembleDebugAndroidTest   one module's device tests, compiled
scripts/gradle-locked connectedDebugAndroidTest --continue  every module's device tests on the one emulator
```

Needs JDK 17 or later, the Android SDK (`ANDROID_HOME` or `local.properties`), NDK 27.1.12297006 and CMake 3.22.1. The
first build downloads Gradle, Hermes, `react-android` (for `libjsi.so`) and `hermes-compiler`.

- **JVM unit tests** in each module's `src/test`: the sync core against the reference vectors and the 0.2.32 fixture,
  the controller and the folder storage; the store (tabs, history, archive, preferences, durability); the blocking
  parser, matcher, cosmetics, list safety and matcher speed; design tokens, the profile look and motion; the app model;
  and each screen module's rules.
- **Robolectric screen tests** compose the real screens on the JVM with a demo `AppModel`: `ScreensTest` in `tabs` and
  `BackOrderScreenTest` in `browsing`. The app's share sheet, system entry and widget snapshot logic run under
  Robolectric too.
- **Instrumented tests** in each module's `src/androidTest` need what only a device has: ScriptEngine and Hermes
  bytecode (`shared`), sync end to end with a fake Mac in Hermes, through a picked folder (`TestDocumentsProvider`), a
  late carrier, WorkManager and the Keystore (`sync`), a real WebView loading pages from a local server with blocking,
  private pages, snapshots, downloads and readable content (`browser`, `blocking`), the omnibox in Hermes (`store`),
  the app model on a device (`appmodel`), each screen in Compose UI tests (`search`, `browsing`, `tabs`, `settings`),
  and the app's system entry points, startup timing and TalkBack reach (`app`). Nothing depends on the network.
- **The screen tour** (`ScreenTourTest` in `app`) opens every screen in light and dark from demo mode and saves a
  picture of each, named like `03-page-dark.png`, under `app/build/outputs/connected_android_test_additional_output`
  (and on the device in `/sdcard/Android/media/com.ardia.browser.android/screen-tour`). A screen it couldn't reach is
  saved with `-unreached` in its name and fails the test.
- **The Swift cross-check.** `scripts/swift-crosscheck.sh` has the real Swift `packages/sync` write a vault that
  Kotlin opens, and Kotlin write one that Swift opens (payloads, tags, passwords, the phrase). Set
  `ARDIA_CROSSCHECK_DIR` to keep the files. It runs on a Mac, not in CI.
- `node apps/ios/scripts/bundle-shared.mjs --check` guards the bundles both phones run.
- **CI** (`.github/workflows/android.yml`, on pull requests and pushes to `main` that touch `apps/android`, the
  bundles, `packages/sync`, `packages/core` or the workflow, behind the vouch gate) builds the app and every test and
  runs the unit tests in one job, and runs every module's instrumented tests on an API 35 emulator in another. It keeps
  the test reports and the screen tour as artifacts.

## Left for a person

A real phone and a real Mac: pick a folder that a provider keeps in step with the Mac's sync folder, scan the code,
and watch tabs, history, bookmarks and sent tabs go both ways; a reboot keeps the folder permission; background sync
runs under Doze. Then what an emulator can't show: the camera scanning the Mac's code, the browser role dialog and
links from other apps, TalkBack through every screen, private pages on the WebView the phone actually has, downloads
on its storage, the widgets and tile on its launcher, and speed on a slow phone.

## Agent notes

- Run Gradle only through `apps/android/scripts/gradle-locked <tasks>`: it holds a lock so one Gradle build runs at a
  time across agents, and exits 75 when it waited too long (try again). Build only the modules you changed; no `clean`,
  no `--no-daemon`, no whole-project `build` or `assembleDebug`.
- One emulator at a time on this Mac, booted headless (`emulator -avd <name> -no-window`) and shut down when you're
  done. Use T3's device tools for anything interactive.
- No comments in code, no em dashes anywhere (code, UI copy, docs).
