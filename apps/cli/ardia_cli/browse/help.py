import re

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
  fill <sel> <text>          Clear, then type (date/time/color/range inputs: set the value; a <select>: pick;
                             a grid cell: open its editor, set, Enter)
  press <key>                Press key (Enter, Tab, Control+a, Meta+a)
  keydown <key> / keyup <key>  Hold or release a key
  keyboard type <text>       Type at the current focus (humanized keystrokes)
  keyboard inserttext <text> Insert text without key events
  hover <sel>                Hover element
  focus <sel>                Focus element
  check <sel> / uncheck <sel>  Set a checkbox
  select <sel> <val...>      Pick option(s): a <select>, or a combobox/typeahead (types, picks the match)
  drag <src> <dst>           Drag onto dst's far half, taking its place [--before|--after]
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
Settings:    set viewport <w> <h> [scale] | reset                 (this session's own hidden tab, off-screen)
             set device|geo|offline|headers|credentials|media    (gated)
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
  --no-text               Leave the page text (`text:` lines) out of an action's change report
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
            "unless the session picked it with `tab <id>`). When the session was using the user's tab, the answer\n"
            "names both: `→ [t4] is this session's tab now …; `tab t3` goes back`. Later opens navigate the\n"
            "session's tab. A URL without a\n"
            "scheme gets https:// (http:// for localhost). Prints the title and URL, then the page it landed on as a\n"
            "navigating click reports it (interactive nodes with refs and the main text with refs inline), so no\n"
            "snapshot is needed; --no-changes prints only the title and URL.",
    "snapshot": "ardia browse snapshot [-i] [-c] [-d <n>] [-s <sel>] [-u] [--diff]\n\n"
                "Accessibility tree with refs (@e1, @e2...). -i interactive only, -c compact, -d depth, -s scope to a\n"
                "selector or @ref (every match that shows, so hidden matches like a closed cookie banner are skipped),\n"
                "-u include link URLs, --diff only what changed since this session's last snapshot\n"
                "of the document. Date and time inputs show as one textbox with their value. Names past 100\n"
                "characters end in … (find --name takes the clipped name as a prefix). In a long run of one role, -i\n"
                "lists the enabled members and counts the disabled ones in one line. Site notes, when there\n"
                "are any, come first. Refs belong to this snapshot's document: a navigation, a new document or an\n"
                "Ardia restart makes them stale. When the page redraws an element, its ref follows the new one only if\n"
                "it was the only one with its role and name, and still is, inside the same named dialog, row or form.",
    "click": "ardia browse click <sel> [--new-tab] [--button left|right|middle] [--humanize] [--no-changes] [--no-text]\n\n"
             "Clicks the element (with --humanize along a curved mouse path with human timing) and prints what\n"
             "changed: nodes added, changed or removed with their refs, URL and title, and non-GET requests it\n"
             "caused. A long run of one role (options, links, many buttons) is one line with its count, first and\n"
             "last name and refs, plus any selected one; a run with disabled members lists the enabled ones and\n"
             "counts the rest; nodes redrawn unchanged are one line with their new refs. After a navigation, or when\n"
             "the click opens something (a heading, dialog, article or region), `text:` lines give its readable\n"
             "text with refs inline (`[@e5]`), images as `[image \"…\": screenshot @eN]` and frames with their text;\n"
             "--no-text leaves them out.\n"
             "Fails with `covered by <...>` when another element sits on top of the target. A disabled target is\n"
             "waited for up to 1.5 s (it fails then if it's still disabled), so a dependent field can follow the\n"
             "one that enables it in the same batch.",
    "fill": "ardia browse fill <sel> <text> [--humanize] [--no-changes]\n\n"
            "Focuses the field, clears it (select all, Backspace), then puts the text in: a textarea, an editable\n"
            "element or a plain text/search/email/url/tel/number input gets it in one insert (input events, no key\n"
            "events); a combobox, a password or --humanize types per character. Date, time, datetime-local, month,\n"
            "week, color and range inputs get their value set instead (YYYY-MM-DD, HH:MM or 2:30 PM,\n"
            "YYYY-MM-DDTHH:MM, YYYY-MM, YYYY-Www, #rrggbb, a number), with input and change events; a bad value\n"
            "fails with the format. On a <select> it picks the option whose label or value is the text (else the\n"
            "only one containing it). On a combobox it waits briefly for suggestions and says how many show; typing\n"
            "never picks one (use select for that). A disabled field is waited for up to 1.5 s.\n\n"
            "Spreadsheet grids: on a cell ([role=gridcell], [role=cell] or td, or anything inside one) that isn't a\n"
            "field, it double-clicks the cell (Enter if that opens nothing), waits up to 1 s for the editor, sets it\n"
            "(picks on a <select>, datalist or combobox editor), presses Enter to commit and prints the cell's new\n"
            "value: ~ gridcell \"Reorder level, FAS-53565 Reno\": 250 (was 150). A cell that already holds a field is\n"
            "filled in place. When the grid keeps the editor open (a rejected value), it presses Escape and fails with\n"
            "the grid's message. Put every cell in one batch:\n"
            "  fill \"#c-2356-reorder\" 250\n"
            "  fill \"#c-n1-category\" Fasteners\n"
            "Prints what changed.",
    "select": "ardia browse select <sel> <value...> [--humanize] [--no-changes]\n\n"
              "On a <select>, picks the options by value or label. On a combobox (a typeahead or chip input, a\n"
              "button that opens a listbox, an input with a datalist) it does it per value: types the value (or\n"
              "opens the list), waits for the suggestions to settle, and clicks the one that matches: the exact\n"
              "text, else one whose line or email is the value, else the only one containing it. Two matches or\n"
              "none fail and list the suggestions, nothing picked. Several values fill a chip input in one call:\n"
              "  ardia browse select @e5 \"Priya Raman\" alex@example.com\n"
              "Prints what it picked and what changed. A disabled target is waited for up to 1.5 s.",
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
    "read": "ardia browse read [url...] [--links <pattern>] [-s <selector>] [--stdin] [--limit n] [--timeout ms] [--http] [--list]\n"
            "ardia browse read -s <list> --scroll [--limit rows] [--match <text>] [--timeout ms]\n\n"
            "Reads each page in a background tab of this session's own (four at a time, through your logins, after its\n"
            "scripts ran) and prints its title, URL and text: the page's <main>, else its body, or what -s matches.\n"
            "Tables and ARIA grids print one row per line, cells split by ` | `, with a note when a grid renders only\n"
            "some of its rows. Tabs close when it's done. With no URL it reads the session's tab. --links <pattern> reads every link on the session's tab whose URL contains the\n"
            "pattern (* matches anything), in page order; --list only prints those links. URLs can also come one per line\n"
            "on stdin (--stdin or -), and /paths resolve against the session's tab. At most 20 pages unless --limit (100).\n"
            "Pages share an output cap of 3,000 characters a page (6,000 to 24,000); narrow it with -s or a tighter --links (--json has all).\n"
            "--scroll reads a long or virtualized list on the session's tab (-s takes a selector or a ref): it scrolls the\n"
            "list's own scroll box until it stops growing and prints each row once, one per line, in list order, then puts\n"
            "the scroll back. --match keeps rows containing the text (any case); --limit stops after that many rows (1,000;\n"
            "10,000 with --match); --timeout is the whole scroll's (30 s). Big output: redirect it to a file and grep it.\n"
            "--http fetches outside the browser instead (no logins, no page scripts; faster on public docs), and so do\n"
            "--llms index|full, --require-md, --raw, --outline and --filter, which also work on the session's tab's URL.\n"
            "Exit 1 when any page failed (its block says why).",
    "script": "ardia browse script [file.js] [--timeout 90s]   (or the script on stdin)\n\n"
              "Runs a short JavaScript program that drives pages, so a loop over many pages is one call. It runs in a\n"
              "blank background page of its own, outside the page it drives (no document or window: DOM code goes in\n"
              "page.evaluate), and every page action is one of ardia browse's commands on this session (the same tab,\n"
              "refs, rules and change reports), so nothing a command refuses works here either.\n\n"
              "  page.goto(url)  back()  reload()        page.click(sel)  dblclick(sel)  fill(sel, text)  type(sel, text)\n"
              "  page.focus(sel)  press(key)  keyboard(text)   page.select(sel, value)  check(sel)  uncheck(sel)  hover(sel)\n"
              "  page.scroll(dir, px)  page.text(sel?)  value(sel)  attr(sel, name)  count(sel)  visible(sel)  url()  title()\n"
              "  page.snapshot('-i -s main')  page.links(pattern?)  page.wait(sel | ms | {text, url, load, fn})\n"
              "  page.evaluate(fn, arg) or page.eval(fn, arg)   (fn runs in the page's main world, like eval; pass\n"
              "    the script's values as arg, since fn can't see them)\n"
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
    "drag": "ardia browse drag <src> <dst> [--before|--after] [--humanize] [--no-changes]\n\n"
            "Drags the source onto the target with the mouse (an HTML5 draggable goes through drag interception). It\n"
            "drops on the target's far half, 75% of its height when moving down and 25% moving up (its width in a row),\n"
            "so in a sortable list the source takes the target's place; --before or --after picks the side. When the\n"
            "source sits in a list, the answer names its new place (moved to 5 of 5 (was 4)) or says the order didn't\n"
            "change, and prints what changed (the save request included), so there's no need to read the list again.",
    "dblclick": "ardia browse dblclick <sel> [--humanize] [--no-changes]\n\nDouble-clicks the element and prints what changed. To edit a grid cell, `fill <cell> <value>` does it in one line.",
    "hover": "ardia browse hover <sel> [--humanize] [--no-changes]\n\nMoves the mouse onto the element and prints what changed (menus and tooltips it opened).",
    "focus": "ardia browse focus <sel>\n\nFocuses the element (DOM.focus, no click) and prints what changed. Then `keyboard type <text>` types there.",
    "check": "ardia browse check <sel> | uncheck <sel> [--humanize] [--no-changes]\n\n"
             "Clicks a checkbox, radio or switch (its label when the box itself is hidden) only when it isn't already in\n"
             "that state, and fails when the click didn't change it. A disabled one is waited for up to 1.5 s.",
    "uncheck": "ardia browse uncheck <sel> [--humanize] [--no-changes]\n\nLike check: unchecks it when it's checked.",
    "back": "ardia browse back | forward\n\nGoes one step through the tab's history, waits for the page, and prints its URL.",
    "forward": "ardia browse forward | back\n\nGoes one step through the tab's history, waits for the page, and prints its URL.",
    "reload": "ardia browse reload\n\nReloads the session's tab, waits for load, and prints its URL. Refs from before go stale.",
    "is": "ardia browse is visible|enabled|checked <sel>\n\nPrints true or false.",
    "scrollintoview": "ardia browse scrollintoview <sel> [--humanize]\n\nScrolls the element into view (with --humanize, wheel steps).",
    "frame": "ardia browse frame <sel|@ref|name|url> | frame main\n\n"
             "Makes later commands act inside that iframe (same-process ones only) until `frame main`.",
    "window": "ardia browse window new [url]\n\nOpens a new Ardia window with one tab of this session's.",
    "storage": "ardia browse storage local|session [get [key] | set <key> <value> | remove <key> | clear]\n\n"
               "Reads or changes the page's localStorage or sessionStorage (of the selected frame). get without a key\n"
               "prints every key: value line.",
    "mouse": "ardia browse mouse move <x> <y> | down [left|right|middle] | up [button] | wheel <dy> [dx] [--humanize]\n\n"
             "Raw mouse input at viewport coordinates; a held button stays down until `mouse up`.",
    "keydown": "ardia browse keydown <key> | keyup <key>\n\nHolds a key down until keyup (keys and modifiers as press).",
    "keyup": "ardia browse keyup <key>\n\nReleases a key held with keydown.",
    "upload": "ardia browse upload <sel> <files...>\n\nSets the files of a file input (gated: DOM.setFileInputFiles).",
    "download": "ardia browse download <sel> <path>\n\nClicks the element and saves the download it starts to path (gated).",
    "cookies": "ardia browse cookies [get] | set <name> <value> [--url u] [--domain d] [--path p] [--httpOnly] [--secure]\n"
               "  [--sameSite Strict|Lax|None] [--expires epoch] | set --curl <file> | clear\n\n"
               "Gated by Ardia's policy; works against a plain --port test server.",
    "set": "ardia browse set viewport <w> <h> [scale] | viewport reset | device <name> | geo <lat> <lng> | offline [on|off] | headers <json>\n"
           "  | credentials <user> <pass> | media [dark|light|no-preference] [reduced-motion]\n\nset viewport sizes the page of a tab this session opened and never showed, for responsive checks. Ardia first takes\n"
           "the tab off-screen (it leaves the sidebar), so an emulated page is never on screen; screenshots, snapshots and\n"
           "clicks work there at that size. To see the page, `tab <id> --show` (or `set viewport reset`, in the background):\n"
           "the viewport ends and the page is reloaded in a new tab of its own size. The other settings are gated by Ardia's\n"
           "policy; they work against a plain --port test server.",
    "state": "ardia browse state save|load <path>\n\nSaves or loads cookies and storage (gated).",
    "dialog": "ardia browse dialog status | accept [text] | dismiss\n\nAnswers the page's open alert, confirm or prompt.",
    "diff": "ardia browse diff snapshot [-b baseline] [-s sel] [-i] [-c] [-d n] | screenshot --baseline <png> | url <u1> <u2>\n\n"
            "snapshot compares with a file, else with this session's last snapshot.",
    "clipboard": "ardia browse clipboard read | write <text> | copy | paste\n\nGated by Ardia's policy.",
    "addinitscript": "ardia browse addinitscript <js> [--stdin]\n\nRegisters a script that runs in the page's main world before its own scripts, and prints its id.",
}


def command_help(name: str | None) -> str:
    if not name:
        return OVERVIEW
    if name in COMMANDS:
        return COMMANDS[name]
    word = re.compile(rf"(?:^|[\s:,|]){re.escape(name)}(?=$|[\s,|<\[])")
    for line in OVERVIEW.splitlines():
        if line.startswith(" ") or ":" in line[:13]:
            if word.search(line):
                return f"ardia browse {' '.join(re.sub(r'^[A-Z][A-Za-z ]*:', '', line.strip()).split())}\nflags: none"
    return OVERVIEW

