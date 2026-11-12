# Ardia on Windows

Windows comes before Linux, and both share one codebase with the Mac: no fork. The Windows work lives on its
branch (PR #1116) until the owner merges it. This file is
the plan and the state of the port. The request is issue #351.

## What is shared

| Layer | Shared | Language |
| --- | --- | --- |
| UI and app logic (`apps/browser/src`, `packages/core`) | Yes | TypeScript |
| Browser logic (ArdiaCore's shared core, `engine/chromium`) | Yes | C++ |
| Chromium and the patches that apply on every OS | Yes | C++ |
| The `ac_*` C API between the UI and the core | Yes | C |
| OS calls: windows, menus, secrets, glass, shaders | No, one per OS | Mac: Swift and Objective-C. Windows: C++ |
| The Mac-specific engine patches | No, each gets a Windows version | C++ |

Logic is written once. Only code that calls the OS is written per platform.

## The Windows app

- `apps/browser/windows` is the app project: React Native for Windows 0.81 on the new architecture, which is the
  only one Windows supports from 0.82 on. The Mac stays on the old architecture until it upgrades past 0.81.
- The UI is the same TypeScript. Metro bundles it for the `windows` platform (`pnpm -C apps/browser bundle:windows`),
  where `react-native` is `react-native-windows` and `expo-modules-core` is `packages/expo-windows`.
- `packages/expo-windows` is the API our native packages call (`requireNativeModule`, `requireNativeViewManager`,
  `uuid`), on Windows:
  - a module that has a C++ version answers from it (a React Native turbo module of the same name), one method at
    a time: a method it lacks falls through;
  - a method with no C++ version answers from `src/defaults.ts`, or with `null`, and logs its name once;
  - a view is either native (`ArdiaVectorIcon`, registered in `Modules.h`), drawn in TypeScript
    (`src/views`, `src/symbol`, `src/windowDragRegion.tsx`), or a plain view that logs its name once and lets
    presses through to what is under or inside it (several Mac views are empty layers over other content, and a
    stand-in that took presses made the sidebar's tabs unclickable).

  The log, and `ardiaWindowsMissing()` in the JS console, list what the app has reached so far that has no Windows
  version, not everything left to port.
- The app is a library, `ArdiaApp.dll` (the `Ardia` project), because Chromium's sandbox needs Chromium's own launcher
  to be the process. It runs in two modes, chosen by who calls it (`EngineApi.h` has the types):
  - Standalone: `Ardia.exe` is a stub (`ArdiaLauncher`) that loads `ArdiaApp.dll` from its own folder and calls
    `ArdiaAppRun`, which sets the app up and runs its own event loop. This is what CI builds and tests.
  - In the engine: Chromium's launcher loads the library on its UI thread and calls `ArdiaAppStart` with its API table.
    The app sets up and returns; Chromium runs the loop, hands each message to `ArdiaAppPreTranslateMessage` first, and
    calls `ArdiaAppStop` when the loop ends. Quitting asks the engine (`app.quit`) instead of ending the loop.
  - `ArdiaEngineHost` (`EngineHostModule.h`) is the bridge: `available()`, `hostCall`, `engineCall`, and the engine's
    events as `ArdiaEngineHost:event`. Other native code reaches the engine through `Host::Engine()`.
  - What belongs to the app comes from the library (`AppImage.h`: the bundle folder, dialogs, window classes, the
    version); what is about the process stays with the executable (launch at login).
  - Windows finds the Windows App SDK's classes through the manifest of the process's executable, not the library's.
    The `Ardia` project writes that list to `ArdiaApp.winrt.manifest` in the output folder, and the stub links it in
    with its own entries (`ArdiaLauncher/Ardia.exe.manifest`: Windows 10 and 11, per-monitor DPI, common controls 6).
    `scripts/windows/host-manifest.ps1 -From ArdiaApp.dll -To <exe>` writes the same list into another executable,
    keeping what it already declares: the engine's launcher needs it. The library, its DLLs and `Ardia.pri` have to sit
    next to that executable.
- Native code is C++ in `apps/browser/windows/Ardia`, header-only, one module per header, named as on the Mac
  (`ArdiaApp` in `AppModule.h`), all included from `Modules.h`. Events reach JS as the device event
  `<Module>:<event>` (`Events.h`). Folders come from `Paths.h`: data in `%LOCALAPPDATA%\Ardia` or `ARDIA_DATA_DIR`,
  config in `%APPDATA%\Ardia`.
- Windows are the app's own (`WindowManager.h`, `ArdiaAppWindows`): one runtime, one window per window id, each
  mounted with its id, as on the Mac. No window has a system title bar or system caption buttons: every window draws
  into its whole frame, and the UI draws minimize, maximize and close itself (`components/window/WindowControls.tsx`),
  as the Mac's lights live inside the UI there. So no band is kept free at the top: the page card starts at the page
  frame, and Settings and Import have no title bar above them.
  - Where the buttons sit comes from `windowControlsPlace` in `state/windows/layout.ts`: in the card's toolbar row, in
    a right sidebar's header, at the end of the top tab strip, in Little Ardia's bar. Only a card with no toolbar under
    the corner (address bar in the sidebar, sidebar on the left) keeps a 32 point band for them. They take the site's
    toolbar colours in the toolbar, and when the toolbar hides while scrolling a smaller set fades in on the 20 point
    strip. The room every row keeps for them (138 points: 12 to the edge, 96 of buttons, 30 to drag by) is in
    `lib/platformChrome.windows.ts` and `WINDOW_CONTROLS` in `lib/windowChrome.ts`.
  - With no lights on the left, a sidebar header with nothing in it collapses to the page frame on Windows
    (`sidebarHeaderCollapsed`), so the tabs start at the top; the downloads button then sits in the sidebar's footer.
    The header stays for a profile indicator, an incognito window, the address row, and a right sidebar.
  - Moving the window: a drag region is a view that moves the window when the UI's own hit-testing gives it the press,
    so a control on top of it still clicks, and the app moves the window while the button is down (Escape puts it
    back, a maximized window restores under the pointer, a release at the top edge maximizes). The UI also marks
    caption regions for Windows (`captionRegions` in `state/windows/layout.ts`, sent by `state/windows/captionRegions.ts`
    through `platform/windowControls.windows.ts`): the gap beside the window buttons and the gutter above the card,
    where nothing else sits. Windows moves the window itself from those, so its snap, drag off a maximized window,
    double click to maximize and system menu work, and each press still reaches the UI so popovers and the command
    panel close. No region is marked while the command panel, the downloads popover or onboarding is open. Native lays
    a pass-through over the rest of any band Windows would treat as a title bar. The launch log says
    `input regions of <id>: ...`, `title band of <id> is caption|content` (caption while any region is marked),
    which path each drag took, and `maximized|restored <id>`.
  - A hidden sidebar slides back in when the pointer reaches the window's edge, as on the Mac: `watchSidebarEdge`
    polls the pointer every 40 ms while a window is watched and logs `sidebar edge over|away <id>`.
  - The app quits when its last window closes: it sends `willQuit`, then quits on the UI's yes or after 3 seconds
    without a reply; a no cancels the quit.
  - Windows fade as on the Mac (`WindowFade.h`), fade only with no grow. A window opened with `animated` (and every
    Little Ardia window) stays transparent until its React root has content or for 0.6 s, then fades in over 0.25 s
    (Little Ardia 0.20 s); `animateWindowClose` fades it out from where it is over 0.18 s (0.15 s), hides it and then
    resolves. With `after` naming a new window it waits for that window to appear plus 0.20 s and hides at once. The
    fade makes the app window and every visible window it owns (the page windows) layered for its length and puts
    their styles back at the end; on the way out they ignore clicks, and pages still shown after the hide stay
    transparent until the engine hides them (at most 2 s). A minimized, full screen or not yet shown window, or
    Windows' "Animation effects" off, shows and hides at once. The launch log says `window <id> fades in over <ms> ms
    with <n> page windows`, `window <id> shown`, `window <id> fades out over <ms> ms`, `window <id> hidden` and
    `window <id> hidden at once: <reason>`.
- What has a C++ version: windows, documents, config files and their watcher, secrets (Credential Manager), local
  telemetry, launch config and system info, file actions and icons, launch at login, the theme, lock and sleep
  signals, the clipboard, the bang list, confirm, prompt and file dialogs, the command table with its shortcuts and
  context menus, the Escape and tab switcher key captures, icons, file and link drops, and notifications.
- File and link drops: each browser window's top-level window and its child windows take OLE drops (`FileDropTarget.h`).
  Every `FileDropArea` reports its frame in the window to native as it mounts, lays out and changes, and again when a
  drag enters the window; native picks the innermost enabled area under the pointer, so the cursor shows copy or no
  drop at once, and reads files (`CF_HDROP`), links (`UniformResourceLocatorW`) and text (`CF_UNICODETEXT`) with the
  Mac's rules for each accept mode (`FileDropItems.h`), `.url` and `.webloc` files included. The area gets the Mac's
  enter, move, exit and drop updates. Dragging a file out of the app is not built yet, so `devLastFileDrag` is empty.
- Notifications are Windows App SDK app notifications (`NotificationCenter.h`): the app registers at startup, before
  the first window, which also registers its toast activator for this unpackaged app, so a click on a toast reaches
  the running app or launches it. Clicks are held until a window is open, then sent as `onNotificationResponse`.
  Windows has no permission prompt: the system setting for the app is the answer. A background instance registers
  but logs toasts instead of showing them. Windows reports no dismissals, so there is no `close` response. If
  registration fails, notifications answer as not set up and the launch log says why once.
- A press reaches the UI as a touch with no button: pointer events never arrive, and the app's pointer input does not
  pass through the UI thread's message queue. So the window root (`OutsidePressRoot` in `src/views/inputAreas.tsx`)
  asks native which button is down when a touch starts (`ArdiaWindowsHost.pointerState`), and for a right or middle
  press it takes the press, finds the context menu or middle click area under the real target, and acts on release.
- Shortcuts are the Mac's with Command as Ctrl and Option as Alt, except where Windows has its own convention;
  `CommandTable.h` holds both columns. The JS command catalog still shows the Mac keys in Settings.
- Escape reaches a focused field or dialog through React Native's own key events, which is how the command bar and
  Search Tabs close. A popover with nothing focused in it needs the key captured, as the Mac's key monitor does:
  while the UI holds Escape (`captureEscape` in `platform/focus.ts`, for a page popover, a sidebar or bookmarks bar
  drag, and on Windows the Downloads popover too), `ArdiaFocus.setDragEscapeCapture` (`FocusModule.h`) has the
  keyboard hook in `MenuKeyboard.h` take a bare Escape in an Ardia window and send `dragEscape`. While the tab
  switcher is open the hook takes every key, as on the Mac: Escape and the left and right arrows go to the switcher
  and its own shortcut still runs. The launch log says `keys escape capture on|off` and
  `keys escape sent to the open popover or drag`. The Mac's Downloads popover does not close on Escape yet
  (`PLATFORM_FEATURES.escapeClosesDownloads` is off there).
- Animations run in JavaScript on Windows (`packages/expo-windows/src/animation`). React Native for Windows' native
  animation driver adds what it animates to the view's own style instead of replacing it, turns a scale around the
  top-left corner, never reports where an animation ended, and drops scroll and gesture events, so anything but a
  plain fade started doubled, ended in the wrong place or did not move. `installAnimation` therefore answers
  `useNativeDriver: true` with the JS driver, which sets the view's real props every frame, as the sidebar's slide
  always did. The exceptions are endless loops of one animation (the loading and refresh spinners), which stay native
  and cost the JS thread nothing.
  - Frames are paced: React Native's `requestAnimationFrame` is a zero timeout here, so an animation would step as
    fast as the threads allow. `motion.ts` runs every frame callback of a turn together, 60 times a second.
  - A scale, rotation or skew turns around the view's centre, as on the Mac: React Native for Windows applies a
    transform from the top-left corner, so `pivot.ts` wraps any transform that is not at rest in a half-size translate
    there and back. `transformOrigin` then means what it means on the Mac, and the command panel grows out of its
    field as it does there.
  - While an animation runs, every shown page and every surface over a page is measured again each frame
    (`followMotion`), so the page window and the holes cut in it follow what moves: the toolbar that hides while
    scrolling, a peek, a popover that grows in. Endless loops do not count.
  - The launch log says `[ardia windows] motion <n> frames in <ms> ms, longest <ms> ms, <n> long` when a burst of
    animation ends: how many frames it got, the longest gap between two, and how many gaps were over 2.5 frames.
- While the command panel sits beside the window buttons it keeps their 138 points free at the right
  (`trailingClearance` in `lib/windowChrome.ts`). Little Ardia's bar numbers for both systems are in
  `components/littleArdia/barLayout.ts`.
- Icons are the web demo's set (`packages/demo/src/shims/web/symbols`), resolved in TypeScript and drawn natively as
  Direct2D geometry in Composition shapes.
- Materials are native views (`MaterialViews.h`, the `ArdiaMaterials` module in `MaterialsModule.h`), each with the old
  flat drawing as its fallback. A window backdrop that covers its whole window asks the system for Mica Alt behind the
  window on Windows 11 22H2 (build 22621) and later and draws the Mac's tint over it. Visual effects, glass and popover
  bubbles blur what is under them inside the window with a Composition backdrop brush (Gaussian blur, saturation and a
  tint). Window and theme gradients are Composition linear gradients at their real angle. Windows 10, a background
  instance and any failure keep the flat colours; the launch log says once which path each one took.
- The Windows native API has its own version: `WINDOWS_NATIVE_API_VERSION` in `platform/nativeApi.ts` and
  `windowsApiVersion` in `AppModule.h`. Bump both when the Windows native surface changes. A Mac bump doesn't
  touch it.
- `--log-file=<path>` makes the app write its launch log, React Native's log and JavaScript errors to a file. Each
  line is `<level> <ms since process start> <message>`.
- A background instance (`ARDIA_BACKGROUND=1`) shows its windows without taking focus and answers dialogs and menus
  without showing them, as on the Mac.

## The engine in the app

The engine is Chromium's own browser, built for Windows with our patches (`docs/engine-build-windows.md`). The product
is one folder: Chromium's launcher as `Ardia.exe`, `chrome.dll`, and the app's library and files beside them
(`scripts/windows/assemble.ps1` puts an engine and the app's build output together and gives the launcher the app's
manifest entries). With `ArdiaApp.dll` beside the launcher the browser process runs the app; without it the same build
is plain Chromium.

- `//ardia/win` (`scripts/windows/engine/src/ardia/win`, copied into the tree by `series_win.py`) is the engine's side.
  It starts Chromium with no window of its own, turns the launch variables into switches as the Mac's launcher does
  (`ARDIA_DATA_DIR` keeps Chromium's data in `<dir>\Chromium`; `ARDIA_REMOTE_DEBUGGING_PORT` only works with it; a
  remote debugging switch on the command line is dropped), loads the app's library once the browser has started, and
  hands it the API in `EngineApi.h`: `hostCall(verb, json, window)`, `engineCall(name, profile, json)` and one event
  sink. Chromium's message loop offers each message to the app first, except messages for Chromium's own windows.
- Every normal browser window Chromium has is hosted: page only, with no frame, tab strip, toolbar, rounded page frame
  or shortcuts of its own (the `chromium-win-hosted-*` patches). The app keeps one per app window and profile. Each is
  a borderless top-level window owned by the app's window, placed over the page's view: it stays above its owner, hides
  and minimizes with it, and follows it when it moves. It cannot be a child window: with the Windows App SDK in a
  window, no mouse message for a child of it reaches the UI thread (`ARDIA_INPUT_TRACE=<file>` logs what does). A window
  Chromium opens by itself (a link opened in a new window) stays off screen until the app adopts its tabs.
- The verbs: `tab.create` (a key, a profile, a URL or a tab to adopt; the same key again moves the tab to the window
  that asks), `tab.show` (visible, and where in the window, in the UI's points; a corner radius and holes),
  `tab.close`, `tab.call` (load, back, forward, reload, stop, find, zoom, scripts, DevTools, print, site info and the
  rest of the Mac tab's methods, `tab_calls.cc`), `tab.discard`, `tabs.list`, `host.info`, `app.quit`. Events come as
  the topic `tab` with a key, a name and data (navigation, progress, favicon, find, zoom, security, media, pagePress,
  windowClose and more), and `tab.opened` for a tab Chromium made itself, with who opened it.
- The `ac_*` calls of `engine/chromium` build on Windows from the same sources: `series_win.py` makes the Windows
  build file from the Mac one, applies `ardia-layer-win.patch` (paths from UTF-8, a Mac-only string) and swaps in
  Windows stand-ins for the two POSIX-only files (the `ardia` command's control file and the user scripts policy, both
  off). `engineCall` loads the profile the app names and calls the export by name. `engine/` is not touched.
- In the app (`packages/expo-windows/src/engine`): `ArdiaWebView` is a view in TypeScript. It opens its tab on mount,
  measures itself and shows the page there, turns the engine's events into page events and parks or closes the tab on
  unmount as `ArdiaTabs` asks. The domain modules (`domains/`) answer `call` as the Mac's Swift tables do, on top of
  `engineCall`; `windowsEngineCalls.test.mjs` fails when a forwarded verb differs from the Mac's.
- The page is a window above the UI, so the UI cannot draw over it. Every shadowed surface (the command bar, popovers,
  the find bar, dialogs, toasts, the downloads bubble) reports its rectangle (`usePageCover`), and the page window gets
  a hole there, with the surface's corners. A translucent surface shows the card behind it in the hole, not the page.
  The page window has no system backdrop: Chromium asks for Mica on its top-level windows, and Windows paints that
  into the holes. A press in the page counts
  as a press outside every popover of its window.
- A second launch reaches the running app: Chromium's process singleton hands it the command line, and
  `chromium-win-relaunch-to-app.patch` gives that to `//ardia/win`, which sends the topic `relaunch` with the web and
  file addresses on it. The app treats them as links from another app (`onOpenURLs`: a Little Ardia window or a tab,
  as Settings says) and a launch with none as `reopen` (the last window comes forward).
- A page that goes full screen takes its window full screen (`setPageFullScreen`, which puts the window back as it
  was when the page leaves), and nothing is cut out of the page while it is.
- A tab restored from the last session, or duplicated, loads its address: the Windows engine keeps no saved page
  state yet, so only tabs the engine itself offered are adopted.
- Chromium's own UI still shows where the app has none on Windows yet: the page's right-click menu, JavaScript
  dialogs, the status bubble for a hovered link, and popup windows a page opens.
- CI takes its engine from a GitHub release: `scripts/windows/engine/prebuilt.json` names the release and each
  CPU's zip with its SHA-256, `fetch-engine.ps1` downloads and checks it, and the Windows workflow assembles the app
  with it, launches it with the self-check (which then loads a page through the engine) and runs the tour's pages
  part. The release is a draft, so only the repository's own runs can fetch it; a fork's pull request skips those
  steps. A new engine build is a new release and a new `prebuilt.json`.
- `//ardia/win:probe` is a library that stands in for the app: a plain window that opens two tabs, switches, navigates
  and asks the engine for history, bookmarks and the downloads folder, logging every reply and event. It proves an
  engine build with no app.

## Updates

- The Windows alpha is the GitHub prerelease `windows-alpha`: `Ardia-Setup-x64.exe`, `Ardia-Setup-arm64.exe`, the
  feed `windows-update.json` (version, build, and per CPU the installer's address, SHA-256 and size) and the
  engine's source. `scripts/windows/publish-alpha.sh <run id>` publishes one green Windows workflow run there; the
  feed goes up last.
- A build knows what it is from `Ardia.build.json` beside `Ardia.exe` (`assemble.ps1 -Build`, the workflow's run
  number). Only an installed build with that file updates: Settings › General › Updates shows "not set up" for a
  folder build.
- `packages/expo-windows/src/updater` is the app's `ArdiaUpdater` on Windows. It reads the feed, offers a higher
  build for this CPU, downloads it, and asks before installing; with automatic downloads on it downloads first and
  asks once. It checks 30 s after launch and every 6 hours, never in a hidden instance, and in an instance with its
  own data folder only when `ARDIA_INSTANCE=updateFeed=<url>` names a feed (then installers must sit beside it).
- The native half (`UpdateModule.h`, `ArdiaWindowsUpdate`) only fetches from the release's address, checks the
  download's size and SHA-256 against the feed, and runs the installer from the Updates folder in the data folder
  after hashing it again while holding it open. The installer runs silently, closes what is left of the app and
  opens it again (`/relaunch=1`). Nothing is signed yet, so what stands behind an update is GitHub's HTTPS and the
  release's write access.

## Checks

- To build the app on a PC you need Visual Studio 2022 with the C++ desktop workload and the Windows SDK
  **10.0.26100.0**, the version `Ardia.vcxproj` names; with another SDK the build stops before compiling. The
  GitHub runners have it. Then `pnpm install` and, in `apps/browser`,
  `npx react-native run-windows --release --arch x64 --no-launch --no-deploy --no-packager`.
- `.github/workflows/windows.yml` builds the x64 app on a Windows runner and runs `scripts/windows/launch-smoke.ps1`,
  which launches it three times and uploads each launch's log: a first launch (onboarding) and a launch with
  onboarding done (the browser window), each with a screenshot when the runner allows a capture, then a hidden
  self-check launch.
- With the browser window open, the x64 run also drives the app with real input and fails when the default layout
  marks no caption region; a drag by the gap beside the window buttons is not Windows' own move or does not move the
  window by the dragged distance; dragging it to the top edge does not maximize the window or dragging back down does
  not restore its size; a double click there does not maximize or restore it; the app's maximize, restore or minimize
  button does not do so; a drag of the toolbar's empty middle is not the app's own move; Ctrl+T matches no command; the sidebar button does not take its click; or the pointer just outside the
  window's left edge does not bring the hidden sidebar's edge over and away. The ARM runner's desktop is covered by
  Windows' own first-run screen, so its screenshots show that screen and it skips the input.
- Both runs then write the library's WinRT list into a copy of `Ardia.exe` with `scripts/windows/host-manifest.ps1`
  and read it back, so the script the engine's launcher depends on is exercised on every build.
- `scripts/windows/tour.ps1` drives a full screenshot tour and writes `tour.md`, one line per stop with the facts it
  read. Among them: Downloads and Search Tabs must close on Escape (the caption regions go away while one is open and
  come back, and for Downloads the log shows the native Escape capture taking the key), and Little Ardia's command
  panel must be drawn whole below its field, with the window buttons on the bare bar (screen brightness where the
  panel used to be cut off, and under the buttons).
- The self-check (`--self-check`, only in an instance with its own `ARDIA_DATA_DIR`) runs
  `packages/expo-windows/src/selfCheck`: each area exercises its native code from inside the real app, and the
  launch fails if any check does. A new native method gets a check there. It also renders every view drawn in JS
  in the window (`selfCheck/stage.tsx`), writes `config.json` and waits for the watcher's `onChange`
  (`ARDIA_CONFIG_DIR` points the config folder at the data folder for that), and moves a file to the Recycle Bin.
- `platform/windowsModules.test.mjs` fails when the app imports something from `expo-modules-core` that
  `packages/expo-windows` doesn't export.
- Nobody can compile Windows code on the Mac: CI is the compiler. The Windows VM on shiv covers behaviour by hand,
  with an ARM64 build. Speed numbers and the x64 build need real hardware before a release.

## Speed targets

The Mac's numbers are the targets for Windows, measured from the first engine build on. These are 0.2.45's, from
`docs/perf/0.2.44-to-0.2.45.md`; use the latest release's when measuring.

| Measure | Mac |
| --- | --- |
| Launch to window shown | 451 ms |
| Tab switch to shown | 9 ms |
| New tab to first paint | 78 ms |

## Order of work

1. The app shell: the UI in native windows, with the app-side native modules and views. Done in #1112, except what
   the log still lists.
2. Chromium for Windows with our patches, hosted in the app: pages load in tabs. Done (The engine in the app).
3. What the Mac's native layer does that Windows still leaves to Chromium's own UI or lacks: the page's context menu,
   permission, password and autofill prompts drawn by the app, popup windows in the app's own frame, picture in
   picture, the page script, full screen video inside the app's window, session restore of a tab's history.
4. The Windows versions of the Mac-specific engine patches.
5. C++ versions of what is still drawn flat or missing: shaders with Direct3D, import
   from Edge and Chrome, dragging files out of the app, swipe gestures.
6. An installer exists (`scripts/windows/make-installer.ps1`, Inno Setup, per user, no admin prompt; CI builds
   `Ardia-Setup-<cpu>.exe` and installs and uninstalls it), and the app updates itself from the Windows alpha
   (Updates, below). Left: signing both.
