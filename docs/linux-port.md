# Ardia on Linux

The Linux port runs the same browser UI as the Mac app on the same Chromium (156.0.8078.47) and Helium (0.20.1, with
helium-linux 0.20.1.1) pins. It targets x86-64 Linux on Wayland, with Hyprland and Omarchy as the main desktop; X11
works, and arm64 builds are configured but untested. It answers upstream issue #1, "Linux Support".

On the Mac, ArdiaCore is a framework that the React Native app hosts. On Linux there is no React Native: Chromium's own
`chrome` executable is the app. It serves Ardia's UI from `chrome://ardia/` inside each browser window and hands the
UI one privileged bridge, `window.__ardiaHost`. ArdiaCore is linked into `chrome`; there is no separate
`libardiacore.so`.

The acceptance suite is in [linux-acceptance.md](linux-acceptance.md) and CI in [linux-ci.md](linux-ci.md).

## Where things live

| Path | What |
| --- | --- |
| `apps/linux` | The Linux UI entry point. Vite builds it from the shared `apps/browser` components into `apps/linux/dist`. It holds the Linux adapters (native modules, WebView, menus, window controls, wording transforms) and the acceptance suite. |
| `engine/ardiacore-linux` | The Aura host and every Linux-only native service (`src/ardia/linux/ac_linux_*`), the content blocker's bridge page, and their tests. It is the Linux patch-series layer. |
| `engine/chromium/src/chrome/browser/ardia` | The shared engine services (`ac_*`). Linux-only parts are `ac_reauth_linux.*`, `pip/ac_pip_linux.cc` and `pip/ac_pip_hyprland.*`, behind `is_linux` in `BUILD.gn`. |
| `engine/patches/chromium-linux-*.patch` | Chromium hooks the Linux host needs. They are selected with `linux` in `engine/patches/series`. |
| `scripts/linux` | Build, package, install, engine publish and fetch, smoke gate, CI checks, the polkit policy and the Arch `PKGBUILD`. |
| `.github/workflows/linux.yml` | The Linux workflow ([linux-ci.md](linux-ci.md)). |

`apps/demo` (the ardia.dev web demo) has no Linux code and nothing under `apps/linux` imports it.

## Architecture

### The shell and its bridge

- **Startup.** `chromium-ardia-linux-layer.patch` calls `ardia::StartLinuxHost()` from
  `ChromeBrowserMainParts::PostBrowserStart()`. Each browser window gets a `ShellHostView` (`ac_linux_host.cc`). It
  lays a WebView over Chromium's `BrowserView` client area and loads `chrome://ardia/` into it. Chromium keeps
  ownership of `Browser`, `BrowserWindow` and `TabStripModel`, and its normal browser delegates.
- **Assets.** These come from `lib/ardia/ardia-ui` beside the executable, or from `--ardia-ui-dir` during development.
  The data source serves them only to a host's own shell `WebContents`. An ordinary tab that navigates to
  `chrome://ardia/` gets nothing.
- **CSP.** The shell's policy is `default-src 'none'`, `script-src 'self'`, `connect-src 'none'`, `frame-src 'none'`,
  `object-src 'none'`, `form-action 'none'`, and `trusted-types ardia-symbols`. The UI can't reach the network.
  Search suggestions, live folders, favicons and import all go through native services. The one Trusted Types policy
  renders the generated icon markup (`apps/linux/src/shims/web/Symbol.tsx`).
- **The bridge.** `window.__ardiaHost` is defined by the generated `bootstrap.js` before any Vite module runs. Its
  bootstrap reports `appBuild: "linux-host"`. A request is accepted only when `ShellHostView::Trusted()` holds:
  - it comes from the host's own shell `WebContents`;
  - it comes from the live primary main frame;
  - that frame's committed origin is `chrome://ardia`.

  Pages never get the bridge. The native bridge resolves profile ids to loaded `Profile` objects and runs every call
  on the UI thread. The bootstrap rejects a native request after 30 s, and slow calls such as calendar and sync have
  longer deadlines.
- **Calls.** The shared UI keeps its domain calls (`engine.call(name, args)`) and events. On Linux a call takes the
  first of these that handles it:
  1. typed Linux handlers (credentials, site controls, Memory Saver, live folders, calendar, sync, import and others);
  2. the generated route table `linux_contract::kRoutes`;
  3. the additive `ac_engine_call(name, profile_dir, args_json, reply, context)` dispatcher in
     `public/ac_engine.h`.

  The dispatcher routes only generated, known service names, and `AC_ENGINE_ABI_VERSION` stays 2. Unknown names
  answer `ERR_UNKNOWN_CALL`. The bootstrap lists the capabilities a host serves, and Settings hides rows whose backend
  is absent rather than showing a control that fails.
- **Mac-only modules.** These answer from `apps/linux/src/appModuleFallbacks.ts`, either with an honest empty value or
  with `ERR_UNAVAILABLE`.

### Tabs and viewports

- **Ownership.** Each real tab stays in Chromium's `TabStripModel`. Releasing a native tab detaches its viewport;
  only an explicit close ends the tab. Moving or remounting a UI view never closes its tab.
- **Placement.** Rectangles arrive in CSS viewport coordinates and the host converts them. Native pages hide beneath
  browser overlays and clip themselves.
- **Tracking.** `watchTabViewport` measures a page's rectangle, overlays and coverage only when something changes: a
  DOM mutation, a resize, scroll or visibility change, a CSS transition or animation, or a change to the stores the
  overlay check reads (`refreshTabViewports`). It measures at most once per animation frame. It keeps measuring each
  frame only while a running animation targets the page's ancestors or an overlay. Idle windows run no measuring code;
  the earlier version polled every frame and used about 5% of a core. Mutation-triggered measures run in the next
  frame rather than in a later task, so a React commit and the animated transform that offsets it are never seen
  apart. Each tab keeps at most one `tab.viewport` request in flight; later rectangles replace the queued one, so a
  busy browser thread can't build up a backlog of stale positions.
- **Hover cards.** These report their bounds separately from modal overlays. Native viewports cut those bounds out of
  painting and input (Views and Aura hit testing) instead of detaching the page. Before a card shows, the host takes a
  short-lived page snapshot for the card's fade, corners and shadow.
- **Split panes.** Each pane keeps its own stored focus. A click in the inactive pane activates it.
- **New Tab prewarming** is off on Linux (`newTabPrewarm` is forced false in `ac_launch_switches_linux.cc`). A
  prewarmed native tab took focus from the search field when it was activated. Linux creates the page when the user
  submits a destination.

### Sessions and documents

- **Session writes.** Each write carries a baseline and a proposed snapshot. The native file worker writes in order
  and merges local changes into the latest stored snapshot, so concurrent edits in other windows survive.
- **Canonical events.** These sync every renderer while keeping its pending edits. The renderer that sent a save gets
  its own snapshot as the next base; its peers get the previous canonical base.
- **Native window ids** are fixed after bootstrap. A new window doesn't reapply the launch restore policy.
- **Canonical documents.** `LinuxDocuments` (`ac_linux_documents.*`) keeps the canonical copy of shared documents
  such as live folders and calendar settings in `live.canonical.json`, one per regular profile. Each write carries a
  revision and is merged by identity, with tombstones. Private and isolated profiles fail closed. The store imports the
  old `live.json` once.
- **Window close.** A close request waits until pending writes are sealed on the worker. The 30 s native deadline
  cancels the close; it never forces it. A save failure leaves the window open for a retry. Killing the process
  bypasses all of this.
- **Private data.** Private and transient state never reaches a persisted snapshot. `ValidLinuxSession` rejects a
  session that carries private data.

### Pages

- **Page channel.** The page script runs in an isolated world with an opaque origin and CSP
  `script-src 'none'; object-src 'none'`. Its messages reach the host only through a bounded channel:
  - the sender comes from the target frame, never from the message;
  - message kinds are allowlisted;
  - a kind is at most 32 B and a payload at most 64 KiB;
  - each document gets 64 messages, 32/s and 512 KiB;
  - 256 refusals mute that document.
- **Evaluation.** `evaluate` runs only fixed, hash-pinned operations, and anything else gets
  `ERR_PAGE_EVALUATION_REFUSED`.
- **Gestures.** Peek and split open only after a real left mouse-up. A dragged link opens only when it is dropped back
  on a page.
- **Page commands.** Find, Print, Save Page and DevTools (`ac_linux_page_commands`, `ac_linux_find`) act on the exact
  pane. DevTools docks inside the tab's pane and follows its tab across windows.

### Profiles and private windows

- **Profile ids.** `""`/`default` is the app profile. An isolated profile is
  `<letter>[A-Za-z0-9_-]{0,127}`, stored at `<user data>/Profile <id>`. Anything else is `ERR_PROFILE_INVALID`.
- **No fallback.** Nothing falls back to another profile: a tab runs in the engine profile it was created for, and a
  call names its profile explicitly.
- **One window, several engine profiles.** As on macOS, a regular window shows tabs of every regular profile, and
  switching profile pages the window in place. Profiles with Share data on have the same `dataId`, so they resolve to
  one engine profile and use one Browser; profiles with Share data off are separate engine profiles. Share data is
  chosen when a profile is created and can't be changed later, on macOS and Linux alike.
  - Chromium requires a tab's profile to match its Browser's, so each `ShellHostView` keeps member Browsers: the
    window's own Browser plus one hidden companion Browser per other engine profile its tabs use
    (`EnsureMember` in `ac_linux_host.cc`), the model of macOS's `WindowHost::BrowserFor`. A companion is created on
    demand with `omit_from_session_restore` and no session-restore trigger, and is refused while the window closes,
    during quit and when Chromium refuses a window for the profile. Its tabs stay in its own `TabStripModel`; the
    visible window shows them in its own viewports exactly like its own tabs.
  - A companion is a stock `BrowserView` whose widget is never shown. `chromium-linux-companion-browsers.patch` hands
    its `Show`, `ShowInactive` and `Activate` to the host, which focuses the visible window instead, drops its
    `Restore`, `Maximize`, `Minimize`, `SetBounds`, `Deactivate`, `FlashFrame` and fullscreen, synchronous or
    asynchronous (`RequestFullscreen`; Aura's `Restore`, and `Maximize` from minimized, show the window themselves), and hosts its tab-modal dialogs and permission prompts in
    the visible window's `BrowserView`. W70X checks on Xvfb and openbox, and W70D in sway, that no extension call
    (`chrome.windows.update` with any state, focus or bounds, `chrome.tabs.create`) ever maps a second toplevel. A
    widgetless `BrowserWindow` (as
    macOS's `ACBrowserWindow`) was the alternative; on Linux it would need the `BrowserWindowCreateParams::window`
    `CHECK_IS_TEST` lifted and the viewless accommodations `engine/ardiacore/apply.sh` makes for the Mac in about ten
    Chromium files, and `BrowserView::GetBrowserViewForBrowser` would resolve an adapter to the wrong Browser.
  - The companion `BrowserView` still attaches its active tab to its own contents view; after every change to any
    member's strip the host detaches every member's contents view before reattaching its viewports.
  - Companions aren't hosts: they get no shell, no window id, no focus ledger entry and no unclaimed-tab announcements
    of their own, `engine.info` doesn't count them, and Chrome keeps an empty one open while its window is open.
  - Each member reports its own strip (`tabs.strips`): its session id as `strip`, the visible window as `window` and
    `appWindow`, and its engine profile. Strip commands go to the member that owns the strip, and the tab-strip
    observer reads the strip that notified it.
  - A tab moved to another engine profile is recreated in the destination profile (`CreateTabIn` drops the old binding
    and its contents); a tab moved to another window keeps its contents only when the profile matches, and lands in
    the destination window's member for that profile.
- **The window's active engine profile.** The Linux shell tells the host which engine profile the window shows
  (`ArdiaShell.setActiveProfile`, sent by `watchActiveProfile` in `hostWindowProfiles.ts` whenever the window's engine
  profile changes, with a sequence number so a late reply can't win). The extension toolbar, popups, side panels and
  extension shortcuts follow it. While the window is active, the member Browser of the active profile is the one
  Chromium sees as active and every other member is told it isn't, the window's own Browser included, as macOS's
  `ActivateExclusively` does; switching back to the window's own profile makes its Browser the last active one again.
  A switch while the window is inactive still tells the member it leaves that it isn't active.
  The sequence belongs to one shell renderer: a reloaded shell starts again from 1, and a profile that resolves after
  the renderer changed is dropped. A switch between profiles that share data leaves all of this unchanged.
- **Extensions per engine profile.** Chromium scopes the extension APIs by profile, so an isolated profile's extensions
  see only that profile's tabs of the window and never the other profile's tabs. Companions are not hidden from
  extensions (`g_ardia_hidden_from_extensions` would also stop tab events, webNavigation and tab lookups for the
  profile's real tabs). A companion's id is the window's id for that profile's extensions, as each profile's Browser
  in a macOS `WindowHost` has its own id. `chrome.windows.update(…, {focused})` on it focuses the visible window, and
  a tab an extension opens in it is offered to the visible window with its engine profile
  (`ArdiaTabs.unclaimed` carries `profile`; `unclaimedTabs.ts` adopts it into a profile of that engine).
- **Closing.** The window's close covers its whole family. After the document seal, each companion's beforeunload
  handlers run (`UnloadController::RunBeforeUnloadForShutdown`, in turn); Stay on any of them cancels the window's
  close and resets every companion, including ones that already said Leave. When the visible Browser closes, each
  companion is closed through Chromium's normal close: a companion that said Leave goes straight to its tabs'
  `unload` handlers, others get a prompt-free beforeunload pass first, and Chromium waits for each tab's unload (or its
  timeout) before the companion goes away. A companion raises no download or multi-tab warning of its own; it is not
  closed with `force_skip_warning_user_on_close`, which would also skip the unload handlers. On quit Chromium's `BrowserCloseManager` drains every Browser,
  companions included. Companions are looked up by id at every use, so a closed one leaves no pointer behind.
  - Chromium's last-window count skips companions, and its `--close-confirmation` multi-tab warning counts the tabs of
    every member, so closing the only visible window asks once, in that window, for the whole family. W70X shows both
    warnings on X11 and cancels them.
  - A companion never reaches `TabRestoreService`: neither its window nor the tabs it closes while closing, on a
    window close or on quit, so the profile's recently closed list never holds a hidden window that would reopen as a
    separate one. Ardia's own closed windows keep every profile's tabs.
- **Downloaded files.** Opening, showing, status and icons of a download accept a path of any profile the window
  shows; a private window still accepts only its own.
- **Private ids.** A private window is `incognito:<window>@<original>`, which resolves to the original profile's
  primary off-the-record profile.
- **Private refusals.** These calls are refused for private windows: credentials, history, bookmarks, favicons,
  browsing-data clearing, extension management, sync and live folders. Content-blocker writes are refused too.
- **What private windows can use.** Site settings and zoom apply to the off-the-record session only. Find, Print, Save
  and DevTools work.
- **Session.** Private windows set `omit_from_session_restore`. A private window is visible to other windows only as a
  bare id they can focus.

### Launch configuration

`InitializeLinuxLaunchConfig` (`ac_launch_switches_linux.cc`) is the one place Linux reads the environment.
Command-line switches win over it.

| Variable | Effect |
| --- | --- |
| `ARDIA_BACKGROUND=1` | Becomes the background switch. Background instances never take focus, refuse print, save and DevTools and answer file choosers without a dialog. They never ask polkit. |
| `ARDIA_SWITCHES` | Feature switches. |
| `ARDIA_INSTANCE` | Read for the downloads folder only. |
| `HYPRLAND_INSTANCE_SIGNATURE`, `XDG_RUNTIME_DIR` | Become `--ardia-hyprland-instance` and `--ardia-hyprland-runtime-dir`, the only way the Hyprland socket reaches the PiP code. |

`ARDIA_DATA_DIR` isn't read: pass `--user-data-dir`. Test hooks and authentication bypasses don't exist in this
build (`SignedForDistribution()` is true and `TestInstance()` false).

## How macOS stays unchanged

- **GN.** Linux sources are behind `is_linux` in `engine/chromium/src/chrome/browser/ardia/BUILD.gn` and in the
  `engine/ardiacore-linux` layer. The Mac layer (`engine/ardiacore`) is selected only for `mac`.
- **Patch series.** Manifest entries are `chromium <patch> [mac|linux|all]` and `layer <dir> [mac|linux|all]`; an
  omitted selector means shared. Apply, capture-base, materialize, files and check all use the same selection.
- **Series bases.** Mac arm64 keeps `series-base`. Other targets use `series-base-<os>-<cpu>`, and recorded platform
  metadata stops one target's base being reused for another.
- **Split patches.** Three patches that mixed shared and Cocoa changes are split:
  - `chromium-window-hosted.patch` keeps the shared last-tab and window lifetime changes, and
    `chromium-window-hosted-mac.patch` carries the Cocoa view behaviour;
  - CEF carryover and Helium branding have shared, `-mac` and `-linux` parts. Duplicate hunks live only in the
    platform part.
  - The Mac series materializes to the same files as before.
- **Shared engine code.** Linux-only behaviour in shared `ac_*` files sits behind `BUILDFLAG(IS_LINUX)`:
  - the wiped secret reply (`Reply::SendSecret`, `SecretUTF8`);
  - card-number reauthentication;
  - the Linux reauth purpose strings.

  The macOS branches are the original lines.
- **Shared UI.** The changes there are seams whose default behaves as before:
  - `platform/windowClose.ts` (`managesWindowClose` returns false unless a platform registers a handler);
  - `platform/livePersistence.ts` (the default writes `live.json` with the same 800 ms debounce as before);
  - `decideWindowClose`/`decideLastTabClose` factored out of `state/windows/windowClose.ts`;
  - test ids on the extension popup.
- **Linux overrides.** Linux replaces shared modules through its own Vite aliases (`apps/linux/vite.config.ts`).
  Its wording transforms (`linuxWording.ts`, `credentialWording.ts`, `syncWording.ts`, `calendarWording.ts`) rewrite
  exact strings at build time and fail the build when a shared string they replace changes. Mac wording can't ship on
  Linux, and the Linux copy can't drift silently.
- **Engine fetch.** `packages/ardiacore/scripts/fetch-engine.sh --arch linux-x86_64` dispatches to
  `scripts/linux/fetch-engine.sh`; without `--arch` the Mac path is unchanged.
- **Proof.** `pnpm --filter @ardia/linux test:graph` asserts that the Linux production module graph loads nothing
  from `apps/demo` and only the Linux adapters it means to.

## Building on Linux

Use a dedicated build root, apart from any Mac Chromium tree. `01-sync.sh` is for a fresh tree and refuses to run
when an output directory exists; after that, builds are incremental.

Provision Chromium's Linux build dependencies first, along with Node 24, pnpm 11, Python 3, Git, util-linux `flock`,
and ImageMagick or Pillow. Helium's Docker build environment is a useful reference.

```bash
export AC_CHROMIUM_BUILD="$HOME/ardia-linux-build"
export AC_TARGET_OS=linux
export AC_TARGET_CPU=x64
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$AC_CHROMIUM_BUILD"

git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$AC_CHROMIUM_BUILD/depot_tools"
git clone --depth 1 --branch 0.20.1 https://github.com/imputnet/helium-chromium.git "$AC_CHROMIUM_BUILD/helium"
git clone --depth 1 --branch 0.20.1.1 https://github.com/imputnet/helium-linux.git "$AC_CHROMIUM_BUILD/helium-linux"

source engine/patches/build/env.sh
scripts/agent/locked chromium -- engine/patches/build/01-sync.sh --apply
scripts/agent/locked chromium -- python3 engine/patches/build/03-helium.py --platform linux --apply
scripts/linux/build.sh --apply --generate
```

- **Pins.** The tags must match `engine/patches/build/helium-pins.ini`.
- **Linux preparation.** It bootstraps `depot_tools`'s Python and replaces the Debian sysroot's hard-linked driver
  libraries with private copies (`normalize-sysroot.py`).
- **Build settings.** The build keeps the official configuration: phase-2 PGO, ThinLTO, CFI and the sandbox. The
  output is `out/Release_GN_linux_<cpu>/chrome`.
- **Build time.** A first build takes roughly five hours with six jobs on eight cores and 24 GB of RAM.
- **arm64.** Use `AC_TARGET_CPU=arm64`.

After that, rebuild incrementally (add `--generate` when GN arguments change):

```bash
scripts/linux/build.sh --apply
```

`build.sh` holds the chromium lock and runs `04-series.sh`, `02-gn-args.sh` (with `--generate`) and `05-build.sh`.
To inspect the configuration without touching a tree:

```bash
scripts/linux/build.sh --print-config
python3 engine/patches/series.py files --platform linux
```

## Packaging and installing

```bash
pnpm install --frozen-lockfile
pnpm --filter @ardia/linux build
source engine/patches/build/env.sh
python3 scripts/linux/package.py \
  --out "$CB/chromium_git/chromium/src/out/$GN_OUT_CONFIGS" \
  --ui apps/linux/dist \
  --content-blocker "$(scripts/linux/fetch-ubo.sh)" \
  --destination "$CB/artifacts/ardia-linux-$AC_TARGET_CPU.tar.xz"
```

- **Content blocker.** `fetch-ubo.sh` prepares the same pinned, patched uBlock Origin build macOS embeds, by running
  `packages/ardiacore/scripts/ubo.sh` with `flock` and `sha256sum` standing in for `lockf` and `shasum`. Without
  `--content-blocker` the package has no blocker, and Settings says so.
- **Archive contents.**
  - `bin/ardia`;
  - `lib/ardia/chrome` and the Chromium runtime files from the allowlist in `scripts/linux/runtime_files.py`;
  - `lib/ardia/ardia-ui`;
  - `lib/ardia/extensions/ublock`;
  - the desktop entry and icon;
  - `share/polkit-1/actions/dev.ardia.linux.policy`;
  - `install.sh`.
- **Running it.** Run the extracted `bin/ardia`. A raw build-tree `chrome` needs `--ardia-ui-dir apps/linux/dist`.
  Test with a throwaway `--user-data-dir` and keep the sandbox on.
- **Installing.** `sudo ./ardia/install.sh` installs under `/usr`. It also accepts `--prefix /opt/ardia` and
  `--destdir <staging root>`.
  - Without `--destdir` it must run as root and refuses otherwise, so it never leaves a partial install. Installed
    files are owned by root.
  - It always installs the polkit policy at `<destdir>/usr/share/polkit-1/actions` (mode 0644), whatever the prefix,
    because polkit reads actions only from there. Without the policy Ardia can't ask for the system password, so saved
    passwords and card numbers stay hidden.
- **Arch.** Put the archive next to `scripts/linux/arch/PKGBUILD` as `ardia-linux-x64.tar.xz` and run `makepkg -si`.
  The package (`ardia-bin`) depends on `polkit` and installs through the same script.
  `pkaction --action-id dev.ardia.linux.reauthenticate` then lists the action.

CI builds packages from a prebuilt engine instead of compiling Chromium; see [linux-ci.md](linux-ci.md).

## Tests

These checks need no Chromium tree. `scripts/linux/ci-checks.sh` runs all of them:

```bash
pnpm --filter @ardia/linux typecheck
pnpm --filter @ardia/linux test:host
pnpm --filter @ardia/linux test:symbols
pnpm --filter @ardia/linux test:graph
pnpm --filter @ardia/linux acceptance:self-test
pnpm --filter @ardia/linux build
python3 -m unittest discover -s engine/patches/build/tests
python3 -m unittest discover -s engine/chromium/src/chrome/browser/ardia/tests
python3 -m unittest discover -s engine/ardiacore-linux/tests
node --test engine/ardiacore-linux/tests/bootstrap.test.mjs
```

- **Patch tooling tests.** These cover platform selection, separate bases, repeat application, materialization,
  drift and package layout.
- **Engine fixtures.** These compile the real Linux services against stub Chromium interfaces, under ASan and UBSan
  where they parse input. Examples:
  - the dispatcher;
  - credential routing and secret wiping;
  - polkit replies;
  - site controls and the blocker queue;
  - Live folders against fake providers;
  - the EDS calendar client against a fake EDS on a real `dbus-daemon`;
  - sync against macOS-produced vectors.
- **Host tests.** These drive the shared UI through the Linux adapters and the real bootstrap transport, against a
  simulated native host.

Against a built package:

```bash
node scripts/linux/smoke.mjs --package <ardia-linux-x64.tar.xz> --results <dir>
pnpm --filter @ardia/linux test:keyboard-native <extracted>/ardia/lib/ardia/chrome
pnpm --filter @ardia/linux acceptance -- <extracted>/ardia/bin/ardia
```

- **Smoke gate.** Eight checks: libraries resolve; the shell renders the packaged UI; the bootstrap reports
  `linux-host`; a native tab paints and can't see the bridge; renderers run under seccomp; the blocker loads; a restart restores the tab; `install.sh --destdir`
  stages correctly.
- **Keyboard regression.** `test:keyboard-native` covers native window ownership after a saved-session restore and a
  tab-creation save that races a close.
- **Acceptance suite.** It runs every feature scenario headless or in private desktop sessions; see
  [linux-acceptance.md](linux-acceptance.md).
- **Shared changes.** A change to shared code also needs the Mac checks.

## Platform notes

### Windows, focus and input

- **Window controls.** Ardia draws close, minimize and maximize in its own header, so they work on decorationless
  desktops such as Hyprland. Chrome's own caption buttons are hidden: opacity 0, no input, ignored by accessibility.
- **Header drag and double-click.** Dragging the header moves the window (`DispatchHostWindowDragMovement`).
  Double-clicking it runs the desktop's titlebar action.
- **Outer frame.** The host overlays Chromium's client view and doesn't replace its frame. Without the Wayland
  decoration protocol, Chromium draws its custom frame.
- **Menu button.** Linux has no global menu bar, so a hamburger in the header stands in for the Mac one. It lists
  Ardia, File, Edit, View, Tabs, Bookmarks, History, Extensions, Window and Help as submenus built from the same menu
  state the Mac menu bar uses (checks, disabled commands, dynamic titles, bookmarks, recently closed entries, profiles
  and extensions), labelled with the effective Linux shortcuts (`apps/linux/src/appMenu.ts`). Items run through the
  shared command path; Close Window, Minimize and Maximize call the native window operations. Mac-only entries
  (Services, Hide, Spelling, Substitutions, Speech, Transformations, the WebKit page engine, JavaScript from Apple
  Events, Keep on Top, Full Screen and the native text-editing selectors) are left out.
- **Settings and Import.** Each opens in its own utility window and reuses an open one. Settings
  opens from Ardia › Settings… in the menu or Ctrl+comma.
  - Settings starts at 820×640 with a 720×480 minimum.
  - Import starts at 640×600 and doesn't resize.
  - They never create browser tabs or windows. A utility close waits for its pending session writes.
- **Shortcuts.**
  - Linux owns its shortcut catalog (`apps/linux/src/commandCatalog.ts`, `shortcuts.ts`). The same effective bindings
    fill Settings › Keyboard Shortcuts and drive the native key handler at the window's Aura root, so a focused page
    and the shell dispatch the same commands.
  - Bindings match physical key codes, with a logical fallback, so layouts such as German don't remap Ctrl+Z.
  - A modal dialog keeps its keys.
  - Quit is Ctrl+Shift+Q. Ctrl+Tab commits on release of the physical Control key.
  - `--ardia-keyboard-diagnostics` with `--enable-logging=stderr` logs each key, its binding and the focused view.
- **Typeahead.** Keys typed before a new window's UI is ready are held and replayed into the focused text field. The
  hold takes at most 512 events and lasts at most 10 s.
- **Wayland placement.** Wayland gives clients no global window position. `windowFrame` returns null there, only
  sizes are saved, and the compositor places windows.
- **Wayland focus.** Activation uses `xdg_activation_v1` and the compositor may refuse it (Hyprland may mark the
  window urgent instead). A Wayland client can't refuse focus when it maps, so `ARDIA_BACKGROUND=1` keeps focus only on
  X11.
- **Left-edge sidebar peek** (#368). With the sidebar hidden, the native host watches the left edge itself
  (`ArdiaShell.watchLeftEdge`, `ac_linux_left_edge.h`), the way macOS's `LeftEdgeWatcher` does. Before this the shell
  watched its own DOM. The native page covers everything from the card's 9 px inset, and the frame's resize border
  never reaches the shell, so only window x 4–10 revealed the sidebar on X11. No fast move ever revealed it (0 of
  15), and moving into the sliding panel re-hid it in 2 of 3 runs, because the pointer reached the page before the
  panel's cut-out did. A handler at the window's Aura root now sees every pointer event, over the page and the frame
  too.
  - The zone is 8 px from the client's left edge, plus anything of the window left of it (the resize border), up to
    24 px.
  - While the peek is out, the pointer counts as over anywhere in its column, 5 + sidebar width + 24 px wide, over the
    page too. Dismissal keeps the shared 120 ms delay.
  - Wayland has no global pointer, so the 24 pt reach macOS gives outside the window becomes this: when the pointer
    leaves through the left edge of the active window, the peek opens after 90 ms. If focus moves first (Hyprland's
    `follow_mouse` focusing the window on the left), it doesn't open. A peek that is already out stays out while the
    pointer is just past the edge, and closes when the window loses focus.
  - Engines without the capability keep the shell-side watcher (`shims/web/motion/leftEdge.ts`).
- **Fullscreen restore.** A window saved fullscreen comes back fullscreen. On Wayland the saved output's name is kept
  in the profile pref `browser.app_window_placement.ArdiaLinuxWindowOutputs`. When exactly one display carries that
  name, the window goes fullscreen there.

### Picture in Picture and Hyprland placement

- **Automatic PiP.** Linux forwards the Tabs setting to Chromium's browser-initiated automatic PiP.
  - Explicit site blocks win, and the global setting off disables it even for allowed sites.
  - Returning to the source or turning the setting off closes the PiP window without pausing.
  - Dismissing it uses up the departure; another visit and departure are needed to open it again.
  - Private windows never enter it.
  - Chromium keeps audio focus, URL safety, permissions and the single PiP owner.
- **Manual PiP.** It picks a candidate from the whole primary page, iframes included, ranked by unmuted, main frame,
  playing, then size. It never grants the page user activation.
- **Corner throws.** The gesture (`packages/ardiacore/ios/ArdiaPiPController+Swipe.mm`) is Mac-only. Wayland's
  `xdg_toplevel` doesn't let a client place itself, so a throw would need compositor integration.
- **Hyprland placement.** Hyprland 0.56.2's floating layout evaluates a `window_w` rule against the initial client
  width. Omarchy's PiP rule (600×338 at `monitor_w-window_w-40`) can therefore place a PiP window off the right edge.
  `ac_pip_linux.cc` and `ac_pip_hyprland.cc` work around it:
  - each PiP window gets an unguessable `ardia-pip-<token>` app id;
  - for the first second after it maps, the host waits for two matching compositor geometry samples and checks that
    the window's process is the browser;
  - one bounded Lua IPC request (`hl.dispatch(hl.dsp.window.move…)`) then moves an off-screen floating window into
    the monitor's work area with a 10-point inset. The correction allows for scale, rotation and reserved panels.
  - A visible window is left alone. Hiding, dragging, resizing or input cancels the attempt.
  - It writes no rules or config and changes no focus.
  - Without compatible IPC, the compositor keeps control. Other compositors, X11 and macOS are unchanged.

### Site controls and the content blocker

- **Routing.** Site permissions, per-site data and browsing-data clearing go through
  `ac_linux_site_controls_service.cc`. It validates arguments and resolves the profile in one function,
  `SiteControlsProfile`, before calling the shared `ac_site_settings_*`, `ac_site_data_clear` and
  `ac_browsing_data_clear`.
  - Origins must be `http(s)://host[:port]`, at most 2,048 bytes.
  - Private ids get `ERR_PROFILE_PRIVATE`, and isolated profiles get their own settings.
  - A clear that fails for one type answers `ERR_CLEAR_INCOMPLETE`.

  | Call | Arguments |
  | --- | --- |
  | `sites.settings` | `{origin, engine?}` |
  | `sites.setSetting` | `{origin, type, value, engine?}` |
  | `sites.origins` | `{}` |
  | `sites.reset`, `sites.clearData` | `{origin}` |
  | `profiles.clearBrowsingData` | `{types, since?}`; `types` is 1–4 of history, siteData, cache, downloads |
  | `contentBlocker.state` | `{}` |
  | `contentBlocker.setEnabled` | `{enabled}` |
  | `contentBlocker.setListEnabled` | `{id, enabled}` |
  | `contentBlocker.isAllowed` | `{host}` |
  | `contentBlocker.setAllowed` | `{host, allowed}` |

  The event is `contentBlocker.changed`.
- **The blocker.** It is the same uBlock Origin component macOS loads, with the same id. Each regular profile loads
  it from `lib/ardia/extensions/ublock` (or `--ardia-content-blocker-dir`) through `ComponentLoader::AddOrReplace`
  once its extension system is ready.
- **The bridge page.** Calls run in a hidden `ardia-linux-bridge.html` page with seven fixed operations; nothing is
  evaluated from a request.
  - Chromium refuses main-world script on extension pages, so the browser writes a DOM attribute from an isolated
    world and polls for the reply every 25 ms.
  - Each profile's queue gives a call a 20 s deadline, retries 40 times 250 ms apart and holds at most 64 calls.
  - The page holds a Web Lock so Helium's tab freezing never freezes it.
- **Restricted scripting.** `g_ardia_restricted_component_extension` is set in every process from
  `BasicStartupComplete`, so uBlock can't script `chrome://` pages, the shell, the Web Store or other extensions.
- **Isolated profiles.** These load their own copy. It follows the app profile's lists, exceptions and auto-update,
  copied on first load and after each change. Plain list ids only, at most 512 lists and 10,000 directives of 2 KiB.
- **Navigation hold.** Until a profile's blocker is ready, `chromium-linux-navigation-hold-hook.patch` holds its page
  navigations for at most 10 s. This applies to a fresh app profile and to each isolated profile on its first load in a
  run. Internal schemes aren't held.

### Memory Saver

- **Routing.** Chrome's Memory Saver replaces Ardia's own tab sleeping, driven by the shared `ac_memory_saver` call.
  On Linux, `engine.memorySaver` and `engine.validateKeepActiveSite` go through `ac_linux_memory_saver.cc`. Both
  routes are in the bootstrap capabilities.
- **Validation.** It accepts:
  - `state` (`on`/`off`);
  - `aggressiveness` (`moderate`/`balanced`/`maximum`);
  - at most 1,000 `sites`. It drops empty sites, sites over 2,048 characters and sites with control characters.

  It never passes the engine's `validate` key through a settings write.
- **Scope.** State and mode are app-wide local state. The site list goes to every loaded regular profile, and private
  profiles are refused.
- **Startup.** Helium's `memory-saving-by-default.patch` applies on Linux, and the app pushes its setting at launch.
- **Tests.** `engine/ardiacore-linux/tests/test_memory_saver.py` and `apps/linux/src/hostCapabilities.test.mjs`.
- **Tab protection.** Unknown protection state counts as protected. `unsavedInput: null` protects a tab.
- **Memory pressure.** Read from PSI, falling back to `MemAvailable`. Power state comes from UPower and
  power-profiles-daemon signals.

### Calendar (Evolution Data Server)

Linux reads calendars from Evolution Data Server, which GNOME Online Accounts, GNOME Calendar and Evolution use.

- **Service.** One app-wide service (`ac_linux_calendar_service.cc`) runs every D-Bus call on its own GLib-pumped
  thread. Its EDS client (`ac_linux_calendar_eds.cc`) loads GIO at runtime and opens a private session-bus connection.
  GLib's shared connection would raise SIGTERM when the bus goes away.
- **Contract.** `ArdiaCalendar.status | requestAccess | sources | objects | timezones`. Status is one of
  `notDetermined`, `fullAccess`, `restricted` (no bus or no EDS) or `denied`.
  - `status` probes the bus without starting EDS.
  - Connect Calendar is the consent: `requestAccess` writes `linux-calendar.json`, and nothing is read before it.
  - Calls refuse with `ERR_CALENDAR_NOT_CONNECTED` until then.
- **Limits.**
  - 64 calendars, a 400-day range, 20,000 objects and 16 MiB per calendar, 32 MiB per reply.
  - One 90 s deadline per `objects` request.
  - A calendar that times out is skipped for two minutes.
  - Each calendar reports its own status, so one expired account doesn't hide the others.
- **Adapter.** `apps/linux/src/hostCalendar.ts` and `calendarIcs.ts` parse iCalendar and expand RRULE, RDATE, EXDATE
  and RECURRENCE-ID in the event's zone. They resolve TZIDs from IANA names, embedded VTIMEZONEs or EDS
  `GetTimezone`. A rule stops at 50,000 periods, and one refresh shares a 750 ms expansion budget. Truncated events are
  reported, not dropped.
- **Without EDS or a session bus.** The calendar is `restricted`, and Settings › Calendar says how to set it up. It
  recovers by itself when EDS appears.

### Extensions

- **Search providers.** Chromium allows `chrome_settings_overrides` only on Windows and macOS.
  `chromium-linux-settings-overrides.patch` adds Linux, so an extension's `search_provider` reaches `search.engines`
  and can become the default, as on macOS. The key's `homepage` and `startup_pages` stay off on Linux.
- **Keyboard shortcuts.**
  - Each browser window keeps a `LinuxExtensionKeybindings` registry (`ac_linux_extension_keybindings.cc`), and
    `chromium-linux-extension-keybindings.patch` stops Chromium's own registry from registering accelerators.
  - Ardia's shortcut table is checked first. A key Ardia binds never reaches an extension, even in text fields.
  - `_execute_action` (and the MV2 aliases) sends `extensions.actionShortcut`, and the shared toolbar opens the popup
    or side panel. Named commands fire `chrome.commands.onCommand`, and global commands keep Chromium's listener.
  - In private windows only incognito-allowed extensions are registered.
  - Chromium 156 has no `_execute_side_panel`; it is an ordinary named command.
- **Tabs and windows extensions open.** A tab Chrome inserts by itself (`chrome.tabs.create`, an action's
  `onClicked`, a URL handed to the running instance) has no opener page to report it, so the host does.
  - Each window notes tabs inserted outside Ardia's own operations (`unclaimed_` in `ac_linux_host.cc`). It also notes
    tabs already in the window when it attaches, unless they're blank or look restored by Chromium (more than one
    history entry, or an entry marked restored). In a window Chrome made, an `about:blank` tab counts too, so a
    later `chrome.tabs.update` lands in a tab the sidebar shows; Chrome's New Tab page is left to Ardia's own first
    tab, which adopts it.
  - A tab a page already reported, or one bound in any window, is left alone. A blank URL gets 20 tries, 25 ms apart,
    to resolve.
  - The shell asks for its window's waiting tabs once it listens (`ArdiaTabs.unclaimedTabs`) and gets later ones as
    `ArdiaTabs`/`unclaimed` events. A new renderer has to ask again, and gets again any tab an earlier renderer was
    told about but never bound. After a shell crash that can add a second sidebar entry for a background tab the
    crashed shell had saved, which is preferred over a tab nobody can see.
  - `apps/linux/src/unclaimedTabs.ts` opens each one in its own window, selected only if the extension asked for
    `active` and the tab is still Chrome's active tab.
  - A window Chrome makes (`chrome.windows.create`) is marked `chromeMade` in its bootstrap and lists its tabs in
    `adoptTabs`. `initialHostSession` seeds the window with them instead of a blank tab, and the window is saved like
    any other instead of waiting for an opener to save it.
- **Install prompts.** These are never auto-accepted. They show in the window of the tab that asked and end with that
  tab. Nothing installs without Add Extension. Popups size between 25×25 and 800×600.
- **Native messaging hosts.** Ardia looks for `<name>.json` in this order:
  1. `<Ardia data dir>/NativeMessagingHosts` (by default `~/.config/ardia/NativeMessagingHosts`);
  2. `~/.config/google-chrome/NativeMessagingHosts` (Helium's base patch; honours `CHROME_CONFIG_HOME`);
  3. `~/.config/chromium/NativeMessagingHosts` (`chromium-linux-native-messaging-hosts.patch`; honours
     `CHROME_CONFIG_HOME`, then `XDG_CONFIG_HOME`);
  4. `/etc/chromium/native-messaging-hosts`;
  5. `/etc/opt/chrome/native-messaging-hosts`.

  Hosts installed for Chrome or Chromium, such as Bitwarden and KeePassXC, are found without changes, because Web
  Store installs keep their Chrome ids for `allowed_origins`. Two exceptions:
  - 1Password talks only to browsers it knows, so add Ardia's binary to `/etc/1password/custom_allowed_browsers`;
  - Flatpak and Snap installs write manifests inside their sandbox, where Ardia doesn't look.

### Live folders

- **Native requests.** GitHub, Bitbucket, Notion, Confluence and Google Drive are reached from the browser process
  (`ac_linux_live.cc`, `ac_linux_live_service.cc`), never by renderer `fetch`. The shell keeps `connect-src 'none'`.
  - The Linux UI swaps the shared `state/live/sources.ts` and `net.ts` for `apps/linux/src/liveSources.ts` and
    `liveNet.ts`. These ask for fixed operations through `ArdiaLive.request`, `connect`, `cancel` and `disconnect`.
  - Native code builds every URL and adds the credential.
  - A GitHub GraphQL query must be read-only.
- **Transport limits.**
  - HTTPS only, no redirects, no cookies, no cache.
  - 20 s per request and 8 MB per reply.
  - 8 requests in flight and 256 queued.
  - Confluence sites must be `https://`.
- **Tokens.** Connect verifies a token with the provider before storing it. Tokens are kept in the Secret Service as
  "Ardia Live Folder Token" items (schema `dev.ardia.linux.LiveToken`, account = source).
  - Background test instances with an explicit `--user-data-dir` use a 0600 file instead.
  - Tokens are cached natively, wiped when freed and never returned to a renderer.
  - Google Drive tokens are renewed natively, and concurrent renewals share one request.
  - A locked keyring answers `ERR_LIVE_KEYRING_LOCKED` and never deletes a stored token.
- **Ordering.** A per-source generation counter keeps a late renewal from bringing back a disconnected token. A
  cancelled connect restores the previous token.
- **Private windows** get `ERR_PRIVATE_SERVICE`.
- **Rate limits.** GitHub's secondary rate limit and Drive's documented usage-limit 403s read as rate limited, not
  signed out. The shared macOS mapping still reads them as signed out.

### Passwords, cards and system authentication

- **Storage.** Ardia stores no secret of its own. Passwords live in Chromium's `Login Data` and card numbers in
  `Web Data`, both encrypted by OSCrypt.
  - The key comes from the Secret Service, KWallet or the secret portal (`--password-store`).
  - `ArdiaPasswords.status` and `ArdiaAutofill.status` report which key encrypts new data. They read the
    ciphertext's provider tag (`v10` built-in, `v11` keyring, `v12` portal) and flag Chromium's silent fallback to the
    obfuscating v10 key (`protectionFallback`).
  - An unreadable store answers `ERR_PASSWORDS_UNAVAILABLE` or `ERR_AUTOFILL_UNAVAILABLE`, never an empty list.
- **Reauthentication.** `ardia::Reauth` (`ac_reauth_linux.cc`) asks polkit for `dev.ardia.linux.reauthenticate`. The
  browser's own bus name is the subject, with interaction allowed and a 120 s timeout.
  - The policy is `auth_self` for active sessions and `no` for inactive and remote ones.
  - Only `is_authorized && !is_challenge` grants. Everything else is `denied`, `cancelled`, `expired` or
    `unavailable`.
  - Off-the-record profiles and background instances are `unavailable` without asking.
  - There is no test grant.
  - Unlock, reveal and edit share Chrome's five-minute grant. Export and card numbers prompt every time.
  - A newer request cancels the older one.
  - `ProbeReauth()` reports why authentication is unavailable without prompting: `notPermitted`, `policyMissing`,
    `noPolkit` or `background`.
- **Secret routes.**
  - Secrets travel only on typed calls (`ArdiaPasswords.reveal|save|update|export|unlock`,
    `ArdiaAutofill.cardNumber|saveCard`), as hex buffers sized exactly and wiped after use.
  - Generic `engine.call` refuses those names with `ERR_SECRET_ROUTE`. Generic payloads are rebuilt from allowlisted
    fields.
  - The engine's reveal and card-number replies are serialized into a pre-reserved buffer and cleansed (Linux only).
  - Export writes Chromium's CSV and sets mode 0600. A file the export created is deleted if the export fails.
  - The credential sources contain no logging, and a test enforces that.
- **What can't be wiped.** V8 strings in the UI renderer, and Chromium's own IPC and `base::Value` copies.
- **Private windows.** Credentials resolve their profile in one function, `ResolveCredentialProfile()`. A private
  window's renderer, or any off-the-record profile, gets `ERR_PROFILE_PRIVATE` for every credential call.

### Sync

- **Format.** Folder sync uses the macOS format byte for byte (`ac_linux_sync_crypto`, `ac_linux_sync_vault`), so a
  Linux and a Mac install can share a Syncthing, Dropbox or NAS folder.
  - HKDF-SHA256 key derivation.
  - `NNS1` files with AES-256-GCM and 1 KiB padding.
  - A 24-word BIP-39 phrase.
- **Writes.** Files are staged `O_EXCL|O_NOFOLLOW` at 0600, fsynced, then published with
  `renameat2(RENAME_NOREPLACE)`. Everything below the chosen folder is opened with `openat`.
- **Folder.** The default is `$HOME/Ardia Sync`, or `--ardia-sync-folder`.
- **Key.** The sync key is a Secret Service item, "Ardia Sync Key" (schema `dev.ardia.linux.SyncKey`). Showing,
  copying or saving the recovery words asks polkit, then allows 60 s.
- **One authority.** Only one browser renderer syncs: it holds a Web Lock plus a native lease that expires 30 s after
  its last renewal. The other windows mirror its state. Utility and private windows are never the authority.
- **Passwords** sync sealed through a native path. Logins Linux can't hold are kept in `sync-held-logins.nns`.

### Import

- **Sources.** Chromium-family profiles under `$XDG_CONFIG_HOME`: Chrome, Chromium, Brave, Edge, Vivaldi, Opera and
  Helium, plus Flatpak and Snap variants. Also Firefox (native, Flatpak, Snap), LibreWolf and Zen.
- **Kinds.** Bookmarks, history, passwords, cookies, addresses, cards, open tabs and favicons.
- **Copies.** Databases are copied `O_NOFOLLOW` into a private temporary folder. Copies older than an hour are swept.
  Source files are never written.
- **Passwords never reach the renderer.**
  - It sees only a token and a count. The token is 128 bits, bound to its window and single-use within 10 minutes.
  - Any reply that carries a password is refused.
  - Writes go through Chromium's `PasswordImporter`, and a conflict keeps the stored password.
- **Chromium keys.**
  - `v10` uses Chromium's built-in key.
  - `v11` is read from the Secret Service or KWallet. The keyring probe never unlocks it, and the consented read may
    raise the keyring's own unlock prompt.
  - `v12` (secret portal) data can't be read.
- **Firefox.** `key4.db` with or without a primary password, and `logins.json`/`logins.db`.
- **Files.** A file import uses only a path the native chooser returned to the same window, once.
- **Refreshing open windows.** Imported bookmarks and history reach open windows without a relaunch.

### Downloads and files

- **Choosers.** File and folder choosers go through `ui::SelectFileDialog`: the XDG portal, GTK or KDE, as Chromium
  picks. Each window has one chooser; a stale one is replaced and answered as cancelled. Background instances answer
  from `<user data>/file-chooser.txt` or cancel.
- **Show in Folder.** It tries, in order:
  1. the portal's `OpenDirectory`;
  2. `org.freedesktop.FileManager1.ShowItems`;
  3. `xdg-open` on the folder.
- **Trash.** Move to Trash follows the freedesktop spec per volume (`$topdir/.Trash/$uid`, else `.Trash-$uid`). It
  opens through handles and refuses symlinks.
- **Private downloads.** These always ask where to save, as Chrome's incognito does. They reach only their own window
  and are never kept.

## Known gaps

These were open at the time of the PR.

- **Shared calls Linux doesn't route yet:**
  - bookmarks HTML export;
  - `webView.setPeekOtherSiteTabs` and `webView.setCommandScrollZoom`;
  - the `extensions.installFailed` event;
  - Paste and Go (the clipboard read answers empty);
  - performance recording (`beginTracing`/`endTracing`), which stays hidden.
- **Profiles.** Deleting a profile's data (`profiles.deleteData`) isn't routed. In a window that shows several engine
  profiles:
  - a page's own fullscreen in a companion's tab makes only its viewport fullscreen, not the window;
  - Chrome's own download bubble and other toolbar-anchored bubbles of a companion have no visible anchor (Ardia's
    downloads panel lists them); the downloads list a window loads at start comes from its own profile, while later
    downloads, controls and file operations reach the window from every profile it shows;
  - a window Chrome itself creates for an isolated profile (`chrome.windows.create` from that profile's extension)
    is still a plain Chrome window, as before;
  - a shell renderer may send a strip command for another window's strip, which that window's host refuses
    (`The strip is not owned by this window`); the owning window's renderer keeps its own strips in order;
  - Wayland mapping is checked in sway (W70D), which this build machine's desktop kills at start, so only the X11
    check (W70X) has run here.
- **Tab drags across windows.** There is no floating drag preview; in-window drags show the ghost row. On Wayland,
  where windows have no global coordinates, tearing a tab off or dropping it on another window does nothing. On X11 a
  tab dropped on another window is appended rather than placed at the pointer's row.
- **Wayland focus.** A keyboard switch right after a window maps can be undone. A quit within about 200 ms of moving
  a fullscreen window to another output can save the old output.
- **Closing the last window during a download** shows Chromium's own download dialog, not an Ardia dialog.
- **Window menu.** It has no Arrange in Front, Keep on Top or Profiles submenu.
- **Small UI bugs.**
  - A sidebar hover card stays open when the pointer moves straight from the sidebar into the page.
  - In the top-strip layout, the sidebar peek isn't cut out of the page.
  - A played video removed from the DOM keeps its media entry until the element is collected.
- **Not available on Linux:**
  - casting (Cast shows a toast);
  - translation;
  - video upscaling;
  - the updater;
  - crash reports;
  - Ardia's own desktop notifications (sites' web notifications use Chromium's Linux notifications);
  - the share sheet;
  - Handoff;
  - AppleScript;
  - alternate app icons;
  - the `ardia` command;
  - default-browser registration, launch at login and the scroll bar style setting.
- **Packaging.**
  - There is no published Linux release or AUR package yet; the `PKGBUILD` builds from a local tarball.
  - The package ships no SUID sandbox helper and no AppArmor profile. On Ubuntu 24.04, which restricts unprivileged
    user namespaces, Chromium refuses to start until a profile is installed or the restriction is lifted.
- **Sync.** One read has no total size cap (each file is capped at 64 MiB). Linux and macOS sharing a real folder has
  not been run end to end with a Mac.
- **Shared, not Linux-specific.** The Google Drive OAuth flow uses `Math.random` state, plain PKCE and a loopback
  URL that lands in tab state. This is shared with macOS and unchanged here.
- **Widevine.** It comes from the component updater as software L3. The first DRM playback after the CDM downloads
  needs a restart.
- **Desktop checks that need a person.** These are listed in [linux-acceptance.md](linux-acceptance.md):
  - real provider accounts;
  - a real GNOME Online Accounts calendar;
  - desktop password managers;
  - a polkit agent's own dialog;
  - touchpad pinch.
