# Ardia for iPhone, iPhone Duo and iPad: redesign

The design record for the iOS redesign: what the app does, and why. `docs/ios.md` covers how it is built, tested and
released.

## Goal

One app for iPhone, iPhone Duo and iPad that looks like it belongs to the Mac app and uses Liquid Glass for its
controls.

- **iPhone.** A bottom bar with a visible address, a glass page menu, tabs that live in spaces, and a start screen and
  search tray on the same glass kit. New: History, Bookmarks, Downloads, Print and saved site permissions.
- **iPad.** A layout that follows the Mac: a sidebar with the space, pinned tiles and tab rows, and the page in a
  rounded card beside it. Keyboard, pointer and drag and drop work.
- **iPhone Duo.** The closed display gets the iPhone layout, the open display gets the iPad layout, and the app moves
  between them live when the device folds.
- **Spaces.** The Mac's spaces come over through sync with their real look, and the phone's tabs live inside them.
- **Mac.** Sync only: it writes the order of its spaces and reads the tablet device kind.

## Decisions

1. **The deployment target stays iOS 27.0, and the Duo API is guarded.** Every 27.1 API (`onHingeChange`,
   `reservedRegions`, `toolbarVerticalEdge`, `ArrangementView`) sits behind `#available(iOS 27.1, *)` in one file,
   `ArdiaDesign/Chrome/DeviceFeatures.swift`. Views call its wrappers and never check availability themselves. The
   27.1 simulator runtime runs only the iPhone Duo, and the iPhone and iPad simulators are 27.0, so a 27.1 floor would
   leave them with nothing to install. CI builds with Xcode 27.1, so the app uses no newer API.
2. **One layout switch, by window size.** `ChromeLayout` is in the environment and comes from the window's size,
   never from the device model:
   - `bar`: under 640 pt wide or under 500 pt tall. An iPhone (also on its side), the Duo closed, a narrow iPad window.
   - `sidebarOverlay`: 640 to 819 pt wide. The Duo open (669 pt). The page is full width and the sidebar slides over it.
   - `sidebarDocked`: 820 pt and up. The sidebar sits beside the page.

   A fold or a resize changes the value live, and the selected tab stays selected.
3. **Glass is for controls, not for content.** Bars, buttons, fields, tiles, toasts and menus are glass. In glass
   style the iPad's New Tab row and space switcher are glass too. Tab rows, list rows and the page card are flat.
4. **The Mac's values are the source.** Radii, spacing, type sizes, colour roles, shadows and springs are generated
   from the Mac's token files. iOS keeps no copies.
5. **The phone stays read-only on the Mac's data.** It writes only `dev:`, `tabs:`, `h:` and `send:` records, and a
   `bm:` bookmark when you Pin to Mac. Spaces, themes, pins and settings are read.
   `packages/sync/src/companion/companion.test.ts` holds it to that.
6. **One window per device.** iPadOS resizes the window whatever the app says, so every layout reflows. The app has
   one `AppModel` and one `SidebarState` per process, so several windows is left out (see Not in this round).
7. **No AI features**, as everywhere in Ardia. Translate hands the page to Google's translator after a confirmation.
8. **Icons or words.** A control in a bar, tile or pill is an icon with an accessibility label and a tooltip. An item
   in a list or menu is words. A picture stays beside words only where it is identity: a favicon, a space's badge, a
   device. Toasts keep their icons, as the Mac's do.

## Design system (`ArdiaDesign`)

### Tokens from the Mac

`apps/ios/scripts/bundle-tokens.mjs` reads the Mac's `components/ui/tokens.ts`, `components/ui/motion.ts` and
`components/window/tokens.ts` and writes `ArdiaDesign/Tokens.generated.swift`. The file is checked in, and `--check`
fails when it is out of date. The check and the generator's tests run in iOS CI only, whenever one of those Mac files
changes. The browser's test script does not run them, so a Mac token change never waits on the iPhone.

It carries the Mac's radii, spacing, type sizes and weights, text colours, springs (including the sidebar's dock and
peek springs), colour roles and shadows. Type goes through Dynamic Type: each `Typography` role is tied to a Mac size
and a system text style, and is at most 1.25 times the Mac size.

**Touch scale.** Sidebar and row metrics are about the Mac's times 1.25 (`SidebarMetrics.touchScale`), in whole
points, so a finger can hit them:

| Part | Mac | iOS and iPadOS |
|---|---|---|
| Sidebar width | 190 default, 160 to 400 | 260 default, 220 to 400 |
| Side inset and page card inset | 9 | 10 |
| Header | 46 | 56 |
| Pinned tile | 41 tall, gap 6, radius 10, min width 50, at most 4 columns | 52 tall, gap 8, radius 12, min width 62, at most 4 columns |
| Tab row | 34 tall, gap 3, radius 10, icon 16, title 13 | 42 tall, gap 4, radius 12, icon 20, title 15 |
| Section label | 11 semibold | 13 semibold |
| Footer (space switcher) | 41 | 52 |

Row states use the Mac's fills: hover white .16 dark and .55 light, pressed .31 and .70, selected
`rgba(18,18,18,.5)` dark and white .7 light with a 0.5 pt border. The selected row's glow follows `selectedTabGlow`.

### Glass kit

One set of components that every surface uses, so no view calls `glassEffect` with its own numbers:

- `GlassBar`: a `GlassEffectContainer` that holds a bar's pieces so they merge and split as one.
- `glassControl` (circle, capsule, pill, tile, row) with a state of rest, lit, pressed or active.
- `glassPanel` (rounded, capsule, concentric) for menus, the search tray, the command bar and toasts. `glassBand` is
  the glass behind the space switcher.
- `.glassAction` and `.glassPrimaryAction` for buttons: the system's `.glass`, and `.glassProminent` with
  `Palette.primaryAction` for the one main action on a screen. Classic style falls back to bordered buttons.
- Tint follows the Mac's `controlGlassTint` and `panelGlassTint` (`components/ui/Glass.tsx`): a control's fill steps
  by 1, 2, 3 and 6 for rest, lit, pressed and active, and the space's colour is mixed in by a tint amount.
  `GlassTintFixtureTests` hold the maths to `ArdiaKit/Fixtures/glass-tints.json`. With sync on, the amount is 0 unless
  the Mac sent `glassTintWithTheme` true, then the Mac's `glassTintAmount` (0.8 when it sent none). With sync off it is
  0.15.
- Moves between states use `glassEffectID` with a matched geometry transition, so the bottom bar and the deck's bar
  morph into each other.
- Controls that float over web content set `glassPlacement` to `.overContent`, so their classic fills are opaque.
- **Interface style.** Glass, Classic or Match My Mac (the default, from the Mac's `interfaceStyle` setting). Classic
  draws the same shapes with flat fills. Reduce Transparency forces Classic.

### Backdrop

`ProfileBackdrop` draws a space's theme the way the Mac does: the stops at their positions, the angle, intensity and
translucency, the texture (grain, sand, denim, tweed) and the theme's own light or dark. Without a theme it draws the
Mac's window tint for the space's colour. Everything asks `ProfileLook`, and the widgets build theirs the same way
from the whole theme in their snapshot. `ProfileLookTests` hold the maths to
`apps/browser/src/state/sync/fixtures/theme-backdrops.json`.

## iPhone (`ChromeLayout.bar`)

### Bottom bar

Three glass pieces floating above the page in one `GlassBar`, at most 560 pt wide and 12 pt in from the sides (more
where a camera or a corner needs it):

```
 ( tabs )   (  lock  wikipedia.org            ...  )   ( + )
```

- **Tabs** (circle): the tab stack glyph. Tap opens the deck. Touch and hold lists recent tabs and Close Tab.
- **Address** (capsule): the site's favicon or a lock, then the host. Tap opens search with the full address
  selected. Swipe sideways to switch tabs. Touch and hold: Copy Link, Paste and Go, Share. The dots at the end open the
  page menu.
- **Plus** (circle): new search. Touch and hold: New Incognito Tab (New Tab from an Incognito tab) and Reopen Closed
  Tab.
- The page runs under the bar. WebKit is told the bar's height, so a site's fixed footer lays out above it. The bar
  takes its look from the colour at the bottom of the page.
- With Collapse Bottom Bar on (the default for new installs), and always in landscape, scrolling down shrinks the bar
  to a small host capsule in the middle. Scrolling up, reaching the top or tapping it brings the bar back. The pieces
  morph, they do not fade.
- Incognito: the address carries the eyeglasses. A page that is not secure shows the words Not Secure and no icon.
- In landscape the page stays inside the side safe areas, clear of the camera and the corners.

### Page menu

A sheet on iPhone and a popover on iPad, on the system's own background. A glass bar on top holds Back, Forward, the
title (tap to edit the search), Pin to Mac and Reload (Stop while loading). Then Reader, Copy Link and Share as tiles;
Find on Page, Send to a device, Print; History, Bookmarks, Downloads; Night Shade, Page Zoom, Desktop Site (bar layout
only), Translate, Block Ads and Trackers, Site Settings. At accessibility text sizes the tiles become rows.

### Tabs and spaces

- The deck keeps its cards and flick to close. A one-line Archive banner sits above it until answered.
- The deck's bar is built from the same pieces as the bottom bar: the leading button, a field that filters open tabs
  by title and address, and the plus button. The deck is a strip in portrait and a grid in landscape or wide windows.
- **Spaces are real.** The deck, the archive and the selected tab belong to the current space. Swiping the deck's
  header, or the space dots on the start screen, moves between spaces. A tab made in a space stays in it, and Move to
  Space is in a tab's menu. Tabs with no space, or whose space is gone, show under the default space, the rule the
  sync cycle uses when it publishes them (`SpaceRoster`).
- The Mac's pinned tiles, rows and groups for the space, and its open tabs, sit behind the deck's leading button.

### Start and search

- The resting start screen shows the space's icon and name, its pinned tiles in the Mac's grid, and the space dots at
  the bottom. An Incognito tab, or a phone with no synced space, shows the logo.
- The search tray is a `glassPanel`. "Keyboard up" comes from the keyboard layout guide, so a hardware or floating
  keyboard works.

### Settings, onboarding, toasts

- Settings uses the system's navigation bar with a soft scroll edge at the top, and opens as a page sheet with a 640
  pt readable column. An Appearance page gathers Color, Interface Style, Light or Dark (System, Light, Dark, Match My
  Mac) and, where a hidden sidebar can peek, Show Sidebar at Screen Edge. Match My Mac shows only with sync on.
- Onboarding lays out from the window size: stacked, one column or side by side (`PageComposition`).
- Toasts are glass capsules.

## iPad and the open Duo (`sidebarDocked`, `sidebarOverlay`)

```
+------------+------------------------------------+
| Personal v |                                    |
| [ address ]|                                    |
| [][][][]   |                                    |
| [][][][]   |             web page               |
| Today      |           (rounded card)           |
| > Tab A    |                                    |
|   Tab B    |                                    |
| + New Tab  |                                    |
|   . o .    |                                    |
+------------+------------------------------------+
```

- **Backdrop.** The space's window tint fills the window, and the sidebar's content sits straight on it, as on the
  Mac.
- **Sidebar, top to bottom.** Header: the space (a menu when there is more than one), a menu for History, Bookmarks,
  Downloads, Archive and Settings, and the sidebar toggle. Then the address field (glass, shows the host, opens the
  command bar), the pinned tiles in one glass group, a Today label with the tab rows, the New Tab row, and the space
  switcher in the footer. Incognito tabs sit under their own label. The sidebar sits on the side the Mac's
  `sidebarSide` setting names. Dragging its edge resizes it, a double tap resets it, and the width is remembered.
- **Page card.** Inset 10 on every side, corners concentric with the window's, the Mac's card fill behind a loading
  page. Back, Forward and Reload (Stop while loading) sit on one side, Share and the page menu on the other. They are
  glass controls that float over the card's top edge and stay in place while the page scrolls under them. With the
  sidebar hidden, the sidebar toggle joins them on the sidebar's side, before Back when the sidebar is on the left.
- **Resizing the card.** WebKit has no public live resize. When the card's width changes, a snapshot of the page
  follows the card's edge on every frame and cross-fades to the live page once WebKit has laid out at the new width.
  The snapshot scales with the card on a page WebKit shrinks to fit, and stays 1:1 on a page that reflows.
- **Hidden sidebar.** The toggle or Command-S hides it with the Mac's dock spring (.215/.79). The page takes the full
  window and a small glass capsule with the host stays at the top. In `sidebarOverlay` hidden is the resting state, and
  the sidebar slides over the page from its edge.
- **Peek.** A hidden sidebar peeks from the window edge, as on the Mac. The pointer on the edge strip floats it over
  the page with no scrim, and it leaves 120 ms after the pointer is outside it. A finger swipe that starts in the strip
  pulls it in over a scrim. The page never resizes while it peeks. The toggle or Command-S pins a pointer peek and
  closes a touch one. Settings, Appearance, Show Sidebar at Screen Edge turns the peek off. Where the back swipe only
  works from the screen edge, it starts just inside the page on the sidebar's side, since the strip belongs to the
  sidebar.
- **Command bar.** Command-T, Command-L and the address field open search as a glass panel. Its top sits a sixth of the
  window's height down and it is at most 600 pt wide. It shows the phone tray's suggestions, at most eight rows.
  Escape closes it.
- **No deck.** The sidebar is the tab list. A row shows the icon, the title fading at the trailing edge, and a close
  button on hover and on the selected row. The sidebar and the phone's deck show one order: new tabs at the end and
  links after their opener, as on the Mac.
- **Keyboard and menu bar.** `BrowserCommand` holds the Mac's shortcuts for the commands the app has, and
  `BrowserCommandTests` check them against `packages/shell/ios/CommandTable.swift`. They are scene `commands`, so they
  also fill the iPad menu bar.
- **Pointer, drag and drop.** Hover states on rows, tiles and glass controls, and context menus on tabs and tiles.
  Drag a row to reorder it. Drop a link or text on the sidebar to open it in a new tab, or between rows to open it
  there. Drag a tab out as a link.
- **Websites.** Sidebar layouts ask for desktop sites and the bar layout keeps mobile sites (`SiteVersion`). A fold or
  resize that crosses the line applies to each page from its next load. Nothing reloads by itself, because a reload
  could resend a form or drop what someone typed. A tab's own Desktop Site choice wins over the layout.
- **Sheets.** Settings, Archive and the Library open as page sheets.
- **Sync.** An iPad writes `k: "tablet"`, so the Mac lists it as an iPad. The format is in `docs/sync.md`.

## iPhone Duo

- Closed display: 466 x 678 pt, compact width. Open display: 669 x 951 pt. By decision 2, closed is `bar` and open is
  `sidebarOverlay`. Nothing in the app asks whether the device is a Duo: the layout reads the window's size and the
  hinge state, and a fold changes those two values.
- Chrome reads `safeAreaInsets` per side and the system's reserved occlusion areas. The bottom bar, the deck's bar and
  the search tray give both sides the larger inset, so they keep clear of the camera and sensor edge. The window's
  real corner radii (`concentricCornerRadii`) set the bottom bar's clearance and the page card's corners.
- When the system asks for a vertical bar (`toolbarVerticalEdge`), the bottom bar becomes a rail on that edge.
- Half open (hinge status `.partiallyOpen`): the page card takes the half above the fold and the tab list the half
  below, through `ArrangementView` with the `.split` style. The sidebar toggle is off in this state.
- The app does not set `UIRequiresFullScreen`.

## Spaces and looks over sync

The phone reads these from records the Mac already writes. Its replica holds them.

1. **Icons.** The Mac sends an emoji or `symbol:<SF name>`. The phone draws the symbol, draws an emoji as text, and
   falls back to the first letter as the Mac does.
2. **Colour stops with transparency.** Eight-digit hex is accepted.
3. **The whole theme.** Mode, intensity, grain amount, texture, translucency, stop positions and both angles
   (`pth:<id>` and `pth:<id>:angle`) are in the companion's view (`packages/sync/src/companion/view.ts` and
   `looks.ts`) and in `SyncedTheme`. The new fields are optional, so an older cached snapshot still decodes.
4. **Global look settings.** `appearance`, `interfaceStyle`, `glassTintWithTheme`, `glassTintAmount`,
   `selectedTabGlow`, `pageFrame`, `sidebarSide` and `profileSwitcherIcons` arrive as `lookSettings`, once the Mac has
   synced its Settings. `appearance` and `interfaceStyle` feed a Match My Mac default, and a choice on the device wins.
   The glass tint, `selectedTabGlow`, `sidebarSide` and `profileSwitcherIcons` follow the Mac with no choice of their
   own. `pageFrame` is read but not used: the page card keeps its own inset.
5. **Space order.** The Mac writes the order of its spaces as `o` on its own `dev:` record. The phone uses the `o` of
   the record with the newest sync timestamp that has one (the lower device id on a tie). The rest follow, default
   space first and then by name, which is also the order without any `o`. The phone never writes it.

## Added on every device

- **Library.** One sheet with History, Bookmarks and Downloads, opened from the page menu and, on iPad, the sidebar's
  menu. History merges this device's visits in the current space with that space's synced history. Only this device's
  visits can be deleted or cleared, and a clear hides synced rows in its time range so the Mac's copies don't come
  back. Bookmarks is the Mac's tree, read-only, with Pin to Mac for the current page. Downloads lists every file with
  progress, cancel, try again, open, share and delete. Private tabs' downloads are never kept.
- **Print.** The system print panel with the web view's print formatter. Reader prints its own text.
- **Site permissions.** Camera, microphone and location grants for https pages are saved per site and listed in
  Settings, Site Settings, where each can be revoked. Private tabs and plain http pages remember a grant only until
  they close.
- **Reopen closed tab.** From the plus button's menu and with Command-Shift-T.

## Mac

The Mac's changes in this work are sync only:

- It writes the order of its spaces as `o` on its own `dev:` record, and republishes the record only when it changes.
- It reads the tablet device kind. An iPad is listed with an iPad label and symbol, follows the 30-day rule phones
  follow, and is offered sent tabs.
- Connect Another Device names the iPad as well as the iPhone, and Copy Words says whether the copy worked.

`tokens.ts` and `motion.ts` are the source the iOS tokens are generated from. No value on the Mac changes. The wire
format is in `docs/sync.md`.

## Not in this round

- **Several windows on iPad.** `AppModel` is one per process and holds the surface, the sheet, the selected tab, the
  tray, the deck and the toasts. Splitting it per window is its own piece of work.
- **Tab groups and local pinned tabs on iOS.** The Mac's are shown, read-only.
- **Writing spaces, themes or pins back to the Mac.**
- **Website data per space.** Every regular tab uses one store, and private tabs use their own in-memory store.
  Following the Mac's default space would swap logins between spaces when the default changes there. Tabs that
  already carry a space would be signed out on the first sync after an update. Spaces that share data on the Mac would
  get separate stores, because the synced view carries no data owner.
- **On-device translation, a password manager, background audio for picture in picture.**
- **Telemetry.** The iOS app has none, and this work adds none. Use counts for the new layouts would be a separate
  change inside the consent model.

## How it was checked

- **Automated.** The ArdiaKit Swift tests (layout rules, look and glass fixtures, sidebar visibility, peek, resize, the
  shortcut table, sync end to end), the `packages/sync` tests, the bundle checks, and the Mac's `devices.test.mjs` and
  `themeBackdrops.test.mjs`. iOS CI (`.github/workflows/ios.yml`) builds the `Ardia` scheme for the simulator with
  Xcode 27.1 and runs the package tests and both bundle checks.
- **Fixtures written by the Mac.** `glass-tints.json` comes from `apps/ios/scripts/glass-tint-fixture.mjs` and
  `theme-backdrops.json` from `apps/browser/scripts/theme-backdrops.mjs`, each from the Mac's own functions.
- **Layouts in the simulator.** The command line cannot fold a Duo simulator, so demo mode takes arguments that set
  the window and the hinge, and an iPad simulator stands in. The full list is in `docs/ios.md`.

| Argument | What it does |
|---|---|
| `-ArdiaCanvas <width>x<height>` | Lays the app out in a window of that size, centred on the screen. `669x951` and `466x678` are the Duo's open and closed displays. |
| `-ArdiaHinge closed, partial or open` | Supplies the hinge state. |
| `-ArdiaSidebar shown or hidden` | Starts the sidebar shown or hidden. |

Left for a person: folding the Duo simulator with the on-screen buttons in Xcode's device window, a real iPad with a
keyboard and trackpad, and sync against a real Mac and iCloud Drive.
