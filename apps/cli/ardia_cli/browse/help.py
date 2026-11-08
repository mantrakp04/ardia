OVERVIEW = """\
ardia browse - agent-browser's commands, driving the Ardia you're running

Usage: ardia browse <command> [args] [options]

Same commands, flags and output (text and --json) as agent-browser, so an agent that
knows `agent-browser <args>` can type `ardia browse <args>`. It drives the running Ardia
over the ardia command's control connection (Settings > "Let the ardia command control
Ardia"), through pydoll. Input is instant unless --humanize. Actions print what they changed
(nodes with refs, URL, title, the POSTs they caused), a session with no tab uses the user's
active tab, and text output stops at about 6,000 characters (narrow it with snapshot -i or -s <css>).

Core Commands:
  open [url]                 Open url in a new background tab of this session (later opens reuse it)
  read [url...]              Read pages' text in background tabs (--links <pattern>: every matching link; -s sel)
  click <sel>                Click element (or @ref) [--new-tab]
  dblclick <sel>             Double-click element
  type <sel> <text>          Type into element
  fill <sel> <text>          Clear, then type (date/time/color/range inputs: set the value)
  press <key>                Press key (Enter, Tab, Control+a, Meta+a)
  keydown <key> / keyup <key>  Hold or release a key
  keyboard type <text>       Type at the current focus (humanized keystrokes)
  keyboard inserttext <text> Insert text without key events
  hover <sel>                Hover element
  focus <sel>                Focus element
  check <sel> / uncheck <sel>  Set a checkbox
  select <sel> <val...>      Pick option(s): a <select>, or a combobox/typeahead (types, picks the match)
  drag <src> <dst>           Drag with the mouse
  upload <sel> <files...>    Upload files                        (gated, see below)
  download <sel> <path>      Download by clicking element        (gated)
  scroll [dir] [px]          Scroll (up/down/left/right, default down 300) [-s <sel>]
  scrollintoview <sel>       Scroll element into view
  wait <sel|ms>              Wait for element or time; --text, --url, --load, --fn, --state
  screenshot [sel] [path]    Screenshot [--full] [--annotate]
  pdf <path>                 Save as PDF
  snapshot                   Accessibility tree with refs [-i] [-c] [-d n] [-s sel] [-u] [--diff]
  eval <js>                  Run JavaScript in the page [-b base64] [--stdin]
  close [--all]              Close the tabs this session opened and end the session

Selectors:   CSS, @e3, text=Save (text="Save" exact), role=button[name="Save"], li:has-text("Ana"), xpath=//a;
             [role=main] also matches <main> and the other implicit roles
Navigation:  back, forward, reload, pushstate <url>
Get Info:    get text|html|value|attr <name>|title|url|count|box|styles <sel>
Check State: is visible|enabled|checked <sel>
Find:        find role|text|label|placeholder|alt|title|testid|first|last|nth <value> [action] [text]
             actions: click (default), fill, type, check, uncheck, select, hover, focus, dblclick, text
             find role <role> <action> --name <name>: exact name first, several matches list refs
Mouse:       mouse move <x> <y> | down [btn] | up [btn] | wheel <dy> [dx]
Settings:    set viewport|device|geo|offline|headers|credentials|media   (gated)
Network:     network requests [--filter --type --method --status --clear] | request <id>
             network har start [--content text|all|none] | har stop [path]
             network route <url> [--abort|--body <json>] | unroute [url]  (gated)
Storage:     storage local|session [get [key] | set <k> <v> | clear]
             cookies [get|set|clear]                                     (gated)
             state save|load <path>                                      (gated)
Tabs:        tab [list] | tab new [--label name] [url] | tab <t1|tab-…|label|targetId> | tab active
             tab close [tab] (only tabs this session opened) | window new [url]
             (t1 ids are the same in every session; tab-… ids are the ones `ardia windows` prints)
Frames:      frame <sel|@ref|name|url> | frame main
Dialogs:     dialog status | accept [text] | dismiss
Diff:        diff snapshot [--baseline f] | diff screenshot --baseline f | diff url <u1> <u2>
Debug:       console [--clear], errors [--clear]   (turn on Runtime for the tab on first use)
             highlight <sel>, clipboard read|write|copy|paste            (gated)
             trace start|stop [path], profiler start|stop [path]         (gated)
             record start <path.webm> [url] | stop | restart             (gated; needs ffmpeg)
Streaming:   stream enable [--port n] [--input] | disable | status       (gated)
React:       react tree | inspect <id> | renders start|stop | suspense [--only-dynamic]
             (needs `open --enable react-devtools <url>`)
Performance: vitals [url]
Audit:       a11y [url] [--tags t1,t2] [--selector css]
Init:        addinitscript <js> | removeinitscript <id>   (page main world, by request)
Batch:       batch [--bail] ["cmd args" | '["cmd","arg"]' ...]  (or one command per stdin line; # comments)
Script:      script [file.js] [--timeout 90s]   (JS on stdin: loops over pages with page.goto/click/text, read())
Notes:       notes [get|set|append|list|rm] [site] [text|-]   (plain per-site notes, shown atop snapshot)
Auth Vault:  auth save <name> --url <https url> --username <u> [--password-stdin]
             auth login <name> [--username-selector s] [--password-selector s] [--submit-selector s]
             auth login <name> --credential-provider <plugin> [--item ref] [--url url]
             auth list | show <name> | delete <name>
Plugins:     plugin add <npm-name[@version] | owner/repo[#ref]> [--name n] [--capability c]
             plugin list | show <name> | remove <name> | run <name> <type> [--payload json]
Sessions:    session | session info | session list | session id [--scope cwd|worktree] [--prefix p]

Options:
  --session <name>        Command-state namespace: its own tabs, refs and captures (AGENT_BROWSER_SESSION)
  --namespace <name>      Separate set of sessions (AGENT_BROWSER_NAMESPACE)
  --json                  JSON output (AGENT_BROWSER_JSON)
  --humanize              Humanized mouse, scroll and typing (AGENT_BROWSER_HUMANIZE=1 for all)
  --no-humanize           Instant input (the default; AGENT_BROWSER_NO_HUMANIZE=1 forces it)
  --no-changes            Don't report what an action changed (skips its snapshots and network watch)
  --data-dir <dir>        Ardia data dir to find (default $ARDIA_DATA_DIR, else the installed app's)
  --port <n>, --cdp <n>   A plain DevTools test server on 127.0.0.1:n (testing only)
  --ws <url>              A browser WebSocket URL
  --capture-console       With open: start console and error capture before the page loads
  --enable react-devtools With open: install the React DevTools hook before page JS
  --init-script <path>    With open: register a page init script (repeatable)
  --annotate              Screenshot: draw numbered labels for the refs
  --screenshot-dir/-format/-quality   Screenshot defaults (AGENT_BROWSER_SCREENSHOT_*)
  --max-output <chars>    Cap text output (default 6000, 0 for none; AGENT_BROWSER_MAX_OUTPUT)
  --full                  Don't cap text output
  --content-boundaries    Wrap page output in markers (AGENT_BROWSER_CONTENT_BOUNDARIES)
  --no-auto-dialog        Don't accept alert/beforeunload dialogs (AGENT_BROWSER_NO_AUTO_DIALOG)
  --pin-tab, --no-pin-tab Fail with tab_gone instead of falling back when the session's tab closes
  --idle-timeout <time>   End an idle session after 10s, 3m, 1h or raw ms (default 1h)

Gated: Ardia's ardia-command policy (the engine's token server) doesn't yet allow the CDP
methods these need, so over the real connection they fail naming the refused method; they
work against a plain --port test server.

Not here: connect, inspect, install, upgrade, doctor, dashboard, chat (no AI), mcp, profiles,
confirm/deny, iOS (-p ios, swipe, tap), cloud providers, and launch options (--headed,
--profile, --proxy, --extension, --args, ...), since Ardia is the browser you're running.

Exit status: 0 done, 1 the command failed, 2 Ardia can't be reached or closed the connection
(the outcome of an interrupted action is reported as unknown), 130 interrupted.

Examples:
  ardia browse open example.com
  ardia browse snapshot -i
  ardia browse click @e2
  ardia browse fill @e3 "user@example.com"
  ardia browse fill @e7 2026-11-09
  ardia browse batch <<'EOF'
  click @e10
  fill #name "Ana Ruiz"
  click #save
  EOF
  ardia browse find role button click --name Submit
  ardia browse read --links /p/ -s table.specs
  ardia browse script <<'EOF'
  const out = [];
  for (const url of await page.links("/p/")) { await page.goto(url); out.push({ name: await page.text("h1") }); }
  return out;
  EOF
  ardia browse screenshot --annotate page.png
"""

COMMANDS = {
    "open": "ardia browse open [url] [--enable react-devtools] [--init-script <path>] [--capture-console] [--label name]\n\n"
            "Without a tab, opens a new background tab in Ardia's sidebar (the user's own tab is never navigated\n"
            "unless the session picked it with `tab <id>`). Later opens navigate the session's tab. A URL without a\n"
            "scheme gets https:// (http:// for localhost). Prints the title and URL.",
    "snapshot": "ardia browse snapshot [-i] [-c] [-d <n>] [-s <sel>] [-u] [--diff]\n\n"
                "Accessibility tree with refs (@e1, @e2...). -i interactive only, -c compact, -d depth, -s scope to a\n"
                "selector or @ref (every match that shows, so hidden matches like a closed cookie banner are skipped),\n"
                "-u include link URLs, --diff only what changed since this session's last snapshot\n"
                "of the document. Date and time inputs show as one textbox with their value. Site notes, when there\n"
                "are any, come first. Refs belong to this snapshot's document: a navigation, a new document or an\n"
                "Ardia restart makes them stale, and a stale ref is reported, never guessed.",
    "click": "ardia browse click <sel> [--new-tab] [--button left|right|middle] [--humanize] [--no-changes]\n\n"
             "Clicks the element (with --humanize along a curved mouse path with human timing) and prints what\n"
             "changed: nodes added, changed or removed with their refs, URL and title, and non-GET requests it\n"
             "caused. A long run of one role (options, links, many buttons) is one line with its count, first and\n"
             "last name and refs, plus any selected one; nodes redrawn unchanged are one line with their new refs.\n"
             "Fails with `covered by <...>` when another element sits on top of the target.",
    "fill": "ardia browse fill <sel> <text> [--humanize] [--no-changes]\n\nFocuses the field, clears it (select all, Backspace), then types per character. Date, time,\n"
            "datetime-local, month, week, color and range inputs get their value set instead (YYYY-MM-DD, HH:MM or\n"
            "2:30 PM, YYYY-MM-DDTHH:MM, YYYY-MM, YYYY-Www, #rrggbb, a number), with input and change events; a bad\n"
            "value fails with the format. Prints what changed. On a combobox it waits briefly for suggestions and\n"
            "says how many show; typing never picks one (use select for that).",
    "select": "ardia browse select <sel> <value...> [--humanize] [--no-changes]\n\n"
              "On a <select>, picks the options by value or label. On a combobox (a typeahead or chip input, a\n"
              "button that opens a listbox, an input with a datalist) it does it per value: types the value (or\n"
              "opens the list), waits for the suggestions to settle, and clicks the one that matches: the exact\n"
              "text, else one whose line or email is the value, else the only one containing it. Two matches or\n"
              "none fail and list the suggestions, nothing picked. Several values fill a chip input in one call:\n"
              "  ardia browse select @e5 \"Priya Raman\" alex@example.com\n"
              "Prints what it picked and what changed.",
    "type": "ardia browse type <sel> <text> [--no-humanize]\n\nTypes into the element without clearing it.",
    "press": "ardia browse press <key> [--no-humanize]\n\nKeys: Enter, Tab, Escape, Backspace, Delete, Space, Arrow*, Home, End, PageUp, PageDown, F1-F12.\n"
             "Modifiers: Control, Alt, Shift, Meta (Meta+a selects all on macOS).",
    "keyboard": "ardia browse keyboard type <text> | inserttext <text>\n\ntype sends humanized keystrokes to the focused element; inserttext inserts at once.",
    "scroll": "ardia browse scroll [up|down|left|right] [px] [-s <sel>] [--no-humanize]\n\nWheel scrolling with momentum, at the mouse position (moved into the page or the container first).",
    "wait": "ardia browse wait <sel|ms> [--state visible|hidden|attached|detached] | --text <t> | --url <glob> |\n"
            "  --load load|domcontentloaded|networkidle | --fn <js> [--timeout ms]\n\n--fn evaluates in the page's main world, like eval. Timeouts default to 25 s.",
    "screenshot": "ardia browse screenshot [sel] [path] [--full] [--annotate] [--screenshot-format png|jpeg] [--screenshot-quality n]\n\n"
                  "--annotate takes an interactive snapshot and draws the numbered labels onto the image (nothing is added\n"
                  "to the page). Without a path it saves under $TMPDIR/ardia-browse/screenshots.",
    "eval": "ardia browse eval <js> | -b <base64> | --stdin\n\nRuns in the page's main world (the one place, with init scripts and the React hook, that does).",
    "get": "ardia browse get text|html|value|attr <name>|title|url|count|box|styles <sel>\n\ncdp-url works only with --port or --ws: the real URL carries Ardia's token.",
    "find": "ardia browse find <role|text|label|placeholder|alt|title|testid|first|last|nth> <value> [action] [text] [--name n] [--exact]\n\n"
            "Actions: click (default), fill, type, check, uncheck, select, hover, focus, dblclick, text. The found element\n"
            "gets the next ref, so later commands can use it.\n\n"
            "find role takes the role and accessible name the snapshot shows, in any order: `find role button\n"
            "click --name Save`, `find role button --name Save click` or `find role button Save click`. A name\n"
            "matches exactly first (case and spacing aside; --exact makes it case-sensitive), else as part of a\n"
            "longer name. When several elements match, nothing is clicked and the error lists them with refs.\n"
            "An element that isn't there yet is waited for up to 1.5 s.",
    "tab": "ardia browse tab [list] | new [--label name] [url] | <t1|tab-…|label|targetId> | active | close [tab] [--show]\n\n"
           "list shows the user's tabs too, with the tab-… id `ardia windows` prints when the address pairs them\n"
           "up, and which session opened or uses each. A t1 id is the same in every session and never moves to\n"
           "another tab. Switching changes which tab this session acts on, not what Ardia shows (--show does).\n"
           "`tab active` picks the tab the user is looking at. close only closes tabs this session opened, and\n"
           "not one another session is using. When Ardia swaps a tab's page (it slept, or crashed and reloaded),\n"
           "the session follows it to the new page.",
    "console": "ardia browse console [--clear]\n\nThe first call turns on the Runtime domain for the session's tab (Chrome then replays earlier\n"
               "messages); until then ardia browse leaves Runtime off, unlike agent-browser.",
    "errors": "ardia browse errors [--clear]\n\nUncaught exceptions; turns Runtime on like console.",
    "network": "ardia browse network requests [--filter p] [--type t] [--method m] [--status 2xx] [--clear] | request <id>\n"
               "  | har start [--content text|all|none] | har stop [path] | route <url> [--abort|--body json] | unroute [url]\n\n"
               "route needs Fetch.enable, which Ardia's policy doesn't allow yet. On the real connection Ardia strips\n"
               "Cookie, Set-Cookie and Authorization headers from what the command sees.",
    "auth": "ardia browse auth save <name> --url <https url> [--origin <url>]... --username <u> [--password-stdin]\n"
            "  [--username-selector s] [--password-selector s] [--submit-selector s]\n"
            "ardia browse auth login <name> | list | show <name> | delete <name>\n\n"
            "Passwords live in the macOS login Keychain (via /usr/bin/security, written on its stdin, never argv).\n"
            "--password is refused. login checks the page's committed origin and frame against the saved https\n"
            "origins before typing and stops if the page navigates, the frame changes or focus leaves the field.",
    "batch": "ardia browse batch [--bail] [\"cmd args\" | '[\"cmd\",\"arg\"]' ...]\n\nRuns commands in order in one call; without arguments, one command per stdin line (a heredoc\n"
             "works; blank lines and # lines are skipped). Lines use shell quoting or a JSON array. Each answer,\n"
             "with its changes, is printed in order. --bail stops at the first failure. A line takes its command's\n"
             "own flags and per-command ones like --full, --no-changes or --humanize. `close` as the last line ends the\n"
             "session after the rest ran (not after a failure). To loop over pages, use read or script instead.",
    "notes": "ardia browse notes [get|set|append|list|rm] [site] [text|-]  (also `ardia notes`)\n\n"
             "Plain notes per site (host[:port]) for your own agent, in <data dir>/Notes/<site>.md (0600, 8 KB each).\n"
             "Without a site it's the session tab's (--tab <id> for another tab's). - reads stdin. snapshot prints a\n"
             "site's notes first, and so does an action that lands on another site.",
    "read": "ardia browse read [url...] [--links <pattern>] [-s <selector>] [--stdin] [--limit n] [--timeout ms] [--http] [--list]\n\n"
            "Reads each page in a background tab of this session's own (four at a time, through your logins, after its\n"
            "scripts ran) and prints its title, URL and text: the page's <main>, else its body, or what -s matches.\n"
            "Tabs close when it's done. With no URL it reads the session's tab. --links <pattern> reads every link on the session's tab whose URL contains the\n"
            "pattern (* matches anything), in page order; --list only prints those links. URLs can also come one per line\n"
            "on stdin (--stdin or -), and /paths resolve against the session's tab. At most 20 pages unless --limit (100).\n"
            "The text output shares the output cap between pages; narrow it with -s or a tighter --links (--json has all).\n"
            "--http fetches outside the browser instead (no logins, no page scripts; faster on public docs), and so do\n"
            "--llms index|full, --require-md, --raw, --outline and --filter, which also work on the session's tab's URL.\n"
            "Exit 1 when any page failed (its block says why).",
    "script": "ardia browse script [file.js] [--timeout 90s]   (or the script on stdin)\n\n"
              "Runs a short JavaScript program that drives pages, so a loop over many pages is one call. It runs in a\n"
              "blank background page of its own, and every page action is one of ardia browse's commands on this session\n"
              "(the same tab, refs, rules and change reports), so nothing a command refuses works here either.\n\n"
              "  page.goto(url)  back()  reload()        page.click(sel)  fill(sel, text)  type(sel, text)  press(key)\n"
              "  page.select(sel, value)  check(sel)  uncheck(sel)  hover(sel)  scroll(dir, px)\n"
              "  page.text(sel?)  value(sel)  attr(sel, name)  count(sel)  visible(sel)  url()  title()\n"
              "  page.snapshot('-i -s main')  page.links(pattern?)  page.wait(sel | ms | {text, url, load, fn})\n"
              "  page.evaluate(fn, arg)   (runs in the page's main world, like eval)\n"
              "  read(urls | {links, selector})  -> [{url, title, text, error}]   (as `read`, in background tabs)\n"
              "  browse('tab', 'list')  -> {text, data}   (any other command)\n"
              "  log(...) / console.log(...)   sleep(ms)   return value   (printed as JSON)\n\n"
              "Actions return their answer text with what changed. A selector is CSS, @eN, text=… or xpath=…; a /path\n"
              "resolves against the tab. A failed command throws (err.code, err.message); uncaught, the script stops and\n"
              "says which line. It stops at --timeout (default 90s, at most 10m), and after any command whose outcome is\n"
              "unknown. Output is capped like other commands.\n\n"
              "  ardia browse script <<'EOF'\n"
              "  const rows = [];\n"
              "  for (const url of await page.links('/p/')) {\n"
              "    await page.goto(url);\n"
              "    rows.push({ name: await page.text('h1'), price: await page.text('.price') });\n"
              "  }\n"
              "  return rows;\n"
              "  EOF",
    "close": "ardia browse close [--all]\n\nCloses only the tabs this session opened (never the browser) and ends the session; a tab another\n"
             "session is using stays open and the answer says so. --all does it for every session.",
    "record": "ardia browse record start <path.webm> [url] | stop | restart <path.webm> [url]\n\nNeeds Page.startScreencast (not allowed by Ardia's policy yet) and ffmpeg on PATH.",
    "stream": "ardia browse stream enable [--port n] [--input] | disable | status\n\nBinds 127.0.0.1 only, with its own random token in the URL; view only unless --input. Needs Page.startScreencast.",
    "react": "ardia browse react tree | inspect <id> | renders start | renders stop | suspense [--only-dynamic]\n\nNeeds `ardia browse open --enable react-devtools <url>`.",
    "plugin": "ardia browse plugin add <npm-name[@version] | owner/repo[#ref]> [--name n] [--capability c]... | list | show <name>\n"
              "  | remove <name> | run <name> <type> [--payload json]\n\n"
              "add pins the exact version (or commit) and installs with npm --ignore-scripts into Ardia's data dir.\n"
              "Nothing is loaded from the current directory or an agent-browser.json.",
    "session": "ardia browse session | info | list | id [--scope cwd|worktree] [--prefix p]\n\n"
               "A session is a command-state namespace (its tabs, refs, mouse position and captures) on the same\n"
               "Ardia, not an isolated browser: cookies and logins are the user's.",
}
