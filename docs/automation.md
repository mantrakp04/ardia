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
Going over any other limit closes only that connection. Each event is serialized at most twice (with and without
full URLs) and the bytes are fanned out. Decide requests ride the event path, so a flooded runner can lose one; the
app then uses its default at the deadline. At most 64 decisions wait at once (16 per connection); past that the
default applies at once.

## Protocol

Newline-delimited JSON, UTF-8, one object per line, `\n` terminated.

- Requests: `{"id": 1, "method": "…", "params": {…}}`. `id` is a safe integer or a string, echoed in the reply;
  `params` is optional.
- Replies: `{"id": 1, "result": …}` or `{"id": 1, "error": {"code": "…", "message": "…"}}`. A line that isn't a JSON
  object, or has no usable `id`, gets an error with `"id": null` and the connection stays open.
- Events: `{"event": "tab.opened", "time": 1730400000000, "data": {…}}`, in the order the store changed. Subscribing
  sends no snapshot; call `windows` for that.
- Decide requests (server to client, protocol 2): `{"decide": "d17", "event": "tab.opening", "hook": "name",
  "revision": "…", "deadline": 250, "time": …, "data": {…}}`, sent only to the connection that serves that hook. The
  client answers with an ordinary request, `{"id": 9, "method": "answer", "params": {"decide": "d17", "answer":
  {…} | [ … ] | null}}`; the reply is `{"ok": true}` or `bad_request` for an id that is unknown, already answered,
  late, cancelled or another connection's, and for one whose hook the connection no longer serves at that revision. When the deadline passes, the decision is superseded (a new navigation in that tab,
  a closed tab, a changed hooks.json, a newly approved rule) or control stops, the server sends
  `{"decide": "d17", "cancel": true}` and uses its default; a later answer is refused. Answers are client requests
  rather than bare reply lines so the native layer's per-connection count of requests waiting for a reply stays
  right.

Error codes: `bad_request`, `unknown_method`, `unknown_command`, `refused`, `no_window`, `failed`.

### Who's included

One eligibility rule serves `windows`, events and command targets: a window is eligible when it is a normal browser
window or Little Ardia, and not private; a tab is eligible when its window is eligible and its profile isn't
incognito. A tab shown in Peek is not part of its window's tabs and sends no events until it lands in one. Events for
something that closed are built from the previous snapshot, and only if it was eligible there.

Internal pages (`state/pages/urls.ts`) report their URL without the query or fragment (they can hold history and
bookmark searches) and their fixed page title.

### Methods

- `hello` `{"caller"?: {"name", "app"?}}` → `{"app": "Ardia", "version": "0.2.44", "protocol": 2}`. Protocol 2 added
  `subscribe`'s options, `run`'s `tab`, `answer` and decide requests; protocol 1 clients keep working. `caller` names
  who runs the client for the pill (The pill), display only.
- `caller` → `{"ok": true}` puts the connection's `hello` caller on the pill now (`ok` is false without one). The
  `browse` daemon and `scripts test` call it, since their CDP connections carry no name.
- `commands` → `[{"id", "title", "scope", "variants": [ids] | null}]`: the automatable commands. `title` is the menu
  title (else the command bar's, else the id), `scope` is `"page"`, `"window"` or `null`.
- `run` `{"command", "arg"?, "window"?, "tab"?}` → `{"ok": true}` once the command was dispatched (not necessarily finished).
  `command` is a catalog id, `arg` one of its variant ids. It runs through `runCommand`, exactly as the menu or a
  shortcut would. `window` must be an eligible window id, else `no_window` (no fallback to another window); without
  it, the last focused eligible window (windows never focused come after, in window order); with no browser window
  open at all it runs with none, as the menu does (`newTab` and `newWindow` open one); otherwise `no_window`. A
  command that asks for confirmation still asks. `tab` targets one eligible tab without activating or focusing
  it, for commands whose scope is `"page"` and `closeTab`, `togglePin`, `moveTabUp`, `moveTabDown`, `duplicateTab`
  and `bookmarkPage` (`bad_request` otherwise); a tab target is dispatched before Peek, Little Ardia, sidebar and
  command-panel handling, so `closeTab` closes exactly that tab; with `window` too, the tab must be in that
  window. Window, tab, profile and eligibility are checked just before the command runs: a closed, moved or
  private target is `no_window`, never a fallback to the focused tab.
- `windows` → `[{"id", "kind": "normal"|"little", "focused", "profile", "profileName", "tabs": [{"id", "url",
  "title", "profile", "active", "pinned", "group": id|null}]}]`. `active` is the tab in the window's focused pane.
- `subscribe` `{"events": [names] | ["*"], "fullUrls"?: bool, "idle"?: {"tab"?: [s], "user"?: [s]}, "hooks"?:
  [hook objects]}` → `{"ok": true, "served": [names]}`, then events on that connection until it closes. Calling it
  again replaces everything. `"*"` is every event except the named-only ones (below). Without `fullUrls`, URLs
  come without their query and fragment. `idle` gives the thresholds in whole seconds (at least 60, at most 8
  each) for `tab.idle`/`tab.resumed` and `user.idle`/`user.active`; an idle event goes only to a connection that
  asked for its threshold. `hooks` are the program decide and omnibox hooks this connection serves, as written in
  hooks.json: the app takes a hook only when one with the same name and the same content (revision) is in its own
  hooks.json and no other connection serves it; `served` lists the ones it took and `revisions` their revisions.
  Subscribing again cancels this connection's outstanding decisions. The runner keeps the exact definitions that
  subscription accepted and runs a decide request only when its `revision` matches one of them, so a request for an
  approved revision never runs an edited program.
- `answer` `{"decide", "answer"}`: see Protocol.

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
| `app.launched` | `launchId`, `restored`, `focusedWindowId`, `windows` (ids) |
| `app.quitting` | none |
| `app.activated`, `app.deactivated` * | none |
| `tab.idle` | `windowId`, `tabId`, `profile`, `url`, `title`, `pinned`, `idle` (threshold, s), `idleSince` (ms) |
| `tab.resumed` | `windowId`, `tabId`, `profile`, `url`, `title`, `pinned`, `idle` |
| `media.started`, `media.stopped` | `windowId`, `tabId`, `profile`, `url`, `title` |
| `tab.crashed` | `windowId`, `tabId`, `profile`, `url`, `title`, `reason`, `status` |
| `notification.shown` * | `windowId`, `tabId`, `profile`, `origin`, `title` (≤ 200), `body` (≤ 500) |
| `peek.opened` | `windowId`, `tabId` (the Peek's), `profile`, `url`, `title`, `sourceTabId` |
| `peek.closed` | the same, plus `keptAsTab` |
| `littleArdia.opened` | `windowId`, `profile`, and `tabId`, `url`, `title` when it opened a page |
| `split.created` | `windowId`, `splitId`, `tabIds` |
| `split.closed` | `windowId`, `splitId` |
| `pin.added` | `windowId`, `tabId`, `profile`, `url`, `title`, `as` (`tile`/`row`) |
| `pin.removed` | `windowId`, `tabId`, `profile`, `url`, `title` |
| `tab.moved` | `windowId` (new), `fromWindowId`, `tabId`, `profile`, `url`, `title` |
| `profile.switched` | `windowId`, `from`, `profile`, `profileName` |
| `system.sleep`, `system.wake` * | none |
| `user.idle`, `user.active` * | `idle` (threshold, s) |
| `page.error` | `windowId`, `tabId`, `profile`, `url`, `status` |

\* Named-only: `"*"` never includes them; a subscriber names each one. Notification text never goes into a hook's
environment (no `ARDIA_TITLE`, no `ARDIA_URL`) and the runner never logs it.

- **URLs** are minimized by default: no query, no fragment. A connection (or a hook, `"fullUrls": true`) asks for
  full ones. Internal pages report their redacted URL either way.
- **Eligibility** is checked when the event is built: nothing from private windows or incognito profiles. Peek
  events carry the Peek tab, which `windows` leaves out of its window's tabs (it isn't part of the window until it
  lands); a Peek that lands as a tab sends `peek.closed` with `keptAsTab: true` and then `tab.opened`.
- `tab.navigated` comes from a committed main-frame navigation (the page's commit signal, not a store URL change,
  so a cancelled navigation, showing New Tab or restoring a parked page send nothing). Same-document URL changes
  (single-page apps) count, with `sameDocument: true`. `title` is what the tab has at that moment and may be empty or
  stale. The web view reports the signal with each navigation update: the last committed URL (`committedUrl`), the
  time of the last document commit (`committedAt`) and the main frame's HTTP status (`httpStatus`); a new
  `committedAt` is a document navigation, a new URL alone is same-document.
- `page.error` is sent once per committed main-frame document whose status is 400 to 599: never for subframes,
  same-document changes, cancelled or stale commits. Builds whose engine doesn't report `httpStatus` send none.
- `app.launched` is recorded once per process, after the session is restored and the first window is up, with its
  original time. The server keeps it and replays it to a connection that subscribes to it within 2 minutes of
  launch (monotonic clock), once per connection. The hooks runner runs a launch hook at most once per `launchId`,
  hook and hook revision, kept in `<data dir>/ArdiaHooks.state.json` across runner restarts, so a reconnect never
  runs launch hooks twice. A hook added after the launch doesn't get a stale launch: the connection that already
  received it isn't sent it again.
- `app.quitting` is sent when the app starts to quit, best effort: it is queued before the socket closes and never
  holds the quit open.
- `tab.idle`: a tab is touched while it is the active tab of the focused window, and when it was last activated. It
  goes idle after the threshold without that (checked every 30 s) and fires once per idle stretch; `tab.resumed`
  follows when it is shown again. Pinned tabs are included, with `pinned: true`.
- `system.sleep`, `system.wake`, `user.idle` and `user.active` come from the native system signals
  (`platform/systemSignals.ts`); an older build without them just sends none.

Events are built from store and page subscriptions only while some connection subscribes to them, one family at a
time (the core diff, the extra store diffs, crashes, tab idle, lifecycle, notifications, user idle), so a browser
nobody listens to pays nothing.

## Decide hooks

Hooks that answer before something happens, with a deadline after which Ardia does its default.

| Event | Asked when | `data` | Answer | Default | Program deadline |
|---|---|---|---|---|---|
| `tab.opening` | a top-level navigation the user starts: typed or pasted in the address bar, a link opened in a new tab or window, a URL from another app. Never redirects, subresources, same-tab link clicks, restores or reloads | `url`, `via` (`typed`, `newTab`, `link`, `external`), `windowId`, `tabId`, `profile` | `{"url"}` to rewrite, `{"cancel": true}` | open the original | 250 ms |
| `link.opening` | a URL arrives from another app, after `tab.opening` | `url`, `source` (`bundleId`, `appName`, null when unknown) | `{"profile"?, "open"?: "tab"\|"littleArdia"\|"window", "window"?}`, `{"drop": true}` | Ardia's usual routing | 250 ms |
| `download.deciding` | a download has finished (it moves after completion; nothing hooks the engine before the download starts) | `url`, `origin`, `filename`, `mime`, `size`, `path` (where it is now), `profile` | `{"folder"}` | the file stays where it is | 2 s |
| `permission.requested` | a site asks for camera, microphone, location, notifications… | `origin`, `kinds`, `windowId`, `tabId`, `profile` | `{"permission": "deny"\|"ask"\|"allow"}` | the normal prompt | 2 s |

- **Two forms.** Declarative rules in hooks.json that the app evaluates itself, in process and synchronously, with
  no program and no deadline to speak of; they work with CLI control off, since they are config. Or a program hook
  (`run`) served by the hooks runner: the request's JSON is its stdin (`{"decide", "event", "deadline", "data"}`),
  its stdout JSON is the answer, and only `ARDIA_EVENT` is set. Program hooks need control on and a runner.
- **Precedence.** Hooks are tried in file order; the first that applies (its `match` patterns, `from`, `kinds`)
  and is active (approved where approval is needed) answers. A rewrite list where no rule matches doesn't apply, so
  the next hook gets its turn. A program hook that applies while no runner serves it means the default; it never
  falls through. Never "fastest answer wins".
- **Defaults.** A timeout, a crash, invalid JSON, a disconnect, overload or an answer outside what is allowed all
  mean the default. One deadline per decision, from the moment Ardia intercepted it, on a monotonic timer; nothing
  waits synchronously on the main thread.
- **URLs Ardia can't read unambiguously fail closed.** Rules and program answers work on a strict reading of the
  URL (`lib/urlParts.ts`), not React Native's `URL`. Hosts are lowercased, Unicode hosts become punycode (with the
  omnibox's `punycodeEncode`, so `https://bücher.de/` matches `https://xn--bcher-kva.de/*` and the other way
  round) and an explicit default port (`:443`, `:80`) is dropped. A URL with a backslash, user info (`@` in the
  authority), percent-encoding in the host, a Unicode host that can't be converted unambiguously (IDNA deviation
  characters like `ß`, ideographic or fullwidth dots, compatibility characters NFKC would change, a lookalike the
  omnibox would flag), an IPv4 written any way but plain dotted-decimal (`127.1`, `0177.0.0.1`, `0x7f…`,
  `2130706433`), an IPv6 that isn't already canonical, a port with leading zeros, port 0 or one above 65535, or
  whitespace and control characters never matches a pattern, is never rewritten and never counts as the same
  origin. `https://evil.example\@bank.example/` is read by Chromium
  as evil.example, so no `https://bank.example/*` rule touches it.
- **Rewrites.** A rewrite answer must be a canonical http or https URL without credentials; `rewrite` rules build it
  from a template with `{url}`, `{origin}`, `{host}`, `{path}`, `{query}` and `{hash}`. A query-stripping template
  (`{origin}{path}`, `{origin}{path}{hash}`) needs no approval only because the expanded target is checked to have
  exactly the original origin; if it doesn't, Ardia uses its default. The replacement keeps the original
  disposition and profile and always goes out as not user-initiated (a typed URL that a rule leaves alone keeps its
  value). A link opened in a new tab or window already has contents the engine prepared and started loading before
  JS hears of it: a rewrite adopts those contents into the tab, which keeps the opener, and navigates them to the
  new URL with a plain GET, so nothing is left behind and no POST body is replayed to the new URL.
- **Cancelling a link opened in a new tab** prevents the tab and closes the page the engine prepared for it at once
  (`discardOffered`), but it can't prevent or undo that page's first request: the server has already seen it, with
  its cookies, and whatever it did on its side stays done. A typed URL or one from another app is decided before
  anything loads.
- While a program decides a typed navigation the tab stays where it was; for a new tab it opens empty and navigates
  once answered (closed again on cancel).
- **What a program sees.** Decide data has the URL without its query and fragment unless the hook says
  `"fullUrls": true`; a program that rewrites query parameters needs it. The runner trims again on its side.
- **link.opening** decides before any tab exists. At every launch native holds incoming links (no early Little Ardia
  tab, no parked link tabs) until JS reports its link policy with `setHoldIncomingLinks(hold, hooksStamp)`: the app reports it
  once its hooks are loaded and again on every change, `true` while an active `tab.opening` or `link.opening` hook
  exists. `hooksStamp` is the stamp (device, inode, size, mtime, ctime) native returned with the hooks.json read the
  rules came from, so a decision is never filed under a newer file; native keeps the fast-path fingerprint only when
  that stamp is the file's current one. The fingerprint also covers config.json and `automation-approvals.json`, so
  native takes its fast path before JS loads only when the last report said no hold and none of the three changed
  since. A routed or rewritten link never adopts contents loaded for it
  under another profile.
- **Permissions.** A hook can deny or leave the normal prompt; `allow` means "show the prompt", never an unattended
  grant. A deny is answered on the engine's own request id and never remembered. A request dismissed or replaced
  while a program decides is never granted.
- **Downloads.** `download.deciding` fires once per download that progresses during this launch: one
  the engine reported in progress (on the raw `downloads.changed` stream, which also carries a small file's
  in-progress report before it has a path) and then finished. Finished history the engine replays at launch or
  when another profile's list loads is never decided. Never for private profiles, off-the-record or dangerous
  downloads. The answer moves the finished file. A `folder` rule or a program answer may only pick `~/Downloads`, its subfolders, or a folder the user
  approved (a `folder` rule outside Downloads, after approval); `.` and `..` parts are refused. The app asks the
  native side (`moveCompletedDownload(path, folder)` in `platform/systemSignals.ts`) to move it; a missing folder
  is created only from an allowed root down, and a name already taken gets ` (1)`, ` (2)`… before the extension. That side only
  moves a file the app itself just downloaded, only into `~/Downloads` or the folders the app passed in
  `setApprovedDownloadFolders` (sent at startup and on every change, approvals included, from the approved rules). It resolves through
  descriptors, never overwrites and keeps the quarantine attribute. Native checks the engine's SHA-256 of the
  bytes after claiming the file into a private staging folder; a download without an engine hash can't be moved
  (`noIdentity`): Save Page (including MHTML) and WebKit downloads have none, so `download.deciding` hooks leave
  them where they are. A file with another hard link is refused (`linked`), at the claim and again after it is
  placed; a second move of a download while one runs is `busy`. If a failed move couldn't put the file back, it stays in that staging folder beside the download and the
  row points there (`stagedPath`, read from the staging folder's open descriptor, so a renamed folder still reports
  the real place; `strayPath` names a swapped-in file that couldn't be taken back out of the destination, and the app logs it), so
  it's never lost. Each move writes a small journal entry before the claim and removes it after the commit; at the next
  launch a leftover entry is settled: a placed file counts as moved, a staged file goes back to its original path if
  that is free, and otherwise stays staged and is reported like a failed move's `stagedPath`. Hashing runs outside the
  mover's lock, so engine events are never held up by a large file. On success the download's row points at
  the new path (native also reports it, so Show in Finder keeps working after relaunch); a timeout, an error or no
  answer leaves the file where it is. Folders cross the bridge as `~/…`.
  **Trust boundary.** The checks stop a swapped or linked file from being moved in place of the download; they don't
  stop a process running as the same user that already holds a writable descriptor or a hard link to the file from
  rewriting it after the check. Such a process is outside what Ardia defends against: it can already read
  `ArdiaControl.json` and drive the browser.
  Code: `state/automation/downloadHooks.ts`.
- **Floods.** At most 64 pending decisions (16 per runner connection), 200 hooks and 50 rewrite rules per hook; the
  runner runs at most 16 decide programs at once (4 per hook) and gives up at the deadline. Command hooks run at
  most 10 commands per 10 s each, so a hook that triggers itself stops.

## Approvals

config.json can't enable control, add search destinations or grant permissions (`docs/config.md`), and files
keep that boundary: privileged automation declared in a file stays inactive until the user approves it in Settings
› Advanced › Automation. Approvals live in the app's data dir (`automation-approvals.json`, version 1), never in
the config folder, keyed by a hash of the exact rule, so editing a rule needs a new approval. Remove dismisses a
pending rule (it stays off and stops asking); revoking an approved one turns it off. A one-line toast says when
something new waits.

- Privileged: rewrites to another origin, link routing, `folder` outside `~/Downloads`, every program decide hook,
  every omnibox hook, address bar providers from config.json that send what you type somewhere
  (`state/omnibox/providerApproval.ts`, backed by this store), and `launchActions` outside the safe list.
- Not privileged: `cancel`, `drop`, permission rules, rewrites whose template only drops the query
  (`{origin}{path}`, `{origin}{path}{hash}`), folders inside `~/Downloads`, and launch actions from the safe list
  (`newTab`, `newWindow`, `newLittleArdia`, `focusCommandBar`, `toggleSidebar`, `nextTab`, `previousTab`,
  `selectTab`, `selectLastTab`: nothing that closes, clears, writes the clipboard or opens a dialog).
- Code: `state/automation/approvals.ts` (`isApproved`, `approveRule`, `removeRule`, `offerRules`),
  `hookPolicy.ts` (what needs approval), `omniboxApprovals.ts` (the adapter for address bar providers).

## Omnibox providers from hooks

`{"name": "jira", "omnibox": {"title": "Jira", "keyword": "j"}, "run": ["~/bin/jira-suggest"]}` (or `"global": true`
instead of a keyword) registers an address bar provider through `registerOmniboxProvider` while the runner that
serves it is connected and the hook is approved; it is unregistered on disconnect, removal or revocation. Each
query is a decide request (`event: "omnibox.query"`, `data: {"text", "keyword"}`, 300 ms) with the same protocol;
an aborted query is cancelled (the program is killed). The program prints `[{"title", "url", "subtitle"?,
"icon"?}]`; at most 8 rows are kept, only http(s) URLs, and a bad or late answer gives no rows.

### The pill

`run` shows the "ardia is controlling Ardia" pill like a CDP connection does: it counts as active from the moment
the request arrives until its reply is written, then the usual 3 s hold. A `run` or `caller` on a connection whose
`hello` named a caller puts that name (and app icon) on the pill, the most recent one winning (`docs/cli.md`). The indicator combines CDP connections and
socket runs; neither overwrites the other. `hello`, `commands`, `windows` and `subscribe` don't show it, so a hooks
runner connected all day doesn't keep it up. Stop hides it at once.

## The ardia command

Every command finds the socket from `--data-dir` / `$ARDIA_DATA_DIR`, else the installed app's data dir, connects,
checks the server's uid, and exits 2 with one line when Ardia isn't running, control is off or the check fails.

- `ardia run COMMAND [ARG] [--window ID] [--tab ID] [--json]` runs a command (`COMMAND:ARG` works too, as in
  shortcut ids). Exit 1 if refused, unknown (with the closest ids) or `no_window`. A dropped connection after
  sending is reported, never retried, with exit 2 and a line saying the command may or may not have run.
- `ardia commands [--json]` lists command ids, titles and variants.
- `ardia windows [--json]` prints the windows and their tabs.
- `ardia events [EVENT…] [--json] [--full-urls] [--idle DURATION]` streams events (default all but the named-only
  ones) until interrupted; `--json` prints the raw lines. Event names are checked against the table above (a typo
  fails with the closest names, exit 1); a lost connection exits 2. `dropped` is reported on stderr in the text
  form. `--idle` sets the threshold for the idle events.
- `ardia on EVENT[,EVENT…] [--match PATTERN]… [--timeout S] [--idle DURATION] [--full-urls] -- PROGRAM [ARGS…]`
  runs PROGRAM for each event. PROGRAM's stdout and stderr are the terminal's; the runner's own lines go to stderr.
  Without Ardia it waits and retries like a reconnect.
- `ardia hooks run|install|uninstall|list` runs the hooks in `hooks.json` in the config folder (`docs/config.md`'s
  resolver, so a scratch instance uses its own). `list` shows each hook's kind (`event`, `command`, `decide`,
  `scheduled`, `omnibox`), trigger and action.
- From a script or a hook's program, call the commands: `ardia run … --json`, `ardia windows --json` and
  `ardia events --json` give the same replies and lines as the socket, and `ardia browse` drives the pages. They
  find the socket the same way (`--data-dir`, `$ARDIA_DATA_DIR`, else the installed app's), and the shared options
  go before or after the command (`docs/cli.md`, Shared options).

### Running a hook

- The event's JSON line is the hook's stdin (authoritative). The environment gets `ARDIA_EVENT`, `ARDIA_WINDOW_ID`,
  `ARDIA_TAB_ID`, `ARDIA_PROFILE`, `ARDIA_URL`, `ARDIA_TITLE`, all set or removed for every run (never inherited from
  the runner), NULs stripped and each cut to 4 KB. `notification.shown` sets neither `ARDIA_TITLE` nor `ARDIA_URL`.
  A hook without `fullUrls` gets URLs without their query and fragment even when another hook asked for full ones.
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
    { "name": "yt-to-media", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"], "run": ["~/bin/yt-hook"], "timeout": 30, "fullUrls": true },
    { "name": "fresh-tab", "on": "app.launched", "command": "newTab" },
    { "name": "park", "on": "tab.idle", "idle": "2h", "command": "togglePin" },
    { "name": "standup", "at": "09:55", "days": ["mon", "tue", "wed", "thu", "fri"], "timezone": "Europe/Paris", "run": ["~/bin/standup"] },
    { "name": "sync", "every": "1h", "run": ["~/bin/sync"] },
    { "name": "old-reddit", "on": "tab.opening", "rewrite": [{ "match": "https://www.reddit.com/*", "to": "https://old.reddit.com{path}{query}" }] },
    { "name": "no-tiktok", "on": "tab.opening", "match": "https://*.tiktok.com/*", "cancel": true },
    { "name": "slack-to-work", "on": "link.opening", "from": ["com.tinyspeck.slackmacgap"], "route": { "profile": "Work", "open": "tab" } },
    { "name": "invoices", "on": "download.deciding", "match": "https://billing.example.com/*", "folder": "~/Downloads/Invoices" },
    { "name": "no-camera", "on": "permission.requested", "kinds": ["camera", "microphone"], "permission": "deny" },
    { "name": "router", "on": "link.opening", "run": ["~/bin/route-link"] },
    { "name": "jira", "omnibox": { "title": "Jira", "keyword": "j" }, "run": ["~/bin/jira-suggest"] }
  ]
}
```

- A hook has a `name` (unique), exactly one trigger and exactly one action. Any other key, or a key that doesn't go
  with the hook's trigger, makes the file invalid.
- Triggers: `on` (a list of event names or `["*"]`; a string is a list of one; a decide event goes alone), `at`
  (`"HH:MM"`, local time or `timezone`, an IANA name; optional `days`, from `mon` to `sun`), `every` (a duration,
  at least `1m`), or `omnibox` (`{"title", "keyword"}` or `{"title", "global": true}`, with `run`).
- Actions: `run` (a non-empty list; a string is refused, with the `["/bin/sh", "-c", "…"]` form suggested; `timeout`
  in seconds, more than 0 and at most 86400, for event and scheduled hooks only), `command` (an Ardia command id,
  optional `arg` a variant; no process is spawned: the runner sends `run` targeting the event's window, and its tab
  when the command acts on a page; `app.launched` targets `focusedWindowId`; a schedule targets the last focused
  window), or a decide answer: `rewrite` (1 to 50 `{"match", "to"}`) or `cancel: true` for `tab.opening`; `route`
  (`{"profile"?, "open"?}`) or `drop: true` for `link.opening`; `folder` (`~/…`) for `download.deciding`;
  `permission` (`deny`, `ask` or `allow`) for `permission.requested`.
- Filters: `match` (userscript match patterns, `urlmatch.py` in the CLI and `lib/matchPattern.ts` in the app; for
  permissions the origin is matched as `origin/`), `from` (bundle ids or app names, `link.opening`), `kinds`
  (permission kinds, `permission.requested`), `idle` (`"30m"`, at least `1m`, required for and only with the idle
  events), `fullUrls`.
- Durations are a whole number and `s`, `m`, `h` or `d`.
- The app reads hooks.json too, from the same config folder (never the working directory or its parents), for the
  decide rules, the program decide and omnibox hooks it lets a runner serve, and approvals. It applies the same
  checks; an invalid file keeps the last good set in both.
- Names are unique. `hooks run` re-reads the file when it changes (polled every second, following a symlinked file): it reads a regular file of at most 1 MB, checks the
  whole thing, and swaps in the new set at once; an invalid file keeps the last good set and logs why. A removed or
  changed hook stops taking events and drops what was waiting; a run already going finishes. The app re-reads it
  through its config watcher, cancels pending decisions and asks again for anything privileged that changed.

### Scheduled hooks

The runner fires them and passes a `schedule.fired` event (it never comes from Ardia): `{"hook", "schedule": "at" |
"every", "occurrence": "name@2026-11-02T09:55", "scheduledAt", "catchUp", "timezone"?}`.

- `at` computes the next occurrence in its time zone and checks at least every 20 s. Occurrences missed while the
  Mac slept (or the runner wasn't running) are not replayed: the first check after a gap fires once, with
  `catchUp: true`, and then moves to the next occurrence after now. Times before the runner started are skipped.
- `every` runs on the monotonic clock (which stops while the Mac sleeps). When the wall clock shows a whole missed
  interval, it fires one catch-up and restarts the interval; it never bursts.
- No overlapping runs: if the hook's previous run is still going or waiting, that firing is skipped and logged.

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
generation check; `automationHooks.test.mjs` for launch replay, named-only events, URL minimization, tab targets,
the new events, decide rules with control off, approvals, program decisions bound to their runner with duplicate,
foreign and late answers refused, permissions, link routing and omnibox hooks; `hookFile.test.mjs` for the file
checks, approval classes and rewrite safety) and a hidden-instance check over the real socket. The CLI side: unit tests against a fake socket
server speaking the protocol (`test_hooks_more.py` covers validation, subscription options, launch dedupe across
restarts, command hooks and their rate limit, decide programs, cancels and timeouts, and the scheduler on fake
clocks), and one end-to-end run against a hidden instance.
