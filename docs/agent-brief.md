# Agent brief (read first)

You are one of several engineers working **in parallel in the same working tree** on
Ardia, a macOS browser that must reach **full feature and visual parity with Dia**
(The Browser Company). The feature checklist is `docs/dia-feature-parity.md`; the
visual spec (colors, sizes, animations recovered from Dia's binary) is `docs/dia-spec.md`.
The user is demanding: no sloppy work, every hover state/animation/detail matters.

## Stack
- Turborepo + pnpm (hoisted `node_modules` at the repo root).
- `apps/browser`: Expo SDK 54 + react-native-macos 0.81 (Legacy architecture), zustand store,
  inline styles.
- Native code lives in Expo modules under `packages/*/ios` (Swift / Objective-C++):
  - `packages/ardiacore`: the web engine, **ArdiaCore**: Chrome's own framework (`Chromium Framework.framework`,
    Chromium 155.0.8059.84 + Helium 0.19.4 + our patch series, `docs/engine-build.md`) with our layer linked
    in, and the Expo modules and JS API the app uses (`docs/ardiacore-spike.md`, `docs/ardiacore-parity.md`).
    - **Chromium runs the process.** `main.swift` calls `ArdiaCoreHost.run`: `ChromeMain` starts with our
      `ACMainDelegate`, `NSApp` is Chrome's `BrowserCrApplication`, and the React Native host (`AppDelegate`) starts
      inside Chrome's run loop. Nothing may touch `NSApp` before that.
    - **Every app window is one `ArdiaCoreWindow`** (a Views-backed `NSWindow`, so Chrome's bubbles, dialogs, menus and
      autofill dropdowns attach to it) holding a Chrome `Browser` per profile shown in it, each with no
      `BrowserView`, tab strip or toolbar (`ArdiaCoreChromeWindow.mm`, the `ACChromeWindowHost` packages/shell looks
      up). Paging between profiles changes the active profile; the window stays.
    - Every tab is a real Chrome tab of its window's Browser; its `WebContents` view is hosted in our React Native
      views (`ArdiaCoreWebView`). Popups, `target=_blank` and ⌘-click keep Chrome's own new `WebContents`.
    - Passwords, autofill, extensions, zoom and search engines call Chrome's services directly through our
      own Chromium code, `//chrome/browser/ardia` (`engine/chromium`), exported as plain C
      (`ArdiaCoreEngineBridge`, `ArdiaCoreServices`); ArdiaCore's own layer is `//ardia/core` (`engine/ardiacore`).
      No chrome:// page is scripted.
    - JS API in `packages/ardiacore/src` (`WebView`, downloads, permissions, profiles, extensions, Chrome UI); its
      native modules keep their CEF-era names: `ArdiaCEF` is `packages/ardiacore/ios/CefModule.swift`, and
      `ArdiaExtensions`, `ArdiaSwipe` and `ArdiaChromeUI` are `ExtensionsModule.swift`,
      `SwipeModule.swift` and `ChromeUIModule.swift` there.
  - `packages/shell`: menus, shortcuts, windows, native primitives (Surface, Symbol, FadeLabel,
    VisualEffect, WindowDragRegion, ContextMenuArea, ActivitySpinner…).
  - `packages/shaders`: Metal views (window backdrop, New Tab effects). Don't touch unless assigned.
  - `packages/import`: importing from Chromium browsers, Arc, Dia, Firefox and Safari (bookmarks, history, tabs,
    passwords, cookies, autofill, Arc spaces; extensions are listed to reinstall from the Web Store). Its map is
    `packages/import/README.md`.
  - `packages/core`: pure TS (omnibox parsing, suggestions) with tests.
- react-native-macos quirks: RN shadow props crash → use `Surface` for shadows; RCTView resets
  layer props → draw in sublayers; native views must size subviews in `setFrameSize`.
- **Patched dependencies** live in `patches/` and are listed under `patchedDependencies` in
  `pnpm-workspace.yaml` (pnpm 11 reads them there); every `pnpm install` applies them, and the Podfile
  (`macos`) compiles React from `node_modules`, so a rebuild picks a change up (`pod install`
  only if a patch adds or removes files). To change one: `pnpm patch <pkg>@<version> --edit-dir <scratch dir>`,
  edit there, then `scripts/agent/locked pod -- pnpm patch-commit <scratch dir>`, and read the new `.patch`:
  pnpm can add bogus `deleted file` entries (drop them and run `pnpm install` again under the same lock).
  Mark edits `[Ardia: … Ardia]`. Current patches: `react-native-macos` (a view's `transform` survives
  AppKit layout and applies from its centre; RCTTiming's display link, c7ebd600; a view in a scroll view observes its bounds once, not once per re-add; focus() on a text field being edited keeps its edit, caret and selection; a placeholder change on an empty field being edited isn't a blur; a placeholder colour change on a field being edited reaches its field editor, so it shows once the field is emptied, and its text keeps the field's own colour; a single-line field with pastedTypes pastes only those as plain text, line breaks folded as in Chrome's omnibox, a088913e; a container whose children change leaves the ones already in place alone instead of re-adding every one, 6d7277fd; a mouse touch matches its own down on the same button and is never recorded twice, so JS never gets a null touch, 8bd086c8; mounts go through one queue in layout order, and a live-resize layout, which React Native mounts on the main thread at once, first mounts every older one still queued, so a zoomed window never keeps an older layout and its views track the window during the animation, 2f4aa603) and `expo-modules-core` (the JS
  runtime is prepared on the JS thread only, 364f5f7e).

## The engine
- ArdiaCore is built outside the repo in `~/chromium-build` (the tree and its patches: `engine/patches`,
  `docs/engine-build.md` › "Rebuilding"; `engine/chromium/apply.sh` and `engine/ardiacore/apply.sh` copy our code in).
  The app's build stages a copy of `out/Release_GN_arm64/Chromium Framework.framework`
  (`packages/ardiacore/scripts/stage-framework.sh`: copied and signed once per engine build into
  `apps/browser/build-ardiacore/staged`, then cloned into each build's own derived data, `ARDIACORE_STAGE_DIR`), links it
  and embeds it (`embed.sh`), so every agent's next build picks up a new framework.
- One agent at a time edits or builds `~/chromium-build`: hold the chromium lock for the whole edit → build cycle
  (`scripts/agent/locked chromium --take <you>`, then each command as `scripts/agent/locked chromium --as <you> --
  …`, and `--release <you>` at the end; an unreleased take expires after 60 min, so renew it by running commands
  with `--as`). Builds are incremental only: `scripts/agent/engine-build [--as <you>] [target…]` (default
  `chrome_framework`; `--help`) runs both `apply.sh` and their checks, then autoninja, under the chromium lock; run it
  with `run_in_background`. By hand, after both `apply.sh`:
  `cd ~/chromium-build/chromium_git/chromium/src && PATH=$HOME/chromium-build/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0 ~/Documents/ardia/scripts/agent/locked chromium [--as <you>] -- autoninja -C out/Release_GN_arm64 chrome_framework`.
  `apply.sh` copies the whole working tree, so other agents' uncommitted engine files get compiled too.
  A new framework changes every agent's next build, so say so in your report. To try one privately, build the app with
  `ARDIACORE_FRAMEWORK=<framework> scripts/agent/build-app --as <you>` (it stages into your own derived data).
- New engine code goes in `//chrome/browser/ardia` (`engine/chromium/src`) or `//ardia/core`
  (`engine/ardiacore/src`), never straight into the tree (`docs/engine-build.md` › "Our own code in the tree").
  `engine/patches/series` is the apply order of our patches to Chromium; `engine/patches/series.py check` proves the
  series reproduces the tree. Hooks in Chrome's code are `g_ardia_*` pointers ArdiaCore sets (`ac_seams.mm`). CEF
  left the tree on 2026-10-09: the few of its patches we keep are `chromium-cef-carryover.patch`, and the seams of its
  that ArdiaCore used are our hooks H1–H6 in `engine/ardiacore/apply.sh` (`docs/engine-build.md` › "Our hooks in Chrome's
  code"). Whether a Browser is ArdiaCore's is `WindowHost::ForBrowser`.

### ArdiaCore code map
Engine files are in `engine/ardiacore/src/ardia/core`, app files in `packages/ardiacore/ios`, JS in `apps/browser/src`.

| Concern | Engine | App | JS |
| --- | --- | --- | --- |
| Windows, tab ownership | `ac_browser.h` (`WindowHost`, `ACWebContentsDelegate`, `TabBridge`), `ac_browser_window.mm` | `ArdiaCoreChromeWindow.mm`, `ArdiaCoreTabStrip.mm` | `lib/chromeTabs.ts`, `store/liveTabs.ts` |
| Tab activation | `ardiacore_api.mm` `-activateTab:`, `ac_browser.mm` `ActiveTabChanged` | `ArdiaCoreWebView.mm` `-activate`, `ArdiaCoreTabStrip.mm` | same |
| Focus guard (test instances) | `ac_browser.mm` (`WindowHost` activation) | `ArdiaCoreActivation.mm` (`activation.log`), `ArdiaCoreChromeWindow.mm` | `packages/shell/ios/Windows.swift` |
| Fullscreen | `ac_browser_window.mm` (`ExclusiveAccessContext`), `ac_browser.mm` `FullscreenChanged` | `ArdiaCoreChromeWindow.mm` (acted out in test instances) | `components/ContentCard.tsx`, `components/layout/pageState.ts` |
| Picture in Picture | `ac_picture_in_picture.mm`; Dia's window and controls in `engine/chromium/…/ardia/pip/`; the auto-PiP hook in `engine/ardiacore/apply.sh` | `ArdiaCorePictureInPicture.mm` | `components/media/pip.ts` |
| Password and autofill bubbles | `ac_password_prompt.mm`, `ac_browser_window.h` (`ACAutofillBubbleHandler`), `ac_autofill_trigger.mm` (dropdown) | `ArdiaCoreChromeWindow.mm` (`window:passwordPrompt:forTab:`) → `ArdiaCoreWebView` event | `components/site/Prompts.tsx`, `site/Autofill.tsx` |
| Share tab, screen share | `ardiacore_api.mm` (`TabSharingDelegateFor`), `ac_desktop_capture.mm` | `ArdiaCoreHost.mm` `shareTabInstead`, `ChromeUIModule.swift` | `components/media/ShareBar.tsx`, `SharePicker.tsx` |
| Restore, discard | `engine/chromium/…/ac_tab_restore.cc` (closed tabs) | `ArdiaCoreWebView.mm` (`discard:`, `transferKey`) | `lib/tabLifecycle.ts`, `store/windows.ts` |
| Permissions | `ac_permissions.mm` | `ArdiaCoreHost.mm` (`permissionRequest`) | `components/site/permissions.ts`, `Prompts.tsx` |
| Page script | `ac_page_channel.mm`, `renderer/ac_content_renderer_client.cc` | `page_script.js`, `ArdiaCoreWebView.mm` | `onPageMessage` (`packages/ardiacore/src/WebView.tsx`) |

- **Call path:** JS (`packages/ardiacore/src`) → `*Module.swift` → `ArdiaCoreHost` / `ArdiaCoreWebView` → `public/ArdiaCore.h` →
  `ardiacore_api.mm` → `ac_*.mm`. Events come back through an `ArdiaCore*Delegate` method, `-emit:payload:`, and the event
  switch in `CefModule.swift`.
- **Adding to `ArdiaCore.h`:** implement it in `ardiacore_api.mm` (a new file goes in `BUILD.gn` `sources`); a new class
  must be named `ArdiaCore*` to be exported (the `ardiacore.exports` wildcard). The pod reads `ArdiaCore.h` from the repo and
  the staged framework may be older, so the app guards new selectors with `respondsToSelector:`.
- **Adding an engine call** (Chrome's services are `ac_*` C calls in `engine/chromium`, which the app finds with
  dlsym through `ArdiaCoreEngineBridge`): (1) write `AC_ENGINE_CALL(ac_<domain>_<verb>)` in
  `engine/chromium/src/chrome/browser/ardia/ac_<domain>.cc` (conventions in `public/ac_engine.h`; a new file goes
  in that `BUILD.gn`; `ac_engine.exports` exports every `ac_*`); (2) `scripts/agent/engine-build`; (3) call it with
  `ArdiaCoreEngineBridge call:` (`callWithSecret:` for secrets), guarded by `exports:`; for JS's `engineCall`, add it to
  `ArdiaCoreEngineCalls.swift`.
- **The page script** is `packages/ardiacore/ios/page_script.js`, a pod resource: `ArdiaCoreHost.mm` hands it to the
  engine at launch and the renderer runs it in every http(s) and file frame. Changing it needs an app rebuild, not an
  engine one. Its `post(kind, json)` crosses the page channel to `-[ArdiaCoreWebView tab:didReceivePageMessage:…]`,
  which handles it or emits `pageMessage` (JS `onPageMessage`).
- **CEF-era code** (removed in 6bdf66ce): `git show 6bdf66ce^:packages/cef/ios/<file>`. Comments citing
  `packages/cef/…` mean: `ACBrowserView.mm`, `ACClient.mm` → `ArdiaCoreWebView.mm`; `ACChromeWindow.mm`,
  `ACPopupWindow.mm` → `ArdiaCoreChromeWindow.mm`; `ACActivation`, `ACTabStrip`, `ACPictureInPicture`,
  `ACContentBlocker`, `ACEngineBridge` → `ArdiaCore<same>.mm`; `ACPasswords`, `ACAutofill`, `ACZoom` →
  `ArdiaCoreServices.mm`; `ACExtensions.mm` → `ExtensionsModule.swift`; `ACCef.mm` → `ArdiaCoreHost.mm`,
  `ArdiaCoreStartup.mm`; `ACEngine.mm` → `ardiacore_api.mm`; `helper/page_script.js` → `packages/ardiacore/ios/`;
  `packages/cef/src` → `packages/ardiacore/src`.

## Rules
- **Stay inside the files you own** (listed in your task). If you need a change elsewhere,
  make the smallest possible change, or describe it in your report instead. Other agents
  are editing other files right now; never revert or reformat code you don't own. Never run
  `git checkout -- <file>`, `git restore`, `git stash` or `git reset --hard` in this checkout: they wipe other
  agents' uncommitted work in the same file. Undo your own hunks by editing.
- **Commit your own work to `main`** (`git add -p` or explicit paths, only your hunks). Never commit another
  agent's work in progress. The index is shared, so a plain `git commit` sweeps in what others staged: commit
  with `git commit --only -- <paths>` (or check `git diff --cached --stat` lists only your files).
- **Never steal focus from the user.** They are working in other apps.
  - Launch the app only with `open -g` (never plain `open`, never `activate`) **and** with
    `ARDIA_BACKGROUND=1`: `open -g` alone does not stop LaunchServices from making the app
    frontmost once its windows appear (this stole the user's keystrokes). With it the process is
    BackgroundOnly and every activation path is guarded (`packages/ardiacore/ios/ArdiaCoreActivation.mm`); each
    attempt is logged to `$ARDIA_DATA_DIR/activation.log`. `lsappinfo front` must never show
    your pid. Its windows never come up over the owner's: every window (Chrome's bubbles and popups, panels, PiP,
    Little Ardia, sheets) has its level set a band below normal (normal at layer -1000000, floating at -999997), so
    it sits behind every other app's window, above the desktop, in production's order among its own and out of Mission
    Control (same file, "Behind the owner's windows"; `-level` still answers the level asked for).
  - Any standalone test program or prototype window you create must be unable to take focus
    (NSApplicationActivationPolicyProhibited/accessory, non-activating panels).
  - Never give an extension shortcut Global scope in a test instance. Chrome registers it as a system-wide hotkey,
    so it swallows that key in the owner's other apps for as long as the instance runs.
  - Don't use computer-use / screen-control tools on the user's apps. Never click or type in
    Dia (it's a read-only reference). Don't read Dia's user data
    (`~/Library/Application Support/Dia`), nor any other browser's real profile data;
    use fixtures you create. Dia's app bundle (binary, assets) may be read.
- **Isolated builds/instances** (several agents build and run at once). Use your agent name `<you>`:
  - Build (with `run_in_background`): `scripts/agent/build-app --as <you>` (`--config Release`, `--force`; `--help`).
    It builds into `apps/browser/build-<you>`, in parallel with other agents' builds, and prints only the errors,
    the warnings count, the result and the .app path (full log in `build-<you>/build-app.log`). Keep your name: a
    new derived data compiles everything (a few minutes), and a copy of someone else's does too (its paths differ).
    A JS-only change needs no build: it says so and stops (`--force` builds). A new engine framework is staged
    under the chromium lock: `--release` your chromium take first, or it uses your take (`--as`).
    `/tmp/ac-<name>.holder` says who holds a lock. Every `scripts/agent` script takes `--help`.
    When the main session runs the build train (`scripts/agent/train serve`: one shared build of the tree), don't
    build yourself: `train request --as <you>`, then `train wait --as <you>` prints the app to run.
  - Run: `scripts/agent/ac launch apps/browser/build-<you>/Build/Products/Debug/Ardia.app --data <scratch>/data`
    (hidden: `open -g -n`, `ARDIA_BACKGROUND=1`, its own data dir and DevTools port; prints the pid and port).
    `ac eval|page|quit|status` take that data dir (`--help`); scripts use `scripts/lib/instance.mjs` (`launch`,
    `attach`, `session`, `reporter`), whose pid is the DevTools port's listener, never a process-list diff
    (`ARDIA_DATA_DIR` isolates Chrome's and the app's data; a Debug build refuses to start without one).
    Quit only your own instance (`ac quit`), never `pkill Ardia`.
  - Open a URL in your instance: CDP `Target.createTarget`, or the dev harness
    (`ac.actions.openUrls([url])`); `open -a` routes to whichever instance macOS picks.
  - Metro (JS dev server) is already running on :8081 and serves this working tree to every
    instance. Don't start another one and don't kill it. Consequences:
    - Every instance runs everyone's current JS, including instances built before your native
      change. JS doesn't guard for older builds: when JS starts needing native code that older builds
      lack (a module, function, view, event or field), bump `NATIVE_API_VERSION`
      (`apps/browser/src/nativeApi.tsx`) and `apiVersion` (`packages/shell/ios/AppModule.swift`)
      together. An instance built before then shows "Native API skew" in one window instead of the
      app, and its dev harness answers every script with that error: rebuild it.
    - A JS exception while modules load (an import cycle, say) opens LogBox, which crashes
      react-native-macos (`RCTView didUpdateShadow`), so every instance dies at launch. Run
      `pnpm -w typecheck` and relaunch your instance after risky import changes.
    - Fast Refresh doesn't always apply (and has crashed Hermes' debugger). Relaunch your instance
      before judging a change.
  - `pod install` (after adding/removing native source files, changing a podspec, or adding native
    packages) must hold the shared lock: `scripts/agent/locked pod -- sh -c 'cd apps/browser/macos &&
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install'`.
    Same lock for `pnpm install` and edits to apps/browser/package.json. A new Expo module in an
    existing source file only needs its `expo-module.config.json` entry (the build regenerates
    the module provider).
- **Shared files** several agents must touch — `packages/shell/ios/Menus.swift`,
  `apps/browser/src/lib/commands.ts`, `apps/browser/src/App.tsx`, `apps/browser/src/store/settings.ts`,
  `apps/browser/src/lib/theme.ts`, `packages/ardiacore/ios/ArdiaCoreInternal.h`, `packages/ardiacore/ios/ArdiaCore.podspec`,
  `packages/ardiacore/ios/ArdiaCoreWebView.mm`, `packages/ardiacore/scripts/acceptance.mjs`, ArdiaCore's `public/ArdiaCore.h`,
  `ardiacore_api.mm` and `ac_browser*.mm`, the `expo-module.config.json` files: re-read right before each edit, keep
  edits small and additive (add your case/item/field; don't restructure), and never undo someone else's lines.
  Native files there compile into everyone's build: check one pod with `scripts/agent/typecheck-pod <Pod>` before saving more.
- **Scratch files** go in a subdirectory of the session scratchpad named for your task; clean up only that
  subdirectory, never with globs in the shared root (other agents' files live there).
- The store API is documented in `docs/store-api.md` (read it before touching app state).
- Tests, test-instance variables and what background mode changes: `docs/testing.md`. Benchmarks and the perf gate:
  `docs/perf/README.md`.
- The Bash tool runs zsh: quote globs (`--include='*.mm'`, `'/tmp/ac-*.holder'`) or use `git grep -n PAT -- '*.mm'`.
- **Verify before reporting done.** At minimum: `pnpm -w typecheck` (or `npx tsc -p <pkg>`)
  passes for what you touched, the app builds, and you exercised the feature in a running
  instance.
  - Drive the app through the dev harness: `scripts/agent/ac eval <data dir> '<body>'` (a function body that
    returns a value or promise; it fails at once if the instance died). `ac` = store, actions, runCommand, webviews, shell, …
    (`lib/devHarness.ts`); Expo modules are on `globalThis.expo.modules`. `ac.runCommand` takes an object:
    `ac.runCommand({ command: "importBrowserData", arg: null, windowId: null })`; the utility windows' ids are
    `"settings"` and `"import"`.
  - The ArdiaCore acceptance run (`docs/ardiacore-parity.md` › "How to build and check it"): `node
    packages/ardiacore/scripts/acceptance.mjs <Debug app> <scratch dir> --keep [check…]` once, then `--attach <scratch
    dir> [check…]` for each try (no boot: seconds). `--list` names every check and what it needs; each check prints
    one line, the details go to `<scratch dir>/data/acceptance.log`.
  - Camera and microphone: a hidden instance captures only from Chrome's fake devices (`docs/testing.md`). Run
    capture tests on a copy without the device entitlements (ad hoc, hardened runtime), so macOS refuses a real
    device without asking (acceptance.mjs's media checks make one): on 2026-10-01 a Debug build's microphone stream
    raised macOS's consent dialog on the owner's screen.
  - Keyboard shortcuts: `ac.shell.devKeyEquivalent(windowId, { key, keyCode, modifiers, focus, asKey })` presses a
    key as AppKit dispatches it (Chrome's window, then the menu bar), `ac.shell.devTypeKeys("key", text, ms)` types
    into whatever window is key, and
    `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` checks every shortcut in every focus.
  - Page content: `scripts/agent/ac page <data dir> <url part> '<expression>'`, or CDP on the instance's port
    (`http://localhost:<port>/json`, `Runtime.evaluate`, `Page.captureScreenshot`). A `ARDIA_BACKGROUND` instance's windows answer NO to
    `-[NSWindow isOccluded]` (`ArdiaCoreHost.mm`), so a covered window shows a tab at once instead of after Chrome's 1 s
    occlusion delay; set `ARDIA_ALLOW_OCCLUSION=1` to test occlusion itself.
  - CDP (`ARDIA_REMOTE_DEBUGGING_PORT`), argv and `ARDIA_CHROMIUM_SWITCHES` only reach Chrome where it runs on its mock
    keychain: a scratch `ARDIA_DATA_DIR`, or a build without a team signature (ad hoc copies such as carryover.sh's). A
    team-signed build on its real data dir forwards none of them (`ArdiaCoreHost.mm`), and its browser process removes
    every switch that opens the profile to outside control (remote debugging, unpacked extensions, automation, proxies,
    certificate overrides, net-log), also after chrome://flags have been applied, and unsets `SSLKEYLOGFILE`
    (`ac_main_delegate.cc`), so nothing drives or records the real profile, with its real Safe Storage key; Chrome 136
    did the same for its default profile.
  - Native UI: `screencapture -l <windowID> -o` (find the id with CGWindowList by owner PID; a test window's layer is negative). It captures the
    window's own content even while the owner's windows cover it, which a test window's always may. Wrap every capture in `timeout 20`: with the screen locked they can hang instead of failing.
    For the New Tab intro, launch with `ARDIA_SHADERS_FORCE_KEY=1` (it only plays in a key window).
  - The user's screen may be locked: screen captures then fail or deliver no frames. Fall back to
    `ac.shell.devSnapshotWindow(windowId, path)` (`false` means it failed; the window's layers at 2x; Metal views
    render blank; text opacity is applied twice, so a label at α reads 1 − (1 − α)², don't match colours on it),
    `globalThis.expo.modules.ArdiaAreaLight.debugSnapshot(dir)` (every Metal view, offscreen, with its frame),
    the accessibility tree and store state, and list "needs visual check" items in your report.
- Code style: read the surrounding code first and match its naming and idioms. No comments (AGENTS.md).
  Keep files cohesive; new features go in new files where sensible.
- Dia fidelity: when you build UI, match Dia, and check it with numbers against a Dia capture
  (same crop, same state) before calling it a match (`docs/dia-spec.md`, `docs/dia-feature-parity.md`).

## Report format (your final message)
1. What you built (bullets, user-visible terms first).
2. Files created/changed.
3. How you verified it (commands + results).
4. Anything unfinished, known bugs, or changes you need from other areas (pod install,
   files owned by others, integration points, a new engine framework).
