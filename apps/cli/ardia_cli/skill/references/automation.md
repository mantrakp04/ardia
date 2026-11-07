# Commands, windows, events and hooks

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
`ARDIA_WINDOW_ID` and `ARDIA_PROFILE` in its environment. `ardia events --help` lists every event. URLs arrive
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
