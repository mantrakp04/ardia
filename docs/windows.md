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
    (`src/views`, `src/symbol`, `src/windowDragRegion.tsx`), or a plain view that logs its name once.

  The log, and `ardiaWindowsMissing()` in the JS console, list what the app has reached so far that has no Windows
  version, not everything left to port.
- Native code is C++ in `apps/browser/windows/Ardia`, header-only, one module per header, named as on the Mac
  (`ArdiaApp` in `AppModule.h`), all included from `Modules.h`. Events reach JS as the device event
  `<Module>:<event>` (`Events.h`). Folders come from `Paths.h`: data in `%LOCALAPPDATA%\Ardia` or `ARDIA_DATA_DIR`,
  config in `%APPDATA%\Ardia`.
- Windows are the app's own (`WindowManager.h`, `ArdiaAppWindows`): one runtime, one window per window id, each
  mounted with its id, as on the Mac. Browser windows draw into the title bar and keep the system caption buttons.
  A drag region is a view that moves the window when the UI's own hit-testing gives it the press, so a control
  on top of it still clicks; the top 32 points of every window drag the same way where nothing else takes the
  press. The top 32 points of a browser window are either `content` (a pass-through region over the band, so the UI
  gets every press and the app moves the window while the button is down; Escape puts it back, a maximized window
  restores under the pointer and a release at the top edge maximizes) or `caption` (no pass-through, so Windows' own
  title bar region takes the band: its move snaps, drags off a maximized window, double clicks to maximize and right
  clicks for the system menu, and each press still reaches the UI so popovers and the command panel close). The shared
  UI picks the mode per window (`titleBandFree` in `state/windows/layout.ts`, sent through `platform/titleBand.windows.ts`):
  `caption` only when it can prove the band holds no control, which is the default layout (tabs in the sidebar,
  address bar in the toolbar, the toolbar hidden while scrolling, one profile, no downloads in the sidebar header, no
  command panel or onboarding open); the Mac never asks. Drag areas below the band always move through the app, and
  native code detects their double clicks. The launch log says which mode each window's band is in and which path
  each drag took. The caption buttons' size lives in `apps/browser/src/lib/platformChrome.windows.ts` (138 by 32). The app quits when its last window closes: it sends `willQuit`, then quits on the UI's yes or after 3 seconds
  without a reply; a no cancels the quit.
- What has a C++ version: windows, documents, config files and their watcher, secrets (Credential Manager), local
  telemetry, launch config and system info, file actions and icons, launch at login, the theme, lock and sleep
  signals, the clipboard, the bang list, confirm, prompt and file dialogs, the command table with its shortcuts and
  context menus, and icons.
- Shortcuts are the Mac's with Command as Ctrl and Option as Alt, except where Windows has its own convention;
  `CommandTable.h` holds both columns. The JS command catalog still shows the Mac keys in Settings.
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
- With the browser window open, the x64 run also drives the app with real input (a click and typing in the search
  box, Ctrl+T, drags and double clicks of the title band, a drag of the toolbar below it, a click on the sidebar
  button just below it) and fails when the default layout's band is not a caption, a title band drag is not Windows'
  own move or does not move the window by the dragged distance, dragging to the top edge does not maximize it or
  dragging back down does not restore its size, a double click does not maximize or restore it, the toolbar drag is
  not the app's own move, the shortcut matches no command, or the sidebar button does not take its click. The ARM runner's desktop is covered by Windows' own
  first-run screen, so its screenshots show that screen and it skips the input.
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
   from Edge and Chrome, file drops, swipe gestures, Windows notification toasts.
6. Windows behaviour: Ctrl shortcuts, window controls on the right.
7. A signed installer and updates with WinSparkle on the existing appcast, as a nightly first.
