# Ardia on Windows

Windows comes before Linux, and both share one `main` with the Mac: no fork and no Windows branch. This file is
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
  - a module that has a C++ version answers from it (a React Native turbo module of the same name);
  - a module without one answers from `src/defaults.ts`, or with `null`, and logs each call's name once. Its
    documents live in memory, so nothing is saved between launches yet;
  - a view without one renders as a plain view (`FadeLabel` as text), and logs its name once.

  So each module and view gets its Windows version on its own. The log, and `ardiaWindowsMissing()` in the JS
  console, list what the app has reached so far that has no Windows version, not everything left to port.
- Native modules are C++ in `apps/browser/windows/Ardia`, one per header, named as on the Mac (`ArdiaApp` in
  `AppModule.h`). Events reach JS as the device event `<Module>:<event>`.
- The Windows native API has its own version: `WINDOWS_NATIVE_API_VERSION` in `platform/nativeApi.ts` and
  `windowsApiVersion` in `AppModule.h`. Bump both when the Windows native surface changes. A Mac bump doesn't
  touch it.
- `--log-file=<path>` makes the app write its launch log, React Native's log and JavaScript errors to a file.

## Checks

- `.github/workflows/windows.yml` builds the x64 app on a Windows runner, launches it
  (`scripts/windows/launch-smoke.ps1`), and uploads the launch log, a screenshot and the built app.
- `platform/windowsModules.test.mjs` fails when the app imports something from `expo-modules-core` that
  `packages/expo-windows` doesn't export.
- The Windows VM on shiv covers behaviour. Speed numbers and the x64 build need real hardware before a release.

## Speed targets

The Mac's numbers are the targets for Windows, measured from the first engine build on. These are 0.2.45's, from
`docs/perf/0.2.44-to-0.2.45.md`; use the latest release's when measuring.

| Measure | Mac |
| --- | --- |
| Launch to window shown | 451 ms |
| Tab switch to shown | 9 ms |
| New tab to first paint | 78 ms |

## Order of work

1. The app shell: the UI in a native window, with defaults for every native module. Done in #1112.
2. Chromium for Windows with the patches that apply as they are, then the first window with a real tab.
3. ArdiaCore: split into a shared core (`.cc`) and platform files (`_mac.mm`, `_win.cc`), then write the Windows files.
4. The Windows versions of the Mac-specific engine patches.
5. C++ versions of the native modules and views (glass with Mica and Acrylic, shaders with Direct3D, secrets with
   Credential Manager, import from Edge and Chrome).
6. Windows behaviour: Ctrl shortcuts, window controls on the right.
7. A signed installer and updates with WinSparkle on the existing appcast, as a nightly first.
