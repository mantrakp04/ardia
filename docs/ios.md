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
  Action/                      the Open in Ardia action extension (target ArdiaOpen)
  Packages/ArdiaKit/           the app's logic, a Swift package testable on the Mac host (`swift test`)
    Sources/ArdiaShared        JavaScriptCore runtime for the TypeScript shared with the Mac
    Sources/ArdiaSync          the sync device: folder access, keys, the cycle, the synced snapshot
    Sources/ArdiaBrowser       tabs, history, archive, SwiftData models, WebKit, content blocking, omnibox
    Sources/ArdiaDesign        design tokens and shared SwiftUI components
  scripts/bundle-shared.mjs    bundles packages/sync and packages/core for JavaScriptCore
  scripts/asc.mjs              App Store Connect client for the TestFlight release
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
  chain before saving anything. Its errors are the Mac's. A different phrase entered after a failure clears the old
  error and, with a folder already chosen, tries again at once (`SyncConnectFlow`); the same words retyped don't.
- **Keys.** The phrase's entropy is kept in the iPhone's Keychain (`Ardia Sync Key`, this device only,
  `AfterFirstUnlockThisDeviceOnly`, so background refresh can read it). The sync state (replica, base, version
  vectors, journal) is sealed with the file key in the app's container, like the Mac's `sync-state.nns`.
- **What the iPhone writes.** `dev:<id>` (its name), `tabs:<id>` (its 30 most recent open tabs, as the Mac does),
  history visits as `h:<url>` (the union rule the Mac uses), `send:` records (below), and a new `bm:` bookmark in
  Other Bookmarks when you Pin to Mac (never from an Incognito tab, and never an edit or delete of an existing
  bookmark). A page is pinned once: when the profile's bookmarks already hold its URL (from a Mac, or a pin from
  this iPhone still on its way), the star is filled, the menu says "Pinned to Mac" and Pin to Mac writes nothing;
  `companionAddBookmark` refuses the duplicate too. There is no unpin, since the iPhone never deletes a bookmark. It never writes settings, profiles, pins or passwords, and it keeps every record it doesn't use in its replica untouched, so its snapshots
  would be as complete as a Mac's. It doesn't compact; Macs do. `companion.test.ts` holds it to that against a fake
  Mac writing every kind of record today's Macs write (settings, profiles and their themes, shared data, devices, pins
  with their rows, tile folders, homes, order and looks, bookmarks, history, passwords, extensions and their approvals,
  sends between Macs, tombstones) and a kind no build knows yet: after its cycles the Mac's records are the same bytes,
  and the iPhone wrote only its own `dev:`, `tabs:` and `h:` records and deleted only the send addressed to it.
- **What it reads.** Device names, profiles (`prof:`, `pth:`), the search engine settings (`set:searchEngine`,
  `set:customSearchUrl`, `set:customSearchEngines`), and per profile the other devices' tabs, pinned tabs and groups,
  bookmarks and history.
- **Devices.** Settings › Sync lists the other devices by name, with no time. A device writes to the folder only
  when its own data changes, never to say it is still syncing, so the newest file from a Mac that is syncing but idle
  can be hours old; the time it gave ("6 hr ago" for a Mac syncing every 15 s) read as "this Mac stopped". The Mac's
  own Devices list has the same limit. The list is still ordered by each device's newest change.
- **Cycle.** On launch, on returning to the foreground, every 15 s while in the foreground, 3 s after a local
  change, on pull to refresh, and in background app refresh (`com.ardia.browser.ios.sync`).

## What the app does

Arc Search's shape, measured from its App Store screenshots, preview videos and a teardown of version 1.49 (springs,
sizes, copy), on Apple's controls, in the Mac's colours:

- **Colours.** `ProfileLook` (`ArdiaDesign`) is the Mac's profile look: its nine profile colours with their swatches
  (plum is the default, as on the Mac) and the Mac's window tint for each (`windowTint`, the same sums as
  `lib/windowTint.ts`, checked against the Mac's values in `ProfileLookTests`). Settings › Color picks one of the nine,
  as the Mac's theme editor does; with sync on, Match My Mac (the default) follows the selected profile's colour or
  custom theme instead (`AppModel.look`, in the environment as `profileLook`, and in the widget snapshot).
  `ProfileBackdrop` draws it: the window tint top to bottom, pale in light and deep in dark, with the Mac's faint
  grain, and never white text on a bright gradient. Text on it takes the ink that reads (`inkIsLight`). The same
  tint is behind everything in the app, not only the start screen: Settings and its pages, the Archive, the page
  menu, the search tray, the bar and the page behind a loading site (`lookBackdrop()`, `look.surface`), with the
  system's white or dark cells on top, as the Mac's cards sit on its window. `Palette`
  holds the Mac's colour roles from `components/ui/tokens.ts`: `primaryAction` and `onPrimaryAction` for the main
  button, `formAccent` for links, checkmarks and the caret, `accent` for the loading line, `toast`, `panel`,
  `success`. A new colour is a role there or a value derived from the look, never a literal in a view. Incognito is
  the Mac's eyeglasses on its neutral dark tint.
- **Start.** The app opens on a search sheet over the profile's window tint (a synced profile's Mac
  theme replaces it), keyboard up. Suggestions come from the Mac's own omnibox code: open tabs, local and synced
  history, bookmarks, the Mac's tabs, network suggestions, bangs and the calculator. Dragging along the rows scrubs
  them.
- **Browsing.** No URL bar: the page runs under the status bar, with a frosted bottom bar (tab stack, +, chevron)
  tinted by the page. Swipe the bar to switch tabs, swipe anywhere to go back. The chevron opens the page menu:
  back, forward, title, pin, reload; Reader, Copy Link (without trackers), Share; Find on Page, Send to a
  Mac, Night Shade, Page Zoom, Request Desktop Site, Translate, Site Settings.
- **Tabs.** An app-switcher deck of live snapshots; flick a card up to close it. Closing archives; tabs left alone
  archive after a chosen interval (24 hours by default). Private tabs live in memory with their own website data.
  The Mac's Spaces (profiles), pinned tiles, rows and groups, and its open tabs sit behind the deck's leading button.
- **Blocking.** Ads, trackers and cookie banners: seed rules plus EasyList, EasyPrivacy and the EasyList Cookie List
  converted on device, and a reject-all script for consent platforms; off per site from the page menu.
- **System.** Widgets (search, the Mac's tabs, Lock Screen), Control Center controls, App Intents and Siri phrases,
  a share extension and an Open in Ardia action, Spotlight for open and archived tabs, Handoff of the current page,
  Home Screen quick actions, and http/https link handling. Being the default browser waits on an entitlement Apple
  grants on request (Releasing to TestFlight, below); until a build carries it, onboarding and Settings leave the
  default browser steps out.

## Demo mode and launch arguments

`-ArdiaDemo YES` runs on an in-memory store with `SyncSnapshot.demo` (a MacBook Pro and a Mac Studio, two profiles)
and never touches real data. Captures can be driven without touch:
`-BrowseQuery <text>`, `-BrowseSurface browsing`, `-BrowseTab <n>`, `-BrowseToolbar`, `-BrowseReader`,
`-BrowseIncognito`, `-BrowseDelay <s>`, `-ArdiaDeck <script>`, `-ArdiaOnboarding YES`,
`-ArdiaOpenSheet archive|spaces`, `-BrowsePlus` (taps the plus after twice the delay),
`-BrowseOverlay <text>` (the search tray over the page), `-ArdiaRestingStart` (the start screen without the tray),
and `-ArdiaColor <name>` (the colour picked in Settings).
Motion captures: `-BrowsePagerFreeze <fraction>` holds a tab swipe part way (negative swipes toward the
previous tab), `-BrowsePagerScript` plays a scripted swipe (cancel, edge, commit, interrupted commit), and
`-BrowseLoadFreeze <progress>` holds a page load with its loading line and placeholder.

## Tests

- `swift test --package-path apps/ios/Packages/ArdiaKit` runs the package's Swift Testing suites on the Mac host:
  sync end to end over a real vault with a fake Mac, the browser layer (tabs, archive, blocking converter, omnibox,
  reader extraction in a real WKWebView), and the JavaScriptCore bridge.
- `SyncThroughICloudTests` gives the fake Mac and the phone a folder each and carries files between them the way
  iCloud Drive does: late, out of order, as `.name.icloud` placeholders, deletions before the files they replace,
  and with "name 2" conflict copies and stray files. Its soak runs hours of random edits, sends and compactions on a
  test clock and checks both sides converge, nothing the Mac still has disappears from the phone, every sent tab
  arrives once and no seq is reused. iCloud's own delivery between devices is the one thing left for a real phone.
- `pnpm --filter @ardia/sync test` includes the companion's tests and checks the bundles are current.
- The app's own states are checked in the simulator (see the agent notes below).
- CI (`.github/workflows/ios.yml`, on GitHub's `xcode-27` runner with Xcode 27.1) builds the `Ardia` scheme for the
  simulator without signing and runs the ArdiaKit and `packages/sync` Swift tests and the bundle check, on pull
  requests and pushes to `main` that touch `apps/ios`, `packages/sync`, `packages/core` or the workflow.

## Left for a person

A real iPhone and a real Mac on the same iCloud account: scan the code, pick the folder, and watch tabs, history,
bookmarks and sent tabs go both ways; a relaunch and a reboot keep the folder bookmark; background refresh runs.
The simulator can't sign in to iCloud Drive.

Export compliance: the app's only encryption is Apple's own (CryptoKit's AES-GCM, HKDF and HMAC for sync, and
HTTPS), with no cryptography of its own and none from a third party, which Apple counts as exempt. So
`ITSAppUsesNonExemptEncryption` is false, a build needs no compliance code, and App Store Connect asks nothing per
build. Adding a cryptography library, or an algorithm implemented in the app, changes that answer.

## Releasing to TestFlight

The app record in App Store Connect is "Ardia", bundle id `com.ardia.browser.ios`, team `U5L5T3NGVV`; its extensions
are `.widgets`, `.share` and `.open`, and they share the app group `group.com.ardia.browser.ios`.

- **In CI.** Run the iOS Release workflow (`.github/workflows/ios-release.yml`) from `main`:
  `gh workflow run ios-release.yml -f mode=upload`. It archives the Release build, signs it and uploads it through the
  App Store Connect API key the Mac release notarizes with (`NOTARY_KEY_P8`, `NOTARY_KEY_ID`, `NOTARY_ISSUER`), then
  waits until App Store Connect has processed the build. `mode=status` lists what App Store Connect holds (the app
  record, App IDs, certificates, builds, tester groups, beta test info) and builds nothing; `mode=dry-run` stops at the
  signed .ipa. The build number is the one after the highest uploaded, refused uploads included, unless you pass `build`.
- **CI's certificate.** The archive signs with one development certificate kept in the `IOS_DEVELOPMENT_P12` and
  `IOS_DEVELOPMENT_P12_PASSWORD` secrets ("Apple Development: Created via API", expires 12 Nov 2027), so a run makes and
  revokes nothing on the team; a revoked certificate mails the account holder. To renew it: make a key and a signing
  request (`openssl req -new -newkey rsa:2048 -nodes -keyout key.pem -out request.csr -subj "/CN=Ardia CI"`), run
  `mode=certificate` with `signing_request` set to the request's base64, download the `ios-development-certificate`
  artifact, pack it with the key into a .p12 with macOS's `/usr/bin/openssl`, and set both secrets. Distribution signing
  is Apple's cloud-managed certificate and needs nothing stored.
- **On a Mac.** `scripts/release-ios.sh <build number>` does the same with the account Xcode is signed in to, or with
  `ASC_KEY`, `ASC_KEY_ID` and `ASC_ISSUER`. `node apps/ios/scripts/asc.mjs` is the App Store Connect client behind
  both (`--help` lists its commands).
- **Version.** `MARKETING_VERSION` in `project.yml` (then `xcodegen generate`), 1.0 for the alpha; the build number is
  never committed.
- **Default browser.** iOS lists an app under Settings, Apps, Default Apps, Browser App only when it is signed with
  `com.apple.developer.web-browser`, and Apple grants that per App ID on request: the account holder fills in
  https://developer.apple.com/contact/request/default-browser-entitlement/ for `com.ardia.browser.ios`. One build
  setting, `ARDIA_DEFAULT_BROWSER` (`NO` in `project.yml`), decides both halves: `YES` signs with
  `Config/Ardia-DefaultBrowser.entitlements` and sets `ArdiaDefaultBrowser` in Info.plist, which turns on the
  onboarding step and the Settings row; `NO` signs with `Config/Ardia.entitlements` and hides them, so the app never
  sends anyone to a list it isn't on. Until Apple grants it, signing with `YES` fails ("requires approval from
  Apple"). Once granted, pass `default_browser=true` (`--default-browser`), then make `YES` the default. The release
  script checks that the Info.plist value and the signed entitlement agree. The simulator needs no grant:
  `xcodebuild ... ARDIA_DEFAULT_BROWSER=YES` there exercises the whole flow.
- **Am I the default.** iOS answers `UIApplication.isDefault(.webBrowser)` four times a year, so `DefaultBrowserStatus`
  keeps the last answer and asks only on returning from the Settings button or after 100 days. A web link that
  arrives from another app also proves it. The simulator ignores the Settings deep link and opens Settings where it
  was left, so where the button lands is a real-phone check.
- **Testers.** A processed build reaches the Internal group at once. An upload also sends it to everyone else: it
  puts the build in the Public Testers group (made with a public link the first time), sets its What to Test text from
  `Config/TestFlight-WhatToTest.txt`, submits it for Beta App Review and prints the link. The link stays the same for
  every build and works once Apple approves one; later builds of the same version usually pass without a full review.
  Apple has no setting that gives an external group every build, so each one is submitted. `-f public_testers=false`
  keeps an upload to the Internal group, and `gh workflow run ios-release.yml -f mode=public-link -f build=<number>`
  sends an earlier build. To invite someone by email instead,
  `gh workflow run ios-release.yml -f mode=add-tester -f email=<address>` adds them to Public Testers; TestFlight
  emails the invite once that group has an approved build.

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
