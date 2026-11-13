# Ardia for iPhone

A native SwiftUI browser for iPhone, iPhone Duo and iPad in the spirit of Arc Search, and Ardia's companion: it
joins the Mac's end-to-end-encrypted sync (`docs/sync.md`) as one more device, so your Mac's spaces with their looks,
tabs, pinned tabs, bookmarks and history are on your iPhone and your iPhone's tabs are on your Mac. The redesign's
decisions are in `docs/ios-redesign.md`.

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
  scripts/bundle-tokens.mjs    writes ArdiaDesign/Tokens.generated.swift from the Mac's design tokens
  scripts/asc.mjs              App Store Connect client for the TestFlight release
```

Targets: iOS 27.0, one universal app for iPhone, iPhone Duo and iPad (`TARGETED_DEVICE_FAMILY` 1,2 on the app and its
extensions, every iPad orientation), Swift 6 with strict concurrency. The app target defaults to MainActor isolation.
The floor stays at 27.0 so one build installs on the 27.0 iPhone and iPad simulators and on the Duo's 27.1 one. The
Duo's 27.1 reads go through `ArdiaDesign/Chrome/DeviceFeatures.swift` (`onHingeStateChange`, `onVerticalBarEdgeChange`,
`GeometryProxy.reservedAreas`), the one place that checks `#available(iOS 27.1, *)`; views call those and never
write their own check.

## Layout by window size

`ChromeLayout` (`ArdiaDesign`) is in the environment as `chromeLayout`, read once at the root from the window's real
size, never from the device: `bar` under 640 pt wide (and in any window under 500 pt tall, so a phone in landscape
keeps its bar), `sidebarOverlay` from 640 to 819 pt, `sidebarDocked` from 820 pt. A resize or a fold changes it live.
The app has one window (`UIApplicationSupportsMultipleScenes` is off: there is one `AppModel` and one
`SidebarState`), which iPadOS still resizes in Stage Manager and Split View. `SidebarState` keeps only the sidebar's
own choices; every view and command passes the window's layout and hinge in.
`RootView` shows `PhoneShell` for `bar` and `SidebarShell` for the other two; the sheets, covers, toasts and scene
phase hang off the root, so both shells get them. The root also puts `hingeState` (`closed`, `partial`, `open`, or
nil without a hinge) and `windowCornerRadii` (the window's real corners) in the environment.

## Design tokens

`node apps/ios/scripts/bundle-tokens.mjs` reads the Mac's `components/ui/tokens.ts`, `ui/motion.ts` and
`window/tokens.ts` and writes `ArdiaDesign/Tokens.generated.swift`: `Tokens.Space`, `Radius`, `FontSize`,
`LineHeight`, `Tracking`, `Display`, `Weight`, `Hairline`, `Opacity`, `Duration`, `Spring`, `Shadow`, `Role` (colour
roles, dark and light) and `RoleValue`. It is checked in; `--check` fails when it is out of date. iOS CI runs the
check and the generator's tests (`bundle-tokens.test.mjs`), and runs whenever one of the Mac files it or the Swift tests
read changes; the Mac's own tests and release never run it, so a Mac token change doesn't wait on the iPhone. On top of
it: `Typography` (roles through Dynamic Type), `SidebarMetrics` (the Mac's sidebar at touch scale) and the glass kit
(`GlassBar`, `glassControl`, `glassPanel`, `.glassAction`, `.glassPrimaryAction`), which follows `interfaceStyle`
(glass or classic; Reduce Transparency forces classic). Controls that float over web content set `glassPlacement` to
`.overContent`, so their classic fills are opaque. The glass tint is the Mac's `controlGlassTint` and `panelGlassTint`
(`components/ui/Glass.tsx`): `GlassTintFixtureTests` hold it to `ArdiaKit/Fixtures/glass-tints.json`, which
`node --no-warnings --import ./apps/browser/src/test-loader.mjs apps/ios/scripts/glass-tint-fixture.mjs` writes from the
Mac's own functions (it needs the browser's packages installed; `--check` says whether the fixture is current).

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
- **What it reads.** Device names, profiles with their whole look (`prof:`, `pth:`, `pth:<id>:angle`) in the Mac's
  order (the `o` list on a Mac's `dev:` record), the search engine settings (`set:searchEngine`,
  `set:customSearchUrl`, `set:customSearchEngines`), the Mac's look settings as `lookSettings` (`set:appearance`,
  `interfaceStyle`, `glassTintWithTheme`, `glassTintAmount`, `selectedTabGlow`, `pageFrame`, `sidebarSide`,
  `profileSwitcherIcons`), and per profile the other devices' tabs, pinned tabs and groups, bookmarks and history.
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
  custom theme instead (`AppModel.look`, in the environment as `profileLook`). The widget snapshot carries the whole
  theme, and the widget builds its look with the same `ProfileLook(color:theme:)` as the app.
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
- **Browsing.** The page runs under the status bar and fills the screen, with the bottom bar floating over it as
  three Liquid Glass pieces: the tab stack (opens the deck), the address capsule (a lock or globe and the host; a tap
  opens search on the full address, its dots open the page menu) and the plus (new search; touch and hold offers
  Reopen Closed Tab). There is no strip behind them, and only the pieces take touches, so a link between or beside
  them can be tapped. The glyphs follow the page's light or dark tone. Scrolling down shrinks the bar to a small host
  pill (`BarCollapse`, Settings, Collapse Bottom Bar; on for new installs); scrolling up, reaching the top or a tap
  brings it back. WebKit is told the bar's height as an obscured inset, so a site's fixed footer lays out above the
  bar; the same inset carries the top safe area, or the page would start under the status bar. The bar gives way to
  Find on Page and to the search tray, and returns only after the find panel, the search tray and the keyboard have
  left (`BottomBarVisibility`). Where the screen has a side inset (the iPhone Duo's sensor edge, a phone on its side)
  the row keeps the larger inset on both sides, so the plus stays in the middle of the screen; where the system asks
  for a vertical bar (the closed Duo) the bar is a rail on that edge.
  Swipe the bar to switch tabs, swipe anywhere to go back. The page menu: back, forward, title, pin, reload; Reader,
  Copy Link (without trackers) and Share as icon buttons; then, in words, Find on Page, Send to a Mac, Print, History,
  Bookmarks, Downloads, Night Shade, Page Zoom, Desktop Site, Translate, Block Ads and Trackers, Site Settings and
  Open in Default Browser.
- **Tabs.** An app-switcher deck of live snapshots; flick a card up to close it. Closing archives; tabs left alone
  archive after a chosen interval (24 hours by default). Tabs live in the Mac's spaces: the deck, archive, Close All,
  Reopen and the selected tab belong to the current space, each space remembers its last tab, and tabs with no space
  or a gone space show under the default space (the rule the sync cycle publishes with, `SpaceRoster`). One manual
  order is shared by the deck and the iPad sidebar: new tabs at the end, links after their opener, as on the Mac. Every
  regular tab uses the default website data store, whatever its space; private tabs keep their own in-memory store.
  Clear Browsing Data also empties any per-space stores an earlier test build made, and removes them when everything
  is cleared. The deck is a strip in portrait and a grid in landscape or wide
  windows, with a search field in its glass bar and a one-line Archive banner until answered. Move to Space is in a
  tab's menu. The Mac's pinned tiles, rows and groups, and its open tabs sit behind the deck's leading button.
- **iPad and the open Duo.** `SidebarShell` (`App/Sidebar`) shows the Mac's sidebar and the page as a card.
  `SidebarVisibility` (`ArdiaDesign/Sidebar`) decides docked, hidden, overlay or half open. A hidden sidebar peeks as
  the Mac's does (`SidebarPeek`, values checked against the Mac's `dockMotion.ts` and `usePeek.ts` by a host test): the
  pointer on the window's edge strip floats it over the page with no scrim and it leaves 120 ms after the pointer is
  outside it; a finger swipe that starts in that strip pulls it in over a scrim. The page never resizes while it
  peeks; the toggle or Command-S pins a pointer peek and closes a touch one. With edge-only navigation the back swipe on the sidebar's side must
  start just inside the page, since the strip belongs to the sidebar. In glass style the New Tab row and the space
  switcher sit on glass. The width and the hidden
  choice are kept in UserDefaults (`sidebar.width`, `sidebar.hidesDocked`). `PageStage` is the page with everything
  that belongs to it; the phone's `BrowsingView` is `PageStage` plus `BrowsingBar`, and the iPad card reuses it.
  `BottomBarGeometry`, `BarCollapse` and `AddressSummary` in `ArdiaDesign/BrowseChrome` decide where the bar sits,
  when it shrinks and what the address capsule shows. Whoever presents `PageMenuContent` calls
  `app.browse.runMenuFollowUp()` on dismiss. A fold never reloads a page by itself: a page keeps the site version it
  was loaded with until its next load, because a reload could resend a form or drop what someone typed. The card's controls (Back, Forward, Reload, Share, the
  page menu) stay in place while the page scrolls under them; with the sidebar hidden the sidebar toggle leads them,
  on the side the sidebar comes from. WebKit has no public live resize, so when the card's width changes
  (`PageResizeCover`, rules in `ArdiaDesign/BrowseChrome/PageResize`) a snapshot of the page follows the card's edge
  on every frame, scaled on a page WebKit shrinks to fit and 1:1 on a page that reflows, and cross-fades to the live
  page once WebKit has laid out at the new width.
- **Icons or words.** A control in a bar, tile or pill is an icon with an accessibility label and a tooltip; an item
  in a list or menu is words. A picture stays beside words only where it is identity: a favicon, a space's badge, a
  device. Toasts keep their icons, as the Mac's do.
- **This device.** `ThisDevice` (`ArdiaSync`) gives the words for the device the app runs on ("iPad" or "iPhone", the
  default sync name, "This iPad"); views never write "iPhone" themselves. The Duo is an iPhone. A saved name that
  is exactly the other kind's default (an iPad that ran the old iPhone-only build and saved "iPhone") counts as
  unset and takes this device's default; any other saved name is kept.
- **Keyboard.** `BrowserCommand` (`ArdiaDesign/Commands`) holds the Mac's shortcuts, and `BrowserCommandTests` checks
  them against `packages/shell/ios/CommandTable.swift`. The menu bar comes from `App/Commands`.
- **Websites.** `SiteVersion` (`ArdiaBrowser/Web`) asks for desktop sites in sidebar layouts and mobile sites in the
  bar layout. A change applies to every live page, in every space, from its next load; nothing reloads by itself. A
  tab's Desktop Site choice (`WebTab.siteVersionOverride`) wins over the layout, and the agent, the content mode and
  a popup opened from the tab all follow it, including after a discarded page comes back.
- **Appearance.** The device keeps its own choices in `AppSettings` (`settings.interfaceStyle`,
  `settings.colorScheme`), both defaulting to Match My Mac. The root resolves them with the Mac's look settings
  through `AppearanceResolver`, injects `interfaceStyle` and `glassTintAmount` and sets `preferredColorScheme`.
  The glass tint is the Mac's own rule: with sync on it is 0 unless the Mac sent `glassTintWithTheme` true, then its
  amount (0.8 when it sent none, as on the Mac); with sync off it is the device's 0.15. Screens that draw a space
  backdrop apply `lookInk()` to their content. Onboarding picks its surface with `OnboardingSurface`: the space's
  backdrop with the space's ink (the welcome step and every wide layout), or the system surface with the app's own
  ink (stacked steps after the welcome), so ink and surface always agree. `.ink(...)` text in Settings is measured
  against the cell fill and the backdrop it is really on (`LegibleTint`). The toast window copies the interface
  style, glass tint amount, look and colour scheme from the root, so `.toastHost(app.toasts)` stays inside
  `.environment(\.profileLook, app.look)` and `.appearanceEnvironment()` in `RootView`. Settings opens as a page
  sheet with an Appearance page and a 640 pt readable column, and onboarding picks stacked, column or side by side
  from the window size (`PageComposition`). Collapse Bottom Bar defaults to on for new installs and shows only where
  there is a bottom bar (`ChromeLayout.hasBottomBar`). An install that already has settings (the onboarding,
  keyboard or colour key saved by an older build) is moved to off once, on the first launch of this version
  (`NewInstallDefault`, decided once by a marker key so a new install is never judged later); a saved choice is
  never changed.
- **Library.** One sheet with History, Bookmarks and Downloads (`AppModel.openLibrary(_:)`). History merges this
  device's visits in the current space (the rule the deck uses for tabs with no space or a gone space) with that
  space's synced history, newest first by day, each row marked by where it came from. Only this device's visits can
  be deleted or cleared, and clearing covers every space. So the synced copies of what was cleared don't come back
  as the Mac's, a clear keeps only its time range (`HistoryClearing`) and hides synced rows inside it, and deleting
  one visit the synced history holds keeps an HMAC of its address under a key in the Keychain (`HiddenSyncedVisit`),
  never the address. Both expire with the rest of history (`TabStore.pruneExpired`). Bookmarks is the Mac's tree,
  read-only, with Pin to Mac for the current page. Downloads lists every file with live progress, cancel, try again,
  open (Quick Look), share and delete; the list is in the SwiftData store (`DownloadRecord`), and a download running
  at quit reads as stopped after a relaunch and loses its partial file. Files stay in Documents/Downloads, which the
  Files app shows; private tabs' downloads are listed but never saved, live in a temporary folder and are deleted
  when private browsing ends.
- **Print.** `AppModel.printCurrentPage()` prints the page through the system panel with the web view's print
  formatter; `printReader(_:)` prints Reader's text.
- **Site permissions.** Camera, microphone and location grants for https pages are saved per host and port next to
  the site's zoom (`SiteSettings.permissions`) and listed in Settings, Site Settings, where each can be revoked;
  revoking reloads the open pages that used the grant. Private tabs and plain http pages remember a grant only until
  they close.
- **Blocking.** Ads, trackers and cookie banners: seed rules plus EasyList, EasyPrivacy and the EasyList Cookie List
  converted on device, and a reject-all script for consent platforms; off per site from the page menu.
- **System.** Widgets (search, the Mac's tabs, Lock Screen), Control Center controls, App Intents and Siri phrases,
  a share extension and an Open in Ardia action, Spotlight for open and archived tabs, Handoff of the current page,
  Home Screen quick actions, and http/https link handling. Being the default browser waits on an entitlement Apple
  grants on request (Releasing to TestFlight, below); until a build carries it, onboarding and Settings leave the
  default browser steps out.

## Demo mode and launch arguments

`-ArdiaDemo YES` runs on an in-memory store with `SyncSnapshot.demo` (a MacBook Pro and a Mac Studio, three spaces)
and never touches real data. It seeds local history, six downloads in every state (their files go to a temporary
folder) and three sites with saved permissions. Captures can be driven without touch:
`-BrowseQuery <text>`, `-BrowseSurface browsing`, `-BrowseTab <n>`, `-BrowseToolbar`, `-BrowseReader`,
`-BrowseIncognito`, `-BrowseDelay <s>`, `-ArdiaDeck <script>`, `-ArdiaOnboarding YES`,
`-ArdiaOpenSheet archive|spaces|history|bookmarks|downloads` (the last three open the Library on that section),
`-ArdiaSettingsPage siteSettings` (Site Settings; add `-ArdiaSitePermissions` to open it scrolled to the saved camera,
microphone and location grants),
`-ArdiaPrint page|reader` (the print panel for the current page, or for its Reader text, three seconds after the
delay; pair it with `-BrowseSurface browsing`), `-BrowsePlus` (taps the plus after twice the delay),
`-BrowseOverlay <text>` (the search tray over the page), `-ArdiaRestingStart` (the start screen without the tray),
and `-ArdiaColor <name>` (the colour picked in Settings).
Bar: `-BrowseCollapsed` starts the bottom bar shrunk to its host pill, `-BrowseVerticalBar leading|trailing` draws it
as a rail on that edge (as the Duo's vertical bars ask), `-BrowseFind` opens Find on Page two seconds after the delay,
`-BrowseOpen <url>` opens a page (`http://neverssl.com` shows one that is not secure), and `-ArdiaToast received`
shows a toast (`-ArdiaToastHold` keeps it up).
Spaces: `-ArdiaSpace <syncId>` (demo-personal, demo-work, demo-trips) picks the space, `-ArdiaDeckSearch <text>` fills
the deck search, `-ArdiaSpaceIcons YES` shows space icons instead of dots.
Sidebar: `-ArdiaSidebar shown|hidden`, `-ArdiaSidebarWidth <pt>`, `-ArdiaSidebarHover <n>` (row n drawn hovered after
the delay), `-ArdiaCommandBar <text>` (the command bar over the page after the delay), `-ArdiaSidebarPeek` (the peek overlay after the delay, with
`-ArdiaSidebar hidden`; add `touch` for the pulled-in overlay), `-ArdiaSidebarEdge on|off` (the Show Sidebar at Screen
Edge setting, in Settings, Appearance, on by default and kept on the device), `-ArdiaSidebarScript` (after the
delay, toggles the sidebar four times 1.4 s apart, for filming the page's resize).
Sync: `-ArdiaSettingsPage sync|connect|clearData`, and `-ArdiaSyncOff YES` for the not-connected state.
Look: `-ArdiaInterfaceStyle glass|classic|mac`, `-ArdiaColorScheme system|light|dark|mac`, `-ArdiaSettingsPage appearance`,
`-ArdiaOpenSheet settings`, `-ArdiaOnboardingStep <0 to 4>` with `-ArdiaOnboarding YES`.
Motion captures: `-BrowsePagerFreeze <fraction>` holds a tab swipe part way (negative swipes toward the
previous tab), `-BrowsePagerScript` plays a scripted swipe (cancel, edge, commit, interrupted commit), and
`-BrowseLoadFreeze <progress>` holds a page load with its loading line and placeholder.
Layout captures: `-ArdiaCanvas <width>x<height>` lays the whole app out in a window of that size centred on the screen
(669x951 and 466x678 are the Duo's open and closed displays; use an iPad simulator, since the Duo simulator can't be
folded from the command line), and `ChromeLayout` follows it; `-ArdiaHinge closed|partial|open` supplies the hinge
state. The root logs each layout change (`log stream --predicate 'category == "chrome"'` in the simulator).
`-ArdiaGlassGallery [glass|classic]` shows the glass kit instead of the app; set light or dark with
`simctl ui <udid> appearance`.

## Tests

- `swift test --package-path apps/ios/Packages/ArdiaKit` runs the package's Swift Testing suites on the Mac host: sync
  end to end over a real vault with a fake Mac, the browser layer (tabs, archive, blocking converter, omnibox, reader
  extraction and clearing leftover website data stores in a real WKWebView), the layout rules in `ArdiaDesign`, and
  the JavaScriptCore bridge.
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
  sends an earlier build. Only one build of a version can wait in Beta App Review, so a newer one is refused until
  the older one is through. `-f mode=expire -f build=<number>` ends testing of an older build for good, so nobody
  installs it again; Apple can't undo it and the script refuses the newest build. To invite someone by email instead,
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
