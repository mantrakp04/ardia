# Linux acceptance suite

`apps/linux/scripts/acceptance` runs headless acceptance scenarios against a packaged Linux Ardia. Each scenario
launches Ardia with throwaway profiles and checks a feature through the shell, the page and CDP. The suite prints one
result per scenario as JSON:

- `pass`: every check passed;
- `fail`: a check failed;
- `manual`: every automated check passed, and the steps that need a person are listed.

No scenario runs in CI. The package job runs `scripts/linux/smoke.mjs` only (see [linux-ci.md](linux-ci.md)).

## Running it

```sh
pnpm --filter @ardia/linux build
pnpm --filter @ardia/linux acceptance -- <path to the packaged ardia executable> [apps/linux/dist]
```

- **UI directory.** The second argument is optional. When given, the UI is loaded from it (`--ardia-ui-dir`);
  otherwise the bundled UI is used. Relative paths resolve against the directory pnpm runs from.
- **`--only F01,#33`** runs a subset by scenario id or issue number.
- **`--list`** prints every scenario.
- **`--results <dir>`** chooses where evidence goes. The default is a new temporary directory.
- **`--keep`** keeps every scratch profile, not only failing ones.
- **Exit status.** `0` when nothing failed, `1` when a scenario failed, `2` for a usage error.
- **Deadlines.** A check stops after 60 s and a scenario after 3 to 8 minutes.

Results go to stdout and to `<results>/results.json`. Each scenario writes its checks, details and screenshots under
`<results>/<id>/`. A failing scenario keeps its scratch profiles, including the browser log and `*-command.json` with
the exact command line.

`pnpm --filter @ardia/linux acceptance:self-test` tests the harness without an Ardia build: the CDP client against a
mock peer, the launch plumbing and shell driver against a mock host, the runner and its report, the classifiers, the
fixture servers and certificates, and `scripts/linux/smoke.mjs`. When `/usr/bin/chromium` (or
`ARDIA_ACCEPTANCE_CHROMIUM`) is installed, it also checks SPKI trust, resolver mapping, gated downloads, synthesized
drops, kiosk print to PDF, process-group cleanup and the content blocker's bridge page.

## Every launch

- **Profile.** A fresh `--user-data-dir`. `HOME` and the XDG directories point inside it.
- **Display.** `--ozone-platform=headless` with SwiftShader, and `DISPLAY`/`WAYLAND_DISPLAY` cleared.
- **Isolation.** The browser can't reach the session bus or a CUPS server, so no portal dialog appears on the desktop.
- **Debugging port.** `--remote-debugging-port=0`, read back from `DevToolsActivePort`.
- **Background.** Launches use `ARDIA_BACKGROUND=1`, except where a scenario needs print, DevTools or real activation.
- **Process groups.** Each browser runs in its own process group. Cleanup closes it through CDP `Browser.close`, then
  sends `SIGTERM` and `SIGKILL` to that group only. Ctrl+C stops every scenario's browsers; a second Ctrl+C kills
  what is left.
- **Seeds.** Profiles start with a one-window `linux-session.json` and a completed `onboarding.json`, unless the
  scenario tests those.
- **Network.** `*.ardia.test` resolves to local fixture servers through `--host-resolver-rules`, and every other host
  to `NOTFOUND`, so nothing leaves the machine. HTTPS fixtures use a CA generated for the run, trusted only through
  `--ignore-certificate-errors-spki-list`. The default search engine's suggestion host is mapped to a local server that
  logs request headers.

Requirements: `openssl` and Node 22 or newer (for the built-in WebSocket client).

## Scenarios

| Id | Issue | Checks |
| --- | --- | --- |
| F01 | #11 | Find, Print, Save Page and DevTools act on the exact pane |
| F02 | #12 | Isolated and shared-data profiles, private windows |
| F03 | #13 | Site panel connection security for HTTPS, HTTP, mixed, bad-certificate and internal pages |
| F23 | #33 | History jumps of two or more, zoom feedback, reset and per-site persistence |
| F08 | #18 | Download events, controls, settings and restart |
| F09 | #19 | Extension management, toolbar action, popup and side panel, with `fixtures/extension/` |
| F10 | #20 | Online search suggestions through the native host, only when enabled |
| F26 | #36 | Unsupported platform settings are hidden and startup has no backend rejections |
| F27 | #37 | Onboarding starts once on a fresh profile and app services run once per launch |

Each scenario's report lists its manual steps, such as touchpad pinch zoom, Web Store installs, popup placement and
onboarding by hand.

## Hooks the scenarios use

A scenario that fails because a label or flow changed, rather than because the feature broke, says in the failing
check's `detail` what it waited for. The kept scratch profile has the browser log.

- **Shell hooks:** `ardiaLinux.store`, `emitCommand`, `webviews`, `extensions` and `openExtension`.
- **Bridge:** `__ardiaHost.invoke`, `__ardiaHost.call` and `__ardiaHost.on`.
- **Window marker:** `[data-ardia-linux-window]`.
- **Visible labels:** labels from the shared components, such as `Site Controls`, `Zoom: N%`, `Find on Page` and the
  Settings pane names.
