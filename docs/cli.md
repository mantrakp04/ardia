# The `ardia` command

`ardia` drives a running Ardia from the terminal. `ardia browse` is how an agent drives the browser: agent-browser's
commands on top of [pydoll](https://pydoll.tech) 3.0. The other commands run Ardia's own commands, stream its events,
run hooks and userscripts, edit its config and read its browsing data. It's a separate download, not part of the app
bundle. The app ships `install.sh`, and runs it when the user opts in during onboarding or in Settings ("Let the ardia
command control Ardia").

While it drives a page, a pill floats over the bottom centre of the page ("Claude Code is controlling Ardia · Stop", or
"The ardia command is controlling Ardia" when it can't tell who runs it; Stop turns the setting off). It shows for a
DevTools connection (`browse`, `scripts test`) and for `ardia run`, which presses Ardia's own commands; reading and
organizing (`tabs`, `groups`, `apply`, `windows`, `commands`, `events`, `pinned`, `history`, `config`) never shows it. It overlays the page and never resizes it. It shows at the first connection and stays 3 s after
the last one closes, so a burst of commands shows one steady pill; turning the setting off hides it at once. One per
window: the focused pane of a split, the full screen page, or the Peek while one is open
(`apps/browser/src/components/window/CliControlPill.tsx`, `useCliIndicator` in `state/app/cliControl.ts`).

The pill names who runs the command (`ardia_cli/caller.py`). The command walks its own process ancestry once (parent
pids through libproc's `proc_pidinfo`, each one's executable through `proc_pidpath` and its first two arguments
through `KERN_PROCARGS2`; well under a millisecond). A known agent anywhere up the chain wins: `claude` is Claude
Code, then Codex, Cursor Agent, Gemini CLI, OpenCode, Aider, Amp, Goose, Crush, Droid, Qwen Code, Copilot CLI, Kiro
and Cline, matched on the program's name, on `argv[0]` (Claude Code's binary is a version number) or on the script an
interpreter (`node`, `bun`, `deno`, `python`, `ruby`) runs. Otherwise it's the app that owns the chain: the first
ancestor inside an `.app` bundle, named by the outermost bundle's `CFBundleDisplayName`, else `CFBundleName`, else its
folder (so VS Code's helpers name VS Code), and that bundle's icon replaces the terminal glyph. Otherwise (a process
reparented to launchd, ssh) it's "ardia". The name and the bundle path travel as `{"name", "app"?}` in the control
socket's `hello` (`docs/automation.md`); a `browse` client puts them in its request and the daemon, which outlives
the client, tells the app over a short socket connection (`hello`, then `caller`) when it connects to Ardia and
whenever a request comes from someone else. `scripts test` does the same as it connects. The name is display only:
it never changes what a connection may do, and both ends strip control and invisible characters and keep 40
characters (the app keeps `app` only when it's an absolute, outermost `.app` path). When several run at once the pill
names the most recent one; a pill that hid and shows again without a new name says "The ardia command".

Code: `apps/cli` (`ardia_cli`, `install.sh`, `scripts/build.sh`). Dependencies are pinned with hashes in
`apps/cli/requirements.lock` (regenerate with `uv pip compile requirements.in --python-version 3.13
--python-platform aarch64-apple-darwin --generate-hashes --no-annotate --no-header -o requirements.lock`, then copy
the pins into `pyproject.toml`).

## Commands

- `ardia browse <command> [args]` takes agent-browser's commands, flags and output against the running Ardia (see
  The `ardia browse` command).
- `ardia pinned [--json] [--data-dir DIR]` lists the favorites and pinned tabs, and `ardia history [--days N]
  [--limit N] [--profile P] [--domains] [--json] [--data-dir DIR]` the recent history (see Browsing data). `--days`
  defaults to 1 and `--limit` to 200 (0 for no limit). A pin's `kind` is `favorite` for a Top Apps tile (`folder` is
  its tile folder) and `pinned` for a pinned row or a tab in a pinned folder (`folder` is the folder). They read
  `session.json` from version 2 on, the tab's `pin` field or the older `pinned` flag. Exit 0 done, 1 the data
  couldn't be read or ran out of time, 2 Ardia can't be reached.
- `ardia notes [get|set|append|list|rm] [SITE] [TEXT|-]` keeps plain-text notes per site for the user's own agent
  (see Site notes). It hands its arguments to `ardia_cli/notes.py` (`main(argv)`), which runs them as
  `ardia browse notes …`, with the shared options given before `notes` put first.
- `ardia skills install --target general|codex|claude-code|cursor|opencode [--target …] [--project]` installs the
  agent skill (`ardia_cli/skill`: a `SKILL.md` of about 5K characters with the fast paths (read, batch, select,
  script, notes), plus `references/troubleshooting.md`, `script.md`, `userscripts.md`, `config.md`, `automation.md`
  and `daily-reports.md` read only when a task needs them) into `~/.agents/skills` (general, codex),
  `~/.claude/skills`, `~/.cursor/skills` or `~/.config/opencode/skills`; with `--project`, into `./.agents/skills`,
  `./.claude/skills`, `./.cursor/skills` or `./.opencode/skills`. It writes each file it ships in place (temp file,
  then rename, so a linked file is replaced, never written through) plus a `.ardia-skill` marker (vendor, version and
  the files it wrote), removes only files an earlier marker listed that it no longer ships, and leaves every other
  file alone. A folder counts as ours only when it isn't a link and its marker is a plain file naming vendor
  `ardia`. `install` also adopts a copy from before the marker, but only when its files, none of them links, have
  exactly the paths and SHA-256 of a version we shipped (`ardia_cli/skill_hashes.json`, frozen, written from git
  history by `apps/cli/scripts/skill-hashes.py`, which `--check`s it). Anything else, a foreign skill named ardia
  included, is refused with the folder's path; `--replace` removes that one folder (a link itself, never its target)
  and installs fresh. Each folder it wrote goes into `$ARDIA_CLI_HOME/skills.json`. `ardia skills refresh` never
  adopts: it rewrites every marked folder in that list and every marked user-level folder above, prints
  `skipped <folder>` for the rest, refuses a linked subfolder, and keeps only our folders in the list. `install.sh` runs it after
  each upgrade, so installed copies follow the CLI. Both also install cua-driver's skill next to ours (see Computer
  use); `--no-cua` skips it.
- `ardia computer <cua-driver command> [args]`, `ardia computer setup [--no-grant]` and
  `ardia computer mcp-config [--target …]` operate native Mac apps through the pinned cua-driver (see Computer use).
- `ardia scripts new|test|install|uninstall|list` writes, tests and installs userscripts (see Userscripts).
- `ardia config path|init|get|set|unset|list|edit|check` reads, writes and checks `config.json` (see
  `docs/config.md`, The ardia command). Never needs Ardia running.
- `ardia theme new|use|list|check` makes, picks and checks colour themes (see `docs/config.md`).
- `ardia run COMMAND [ARG]` runs one of Ardia's commands over `<data dir>/ArdiaControl.sock` (see
  `docs/automation.md`).
- `ardia commands` lists the commands `run` takes (see `docs/automation.md`).
- `ardia windows` lists the windows and their tabs (see `docs/automation.md`). With `--json` each tab also has
  `targetId`, the DevTools page target `ardia browse` attaches to (null when the tab's page isn't loaded), and
  `pageGeneration`, bumped whenever that target changes (a slept tab reloading). The app asks each live tab through
  ArdiaCore's `devToolsCall` (`Target.getTargetInfo`, engine call `engine.cliTabTargets`); an older build leaves both
  out. A tab a page opened whose first page is still loading isn't asked and has a null `targetId` until that page
  commits: the DevTools attach counts as a touch of its blank initial document, after which Chrome and the tab show
  about:blank instead of the pending address (`awaitsFirstDocument`; `packages/ardiacore/scripts/pending-address-check.mjs
  <Debug app>` checks it).
- `ardia tabs --usage` lists each tab with its renderer's process id, CPU and memory, hottest first, and
  `ardia tabs --pid N` names the tabs in a process, so a pid from `top -o power` leads to its tab (`workspace`'s
  `usage`, `docs/automation.md` › Tabs and groups). Use counts come from the option names on the command event;
  `error_code` `no_pid` means an engine that reports no process ids.
- `ardia tabs`, `ardia groups` and `ardia apply` list and organize tabs and groups by id: open URLs into a window,
  profile, group or spot, move tabs between groups, windows and profiles without reloading, pin, mute, sleep, wake,
  close, rename and set icons; create, nest, reorder, pin, collapse, recolour, ungroup, close and delete groups; and
  apply a JSON batch of those in one call (`ardia_cli/workspace_cli.py`; protocol, operations and rules in
  `docs/automation.md` › Tabs and groups). Groups can be named by id or by name (`--group Work`, `ardia groups update
  Work …`); output names them next to their ids (`created group 💼 Work (g-…) with 4 tabs`, `moved Inbox (tab-…)`).
  `--json` prints the app's reply. Exit 0 done, 1 refused, a bad request
  or a batch stopped at a failing operation, 2 Ardia can't be reached or the connection dropped after sending. Human
  output shows control characters in page text, titles and names as `\u00NN` (`ardia_cli/printable.py`), so a page
  title can't drive the terminal (an OSC 52 clipboard write, say): see Terminal output.
- `ardia events [EVENT…]` streams browser events (see `docs/automation.md`).
- `ardia on EVENT[,EVENT…] -- PROGRAM` runs a program for each event (see `docs/automation.md`). PROGRAM's output goes
  to the terminal untouched; event data such as `ARDIA_TITLE` and `ARDIA_URL` comes from pages, so a program that
  prints it should escape control characters, as the CLI's own output does.
- `ardia hooks run|install|uninstall|list` runs the hooks in `hooks.json`, at login through a LaunchAgent (see
  `docs/automation.md`).
- `ardia feedback --title TITLE [--kind bug|slow|idea|other] [--attach FILE]… [--command CMD] [--data-dir DIR] TEXT|-`
  reports a problem or an idea to the developer (see Feedback and the star nudge). Exit 0 sent (or the same report
  already went out today), 1 not sent and kept on the Mac (the line says why), 2 a missing or bad title, description
  or attachment.
- `ardia star [--data-dir DIR]` stars github.com/mantrakp04/ardia for the user, run only after they said yes (see
  Feedback and the star nudge). Exit 0 starred or the page opened, 1 neither worked.
- `ardia --version`, `ardia --help`, `ardia browse --help`, `ardia scripts <command> --help`,
  `ardia config <command> --help`, `ardia theme <command> --help`, `ardia hooks <command> --help` and `--help` on
  each of `pinned`, `history`, `run`, `commands`, `windows`, `events`, `on`, `apply`, and `tabs` and `groups` and
  their commands. `ardia browse <command> --help` (or `ardia browse help <command>`) prints that command's entry; a
  command without one prints its line from the overview and `flags: none`, never the whole overview.

`ardia exec` is gone: `ardia browse` is the one way to drive the browser. `ardia exec …` (and any other unknown
command) prints `ardia: unknown command '…'` with where to go instead, and exits 2. What `exec` offered maps to
`ardia browse` for pages, `ardia pinned` and `ardia history` for `pinned()` and `history()`, and `ardia run`,
`ardia windows` and `ardia events` for `run()`, `windows()` and `events()`.

### Terminal output

Page text, titles, notes, names and other text from pages or files reach the terminal only with their control
characters (C0, C1 and DEL) shown as `\u00NN`, so a page can't write escape sequences (an OSC 52 clipboard write, a
screen clear) through the CLI. Two places do it, so new commands get it without asking: `ardia browse` and
`ardia notes` text output in `render` (`browse/daemon.py`), keeping line breaks and tabs, so snapshots, page text and
notes read as before; and `cli.main` wraps stdout and stderr for every other command (`printable.inert_output`), with
single-line fields (titles in `tabs`, `windows`, `events`, `pinned`, `history`) escaping line breaks too. Other text
(accents, CJK, Arabic, emoji) is untouched. JSON output (`--json`, and `AGENT_BROWSER_JSON` for browse) keeps
C0 controls as `json.dumps` writes them and escapes only U+007F–U+009F (raw there because of `ensure_ascii=False`) as
`\u00NN` (`printable.json_safe`, in browse's JSON render and in the JSON-mode stdout writer), so it decodes to the
same values and non-ASCII text stays readable; stderr is always guarded. The `\u00NN` form keeps text that is itself
JSON (a script's result) valid JSON.

### Shared options

`--port N`, `--ws URL` and `--data-dir DIR`, plus `--timeout S` and `--json` where a command has them, go before the
command or after it: `ardia --port 9222 browse snapshot` and `ardia browse --port 9222 snapshot` are the same, and so
are `ardia --json windows`, `ardia windows --json` and `ardia hooks --data-dir DIR list`. `cli.py` moves the ones in
front of (or between) the command words to just after them, so a flag written after the command wins over the same
flag before it; arguments after `on`'s `--` are never touched. A command that doesn't take a flag given before it
says so and exits 2 (`ardia: windows doesn't take --port`). For `browse` the flags go to the front of browse's own
arguments, where its parser reads them; `browse` takes `--port`, `--ws`, `--data-dir` and `--json`, not `--timeout`.

Each has an environment variable, and a flag wins over it: `ARDIA_PORT`, `ARDIA_WS`, `ARDIA_DATA_DIR`. The
endpoint comes from `--ws`, else `--port`, else `$ARDIA_WS`, else `$ARDIA_PORT`, else `$ARDIA_CDP_URL`, else
`<data dir>/Chromium/ArdiaControl.json` (see How it finds Ardia). For `browse`, `ARDIA_WS` or `ARDIA_PORT` is
passed as `--ws`/`--port` only when its arguments have none of `--ws`, `--port` and `--cdp` (a `--port` after
`stream` is the stream's own), so the session is keyed on the endpoint it really uses. A bad `ARDIA_PORT` exits 2.

The CLI never quits Ardia: every DevTools WebSocket it opens (`browse`, `scripts test`; `ardia_cli/guard.py`) checks
each outgoing message and refuses fragmented sends, so `Browser.close`, `Browser.crash` and `Browser.crashGpuProcess`
never leave the process, whether sent one at a time, in an `execute_commands` batch (checked whole before anything is
sent) or straight on the socket. Its WebSockets always connect directly, ignoring `http_proxy`, `ws_proxy` and the
like, so no proxy sees the token.

## The `ardia browse` command

`ardia browse` gives agent-browser's command line (0.35: commands, flags, `@eN` refs, text output with `✓`/`✗`, and
`--json` as `{"success","data","error"}`) on top of the running Ardia, so an agent that knows `agent-browser <args>`
types `ardia browse <args>`. None of agent-browser's code is used. Code: `ardia_cli/browse/` (`cli.py` parses the
globals and runs the commands that need no browser, `daemon.py` owns the connection, `commands.py`, `actions.py`,
`snapshot.py`, `changes.py`, `fields.py`, `capture.py`, `media.py`, `audit.py`, `react.py`, `vault.py`, `plugins.py`,
`readurl.py`; site notes in `ardia_cli/notes.py`).

An agent's loop is short: `snapshot -i` once, then actions, each of which prints what it changed, so it rarely needs
another snapshot; repetitive work goes in one `batch` on stdin. Input is instant unless `--humanize`, a session with
no tab uses the user's active one, and text output stops at about 6,000 characters.

### Process model

Each session has a background daemon that owns the CDP connection, the refs, the tabs it opened and the tracked
mouse position, so a humanized path starts where the last one ended. `ardia browse` talks to it over a Unix socket.

- Everything lives in `<data dir>/Browse/` (`--data-dir`, else `$ARDIA_DATA_DIR`, else the installed app's, with
  `--port` and `--ws` too). The folder is created 0700 and must be a real folder the
  user owns (`O_NOFOLLOW`, checked by `fstat`); every file in it is opened relative to it.
- A session's files are named by `sha256(namespace, endpoint, session)`, never by the session name, which must match
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`: `<key>.lock`, `<key>.sock`, `<key>.json` (session name, pid) and `<key>.log`
  (the daemon's redacted stderr). The socket is bound and connected by a relative name after `fchdir` into the
  folder, so a long data dir never hits the 104-byte `sun_path` limit.
- The daemon holds an exclusive `flock` on `<key>.lock` for its whole life. Only with that lock held does it treat
  an existing `<key>.sock` as stale and unlink it; it binds with umask 0177 so the socket is 0600 from the start,
  records the socket's inode, and at exit unlinks it only if it's still that inode. Both ends check the other's
  uid with `LOCAL_PEERCRED`; the client also checks the socket is a socket, owned and 0600.
- Files are created with `openat(dir_fd, …, O_CREAT)`, retried up to four more times on `ENOENT`
  (`paths.open_at`): on macOS, when several processes create the same new file through a directory descriptor at
  once, all but one get `ENOENT` on the first try (racing eight processes for one new lock, seven failed in nearly
  every round; the second try always succeeded). A path that really is missing still fails after the retries.
  `tests/test_browse.py` races eight processes for one new lock and expects exactly one holder.
- The client starts the daemon (`python -I -c`, its config on stdin, never argv or env) when the socket doesn't
  answer, and waits up to 15 s. A request is one JSON line; the daemon serializes commands, so one gesture never
  interleaves with another, and cancels a command whose client went away (Ctrl-C). Every command has a limit (120 s;
  `batch`, `read` and `record` 600 s; `script` its `--timeout` plus 30 s; `wait` its own timeout plus 30 s), after which
  it's stopped with `command_timeout` (outcome unknown for one that changes something) and the session is free again;
  a command queued behind another gives up after 30 s with `session_busy`, naming what's running.
- **Idle disconnect.** After 30 s with no admitted or queued command, no held key or button and no capture lease
  (console or errors, network log, HAR, route, trace, record, stream, init scripts, emulation; an action's own network
  watch, see Changes after actions, ends with the action and never counts), the daemon drops the
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
- **A detached tab.** Ardia can detach a tab from the connection while a command uses it: the tab closed, crashed,
  went to sleep (Memory Saver, `ardia tabs sleep`) or moved to a window Ardia keeps for itself. The page then has no
  CDP session, and a command sent without one goes to the browser target, which answered `'Page.getFrameTree' wasn't
  found` (a multi-page `read` printed that for each page whose reading tab went away). `Page.send` now refuses to send
  without a session (`code: "tab_detached"`), `Page.detach` fails the calls still waiting for an answer at once (a
  mutating one as an unknown outcome) instead of leaving them to their timeout (a `Page.navigate` waited its 30 s), and
  the load and settle waits stop on it. A multi-page `read` reads that page again in a new tab, once
  (`READER_TRIES`; telemetry `read_tabs_reopened`); a second detach fails that page only.
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
- **Tab registry.** Sessions share `Browse/tabs-<sha256(instance)>.json` (version 2, under `tabs.lock`; `tabs.py`), so
  a `tN` id is the same in every session and never moves to another tab. It records which session opened each tab
  (`opened`), which tab each live session uses (`using`), tabs a reader or script opened only to read
  (`note_temporary`: hidden from `tab list`, adoptable by no one, kept after the daemon dies so `temptabs.sweep`
  closes them after the next connect or at `close`; `note_intent` marks a tab about to be created, so a daemon that
  dies mid-create leaves a marker `claim_orphans` hands to the next one), and close reservations: `reserve_close`
  refuses a tab another live session uses or is closing, `finish_close` (or `release_close`, which keeps the
  temporary record) ends it, and adopting a reserved tab fails with `tab_closing`. Ids carry when they were last seen;
  a target list deletes only ids older than it. Dead sessions' entries are pruned on every write, every write stays
  under 1 MiB (dead intents, then dead sessions' temporaries oldest first, then unreferenced ids), and a file it
  can't read (over 8 MiB, or damaged) starts over.

### Refs

Refs keep agent-browser's `@eN` form with stable numbers: a node (same browser instance, target, frame, document
and backend node id) keeps its number across snapshots and `find`, so repeat snapshots of an unchanged page give
identical refs. A node seen for the first time takes the next unused number, and a number never moves to another
node, so a delayed `click @e1` can't land on a different element, short of the strict redraw follow below; once its
node or document is gone it fails as stale. Numbers keep rising across documents (a new page's nodes are new
nodes), and refs of documents a tab has left are forgotten. Each ref keeps the browser instance, target id, frame id,
the frame's loader id, the snapshot generation and the backend DOM node id (with role and name for display). A ref
resolves only within that lifetime: the instance must match, the frame must still have the same loader
(`Page.getFrameTree`), and `DOM.resolveNode` must find the node, connected, in the isolated world. Anything else is
`Stale ref @eN: <why>. Run snapshot again` (`code: "stale_ref"`). Refs survive the idle disconnect (backend node ids
outlive CDP sessions). `find` gives its element the next ref. When a ref's node is gone but its document isn't, a fresh
collection looks for the same role and name. The ref follows that node, with a `→ @eN was redrawn…` notice on stderr
and `followed_redrawn_ref` in telemetry, only when all of this holds: the old ref was the only node with that role
and name in the last whole-page collection that saw it (a scoped `snapshot -s` keeps what the ref had); the new node
is the only one now; both sit in the same frame; and both have the same chain of named ancestors (`walk_in_context`
in `snapshot.py`: dialog, row, form, region names, the page title left out). So a row's "Delete" that had siblings,
or a dialog reopened for another item, never resolves to the wrong element. Otherwise the error names the new ref.

Selectors are CSS, `@eN`, `xpath=…` (or `//…`), `text=Save` (substring, case-insensitive; `text="Save"` exact),
`role=button[name="Save"]`, and `:has-text("…")` anywhere in a CSS selector (`[role=row]:has-text("FAS-1") td`).
`[role=main]` also matches `<main>`, and so on for the other implicit roles (`nav`, `dialog`, `tr`, `a[href]`, `h1`–`h6`,
`select`, text inputs, …); a bare role word such as `grid` that matches no element is tried as that role. A selector
that matches several elements takes the first visible one. `find` waits up to 1.5 s for its element to appear.

### Input

Input is instant by default: clicks dispatch straight at the target point, `fill` focuses the field with `DOM.focus`,
selects all, presses Backspace and puts the text in (one `Input.insertText` for a plain field, see below), and scrolls
are single wheel events. `--humanize` (or `AGENT_BROWSER_HUMANIZE=1` for the session) turns on pydoll's own humanized
classes: `Mouse` (`click`, `dblclick`, `hover`, `drag`, `mouse move`; Bézier paths with Fitts timing, overshoot and
tremor, press and hold timing), `Scroll` (`scroll`, `scrollintoview`, and scrolling a target into view before a
click), and `Keyboard` (`type`, `fill` (click in, select all, Backspace, then type), `keyboard type`, `press`), with
pydoll's default timing. Typos are off: `SteadyKeyboard` overrides `Keyboard._should_make_typo` to return False, and
`tests/test_browse.py` fails if a pydoll update renames it or stops routing humanized typing through it.
`keyboard inserttext` stays an instant `Input.insertText`. `--no-humanize` and `AGENT_BROWSER_NO_HUMANIZE=1` are
still accepted; they force it off, so `AGENT_BROWSER_HUMANIZE=1 AGENT_BROWSER_NO_HUMANIZE=1` is off and a
`--humanize` flag beats both.
`fill` and `type` follow a field the page swaps out when it's focused (Wikipedia's Vector 2022 search box mounts a new
input on first focus): if the target is detached after the focusing click or `DOM.focus`, and focus sits on an
editable field in the same frame and document that matches it (same tag and type, and a shared id, name, placeholder,
aria-label or title), they type there and report `retargeted: true` (the text output says so too). Anything else
fails with `element_replaced` and types nothing. `auth login` never follows a replacement. Click points get a small
random offset inside the box; a click whose point is covered fails with
`covered by <tag#id.class>`, and one outside the laid-out viewport with `outside_viewport` (the point and the viewport
size). A tab with no size yet (0×0, seen on a loaded hidden test instance) is waited for up to 2 s, then given a
1280×800 device metrics override for that command, cleared afterwards and never over the session's own `set viewport`;
where Emulation is gated (the token path) it fails with `no_viewport`.

`fill` on a `date`, `time`, `datetime-local`, `month`, `week`, `color` or `range` input doesn't type (typing
`2026-11-09` into the segmented date field stored `0009-02-06`, and a time field stayed empty). As Playwright's
`fill` does, it checks the value, focuses the field (`DOM.focus`), sets `value` in the isolated world, reads it back,
and only then dispatches `input` (bubbling, composed) and `change` (bubbling). Formats (`fields.py`): `YYYY-MM-DD`
(a real date), `HH:MM[:SS[.mmm]]` in 24-hour time or with AM/PM (`2:30 PM` becomes `14:30`), the two joined by `T`
or a space for `datetime-local`, `YYYY-MM`, `YYYY-Www`, `#rrggbb` or `#rgb`, and a number for `range`; an empty value
clears the field. A value in another format fails before anything is touched (`code: "bad_value"`, naming the
format), and so does one the input refuses (it's put back the way it was). The answer carries what the field holds
(`data.value`; the text says so when it differs from what was given, such as `#3b82f6` for `#3B82F6` or a range
snapped to its step). It needs no visible tab and sends no key events. A textarea, a contenteditable field and a
`text`, `search`, `email`, `url`, `tel` or `number` input get the whole text in one `Input.insertText` (confirmed by
its `beforeinput`/`input`; per-key typing took 1.8 s for 400 characters in a textarea and dropped newlines, and on the
bench 1.3 to 1.5 s per 9-field form). A combobox, typeahead or datalist input, a password field, `auth login` (its
guard) and `--humanize` still type per character, since suggestion lists and some masks listen for keys. e3915e9be,
which moved textareas to one insert, kept inputs typing without giving a reason; frameworks (React, Vue) handle the
insert's `input` event as they do a paste. `fill` on a `<select>` picks the option whose label or value is the text,
else a whole line of one, else the only one containing it, as `select` does for suggestions (no match or two fail
and list the options); the answer names the option's label.

`fill` on something that isn't a field but is, or sits inside, a grid cell (`[role=gridcell]`, `[role=cell]` or `td`)
edits the cell: a field already in the cell is filled in place, and so is an editor that's already open over it (a
grid that opens one on "Add row"); otherwise it double-clicks the cell, waits up to 1 s for an editor to take focus
(inside the cell, or any field focused by the double-click, since grids often float the editor above the rows), and
presses Enter and waits again if the double-click opened nothing. It sets the editor the way the editor needs (picks
on a `<select>`, takes the matching `<datalist>` entry or the text as given, picks from a combobox's suggestions,
else fills), presses Enter to commit and waits up to 0.5 s for the editor to close. The answer reads the cell again
(by the cell, its id, or its row and column indexes after a redraw) and prints
`~ gridcell "Reorder level, FAS-53565 Reno": 250 (was 150)`, named by the editor's label. When the editor stays open
(the grid rejected the value) it presses Escape and fails with `rejected` and the grid's message (the editor's
`aria-errormessage` or `aria-describedby` text, or its validation message). So a whole grid edit is one batch of
`fill <cell> <value>` lines.

`click`, `fill`, `select` (both kinds), `check` and `uncheck` wait up to 1.5 s for a disabled target (`:disabled`, a
disabled ancestor button or fieldset, or `aria-disabled="true"`) to become enabled, so a dependent field (To after
From, City after Country) can follow the one that enables it in the same batch. One still disabled after that fails
with `disabled` and says to do what enables it first; a `click` on an element that's only `aria-disabled` goes ahead
after the wait, since the page gets that click.

`select` on a combobox picks from its suggestions per value: a typeahead or chip input is filled with the value, a
button that opens a listbox is clicked, an input with a `<datalist>` takes the matching entry. Options come only from
a popup the field owns (`aria-controls`, `aria-owns`, `aria-activedescendant`) or one inside the field's component
(the nearest ancestor holding a listbox and no other control, where a control is a field, a combobox or a button with
`aria-haspopup`, and whose lists no other control owns); anything else refuses (`no_fresh_suggestions`), names the
visible lists and points at `find role option click --name …`. A MutationObserver in the isolated world tracks the
options' own content (ids, text, labels and values); changes above the popup don't count. An exact match (the
option's text, `aria-label`, `value` or `data-value`, or an email in them) is picked once the list has been quiet
350 ms with no `aria-busy="true"`. A looser match (a whole line of the option, else the only one containing the value)
needs the options to have changed after the last keystroke; without that, after 4 s it refuses and lists what's
showing, since the list may be for an earlier query. Two matches or none fail and list the suggestions. `fill` on a typeahead types only, then says how many suggestions show
and the `select` command to pick one.

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
connection up). An interrupted drag reports an unknown outcome.

`drag` from an HTML5 draggable (the source or an ancestor has `draggable`, as links and images do by default) goes
through drag interception, the way Playwright does it, since a synthetic mouse drag would start a real macOS drag
session. It turns on `Input.setInterceptDrags` for the tab's CDP session before sending anything, presses on the
source and moves toward the target; when the page starts a drag, Ardia hands it over as `Input.dragIntercepted`
(the `dataTransfer` items), and from then on each point of the path is an `Input.dispatchDragEvent`: `dragEnter`,
`dragOver` along the rest of the path, then `drop` at the target, and the button is released. The drop point (for
both kinds of drag) is the target's far half: 75% of its height when the target is below the source and 25% when
it's above, or the same along its width when the two sit side by side, so in a sortable list (most of them read the
target's middle as the line between "before" and "after") the source takes the target's place. `--before` and
`--after` pick the side. Before the drag it looks for the list: the source's ancestor whose parent also holds the
target, when both are the same kind of element and it's a list row (`li`, `tr`, a `listitem`, `row`, `option` or
`treeitem`), the draggable itself or inside `aria-roledescription="sortable"`, and its text is unique among its
siblings. After the change report it finds that text again and the answer says `moved to 5 of 5 (was 4)` or `the
order didn't change: still 2 of 3` (`--json`: `position`), so the agent needn't read the list again. With `--humanize` the
path is the same curved one a mouse drag takes; without it, it's one move. If the page started a drag (a trusted
`dragstart` that wasn't cancelled) but the handover hasn't come by the release, it waits up to 1.5 s for it. On the way
out, always, one shielded cleanup that the command waits for (also when it's cancelled), so nothing it sends can land
in the next command: a drag that was handed over but not confirmed dropped (a drop that failed or timed out
included) gets a `dragCancel`; a held button is released, while interception is still on, even when the cancel
fails; and only then is interception turned off. Each of its CDP calls is bounded (2 s, plus up to 1.5 s for a
late handover), instead of one deadline that could cut a release short and leave it running. Interception
belongs to the CDP session, so it also ends when the session disconnects, and a drag the session still holds then (the daemon killed, Stop pressed mid-drag) is ended by the engine, so the page doesn't stay deaf to clicks and keys (`chromium-drag-always-ends.patch`). If the token policy refuses
`Input.setInterceptDrags` (an Ardia older than this engine), the command fails before any input with the gated message (`policy_refused`). Ardia hands a drag to a session only when the drag started from that session's own press (`docs/engine-build.md`, the control-token patch); sessions still share control of the tab, so one session's drag timing and payload aren't isolated from another session's. It reports
what happened: `✓ Done (HTML5 drag and drop)`, `the target didn't accept the drop` (the page cancelled no `dragover`, so
no `drop` event arrived) or `the page didn't start an HTML5 drag, so it was a plain mouse drag` (its `dragstart` was
cancelled); `--json` has `html5`, `started` and `dropped`. It confirms delivery like other input (a `mousedown`, then a
`dragend` or `mouseup`) and ends with its changes. A source that isn't draggable takes the plain mouse path.
`tests/fixtures/browse/dnd.html` is a sortable list; the end-to-end test reorders it both ways.

Chrome doesn't deliver mouse or keyboard input to a hidden tab, and a tab `open` puts in the background is hidden
unless the engine keeps it live. An Ardia that does keeps a tab with a CLI CDP session attached visible to the
renderer (a capturer count, as tab capture does) without switching the user's view, so the page reports
`document.visibilityState === 'visible'` shortly after attaching (about 90 ms) and gets a `visibilitychange` back to
`hidden` when the session detaches or the connection closes, the idle disconnect included; its timers run unthrottled
meanwhile. Ardia does this on the token path from engine 27cc5eff (`ac_cli_visible_tabs.cc`), and on a `--port` test
instance only when it's launched with `--test cdpTabsVisible`. Input commands check visibility first; when the tab
is hidden they poll it for up to 0.5 s, every time (one tab that stayed hidden doesn't make later ones refused
without waiting). A hidden tab fails with `code: "tab_hidden"` and the exact
fix, `[t2] is a background tab, … use: ardia browse tab t2 --show (or open <url> --show)` (`data.use` carries the
command). `open --show`, `tab new --show`, `tab <id> --show` or `AGENT_BROWSER_SHOW_TAB=1` show the tab
(`Target.activateTarget`, retried until the page reports visible and the tab target's `embedderData.tabActive` has
held for 0.3 s, since the app could switch back right after). `scroll` on a hidden tab keeps pydoll's
humanized timing but applies each step with `scrollBy` in the isolated world; `record` and `stream` refuse a hidden
tab (it paints no frames). The tab probe that picks the active tab on `--port`/`--ws` reads visibility straight after
attaching, before an engine that keeps attached tabs live has made them visible.

### What the page can see

`ardia browse` doesn't change the page's main world by default: locating, snapshots (`Accessibility.getFullAXTree`,
cursor-interactive elements found by computed style), `get`, `is`, `find`, `read`, `storage`, `select`, `pushstate`,
`vitals` (`PerformanceObserver` with buffered entries) and `a11y` (axe-core, `iframes: false`) run in an isolated
world (`Page.createIsolatedWorld`, `ardia-browse`) or through browser-side CDP. `--annotate` lists and labels only the refs whose boxes fall inside the
captured image (agent-browser 0.35.1 prints every ref on the page in its legend; ardia browse lists only what the
image shows), and draws its labels on the
PNG in Python, so nothing is added to the page. The page still sees what a person causes: trusted input events,
focus, scrolling, and the DOM changes those lead to (`select` and `pushstate` dispatch their `input`/`change` and
`popstate` events from the isolated world, and `fill` on a date, time or other typed input its `input`/`change`). An
action's network watch uses the Network domain of the command's own CDP session, which the page can't observe. Only `eval`, `wait --fn`, init scripts and the React hook run in the
main world. `wait --fn` is the caller's JavaScript like `eval`, so it runs where the page's own globals are; it's
evaluated every 100 ms until it's truthy. There's no `--enable-automation`.

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
init scripts registered, then `Page.navigate`); later `open`s navigate the session's tab. A session that has
never had a tab uses the user's active tab for any command that needs one, with the rule `tab active` uses:
on the token path `GET /ardia/active?token=…` (the page shown in Ardia's last focused window); on `--port`/`--ws`
test servers, or when that route fails, the page that's visible and focused, else one that's visible (each tab is
probed through a flat session and an isolated world, then detached). It errors (`no_tab`) only when there's no such
page, as on New Tab. Once a session's tab closes it doesn't move on to whatever the user is looking at: commands
fail with `tab_gone` until `tab active`, `tab <id>` or `open`. The session keeps the tab it took, and the command's stderr says so once (`→ This session had no
tab, so it uses the active one: [t1] Title - URL`). `open` never navigates a tab taken this way: it opens its own
background tab, as with no tab; to navigate the user's tab, pick it with `tab <id>` or `tab active`. The same goes
for every command that loads a URL (`vitals <url>`, `diff url`, `a11y <url>`, `record start <path> <url>`, and `auth
login` when the tab isn't on the credential's origin; script's `page.goto` is `open`), while `back`, `forward`,
`reload` and `pushstate` refuse a borrowed tab (`borrowed_tab`), and so does anything that changes its site data:
storage set/remove/clear, cookies set/clear, every `set`, `state load`, `addinitscript` and `network route` (reads still
work; `auth login` logs in in the session's own tab). `eval` is left alone. `open` stays in
the background and never switches the user's view unless `--show`. When it opens a background tab it checks whether
the tab takes input (`--json`: `tabId`, `background`, `takesInput`) and says so in its own output when the session
borrowed the user's tab or the tab won't take input, so an agent learns it before its first click fails:
`→ [t2] is this session's tab now, a background tab of its own, since this session uses your tab [t1] and won't
navigate it; `tab t1` goes back; this Ardia doesn't deliver input there. use: ardia browse tab t2 --show (or open <url>
--show)`, or `…; it takes input without being shown`. It names the tab it left (`--json`: `left`) so an agent switches
back with `tab t1` instead of running `tab list` (telemetry: `open_moved_tab`); a command that opens its own tab for the
same reason (`vitals <url>`, say) ends its notice the same way. A tab that won't take input and wasn't a move says
`→ Opened in its own background tab [t2]; this Ardia doesn't deliver input there…`. `close` and `tab close` close only tabs this session opened, and not one another live session
uses (reserved through the tab registry; the answer says which stayed open); the guard refuses `Browser.close` on every
socket. `tab list` shows the user's tabs too (minus prewarmed `about:blank` pages, read/script tabs and tabs another
session is closing), with the `tab-…` id `ardia windows` prints when the app reports the tab's target, and which
session opened or uses each. `tab <id>` takes `tN`, a label, a target id or that `tab-…` id (an unloaded tab is
`tab_asleep`). When a tab's page is replaced, the session follows it only where the app's `targetId` says it went,
keeping whether it borrowed or opened the tab; otherwise it's `tab_gone` and the agent re-picks. `alert` and `beforeunload`
dialogs are accepted, as in agent-browser, unless `--no-auto-dialog`. `get cdp-url` refuses any URL that carries a
token or other credentials, however it was chosen (the token path, `--ws`, `$ARDIA_CDP_URL`); it prints only a
plain `--port`/`--ws` URL. After `frame <iframe>`, if that iframe goes away, commands fail with `frame_gone` until
`frame main` or another `frame`, instead of falling back to the main document.

### Snapshots

`snapshot` renders a native `date`, `time`, `datetime-local`, `month` or `week` input (accessibility roles `Date`,
`InputTime`, `DateTime`) and a `color` input (`ColorWell`) as one `textbox` with its type, its `required` state and
its DOM value, read from the isolated world: `- textbox "Date" [type=date, required, ref=e7]: 2026-11-06`. Their
internal spinbuttons and picker buttons are left out, in full and `-i` snapshots alike. Those pieces also had doubled
names (`spinbutton "Month Month"`, `button "Show date picker Show date picker"`). That comes from Chromium, not
ardia browse: for a field inside a date or time control `AXNodeObject::GetName` appends the control's own name and
passes the same `name_sources` vector to it, and DevTools' `Accessibility.getFullAXTree` always asks for sources
(`inspector_type_builder_helper.cc`), so `GetSavedTextAlternativeFromNameSource` picks the first winning source in
the shared vector, the field's own `aria-label`, and the name becomes `Month Month` instead of `Month Date`. Screen
readers never ask for sources, so they hear the right name. Hiding the pieces means no doubled name reaches an
agent; the engine fix is to give the ancestor its own `NameSources`. A clickable element with no accessible name
(found by `cursor: pointer`, `onclick`, `tabindex` or `contenteditable`) is named by its text in full snapshots too,
so both kinds of snapshot agree on what each ref is.

`snapshot -i` cuts names past 100 characters with `…` (text in a full snapshot stays whole), and in a run of one role
at one level (as long as the ones the change report folds) with three or more disabled members it lists the enabled
members as usual and puts one count line where the first disabled one was (`- 108 disabled buttons (Seat 1A … Seat
30F)`), dropping the disabled members and what they hold, so a seat map lists every free seat within the output cap.

When the session's tab is a web page with site notes, `snapshot` (full or `-i`) starts with them (see Site notes).
`snapshot --diff` (with or without `-i`) prints only what changed since this session's previous snapshot of the same
document, in the format of Changes after actions (without network writes); "previous" counts a whole-page snapshot,
`snapshot --diff` itself and the view each action takes afterwards. With no earlier snapshot of the document it
prints the whole snapshot after a line saying so. It takes no `-s` or `-d`.

### Changes after actions

After `click`, `dblclick`, `fill`, `type`, `select`, `check`/`uncheck`, `press`, `keyboard type|inserttext`, `drag` and
`find … <action>`, the answer ends with what the action changed, so an agent rarely needs another snapshot:

```
✓ Done
changes:
url: http://127.0.0.1:8792/ → http://127.0.0.1:8792/#saved
+ textbox "Title" [required, ref=e21]
+ combobox "Calendar" [expanded=false, ref=e22]: Home
+   option "Home" [selected, ref=e23]
+ 10 back as last shown: e1 e2 e3 e4 e5 e6 e7 e8 e9 e10
~ textbox "Date" [type=date, required, ref=e27]: 2026-11-09 (was '2026-11-06')
- 11 removed: e11 e12 e13 e14 e15 e16 e17 e18 e19 e20 e21
POST http://127.0.0.1:8792/api/events → 200
```

- **Nodes** (`changes.py`). The command takes the interactive snapshot's view of the page (the same collection as
  `snapshot -i`, refs kept) before the action and again after it, and compares them by ref: `+` added (indented as in
  `snapshot -i`; nodes whose line is exactly what the session was last shown fold into one `back as last shown`
  line), `~` changed (role, name, value or state, with what it was), `-` removed (one line each up to five, else one
  line of refs). After the action the new refs are live, so a dialog's fields can be used straight away. A run of
  one role at one level (6 or more options, links, menu items, tree items or generic clickables; 12 or more buttons,
  radios, checkboxes, switches or tabs) is one line with its count, parent, first and last name, ref range and how
  many are disabled (`+   48 options in combobox "Start time" (12:00 AM … 11:30 PM; e8…e55)`), followed by any
  selected, pressed, expanded or checked member verbatim. A run with both enabled and disabled members lists the
  enabled ones one by one (up to 40) and counts the rest, so the choices are never folded away
  (`+ 35 enabled …` lines, then `+ 119 disabled buttons (Seat 1A … Seat 30F)`). Nodes redrawn unchanged under new
  refs are one line (`+ 13 redrawn as they were, with new refs: …`). A new document (or a changed URL or title)
  prints the new page's whole interactive tree that way, up to 150 lines, so no follow-up snapshot is needed; landing
  on another site prints its notes first, as `snapshot` does. A same-page report stops after 40 lines with a pointer
  at `snapshot -i -s <css>`. Names longer than 100 characters end in `…`, here and in `snapshot`; `find … --name`
  takes such a clipped name (with or without the `…`) as a prefix of the full one.
- **Text** (`text:` lines, `changes.add_text`). After a navigation (new document, URL or title) the report adds the
  readable text of the page's `main` (else `body`), about 3,000 characters; when an action opens something on the same
  page (a new heading of level 1 or 2, or a new dialog, article or region holding new nodes) it adds that container's
  text (`closest('article, dialog, [role=dialog], [role=region], section, main > *')`), about 1,200 characters. Short
  blocks such as a card or a table row are one line, joined with `·` (cells with `|`). Enabled controls carry their
  ref inline (`Main $129 per person [@e92]`, using the control's `aria-label` when its visible text is short); a
  disabled control shows only its visible text. A canvas, image or `role=img` of 48 px or more is
  `[image "receipt.png": screenshot @e91]` (the ref is new, made for it), and a child frame is
  `[frame "Folio.pdf preview": frame @e95; read]` followed by the frame's own text when it's in reach. Rows the text
  already shows with their ref and no state or value aren't repeated as `+` lines, and when the text says no more
  than the new rows' names (a form dialog) it's left out. Cut text ends with `… more: read -s <css>`; after a
  navigation the `+` list gets what's left of about 5,400 characters and the removed nodes of the last view are a
  count. Values of password fields never show. `open <url>` reports the page it lands on the same way, as a click
  that navigates does (not inside `script`, where `goto` stays light).
- **URL and title** of the session's tab, when they changed. The URLs keep their path and query, but the values of
  keys that look like credentials (`code`, `token`, `pass`, `secret`, `key`, `sig`, `auth`, `session`, `state`,
  `nonce`, …) and a fragment holding `=` become `…`.
- **Network writes.** Before the action the command turns on `Network` for the tab's CDP session, unless the session
  already captures it (`network requests`, HAR, `set offline`), and listens. Afterwards it waits for the requests the
  action started to be answered (headers in; a response body the page never reads doesn't hold it up), for a quiet
  50 ms with none (120 ms after the last network event when there were some), and for `DOMContentLoaded` if the action
  navigated, at most 1.5 s; past that it says the page was still busy. Then it removes its listener and turns
  `Network` off again (shielded, 2 s), also when the action fails or is cancelled, so no capture lease is left and the
  idle disconnect works as before. It takes no tab claim: it only reads, on its own CDP session, for the length of
  one command. It reports requests that aren't `GET`, `HEAD` or `OPTIONS` (fetch, XHR, form posts, beacons), in
  order: method, URL without user info, fragment or query values (`?token=…&id=…`; a query key that isn't plain
  letters, digits and `_.-[]` becomes `…` too, and so does a path segment with a `:` or one of 20 or more characters
  mixing letters and digits; non-http(s) URLs only as `data:…`), every status (`303 → 200` for a redirect), `failed`/`canceled`, or `pending`. Request bodies and headers
  are never read. While no capture is on, `network requests` keeps no log, so these requests don't show up there.
- **JSON.** `data.changes`: `document` (`same`, `new`, or `unknown` when the view before couldn't be taken),
  `url`/`title` (`{"from","to"}` or null), `added`, `removed` (each `{ref, role, name, value, attrs}`), `changed`
  (`{ref, from, to}`), `back` (refs), `network` (`{method, url, type, statuses, status}` plus `failed` or
  `pending`), `rerendered` (`{ref, was}`), `notes` (the arrival header), `text` (`{lines, more, where}`) and
  `unsettled`/`error` when they apply. Every
  node is listed, folded or not. Names are redacted before the 200-character cut and before folding, and everything
  is sanitized like any other answer.
- `--no-text` leaves out only the `text:` lines. `--no-changes` skips all of it for one command (no snapshots, no
  network watch), and `open` then prints only its title and URL. If the view afterwards can't be
  taken (the tab closed, say), the action's result stands and the report says why.

### Output cap

Text output of every command stops at 6,000 characters, at a line break when there's one in the last fifth, and
ends with one line that points at narrowing, tailored to the command, and names `--max-output` last: `[output capped
at 6,000 of 15,920 characters. Narrow it instead: snapshot -i (interactive only), snapshot -s <css> (one region), find
role <role> <action> --name <text> (act without a snapshot). Only if you need every line: --max-output 15920]`. It
used to suggest `--full`, and agents ran `snapshot --full` at up to 35K characters a time. The same line also goes to
stderr (so does `read`'s own "pages cut to fit" line), so it survives `| head`, `| grep` and `> file`. `--max-output N` (or
`AGENT_BROWSER_MAX_OUTPUT`) sets another limit (`0` for none), `--full` turns it off; JSON output is never cut. `--full` after `screenshot` or `diff` is still their
full-page flag. A `read` of several pages gets 3,000 characters a page instead (at least 6,000, at most 24,000) and
shares it between them (`readpages.pages_cap`): research reads of 8 to 12 pages used to come back cut to a few hundred
characters each.

### Reading lists and grids

`read` (and `read -s`) prints a table or an ARIA grid one row per line: `tr` and `[role=row]` are rows, and `td`, `th`
and the `gridcell`, `cell`, `columnheader` and `rowheader` roles are cells, split by ` | ` (`js.py` `readable`). A grid
built from `display: grid` divs used to come out one cell per line, so 80 lines held 6 rows. When `aria-rowcount` is
larger than the rows in the DOM it adds `(25 of 2682 rows rendered; the grid is virtualized: sort, filter or scroll it
to see others, or read -s <grid> --scroll)`.

`read -s <list> --scroll [--limit rows] [--match <text>] [--timeout ms]` reads a long or virtualized list on the
session's tab in one call, the loop agents used to hand-write in 3 to 4 calls (`readpages.run_scroll`). `-s` takes a
selector or a ref. Rows are the list's outermost `option`, `row`, `listitem`, `treeitem` or `article` roles, `li`, `tr`
or `article` elements, else its children; when the selector matches several elements and they hold no such rows,
those elements are the rows. It finds the scroll box (the nearest scrollable ancestor of a row, else of the list, else
a scrollable box inside it, else the page), starts at the top, and each step jumps to the last row rendered (at least
nine tenths of the box), then waits for the rows to stay the same for 0.1 s (up to 1.5 s, 8 s while the list shows
`aria-busy` or a `Loading…` row). It stops when the box can't move and stopped growing, at `--limit` rows (1,000;
10,000 with `--match`) or at `--timeout` (30 s), and then scrolls the box back where it was. Virtualized lists
recycle nodes, so a row is keyed by `aria-posinset`, `aria-rowindex` or `data-index`, else `data-id`, `data-key` or
its id, else its offset in the box plus its text, and rows print in that order, a row's lines joined by ` · `.
`--match` keeps rows containing the text, ignoring case. The last line says how many rows it read and why it
stopped: `[2 of 200 rows match "staples"; scrolled to the end of the list]`. A hidden tab (plain Chrome without
`--show`) draws no animation frames, so lists that render rows in one stop early; then that line adds `the tab is
hidden, so the page may not have drawn every row: ardia browse tab t3 --show, then read again`. The inbox of the expenses fixture (200
mails, 40 a page) reads in about 3 s, and its 2,682-row grid in about 16 s.

### Batch

`ardia browse batch [--bail] [--json]` runs commands one after another in one call and one daemon request. With no
command arguments it reads them from stdin, one per line, so a heredoc works; blank lines and lines starting with `#`
are skipped. A line is a command as you'd type it after `ardia browse` (shell quoting rules, through `shlex`), or a
JSON array of strings. The session's flags (`--session`, `--port`, `--data-dir`, …) go on the `batch` command; a line
takes its command's own flags and the per-command ones (`--full`, `--max-output`, `--no-changes`, `--no-text`, `--humanize`,
`--show`); `--full` or a larger `--max-output` on a line widens the whole batch's cap, never narrows it. Each
command's answer, changes included, is printed in order, separated by a blank line; `--bail` stops at the first
failure, and a command whose outcome is unknown stops the rest (`not_run`). `batch` can't run inside a batch. `close`
can be the last line: it ends the session once every other line ran and succeeded (else it reports `not_run` and the
session stays); anywhere else the error points at `tab close`. For a loop the page has to run itself, `eval`
takes JavaScript (`eval --stdin` from a heredoc) and runs it in the page's main world.

Filling a form five times is one call:

```sh
ardia browse snapshot -i
ardia browse batch --bail <<'EOF'
# one contact per block; @e10 is "Add contact" from the snapshot
click @e10
fill #name "Ana Ruiz"
select #group clients
fill #email "ana@example.com"
fill #phone "+1 555 0100"
click #save
click @e10
fill #name "Tom Becker"
…
EOF
```

Refs stay valid across the batch as long as their nodes do (a dialog that's reopened keeps its fields' refs), and
every selector form (see Refs) and `find` line works as on the command line. `eval` with `fetch(`, `DOMParser` or
XHR, and open → `get text` on three pages in a row, print a one-time tip on stderr pointing at `read` and `script`.

`ardia browse script` (`browse/script.py`) runs its JavaScript in a Worker of a blank background page, outside the
page it drives: each `page.*` call is a browse command on the session, and `page.evaluate(fn, arg)` (also
`page.eval`) is `eval` of `(fn)(arg)` in the page's main world. `page.dblclick`, `page.focus` and `page.keyboard(text)`
(`keyboard type`) cover cells and fields that only take typing. Two mistakes get a hint under the error: a
`ReferenceError` for `document`, `window`, `localStorage`, `sessionStorage` or `getComputedStyle` in the script itself
says the script runs outside the page and points at `page.evaluate` or `ardia browse eval`, and one from inside
`page.evaluate` for a script variable says to pass it as the argument.

### Site notes

`ardia notes` (and `ardia browse notes`, the same command) keeps plain notes per site for the user's own agent;
Ardia runs no AI and never reads them itself.

- `ardia notes [get] [SITE]` prints them; `set [SITE] TEXT|-` replaces them, `append [SITE] TEXT|-` adds a line,
  `rm [SITE]` deletes them and `list` shows every site with its size and time. `-` reads stdin.
- `SITE` is `host[:port]` (a URL works too; default ports are dropped, names are lowercased and IDN hosts become
  punycode). Without it, it's the session's tab's site, so that form needs Ardia (and auto-attaches like any command);
  with it, or for `list`, it runs without the browser. For `set` and `append` the first of two or more arguments is
  taken as the site only when it looks like one (a dot, a port or `localhost`), else all of them are the text.
- One markdown file per site, `<data dir>/Notes/<host[:port]>.md`: the folder is made 0700 and must be a real folder
  the user owns, files are 0600 and opened relative to it with `O_NOFOLLOW` (a link or anything but a regular file is
  refused), writes go to a temp
  file that's renamed over the old one, and each site holds at most 8 KB (`code: "notes_too_large"`, nothing
  written).
- On a page with notes, `snapshot` and `snapshot -i` start with them, cut at 1,000 characters (the rest is one `ardia
  notes get` away): `# notes for 127.0.0.1:8792 (ardia notes): Add events with + New Event` and `# `-prefixed lines
  after it. `--json` has them in `data.notes`. They count as page content (inside `--content-boundaries`), since a
  page could have talked an agent into writing them. Writes take an exclusive lock on the folder, reads never block
  on a FIFO.

### Gated by the token policy

The engine's ardia-command policy (`ac_cli_token_policy_methods.cc`) refuses these methods, so on the real connection
these commands fail with exit 1, naming the method and the command (`code: "policy_refused"`, `data.method`, and
`data.reason` empty). Each is implemented and works against a plain `--port` test server, so allowing the method is the
only change needed.

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

On the token path Ardia also strips `Cookie`, `Set-Cookie` and `Authorization` from network events, so
`network requests` and HAR files never contain them.

The policy also refuses some uses of methods it allows (`ac_cli_token_policy.cc`), and says which in its reply:
`ardia: <method> <reason> isn't allowed for the ardia command`. The command keeps that reason (`data.reason`, same
`code`) and words the error around it, so it never reads as a method that is off the list:

| Reason | Methods | Means |
| --- | --- | --- |
| `to that target`, `on that target` | `Target.attachToTarget`, `activateTarget`, `closeTarget`, `getTargetInfo` | The tab is gone, isn't a web page (an Ardia or extension page), or sits in a window Ardia keeps for itself |
| `without flatten` | `Target.attachToTarget`, `setAutoAttach` | The command always sends `flatten`, so this is a bug in it |
| `to that URL`, `in another browser context` | `Target.createTarget`, `Page.navigate` | Only http, https, data and about:blank pages, in the user's own profile |
| `in that execution context`, `on that object` | `Runtime.*`, `DOM.*` | A context or object the connection didn't make |
| `on a tab the ardia command didn't open`, `on a tab the user can see`, `with that option` | `Emulation.setDeviceMetricsOverride`, `clearDeviceMetricsOverride` | The viewport override is for tabs the command opened (below), with a width, height, scale and `mobile` only |
| `in a named world`, `as a stream`, `with the command line API`, `without a button`, `with those editing commands` | `Page.addScriptToEvaluateOnNewDocument`, `Page.printToPDF`, `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` | That option isn't allowed |

`set viewport` is gated on the token path, as in 0.2.45: `Emulation.setDeviceMetricsOverride` and
`clearDeviceMetricsOverride` are off the policy's list (`AllowedMethods`). They were on it from ce0e35bff to
4aff6b021, and what the engine and the app need for it stays in the tree, unused until the methods are listed again;
the rest of this section describes that. It isn't enough yet, which is why the methods are off: when the wait for
the restored frame times out (250 ms) or its callback fails, the hold ends and the stale emulated frame shows; the
callback it waits on confirms a frame was submitted to the display compositor, not that it is on screen; and the
hold is asked for only when clearing changes the native view's size, so a hidden emulated tab laid out into a pane
or window of another size before the report, or an override of the page's own size, gets none. Two hosts attach
pages without reporting them (`ArdiaEarlyWindow`, `ArdiaPopupWindow`). With the methods listed, the policy allows
`Emulation.setDeviceMetricsOverride` and `clearDeviceMetricsOverride` only on a session attached to a
target that a token connection made with `Target.createTarget` (`open`, `tab new`, a reader or script tab) and that
isn't shown to the user. The engine keeps those tabs for the whole process (`ac_cli_owned_tabs.cc`), learned from
each `createTarget` reply, so a daemon that reconnects after its idle disconnect still owns its tabs; one goes when
its page is destroyed. A command's tab is an ordinary sidebar tab, and the command must never resize what someone
looks at, so the rule is about visibility, not about who did what: the override is for a tab in the background. The
moment the tab is in a shown slot of any window (the window's tab, a split pane, Little Ardia; a covered or
minimised window counts), the engine clears the override itself (a `clearDeviceMetricsOverride` it sends on each
of its sessions attached to that tab, whose replies never reach the command) and the two methods are refused there
for good (`on a tab the user can see`; telemetry `viewport_tab_taken`), also after the tab is hidden again. It
doesn't matter who showed it: the user picking it, Ardia showing it because nothing else was open, or the command's
own `open --show` and `tab <id> --show`, so viewport checks run on a hidden tab, where screenshots, snapshots and
clicks work at the emulated size. The signal is the app's: `ArdiaWebView` tells the engine before it puts a page on
screen (`exposePage` → `noteInShownSlot`, kept on the page as `ShownSlot`), from every native path that can: the
painting pass of a view that is `visible` or revealed, the reveal that shows a tab ahead of React's `visible`
(`revealAhead`), `setVisible:` before it raises a warm page's alpha, and `revealOffered` before it fronts a new
tab's page. The engine clears the override inside that call, not after it, and says whether the page's size changed;
if it did, the view stays at alpha 0, the outgoing page still up, until the renderer confirms a frame after the
resize (`InsertVisualStateCallback`, 250 ms at most), so no frame at the emulated size reaches the screen. Chromium's own
`content::Visibility` doesn't say it: Ardia paints a page it is about to show before it is `visible` (warm, at
alpha 0), and a page the command drives is held visible to its renderer by a capturer count so it keeps drawing in
the background (`ac_cli_visible_tabs.cc`). An earlier version inferred a takeover from activations, pins and input
and missed split panes, scrolling and rejected activations. A Peek is never the command's tab (a page opens it, not
`Target.createTarget`), so it is refused as a tab the command didn't open. Any other tab,
the user's included, is refused (`on a tab the ardia command didn't open`), also when the session picked it with
`tab <id>`; a session that only borrowed the user's tab is refused by the command first (`borrowed_tab`). Only
`width`, `height`, `deviceScaleFactor` and `mobile` pass (`with that option` otherwise). Nothing clears the override
by hand otherwise: it belongs to the DevTools session, so Chrome drops it when the session detaches (`close`, the
daemon exiting, Stop, control turned off, the tab closing), and the `emulation` lease keeps the daemon connected
while it's on. Chrome used to keep the emulated size when the renderer had crashed before the detach
(`ClearDeviceEmulationSize` returned before forgetting it when the page had no view), so a reload came back at
390×844 for good; `chromium-device-emulation-size-reset.patch` forgets the size either way. `set device` still fails, before changing anything, on `Emulation.setTouchEmulationEnabled`. The 1280×800
override a click gives a tab with no size (Input) works on those tabs too. Telemetry: `viewport_set` on the
command event; watch `error_code` `policy_refused` on `set`.

A refused `Target.attachToTarget` also says what Ardia's own tab list has for that page (`ardia windows`): the tab and
its address, or that no tab holds it. The command used to print the off-the-list sentence for every refusal, which hid
the reason.

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

A Debug build takes its JavaScript from Metro, and the token instance has no DevTools port to find it by, so name it:
`ARDIA_BROWSE_E2E_JS=localhost:8081`. Without it that instance never turns control on and `BrowseTokenPath` times out
waiting for `ArdiaControl.json`.

`apps/cli/scripts/token-smoke.sh <Ardia.app> <ardia command> [metro host:port]` is the short version: one hidden
instance on the token connection, then `read <url>`, `open <url>`, `read` and a refused `cookies`. The release smoke
test runs it with the release's own CLI tarball against the release candidate, since nothing else runs the command
against a real token connection.

It serves `tests/fixtures/browse` on 127.0.0.1, launches one hidden instance with a DevTools port (`ac launch
--no-wait`) and one on the token path (`open -g -n`, `ARDIA_BACKGROUND=1`, control on in `session.json`), both under
`~/ardia-scratch/browse-impl/e2e` (`ARDIA_BROWSE_E2E_DIR`), runs the core loop, the probe (humanized with
`--humanize`), instant input by default, the hidden-tab refusal, refs across an idle disconnect, `fill` on every typed
input and the snapshot of them (`form.html`), the changes report with a dialog and a POST that carries a token in its
query (`form.html`; the fixture server answers 501), `snapshot --diff`, auto-attach on both paths, site notes, the
output cap (`many.html`), five form fills in one `batch` from stdin, the gated errors and a service worker starting
mid-session, then closes its sessions and quits both. `tests/test_browse_changes.py` covers the same pieces as unit
tests (formats, the report and its folding, URL cleaning, the network watch and its bound, the cap, batch comments,
auto-attach choices, notes storage).
The a11y command needs `ardia_cli/vendor/axe.min.js`: `build.sh` adds axe-core 4.10.3 (pinned by sha256 and npm's
sha512); from the repo it falls back to `node_modules/axe-core` in a parent folder.

## Browsing data

For daily reports, `ardia pinned` and `ardia history` read files in Ardia's data dir (`ardia_cli/browsing.py`,
`browsing_cli.py`), each with one 20 s deadline from the start (the session read, the snapshot, every SQLite connection
through a progress handler that aborts past it, row fetching capped at 200,000); the worker deletes its temp snapshot
in its own `finally`, and at exit a hook sets a closing flag first (workers check it before making a temp folder and
at every backup or copy step), waits up to 1 s for live workers, then deletes any temp folder still registered. The
data dir is `--data-dir`, else `$ARDIA_DATA_DIR`, else the installed app's. Both run the same `ArdiaControl.json`
checks as the token path first (regular file, owned, 0600, live pid), so they work only while Ardia runs with control
on (exit 2 otherwise). Neither reads cookies, passwords, Login Data or Web Data. Text output is one line per row;
`--json` prints the rows.

- `ardia pinned` reads `<data dir>/session.json` (the app's persisted state, `apps/browser/src/state/session/persist.ts`) and lists
  one row per pin: `title` (custom title first), `url` (else the pinned URL), `pinned_url`, `kind` (`favorite` for a
  tile, `pinned` for a tab in a pinned folder), `folder`, `profile` (its name) and `parked` (pins of a profile no
  window shows, from `parkedPins`). Pins mirrored across windows count once. Incognito profiles are skipped.
- `ardia history [--days N] [--limit N] [--profile P] [--domains]` (default 1 day, 200 rows, `--limit 0` for all) reads Chromium's `History` for each `Default` and
  `Profile <id>` folder under `<data dir>/Chromium/` (never incognito, guest or system profiles; `--profile` must be a
  profile name or one of those folder names, never a path). Rows per URL, newest first: `url`, `title`, `visits` in
  the window, `total_visits`, `last_visit` (ISO 8601, local time), `profile`. Only http(s) pages; subframe
  navigations and hidden URLs are left out. `--domains` rolls rows up per domain (`domain`, `visits`, `pages`,
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
  [--port N] [--ws URL]` finds Ardia like `browse` (exit 2 when it can't), opens its own background target at `about:blank`,
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
3. `$ARDIA_WS`, like `--ws`, then `$ARDIA_PORT`, like `--port`.
4. `$ARDIA_CDP_URL`, like `--ws`.
5. `<data dir>/Chromium/ArdiaControl.json`, with `--data-dir` or `$ARDIA_DATA_DIR`, else the installed app's
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

## Crash reports and usage

`ardia_cli/telemetry.py` records crash reports and usage only while the app's "Share anonymous crash reports and usage
stats" is on for the data dir the command resolved (`--data-dir`, else `$ARDIA_DATA_DIR`, else the installed app's):
`<data dir>/telemetry.json`, the app's own saved choice, must say `"sharing": true` with an `installId` (and, during a
14-day watch, a `sharingUntil` still in the future). That id is the events' `distinct_id`, so the command's events join
the install's. The CLI reads only the fields it needs and ignores the rest, at any `version`, so a newer app format never
silently stops CLI telemetry. Nothing is sent when the file is missing, unreadable or says sharing is off, with `DO_NOT_TRACK` set (anything but empty, `0` or `false`) or
`ARDIA_TELEMETRY=0` (or `false`, `off`, `no`), for a command pointed at a test endpoint (`--port`, `--ws`, `--cdp`,
`ARDIA_PORT`, `ARDIA_WS`, `ARDIA_CDP_URL`, `AGENT_BROWSER_CDP`), or from a checkout (version `0.0.0.dev0`). `ardia
--version` records nothing.

The wire format is the app's: OTLP log records (`otlp.ts` `eventRecord`/`logsRequest`) posted as `application/json`
to `https://ardia.dev/otel/v1/logs`, scope `ardia.analytics`, resource `service.name` `ardia-cli`, so they land in
`telemetry.events` with `source = 'ardia-cli'`. Every event carries `$lib` `ardia-cli`, `cli_version`, `$os_version`,
`arch`, `python_version`, `$environment` (`production` for the installed app's data dir, `test` for any other, `dev`
from a checkout), `$geoip_disable`, `$process_person_profile: false` and `$session_id`: the app's `sessionId` from
`telemetry.json` while it says `sessionOpen`, else one UUIDv7 per CLI process. During a watch, events also carry
`watch_report` (`FB-…`). Every post sends `X-Ardia-Key` with the CLI's public ingest key (`CLI_INGEST_KEY` in
`telemetry.py`, the same value as `packages/core/src/ingestKeys.ts`; a test keeps them equal).

- `cli_command`, one per run: `command` (the first command word; `unknown` for a word it doesn't know, `none` for
  bare `ardia` and `--help`), `subcommand` (the second word; for `browse`, the browse command, or `other` when it
  isn't one), `exit_code`, `error_code` (browse's `code`, such as `stale_ref`, `element_replaced` or
  `connection_lost`, or `unhandled_exception`), and `flags`, the option names given, comma-separated, only names the
  command's parser knows. Then times in whole ms and counts, each capped (an hour, 100 million): `total_ms` (process
  start to exit) and `startup_ms` (process start until the command runs); for browse, `daemon_spawned` and
  `daemon_start_ms` when it had to start the daemon, `connect_ms` with `reconnected_after_idle` when the daemon
  (re)connected, `attach_ms` (finding and attaching the tab), the command itself as `snapshot_build_ms` for
  `snapshot`, `eval_ms` for `eval` or `action_ms` for the rest (the daemon's time less connect, attach and settle),
  `settle_ms` (the wait for the change report's network to settle, `changes.observe`), `snapshot_nodes` and
  `snapshot_chars`, `network_writes_count` and `unsettled` from the change report,
  `output_chars` and `output_truncated`, `humanize`, `followed_redrawn_ref` (a stale ref followed its redrawn node), `attach_refused` (the policy refused the attach to a tab; watch it with `error_code` `policy_refused` on `read` and `open`, where it should stay at zero), `cell_edits` (grid cells `fill` edited through their editor; watch `error_code` `rejected` and `not_editable` on `fill`), `fill_picked_option` (`fill` picked a `<select>` option), `fill_inserted_text` (`fill` put the text in with one `Input.insertText`), `waited_for_enabled` (a `click`, `fill`, `select` or `check` target was disabled and was waited for; `error_code` `disabled` when it stayed so), `drag_side_given` (`drag --before`/`--after`) and `drag_list_position` (the drag answer named the new place in a list), `script_eval_alias` (a script called `page.eval`), `script_page_world_hint` (a script's error got the page-world hint), `read_scrolled` with `read_rows` (a `read --scroll` and the rows it read) and `read_matched` (it had `--match`), `read_pages` (the pages a multi-page `read` read; watch `output_truncated` on those), `read_tabs_reopened` (reading tabs Ardia detached mid-read that were opened again; watch it with `error_code` `tab_detached`, which should stay near zero), `read_virtualized_grid` (a read printed the virtualized-grid note), `change_text` with `change_text_chars` (a change report carried `text:` lines, and their length), `change_run_choices` (a mixed run listed its enabled members), `open_report` (`open` printed a change report), `open_moved_tab` (`open` moved the session off the user's tab to its own and named the way back), `snapshot_disabled_folded` (`snapshot -i` folded disabled members into a count), `names_clipped` (a name was cut at 100 characters), `daemon_answer_timed_out` (the client gave up waiting for the
  daemon's answer: the queue wait plus the command's own limit plus 30 s, `browse/limits.py`), `batch_steps` (also the operations an `ardia apply`, `tabs …`
  or `groups …` call sent), and `cdp_calls` with `cdp_ms_total` (the
  command's own DevTools calls, counted in `connection.py`). The daemon returns its share as `metrics` in its answer
  (`command_metrics.py`).
- `$exception` for a crash the CLI didn't handle (`source` and mechanism `cli_unhandled`, level `fatal`) or one inside
  a browse daemon command (`browse_daemon`, level `error`; `fatal` when the daemon itself dies). It has the type and
  no free text: the message is sent only when it's one of the fixed built-in messages that carry no input
  (`FIXED_MESSAGES` in `telemetry_scrub.py`, like `division by zero` or `Event loop is closed`), or as
  `[Errno N] <the system's text for N>` for an `OSError`; otherwise the value is the type again. Frames are module,
  function and line, where a frame outside `ardia_cli`, the standard library and the bundled packages shows as
  `<other>`. At most 10 per process, one per type, message and top frame. The daemon checks its own environment and
  also each request's `telemetry` field, which the client sets from the command's own environment (opt-outs, test
  endpoints, a checkout): it reports a command's crash only when that request was eligible, and a crash of the
  daemon itself only when the last request it took was.

It never sends argv values, URLs, page text, selectors, refs, typed text, JS, notes, file paths, cookies or anything
from the page. Reports from `ardia feedback` don't go through this pipeline (see Feedback and the star nudge).

Every event it builds, sent or not, is also appended to a 7-day local copy, `<data dir>/Telemetry/local/cli-<UTC
day>.jsonl` (folder 0700 when the CLI makes it; the app shares it, so one it made without group or other write access
is used too), one record per line with `sent` true when it was queued for ardia.dev and false when sharing is off
(`distinct_id` is then `local`). Files older than 7 days are deleted and the total is capped at 4 MB, oldest lines
first, on every append, under `cli-local.lock`. It's written whenever the command would send if sharing were on, so
the opt-outs, test endpoints and a checkout above keep no copy either. It leaves the Mac only as the normal events
(sharing on) or when someone attaches it to a report.

Nothing waits on the network. Events go to `<data dir>/Telemetry/cli-queue.jsonl` (folder 0700, file 0600, under
`cli-queue.lock`; at most 500 events and 256 KB, the oldest dropped). At exit, once at least 60 s have passed since the
last flush started (`cli-flush.json`, read and updated under `cli-flush-claim.lock`, so concurrent commands start one),
the command starts a detached `python -I` flusher with its config on stdin and the data dir made absolute. It holds
`cli-flush.lock` so only one runs, drops events from another install id, posts batches of 100 (500 KB at most) with a
5 s timeout and a 12 s budget, and removes what was accepted (2xx) or refused (400, or 413 for a single event). It
reads `telemetry.json` again before every post: sharing turned off stops it and deletes the spool, a new install id
stops it and drops the old id's events. Anything else keeps the events and backs off 30 s, doubling up to 30 minutes. With sharing off,
the next command deletes the spool, and so does a flusher. The browse daemon only appends; the next command's exit
sends it. Turning sharing off in the app stops new events at once; what's already spooled goes at the next `ardia`
run.

`ARDIA_TELEMETRY_URL` is for tests only: a loopback `http://` URL (`127.0.0.1`, `localhost` or `[::1]`) gets the
posts instead of ardia.dev, from a checkout too, and any other value turns telemetry off. `tests/test_telemetry.py`
runs against a local stub with fixture data dirs.

## Feedback and the star nudge

`ardia feedback --title "<short title>" "<what you ran, what happened, what you expected>"` (or the description on
stdin, or `-`) is for agents and people to report a problem or an idea: a confusing error, a missing command, output
that cost turns, something slow. It follows the contract in `docs/feedback.md`: `--title` is required, 1-67 characters
once runs of whitespace are folded into one space; the description is required and kept to 4,000 characters after
scrubbing; `--kind` is `bug` (the default), `slow`, `idea` or `other`; `--command` names the command that misbehaved.

Sending a report is consent for that report, so it goes out whether or not the app's sharing is on. With sharing on
(`telemetry.json` for `--data-dir`, `$ARDIA_DATA_DIR` or the installed app's data dir; from a checkout, only an
explicit data dir is read) the report carries the install id, so it joins that install's events; otherwise a one-time
UUIDv4 made for that report. `session_id` is the same one the events carry. It posts to `https://ardia.dev/api/feedback`
with `X-Ardia-Key` (the CLI key): `kind`, `title`, `description`, `source: "cli"`, `install_id`, `session_id`,
`app_version` and `app_build` (the app's `lastVersion`/`lastBuild` from `telemetry.json`), `channel`, `os_version`,
`arch`, `cli_version`, `watch_days: 0`, `diagnostics` (`agent`, the caller name the control pill shows from
`caller.py`; `about_command`, scrubbed and capped at 300; `recent_commands`, the last five command names this CLI home
ran, like `browse click` or `browse fill (exit 1)`, never their arguments; `description_truncated`; `environment`;
`python_version`) and `attachments`. Then it uploads each file with `PUT <endpoint>/<id>/files/<name>` and the
`upload_token` as a Bearer token, and calls `POST <endpoint>/<id>/complete`. It prints `Sent. Reference FB-…`, the
GitHub issue link and "You appear to us as <name>" from the service's answer, and says "Sent" only after a 2xx from
`complete`.

`--attach FILE` (repeatable, 10 at most) takes the contract's kinds: one `.mp4` as `recording.mp4` (100 MB), one
`.json.gz` as `trace.json.gz` (50 MB), `.ips` crash reports as `crash-<n>.ips`, and `.png`, `.jpg`, `.jpeg`, `.gif`,
`.webp`, `.heic`, `.mov`, `.txt`, `.log`, `.md`, `.json`, `.jsonl` or `.csv` as `attachment-<n>.<ext>` (10 MB each).
Anything else, an empty file or one over its cap is refused before anything is sent. Files aren't scrubbed; they stay
private and never reach GitHub.

`telemetry_scrub.scrub` removes secrets by exact pattern, never by cutting at a keyword, so a report about
`ardia browse session`, `auth save` or an expired token keeps its words. It replaces control characters, then
removes: private key blocks; every parameter of a Digest header; the value of `Authorization`, `Proxy-Authorization`,
`Cookie`, `Set-Cookie`, `Api-Key`, `Private-Token` and `X-…-Token/Key/Secret/Auth/Session/Password` headers; URL logins
and queries (`https://host/path?<redacted>`); `key=value`, `key: value`, `key => value` and `--key value` where the key
names a secret (`password`, `passwd`, `pwd`, `passphrase`, `secret`, `token`, `api_key`, `access_key`, `private_key`,
`credential(s)`, `session_id`/`session_key`/`session_token`, `sessionid`, `auth_token`/`auth_key`/`auth_code`,
`cookie`, `signature`, `otp`, and names ending in them like `client_secret` or `access_token`), quoted values whole,
escapes and unclosed quotes included; session cookie pairs (`sid=`, `PHPSESSID=`, `connect.sid=`, `_x_session=`…);
`Bearer`/`Basic` followed by something credential-shaped (a digit or `._~+/=-`, 20 letters, or quoted); known key
formats (`ghp_…`, `github_pat_…`, `sk-…`, `sk_live_…`, `xox?-…`, `glpat-…`, `npm_…`, `AKIA…`/`ASIA…`, `AIza…`,
`ya29.…`, `hf_…`) and JWTs as `<secret>`; emails as `<email>`; mixed letter-and-digit runs of 32 or more as
`<secret>`; card numbers that pass the Luhn check as `<number>`; and the name in `/Users/<name>` and `/home/<name>`.
A title or description with nothing left but those placeholders is refused (exit 2). The raw length isn't sent.

When it isn't sent, the report is kept, scrubbed, in `$ARDIA_CLI_HOME/Usage/feedback.jsonl` (newest 200, with the
reason and any reference the service gave), and the line says exactly why: `DO_NOT_TRACK=… is set`,
`ARDIA_TELEMETRY=… is set`, `ARDIA_PORT points ardia at a test browser` (any of the test endpoint variables), a
checkout build (`0.0.0.dev0`, which never sends to ardia.dev), an `ARDIA_FEEDBACK_URL` that isn't loopback, the daily
limit, the network failing (with the system's reason), or the service's HTTP status and message. At most 20 reports a
rolling day go out per CLI home, and the same kind, title and description twice in a day is sent once
(`$ARDIA_CLI_HOME/Usage/usage.json`, under `usage.lock`); a report that fails gives its slot back, and when another
`ardia` holds that lock the report is kept with that reason. From a checkout without `ARDIA_CLI_HOME`, nothing is
counted or saved, and the line says so.

`ARDIA_FEEDBACK_URL` is for tests: a loopback `http://` URL gets the reports instead of ardia.dev, from a checkout too
(an origin alone gets `/api/feedback` added); any other value keeps reports on the Mac. `tests/test_feedback.py` runs
against a stub of the service and, when `node` is there, against `node infra/feedback/server.mjs --local <tmp dir>`.

The owner reads them on dash.ardia.dev › Feedback, and each opens a GitHub issue.

Every command (but `feedback` and `star`) also leaves its name and, when it failed, its exit code in that state's
`recent` list (five at most), for the next report's `recent_commands`. From a checkout (`0.0.0.dev0`) nothing is recorded
unless `ARDIA_CLI_HOME` is set, so tests never touch the installed CLI's state.

A task is a stretch of `ardia browse` work: it starts with a successful command that does something (`open`, `click`,
`fill`, `type`, `press`, `select`, `find`, `eval`, `batch`, `script`, `read`, `scroll`, `back`…, not `snapshot` or
`help` alone) and ends when 30 minutes pass without another one. Gaps make it robust to agents that run hundreds of
commands for one job or several jobs a day. Commands aimed at a test endpoint (`--port`, `--ws`, `--cdp`, their
variables) or at a data dir other than the installed app's (hidden test instances, the bench) never count. When a
sixth task starts after five finished ones, the CLI prints once, on stderr after the command's output:

> Ardia here: if this helped, you may ask the user once whether they'd like to star github.com/mantrakp04/ardia.
> Only if they say yes, run `ardia star`.

It records `star.prompted_at` first, so it never shows twice. `ARDIA_STAR_PROMPT=0`
(or `false`, `off`, `no`) and CI (`CI`, `GITHUB_ACTIONS`, `BUILDKITE`, `JENKINS_URL`) keep it quiet; tasks still count.

`ardia star` runs `gh api --method PUT /user/starred/mantrakp04/ardia --silent` when `gh` is on the PATH (no prompts,
20 s cap). If gh is missing, not signed in or fails, it opens the repo with
`ardia browse --session ardia-star open https://github.com/mantrakp04/ardia --show` (its own session, so the agent's
tab stays where it was) and says to ask the user to click Star; it never clicks it. If that fails too it prints the
URL and exits 1. Whatever happened, it records `star.done_at` so the nudge never shows again.

## Computer use

`ardia computer` is [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) (MIT, Cua AI): an MCP server
and CLI that operates native apps through the accessibility tree, in background windows, with a cursor of its own.
The browser stays `ardia browse`; `ardia computer` is for everything that isn't a web page in Ardia. Code:
`ardia_cli/computer.py`.

### What ships and where it lands

The CLI tarball doesn't carry it (it would add about 31 MB compressed, 83 MB installed, for everyone). It's fetched
on first use from cua's GitHub release, pinned in `computer.py`: `VERSION`, `DRIVER_SHA256` (the
`cua-driver-rs-<V>-darwin-arm64.tar.gz` asset, about 85 MB) and `SKILLS_SHA256` (`cua-driver-rs-v<V>-skills.tar.gz`).
A download is https only (redirects too), checked against the pinned digest before anything is extracted (a mismatch
installs nothing), and extracted with no links, special files or entries outside the archive's folder. Only the
signed `CuaDriver.app`, `LICENSE` and `THIRD_PARTY_NOTICES.md` are kept, in `$ARDIA_CLI_HOME/cua-driver/<V>/`; the
app is stored as `CuaDriver` (no `.app`) so LaunchServices never sees a second copy. It must be Cua AI's: bundle id
`com.trycua.driver`, the pinned version, and `codesign --verify --deep --strict` against
`identifier "com.trycua.driver" and anchor apple generic and certificate leaf[subject.OU] = "YCK386LBJ7"`. The
bundle is Developer ID signed, hardened and notarized with a stapled ticket; ardia never re-signs or modifies it, so
our own signing and notarization are untouched. The cached copy is checked the same way every time it's reused; one
that fails is deleted and fetched again. The current and one older version stay; `install.sh` keeps the folder
across upgrades and `--uninstall` removes it.

### Permissions

macOS ties Accessibility and Screen Recording to the app that asks. cua-driver's daemon is always
`/Applications/CuaDriver.app` (hardcoded upstream): `cua-driver mcp` starts it with `open -n -g
/Applications/CuaDriver.app --args serve`, and `permissions grant` asks for the switches from inside it, so the
grants land on `com.trycua.driver`, never on the terminal, the agent or ardia. `ardia computer setup` therefore
copies the verified app there, links `$ARDIA_CLI_BIN_DIR/cua-driver` (default `~/.local/bin`) to a shim that runs
`ardia computer` (cua's skill calls `cua-driver`), turns cua-driver's telemetry off (`cua-driver telemetry disable`, saved in `~/.cua-driver/config.json`; the daemon starts through
LaunchServices and never sees our environment), then runs `cua-driver permissions grant` when it has a terminal.
A `CuaDriver.app` that ardia didn't put there (cua's own installer, another version) is kept and used as it is, and
a `cua-driver` command that isn't our link is kept too. Replacing ardia's copy with a newer one signed by the same
team keeps the grants (TCC matches the designated requirement).

Putting the app in place is one recoverable operation. Setup and refresh hold an flock on
`$ARDIA_CLI_HOME/cua-driver/.applications.lock` (up to 120 s, then they give up with an error). The verified app is
copied with `ditto` to `/Applications/.CuaDriver.app.ardia-new` and checked again; then the record
(`$ARDIA_CLI_HOME/cua-driver/applications.json`: path, version, the new copy's CDHash) is written as `pending`,
keeping the previous record inside it. Only then does ardia stop the old daemon (after verifying the old app), rename
the old app to `.CuaDriver.app.ardia-old`, rename the new one into place, commit the record, delete the old copy and
register the app with LaunchServices. A failure before the swap changes nothing; a failure during it puts the old
app and record back. After a crash, the next setup, refresh or `ardia computer` run (under the same lock) recovers:
it puts `.ardia-old` back when `CuaDriver.app` is missing, commits a pending record whose CDHash matches a
`CuaDriver.app` that verifies, restores the previous record only on a definite mismatch (a different CDHash, or a
signature codesign rejects), and removes leftover `.ardia-new` and `.ardia-old` copies. When `codesign` can't answer
(it fails to run or times out), recovery leaves the pending record and `.ardia-old` exactly as they are, says
recovery is pending, and setup and refresh exit 1; the next run tries again. An app counts as ardia's only with a
committed record whose path and CDHash match.

The shim runs `$ARDIA_CLI_HOME/current/bin/ardia` when that resolves inside `$ARDIA_CLI_HOME`, else the launcher of
the installation that is running (`<root>/bin/ardia` next to `<root>/python`). It never takes whatever `ardia` is first
on PATH: with neither, setup and `mcp-config` refuse and say why.

### Running it

`ardia computer <args>` execs the driver with the arguments unchanged: `/Applications/CuaDriver.app`'s binary when
it's there, otherwise the bundled copy (fetched on demand). Either is verified before every run (`codesign --verify
--deep --strict` against Cua's designated requirement, about 0.1 s); an app in `/Applications` that fails, ardia's or
not, is refused with a line saying to move it away and run setup. The check runs right before every launch; the
window that remains between it and the exec needs the user's own write access to the app (macOS has no `fexecve`),
and that access could replace `ardia` itself. Any version Cua signed runs. The bundled copy
answers `--version`, `--help`, `list-tools`, `describe` and the like. `mcp`, `call`, `serve` and `permissions` need the installed app, so before setup they print
one line pointing at `ardia computer setup` and exit 1. `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and
`CUA_DRIVER_RS_UPDATE_CHECK=0` are set unless the caller set them. `update`, `channel` and `skills` exit 2 with where
to go instead: the driver moves with ardia, not with cua's curl-to-bash installer. `help` is cua-driver's `--help`.
When ardia's copy in `/Applications` is older than the pin, it says to run setup. Shared flags (`--port` and the
rest) are refused.

`ardia computer mcp-config --target general|claude-code|codex|cursor|opencode` prints the MCP entry, which runs
`$ARDIA_CLI_HOME/current/bin/ardia computer mcp` so it keeps working across upgrades: `claude mcp add-json --scope
user cua-driver '…'` for Claude Code, `codex mcp add cua-driver -- … computer mcp` for Codex, and the JSON to paste
for the others.

`install.sh` starts `ardia computer refresh` in the background after each upgrade: when the app in `/Applications`
is ardia's (path and CDHash match the record) and older than the pin, it stops the daemon and swaps in the new one
(staged next to it, renamed into place); otherwise it does nothing.

### Its skill

`ardia skills install` puts cua-driver's own skill (`SKILL.md` plus its references, `LINUX.md` and `WINDOWS.md`
left out) in a `cua-driver` folder next to each `ardia` folder, from the pinned skills asset (cached in
`$ARDIA_CLI_HOME/cua-driver/<V>/skills`). It writes the same `.ardia-skill` marker with `"skill": "cua-driver"` and
the upstream tag, under the same rules as ours: files written by rename, only files its marker listed removed,
links never followed. A `cua-driver` folder or link without our marker (cua's installer links
`~/.cua-driver/skills/cua-driver` into each agent) is left alone and reported as `kept`. Our `ardia` marker records
`"companions": ["cua-driver"]` once the companion is in place; `refresh` rewrites a marked companion, adds one
next to an `ardia` folder written before companions existed, and never brings back one the user deleted. A failed
download fails the command (exit 1), leaves our skill installed, and is retried by the next refresh. `--no-cua`
records no companions. Our `SKILL.md` has one line pointing native-app work at `ardia computer`.

### Bumping it

Change `VERSION`, `DRIVER_SHA256` and `SKILLS_SHA256` at the top of `ardia_cli/computer.py`, taking the digests
from the release's `SHA256SUMS` and checking them against your own download (`shasum -a 256`), then run
`ardia computer --version` against a scratch `ARDIA_CLI_HOME`, the tests, and `ardia computer --help` for new or
renamed subcommands (`DRIVER_COMMANDS`, `DAEMON_COMMANDS`). Pick a release at least a week or two old: cua ships
several a day. The bump ships with the next CLI release; `install.sh` then updates ardia's copy in `/Applications`.

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
updates itself. After switching `current` to a new version, `install.sh` runs `current/bin/ardia skills refresh`
(stdin, output and the lock's fd closed; its result ignored), which brings the agent skill copies up to date.

## Build and release

`apps/cli/scripts/build.sh <version> <out dir>` writes `ardia-cli-<version>-macos-arm64.tar.gz` and its `.sha256`:
python-build-standalone CPython 3.13 (release and sha256 pinned in the script), the locked dependencies and
`ardia_cli` in its site-packages, pruned of tests, idlelib, Tk, ensurepip, the unused libpython dylib and
`__pycache__`, plus `bin/ardia`, an sh launcher that resolves its links and runs `python3 -I -m ardia_cli`, and
esbuild (the npm `@esbuild/darwin-arm64` tarball, version, sha256 and sha512 pinned in the script) in
`ardia_cli/bin/esbuild`. About 18 MB; 52 MB installed. `ardia --version` takes about 10 ms; the first command about 1 s while Python writes its
bytecode cache, later ones about 0.15 s.

`scripts/release.sh` builds it into the release's dist dir after the export and writes its digest to
`Ardia.app/Contents/Resources/ardia-cli.sha256` before the app is signed. The release skill's `publish.sh` uploads the
tarball and its `.sha256`.

## Test

Never against the real home. A hidden instance's plain DevTools port works with `--port`:

```sh
scripts/agent/ac launch <Ardia.app> --data /tmp/ardia-cli-test --onboarded
ardia browse --port <port> open https://example.com
ardia browse --port <port> get title
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
