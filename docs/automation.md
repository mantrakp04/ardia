# Automation: commands and events

The `ardia` command can run Ardia's commands and react to what happens in the browser: tabs opening, pages loading,
windows taking focus. Hooks run outside the app as ordinary programs, so nothing third-party runs in Ardia's process.
Issue #717. Config files and themes are `docs/config.md`; page scripting over CDP is `docs/cli.md`.

## The control socket

- While "Let the ardia command control Ardia" (`cliControl`) is on, the app listens on a Unix socket at exactly
  `<data dir>/ArdiaControl.sock` (the app's own data dir; `ARDIA_DATA_DIR` for test instances).
- **Safe place.** The server starts only if the data dir is a real directory (not a symlink) owned by the user and not
  writable by group or others; otherwise it logs one line and reports an error status. The socket is created under a
  0177 umask, so it is 0600 from the start (a socket is made 0777 less the umask, so 0077 would leave it 0700).
- **One owner.** The server holds an exclusive `flock` on `<data dir>/ArdiaControl.sock.lock` for as long as it
  serves. Only after taking the lock may it remove an old path, and only a socket (never a regular file, directory or
  symlink). It records the device and inode it bound and, on stop, unlinks the path only if it is still that socket.
  A second instance that can't take the lock serves nothing and disturbs nothing.
- **Both ends check the peer.** The server refuses a peer whose uid (`getpeereid`) isn't its own; the CLI checks the
  server's uid on the connected socket (`LOCAL_PEERCRED`) before sending anything. A pathname check alone is not
  authentication. No token: the bar is the user's own account, as for the token file.
- A path longer than `sun_path` allows (103 bytes plus the terminator) is refused with a logged line and an error
  status; the CLI says so instead of hanging.
- **Turning it off.** Turning `cliControl` off, or quitting, closes every connection, drops what is queued and removes
  the socket. Each request is tagged with the server's generation; just before dispatch JS checks that the generation
  is current and `cliControl` is on, so a request accepted just before Stop never runs. A command already dispatched
  finishes.
- **Native and JS.** A Swift module owns the socket, the lock, the peer check, framing and the limits, on its own
  queue with non-blocking I/O, never the main thread. JS owns what the methods do.

### Limits

At most 16 connections (more are closed at accept). Per connection: one input line at most 1,048,576 bytes before its
newline, an incomplete line closes the connection after 30 s, at most 32 requests waiting for a reply, at most 4 MB of
output buffered. Events beyond 1,000 waiting on one connection drop the oldest waiting events (never a reply, never a
partly written line); the next event written carries a top-level `"dropped": N` with the count since the last one.
Going over any other limit closes only that connection. Each event is serialized once and the bytes are fanned out.

## Protocol

Newline-delimited JSON, UTF-8, one object per line, `\n` terminated.

- Requests: `{"id": 1, "method": "…", "params": {…}}`. `id` is a safe integer or a string, echoed in the reply;
  `params` is optional.
- Replies: `{"id": 1, "result": …}` or `{"id": 1, "error": {"code": "…", "message": "…"}}`. A line that isn't a JSON
  object, or has no usable `id`, gets an error with `"id": null` and the connection stays open.
- Events: `{"event": "tab.opened", "time": 1730400000000, "data": {…}}`, in the order the store changed. Subscribing
  sends no snapshot; call `windows` for that.

Error codes: `bad_request`, `unknown_method`, `unknown_command`, `refused`, `no_window`, `failed`.

### Who's included

One eligibility rule serves `windows`, events and command targets: a window is eligible when it is a normal browser
window or Little Ardia, and not private; a tab is eligible when its window is eligible and its profile isn't
incognito. A tab shown in Peek is not part of its window's tabs and sends no events until it lands in one. Events for
something that closed are built from the previous snapshot, and only if it was eligible there.

Internal pages (`state/pages/urls.ts`) report their URL without the query or fragment (they can hold history and
bookmark searches) and their fixed page title.

### Methods

- `hello` → `{"app": "Ardia", "version": "0.2.44", "protocol": 1}`.
- `commands` → `[{"id", "title", "scope", "variants": [ids] | null}]`: the automatable commands. `title` is the menu
  title (else the command bar's, else the id), `scope` is `"page"`, `"window"` or `null`.
- `run` `{"command", "arg"?, "window"?}` → `{"ok": true}` once the command was dispatched (not necessarily finished).
  `command` is a catalog id, `arg` one of its variant ids. It runs through `runCommand`, exactly as the menu or a
  shortcut would. `window` must be an eligible window id, else `no_window` (no fallback to another window); without
  it, the last focused eligible window (windows never focused come after, in window order); with no browser window
  open at all it runs with none, as the menu does (`newTab` and `newWindow` open one); otherwise `no_window`. A
  command that asks for confirmation still asks.
- `windows` → `[{"id", "kind": "normal"|"little", "focused", "profile", "profileName", "tabs": [{"id", "url",
  "title", "profile", "active", "pinned", "group": id|null}]}]`. `active` is the tab in the window's focused pane.
- `subscribe` `{"events": [names] | ["*"]}` → `{"ok": true}`, then events on that connection until it closes. Calling
  it again replaces the list.

### Which commands

Every catalog command (`state/commands/commandCatalog.ts`) carries an explicit automation decision, and a test fails
on a command without one, so a new command is never automatable by accident. Only catalog ids are accepted, never
native selectors. Refused (`refused`), and left out of `commands`:

- anything that ends the app (`quit` and the like);
- anything that changes which engine shows a page (`togglePageEngine`, its sign-in transfer);
- anything whose effect is a setting the config allowlist leaves out (`docs/config.md`), however it is stored;
- anything touching control itself;
- for now, commands that need an argument other than a variant id (a profile, window, bookmark, extension, folder
  or closed-item id: `switchProfile`, `moveTabToWindow`, `openBookmark`, …). An `arg` that isn't one of the
  command's variants is `bad_request`.

This is more than the token path grants: the token path reaches web pages through an allowlist of CDP methods,
while the socket reaches the browser's own commands (tabs, windows, sidebar, splits, groups, profiles' UI, sharing,
clipboard writes, internal pages). That is the point of it, and it is opt-in behind the same setting.

### Events

| Event | `data` |
|---|---|
| `window.opened`, `window.closed`, `window.focused` | `windowId`, `kind`, `profile` |
| `tab.opened`, `tab.closed`, `tab.activated` | `windowId`, `tabId`, `profile`, `url`, `title` |
| `tab.navigated` | `windowId`, `tabId`, `profile`, `url`, `title`, `sameDocument` |
| `settings.changed` | `keys` |

`tab.navigated` comes from a committed main-frame navigation (the page's commit signal, not a store URL change, so a
cancelled navigation, showing New Tab or restoring a parked page send nothing). Same-document URL changes (single-page
apps) count, with `sameDocument: true`. `title` is what the tab has at that moment and may be empty or stale. The web
view reports the signal with each navigation update: the last committed URL (`committedUrl`) and the time of the
last document commit (`committedAt`); a new `committedAt` is a document navigation, a new URL alone is
same-document.

Events are built from store and page subscriptions only while some connection subscribes to them, so a browser nobody
listens to pays nothing.

### The pill

`run` shows the "ardia is controlling Ardia" pill like a CDP connection does: it counts as active from the moment
the request arrives until its reply is written, then the usual 3 s hold. The indicator combines CDP connections and
socket runs; neither overwrites the other. `hello`, `commands`, `windows` and `subscribe` don't show it, so a hooks
runner connected all day doesn't keep it up. Stop hides it at once.

## The ardia command

Every command finds the socket from `--data-dir` / `$ARDIA_DATA_DIR`, else the installed app's data dir, connects,
checks the server's uid, and exits 2 with one line when Ardia isn't running, control is off or the check fails.

- `ardia run COMMAND [ARG] [--window ID] [--json]` runs a command (`COMMAND:ARG` works too, as in shortcut ids).
  Exit 1 if refused, unknown (with the closest ids) or `no_window`. A dropped connection after sending is reported,
  never retried, with exit 2 and a line saying the command may or may not have run.
- `ardia commands [--json]` lists command ids, titles and variants.
- `ardia windows [--json]` prints the windows and their tabs.
- `ardia events [EVENT…] [--json]` streams events (default all) until interrupted; `--json` prints the raw lines.
  Event names are checked against the table below (a typo fails with the closest names, exit 1); a lost connection
  exits 2. `dropped` is reported on stderr in the text form.
- `ardia on EVENT[,EVENT…] [--match PATTERN]… [--timeout S] -- PROGRAM [ARGS…]` runs PROGRAM for each event.
  PROGRAM's stdout and stderr are the terminal's; the runner's own lines go to stderr. Without Ardia it waits and
  retries like a reconnect.
- `ardia hooks run|install|uninstall|list` runs the hooks in `hooks.json` in the config folder (`docs/config.md`'s
  resolver, so a scratch instance uses its own).
- In `ardia exec`: `await run(command, arg=None, window=None)`, `await windows()`, and `async for e in events(*names)`.
  With `--port`, `--ws` or `$ARDIA_CDP_URL` they need `--data-dir` or `$ARDIA_DATA_DIR` and raise without one, so a
  test browser never drives the installed Ardia by accident. Errors are `CommandError` (`.code`, `.message`) and
  `ControlUnreachable`; each call opens its own connection.

### Running a hook

- The event's JSON line is the hook's stdin (authoritative). The environment gets `ARDIA_EVENT`, `ARDIA_WINDOW_ID`,
  `ARDIA_TAB_ID`, `ARDIA_PROFILE`, `ARDIA_URL`, `ARDIA_TITLE`, all set or removed for every run (never inherited from
  the runner), NULs stripped and each cut to 4 KB.
- PROGRAM runs from argv, never through a shell unless PROGRAM is one; event values are never put into the command
  line. A leading `~` in PROGRAM is expanded, nothing else is.
- `--match`/`match` take userscript match patterns (`urlmatch.py`); several match if any does; an event without a URL
  never matches a hook that has patterns.
- One run at a time per hook, at most 100 waiting (the oldest dropped, with a warning). A run is stopped after its
  timeout (default 60 s): SIGTERM, then SIGKILL 5 s later. Each run starts in its own session and process group and
  the signals go to the group, so a descendant still holding the output pipes is stopped with it; the run ends by the
  deadline plus the grace periods even if something escaped the group. Stdin is written with the same deadline. A
  failure to start is logged and the hook carries on.
- The CLI's own connection buffers at most 1,000 unread events, like the server: past that the oldest are dropped,
  counted, and logged (`ardia events` on stderr) before the next one. Replies are never dropped. A request whose write
  was attempted counts as possibly sent, whatever fails after.
- On disconnect the runner reconnects with backoff (1 s doubling to 30 s), resubscribes, and logs that events may have
  been missed in between.

### hooks.json

```json
{
  "hooks": [
    { "name": "yt-to-media", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"], "run": ["~/bin/yt-hook"], "timeout": 30 }
  ]
}
```

- Keys: `name`, `on` (a list of event names or `["*"]`; a single string is taken as a list of one), `match`
  (likewise), `run` (a non-empty list; a string is refused, with the `["/bin/sh", "-c", "…"]` form suggested) and
  `timeout` (seconds, more than 0, at most 86400). Any other key makes the file invalid.
- Names are unique. `hooks run` re-reads the file when it changes (polled every second, following a symlinked file): it reads a regular file of at most 1 MB, checks the
  whole thing, and swaps in the new set at once; an invalid file keeps the last good set and logs why. A removed or
  changed hook stops taking events and drops what was waiting; a run already going finishes.
- `hooks install` writes the user LaunchAgent `dev.ardia.hooks` (`ProgramArguments` = the installed `ardia` launcher's
  stable path, `$ARDIA_CLI_HOME/current/bin/ardia`, then `hooks run --log ~/Library/Logs/Ardia/hooks.log`;
  `RunAtLoad`, `KeepAlive`, `ProcessType` `Background`; `WorkingDirectory` the home folder; `EnvironmentVariables`
  with the installing shell's `PATH` and `ARDIA_DATA_DIR` set to empty) and loads it with `launchctl bootout` then
  `bootstrap gui/<uid>` (bootstrap retried twice). The data dir is pinned by the empty `ARDIA_DATA_DIR`, not by
  `--data-dir`: `--data-dir` would also move the config folder to `<data dir>/config`, and the empty value keeps a
  `launchctl setenv ARDIA_DATA_DIR` from redirecting the agent. It refuses when the launcher isn't installed.
  `uninstall` runs `bootout` and removes the plist. Both refuse when a scratch data dir is in use (`--data-dir` /
  `$ARDIA_DATA_DIR`), so tests never touch the real LaunchAgent. `hooks list` shows the hooks, checks the file
  (exit 1 when it's invalid) and reads `launchctl print` for the agent's state.
- Output goes to `~/Library/Logs/Ardia/hooks.log` (0600, opened without following links), rotated at 5 MB to one
  `hooks.log.1`; stdout and stderr are drained as they come and a single line longer than 64 KB is cut. `hooks run`
  writes the log itself (`--log PATH`, `-` for the terminal), so the plist's `StandardOutPath` and
  `StandardErrorPath` are `/dev/null`: launchd would hold its own descriptor to the file and defeat the rotation.

## Tests

The app side: node tests for the handlers (the command classification, refusals, `no_window` without fallback, the
eligibility rule including closes and Peek, internal-page redaction, event shapes, subscribe replacement, the
generation check) and a hidden-instance check over the real socket. The CLI side: unit tests against a fake socket
server speaking the protocol, and one end-to-end run against a hidden instance.
