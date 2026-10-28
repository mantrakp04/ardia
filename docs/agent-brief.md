# Agent brief (read first)

You are one of several engineers working **in parallel in the same working tree** on
Ardia, a macOS browser that must reach **full feature and visual parity with Dia**
(The Browser Company). The feature checklist is `docs/dia-feature-parity.md`; the
visual spec (colors, sizes, animations recovered from Dia's binary) is `docs/dia-spec.md`.
The user is demanding: no sloppy work, every hover state/animation/detail matters.
How the code is laid out and named (folders, import direction, tokens, state, the translation layer, environment
variables) is in `docs/conventions.md`, enforced by `apps/browser/src/conventions.test.mjs`.

## Stack
- Turborepo + pnpm (hoisted `node_modules` at the repo root).
- `apps/browser`: Expo SDK 54 + react-native-macos 0.81 (Legacy architecture), zustand store,
  inline styles.
- Native code lives in Expo modules under `packages/*/ios` (Swift / Objective-C++):
  - `packages/ardiacore`: the web engine, **ArdiaCore**: Chrome's own framework (`Chromium Framework.framework`,
    Chromium 156.0.8078.47 + Helium 0.20.1 + our patch series, `docs/engine-build.md`) with our layer linked
    in, and the Expo modules and JS API the app uses (`docs/ardiacore-spike.md`, `docs/ardiacore-parity.md`).
    - **Chromium runs the process.** `main.swift` calls `ArdiaHost.run`: `ChromeMain` starts with our
      `ACMainDelegate`, `NSApp` is Chrome's `BrowserCrApplication`, and the React Native host (`AppDelegate`) starts
      inside Chrome's run loop. Nothing may touch `NSApp` before that.
    - **Every app window is one `ArdiaCoreWindow`** (a Views-backed `NSWindow`, so Chrome's bubbles, dialogs, menus and
      autofill dropdowns attach to it) holding a Chrome `Browser` per profile shown in it, each with no
      `BrowserView`, tab strip or toolbar (`ArdiaChromeWindowHost.mm`, which packages/shell's
      `ChromeWindows.swift` calls through the ArdiaCore pod). Paging between profiles changes the active profile; the window stays.
    - Every tab is a real Chrome tab of its window's Browser; its `WebContents` view is hosted in our React Native
      views (`ArdiaWebView`). Popups, `target=_blank` and ⌘-click keep Chrome's own new `WebContents`.
    - Passwords, autofill, extensions, zoom and search engines call Chrome's services directly through our
      own Chromium code, `//chrome/browser/ardia` (`engine/chromium`), exported as plain C
      (`ArdiaEngineBridge`, `ArdiaServices`); ArdiaCore's own layer is `//ardia/core` (`engine/ardiacore`).
      No chrome:// page is scripted.
    - JS API in `packages/ardiacore/src`: `engine.call("domain.verb", args)` and `on("domain.event", …)`, typed from
      `src/engine/api.ts`, plus the views (`WebView`, `SwipeArea`). Each domain is one Expo module, `Ardia<Domain>` in
      `packages/ardiacore/ios/<Domain>Module.swift` (Engine, WebView, Tabs, Windows, Downloads, Permissions, Profiles,
      Sites, Passwords, Autofill, Extensions, Search, Media, ContentBlocker, History, Bookmarks, Favicons, Swipe,
      WebKit); test scripts reach it through the dev harness's `ac.engine.call` / `ac.engine.on`.
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
| Windows, tab ownership | `ac_browser.h` (`WindowHost` in `ac_window_host*.mm`, `ACWebContentsDelegate` in `ac_web_contents_delegate.mm`, `TabBridge` in `ac_tab_bridge*.mm`), `ac_browser_window*.mm` | `ArdiaWindowController.mm`, `ArdiaChromeWindowHost.mm`, `ArdiaTabStrip.mm` | `state/tabs/chromeTabs.ts`, `state/tabs/liveTabs.ts` |
| Tab activation | `ardiacore_window.mm` `-activateTab:`, `ac_window_host_tabs.mm` `ActiveTabChanged` | `ArdiaWebView+Tab.mm` `-tabActivatedByChrome:`, `ArdiaTabStrip.mm` | same |
| Focus guard (test instances) | `ac_window_host.mm` (`WindowHost` activation) | `ArdiaActivation.mm` (`activation.log`), `ArdiaWindowFullScreen.mm` (acted-out occlusion), `ArdiaWebView+Focus.mm` | `packages/shell/ios/WindowManager.swift` |
| Fullscreen | `ac_browser_window_exclusive_access.mm` (`ExclusiveAccessContext`), `ac_window_host_tabs.mm` `FullscreenChanged` | `ArdiaWindowFullScreen.mm` (acted out in test instances), `ArdiaFullScreenLights.mm`, `ArdiaPageCover.mm` | `components/window/ContentCard.tsx`, `state/tabs/pageState.ts` |
| Picture in Picture | `ac_picture_in_picture.mm`; Dia's window and controls in `engine/chromium/…/ardia/pip/`; the auto-PiP hook in `engine/ardiacore/apply.sh` | `ArdiaPictureInPicture.mm` (monitors, `ardia_pip`), `ArdiaPiPController.mm` (+`Swipe`, +`SelfTest`), `ArdiaPiPZoom.mm`, `ArdiaWebView+PictureInPicture.mm` | `components/media/pip.ts` |
| Password and autofill bubbles | `ac_password_prompt.mm`, `ac_browser_window.h` (`ACAutofillBubbleHandler`), `ac_autofill_trigger.mm` (dropdown) | `ArdiaWindowController.mm` (`window:passwordPrompt:forTab:`) → `ArdiaWebView` event | `components/site/Prompts.tsx`, `site/Autofill.tsx` |
| Share tab, screen share | `ardiacore_tab_media.mm` (`TabSharingDelegateFor`), `ac_desktop_capture.mm` | `ArdiaHost.mm` `shareTabInstead`, `MediaModule.swift` | `components/media/ShareBar.tsx`, `SharePicker.tsx` |
| Restore, discard | `engine/chromium/…/ac_tab_restore.cc` (closed tabs), `ac_tab_restore_history.cc` (each tab's history) | `ArdiaWebView+Tab.mm` (`discard:`), `ArdiaWebView+Transfer.mm` (`transferKey`), `ArdiaTabParking.mm` | `state/tabs/tabLifecycle.ts`, `state/windows/windows.ts` |
| Permissions | `ac_permissions.mm` | `ArdiaHostEngineDelegate.mm` (`permissionRequest`), `ArdiaPopupWindow.mm` | `state/site/permissions.ts`, `Prompts.tsx` |
| Page script | `ac_page_channel.mm` (+`ac_page_channel_held.mm`, messages held for a page not shown yet), `renderer/ac_content_renderer_client.cc` | `page_script.js`, `ArdiaWebView+PageMessages.mm`, `ArdiaWebView+Peek.mm` | `onPageMessage` (`packages/ardiacore/src/WebView.tsx`) |

- **Pod layout** (`packages/ardiacore/ios`): one class per file, or one category per file named `Class+Concern`.
  A split class shares its ivars, private methods and helpers through one internal header (`ArdiaWebViewInternal.h`,
  `ArdiaChromeWindowInternal.h`, `ArdiaEarlyWindowInternal.h`, `ArdiaPictureInPictureInternal.h`, `ArdiaSwipeInternal.h`,
  `ArdiaContentBlockerInternal.h`, `ArdiaHostInternal.h`), and the helpers live in one C++ namespace per family
  (`ardia_web_view`, `ardia_window`, `ardia_early_window`, `ardia_pip`, `ardia_swipe`, `ardia_content_blocker`,
  `ardia_host`). Property accessors, `+initialize` and `dealloc` stay in the class's primary file, so no category
  overrides them. `ArdiaWebView` is split into `+Transfer` (parking, launch and link tabs), `+Tab` (attach, detach,
  Chrome's tab events, discard), `+Painting`, `+StandIn` (a closing page kept up for the next tab), `+Focus`, `+Reveals`, `+PageMessages`, `+Peek`, `+PictureInPicture`,
  `+ContextMenu`, `+Navigation`, `+PageCommands`, `+Site` and `+InputMonitors`. `ArdiaTabRegistry.mm` holds tab
  ↔ view, offered tabs and browser ids. Windows: `ArdiaWindowController`, `ArdiaChromeWindowHost` (+`Dev`, the dev harness),
  `ArdiaTrafficLights`, `ArdiaWindowFullScreen`, `ArdiaPopupWindow`, `ArdiaReservedKeys`. Launch: `ArdiaHost+Launch`,
  `ArdiaHostEngineDelegate`, `ArdiaProfiles`, `ArdiaEarlyWindow` (+`Pages`, `Layouts`, `Covers`, `ArdiaLaunchPicture`).
- **Call path:** JS `call("domain.verb", args)` (`packages/ardiacore/src/engine/call.ts`) → that domain module's `call`
  table (`<Domain>Module.swift`, `EngineCall.swift`) → `ArdiaHost` / `ArdiaServices` / `ArdiaWebView` or straight to an
  `ac_*` export → `public/ArdiaCore.h` → `ardiacore_<class>.mm` → `ac_*.mm`. Replies cross as JSON, parsed once in JS.
  App events go through `ArdiaEvents` (`emit:@"domain.event"`) to that domain module's one channel (its event name is the domain); a page's
  events come back through an `ArdiaCore*Delegate` method and `-emit:payload:` to the view's one `onPageEvent` channel
  (`PageEvents.swift`, only the names JS listens to), demuxed in `WebView.tsx`. Both page engines implement
  `PageEngine` (`PageEngine.swift`): ids they minted (`wk-…` for WebKit) route to them natively.
- **Engine layout** (`//ardia/core`, `//chrome/browser/ardia`): one class, or one category or concern, per file, named after
  it. `ArdiaCore.h`'s classes live in `ardiacore_engine.mm` (+`ardiacore_engine_tracing.mm`), `ardiacore_profile.mm`,
  `ardiacore_window.mm` and `ardiacore_tab.mm`, whose categories (`Navigation`, `Page`, `Commands`, `Media`,
  `Extensions`) are `ardiacore_tab_<category>.mm`; the engine's calls into the app delegate are `ardiacore_hooks.mm`. A
  split class or file shares its ivars and helpers through one internal header (`ardiacore_api_internal.h`,
  `ardiacore_tab_internal.h`, `ac_browser_internal.h`, `ac_video_upscaler_internal.h`; in `chrome/browser/ardia`,
  `ac_<domain>_internal.h` in namespace `ardia::<domain>_internal`).
- **Adding to `ArdiaCore.h`:** one form per call. Implement it in its class's file, or a category's (a new file goes in
  `BUILD.gn` `sources`); a member implemented in a category file is declared in that category in `ArdiaCore.h`. A new class
  must be named `ArdiaCore*` to be exported (the `ardiacore.exports` wildcard). The pod reads `ArdiaCore.h` from the repo and
  the app and the engine ship together, so the app calls new selectors directly (no `respondsToSelector:`).
- **Adding an engine call** (Chrome's services are `ac_*` C calls in `engine/chromium`, which the app finds with
  dlsym through `ArdiaEngineBridge`): (1) write `AC_ENGINE_CALL(ac_<domain>_<verb>)` in
  `engine/chromium/src/chrome/browser/ardia/ac_<domain>.cc` (conventions in `public/ac_engine.h`; a new file goes
  in that `BUILD.gn`; `ac_engine.exports` exports every `ac_*`); (2) `scripts/agent/engine-build`; (3) call it with
  `ArdiaEngineBridge call:` (`callWithSecret:` for secrets); for JS, add `"verb": EngineCall.passing("ac_<domain>_<verb>")`
  to the domain module's call table and its `"domain.verb": [args, result]` row to `packages/ardiacore/src/engine/api.ts`.
- **The page script** is `packages/ardiacore/ios/page_script.js`, a pod resource: `ArdiaHostEngineDelegate.mm` hands it to the
  engine at launch and the renderer runs it in every http(s) and file frame. Changing it needs an app rebuild, not an
  engine one. Its `post(kind, json)` crosses the page channel to `-[ArdiaWebView tab:didReceivePageMessage:…]` (`ArdiaWebView+PageMessages.mm`),
  which handles it or emits `pageMessage` (JS `onPageMessage`).
- **CEF-era code** (removed in 6bdf66ce): `git show 6bdf66ce^:packages/cef/ios/<file>`. Comments citing
  `packages/cef/…` mean: `ACBrowserView.mm`, `ACClient.mm` → `ArdiaWebView*.mm`; `ACChromeWindow.mm`,
  `ACPopupWindow.mm` → `ArdiaWindowController.mm`, `ArdiaPopupWindow.mm`; `ACActivation`, `ACTabStrip`, `ACPictureInPicture`,
  `ACContentBlocker`, `ACEngineBridge` → `Ardia<same>*.mm`; `ACPasswords`, `ACAutofill`, `ACZoom` →
  `ArdiaServices.mm`; `ACExtensions.mm` → `ExtensionsModule.swift`; `ACCef.mm` → `ArdiaHost*.mm`,
  `ArdiaStartup.mm`; `ACEngine.mm` → `ardiacore_*.mm`; `helper/page_script.js` → `packages/ardiacore/ios/`;
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
    BackgroundOnly and every activation path is guarded (`packages/ardiacore/ios/ArdiaActivation.mm`); each
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
      (`apps/browser/src/platform/nativeApi.ts`) and `apiVersion` (`packages/shell/ios/AppModule.swift`)
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
- **Shared files** several agents must touch — `packages/shell/ios/MainMenu.swift`,
  `apps/browser/src/state/commands/commands.ts`, `apps/browser/src/App.tsx`, `apps/browser/src/state/settings/settings.ts`,
  `apps/browser/src/components/ui/theme.ts`, `packages/ardiacore/ios/ArdiaInternal.h`, `packages/ardiacore/ios/ArdiaCore.podspec`,
  `packages/ardiacore/ios/ArdiaWebViewInternal.h`, `packages/ardiacore/scripts/acceptance.mjs`, ArdiaCore's `public/ArdiaCore.h`,
  `ardiacore_*.mm` and `ac_browser*.mm`, the `expo-module.config.json` files: re-read right before each edit, keep
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
    (`components/dev/devHarness.ts`); Expo modules are on `globalThis.expo.modules`. `ac.runCommand` takes an object:
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
    `-[NSWindow isOccluded]` (`ArdiaHost+Launch.mm`), so a covered window shows a tab at once instead of after Chrome's 1 s
    occlusion delay; launch with `--instance allowOcclusion` to test occlusion itself.
  - CDP (`ARDIA_REMOTE_DEBUGGING_PORT`), argv and `ARDIA_INSTANCE` `chromiumSwitches` only reach Chrome where it runs on its mock
    keychain: a scratch `ARDIA_DATA_DIR`, or a build without a team signature (ad hoc copies such as carryover.sh's). A
    team-signed build on its real data dir forwards none of them (`ArdiaHost+Launch.mm`), and its browser process removes
    every switch that opens the profile to outside control (remote debugging, unpacked extensions, automation, proxies,
    certificate overrides, net-log), also after chrome://flags have been applied, and unsets `SSLKEYLOGFILE`
    (`ac_main_delegate.cc`), so nothing drives or records the real profile, with its real Safe Storage key; Chrome 136
    did the same for its default profile.
  - Native UI: `screencapture -l <windowID> -o` (find the id with CGWindowList by owner PID; a test window's layer is negative). It captures the
    window's own content even while the owner's windows cover it, which a test window's always may. Wrap every capture in `timeout 20`: with the screen locked they can hang instead of failing.
    For the New Tab intro, launch with `--test shadersKeyWindow` (it only plays in a key window).
  - The user's screen may be locked: screen captures then fail or deliver no frames. Fall back to
    `ac.shell.devSnapshotWindow(windowId, path)` (`false` means it failed; the window's layers at 2x; Metal views
    render blank; text opacity is applied twice, so a label at α reads 1 − (1 − α)², don't match colours on it),
    `globalThis.expo.modules.ArdiaAreaLight.debugSnapshot(dir)` (every Metal view, offscreen, with its frame),
    the accessibility tree and store state, and list "needs visual check" items in your report.
- Code style: read the surrounding code first and match its naming and idioms. No comments (AGENTS.md).
  Keep files cohesive; new features go in new files where sensible.
- Dia fidelity: when you build UI, match Dia, and check it with numbers against a Dia capture
  (same crop, same state) before calling it a match (`docs/dia-spec.md`, `docs/dia-feature-parity.md`).

## Launch variables

The only variables the app and engine read, through `ArdiaLaunchConfig` (`packages/ardiacore/ios`; JS:
`platform/launchConfig.ts`; the engine gets `--ardia-*` switches from it, `ac_launch_switches.cc`). Set them with
`scripts/agent/ac launch … --instance K=V --test K[=V] --trace AREA`, or `launch(app, { instance, test, trace })` in
`scripts/lib/instance.mjs`. A list splits at a comma unless the entry before it takes commas (paths, URLs,
`chromiumSwitches`); a bare key means `1`; an unknown key is logged and ignored.

| Variable | Key / value | What it does |
| --- | --- | --- |
| `ARDIA_DATA_DIR` | path | Scratch data dir: Chrome's data in `<dir>/Chromium`, the app's documents, defaults, keychain items and Sparkle state (`ArdiaIsolation.h`); Chrome gets `--use-mock-keychain`. A Debug build refuses to start without one |
| `ARDIA_BACKGROUND` | `1` (anything but empty or `0`) | Hidden test instance (Rules › never steal focus; `docs/testing.md`) |
| `ARDIA_REMOTE_DEBUGGING_PORT` | port | CDP on that port, only on the mock keychain |
| `ARDIA_INSTANCE` | `jsLocation=host:port` | This launch's Metro (Debug builds) |
| | `chromiumSwitches=--a --b=x,y` | Extra Chrome switches, space-separated, only on the mock keychain; background mode drops the auto-accept capture ones, and `--ardia-*` never passes |
| | `downloadsDir=<dir>` | Chrome's default download folder for this launch, never written to the profile |
| | `updateFeed=<url>` | Sparkle's feed; a scratch instance checks for updates only with one |
| | `allowAudio` · `allowOcclusion` | Background mode keeps sound · keeps Chrome's occlusion |
| | `releaseNotes` | Opens the release notes as after an update (works on a Developer ID build: the release smoke) |
| | `cliHome=<dir>` · `cliBinDir=<dir>` · `cliUrl=<url>` | Where the `ardia` command installs, links and downloads from (`docs/cli.md`); a test instance installs only with the first two |
| | `syncFolder=<dir>` | The sync folder (`packages/sync/scripts/e2e.mjs`) |
| | `importSourceDir=<dir>` · `importSafariHome=<dir>` | Where import looks for other browsers and Safari's home, so a scratch instance never sees the owner's profiles |
| `ARDIA_SWITCHES` | `name=on\|off,…` | Kill switches (`platform/killSwitches.ts` `SWITCHES`, at most 8, on by default) and experiments (`EXPERIMENTS`: `beginFrameBridge`, `serverWindowDrag`, `serverWindowDragAllOpen`, `webkitSignIn`, off by default). Honoured in every build (`docs/kill-switches.md`) |
| `ARDIA_TRACE` | `visibility` | Occlusion and each WebView attach/detach, `[ardiacore-vis]` in the system log |
| | `pip` · `pipZoom` | PiP windows to `/tmp/ac-pip-trace.log` · PiP zoom gestures, `[pip-zoom]` |
| | `trafficLights` | Every traffic-light change to `<data dir>/traffic-lights.log` |
| | `profileGate` | The browser process's parsed and gated command lines, at startup and after chrome://flags |
| `ARDIA_TEST` | `keychain=file` (+ `keychainHiddenReads=<n>`, `keychainFail=decode\|denied\|interaction\|entitlement\|io`) | A file-backed keychain in the data dir instead of the login keychain |
| | `safeStorageAnswer=start-over` | Answers the Safe Storage dialog with Start Over (background mode) |
| | `reauth=granted` | Grants macOS re-auth requests in background mode (otherwise refused) |
| | `bluetoothChooser` · `mediaRouteProvider` · `externalProtocolNoLaunch` · `systemMediaPermission=denied\|ask\|ask-slow` | Engine fakes: Bluetooth chooser events, a test Cast sink, external protocols recorded instead of opened, camera and microphone permission |
| | `applyProfileGate` | Applies the real-profile switch gate on the mock keychain too |
| | `contextMenu` | Context menus dump to `<data dir>/context-menu.json` and take their pick from `….pick` |
| | `pipSelfTest=close\|backToTab\|hover\|style` · `pipHover=close\|back` | PiP self-tests on the first PiP window (background mode), results in the data dir |
| | `fakeFullScreenMs=<ms>` | Length of the acted-out full-screen transition |
| | `shadersKeyWindow` | Metal views act as in the key window (the New Tab intro) |
| | `peekStrict` | Peek's test hooks stop relaxing its click checks |
| | `importSecret=<s>` · `importDiaBundleId=<id>` · `importDiaWindows=<json>` | Import's Safe Storage secret · the app Dia's tabs come from (opened hidden and quit by the import) · fixture windows answering for it, with no Automation prompt |
| | `cliInstallScript=<path>` | Another `ardia` installer script |
| | `legacySource=<home>` · `legacyCrashAfter=<step>` | The Netnyahoo → Ardia migration from a scratch home |
| | `bangsUrl` · `onboarding` · `whatsNew` · `telemetry` · `liveMock=<url>` · `calendarFixture` | Debug builds only: bang list, run onboarding, show What's New, send telemetry, live folders from a mock, the calendar fixture |
| `ARDIA_PREWARM` | set | Not a setting: an older running app sets it on the staged update it prewarms, which then exits at once |

`ARDIA_TEST` and `ARDIA_TRACE` count only in a test instance: a build that isn't signed for distribution (Debug and
train builds qualify; `release.sh` builds don't), a scratch `ARDIA_DATA_DIR`, and, in the engine, `--user-data-dir` at
`<data dir>/Chromium` on the mock keychain. Otherwise they're ignored with one log line. Seams marked background mode
also need `ARDIA_BACKGROUND`. A build from before ArdiaLaunchConfig gets the old variable names from
`scripts/lib/launchEnv.mjs`, so benches and carry-over checks against the previous stable still work.

## Report format (your final message)
1. What you built (bullets, user-visible terms first).
2. Files created/changed.
3. How you verified it (commands + results).
4. Anything unfinished, known bugs, or changes you need from other areas (pod install,
   files owned by others, integration points, a new engine framework).
