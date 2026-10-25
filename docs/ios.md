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

## Tests

- `swift test --package-path apps/ios/Packages/ArdiaKit` runs the package's Swift Testing suites on the Mac host.
- The app's own states are checked in the simulator (see the agent notes below).

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
