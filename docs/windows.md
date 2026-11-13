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
  - Windows fade as on the Mac (`WindowFade.h`), fade only with no grow. A window opened with `animated`, and every
    window that is not a browser window (Little Ardia, Settings, Import: the Mac's system animates those open),
    stays transparent until its React root has content or for 0.6 s, then fades in over 0.25 s (Little Ardia
    0.20 s); `animateWindowClose` fades it out from where it is over 0.18 s (0.15 s), hides it and then
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
  context menus, the Escape and tab switcher key captures, icons, file and link drops, notifications, and the file, SQLite
  and key primitives behind importing another browser's data (Import from another browser, below).
- File and link drops: each browser window's top-level window and its child windows take OLE drops (`FileDropTarget.h`).
  Every `FileDropArea` reports its frame in the window to native as it mounts, lays out and changes, and again when a
  drag enters the window; native picks the innermost enabled area under the pointer, so the cursor shows copy or no
  drop at once, and reads files (`CF_HDROP`), links (`UniformResourceLocatorW`) and text (`CF_UNICODETEXT`) with the
  Mac's rules for each accept mode (`FileDropItems.h`), `.url` and `.webloc` files included. The area gets the Mac's
  enter, move, exit and drop updates. Dragging a file out of the app is not built yet, so `devLastFileDrag` is empty.
- The app's identity (`AppIcon.h`): at startup the process takes the AppUserModelID `Ardia.Browser`, the one the
  installer's Start menu and desktop shortcuts carry, so the taskbar groups every window under that shortcut, uses its
  icon, and a pin made from a running window relaunches Ardia. Every window the app opens gets Ardia's icon from the
  library's resources (`WM_SETICON`, big and small at the window's DPI), and notifications register with the name
  Ardia and a PNG of that icon written to the data folder. The launch log says `app icon: AppUserModelID is ...`
  (and what it was) and `app icon: set on <id>`. `scripts/windows/launcher-identity.ps1` gives the engine's launcher
  Ardia's icon as its first icon group and Ardia's name in its version strings (Task Manager shows the
  FileDescription); `assemble.ps1` runs it, and `-Check` only reads it back.
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
- "Ctrl+Z reopens closed tabs" works as the Mac's retargeted Undo: with the setting on, the keyboard hook in
  `MenuKeyboard.h` sends `reopenClosedTab` for a plain Ctrl+Z in a browser window (Little Ardia included, Settings and
  Import not) when Reopen isn't disabled, no text field of the app has focus and no page has it. Everything else keeps
  Ctrl+Z: a text field undoes typing, a page gets its own undo. The app's text fields are React Native `TextInput`s
  inside the island, which Win32 focus can't tell apart, so `src/textFocus.ts` wraps React Native's
  `TextInputState.focusInput`/`blurInput` and tells `ArdiaFocus.setTextInputFocused`; a page is a Chromium window on the
  same thread, so the hook reads the focused window's class (`Chrome_*`). The launch log says `ctrl+z reopens the last
  closed tab`, `ctrl+z left to the focused text field` or `ctrl+z left to the focused page`.
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
    The same numbers go to telemetry, where sharing is on, as `animation_bursts` and `animation_long_frames` in the
    hourly `usage_counts` (`platform/motion.windows.ts`, the `ArdiaMotion` module): a rising share of long frames
    per burst is the sign that animations stutter in the field.
  - What this costs and where it is not exact:
    - An animation needs the UI thread: while the engine opens its first page (most of a second) a row's slide
      stalls and then jumps. The Mac's native driver keeps going there.
    - A value that an endless loop animates natively must not be animated any other way afterwards, and nothing
      else may share its view's animated props: React Native refuses to mix the two drivers on one value.
    - While a view is scaled, `measureInWindow` reports it half its size times (1 - scale) further right and down
      than it is drawn, because React Native measures as if the platform turned around the centre by itself. So a
      hole cut for a surface that is growing in sits off by that much until the scale reaches 1 (a popover: under
      a tenth of its size, for 150 ms).
    - A surface that fades in over a page shows the card through its hole for a frame or two first: the hole is
      cut when the surface mounts, before its fade is visible, and the page, being a window above the UI, cannot
      be faded over.
    - React Native for Windows resolves the half-size translate when the transform changes, not when the view's
      size changes: a view that is resized while it holds a scale or rotation keeps turning around its old centre
      until its transform changes again. An animation changes it every frame; a fixed rotation on a view that
      resizes would need its transform set again.
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
- Switching profiles slides the sidebar's pages and crossfades the tint as on the Mac. The Mac's native pager
  (`Pager.swift`) has a TypeScript version in `packages/expo-windows/src/pager`: the `ArdiaSwipe` view and module with
  the same events (`onPagerPosition` every frame, `onPagerState` on select and settle), sequence numbers and spring
  (critically damped, a quarter-second period), stepped on the app's 60 Hz frames. With Windows' animations off it
  lands at once. Swipe gestures (two-finger scroll, the rubber band, haptics) have no input on Windows yet, so only
  clicks, shortcuts and outside switches page.
- Shadows of the views drawn in TypeScript (`Surface`, popover bubbles) are rounded rings drawn behind the fill
  (`src/views/shadowLayers.ts`), fading like a Gaussian blur of the edge: React Native for Windows casts a view's shadow
  from its rectangle whatever its corner radius, which left grey square corners behind the new tab's command bar.
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
  build file from the Mac one, applies `ardia-layer-win.patch` (paths from UTF-8, a Mac-only string, and Windows absolute paths, a drive letter
  or UNC, accepted where the Mac asks for a leading `/`: extension installs, bookmark and password exports) and swaps in
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
  into the holes. While a modal the app shows is open (a confirm, a prompt, a file or folder picker), the page windows its
  window owns are disabled and enabled again when it closes, so a click on the page cannot raise it over the dialog. A press in the page counts
  as a press outside every popover of its window.
- A second launch reaches the running app: Chromium's process singleton hands it the command line, and
  `chromium-win-relaunch-to-app.patch` gives that to `//ardia/win`, which sends the topic `relaunch` with the web and
  file addresses on it. The app treats them as links from another app (`onOpenURLs`: a Little Ardia window or a tab,
  as Settings says) and a launch with none as `reopen` (the last window comes forward).
- A first launch opens the addresses it was started with, which is how a link from another app arrives when Ardia is
  the default browser and isn't running: the engine starts with `--no-startup-window`, so Chromium opens none itself.
  `ArdiaWindowsHost.launchArguments` reads the process's own command line (Chromium's `--single-argument` form, which
  the default browser registration uses, as one argument), and `packages/expo-windows/src/launchLinks` keeps what is an
  address by the relaunch's rule: switches never, http, https and file addresses, a file that exists by its full path,
  an absolute path, a bare host as http; a bare word, `localhost:<port>` and other schemes are refused. They reach the
  app as `onOpenURLs` once it listens (`emitWhenListened` in `events.ts` holds them until then; a relaunch's addresses
  go the same way), after the session has restored, so they open as links from another app do on the Mac. The launch
  log says `launch links: <n> held until the app listens` and `<n> sent to the app`; telemetry counts them as
  `launch_command_line_links` in the hourly `usage_counts`.
- Ardia is a browser Windows knows about once installed: the installer writes the per-user registration Chromium's
  own `ShellUtil` would, unsuffixed (`ArdiaHTM` is Chromium's ProgID for this install mode): the ProgID, whose open
  command is `"<app>\Ardia.exe" --single-argument %1` (the form the first-launch and relaunch paths read as one
  address), `StartMenuInternet\Ardia` with Capabilities for http, https and `.htm .html .shtml .svg .webp .xht .xhtml`,
  `RegisteredApplications\Ardia`, and `OpenWithProgids` entries, all in HKCU, all removed by the uninstaller. The
  installer does it, not the engine: Chromium registers itself only from its own installer or its settings page, and
  Ardia ships neither. `installer-check.ps1` checks every key after install and that none is left after uninstall.
- Windows 10 and 11 don't let an app make itself the default browser. `setAsDefaultBrowser` opens Default apps
  (Ardia's own page, `ms-settings:defaultapps?registeredAppUser=Ardia`, on Windows 11 when this Ardia.exe is the one
  registered; the general page otherwise) and answers false. `isDefaultBrowser` is true when the user's choice for
  http and https is `ArdiaHTM` and that ProgID opens this Ardia.exe. The choice is what the shell resolves
  (`AssocQueryString`), then the registry: Windows 11 builds since 2025 write it to `UserChoiceLatest\ProgId` and
  leave the old `UserChoice` on the previous browser, so reading `UserChoice` alone says Edge after the user chose Ardia;
  `ArdiaSystem.defaultBrowserState` returns the parts. Settings › General reads it again whenever an Ardia window
  becomes active (React Native for Windows' AppState never changes in this app). With `PLATFORM_FEATURES.setsDefaultBrowser`
  off, onboarding's row says "Yes, in Windows Settings", Settings' button says "Choose in Windows Settings…", the
  7-day trial isn't offered (it starts when Ardia becomes the default, which only Windows Settings decides, so the app
  could neither start nor date it), and the one-time offer after onboarding isn't made (it would open Settings at a
  launch nobody asked for).
- A page that goes full screen takes its window full screen (`setPageFullScreen`, which puts the window back as it
  was when the page leaves), and nothing is cut out of the page while it is.
- Split View is off on Windows (`PLATFORM_FEATURES.splitView`): the engine keeps one hosted Chromium window per app
  window and profile and shows one tab in it, so a second pane had no page. Nothing makes a split (the splits slice
  refuses, and a split that comes from the session, an import or a reopened window drops to its panes, which stay as
  ordinary tabs), and its menu items, toolbar and hover buttons, shortcuts, command bar actions, ⌥ clicks and drop
  zones are not offered; a link meant for a pane opens as a tab. The engine needs one hosted window per visible page:
  `tab.show` placing a tab in its own borderless window owned by the app window, several shown at once, each with its
  own bounds, corner radius and holes, and hiding only what the UI hides.
- A tab restored from the last session, or duplicated, loads its address: the Windows engine keeps no saved page
  state yet, so only tabs the engine itself offered are adopted.
- The Windows engine opens every tab on a real `about:blank` and names it as the committed page, where the Mac's tab
  starts on Chrome's initial document. `engine/pageEvents.ts` gives the UI the Mac's events: until a tab commits a
  page of its own, its `navigation` events say `committedInitial`, with no address and no title for that blank page,
  and a navigation that turns into a download reports no committed page. After such a download the engine still
  names the download's address as the visible one (a tab that opened on it) or `about:blank` (a tab that was already
  open), so a `navigation` event that says loading has ended then carries no address either, until the tab is asked
  to load something. So a download started from a new tab, the launch tab included, puts the tab back on the empty
  New Tab (or closes a tab a link opened) instead of leaving a blank page on the download's address, which the
  session then saved and downloaded again at every launch. A tab asked for `about:blank` by address keeps it, and a
  tab the engine opened itself keeps its blank page until a download.
- Chromium's own UI still shows where the app has none on Windows yet: the page's right-click menu, JavaScript
  dialogs, the status bubble for a hovered link, and popup windows a page opens.
- CI takes its engine from a GitHub release: `scripts/windows/engine/prebuilt.json` names the release and each
  CPU's zip with its SHA-256, `fetch-engine.ps1` downloads and checks it, and the Windows workflow assembles the app
  with it, launches it with the self-check (which then loads a page through the engine) and runs the tour's pages
  part. The release is a draft, so only the repository's own runs can fetch it; a fork's pull request skips those
  steps. A new engine build is a new release and a new `prebuilt.json`.
- A tab opened with no address shows a committed `about:blank` until its first load, which replaces that entry, so
  the first real page reports `canGoBack: false` and Back never leads to a blank page (the Mac's "ahead blank" rule).
  `downloadNavigation`'s `committedUrl` is the tab's last committed page, empty while it has only that opening page.
- `//ardia/win:probe` is a library that stands in for the app: a plain window that opens tabs, switches, navigates
  and asks the engine for history, bookmarks and the downloads folder, logging every reply and event. It also loads
  a page into a tab opened blank and goes Back, exports bookmarks to a Windows path, installs extensions from
  drive-letter and UNC paths that don't exist (the error must not be "an absolute path required"), asks for
  extension load health and a search suggestion, and with
  `ARDIA_PROBE_DOWNLOAD_URL` loads a download into a blank tab and a tab with a page. It proves an engine build with
  no app.

## Calls Windows still answers with a stand-in

`forwarded.json` lists, per domain, the Mac's verbs that Windows has no handler for (`missing`). Each falls back to
`defaults.ts` or `null` and logs its name once. What each one needs:

- **Default**: the stand-in is the right answer on Windows, or the verb is a Mac test hook.
- **Native**: C++ in `apps/browser/windows`, no engine build.
- **Engine**: a new or changed `ac_*` call, host verb or `tab.call` method in a Windows engine build.

| Verb | Needs | What and why |
| --- | --- | --- |
| `autofill.settings`, `autofill.setSettings` | Engine | The Mac reads and writes the profile's `autofill.profile_enabled` and `autofill.credit_card_enabled` prefs; no `ac_*` call touches prefs. Today Settings › Autofill shows both toggles on and disabled. |
| Import's cookie batches (no verb) | Engine | `//ardia/win`'s `engineCall` (`api.cc`) copies the arguments into a plain `std::string` that is freed without being wiped, so each `ac_cookies_import` batch the app wipes after the reply leaves one copy in freed engine memory. The Mac passes them with `callWithSecret`; Windows needs the same: a sensitive call that wipes its copy. |
| `autofill.showSuggestions` | Engine | Shows Chromium's autofill popup in a tab: a `tab.call` method. |
| `bookmarks.exportHtml` | Engine (in progress) | The Mac picks a file and calls `ac_bookmarks_export_html`, which refuses Windows paths in the current engine. Then a handler with `ArdiaDialogs`' save dialog. |
| `contentBlocker.state`, `setEnabled`, `setListEnabled`, `isAllowed`, `setAllowed` | Engine | The Mac's blocker is uBlock Origin loaded as a component extension (`loadComponentExtension`, not an `ac_*` call) and driven through its hidden pages. Windows needs that load in the engine and the extension in the Windows package. Today Settings › Privacy shows no blocker. |
| `contentBlocker.devFailNextMessage`, `devDelayNextLoad` | Default | Mac test hooks. |
| `engine.beginTracing`, `endTracing`, `isTracing` | Engine | Chromium's tracing controller for Report a Problem. |
| `engine.systemState` | Native | The Mac's thermal, power and low-power snapshot; Windows has power status and battery saver to report. |
| `engine.cliTabTargets` | Default | The `ardia` command's control is off on Windows (the engine swaps its control file for a stand-in). |
| `extensions.inspectUnpacked` | Native | Reads an unpacked extension's `manifest.json` and icon from the folder picked. |
| `extensions.chooseFolder` | Native, then TypeScript | `ArdiaDialogs.pickFolder` can answer it, but only once `inspectUnpacked` exists and the engine takes Windows paths for `ac_extensions_install`; alone it would show an empty install sheet. |
| `extensions.resolveInstallPrompt` | Engine | Answers the Web Store's install prompt, which the engine doesn't send to the app on Windows yet. |
| `extensions.actionStates`, `extensions.sidePanelUrl` | Engine | An extension's toolbar state and side panel for a tab. |
| `media.displayMediaSources`, `screenRecordingAllowed`, `requestScreenRecording` | Engine | The app's own screen share picker; Chromium's picker shows today. |
| `media.selectDevice`, `cancelDeviceChooser`, `refreshDeviceChooser`, `openBluetoothSettings` | Engine | The Bluetooth, USB, serial and HID choosers drawn by the app; Chromium's own show today. |
| `media.showCastDialog`, `startCasting`, `stopCasting`, `closeCastDialog`, `watchCastRoutes`, `terminateCastRoute` | Engine | Casting. |
| `media.changeCaptureSource`, `media.stopCapture` | Engine | A tab's camera, microphone or screen capture. |
| `media.devShowBluetoothChooser`, `media.devChooserEvents` | Default | Mac test hooks. |
| `passwords.export` | Engine (in progress) | Same Windows path refusal as bookmark export. |
| `passwords.autofillEnabled`, `passwords.setAutofillEnabled` | Engine | The profile's `credentials_enable_service` pref, as for autofill. Today Settings › Passwords' offer-to-save toggle reads off and changes nothing. |
| `permissions.resolve` | Engine | Permission prompts drawn by the app; Chromium's own prompt shows today. |
| `permissions.resolveExternalApp`, `externalAppAllowances`, `removeExternalAppAllowance` | Engine | `ac_external_apps_*` is Mac-only (`ac_external_apps.mm`); Windows needs its own version. |
| `permissions.devExternalLaunches` | Default | Mac test hook. |
| `profiles.loaded` | Engine | The profiles the engine has loaded, plus the `profiles.loaded` event. Today the call fails and the app counts every profile as open, as with lazy loading off. |
| `profiles.release` | Engine | Lets the engine unload a profile when its last tab closes. On Windows every private window of a profile shares Chromium's one off-the-record profile until Ardia quits (the engine ignores the name before `@`), so a new private window still has the last one's cookies. The engine has to make and destroy one off-the-record profile per private name. |
| Profile folder names (no verb) | App | The engine names a profile's folder `Ardia ` plus its id, with lowercase letters, digits and `-` kept and every other byte written `_` and two lowercase hex digits (`profiles.cc`), so each name has its own folder even on a case-insensitive disk and Ardia's own ids (`p-<base36>-<base36>`) keep the folder they always had. `profiles.deleteData` still maps only ids of that shape and refuses the rest; it could map the escape too. |
| `search.setEngineName` | Default | Names the search engine in the app's own page context menu; Windows shows Chromium's menu, which names Chromium's default engine. Needed again once the app draws that menu. |
| `tabs.routeLinkTabs`, `stripCommand`, `strips`, `reportCommits` | Default | The Mac's Chromium tab strip; Windows hosts pages only, so the empty answers are right. |
| `tabs.dev*` (10 verbs) | Default | Mac test hooks. |
| `webView.setDisplayMediaPicker`, `setPeekModifier`, `setSplitLinkModifier`, `setPeekOtherSiteTabs`, `setSelectionPopover`, `setCommandScrollZoom`, `setLittleArdiaOpensNewTabLinks`, `setAutoPictureInPicture` | Engine | Settings for the page script and the Mac's page input hooks, which Windows doesn't have yet. |
| `webView.setVideoUpscaling`, `setVideoUpscalingTestConditions`, `videoUpscalingState` | Native and engine | The Mac upscales with MetalFX; Windows needs a Direct3D path. |
| `windows.list`, `windows.dev` | Default | The Mac's Chromium window hosts. |

`search.suggest`, `search.stopSuggest` and `extensions.loadHealth` are forwarded to the engine
(`ac_search_suggest`, `ac_search_suggest_stop`, `ac_extensions_load_health`) since `windows-engine-20261112-2`. When the
Mac forwards a call the shipped Windows engine lacks, `forwarded.json` lists it under `awaitingEngine` and Windows
answers it in TypeScript until a new engine build has it; none waits now.

Not in `forwarded.json` but also engine work: media next and previous track. The media controls send `mediaCommand`
`next` or `previous` (`state/media/media.ts`), the Windows view passes it on as `tab.call`, and `MediaCommand` in
`tab_calls.cc` runs a page script that has no case for either, so nothing happens. The Mac calls the page's own
`nexttrack` and `previoustrack` handlers through its page script. The engine needs to call
`content::MediaSession::Get(contents)->NextTrack()` and `PreviousTrack()` there, and to send a `nowPlaying` tab event
(title, artist, album, artwork, playback state, position, duration, rate, video or not, and the actions the page set
handlers for, from a `MediaSessionObserver`): Windows sends only `media` (audible, muted), so the app never builds a
session with track actions, and the mini player shows skip by 15 seconds where the Mac shows the track buttons.

Answered in TypeScript on Windows since this list was made: `engine.info` (from `host.info`), `favicons.fetch` (the
icon Chromium stored for that address, from `ac_favicons_get`, asked again after 0.4 and 1.5 s while Chromium writes
it), and `profiles.deleteData`.

Deleting a profile's data: native (`ArdiaEngineHost.removeProfileFolder`) works out Chromium's data folder itself, as
the engine does (`<ARDIA_DATA_DIR>\Chromium` in an instance with its own data folder, `%LOCALAPPDATA%\Ardia\User Data`
otherwise), and acts only where that folder holds `Local State` and agrees with `host.info`'s `userDataDir`. A profile
is deleted by its folder only when its id is one Ardia makes: lowercase `a-z`, `0-9` and `-`, at most 238 characters,
so that `Ardia <id> (removing)` fits one 255-character NTFS name. Its folder is then exactly `Ardia <id>`. Any other id
(hand-edited state, a sync from something else, a bug) could share its folder with another profile, so on purpose
nothing is renamed, removed or cleared for it: the answer says the id isn't one Ardia makes, its data stays, and the
app logs that it couldn't delete it. A name with `@` is a private session to the engine and has no folder; a name with
a NUL is refused, since the engine reads it only up to the NUL. Native renames the folder to `<folder> (removing)` first,
which fails while the engine holds a file in it, so a loaded profile's folder is never half removed: its browsing data
is cleared through `ac_browsing_data_clear` instead and the folder goes at the next launch. A `(removing)` folder left by
an earlier try is cleared first, and while it stays the answer is that files are left, never that the folder is gone.
The original profile's folder is never removed: as on the Mac (`ProfileData.swift`), its browsing data, form data and
site settings, passwords and never-save sites, addresses, cards, running extensions, site settings and zoom levels are
cleared one by one through their `ac_*` calls, and each step that fails is named. The launch log says
`profile folder removed|in use|partly removed: <folder>`.

## Import from another browser

The Mac's `ArdiaImport` (Swift, `packages/import`) has a Windows version in TypeScript, `packages/expo-windows/src/import`,
that answers the same methods with the same result shapes, so the wizard (`components/import`) and
`state/import/apply.ts` are the Mac's. Only the OS calls are native: `ArdiaWindowsImport` (`ImportModule.h`,
`ImportFiles.h`, `ImportSecrets.h`).

- Native primitives: the two data folders (`localAppData`, `roamingAppData`, or `<importSourceDir>\Local` and `\Roaming`
  when `ARDIA_INSTANCE=importSourceDir=<dir>` is set in an instance with its own data folder), `list` a folder,
  `readText` and `readBase64` a file up to a size, and `query` a SQLite file: it is copied with its `-wal` and
  `-journal` to `%TEMP%\ardia-import-<pid>-<random>` (leftovers over an hour old go at the next launch), opened with
  Windows' own `winsqlite3.dll` with ATTACH off, and only statements SQLite calls read-only run. The browsers' secret
  stores (`Cookies`, `cookies.sqlite`, `Login Data`, `Web Data`, `key4.db`, `logins.db`, `logins.json` and their
  `-wal`/`-journal`) are refused to these generic reads under any name Windows resolves to them (any case, a trailing
  dot or space, a stream suffix, a short name: the check also reads the opened file's real name), so their plain-text
  values can't reach JS through them. A sidecar that exists but can't be copied fails the snapshot rather than leaving
  it without the latest writes, and a copy during which the database or its WAL changed (a checkpoint, a write) is
  taken again, up to three times, then reported as in use. `openSnapshot`, `querySnapshot` and `closeSnapshot` keep one snapshot open across
  calls (closed after 10 idle minutes otherwise), so history is read 5,000 rows a page instead of in one reply. A file the browser holds open with no
  sharing (Chrome does this to `Network\Cookies` and others while it runs) answers `inUse`, and that kind fails with
  "Quit <browser> and import again".
- Discovery (`browsers.ts`, `discovery.ts`): Chrome, Edge, Arc, Firefox, Zen, Brave, Vivaldi, Opera, Opera GX, Chromium,
  and the Beta, Dev and Canary (`SxS`) channels of Chrome and Edge and Brave's Beta and Nightly, each from its own folder
  under `%LOCALAPPDATA%` or `%APPDATA%` (Arc from its package's `LocalCache`). Chromium profiles come from `Local State`
  and the `Default` and `Profile *` folders; Firefox and Zen profiles from `profiles.ini` (relative paths only).
- What is read, per profile, with the Mac's readers ported: bookmarks (`Bookmarks`, `AccountBookmarks`; Firefox
  `places.sqlite`), history (`History`; `places.sqlite`), open tabs (the newest cleartext `Sessions\Session_*` or
  `Current Session`; Firefox and Zen `sessionstore-backups\recovery.jsonlz4` and the rest, LZ4 in TypeScript), favicons
  for the imported tabs and bookmarks bar (`Favicons`), a bookmarks HTML file and a passwords CSV file (picked with
  `ArdiaDialogs.pickFiles`).
- Passwords and cookies (Chromium family): the key is `os_crypt.encrypted_key` in `Local State`, unwrapped with DPAPI
  (`CryptUnprotectData`, no prompt: it is the same Windows user), and values are `v10` AES-256-GCM through BCrypt; a value
  with no prefix is tried as plain DPAPI (Chrome before 80). Chrome's app-bound values (`v20`, `app_bound_encrypted_key`)
  need Chrome's elevated service to unwrap, so they are counted and skipped, and the kind warns "N passwords use Google
  Chrome's app-bound encryption, which only Google Chrome can read" (an `undecryptable` warning, as the Mac's). So the
  wizard has no unlock step on Windows (`needsKeychain` is false), and the key is unwrapped the first time a kind needs it.
- Secrets: the key stays native and is wiped by `forgetUnlockedKeys`. Passwords reach JS (`credentials`), as on the Mac,
  because `savePassword` (`ac_passwords_add`) takes them from there. Cookie values never do: native decrypts them
  straight into wiped buffers already in `ac_cookies_import`'s JSON, batches of 500, keeps them for 10 minutes under a
  one-time token, and JS gets the count and the token. `writeImported` sends the batches to the engine one after another
  and wipes each after its reply. A token is dropped after 10 minutes even if nothing asks again, and a vault
  `forgetUnlockedKeys` cleared while a read was running stays empty.
- Not on Windows yet, each offered by no profile so the wizard doesn't show it: autofill (addresses and cards from
  `Web Data`), Firefox and Zen passwords (NSS `key4.db`) and cookies (`cookies.sqlite`, plain text, so they need the
  native vault too), Chromium's encrypted session files (`Sessions_Encrypted`), Arc's and Zen's spaces, pinned tabs and
  favourites (`StorableSidebar.json`, `zen-sessions.jsonlz4`), extensions found in the profile, Safari, Dia's tabs. None
  needs engine work: `ac_cookies_import`, `ac_autofill_import`, `ac_passwords_add`, `ac_history_import` and
  `ac_favicons_set` are all in the Windows engine's call table.
- Tests: `apps/browser/src/state/import/windowsImport.test.mjs` runs the TypeScript against `packages/import/fixtures`
  with a stand-in for the native module (Node's own `node:sqlite`, the same snapshot copy). The self-check's import area
  exercises every native method in the app. Telemetry: `import_runs`, `import_kinds_done`, `import_kinds_failed` and
  `import_secrets_left` in the hourly `usage_counts` (`state/telemetry/importRuns.ts`, every platform): a rising share of
  failed kinds or secrets left on Windows is the sign to look at.

## Updates

- The Windows alpha is the GitHub prerelease `windows-alpha`: `Ardia-Setup-x64.exe`, `Ardia-Setup-arm64.exe`, the
  feed `windows-update.json` (version, build, and per CPU the installer's address, SHA-256 and size) and the
  engine's source. `scripts/windows/publish-alpha.sh <run id>` publishes one green Windows workflow run there; the
  feed goes up last. It keeps the installers of the build before, so an update the app already offered still downloads,
  and removes older ones.
- A build knows what it is from `Ardia.build.json` beside `Ardia.exe` (`assemble.ps1 -Build`, the workflow's run
  number). `ArdiaApp.systemInfo` takes its version and build from that file, since the library has no version
  resource, so telemetry, About and problem reports name the build; a folder build without it says 0.0.0, build 0. Only an installed build with that file updates: Settings › General › Updates shows "not set up" for a
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
  panel used to be cut off, and under the buttons). In Settings › Appearance it clicks the Light tile's picture, found by UI Automation,
  and then Automatic's, and each must change `appearance` in `session.json`.
- The self-check (`--self-check`, only in an instance with its own `ARDIA_DATA_DIR`) runs
  `packages/expo-windows/src/selfCheck`: each area exercises its native code from inside the real app, and the
  launch fails if any check does. A new native method gets a check there. It also renders every view drawn in JS
  in the window (`selfCheck/stage.tsx`), writes `config.json` and waits for the watcher's `onChange`
  (`ARDIA_CONFIG_DIR` points the config folder at the data folder for that), and moves a file to the Recycle Bin.
- The smoke launch fails when the browser window answers `WM_GETICON` with no big or small icon, or the launch log
  does not show the AppUserModelID and the window icon; the installer check fails when the Start menu shortcut lacks
  the AppUserModelID or an icon file, the uninstall entry's icon is not a file, or the installed `Ardia.exe` does not
  carry Ardia's icon and name.
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
5. C++ versions of what is still drawn flat or missing: shaders with Direct3D, dragging files out of the app, swipe
   gestures. Import from another browser is done for bookmarks, history, open tabs, favicons, Chromium passwords and
   cookies, and HTML and CSV files; what is left is listed under Import from another browser.
6. An installer exists (`scripts/windows/make-installer.ps1`, Inno Setup, per user, no admin prompt; CI builds
   `Ardia-Setup-<cpu>.exe` and installs and uninstalls it), and the app updates itself from the Windows alpha
   (Updates, below). Left: signing both.
