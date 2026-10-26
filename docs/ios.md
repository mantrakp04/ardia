# Ardia for iPhone

A native SwiftUI iPhone browser in the spirit of Arc Search, and Ardia's companion: it joins the Mac's
end-to-end-encrypted sync (`docs/sync.md`) as one more device, so your Mac's tabs, pinned tabs, bookmarks and
history are on your iPhone and your iPhone's tabs are on your Mac.

## Layout

```
apps/ios/
  project.yml                  XcodeGen spec; `xcodegen generate` writes Ardia.xcodeproj (both are checked in)
  Ardia.xcodeproj
  Config/                      Info.plists and entitlements
  App/                         the app target (a synchronized folder: new files need no project change)
  Widgets/                     the widget extension
  Share/                       the share extension
  Packages/ArdiaKit/           the app's logic, a Swift package testable on the Mac host (`swift test`)
    Sources/ArdiaShared        JavaScriptCore runtime for the TypeScript shared with the Mac
    Sources/ArdiaSync          the sync device: folder access, keys, the cycle, the synced snapshot
    Sources/ArdiaBrowser       tabs, history, archive, SwiftData models, WebKit, content blocking, omnibox
    Sources/ArdiaIntelligence  Apple Intelligence (Foundation Models): Browse for Me, summaries
    Sources/ArdiaDesign        design tokens and shared SwiftUI components
  scripts/bundle-shared.mjs    bundles packages/sync and packages/core for JavaScriptCore
```

Targets: iOS 27, iPhone only, Swift 6 with strict concurrency. The app target defaults to MainActor isolation.

## Code shared with the Mac

- **Swift.** `packages/sync/ios/Core` (recovery phrase, keys, file format, the vault) is the same code the Mac runs,
  built for iOS through `packages/sync/Package.swift`. Its macOS-only parts (the legacy rename migration, the Dock
  tile, the PDF kit, `SyncFolder`) are behind `#if os(macOS)`.
- **TypeScript.** The merge (`packages/sync/src/scope.ts`, `hlc.ts`, `canon.ts`, `order.ts`) and the omnibox
  (`packages/core/src`: URL fixup, search engines, bangs, calculator, suggestions) run in JavaScriptCore.
  `node apps/ios/scripts/bundle-shared.mjs` strips the types (Node's own `stripTypeScriptTypes`, no dependencies) and
  writes `ardia-sync.js` and `ardia-core.js` into `ArdiaShared/Scripts`. The bundles are checked in, so Xcode needs no
  Node; `--check` fails when one is out of date, and the sync and core test scripts run it. The entries are
  `packages/sync/src/companion/index.ts` (the iPhone's adapters and cycle) and `packages/core/src/mobile.ts`.
  The bundler handles the import and export forms these packages use; it refuses any other.

So a merge rule changed on the Mac is the iPhone's rule after the next bundle, and both devices converge by the
same code.

## Sync on iPhone

The iPhone is a device in the same chain: its own device id, its own logs, the same file format. Nothing about
the folder or the Mac's format changes, and a Mac that has never heard of the iPhone reads its files.

- **Folder.** iCloud Drive › Ardia Sync, the Mac's default. iOS gives an app no path into iCloud Drive without a
  container entitlement, and the Mac writes there without one, so the iPhone asks for the folder once with the
  system folder picker and keeps a security-scoped bookmark. Picking iCloud Drive itself works too: the app looks
  for Ardia Sync (or Netnyahoo Sync) inside it. Reads and writes go through `NSFileCoordinator`, which makes iCloud
  bring files down; dataless files are reported as pending, as on the Mac.
- **Joining.** The Mac's Settings › Sync › Connect Another Device shows a QR code of the phrase. The iPhone scans it
  (or takes the 24 words typed or pasted), checks the checksum, and checks that the folder holds that phrase's
  chain before saving anything. Its errors are the Mac's.
- **Keys.** The phrase's entropy is kept in the iPhone's Keychain (`Ardia Sync Key`, this device only,
  `AfterFirstUnlockThisDeviceOnly`, so background refresh can read it). The sync state (replica, base, version
  vectors, journal) is sealed with the file key in the app's container, like the Mac's `sync-state.nns`.
- **What the iPhone writes.** `dev:<id>` (its name), `tabs:<id>` (its 30 most recent open tabs, as the Mac does),
  history visits as `h:<url>` (the union rule the Mac uses), and `send:` records (below). It never writes settings,
  profiles, pins or passwords, and it keeps every record it doesn't use in its replica untouched, so its snapshots
  would be as complete as a Mac's. It doesn't compact; Macs do.
- **What it reads.** Device names, profiles (`prof:`, `pth:`), the search engine settings (`set:searchEngine`,
  `set:customSearchUrl`, `set:customSearchEngines`), and per profile the other devices' tabs, pinned tabs and groups,
  bookmarks and history.
- **Cycle.** On launch, on returning to the foreground, every 15 s while in the foreground, 3 s after a local
  change, on pull to refresh, and in background app refresh (`com.ardia.ios.sync`).

## What the app does

Arc Search's shape, measured from its App Store screenshots, preview videos and a teardown of version 1.49 (springs,
sizes, copy), on Apple's controls:

- **Start.** The app opens on a search sheet over a grainy indigo-to-pink gradient (a synced profile's Mac theme
  replaces it), keyboard up. Suggestions come from the Mac's own omnibox code: open tabs, local and synced history,
  bookmarks, the Mac's tabs, network suggestions, bangs and the calculator. Dragging along the rows scrubs them.
- **Browsing.** No URL bar: the page runs under the status bar, with a frosted bottom bar (tab stack, +, chevron)
  tinted by the page. Swipe the bar to switch tabs, swipe anywhere to go back. The chevron opens the page menu:
  back, forward, title, pin, reload; Reader, Summarize, Copy Link (without trackers), Share; Find on Page, Send to a
  Mac, Night Shade, Page Zoom, Request Desktop Site, Translate, Site Settings.
- **Tabs.** An app-switcher deck of live snapshots; flick a card up to close it. Closing archives; tabs left alone
  archive after a chosen interval (24 hours by default). Private tabs live in memory with their own website data.
  The Mac's Spaces (profiles), pinned tiles, rows and groups, and its open tabs sit behind the deck's leading button.
- **Blocking.** Ads, trackers and cookie banners: seed rules plus EasyList, EasyPrivacy and the EasyList Cookie List
  converted on device, and a reject-all script for consent platforms; off per site from the page menu.
- **AI features** (off by default, Settings › Experiments): Browse for Me (reads the top results and writes a
  page) and Pinch to Summarize, on Apple Intelligence's on-device model. Nothing runs while they're off.
- **System.** Widgets (search, the Mac's tabs, Lock Screen), Control Center controls, App Intents and Siri phrases,
  a share extension and an Open in Ardia action, Spotlight for open and archived tabs, Handoff of the current page,
  Home Screen quick actions, and http/https link handling. The default-browser entitlement is in
  `Config/Ardia-Release.entitlements` for Release builds only, since it needs Apple's approval.

## Demo mode and launch arguments

`-ArdiaDemo YES` runs on an in-memory store with `SyncSnapshot.demo` (a MacBook Pro and a Mac Studio, two profiles)
and never touches real data. Add `-ArdiaAIFeatures YES` for the AI features. Captures can be driven without touch:
`-BrowseQuery <text>`, `-BrowseSurface browsing`, `-BrowseTab <n>`, `-BrowseToolbar`, `-BrowseSummary`,
`-BrowseReader`, `-BrowseForMe <query>`, `-BrowseIncognito`, `-BrowseDelay <s>`, `-ArdiaDeck <script>`,
`-ArdiaOnboarding YES`, `-ArdiaOpenSheet archive|spaces`, `-BrowseForMeResults` (a Browse for Me tab on the
search engine side), and `-BrowseForMeDemo <state>` to force a Browse for Me state (`offline`, `noResults`,
`appleIntelligenceOff`, `deviceNotEligible`, `modelDownloading`, `writingFails`, `slow`).
Motion captures: `-BrowsePagerFreeze <fraction>` holds a tab swipe part way (negative swipes toward the
previous tab), `-BrowsePagerScript` plays a scripted swipe (cancel, edge, commit, interrupted commit), and
`-BrowseLoadFreeze <progress>` holds a page load with its loading line and placeholder.

## Tests

- `swift test --package-path apps/ios/Packages/ArdiaKit` runs the package's Swift Testing suites on the Mac host:
  sync end to end over a real vault with a fake Mac, the browser layer (tabs, archive, blocking converter, omnibox,
  reader extraction in a real WKWebView), Apple Intelligence (sources, budgeting, the state machine, the parser),
  and the JavaScriptCore bridge.
- `pnpm --filter @ardia/sync test` includes the companion's tests and checks the bundles are current.
- The app's own states are checked in the simulator (see the agent notes below).

## Left for a person

A real iPhone and a real Mac on the same iCloud account: scan the code, pick the folder, and watch tabs, history,
bookmarks and sent tabs go both ways; a relaunch and a reboot keep the folder bookmark; background refresh runs.
The simulator can't sign in to iCloud Drive.

## Agent notes

- Build into your own derived data under your scratch folder:
  `xcodebuild -project apps/ios/Ardia.xcodeproj -scheme Ardia -destination 'platform=iOS Simulator,id=<udid>' -derivedDataPath <scratch>/dd -quiet build`.
  Package tests: `swift test --package-path apps/ios/Packages/ArdiaKit --scratch-path <scratch>/spm`.
- Simulators: clone the project's simulator for yourself (`xcrun simctl clone "iPhone 18 Pro (tandem)" "Ardia <you>"`),
  boot it headless (`xcrun simctl boot`; never open Simulator.app), install and launch with `simctl`, capture with
  `xcrun simctl io <udid> screenshot`, and delete your clone when you're done.
- Never add files to the project by hand or regenerate it: the folders are synchronized. Info.plist keys,
  entitlements and new targets go through `project.yml` (ask the main session).
- No comments in code, no em dashes anywhere (code, UI copy, docs).
