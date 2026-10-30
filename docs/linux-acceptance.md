# Linux acceptance suite

`apps/linux/scripts/acceptance` runs runtime acceptance scenarios against a packaged Linux Ardia. Each scenario
launches Ardia with throwaway profiles and checks a feature through the shell, the page, CDP and, in desktop sessions,
real input and the compositor. The suite prints one result per scenario as JSON:

- `pass`: every check passed;
- `fail`: a check failed;
- `manual`: every automated check passed, and the steps that need a person are listed.

## Running it

```sh
pnpm --filter @ardia/linux build
pnpm --filter @ardia/linux acceptance -- <path to the packaged ardia executable> [apps/linux/dist]
```

- **UI directory.** The second argument is optional. When given, the UI is loaded from it (`--ardia-ui-dir`);
  otherwise the bundled UI is used. Relative paths resolve against the directory pnpm runs from.
- **`--only F01,W77`** runs a subset by scenario id.
- **`--list`** prints every scenario.
- **`--results <dir>`** chooses where evidence goes. The default is a new temporary directory.
- **`--keep`** keeps every scratch profile, not only failing ones.
- **Exit status.** `0` when nothing failed, `1` when a scenario failed, `2` for a usage error.
- **Deadlines.** A check stops after 60 s and a scenario after 3 to 8 minutes. A full headless run takes about 15 to
  25 minutes.

Results go to stdout and to `<results>/results.json`. Each scenario writes its checks, details and screenshots under
`<results>/<id>/`. A failing scenario keeps its scratch profiles, including the browser log and `*-command.json` with
the exact command line.

`pnpm --filter @ardia/linux acceptance:self-test` tests the harness without an Ardia build. It covers:

- the CDP client, against a mock peer;
- the launch plumbing and shell driver, against a mock host;
- the runner and its report;
- the classifiers;
- the fixture servers and certificates.

The parts only a real Chromium can show run against `/usr/bin/chromium` (or `ARDIA_ACCEPTANCE_CHROMIUM`) when one is
installed:

- SPKI trust;
- resolver mapping;
- gated downloads;
- synthesized drops;
- kiosk print to PDF;
- process-group cleanup;
- the content blocker's bridge page driven from an isolated world.

## Every launch

- **Profile.** A fresh `--user-data-dir`. `HOME` and the XDG directories point inside it.
- **Display.** `--ozone-platform=headless` with SwiftShader, and `DISPLAY`/`WAYLAND_DISPLAY` cleared.
- **Isolation.** The browser can't reach the session bus, so no portal dialog appears on the desktop, or a CUPS server.
- **Debugging port.** `--remote-debugging-port=0`, read back from `DevToolsActivePort`.
- **Background.** Launches use `ARDIA_BACKGROUND=1`, except where a scenario needs print, DevTools or real activation.
- **Process groups.** Each browser runs in its own process group. Cleanup closes it through CDP `Browser.close`, then
  sends `SIGTERM` and `SIGKILL` to that group only.
- **Seeds.** Profiles start with a one-window `linux-session.json` and a completed `onboarding.json`, unless the
  scenario tests those.
- **Network.**
  - `*.ardia.test` resolves to local fixture servers through `--host-resolver-rules`, and every other host to
    `NOTFOUND`, so nothing leaves the machine.
  - HTTPS fixtures use a CA generated for the run, trusted only through `--ignore-certificate-errors-spki-list`.
  - The default search engine's suggestion host is mapped to a local server that logs request headers.
  - F09S is the one exception: it uses the real network, for the Chrome Web Store only.
- **Content blocker.** F06 and S106–S108 need a package built with `--content-blocker`, or
  `ARDIA_ACCEPTANCE_CONTENT_BLOCKER` set to a prepared extension directory. The blocked request matches only
  EasyList's bundled copy, so no list update is needed.

Requirements: `openssl` and Node 22 or newer (for the built-in WebSocket client).

## Desktop sessions

The desktop scenarios (the right-hand column under [Scenarios](#scenarios)) drive a visible Ardia the way a person
would: real keys, a real pointer, the compositor's own focus and fullscreen, real dialogs. Most run in sway; ids ending
in `X` run in X11 and ids ending in `H` on the logged-in Hyprland. Each starts its own session and tears it down
afterwards, and none touches the desktop you are using.

- **Buses.** A private session bus and a private system bus, each a `dbus-daemon` with one empty service directory, so
  nothing on the machine is bus-activated into them. Polkit, UPower, the keyring and the portal Ardia talks to are the
  scenario's.
- **Display.**
  - Wayland is headless sway (`WLR_BACKENDS=headless`, pixman, no Xwayland) with its own `XDG_RUNTIME_DIR`.
    `swaymsg create_output` adds a second 1920×1080 output when a scenario needs two.
  - X11 is `Xvfb -displayfd` with openbox; without a window manager, X11 focus checks mean nothing.
  - `WAYLAND_DISPLAY`, `DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `XAUTHORITY` and `SSH_AUTH_SOCK` are
    removed from every process the harness starts.
- **Keyboard input.** Keys go through one long-lived `zwp_virtual_keyboard_v1` client (`lib/tools/virtual_keyboard.py`)
  with a US keymap. wtype isn't used: each run adds and removes a seat keyboard, and Chromium drops keyboard focus when
  its keyboard goes away. Held modifiers update the modifier mask.
- **Pointer input.** The pointer goes through a `zwlr_virtual_pointer_v1` client (`lib/waylandPointer.mjs`). Touchpad
  swipes are finger-source axis events, which Chromium turns into precise `wheel` events. Pinch can't be synthesized,
  because wlroots has no virtual gesture device.
- **X11 input.** xdotool.
- **Reading the screen.** Window titles, focus, geometry, output and fullscreen come from `swaymsg -t get_tree` (or
  xdotool).
  - Chrome's Views dialogs and native context menus are child surfaces, not toplevels. They are found by diffing
    `grim` captures and driven with the keyboard by item position.
  - Their words can't be read, because nothing registers with AT-SPI, so wording checks stay manual.
  - `lib/desktopPixels.mjs` measures colours and changed areas.
- **Calibration.** Every focus scenario first runs stock Chromium in the same session; it must take focus at launch
  and on Ctrl+N. Without Chromium, the calibration is reported as manual. The background-instance focus check runs on
  X11 only, because sway and Hyprland focus every newly mapped toplevel.
- **Mock services** (`lib/desktopServices.mjs`, `lib/mocks/`, python-dbusmock on the private buses):
  - a polkit authority answering allow, deny, dismiss, hang or unknown action, and recording calls and cancellations;
  - UPower and power-profiles-daemon;
  - `org.freedesktop.FileManager1`;
  - an xdg-desktop-portal backend behind the real portal frontend, whose FileChooser answers with a scripted path or a
    cancel.
- **Keyring.** `gnome-keyring-daemon`, unlocked, locked or absent. `gcr-prompter` can be registered on the private bus,
  so a locked lookup raises gnome-keyring's real unlock dialog inside the private compositor.
- **Drag peers.** `lib/tools/dnd_peer.py` is a GTK 3 drop target or drag source, on Wayland or X11.
- **Extensions.** `lib/crx.mjs` makes locally signed CRX3 pairs that share one extension id.
- **Media.** PipeWire, WirePlumber (device monitors off) and pipewire-pulse with a null sink. Audio is measured as RMS
  with `parec`.
- **Namespaces.** W156R and S105P use `unshare` with `/etc/subuid` and `/etc/subgid` ranges:
  - W156R mounts a world-writable tmpfs to test trash on a removable drive;
  - S105P runs a private polkitd that reads the package's policy, without root. S105P copies the whole package (about
    750 MB), so give `--results` a disk with room.
- **Tools.** `sway`, `swaymsg`, `grim`, `xkbcli`, `Xvfb`, `xdotool`, `xprop`, `openbox`, `dbus-daemon`, `python3` with
  `dbusmock`, `gnome-keyring-daemon` and `/usr/lib/xdg-desktop-portal`. Media scenarios also need `ffmpeg`,
  `pipewire`, `wireplumber`, `pipewire-pulse`, `pactl` and `parec`. A scenario whose tools are missing reports its
  checks as manual and names the tools. `ARDIA_ACCEPTANCE_TOOLS=<prefix>` puts tools unpacked from packages in front
  of the system's.
- **The logged-in Hyprland.** F22H and W79H run there only when `ARDIA_ACCEPTANCE_LIVE_HYPRLAND` is set to the
  instance signature.
  - They use workspace 9 and refuse if it has windows.
  - Ardia gets private buses and a private `XDG_RUNTIME_DIR` that reaches the compositor through one socket symlink,
    so it never sees the user's PipeWire, keyring, gnupg, AT-SPI or Hyprland IPC sockets.
  - Every key and pointer event is checked first: workspace 9 must be active and one of its windows focused or under
    the pointer. The first refusal aborts the scenario.
  - The previous workspace comes back afterwards, also after Ctrl+C or a crash.
- **Lifecycle.** Every process group the harness starts is tracked, and stopping one sends `SIGTERM`, then `SIGKILL`
  to the whole group. Ctrl+C stops every scenario's browsers, buses, compositor and mocks, and a second Ctrl+C kills
  what is left. A scenario past its deadline can no longer launch browsers or spawn processes.

## Scenarios

`--list` prints every scenario with its one-line description. By area:

| Area | Headless | Desktop |
| --- | --- | --- |
| Page commands: Find, Print, Save Page, DevTools per pane | F01, F02-101, W76 | F01D, F02-101D, W76D |
| Profiles and private windows | F02, F02-71, F02-72, F02-73, F02-88, F02-89, F02-99, F02-148, F02-149, F02-150, F02-172, F02-173, W70, W114 | F02D, F02-71D, F02-72D, F02-99D, F02-148D, F02-149D, F02-150D, F02-173D, F07P, W70D, W70X |
| Site security, permissions, data clearing, content blocker | F03, F06, S106, S107, S108 | F03D, F06D, S108D |
| History, zoom, favicons, tint, toolbar hiding | F23, F24, F25 | F24D, F25D, F25P, F25EX |
| Passwords, cards, polkit, keyring | F07, S102, S104, S105 | F07D, F07K, F07A, S102D, S104D, S105P |
| Downloads, folders, reveal, trash | F08, W74, W75, W156 | F08D, W74D, W75D, W156R |
| Extensions, store, shortcuts, search providers, native messaging | F09, E97, E98, E100, W137 | F09D, F09P, F09C, F09S, E97D, E98D, E100D |
| Drag and drop | F20 | F20D, F20X |
| Suggestions, live folders, import, sync, calendar | F10, F11, F12, F13, F14, I109, I110, I111 | F11K, F12D, F12W, F13D, F13K, I109K, I111W |
| Page status, fullscreen, media, tab policies | F15, F16, F17, F18, W78 | F15D, F16D, F17D, F18D, W78D |
| Windows, focus, typeahead, fullscreen restore, quit | W77, W79, W92, Q221 | F22D, F22X, F22H, W77D, W79D, W79X, W79H, Q221D |
| Platform settings, onboarding, header drag | F26, F27 | F26D, F26X, F27D |

S105 needs the suite to run against an extracted package, where `install.sh` sits beside `bin/` and `lib/`.

## What still needs a person

Each scenario's report lists its manual steps. These can't be automated here:

| Check | What the code and fixtures pin | What's left |
| --- | --- | --- |
| Live folders with real provider accounts | The provider contract tests (`engine/ardiacore-linux/tests/live_provider_contract.test.mjs`) run replies shaped like each provider's documented API through the real sources, bridge and native core. They cover pagination, the device flow, rate limits, SSO, scope errors and Google renewal. | Real accounts and OAuth clients for all five providers; the keyring item in Seahorse or KWallet. Only the first page is read (Bitbucket 50, Notion, Drive and Confluence 30), as on macOS. A Google OAuth client in Testing status issues refresh tokens that expire after 7 days. |
| A GNOME Online Accounts calendar | The calls are checked against EDS's D-Bus API, and Google and Nextcloud sources are shaped as GOA writes them. | A real account, then revoking it and signing back in. `ConnectionStatus` isn't surfaced, as on macOS. Calendars hidden in Evolution are still listed. |
| Linux and macOS sharing a sync folder | The format is read against the Swift vault and crypto. A macOS-sealed file and macOS tag vectors open on Linux. | A Mac and Linux sharing a real Syncthing, Dropbox or NAS folder, both ways. |
| Real Chrome and Firefox profiles | Readers built against Chromium 156's SQLite run on profiles built from Chromium 155 and Firefox 159 and 153 ESR schemas. | Keyring-protected (v11) passwords on a real GNOME Keyring or KWallet; very large profiles. |
| Desktop password managers | The host lookup order, and a real echo host through Chromium's framing. | 1Password, Bitwarden or KeePassXC with browser integration. 1Password also needs Ardia in `/etc/1password/custom_allowed_browsers`. |
| Widevine and the live Web Store | Build flags, component registration and the store bridge. | A Widevine test page and a streaming site. A newly downloaded CDM loads only after a restart. |
| Touchpad pinch | `ac_linux_history_zoom.cc` reports Chromium's page scale as `pinchScale`, and Reset also resets the page scale. | Pinch on a touchpad, then Reset; pinch on X11. |
| Printing from the GTK dialog | Print preview and kiosk print to PDF. | Printing to file from the system dialog. |
| Dialog wording | Each dialog's presence and area, found by screen diff. | The quit and download prompts' words. |

## Hooks the scenarios use

The scenarios drive the shared UI through the seams below. A scenario that fails because a label or flow changed,
rather than because the feature broke, says in the failing check's `detail` what it waited for. The kept scratch
profile has the browser log.

- **Shell hooks:** `ardiaLinux.store`, `pages`, `emitCommand`, `webviews`, `media`, `lifecycle`, `toolbar`,
  `selection`, `live` and `sync`.
- **Bridge:** `__ardiaHost.invoke` and `__ardiaHost.call`.
- **Window marker:** `[data-ardia-linux-window]`.
- **Visible labels:** labels from the shared components, such as `Site Controls`, `Zoom: N%`, `Find on Page` and the
  Settings pane names.
