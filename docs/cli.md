# The `ardia` command

`ardia` drives a running Ardia from the terminal with Python and [pydoll](https://pydoll.tech) 3.0. It's a separate
download, not part of the app bundle. The app ships `install.sh`, and runs it when the user opts in during onboarding
or in Settings ("Let the ardia command control Ardia").

While it's connected, a pill floats over the bottom centre of the page ("ardia is controlling Ardia · Stop"; Stop turns
the setting off). It overlays the page and never resizes it. It shows at the first connection and stays 3 s after the
last one closes, so a burst of commands shows one steady pill; turning the setting off hides it at once. One per
window: the focused pane of a split, the full screen page, or the Peek while one is open
(`apps/browser/src/components/window/CliControlPill.tsx`, `useCliIndicator` in `state/app/cliControl.ts`).

Code: `apps/cli` (`ardia_cli`, `install.sh`, `scripts/build.sh`). Dependencies are pinned with hashes in
`apps/cli/requirements.lock` (regenerate with `uv pip compile requirements.in --python-version 3.13
--python-platform aarch64-apple-darwin --generate-hashes --no-annotate --no-header -o requirements.lock`, then copy
the pins into `pyproject.toml`).

## Commands

- `ardia exec [CODE | -] [-f FILE] [--data-dir DIR] [--port N] [--ws URL] [--timeout S] [--json]` runs Python with
  top-level `await`. In scope: `browser` (pydoll `Chrome`), `tab` (the page shown in Ardia's last focused window,
  from `GET /ardia/active?token=…` on the token path, so it holds while the window is covered; `--port`/`--ws` test
  servers fall back to visible and focused, else visible; with no page, as on New Tab, it's a placeholder that raises
  `NoPageTab` on first use), `tabs` (http, https, about, data and blob pages, plus what `new_tab` opens, minus
  the New Tab's prewarmed `about:blank`: on the token path every `about:blank` that isn't the active page, on test
  servers the hidden ones),
  `new_tab(url, background=True)`, `js(expression, tab=None)` (default: `tab`, else the last `new_tab`), `await pinned()`,
  `await history(days=1, limit=200, profile=None, domains=False)` (see Browsing data), `await run(command, arg=None,
  window=None)`, `await windows()` and `async for e in events(*names)` (see `docs/automation.md`), `By`, `Key`,
  `asyncio`, pydoll's exports and its common exceptions. It prints the last expression's value. Exit 0 done, 1 the
  code raised or timed out (default 300 s), 2 Ardia can't be reached or closed the browser socket (it watches the
  socket, so turning the setting off ends an idle run at once), 130 interrupted.
- `ardia browse <command> [args]` takes agent-browser's commands, flags and output against the running Ardia (see
  The `ardia browse` command).
- `ardia skills install --target general|codex|claude-code|cursor|opencode [--target …] [--project]` installs the
  agent skill (`ardia_cli/skill`: `SKILL.md`, `references/pydoll.md` and `references/browse.md`) into `~/.agents/skills` (general, codex),
  `~/.claude/skills`, `~/.cursor/skills` or `~/.config/opencode/skills`; with `--project`, into `./.agents/skills`,
  `./.claude/skills`, `./.cursor/skills` or `./.opencode/skills`. It replaces only its own `ardia` folder.
- `ardia scripts new|test|install|uninstall|list` writes, tests and installs userscripts (see Userscripts).
- `ardia config path|init|get|set|unset|list|edit|check` reads, writes and checks `config.json` (see
  `docs/config.md`, The ardia command). Never needs Ardia running.
- `ardia theme new|use|list|check` makes, picks and checks colour themes (see `docs/config.md`).
- `ardia run COMMAND [ARG]` runs one of Ardia's commands over `<data dir>/ArdiaControl.sock` (see
  `docs/automation.md`).
- `ardia commands` lists the commands `run` takes (see `docs/automation.md`).
- `ardia windows` lists the windows and their tabs (see `docs/automation.md`).
- `ardia events [EVENT…]` streams browser events (see `docs/automation.md`).
- `ardia on EVENT[,EVENT…] -- PROGRAM` runs a program for each event (see `docs/automation.md`).
- `ardia hooks run|install|uninstall|list` runs the hooks in `hooks.json`, at login through a LaunchAgent (see
  `docs/automation.md`).
- `ardia --version`, `ardia --help`, `ardia exec --help`, `ardia scripts <command> --help`,
  `ardia config <command> --help`, `ardia theme <command> --help`, `ardia hooks <command> --help` and `--help` on
  each of `run`, `commands`, `windows`, `events` and `on`.

`exec` never quits Ardia: it refuses `browser.stop()`, and every WebSocket it opens checks each outgoing message (and
refuses fragmented sends), so
`Browser.close`, `Browser.crash` and `Browser.crashGpuProcess` never leave the process, whether sent one at a time, in
an `execute_commands` batch (checked whole before anything is sent) or straight on the socket. On exit (normal, an
exception or Ctrl-C) it closes only its own page and browser WebSockets. Its WebSockets always connect directly,
ignoring `http_proxy`, `ws_proxy` and the like, so no proxy sees the token.

## The `ardia browse` command

`ardia browse` gives agent-browser's command line (0.35: commands, flags, `@eN` refs, text output with `✓`/`✗`, and
`--json` as `{"success","data","error"}`) on top of the running Ardia, so an agent that knows `agent-browser <args>`
types `ardia browse <args>`. None of agent-browser's code is used. Code: `ardia_cli/browse/` (`cli.py` parses the
globals and runs the commands that need no browser, `daemon.py` owns the connection, `commands.py`, `actions.py`,
`snapshot.py`, `capture.py`, `media.py`, `audit.py`, `react.py`, `vault.py`, `plugins.py`, `readurl.py`).

### Process model

Each session has a background daemon that owns the CDP connection, the refs, the tabs it opened and the tracked
mouse position, so a humanized path starts where the last one ended. `ardia browse` talks to it over a Unix socket.

- Everything lives in `<data dir>/Browse/` (the data dir as `exec` finds it; with `--port` or `--ws`,
  `--data-dir`/`$ARDIA_DATA_DIR`, else the installed app's). The folder is created 0700 and must be a real folder the
  user owns (`O_NOFOLLOW`, checked by `fstat`); every file in it is opened relative to it.
- A session's files are named by `sha256(namespace, endpoint, session)`, never by the session name, which must match
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`: `<key>.lock`, `<key>.sock`, `<key>.json` (session name, pid) and `<key>.log`
  (the daemon's redacted stderr). The socket is bound and connected by a relative name after `fchdir` into the
  folder, so a long data dir never hits the 104-byte `sun_path` limit.
- The daemon holds an exclusive `flock` on `<key>.lock` for its whole life. Only with that lock held does it treat
  an existing `<key>.sock` as stale and unlink it; it binds with umask 0177 so the socket is 0600 from the start,
  records the socket's inode, and at exit unlinks it only if it's still that inode. Both ends check the other's
  uid with `LOCAL_PEERCRED`; the client also checks the socket is a socket, owned and 0600.
- The client starts the daemon (`python -I -c`, its config on stdin, never argv or env) when the socket doesn't
  answer, and waits up to 15 s. A request is one JSON line; the daemon serializes commands, so one gesture never
  interleaves with another, and cancels a command whose client went away (Ctrl-C).
- **Idle disconnect.** After 30 s with no admitted or queued command, no held key or button and no capture lease
  (console or errors, network log, HAR, route, trace, record, stream, init scripts, emulation), the daemon drops the
  CDP connection so the control pill goes away, but keeps its state. The next command reconnects: it re-reads and
  re-checks `ArdiaControl.json` (or `/json/version`) and refuses, ending the session, if the browser instance
  (`pid:generation:browser path`, or the browser WebSocket path) changed. Admission and the idle check run on one
  event loop under the command lock, so a disconnect never races a command.
- **Connection loss is terminal.** When Ardia closes the connection itself (Stop, control turned off, Ardia quit),
  the session ends: queued commands fail, nothing reconnects and nothing is replayed. pydoll's `ConnectionHandler`
  is subclassed so it never reconnects on its own, with a 256 MB `max_size`. A link found dead when a command
  starts is treated the same way, before any endpoint is resolved again; only the daemon's own idle disconnect
  reconnects. A command that may already have been dispatched is never retried; it reports that its outcome is
  unknown (exit 2 on connection loss, 1 otherwise). That covers a timeout on any method that changes something
  (`Page.navigate`, `Page.reload`, `Target.createTarget`/`closeTarget`/`activateTarget`, `Input.*`, `Emulation.*`,
  cookie, Fetch and download methods, `eval`, and every isolated-world call that isn't marked as a read), a daemon
  that goes away after taking a mutating command, and batch: after an unknown outcome the rest of the batch isn't
  run and is reported as `not_run`. Isolated-world reads are retried once when the document changes under them;
  writes (`history.go`, `storage set`, `select`, `pushstate`, scripted scrolls) fail with `document_changed` and are
  never replayed on the new document.
- `close` takes the command lock, marks the session closing, and only then closes its tabs; requests already queued
  or arriving later get `session_closing`. On any stop the daemon lets running handlers settle (up to 5 s, then
  cancels them) before it touches the browser. Every answer is sanitized (registered tokens and any `token=` query
  are masked in each JSON field and in the text) before it's written, and the daemon refuses to send an answer over
  256 MB.
- While disconnected the daemon watches `ArdiaControl.json` every 2 s and exits when it disappears or names another
  instance. It also exits after `--idle-timeout`/`AGENT_BROWSER_IDLE_TIMEOUT_MS` (default 1 h) without commands, and
  on `close`. It takes a lease on its CLI version like `ardia` does.
- Sessions (`--session`, `AGENT_BROWSER_SESSION`, default `default`; `--namespace`) are command-state namespaces on
  the same Ardia, not isolated browsers: cookies, storage and logins are the user's in all of them. A capture or
  route claims its tab in `Browse/claims/` (checked against the owner's lock), and a second live session is refused
  on a tab another one owns. The claim is taken before the CDP domain is enabled (console and errors, including
  `open --capture-console`, network, HAR, route and credentials, trace, record, stream), dropped if enabling fails,
  and released by the matching stop (`har stop`, `unroute` of the last route, `trace`/`profiler stop`,
  `record stop`, `stream disable`) or when the session ends.

### Refs

Refs keep agent-browser's `@eN` form with stable numbers: a node (same browser instance, target, frame, document
and backend node id) keeps its number across snapshots and `find`, so repeat snapshots of an unchanged page give
identical refs. A node seen for the first time takes the next unused number, and a number never moves to another
node, so a delayed `click @e1` can't land on a different element; once its node or document is gone it fails as
stale. Numbers keep rising across documents (a new page's nodes are new nodes), and refs of documents a tab has left
are forgotten. Each ref keeps the browser instance, target id, frame id,
the frame's loader id, the snapshot generation and the backend DOM node id (with role and name for display). A ref
resolves only within that lifetime: the instance must match, the frame must still have the same loader
(`Page.getFrameTree`), and `DOM.resolveNode` must find the node, connected, in the isolated world. Anything else is
`Stale ref @eN: <why>. Run snapshot again` (`code: "stale_ref"`); there's no fallback by role or name. Refs survive
the idle disconnect (backend node ids outlive CDP sessions). `find` gives its element the next ref.

### Input

Humanized input is on by default and goes through pydoll's own classes: `Mouse` (`click`, `dblclick`, `hover`,
`drag`, `mouse move`; Bézier paths with Fitts timing, overshoot and tremor, press and hold timing), `Scroll`
(`scroll`, `scrollintoview`, and scrolling a target into view before a click), and `Keyboard` (`type`, `fill`
(click in, select all, Backspace, then type), `keyboard type`, `press`). pydoll's default timing is kept. Typos are
off: `SteadyKeyboard` overrides `Keyboard._should_make_typo` to return False, and `tests/test_browse.py` fails if a
pydoll update renames it or stops routing humanized typing through it. `keyboard inserttext` stays an instant
`Input.insertText`. `--no-humanize` turns it off for one command, `AGENT_BROWSER_NO_HUMANIZE=1` for the session.
`fill` and `type` follow a field the page swaps out when it's focused (Wikipedia's Vector 2022 search box mounts a new
input on first focus): if the target is detached after the focusing click or `DOM.focus`, and focus sits on an
editable field in the same frame and document that matches it (same tag and type, and a shared id, name, placeholder,
aria-label or title), they type there and report `retargeted: true` (the text output says so too). Anything else
fails with `element_replaced` and types nothing. `auth login` never follows a replacement. Click points get a small
random offset inside the box; a click whose point is covered fails with
`covered by <tag#id.class>`.

Every input command confirms the page got it. Capture listeners in the isolated world count trusted `mousedown`,
`mouseup`, `mousemove`, `keydown`, `keyup` and `wheel` events in the target's frame; after the gesture the command
waits up to 1.5 s for the counts it needs (a click's `mousedown` and `mouseup`, one `keydown` and `keyup` per typed
character, a `wheel` per scroll, a `beforeinput` or `input` for `keyboard inserttext`). If the listeners can't be set
up the command fails before sending anything (`input_unconfirmable`). If none of the events arrive it fails with
`input_not_delivered`; if only some do (a `mousedown` without its `mouseup`), or confirmation fails after sending, it
reports an unknown outcome, since part of the gesture may have landed. A navigation or a closed frame counts as
delivered, and so do keys sent while focus is in an iframe and a raw `mouse` event over one, since those land in
another frame. The listeners add no DOM and nothing the page's world can enumerate.

Held keys and buttons are tracked before each dispatch, and a gesture that's interrupted releases them in a
bounded (2 s), shielded `finally`; `keydown` and `mouse down` stay held across commands on purpose (and keep the
connection up). An interrupted drag reports an unknown outcome. HTML5 `draggable` sources are refused: without
`Input.setInterceptDrags` (gated) a synthetic drag becomes a real macOS drag session.

Chrome doesn't deliver mouse or keyboard input to a hidden tab, and a tab `open` puts in the background is hidden.
Input commands check `document.visibilityState` first and fail with an explanation instead of reporting a click
that never happened. `open --show`, `tab new --show`, `tab <id> --show` or `AGENT_BROWSER_SHOW_TAB=1` show the tab
(`Target.activateTarget`, retried until the page reports visible). `scroll` on a hidden tab keeps pydoll's
humanized timing but applies each step with `scrollBy` in the isolated world; `record` and `stream` refuse a hidden
tab (it paints no frames). Making background tabs take input would need an engine change (for example keeping CLI
tabs visible to the renderer, as a capture does).

### What the page can see

`ardia browse` doesn't change the page's main world by default: locating, snapshots (`Accessibility.getFullAXTree`,
cursor-interactive elements found by computed style), `get`, `is`, `find`, `read`, `storage`, `select`, `pushstate`,
`vitals` (`PerformanceObserver` with buffered entries) and `a11y` (axe-core, `iframes: false`) run in an isolated
world (`Page.createIsolatedWorld`, `ardia-browse`) or through browser-side CDP. `--annotate` lists and labels only the refs whose boxes fall inside the
captured image (agent-browser 0.35.1 prints every ref on the page in its legend; ardia browse lists only what the
image shows), and draws its labels on the
PNG in Python, so nothing is added to the page. The page still sees what a person causes: trusted input events,
focus, scrolling, and the DOM changes those lead to (`select` and `pushstate` dispatch their `input`/`change` and
`popstate` events from the isolated world). Only `eval`, `wait --fn`, init scripts and the React hook run in the
main world. `wait --fn` is the caller's JavaScript like `eval`, so it runs where the page's own globals are; it's
evaluated every 100 ms until it's truthy. There's no `--enable-automation` and no fingerprint spoofing.

The one deviation from agent-browser: the Runtime domain stays off until console or error capture starts (the first
`console` or `errors`, or `open --capture-console`); from then on it's on for that tab for the rest of the session.
`tests/fixtures/browse/probe.html` records `navigator.webdriver`, new window globals, DOM mutations, and the extra
getter reads `Runtime.enable` adds to console arguments (this engine already stringifies each console argument once
without DevTools, so the classic `Error.stack` bait reads positive on every page; the probe counts the reads beyond
that), plus every mouse and key event. The end-to-end test asserts none after open, snapshot, click, fill, get and
screenshot, that the detector does fire once `console` turns Runtime on, and that input was humanized (several
`mousemove`s before `mousedown`, presses over 20 ms, one `keydown`/`keyup` per character with varying gaps, exact
final value).

### Ardia etiquette

`open` without a session tab opens a new background tab in the sidebar (`Target.createTarget` at `about:blank`,
init scripts registered, then `Page.navigate`); later `open`s navigate the session's tab. The user's tabs are only
acted on after `tab <id>` or `tab active` (the page shown in Ardia's last focused window, token path only).
`close` and `tab close` close only tabs this session opened; the guard refuses `Browser.close` on every socket, as in
`exec`. `tab list` shows the user's tabs too (minus prewarmed `about:blank` pages). `alert` and `beforeunload`
dialogs are accepted, as in agent-browser, unless `--no-auto-dialog`. `get cdp-url` refuses any URL that carries a
token or other credentials, however it was chosen (the token path, `--ws`, `$ARDIA_CDP_URL`); it prints only a
plain `--port`/`--ws` URL. After `frame <iframe>`, if that iframe goes away, commands fail with `frame_gone` until
`frame main` or another `frame`, instead of falling back to the main document.

### Gated by the token policy

The engine's ardia-command policy (`ac_cli_token_policy_methods.cc`) refuses these methods, so on the real connection
these commands fail with exit 1, naming the method and the command (`code: "policy_refused"`, `data.method`). Each is
implemented and works against a plain `--port` test server, so allowing the method is the only change needed.

| Command | Needs |
| --- | --- |
| `cookies get\|set\|clear`, `cookies set --curl` | `Network.getCookies`, `Network.setCookie`, `Network.clearBrowserCookies` |
| `state save\|load` | `Network.getAllCookies`, `Network.setCookies` |
| `set viewport\|device\|geo\|media` | `Emulation.setDeviceMetricsOverride`, `Emulation.setTouchEmulationEnabled`, `Emulation.setUserAgentOverride`, `Emulation.setGeolocationOverride`, `Emulation.setEmulatedMedia` |
| `set offline`, `set headers` | `Network.emulateNetworkConditions`, `Network.setExtraHTTPHeaders` |
| `set credentials`, `network route\|unroute` | `Fetch.enable` (and `Fetch.fulfillRequest`, `failRequest`, `continueRequest`) |
| `upload` | `DOM.setFileInputFiles` |
| `download <sel> <path>`, `wait --download [path]` | `Browser.setDownloadBehavior` (`wait --download` waits for the next download that starts after it; `download` clicks and saves) |
| `highlight` | `Overlay.enable`, `Overlay.highlightNode` |
| `clipboard copy\|paste` | `Input.dispatchKeyEvent` with the `copy`/`paste` editing commands |
| `clipboard read\|write` | `Browser.grantPermissions` |
| `trace start\|stop`, `profiler start\|stop` | `Tracing.start`, `Tracing.end` |
| `record start\|stop\|restart` | `Page.startScreencast` (and ffmpeg on PATH for the WebM) |
| `stream enable` | `Page.startScreencast` |
| `drag` of an HTML5 draggable | `Input.setInterceptDrags` |

On the token path Ardia also strips `Cookie`, `Set-Cookie` and `Authorization` from network events, so
`network requests` and HAR files never contain them.

### Skipped

`connect` and `inspect` (the endpoint is Ardia's; opening DevTools on the user's tab isn't something the command
does), `install`, `upgrade`, `doctor`, `dashboard`, `mcp`, `chat` (Ardia has no AI features), `profiles` (it never
reads browser profiles), `confirm`/`deny` and `--action-policy`/`--confirm-actions`, iOS and Safari (`-p ios`,
`--device`, `swipe`, `tap`), cloud providers (`-p`, `--provider`), and launch options that only mean something when
agent-browser starts its own browser (`--headed`, `--profile`, `--executable-path`, `--extension`, `--args`,
`--user-agent`, `--proxy`, `--proxy-bypass`, `--ignore-https-errors`, `--ca-cert`, `--allow-file-access`,
`--hide-scrollbars`, `--webgpu`, `--engine`, `--restore*`, `--state`, `--auto-connect`, `--allowed-domains`); these
fail with a message saying so. `--headers`, `--color-scheme` and `--download-path` are launch-time too: they point at
`set headers`, `set media` and `download <sel> <path>`. Config files (`~/.agent-browser/config.json`, `./agent-browser.json`) and
`AGENT_BROWSER_PLUGINS` are never read. `read <url>` fetches with Python's `urllib`, so it never touches Ardia.

When the reader of its output goes away early (`ardia browse snapshot -i | head`), it stops writing and exits 141, as a
program killed by SIGPIPE would, without a traceback.

### Captures and bounds

Console messages (1,000 and 16 MB), errors (500 and 16 MB) and network requests (1,000 and 32 MB per tab) are ring
buffers that count what they drop; each record's text is cut at 64 KB, header values at 8 KB and a record's headers at
64 KB. Response bodies are capped at 1 MB for `network request`, 2 MB each and 64 MB in all for a HAR, trace events at
2 million, a request to the daemon at 16 MB and its answer at 256 MB. `network requests` and `har` start capturing
at their first use (`Network.enable`).

`stream enable [--port N] [--input]` (once allowed) binds 127.0.0.1 only, with its own random token in the URL (never
the CDP token), checks `Host` and `Origin` exactly (localhost or 127.0.0.1 on its port, or no Origin; `null` is refused), takes at most
4 clients, and is view-only unless `--input`. Messages follow agent-browser's (`status`, `frame` with `seq` and
`metadata`, `input_mouse`, `input_keyboard`, `input_touch`).

### Auth vault and plugins

`auth save <name> --url <https url> [--origin <url>]... --username <u> [--password-stdin]` takes the password on
stdin or from a no-echo prompt; `--password` is refused. It talks to Keychain only through `/usr/bin/security -i`
with the command written to its stdin, so `ps` never shows the secret, and captures its output privately (non-ASCII
passwords come back hex-encoded, which the metadata records). The item is a generic password, service
`dev.ardia.browse.auth`, account `<name>`, in the login Keychain. Non-secret metadata (url, origins, username,
selectors) is `Browse/auth/<name>.json`, 0600. Each credential is bound to https origins (http only for localhost).
`auth login` checks the tab's committed top-level origin and the field's frame origin against them before typing,
types per character, and stops if the page navigates, the frame's loader or origin changes, or focus leaves the
field. The check runs after each `DOM.focus` has returned (so a page's focus handler has already run) and right
before that character's key events; for a field in an iframe it also checks the top document's focus is on that
frame. `tests/fixtures/browse/auth.html#steal` moves focus into a cross-origin iframe on focus; the end-to-end test
checks no character reaches it. Any process running as the user can read items `/usr/bin/security` created (Keychain lets that tool read its
own items without a prompt), the same boundary as `ArdiaControl.json`. `ARDIA_BROWSE_KEYCHAIN` points it at another
keychain file, for tests.

`plugin add <npm-name[@version] | owner/repo[#ref]>` pins the exact version (`npm view`) or commit (`git ls-remote`),
installs it with `npm install --ignore-scripts` into `Browse/plugins/<name>/`, and records it in
`Browse/plugins/registry.json`. Plugins run only through `plugin run` or `auth login --credential-provider`, over
agent-browser's `agent-browser.plugin.v1` protocol (one JSON request on stdin: `protocol`, `capability`, `type`,
`request`; one reply on stdout: `protocol`, `success`, `data` or `error`), with `ARDIA_*` and `AGENT_BROWSER_*` removed
from their environment and a 60 s limit.

### Testing it

`python -m unittest discover -s apps/cli/tests` runs the unit tests (`test_browse.py`). The end-to-end test needs a
built app (never `/Applications`):

```sh
ARDIA_BROWSE_E2E_APP=<build>/Ardia.app python -m unittest apps/cli/tests/test_browse_e2e.py
```

It serves `tests/fixtures/browse` on 127.0.0.1, launches one hidden instance with a DevTools port (`ac launch
--no-wait`) and one on the token path (`open -g -n`, `ARDIA_BACKGROUND=1`, control on in `session.json`), both under
`~/ardia-scratch/browse-impl/e2e` (`ARDIA_BROWSE_E2E_DIR`), runs the core loop, the probe, `--no-humanize`, the
hidden-tab refusal, refs across an idle disconnect and the gated errors, then closes its sessions and quits both.
The a11y command needs `ardia_cli/vendor/axe.min.js`: `build.sh` adds axe-core 4.10.3 (pinned by sha256 and npm's
sha512); from the repo it falls back to `node_modules/axe-core` in a parent folder.

## Browsing data

For daily reports, `exec` has two helpers that read files in Ardia's data dir. They're coroutines that run in a daemon
thread with one 20 s deadline from the call (the session read, the snapshot, every SQLite connection through a
progress handler that aborts past it, row fetching capped at 200,000), so the event loop and the browser socket stay
live (`await history()`; a bare last expression is awaited anyway), `exec --timeout` returns promptly even if a call
is stuck, and the worker deletes its temp snapshot in its own `finally`. At exit a hook sets a closing flag first
(workers check it before making a temp folder and at every backup or copy step), waits up to 1 s for live workers,
then deletes any temp folder still registered. The data dir is the token path's
(`--data-dir`, `$ARDIA_DATA_DIR`, else the installed app's); with `--port`, `--ws` or `$ARDIA_CDP_URL` it's only
`--data-dir` or `$ARDIA_DATA_DIR`, and without one they raise `BrowsingDataError`. Both run the same
`ArdiaControl.json` checks as the token path first (regular file, owned, 0600, live pid), so they work only while
Ardia runs with control on. Neither reads cookies, passwords, Login Data or Web Data.

- `await pinned()` reads `<data dir>/session.json` (the app's persisted state, `apps/browser/src/state/session/persist.ts`) and returns
  one dict per pin: `title` (custom title first), `url` (else the pinned URL), `pinned_url`, `kind` (`favorite` for a
  tile, `pinned` for a tab in a pinned folder), `folder`, `profile` (its name) and `parked` (pins of a profile no
  window shows, from `parkedPins`). Pins mirrored across windows count once. Incognito profiles are skipped.
- `await history(days=1, limit=200, profile=None, domains=False)` reads Chromium's `History` for each `Default` and
  `Profile <id>` folder under `<data dir>/Chromium/` (never incognito, guest or system profiles; `profile` must be a
  profile name or one of those folder names, never a path). Rows per URL, newest first: `url`, `title`, `visits` in
  the window, `total_visits`, `last_visit` (ISO 8601, local time), `profile`. Only http(s) pages; subframe
  navigations and hidden URLs are left out. `domains=True` rolls rows up per domain (`domain`, `visits`, `pages`,
  `last_visit`, `top_title`, `profile`), most visited first. It never touches the live file for writing: it opens it
  read-only (`mode=ro`) and copies it with SQLite's backup API into a private temp dir; the progress callback ends
  the backup once 0.5 s have passed. Chromium keeps `History` exclusively locked while Ardia runs, so that usually
  fails, and it falls back to copying `History` plus its `-wal`/`-journal` (no symlinks, regular files only), checking
  the copy opens, up to 3 tries. A copy taken mid-write can miss the last few visits. The copy checks the deadline
  between 1 MB chunks.

## Userscripts

`ardia scripts` runs Violentmonkey-style userscripts written in TypeScript or JavaScript. A `.user.js` from
Violentmonkey or Tampermonkey works as is. Keys read from the `// ==UserScript==` block: `@name` (the id is its slug),
`@namespace`, `@version`, `@description`, `@match`/`@exclude-match` (Chrome match patterns for content scripts:
`*`, `http`, `https`, `file`, `ftp` schemes, checked when parsed the way `URLPattern::Parse` does, a bit stricter:
hosts canonicalized as the browser does: lowercase, IDN to punycode (refused when it has ß, ς or a joiner, which
IDNA versions treat differently), WHATWG IPv4 forms like `127.1` or `2130706433` to dotted, compressed IPv6, no `%`
anywhere (so no IPv6 scope ids); ports 0 to 65535 without leading zeros and none with scheme `*`),
`@include`/`@exclude` (globs over the whole URL with `base::MatchPattern`: `*` any run, `?` zero or one character,
`\` escapes, matched left to right without backtracking; regexes are refused),
`@run-at` (`document-start`, `document-end` default, `document-idle`), `@inject-into` (`page` default and `auto` run
in the page's world, `content` in an isolated world), `@noframes`. `@grant` other than `none`, `@require` and
`@resource` are ignored with a warning. `@match` and `@include` add up, as in Violentmonkey.

Builds go through esbuild: `--bundle --format=iife --platform=browser --target=chrome130 --tsconfig-raw={}`, not
minified, so relative imports bundle in and no `tsconfig.json` is read (no `paths` aliases). Types are stripped, not
checked. Every input esbuild reports in its metafile must be a `.ts .tsx .mts .cts .js .jsx .mjs .cjs .css` source
(JSON, text and other loader types are refused), a regular file with no other hard links, and inside the script's
own folder tree; nothing may come from Ardia's data dir (the `--data-dir`/`$ARDIA_DATA_DIR` one and the installed
app's), even inside the tree. Both are decided by file identity (`st_dev`, `st_ino` of each ancestor after
resolving symlinks), not by path spelling, since APFS is case-insensitive. A script directly in the home folder or
`/` may import nothing. Otherwise the build fails
before anything is injected or published, so a script can't bundle `ArdiaControl.json` or other files and send
them to a page. `data:` imports are allowed. The tarball ships esbuild in `ardia_cli/bin/esbuild` and an installed
CLI uses only that one; from the repo (`python -m ardia_cli`) it falls back to
`node_modules/@esbuild/darwin-arm64/bin/esbuild` in a parent folder of the package, then `esbuild` on PATH. It never
looks in the cwd.

- `ardia scripts new NAME [--match PATTERN]…` writes `NAME.user.ts` in the cwd (default match
  `https://example.com/*`), never over an existing file.
- `ardia scripts test FILE [--url URL] [--expect JS] [--wait S] [--screenshot PATH] [--keep] [--json] [--data-dir DIR]
  [--port N] [--ws URL]` finds Ardia like `exec` (same exit 2), opens its own background target at `about:blank`,
  attaches a flat session, turns on Runtime and Page, registers the script with `Page.addScriptToEvaluateOnNewDocument`
  (no `worldName`: the token policy refuses named worlds), and only then navigates to `--url` (default: the first
  `@match` whose host has no wildcard, path up to its first `*`). The registered source is a wrapper around the
  build that applies the `@match`/`@include`/excludes rules, `@noframes` and `@run-at` like the extension would, and
  reports start/skip/done through `console.debug` with a random marker. Matching is a port of Chromium's
  `URLPattern::MatchesURL` (`extensions/common/url_pattern.cc`) and `base::MatchPattern` (`base/strings/pattern.cc`)
  in both the wrapper and Python: canonical hosts without trailing dots (`*.` takes subdomains, never of IP
  addresses), the effective port (`:443` matches `https://example.com/`; no port matches any), the path plus query
  unescaped by `UnescapeURLComponent`'s `NORMAL` rule, including its full list of characters left escaped (BiDi
  controls, spaces, default-ignorable and format characters, lock emoji) (`/café/*` matches `/caf%C3%A9`), with a
  raw fallback, and `/foo/*`
  matching `/foo`. `apps/cli/tests` runs both against cases taken from `url_pattern_unittest.cc` and
  `pattern_unittest.cc`, and they agreed with a real Ardia on the glob and percent-encoding cases. Console output and uncaught exceptions count
  as the script's when a stack frame is the script's `sourceURL`; positions map back to the sources through esbuild's
  source map. Cross-origin iframes are reached by `Target.setAutoAttach` with `waitForDebuggerOnStart`, on the token
  path too: the token policy attaches a web frame while it waits to commit, so the script runs at its document start.
  Frames that show an extension's page (a password manager's inline menu, say), a `chrome://` or DevTools page are
  never attached over the token path; a frame that starts loading one cuts off the page's session, as Chrome does for
  `chrome.debugger`. The report says how many iframes never reported. After the top frame ran (or skipped) and the page loaded (at most 10 s
  more, 30 s in all), it listens `--wait` seconds (default 2; Chrome reports unhandled rejections about a second
  late), retrying `--expect` every 100 ms until `Boolean(value)` is true in the page (the report shows the value too). A
  first pass that starts and never finishes, in any frame, fails the test; when the top frame's doesn't finish in 30 s
  the test stops there. Then, in a bounded cleanup, it removes the registration and
  closes the target it made, unless `--keep`. `@inject-into content` is tested in the page's world, with a warning.
  Exit 0 ran without uncaught exceptions and `--expect` truthy, 1 otherwise, 2 Ardia unreachable.
- `ardia scripts install FILE [--data-dir DIR]`, `ardia scripts uninstall NAME [--data-dir DIR]` (by `@name` or id),
  `ardia scripts list [--json] [--data-dir DIR]`. Install and uninstall need control on (the `ArdiaControl.json`
  checks, else the exit-2 line); list doesn't.

### Install contract with the app

The data dir is `--data-dir`, else `$ARDIA_DATA_DIR`, else `~/Library/Application Support/com.ardia.browser`.

1. The CLI takes an exclusive `flock` on `<data dir>/Scripts/.lock` (polled, 30 s deadline). The app takes a shared
   one while it reads and validates. `Scripts/`, `Scripts/scripts/`, record folders and `extension/` must be real
   folders the user owns: each is opened with `O_NOFOLLOW`, and everything below works relative to those folder
   descriptors (`renameatx_np`, `openat`, `rmtree(dir_fd=)`), so a planted symlink is refused, not followed.
2. It keeps its record in `Scripts/scripts/<id>/`: `meta.json` (the parsed metadata, `id`, `world`, `source_file`,
   `installed_at`, `updated_at`), `script.js` (the build) and `source.<ext>` (a copy of the entry file). A new record
   is staged in a temp sibling and only swapped in after the extension built from it validated and was published; if
   that swap fails, the previous extension is swapped back.
3. It regenerates `Scripts/extension/` in a temp sibling: `manifest.json` with only `manifest_version` 3, `name`
   "Ardia Scripts", `version` (`1.<generation / 65536>.<generation % 65536>`), `description` and `content_scripts`;
   `js/<id>.js`; and `generation`. Each content script entry has exactly `matches`, `exclude_matches`,
   `include_globs`, `exclude_globs`, `js`, `run_at`, `all_frames` (false with `@noframes`) and `world` (`MAIN` or
   `ISOLATED`). The whole manifest is checked (keys, every pattern and glob, files, values) before it's published, so
   one bad script can't make the shared extension unloadable, along with the engine's limits: at most 256 content
   script entries, 256 files per entry, 512 distinct files, and a 256 KB manifest. A script with `@match` gets one entry; one with `@include` gets an entry with `matches` `*://*/*` and
   the globs, excluding its `@match` patterns so no page runs it twice. Entries follow install order. When
   `extension/` exists the new folder replaces it with `renamex_np(RENAME_SWAP)` and the old one is deleted, so the
   path never goes missing; a plain rename only when there's none. With no scripts left, `extension/` is removed.
4. It writes `Scripts/generation` (temp file and rename): one more than the largest of `Scripts/generation`,
   `extension/generation` and the last reported one. A crashed run is repaired by the next install or
   uninstall (they rebuild from the records) or `list`: when its data dir was named (`--data-dir`,
   `$ARDIA_DATA_DIR`) or has a live control file, it takes the lock, rebuilds the extension from the records if
   they disagree (`manifest.json` entries, the `js/` files and their bytes), and otherwise publishes
   `Scripts/generation = extension/generation` when the extension is ahead, rebuilds when it is behind, and
   publishes the next generation when there are no records and no `extension/` but `status.json` still reports the
   current generation as loaded. Uninstalling the last script writes `Scripts/generation` before it removes
   `extension/`, so a crash between them looks like an old extension, not a finished uninstall. `list --json` puts
   any repair in its `repaired` key, never ahead of the JSON. `scripts test` never writes to any `Scripts/` folder,
   and nothing creates `Scripts/` under a data dir that wasn't named or live. `extension/generation` holds the same number. A bumped generation with
   no `extension/` means every script was uninstalled.
5. It drops the lock, then polls `Scripts/status.json` for up to 10 s: `{"generation": N, "profiles": {"<profile>":
   {"ok": true} | {"error": "…"} | {"disabled": true} | {"removed": true}}}`; `removed` means no scripts are left and the extension is gone from that profile. Exit 0 when every profile loaded or is turned off, 1 on any
   error, 3 when Ardia didn't report in 10 s (the outcome is unknown; it may still be loading), and 0 with "loads on
   its next launch" when Ardia quit or turned control off while it waited. A newer generation in `status.json` means
   another change replaced this one, and its result is printed.

## How it finds Ardia

1. `--ws URL`, a browser WebSocket URL.
2. `--port N`, a plain DevTools server on 127.0.0.1 (`/json/version`). For test servers only.
3. `$ARDIA_CDP_URL`, like `--ws`.
4. `<data dir>/Chromium/ArdiaControl.json`, with `--data-dir` or `$ARDIA_DATA_DIR`, else the installed app's
   `~/Library/Application Support/com.ardia.browser/Chromium/ArdiaControl.json`.

The active-page route is `GET http://127.0.0.1:P/ardia/active?token=<token>`: `{"targetId": "<id>"}`, or `null` when
New Tab or an Ardia view is showing; anything else is a 404. The CLI calls it directly (no proxy, no Origin header)
with the token redacted like everywhere else, and falls back to the visibility check if it fails.

The app writes `ArdiaControl.json` when the setting is on:
`{"port":P,"browser":"/devtools/browser/<guid>","token":"…","pid":…,"generation":N}`. The CLI opens it without
following links and trusts it only when it's a regular file the user owns, mode 0600, and `pid` is alive. It connects
to `ws://127.0.0.1:P<browser>?token=<token>`; pydoll keeps the query on every `/devtools/page/<id>` URL, so page
sockets carry the token too. A missing, stale or unsafe file, or a refused connection, prints one line and exits 2:
`Ardia isn't running, or "Let the ardia command control Ardia" is off in Settings.` There's no port scanning and no
`/json` fallback on this path. The token never reaches the output: stdout and stderr are redacted as a stream (a token
split across writes is held back until it's complete), and so are log records and everything a logging handler
formats, tracebacks included. pydoll's loggers stay at ERROR. The stream holds back only a tail that could start a
registered token and releases everything on `flush()`, at exit and on SIGTERM or SIGHUP (exit 143). A token printed in
two parts with an explicit flush between them gets through; that gap is accepted.

## Install and upgrade

The app runs `install.sh` with its own environment minus every `ARDIA_*` variable, plus `ARDIA_CLI_HOME`,
`ARDIA_CLI_BIN_DIR` and `ARDIA_CLI_URL` from its `ARDIA_INSTANCE` keys `cliHome`, `cliBinDir` and `cliUrl`
(`CliInstaller.swift`).

`install.sh [--version V] [--sha256 DIGEST] [--uninstall]` (run with `/bin/sh`; `--help`):

- Downloads `https://github.com/mantrakp04/ardia/releases/download/v<V>/ardia-cli-<V>-macos-arm64.tar.gz` (https only)
  into a private temp dir; it runs on Apple silicon only and stops with an error anywhere else. Without `--version` it
  takes the latest release that has the asset. `--sha256` is the only
  digest it trusts (the app passes `Ardia.app/Contents/Resources/ardia-cli.sha256`, which the signed bundle pins), and
  a download needs it: a `.sha256` from the same release would only prove the tarball came from wherever the tarball
  came from. Only a `file://` `ARDIA_CLI_URL` (tests) may go without it, reading `<url>.sha256`. A Debug build has no
  pinned digest, so it installs only that way.
- Verifies the digest, refuses entries outside `ardia-cli-<V>/`, `..` paths, hard links and links pointing outside the
  tree, plus names with control characters, backslashes or ` -> `, extracts to `$ARDIA_CLI_HOME/<V>.partial`, checks
  the extracted tree again (`find`, no line parsing), renames it to `<V>`, and swaps `current` atomically.
- It keeps the current and the previous version, and any version a running `ardia` uses: `ardia_cli` writes
  `<V>/.leases/<pid>` when it starts (from the launcher or `python -m ardia_cli`) and removes it at exit. A lease
  counts only while a process with that pid runs and started no later than the lease was written (`ps -o lstart`
  against the lease's mtime), so a reused pid doesn't pin a version.
- Links `$ARDIA_CLI_BIN_DIR/ardia` (default `~/.local/bin`) to `current/bin/ardia`. It replaces only a link that
  already points into `$ARDIA_CLI_HOME` and refuses anything else. With the default bin dir off the login shell's
  PATH, it adds `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile` once.
- A version that is already current is a no-op. Two runs never overlap: each takes a flock on
  `$ARDIA_CLI_HOME/.lock` through fd 9 (`/usr/bin/lockf -s -t 120 9`). The kernel drops it when the run exits, even on
  SIGKILL; a run that waits 120 s prints `error another install is still running`. Uninstall leaves the empty `.lock`
  file, since deleting a lock file other runs may have open would split the lock.
- Output for the app, one line each: `step resolve|download|verify|install|link`, `version <v>`, `path <rc file>`,
  then `installed <bin path>` or `uninstalled`, or `error <message>` with exit 1.

`$ARDIA_CLI_HOME` defaults to `~/Library/Application Support/Ardia/CLI`. The installed version is
`basename "$(readlink "$ARDIA_CLI_HOME/current")"`; the app reads that link to decide whether to upgrade, and after an
app update it runs `install.sh --version <app version> --sha256 <pinned digest>` in the background. The CLI never
updates itself.

## Build and release

`apps/cli/scripts/build.sh <version> <out dir>` writes `ardia-cli-<version>-macos-arm64.tar.gz` and its `.sha256`:
python-build-standalone CPython 3.13 (release and sha256 pinned in the script), the locked dependencies and
`ardia_cli` in its site-packages, pruned of tests, idlelib, Tk, ensurepip, the unused libpython dylib and
`__pycache__`, plus `bin/ardia`, an sh launcher that resolves its links and runs `python3 -I -m ardia_cli`, and
esbuild (the npm `@esbuild/darwin-arm64` tarball, version, sha256 and sha512 pinned in the script) in
`ardia_cli/bin/esbuild`. About 18 MB; 52 MB installed. `ardia --version` takes about 10 ms; the first `exec` about 1 s while Python writes its
bytecode cache, later ones about 0.15 s.

`scripts/release.sh` builds it into the release's dist dir after the export and writes its digest to
`Ardia.app/Contents/Resources/ardia-cli.sha256` before the app is signed. The release skill's `publish.sh` uploads the
tarball and its `.sha256`.

## Test

Never against the real home. A hidden instance's plain DevTools port works with `--port`:

```sh
scripts/agent/ac launch <Ardia.app> --data /tmp/ardia-cli-test --onboarded
ardia exec --port <port> 't = await new_tab("https://example.com"); await t.title()'
scripts/agent/ac quit /tmp/ardia-cli-test
```

The `ArdiaControl.json` path needs the app's token server: Chrome's plain server accepts `?token=` on the browser
socket but answers 500 on page sockets with a query. For the installer:

```sh
apps/cli/scripts/build.sh 0.0.1 /tmp/ardia-cli-out
HOME=/tmp/ardia-cli-home ARDIA_CLI_URL=file:///tmp/ardia-cli-out/ardia-cli-0.0.1-macos-arm64.tar.gz \
  /bin/sh apps/cli/install.sh
HOME=/tmp/ardia-cli-home ardia skills install --target claude-code
```

`ardia scripts test` needs a running instance; it reaches cross-origin iframes on both paths, and over `--port` also frames that show an extension's page. Install and the
helpers need the token path: an instance launched without `ARDIA_REMOTE_DEBUGGING_PORT` (the app doesn't start its
control server when the port switch is set) and with control on, for example a scratch dir whose `session.json` has
`"settings": {"cliControl": true}`, opened with `open -g -n --env ARDIA_BACKGROUND=1 --env ARDIA_DATA_DIR=<dir>`.
Unit tests (matching parity with node, import confinement, store rollback and recovery, symlink refusal; config
and theme commands against hand-written schemas in `tests/fixtures` that use every keyword of the subset):
`python -m unittest discover -s apps/cli/tests` with the locked dependencies installed.
