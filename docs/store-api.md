# App store API (apps/browser/src/state)

The workspace store is `useBrowser` (state/browser/store.ts). Actions take explicit ids. Read the
modules before using them: this is a summary. Smaller stores (pages, media, sidebar UI, onboarding, …) live in their
`state/<domain>/` and follow the one store shape in docs/conventions.md › State: data only, written by the functions
exported next to them. `useBrowser` is the exception whose actions are methods; components never call them on the
store but through `storeAction` wrappers in each domain's `actions.ts` (`newTab` in state/tabs/actions.ts,
`updateSettings` in state/settings/actions.ts, …). Tests (`S().newTab(…)`) and CDP scripts
(`ac.store.getState().newTab(…)`) call the methods directly.

## State
- `profiles` + `profileOrder`; default profile id is `"default"`.
- `windows`: `{ profileId, incognito, tabIds (sidebar order, pinned first), activeTabIds[profileId], sidebarOpen, frame }` + `windowOrder`.
  A private window's `profileId` is `incognito:<window id>@<originalProfileId>` (`incognitoProfileId`, state/browser/model.ts),
  `originalProfileId` the regular profile it was opened from (`createWindow({ incognito: true, profileId })`, default
  `lastActiveProfile`). Its engine profile (`engineProfile`) is that profile's off-the-record one: private windows of one
  profile share a session (`privateSession(profileId)`, the regular engine name), another profile's never. Downloads
  carry `offTheRecord` and their regular profile (`downloadSession`, state/windows/ui.ts); a session's go with its last window.
- `tabs` (persisted) vs `live` (loading/progress/back-forward/audio/theme colour; never persisted).
- `groups`: `{ windowId, profileId, name, icon, color, collapsed, pinned, tabIds }` (members contiguous). `color` is
  `null` for Neutral, `"none"` for a transparent group, or one of Chrome's nine group colours.
- `splits` (state/splits/splits.ts): `{ windowId, tabIds (2–3, pane order), orientation, sizes, stack? }` — `stack` = two panes sharing a slot the other way (Add Bottom Split). Members are contiguous in `window.tabIds`; the window's active tab is the focused pane. A split is one sidebar row (`splitRowPanes`): its panes are all unpinned, or all pinned rows; `placing`, `withGroup`, `createGroup`, `addTabsToGroup` and `removeTabsFromGroup` take every pane of a row they're given one of (`withSplitRows`), pinned panes are always rows, and a pinned split is mirrored to the profile's windows (pinMirror) and parked with them (`ParkedPins.splits`). `window.tabLayout` ("sidebar" | "top", unset = Settings).
- `history[profileId]`: a view of Chrome's history (HistoryService), one entry per URL, not saved; `historyReady[profileId]`
  once it has been read (state/history/engineSync.ts). `bookmarks`: `{ nodes, roots[profileId]: { bar, other } }`.
- `closedTabs` / `closedWindows` (full state; a closed window's entry leaves out its pinned tabs and pinned groups);
  `downloads`; `settings` (typed, state/settings/settings.ts).
- `parkedPins[profileId]` (state/pins/parkedPins.ts): pinned tabs belong to the profile's sidebar, as in Dia. Closing a
  window (⌘W on its last tab, the close button, ⇧⌘W, "Start fresh" on launch) parks its pinned tiles (at their pinned
  URL) and pinned groups, with their order and tab/group ids; the next window that shows the profile takes them back,
  unloaded (`createWindow` — ⌘N, the Dock, a link from another app, the first window after a relaunch —,
  `switchProfile`, Reopen Closed Window, ⇧⌘T of a tile's page), and the park empties, so nothing comes back twice.
  Only the last window of a profile parks: while another window shows the profile, the pins are there.
  Sync publishes parked pins as the profile's pins and applies changes to them in place (state/sync/adapters `pinnedAdapter`).
- Pins are per profile in every window (state/pins/pinMirror.ts): each regular window showing a profile holds its own copy
  (a Tab, a TabGroup) of every pinned tile and pinned group, linked by `pinKey` (unset on the first copy, whose id is
  the key; `pinKeyOf`). A store listener (`mirrorPins`) carries a change of one window's pinned section to the others
  (the focused changed window wins) and gives a window that starts showing a profile its pins (the union, for windows
  that differ at launch). Copies it makes are unloaded; a copy it drops goes if it never loaded, else stays as a regular
  tab. Moving a pinned tab between windows (`moveTabsInto`, an extension's move) leaves a copy behind
  (`settleMovedPins`). Sync keys pins by `pinKey` and changes the home window's copy.
- Tile folders (state/pins/tileFolders.ts): a pinned tile's `tileFolder` (`{ id, name }`) puts it in a folder tile in Top Apps; a
  folder is the tiles of a window that share an id, kept next to each other in the window's order. `addToTileFolder`,
  `newTileFolder`, `leaveTileFolder`, `renameTileFolder` and `dissolveTileFolder` are pure (state in, state out);
  `placeTabs({ tileFolder })` sets it, `null` takes a tab out, and leaving it out keeps it. A tab that stops being a tile
  loses it, and a folder that drops to one tab dissolves (`settleTileFolders`, run with the pin mirror). It never reaches
  Chrome: members are plain pinned tabs there. Mirrored, parked and synced with the pins (`tilefold:` records).
- UI: `ui.focusedWindowId`, `ui.focusOrder`, `ui.lastProfileId` (the regular profile of the window used last, a private
  window counting as its `originalProfileId`; saved with the session; read it through `lastActiveProfile(s)`, state/windows/small.ts),
  `ui.appDark`, `windowUi[windowId]` (command panel, downloads popover), `find[tabId]`.

## Actions
- Windows: `createWindow`, `closeWindow`, `switchProfile`, `moveTabsToWindow`, `moveTabToProfile`,
  `mergeAllWindows`, `reopenClosed` / `reopenClosedTab` / `reopenClosedWindow`, `restoreClosed`.
  Little Ardia (Little Arc): `createWindow({ small: true, url })` makes a `kind: "small"` window with one tab (state/windows/small.ts),
  in `lastActiveProfile(s)` unless `profileId` says otherwise; never private.
  `newTab` into it goes to `mainWindowFor(s, profileId)`; `resolveWindowId(s, null)` never picks it; closing it records a
  `ClosedTab` with `small: true` that reopens in a new Little Ardia; it isn't saved with the session.
- Tabs: `newTab(windowId, { url, background, adoptId, openerId, profileId, pinned, index })`, `closeTabs(ids, { lastClosesWindow })`
  and `closeTab(id)` (the same path with `lastClosesWindow`, for ⌘W and ✕), `activate`, `navigate`, `updateTab(id, patch, live?)` (the live patch lands in the same store update), `updateLive`,
  `togglePin`, `moveTab`, `moveTabBy(id, ±1)` (both within the tab's pin section), `duplicateTab`. The engine's page reports go through `navigated(id, { url, title }, live)` and
  `faviconChanged(id, favicon)`. Chrome records the visit (HistoryService) and keeps the icon (FaviconService) itself.
  Closing a pinned tab only unloads it (`unloadPinnedTabs`, like Dia): the tile stays with `unloaded: true`, back at its
  pinned URL and without a web view until selected; the window selects its last-used regular tab, else the loaded
  pinned tab it showed last, else a New Tab page, and ⇧⌘T restores the page into the tile. Closing the last tab closes
  the window, unloaded pinned tiles aside (`closesWindow`), so holding ⌘W ends there instead of waking them. Unpin
  removes a pinned tab. A tab of a pinned group (Dia's pinned container, `inPinnedContainer`) unloads the same way, on
  the page it showed, and stays in its group. Both close calls run one rule set (`closingTabs`): a Peek tab ends the Peek,
  pinned tabs unload, and a window whose shown tabs all go gets a New Tab, or closes when `lastClosesWindow` is set
  and the New Tab bar policy doesn't keep it (`leavesEmptyWindow`). `closeIntent(s, tabId)` says what ✕ does
  (close, unload with the pages it shares, or remove a closed pinned row); the last-tab confirmation stays in
  state/browser/actions.ts.
  `duplicateTab` and Reopen Closed Tab set `adoptId` to `clone:<tab id>` / `restore:<tab id>` (`ClosedTab.tabId`):
  the engine copies or restores that tab's back/forward list, else the tab loads its URL.
- Groups: `createGroup`, `addTabsToGroup`, …
- Splits: `createSplit`, `openSplitPane(windowId, { tabId | url, anchorTabId, side, background })`, `replaceSplitPane`, `removeTabFromSplit`, `separateSplit`, `flipSplit`, `toggleSplitOrientation`, `movePane`, `focusPane`, `updateSplit`; `toggleTabLayout`. UI entry points with Dia's feedback (max-panes toast, menus): state/splits/actions.ts (`openSplitPane`, `openNewTabInSplit`, `openInSplit`, `openLinkInSplit`, `showSplitMenu`). Drag a tab onto the page to split: state/drag/tabDrag.ts.
- Sidebar organisation (state/pins/organize.ts): `selection[windowId]` with its ⇧-click anchor `selectionAnchors[windowId]`, both set by
  `clickTab(windowId, tabId, mods)` (plain, ⌘ and ⇧ clicks, ⌥⇧ into the shown tab's group), `placeTabs(ids, { pinned, row, beforeId, groupId, last })`
  (`last` puts a row with no `beforeId` after the pinned groups too). Drag and drop in the sidebar and the top strip
  goes through state/drag/drops.ts: a view turns the pointer into a `DropSpot` (zone plus the tab it lands before),
  `resolveDrop(s, source, spot)` gives the `Drop` (or refuses it), `dropTabs(ids, drop)` applies it, `movingTabIds` is
  the set that moves together, and `slotDrop` turns a strip slot index into an anchor. `pinTabs(ids, pinned, row?)` (a pinned tab is a Top Apps tile, or a pinned row above the tabs when
  `tab.pinnedAsRow`; windows order tiles, then pinned rows and pinned groups in one interleaved order, then the rest; `row` omitted keeps a pinned
  tab's kind and pins a new one as a tile). A live folder sits in that pinned order by `LiveFolder.after`, the anchor key
  (`t:` or `g:` plus the pin key) of the row or group just above it, or `null` for the top (components/sidebar/pinnedOrder.ts);
  when its anchor goes it moves under the item that was above the anchor. Also pinned base URLs (`tab.pinnedUrl`, `returnToPinnedUrl` ⌘↩, `setPinnedUrl`; set on tiles, pinned rows and tabs in pinned groups alike, and cleared when a tab leaves every pinned place, by the `settlePinHomes` listener in state/pins/pinHomes.ts), `setSiteMuted` (Mute Site,
  `settings.mutedSites`; a private window's mutes stay in `privateSiteMutes[windowId]`, in memory), `groupTabs` (pinned by default, like Dia), `moveGroup`, `duplicateGroup`, `newTabInGroup`,
  `closeGroup` → `closedGroups` (History › Recently Closed Groups; `restoreClosed` takes their ids), `moveGroupToBookmarksBar`,
  `cleanUpTabs` → `cleanedTabs` / `restoreCleaned(entryId?, windowId?)` (a private window's go to `privateCleanedTabs[windowId]`,
  in memory, and only back into that window; read either with `cleanedTabsFor(s, windowId)`), `closeAbandonedNewTabs`. `newTab` with `openerId` + `background` (⌘-click)
  joins the opener's group (`settings.cmdClickCreatesTabGroup`). Sidebar UI lives in components/sidebar/.
- Profiles: `createProfile` (`shareWith`: share another profile's data), `updateProfile`, `deleteProfile`, `reorderProfiles`, `setDefaultProfile`.
  `deleteProfile` queues engine data no profile uses any more in `orphanedProfileData` (saved); state/profiles/profileData.ts deletes it
  (`deleteProfileData`, which erases the original profile's data through Chrome's own stores) and retries at launch until it's gone.
  Shared data: `profile.dataId` names the data a profile uses; `engineProfile(id)` resolves it, bookmark roots are the same
  folders, and state/profiles/profiles keeps history lists identical (`dataGroups`, `sharingProfiles`). The Create Profile dialog is
  components/profiles/CreateProfile.tsx (`lib/actions.createProfile`).
- Bookmarks: `addBookmark`, `addBookmarkFolder`, `moveBookmark`, `removeBookmark`, `toggleBookmark`,
  `addBookmarkTree` (imports, Bookmark All Tabs), `removeBookmarks` → `restoreBookmarks` (bulk delete + undo).
  They're Chrome's (BookmarkModel, so `chrome.bookmarks` sees them): state/bookmarks/engineSync.ts reads each engine profile's tree,
  sends each store change to Chrome as ops (`bookmarkOps`), takes back what extensions change, and moved the old
  `bookmarks.json` in once. Node ids are Chrome UUIDs (`newBookmarkId`); an engine profile's roots are
  `bar@<engine>` / `other@<engine>` (`rootIdsFor`); `bookmarksReady[profileId]` once read; `syncKey` (state/sync/adapters.ts).
  Until Chrome's tree is read at launch the store shows the last one read (`bookmarks-cache.json`), which is display
  only: it's never sent to Chrome, and edits made meanwhile are replayed on Chrome's tree.
- History (Chrome's; state/history/engineSync.ts reads it and follows its `history.changed` events, and moved the old `history.json`
  into it once): `removeHistory` (deletes from Chrome too), `clearHistory(profileId, since?)` (the view; Clear Browsing
  Data deletes from Chrome), `importHistory` (Chrome's importer path). Favicons are Chrome's too: state/favicons/favicons.ts is
  an in-memory cache by page, plus the icons live tabs show and the light/dark pick. Settings: `updateSettings`
  (`bookmarksBar`, `shortcuts` = remapped menu keys read by MainMenu+Shortcuts.swift, …).

## Hooks (state/browser/hooks.ts and state/<domain>/hooks.ts)
`useWindowId`, `useActiveTab(Id)`, `useTab(id, select?)`, `useTabLive(id, select?)`, `useWindow(id, select)`,
`useProfile(id, select)`, `useGroup(id, select)`, `useWindowProfile`, `useProfiles`, `useSettings(select)`,
`useFind(tabId)`, `useWindowUi`, `useIsBookmarked(url)`, plus named hooks per domain (state/sidebar/hooks.ts,
state/bookmarks/hooks.ts, state/windows/card.ts for ContentCard, …). Components never call `useBrowser(…)`.
Subscribe rows by id with narrow selectors so progress events don't re-render every tab.

## Helpers and side effects
- Pure: state/browser/model.ts — `viewTabIds`, `activeTabId`, `engineProfile` (the WebView `profile` prop), `windowTitle`.
- Dialogs / native side effects go through state/browser/actions.ts (`closeTab`, `switchToTab`, `moveTabToProfile`,
  `moveTabToWindow`, `createProfile`, `deleteProfile`, `openWindow`). `createProfile` puts a request in
  state/profiles/createProfileRequest.ts that components/profiles/CreateProfile.tsx renders.
- Event handlers read the current state through state/browser/current.ts (`currentSettings`, `currentTab(id)`, …) or
  a domain's reader, never `getState()` in a component.
- Profile colours that state needs (menu swatches, the launch backdrop) come from a resolver App.tsx provides
  (state/profiles/looks.ts), so state never imports components/ui.
- Menu commands: state/commands/commands.ts (JS) + packages/shell/ios/MainMenu.swift (native menu bar).
- Tests: `pnpm --filter @ardia/browser test` (`docs/testing.md`).

## Native events (platform/nativeEvents.ts)
Every native→JS call is its own task, and React Native commits after each, so a page's reports used to cost a commit
apiece (about ten per new tab). A WebView's page reports (`HELD_EVENTS`: navigation, progress, favicon, media, now
playing, status, security, blocked count, media access, load error) are held until the calls already queued behind
them have run (a 0 ms timer), then applied in arrival order in one React batch. Anything else that reaches JS first
applies them before it runs: any other event (touches, layout, a page opening a window, focus, activation, commands,
find, zoom, a new page's ready report), a timer, a callback, and every native module listener (Expo's EventEmitter, so
a tab strip transaction or a download), which also runs as one commit with them. Nothing is reordered or dropped, and
nothing a user action waits on is held. Work JSI delivers without a listener (an Expo promise settling) can run before
held reports, as it already could before a view event's own dispatch hop: code that decides from a page's live state
after awaiting the engine calls `applyHeldReports()` first (tabLifecycle's sleep and freeze, closeTab). A flush
also runs as one store transaction (`storeTransaction`, state/browser/transaction.ts): its writes apply at once, and the store's
listeners and subscriptions hear them together at the end, except a write that changes a tab's address or starts or
ends its load, which is heard as it lands (a value that flips back within the flush stays visible to the listeners
that act on it: translate's detection, the web store's script, a screen-share request going with its page).

## Live tabs: Chrome's tab strips (state/tabs/chromeTabs.ts, state/tabs/liveTabs.ts, packages/ardiacore/src/tabStrip.ts)

One writer per fact. The store owns the **workspace**: sidebar order, pins, groups, splits, Little Ardia, unloaded
and parked tiles, and which tab each window shows per profile (`activeTabIds`). Chrome's `TabStripModel` owns
the **live tabs**: which tabs each Chrome window ("strip": one per engine profile per app window) has, their order,
the active one, pins (and groups, once the engine reports them). JS never writes a live fact and never guesses who
caused a report: it sends commands with ids, the engine commits them in Chrome, and every change comes back as one
ordered transaction that names its cause. There are no echo windows, timers or "was that us" flags.

**The engine contract** (`@ardia/ardiacore`; ArdiaCore implements it in `packages/ardiacore/ios/ArdiaTabStrip.mm`):
- `sendTabStripCommand(command): number` sends a command and returns its id (unique for the app's lifetime, also
  across JS reloads). Commands:
  - `{ op: "activate", strip, key }`: make that tab the strip's active tab.
  - `{ op: "arrange", strip, keys, pinned }`: the listed tabs in this order at the start of the strip, the first
    `pinned` of them pinned and the rest not. Keys not in that strip (any more) are skipped; the strip's other tabs
    follow the listed ones.
  - `{ op: "group", strip, keys, group, title?, color?, collapsed? }`: the listed unpinned tabs into one of the
    strip's groups (its id), `"new"` for a new one, `null` out of theirs; the group's title, color and collapsed
    state when given.
- `onTabStripTransaction(listener)` delivers `{ rev, cmd, strips, rejected? }`:
  - `rev` is one more than the previous transaction's, for the engine's lifetime, in the order the changes were
    committed. A listener applies them in that order and drops any `rev` it has already passed.
  - `cmd` is the cause: the id of the command (each command yields exactly one transaction, also when nothing
    changed, with `rejected: true` when none of its tabs were in its strip); `-1` for the app's own engine calls
    that aren't commands (a WebView creating, restoring or duplicating its tab, a tab moving to another app
    window, a page command or DevTools activating its tab); `null` for what Chrome did on its own (an extension's
    `chrome.tabs`/`tabGroups` call, the tab Chrome shows after the active one leaves, a focus request selecting a
    tab, a strip's placeholder tab going).
  - A transaction never mixes causes. Chrome's pending changes go out before a command runs; whatever Chrome does
    synchronously inside a command (selection, observers) is the command's.
  - A change that isn't a command's and leaves its strip as it was last sent isn't sent (a new tab's insertion and
    placing made two identical transactions).
  - `strips` holds every strip the change touched, each whole: `{ strip, window, appWindow?, profile, tabs,
    groups?, activePickedOnClose?, closed? }` (`window` is shared by the strips of one app window, one per engine
    profile it shows; `appWindow` is the app's id for that window, its React root's `windowId`;
    `activePickedOnClose` says the active tab is the one Chrome picked because the active tab left the strip, not
    one anybody activated), `tabs` in strip
    order as `{ key, browser, index, active, pinned, group? }`, and `groups?: [{ id, title, color, collapsed }]`. `key` is the WebView's `transferKey` (the store's tab
    id), bound when a view first shows the browser and kept while the browser moves between views; `null` for a tab
    no view has shown (one Chrome made, before the app adopts it; an engine placeholder). `group` (Chrome's group id,
    null for none) and `groups` are absent while an engine doesn't report groups. ArdiaCore reports Chrome's
    groups (the engine layer's `ac_tabs` in `//chrome/browser/ardia`: event `tabs.strip`, call `ac_tabs_group`). A strip left without tabs is sent with `tabs: []`; a strip whose
    window closed comes once more with `closed: true`.
- `tabStrips()` answers every strip as a transaction with `cmd: null` and the last `rev` sent: the starting point
  after a JS (re)load. Transactions that arrive before it are held, then applied if newer.
- The engine never activates, moves or pins a tab for an app reason except on a command (no activation when a view
  becomes visible; a tab moved to another window goes there in the background). Showing a page still tells the
  engine where Chrome's views go (layout).
- A tab Chrome made in a window on its own (an extension's `tabs.create`) reaches the app as `onOpenWindow` with
  `adoptId: "tab:<browser>"`; a page's new tabs and popups come as `adoptId: "ardiacore:<id>"`, already made by Chrome.

**How the app applies them** (state/tabs/chromeTabs.ts): it keeps a mirror of every strip.
- A transaction with a `cmd` (the app's own) only updates the mirror: the store already holds that intent.
- A `null` one is Chrome's change, and `chromeChanged` (state/tabs/liveTabs.ts) makes the same change in the workspace,
  diffing each strip before and after it:
  - tabs whose order among the tabs that stayed changed (off the heaviest kept run; grouped tabs weigh more, so a
    tab moved into a group joins it rather than the group's tab leaving), or that Chrome pinned or unpinned, go
    where Chrome put them (a pane of a split keeps its pin, as in Dia: the split stays and Chrome is put back;
    `placing`, last to first, each before the next tab Chrome has after it that's already in
    place, keeping a group both neighbours share). A split is one row: its panes move together and nothing lands
    between them;
  - a new active tab that stayed in the strip is shown (`activate`'s rules, opener bookkeeping included), unless
    it's Chrome's pick of a successor (`activePickedOnClose`; from engines that don't say, any activation that comes
    with the old active tab leaving): then the store's own rule (state/tabs/openers.ts) decides. An explicit activation
    in the same change as the close (an extension's remove then update) is a switch, and wins over the store's
    successor command still on its way. A split's other pane and a tab of a profile the window isn't showing
    aren't shown (the focused pane changes on user focus; profiles keep their own tab);
  - a tab Chrome made (`tab:` adoption) takes Chrome's pin, place and activation the first time the app sees it;
    a tab arriving in a strip of another app window (an extension moving it; the window is `appWindow`, else the
    one its other tabs are in) changes window as it is, page and live state included (`intoWindow`; its view takes
    the same browser there), also into a window holding only New Tab pages;
  - groups, when the engine reports them: a tab Chrome put in a group or took out of one joins or leaves the
    store's group in place; a group Chrome made becomes a store group (title, color); a group's title, color or
    collapsed state follows. Chrome's group ids and the store's are bound in memory (`GroupBindings`);
  - Chrome's change to a fact that a command of the app's own, already sent to that strip, will set (the order
    and pins of the tabs an `arrange` lists, the groups of the tabs a `group` lists, the active tab for
    `activate`) is skipped: that command commits after it and wins.
- After every store change and transaction, `stripPlan` gives what the store wants each strip to be (the store's
  tabs in it in window order, pinned first; the shown profile's active tab) and the app sends the command that
  closes the gap: `activate` first, then `arrange`, then `group` (a Chrome group for a store group that has none,
  missing members, title, color (Neutral and `"none"` go as grey, and Chrome's grey back keeps them) and collapsed, as Dia's engine mirrors it; Chrome's model keeps the active tab when
  its group collapses);
  one command per strip at a time; no `activate` while Chrome's active tab has no key (a tab Chrome made in front,
  before the app adopts it: its activation is Chrome's, above); the same command isn't sent
  again until something other than the app's commands changed that strip (a plan Chrome can't reach doesn't loop).
- ArdiaCore (`ArdiaTabStrip.mm`) takes the strips from Chrome's own tab strip models, which name the Browser, so a
  strip's window is never inferred from its tabs.
- Tests: `src/state/tabs/liveTabs.test.mjs` runs the real wiring against a fake engine that keeps this contract.

## Sync (apps/browser/src/sync, packages/sync)
- End-to-end-encrypted sync through a folder the user picks; design in `docs/sync.md`. `state/sync/engine.ts` owns the
  state (`useSync`: status, devices, other devices' tabs), the setup flows and the cycle; `state/sync/adapters.ts` maps the
  store to synced records (bookmarks, history, open tabs, pinned tabs and pinned groups, settings, passwords).
  Adapters rebuild or patch store state with `useBrowser.setState`, so store invariants they touch (group contiguity,
  pinned-first order) are kept there.
- Record keys use store ids (`bm:<id>`, `pin:t:<tab id>`), so ids must stay unique across Macs: `newId` has a random part.
- Tests: `src/state/sync/adapters.test.mjs` (two devices swap the one store; `docs/testing.md`).
  DEV: `acSync` (`turnOnSync`, `enterRecoveryPhrase`, `syncNow`, `stopSync`, `useSync`, `menu`); the sync sheets are
  `ac.syncSheets` (components/dev/devHarness.ts).

## Dev tooling (DEV builds)
- LogBox is disabled (its shadows crash react-native-macos); console errors/warnings go to
  `$ARDIA_DATA_DIR/dev-console.log`.
- components/dev/devHarness.ts runs `$ARDIA_DATA_DIR/dev-eval.js` against the store — use it to drive a running instance.
- Menus per instance: scratchpad `axmenus` tool (System Events confuses instances sharing a bundle id).
- Swipes (layout/SwipeOverlay, layout/ProfileSwipe, packages/ardiacore/ios/ArdiaSwipe.mm): `globalThis.acSwipe.pane(tabId).devSimulate(steps, { ignorePreference: true })`
  and `.sidebar(windowId)` play synthetic trackpad gestures through the real tracker (pages scroll and ack for real); `acSwipe.history` opens the back/forward list.

## Internal pages, Settings, Import (components/pages, settings, import)
- `ardia://history|bookmarks|downloads` tabs render React pages instead of a web view
  (`openInternalPage(page, windowId)`, `isInternalTab(tab)` in components/pages).
- Settings (⌘,) and Import are utility NSWindows with ids `settings` / `import` (`openSettings(pane)`,
  `openImport()` in state/settings/settingsWindows.ts); `runCommand` routes ⌘W there to close them.

## ardia:// URLs (core appUrls.ts, like Dia's dia:// and Brave's brave://)
- **The app's form is `ardia://`**, everywhere: `tab.url`, `navigation.url`, history, bookmarks,
  closed tabs, the bar, AppleScript. Nothing in the store is `chrome://`.
  - Input: `resolveInput` / `fixupUrl` turn `chrome://x`, `chrome:x`, `about:x` and `ardia:x` into
    `ardia://x`. about:blank and about:srcdoc stay as they are.
  - The engine boundary is packages/ardiacore `WebView`. Loading maps `ardia://` → `chrome://`
    (`url` prop, `loadUrl`). Reporting maps `chrome://` → `ardia://` (navigation, open-window,
    popup, load-error, download and discard events, `navigationEntries`).
  - Pages linking to `ardia://`: the engine (`ac_page_channel.h`) only follows these from a WebUI page (chrome://,
    devtools://) and drops them from web pages, like Chrome does for chrome://. That covers links,
    ⌘-clicks and popups.
  - Display: `urlForDisplay` / `displayUrl` / `breadcrumb` show `ardia://version`, keeping the
    scheme and dropping a root "/". `tabLabel` (window title) and `hostLabel` (History / Bookmarks
    pages) show `ardia://<host>`.
  - History is Chrome's, which doesn't record its WebUI pages (`ardia://`).
- **Where each host goes** (`appUrlRoute`):

  | URL | Opens |
  | --- | --- |
  | `ardia://history`, `bookmarks`, `downloads` | Our React pages in the tab (components/pages). They take precedence over Chrome's pages, and `chrome://history` typed or reported lands here too. |
  | `ardia://settings` | Our Settings window (state/pages/appUrls.ts). The tab doesn't change. |
  | `ardia://settings/<pane>` | Our Settings window at that pane: general, profiles (also `people`, `manageProfile`), sync (also `syncSetup`), tabs, appearance, privacy, passwords, autofill (also `addresses`, `payments`), extensions, search (also `searchEngines`), shortcuts, liveFolders, calendar, advanced. |
  | `ardia://settings/<anything else>` | Chrome's settings page (e.g. `settings/languages`, `settings/content`). |
  | `ardia://newtab` | A New Tab page (a new tab). |
  | `ardia://extensions` | Chrome's extensions page (as dia://extensions is in Dia): developer mode, load unpacked, errors, shortcuts. Our Settings › Extensions stays at `ardia://settings/extensions`. |
  | Everything else: `version`, `gpu`, `net-internals`, `flags`, `inspect`, `about`, `chrome-urls`, `password-manager`, `downloads-internals`, … | Chrome's WebUI page, shown as `ardia://<host>`. |
- `settings` and `newtab` are handled in the store's `navigate` / `newTab` through `setAppUrlOpener`
  (state/tabs/tabs.ts). That covers every way a URL gets in: the bar, bookmarks, history, AppleScript,
  opened URLs and links. A restored tab at `ardia://settings/…` loads Chrome's page.
- The OS doesn't route `ardia:` to us. Like Dia and Brave, the app doesn't register the scheme,
  so a web page can't open `ardia://quit` through Launch Services. `open -a Ardia 'ardia://version'`
  and AppleScript work, because those go to the app directly.
