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
- The command panel opens in place on Windows instead of growing out of its field
  (`PLATFORM_FEATURES.panelGrowsFromField`): React Native for Windows scales a view around its top-left corner, not
  its centre, so the grow's first frame landed 68 points left of Little Ardia's field and above the window, and the
  panel stayed there, cut off 24 points down. While the panel sits beside the window buttons it keeps their 138
  points free at the right (`trailingClearance` in `lib/windowChrome.ts`). Little Ardia's bar numbers for both
  systems are in `components/littleArdia/barLayout.ts`.
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

## Checks

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
- `scripts/windows/tour.ps1` drives a full screenshot tour and writes `tour.md`, one line per stop with the facts it
  read. Among them: Downloads and Search Tabs must close on Escape (the caption regions go away while one is open and
  come back, and for Downloads the log shows the native Escape capture taking the key), and Little Ardia's command
  panel must be drawn whole below its field, with the window buttons on the bare bar (screen brightness where the
  panel used to be cut off, and under the buttons).
- The self-check (`--self-check`, only in an instance with its own `ARDIA_DATA_DIR`) runs
  `packages/expo-windows/src/selfCheck`: each area exercises its native code from inside the real app, and the
  launch fails if any check does. A new native method gets a check there.
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
2. Chromium for Windows with the patches that apply as they are, then the first window with a real tab.
3. ArdiaCore: split into a shared core (`.cc`) and platform files (`_mac.mm`, `_win.cc`), then write the Windows files.
4. The Windows versions of the Mac-specific engine patches.
5. C++ versions of what is still drawn flat or missing: shaders with Direct3D, import
   from Edge and Chrome, dragging files out of the app, swipe gestures.
6. Windows behaviour: Ctrl shortcuts, window controls on the right.
7. A signed installer and updates with WinSparkle on the existing appcast, as a nightly first.
