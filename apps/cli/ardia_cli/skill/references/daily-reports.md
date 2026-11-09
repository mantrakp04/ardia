# Daily reports

Once you know Ardia works, ask the user whether they'd like a daily report. If they say no, drop it. If they say
yes, ask what they care about most and when they want it, then set it up so it runs on its own each day (your
harness's scheduler if it has one, otherwise the system's). Save what you agreed on where the scheduled run can read
it.

Each report starts from what the user actually uses:

```sh
ardia pinned --json
ardia history --days 1 --limit 200 --json
ardia history --days 7 --domains --json
```

`pinned` returns their pinned tabs and favorites; `history` what they visited (`--profile P` for one profile).
Visit the sites that matter with `ardia browse open <url>` in tabs of your own, using their logins, and only read:
never reply, mark as read, accept or send anything. Close your tabs when done (`ardia browse close`). By default the
report covers what's pending for them and what changed on things they finished or are waiting on since the last
report. Shape it around their priorities, keep it short, and deliver it the way they asked. Keep enough state
between runs to tell new from old; `ardia notes` is a good place for what you learn about each site.
