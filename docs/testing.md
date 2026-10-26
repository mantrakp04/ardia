# Testing

`pnpm test` at the root runs every unit test (333 cases, 2026-10-12). Turbo caches the results; a cold run spends most
of its time in `swift test`'s first build. Each package also runs its own:

| Package | Command | Cases |
| --- | --- | --- |
| `apps/browser` | `pnpm --filter @ardia/browser test` | 228 |
| `packages/core` | `pnpm --filter @ardia/core test` | 32 |
| `packages/sync` | `pnpm --filter @ardia/sync test` (`swift test`, `node --test`, then the rename's launch migration end to end, `scripts/legacy-migration-e2e.mjs`) | 66 + 9 |
| `packages/import` | `pnpm --filter @ardia/import test` (`swift test`) | 26 |
| `packages/ardiacore` | `pnpm --filter @ardia/ardiacore test` (`tests/pip-zoom.test.cc`, compiled with `clang++`) | 1 program |
| `extras/raycast-ardia` | `node --test extras/raycast-ardia/src/scripts.test.ts` | 6 |

`apps/browser` runs its TypeScript under plain Node, with the real `@ardia/shell` and `@ardia/ardiacore` code:
`src/test-loader.mjs` swaps only the native side. `expo-modules-core` becomes `src/test-native/expo.ts`, which hands
each package the fake of every native module it asks for (`src/test-native/shell.ts`, `src/test-native/ardiacore.ts`),
and `react-native` a few inert views; the packages' `.tsx` files are transpiled with TypeScript on the way in (cached in
`node_modules/.cache/ardia-test-tsx`). The native surface is listed once per package, in `src/nativeModules.ts`
(`ShellNativeModules`, `ArdiaCoreNativeModules`), and the packages can only ask for modules listed there. Each fake is
typed against that list, so `pnpm -C apps/browser typecheck` fails when a native method is added, removed or changed
and the fake isn't. Tests drive the fakes through `src/test-native/index.ts` (`docs`, `chromeVisit`, `windows`,
`engineEvent`, …). One file: `node --no-warnings --import ./src/test-loader.mjs --test src/state/tabs/tabs.test.mjs` (from
`apps/browser`).

End-to-end checks need a built app and are run by hand. Each runs hidden instances through `scripts/lib/instance.mjs`
and prints one line per check (PASS/FAIL, ms), a failure's first lines, then a summary with the path of the log that
holds the rest.

| Check | Run | Guards |
| --- | --- | --- |
| Release smoke test | `.claude/skills/release/scripts/smoke.sh` (the `release` skill) | Every release, whole |
| Shortcuts | `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` | Every shortcut in every focus (0.2.8: ⌘1–9 were swallowed outside a page) |
| Profile swipes | `node apps/browser/scripts/profile-swipe-test.mjs <Debug app>` | The native pager's races (0.2.14–0.2.18 fixes) |
| Tab dragging | `node apps/browser/scripts/tab-drag-test.mjs <Debug app>` | Dragging in the top tab strip moves the tab, never the window (0.2.18); the empty strip moves it over its whole height and a double-click zooms (0.2.25); the empty sidebar under the rows moves it too, and a double-click there still opens a tab |
| Windowing | `node apps/browser/scripts/windowing-test.mjs <Debug app>` | Window frames and what the screen shows in passing |
| ⌘-scroll | `node apps/browser/scripts/zoom-scroll-test.mjs <Debug app>` | Trackpad scrolls, mouse zooms (regressed in 0.1.4 and 0.2.12) |
| Hidden panes | `node apps/browser/scripts/hidden-pane-test.mjs <Release app>` (a Debug app fails five `shown:` checks) | What changes while a tab is hidden (URL, title, loading, zoom, find bar, a permission prompt) is on screen the moment it is shown |
| Layout shifts | `node apps/browser/scripts/layout-shift-test.mjs <Release app>` (reads a probe a Debug app's React dev hook replaces) | Nothing already on screen moves when late content arrives |
| Window toolbar | `node apps/browser/scripts/window-toolbar-test.mjs <Release app>` (31 of 39 checks fail on a Debug app) | The toolbar's buttons and layout in each window kind |
| Hover layout | `node apps/browser/scripts/hover-shift-test.mjs <Debug app>` | Hovering moves nothing: every hover-tracked view in the sidebar, the tab strip and the downloads popover (below) |
| Sidebar clicks | `node apps/browser/scripts/sidebar-click-test.mjs <Debug app>` | One click opens a tab or pinned tile: in the frame its hover card appears, under another tile's appearing card, after a New Tab and after closing a pinned tab (0.2.39-nightly.5: tabs needed two clicks) |
| Onboarding | `node apps/browser/scripts/onboarding-test.mjs <Debug app>` | No text field sits behind the onboarding card, a click on the first row's checkbox toggles it, another window keeps its New Tab field meanwhile, and the New Tab field is back and focused once it ends, in a bar of the same height (the hidden New Tab field took the first row's cursor and its checkbox clicks) |
| Sidebar scroll | `node apps/browser/scripts/sidebar-scroll-test.mjs <Debug app>` | The pinned tiles hold still while the tabs scroll (Dia's dock), with the address field in the sidebar and without: a row dragged onto a tile after a scroll pins it there, selecting a tile while scrolled leaves the list put, and a dock too tall for the window scrolls with the tabs |
| Sync | `node packages/sync/scripts/e2e.mjs <Debug app>` | Two and three hidden instances through one folder (`docs/sync.md`) |
| Import | `node packages/import/scripts/e2e.mjs <Debug app> <scratch dir>` | Cookies, addresses and cards from a fake Chrome home (`packages/import/README.md`) |
| Video upscaling | `node apps/browser/scripts/video-upscaling-test.mjs <Debug app> [--keep] [check…]` (`--list`) | What the GPU process upscales in every state the gate decides (playing, paused, native size, background tab, app inactive, occluded, Low Power, thermal, PiP, HDR, full screen, Little Ardia, setting off), from its `ArdiaVSR.*` trace events and `videoUpscalingState()` |
| Engine patches | `python3 engine/patches/series.py check` | The patch series reproduces the Chromium tree (`docs/engine-build.md`) |
| Engine (ArdiaCore) | `node packages/ardiacore/scripts/acceptance.mjs <Debug app> <scratch dir> [--keep] [check…]` | The app on ArdiaCore, hidden (`docs/ardiacore-parity.md`). `--keep` leaves the instance up and `--attach <scratch dir> [check…]` re-runs checks on it in seconds; `--list` gives each check's section and what it needs (brought along automatically) |
| Focus (ArdiaCore) | `node packages/ardiacore/scripts/activation-acceptance.mjs <Debug app> <scratch dir> [check…]` | The panes shown, Chrome's active tab and native focus agree |
| Native perf | `node apps/browser/scripts/perf/native-bench.mjs --app <Release app> --out <dir>` | Launch, idle, memory, tab and window latency; the release perf gate (`docs/perf/README.md`) |
| JS perf | `node apps/browser/scripts/perf/js-bench.mjs run --app <Release app> --bundle <main.jsbundle> --label <name>` | What each interaction costs the JS thread (`docs/perf/README.md`) |

## Test instances

Launch with `scripts/agent/ac launch <app> --data <dir> [--instance K=V] [--test K[=V]] [--trace AREA] [--switch S]…`
(`--help`; then `ac eval`, `ac page`, `ac quit`), or `launch(app, { instance, test, trace, switches })` in
`scripts/lib/instance.mjs`. `ARDIA_BACKGROUND=1` and a scratch `ARDIA_DATA_DIR` make an instance a test instance;
`ARDIA_INSTANCE`, `ARDIA_TEST` and `ARDIA_TRACE` carry the rest. Every variable, key and trace area is in
`docs/agent-brief.md` › Launch variables; what some of them do in more detail:

- **CDP and the profile gate.** CDP (`--remote-allow-origins=*`), argv and `chromiumSwitches` reach Chrome only on its
  mock keychain (a scratch `ARDIA_DATA_DIR`, or an ad hoc build). A team-signed build on its real data dir ignores
  them, and its browser process removes every switch that would open the profile to outside control, however it's
  spelled, at startup and again once chrome://flags have become switches, and unsets `SSLKEYLOGFILE`
  (`ac_main_delegate.cc` `kSwitchesThatOpenTheProfile`; `--trace profileGate` logs the parsed and gated command lines
  both times, `--test applyProfileGate` applies the gate on the mock keychain too).
- **`reauth=granted`** (engine `ac_reauth.cc`) grants macOS re-auth requests in background mode (otherwise refused,
  each reported as `reauth.requested`). Like every `ARDIA_TEST` key it counts only in a build that isn't signed for
  distribution, on a scratch data dir and Chrome's mock keychain, so it can never reveal what the real "Ardia Safe
  Storage" key encrypts; a Developer ID build refuses every request in background mode.
- **`contextMenu`**: context menus go to the host instead of the screen; the menu is written to
  `<data dir>/context-menu.json`, the pick read from `context-menu.json.pick` runs on the model that owns it, logged as
  `[ardiacore-menu]` in the system log.
- **`fakeFullScreenMs`**: length of the acted-out full-screen transition (the window takes the screen's frame as it
  starts and its old frame back on the way out, as AppKit does). Dev actions (`devWindow`): `fakeFullScreen:<1|0>[:<ms>]`,
  `fakeFullScreenMs:<ms>`, `fakeOcclusion:<visible|occluded|off>` (macOS's occlusion state; a test window otherwise
  counts as seen), `fakeFullScreenOcclusionMs:<ms>` (acted transitions occlude the window, visible again `<ms>` after
  they end, as a real Space animation), `pageCover:<1|0>` (the page's picture over it through transitions,
  `ArdiaPageCover`; 0 is 0.2.30's behaviour), `fullScreenProbe:<ms>` then `fullScreenProbe` (per display frame, what
  an in-process render of the window, all AppKit's transition shows, has in the page's place: an 8 × 6 colour grid,
  uniformity, covers; acceptance `fullscreen-transition-picture`).
- **`pipSelfTest`**: on the first PiP window, `close` / `backToTab` click Chrome's buttons (`pip-button-selftest.json`:
  closed, the prevents-activation tag, app activations), `hover` holds the controls up (`pip-hover.json`, `pipHover`),
  `style` runs the style self-test (`pip-selftest.json`), all in the data dir.
- **`allowOcclusion`**: macOS posts no occlusion change for a window a band below normal, so minimizing and
  deminiaturizing post one for it (the page goes hidden as in a user's minimized window).
- **The `ardia` command** (`cliHome`, `cliBinDir`, `cliUrl` (`file://` works), test `cliInstallScript`): a test
  instance installs or upgrades only with the first two set, so it never touches the real home. Its
  `--remote-debugging-port` makes the "Let the ardia command control Ardia" setting stand aside; test that setting in an
  instance launched without one.

`ARDIA_BACKGROUND=1` changes:
- **Activation:** the process is BackgroundOnly and every activation path is refused and logged to
  `$ARDIA_DATA_DIR/activation.log` (`ArdiaActivation.mm`). File panels never show: they answer with the paths in
  `$ARDIA_DATA_DIR/file-chooser.txt` (one a line, consumed), or cancel. Context menus are reported, not shown.
  It reads as active all the same (`-[NSApplication isActive]`, the one fake), and AppKit's key window follows as in an
  active app: the window made key is key and its notifications go out, so focus runs production's path. A check
  plays the user leaving for another app with `devWindow(n, "fakeAppActive:0")`. Metal views act as in the key
  window too (the New Tab intro plays in it).
- **Clicks:** `devWindow(n, "mouse:<down|up|dragged|moved>:<x>,<y>[,<clicks>]")` posts one event to the queue as the
  window server would (x, y from the window's top left), so a text field's mouse tracking sees its own mouse-up; a
  script times the up itself. AppKit still keeps an inactive app's first click on unselected text or a page to
  itself: `devWindow(n, "fakeActiveClicks")` lets them through, as in the active app. `devWindow(n,
  "responderChanges")` lists the first-responder changes since the last call with their stacks (who took a field's
  focus).
- **Windows:** they stay behind every other app's windows: each window's level is set a band below normal (normal at
  CoreGraphics layer -1000000, floating at -999997…; `-level` answers the one asked for), so no ordering, activation
  attempt or AppKit reshuffle lifts one over the owner's, the app's own keep production's order, and Mission Control
  leaves them out (`ArdiaActivation.mm`). `[NSApp activateIgnoringOtherApps:]` and `activate` are refused and
  logged. With `ARDIA_INSTANCE` `allowOcclusion` a window the owner's cover is really occluded.
  Full screen is acted out (no new Space); windows answer NO to `-[NSWindow isOccluded]`, so a covered
  window shows a tab at once instead of after Chrome's 1 s delay, with `--disable-backgrounding-occluded-windows`;
  PiP windows stay at alpha 0 and click-through; the drag preview stays above its own window only.
- **Media:** `--mute-audio` (Chrome then reports no tab as audible, so the speaker never lights; the ArdiaCore
  acceptance run sets `allowAudio` with `--disable-audio-output`, so Chrome still hears its -60 dBFS fixtures and the speakers get nothing), no intro music, `--use-fake-device-for-media-stream` with the microphone kept on a fake
  input (`ac_fake_media.mm`), and `--disable-modal-animations` (a locked screen never ends a dialog's close animation).
- **Other:** macOS re-auth prompts never show; requests are refused unless `ARDIA_TEST` `reauth=granted` in a build that
  honours it (above). Nothing system-wide changes: Set as Default (onboarding, whose checkbox starts unticked, and
  Settings), Chrome's own default browser, scheme and file type setters, Add to Dock and Launch at Login are no-ops
  that log a line (`ArdiaSystem`, `chromium-background-instance-no-default-handlers.patch`).

A scratch `ARDIA_DATA_DIR` holds Chrome's user data and the app's documents, its defaults, keychain items and
Sparkle state (`ArdiaIsolation.h`); Chrome gets `--use-mock-keychain`; update checks are off without
`updateFeed`; a Release build's telemetry is tagged `test`, and the release-notes page stays closed
unless `releaseNotes`.

A Release or RC build starts the dev harness (`dev-eval.js`) only when `$ARDIA_DATA_DIR/perf-probe` exists in a
test instance (`src/state/app/perfProbe.ts`): `: > "$ARDIA_DATA_DIR/perf-probe"` before launch, as
`.claude/skills/release/scripts/smoke.sh` does.

Input and capture hooks on `ac.shell` (Debug builds only; a Release build answers nothing or `null`), for driving
the app as a person would rather than writing a new helper:

| Hook | What it does |
|---|---|
| `devKeyEquivalent(windowId, { key, keyCode, modifiers, focus, asKey })` | Presses one shortcut through the window's real key path |
| `devTypeKeys(windowId, text, interval)` | Types text into the focused field, a key every `interval` ms; resolves with per-key timings |
| `devMenuCommand(command, arg)` | Fires a menu command as if picked from the menu bar |
| `ArdiaApp.devMenuItems(title, path?)` | A menu bar menu's items as AppKit has them, its own included (Window › Fill, Move & Resize…); `"tiling:<windowId>"` is the window's green-button menu and whether AppKit tiles it; `path` picks an item |
| `ArdiaApp.devPostKey(windowId, key, keyCode, modifiers)` | Posts one key press to the app's event queue (`"menu:<key>"`: straight to the menu bar's key equivalents). System hot keys (fn-⌃ tiling) can't be posted |
| `devSnapshotWindow(windowId, path, transparent?)` | Writes the window's layers to a PNG in-process (works with the screen locked; `false` = failed) |
| `devRenderIntroMusic(cues, path)` | Renders the onboarding intro music to an audio file, for a video's soundtrack |

## Hover never moves anything

A control that shows on hover (a row's ✕, a live folder's refresh, Show in Finder) goes in a `HoverSlot`
(`components/ui/HoverSlot.tsx`): the slot keeps the width of what it shows at rest, at least the control's, and the control
lies over it. `useHover` and `useRowHover` mark their handlers, and the dev harness's `ac.hoverShift.check({ scopes })`
(`src/components/ui/hoverShift.ts`) hovers each marked view inside the named components in turn, measures every view under its
parent before and while hovered, and returns what moved or resized; only a HoverSlot's inside may change.
`hover-shift-test.mjs` runs it on the sidebar (with groups, a live folder and its open items), the tab strip and the
downloads popover, and fails on any shift. Run it after changing anything a hover touches.

## What's kept, and why

The suite was cut from 412 unit cases to 82 on 2026-10-01. A case stays when breaking what it guards would
lose or leak data, or when the bug is invisible by eye and has shipped before.

| File | Kept | Why |
| --- | --- | --- |
| `apps/browser/src/state/browser/privacy.test.mjs` | Private windows and incognito: nothing in `session.json`, `downloads.json` or favicon files, no history, no closed-tab records, no dragging tabs across; history time-range clearing; profile deletion queues Chrome's data and keeps shared data | Privacy and data loss. 0.2.11 shipped private tabs saved to disk and a deleted profile's data left behind |
| `apps/browser/src/state/session/session.test.mjs` | v1 → v2 migration; `hydrate` repairing a damaged session; reopened windows keeping back/forward (0.2.12); shared profile data across a reload; `history.json`'s hand-written serializer; pinned tabs unloading on ⌘W, parking with a closed window, coming back once, surviving a relaunch (0.2.2, 0.2.8) | Session and history persistence |
| `apps/browser/src/state/tabs/tabs.test.mjs` | Opener placement and close → activate rules; group contiguity; broken splits dropped; clean-up and abandoned New Tab cleanup never closing a window or the shown tab; Chrome's echo of the app's own tab switch; an extension's default search engine; the mini player staying closed (0.2.12) | Core behaviour that's hard to see by eye |
| `apps/browser/src/components/omnibox/inline.test.mjs` | Every interleaving of typing and inline completion; stale completions never applied | 0.1.6: fast typing dropped or reordered letters |
| `apps/browser/src/state/sync/adapters.test.mjs`, `engine.test.mjs` | Bookmark delete-vs-add and move cycles, parked pinned tabs, passwords (newest wins); a crash right after a batch lands; nothing published before its journal is on disk | Sync data loss (0.2.11) |
| `apps/browser/src/state/sync/pairs.test.mjs` | Two in-memory Macs, every ordered pair of pinned-tab edits (pin, unpin, re-pin, row/tile, moves into groups, new groups, group unpin/re-pin/delete/restyle, rename, loaded pages, a member's page, a trip away and back, and a page copied to a new mirror before its window closes, profile moves) and lifecycle steps (park and reopen, a mirror window, a relaunch through the saved session, a snapshot collecting tombstones 46 days on) in six schedules (one after the other, concurrent, concurrent with a third Mac running the shipped 0.2.38 pinned adapter and scope from `fixtures`, either Mac's log delayed, a third Mac joining from the folder after B's delayed log, A's first log 44 days late while B compacts and a third Mac joins from that snapshot, without the ops that compact again), 7,402 runs in about 8 s: all Macs converge on the same pins, names, icons and group styles, every record names a group that exists, nothing pinned or kept regular is lost, the Mac that unpins a group keeps it, windows, splits and groups stay whole and ordered, each edit's outcome holds (renames, restyles, the page a Mac navigated to is sent, the later explicit choice), and nothing is sent once settled. Fourteen more cases: a member waiting for a group that never comes stands alone after 90 days on an idle Mac; seven page changes (a member navigated behind another window, copied to a new mirror whose window then closes, copied to a third window, a new group's mirror navigated before its first sync, navigated and unpinned then re-pinned elsewhere, a tile navigated then moved into a group, a mirror copy navigated in front), each with and without an edit from the other Mac, sent exactly as the shipped 0.2.38 adapter sends them, checked side by side; a Mac keeps the regular group it unpinned when the other restyles the pinned one; and, as documented in `docs/sync.md`, two Macs showing a pin at different pages, the page-change-versus-unpin conflict and three compaction residuals. The settle checks let a pin two Macs show at different pages keep sending; anything else must go quiet | Concurrent pinned-tab sync (0.2.40) |
| `apps/browser/src/state/telemetry/sanitize.test.mjs` | URLs, hosts, paths, user names, quoted text, emails, dev hosts and NSException reasons never leave the Mac | Privacy: telemetry must never carry what the user browsed |
| `packages/core/src/url.test.ts` | Typed text → URL (`resolveInput`, `fixupUrl`); IDN homograph spoofing stays punycode; tracking parameters stripped without touching the rest; `ardia://` shown, never `chrome://` | URL parsing and security |
| `packages/core/src/suggest.test.ts` | Inline completion never fills a long sign-in URL; free text never autocompletes; open tabs switchable; frecency ranking; a newer fetch aborts the older one | Omnibox ranking |
| `packages/sync` | The 9 convergence cases above, and the crypto's 5 (`docs/sync.md` › Tests) | Sync correctness and encryption |
| `packages/import/tests/ImportTests.swift` | Importing never writes to the source profile, never leaves its data folder, decrypts logins only with the right key and only after consent | Another browser's data and secrets |
| `extras/raycast-ardia` | Tab and profile ids, and what's typed into New Tab, are quoted in the AppleScript it sends; its answer reads back into the right tabs and profiles; a profile name matches whole, then by a start only one profile has, ignoring case, and a start several share names them instead of picking one | Script injection; New Window opening the wrong profile |

## What went, and why

| Removed | Why |
| --- | --- |
| Spring, rubber-band, capsule and layout constants (`swipeMotion`, `stripGroups`), group naming and labels, numbered tabs, release-note postcard timing, favicon index bounds | Pin exact constants or formatting; a visual check catches these |
| Calculator, quick-create commands, Tab-to-search, text fragments, custom engine validation, most `appUrls` cases | Small pure helpers whose failure is visible the moment you use them |
| Live folders (GitHub, Meetings), Little Ardia, splits beyond integrity, organize beyond clean-up, OTLP encoding | Feature detail rather than data or security; covered by use |
| The rest of `pinnedClose`, `openers`, `idn`, `suggest`, `sanitize`, sync and import | Variations of a kept case |
| `profile-pager-race-test.mjs` | Loaded the pager's source with its dependencies mocked; `profile-swipe-test.mjs` runs the same races against the real app |
| `profile-motion-stall-test.mjs`, `profile-swipe-replay.mjs` (and the owner's trackpad recording) | One-off investigation harnesses for the native pager, done in 0.2.18 |
| `packages/import/src/index.test.ts`, Swift tests for Dia tabs, file imports, Firefox and Chromium parsing | The JS wrapper is a thin bridge; parsing failures show in the importer's own result |
