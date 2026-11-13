# Tabs and groups, commands, windows, events and hooks

## Tabs and groups

`ardia tabs` and `ardia groups` do what the sidebar does (open, move, nest, pin, rename, set icons and colours,
mute, sleep, close) on tabs and groups by id, without changing the tab a window shows. Read the workspace first:

```sh
ardia tabs --json        # windows › spaces (one per profile) › topApps, pinned, tabs; groups nest with items
ardia tabs --flat --json # one object per tab: id, url, title, pin, group, window, profile, active, asleep
ardia tabs --usage       # each tab's process: pid, CPU % of a core, memory, hottest first (--json: pid, cpu, memory)
ardia tabs --pid 61234   # the tabs in that process, to name a pid from top or Activity Monitor
ardia groups --json      # every group: id, name, icon, color, collapsed, pinned, parent, depth, tabs
```

```sh
ardia tabs open https://a.example https://b.example --group Work  # background tabs, in that group
ardia tabs move tab-1 tab-2 --group Work                           # into a group, by name or id
ardia tabs move tab-3 --top                                        # out of every group
ardia tabs move tab-4 --after tab-9                                # next to a tab, in its group
ardia tabs pin tab-5 --row ; ardia tabs sleep tab-6 ; ardia tabs rename tab-7 "Inbox"
ardia groups create tab-1 tab-2 --name Work --icon 🚀 --color blue --unpinned
ardia groups update Work --collapse ; ardia groups move Reading --parent Work ; ardia groups ungroup Imported
```

For a whole layout, send one `ardia apply` (a JSON list on stdin; `$N` is what operation N made: its group, else
its tabs). It checks every operation first, runs them in order, stops at the first that fails and says which ran;
`--json` returns the resulting tabs and groups, so verify from that.

```sh
ardia apply --json <<'EOF'
[{"op": "group.create", "urls": ["https://a.example", "https://b.example"], "name": "Research", "pinned": false},
 {"op": "group.create", "parent": "$0", "tabs": ["tab-7", "tab-8"], "name": "Papers", "icon": "📚"},
 {"op": "group.update", "group": "$1", "collapsed": true},
 {"op": "tab.move", "tabs": ["tab-9"], "group": null}]
EOF
```

- Group arguments take a name (case-insensitive, in that window) or an id; a name two groups share fails with both
  ids. Groups made one after another from one group's tabs keep their order above it.
- New groups are pinned (as in the sidebar) unless `"pinned": false` or a `parent`. Icons: an emoji from Ardia's
  picker or `symbol:<SF Symbol>`; colours: neutral, none, grey, blue, red, yellow, green, pink, purple, cyan, orange.
- URLs: http, https, file, about:blank and ardia://history, bookmarks, downloads, newtab only.
- Closing a group (`groups close`) keeps it in History › Recently Closed Groups; `delete` doesn't. Shared-folder
  groups and private windows are refused. Ask before closing or deleting what the user didn't name.

## Commands, windows, events and hooks

Ardia's own commands (new tab, toggle sidebar, select tab 3, split view and the rest of its menus) run with
`ardia run`, without CDP. `ardia commands` lists them with their variants; `ardia windows` lists the windows and
their tabs, private windows never included. Prefer these to clicking through a page when the user asks Ardia to do
something to itself.

```sh
ardia commands
ardia run newTab
ardia run selectTab 3
ardia run togglePin --window 2 --tab 5
ardia windows --json
ardia events tab.navigated
```

To react to the browser (a tab opening, a page loading, media starting, a tab going idle, the Mac waking), write a
hook: a program that gets the event's JSON on stdin and `ARDIA_EVENT`, `ARDIA_URL`, `ARDIA_TITLE`, `ARDIA_TAB_ID`,
`ARDIA_WINDOW_ID` and `ARDIA_PROFILE` in its environment. Those values come from pages: a hook that prints them to a
terminal should escape control characters. `ardia events --help` lists every event. URLs arrive
without their query and fragment unless the hook says `"fullUrls": true` (`--full-urls`); notifications, presence
(`user.idle`, `app.activated`, `system.sleep`…) come only when named, never through `"*"`. Try a hook with
`ardia on tab.navigated --match 'https://*.youtube.com/*' -- ~/bin/yt-hook`, then put it in
`~/.config/ardia/hooks.json`:

```json
{
  "hooks": [
    { "name": "yt-to-media", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"], "run": ["~/bin/yt-hook"], "timeout": 30, "fullUrls": true },
    { "name": "park", "on": "tab.idle", "idle": "2h", "command": "togglePin" },
    { "name": "standup", "at": "09:55", "days": ["mon", "tue", "wed", "thu", "fri"], "run": ["~/bin/standup"] },
    { "name": "old-reddit", "on": "tab.opening", "rewrite": [{ "match": "https://www.reddit.com/*", "to": "https://old.reddit.com{path}{query}" }] },
    { "name": "no-camera", "on": "permission.requested", "kinds": ["camera"], "permission": "deny" }
  ]
}
```

- A hook has one trigger (`on`, `at` + optional `days`/`timezone`, `every`, or `omnibox`) and one action: `run`
  (argv), `command` (+ `arg`, an Ardia command id run in the event's window and tab, no process), or a decide answer.
- Decide hooks answer before Ardia acts: `tab.opening` (`rewrite`, `cancel`), `link.opening` from other apps
  (`route`, `drop`, `from`), `download.deciding` (`folder` under `~/Downloads`), `permission.requested`
  (`permission`: deny or ask). As rules Ardia applies them itself, even with control off; with `run`, the program's
  stdout JSON is the answer, within 250 ms for openings. Anything late or invalid means Ardia's default.
- Rules that rewrite to another site, route links, pick a folder outside Downloads, run a decide program or read
  the address bar (`omnibox` providers) stay off until the user approves them in Settings › Advanced › Automation.
  Tell the user that after writing one.

`run` is argv, not a shell line; use `["/bin/sh", "-c", "…"]` when you need one, and never paste event values
into it. `ardia hooks list` checks the file, `ardia hooks install` (ask first) runs the hooks at every login, and
their output goes to `~/Library/Logs/Ardia/hooks.log`.
