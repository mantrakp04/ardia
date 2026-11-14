import json
import sys

from ardia_cli import control
from ardia_cli.control import MethodError, Unreachable
from ardia_cli.endpoint import DATA_DIR_HELP
from ardia_cli.printable import complain, say, shown

APPLY_TIMEOUT = 120.0
TINTS = ("grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange")
COLORS = ("neutral", "none", *TINTS)
COLOR_HELP = f"{', '.join(TINTS)}; neutral (the default: a box only under the pointer) or none (no box)"
ICON_HELP = "an emoji from Ardia's icon picker (🚀), symbol:<SF Symbol name> (symbol:star), or none"
EXIT_STATUS = """\
Exit status: 0 done, 1 refused, a bad request or a target that isn't there (nothing after the failing operation
ran), 2 Ardia can't be reached (or the connection dropped after the request went out, so it may or may not have run).
"""
TABS_DESCRIPTION = f"""\
List and organize Ardia's tabs: the same actions as the sidebar, through the app's own store, so pins, groups and
sync behave exactly as when you do it by hand. Nothing here changes which tab a window shows unless you ask
(tabs open --activate, tabs activate) or close the tab it shows. Private windows are never reachable.

Without a command, it lists every window's tabs per profile: Top Apps, the pinned section (pinned tabs and pinned
groups), then the rest, with groups nested as in the sidebar. --json prints the tree with stable ids (see
docs/automation.md); --flat prints one tab per line.

--usage adds each tab's renderer process: its pid, CPU (percent of one core, as Chrome's Task Manager shows it) and
memory, hottest first, so a process from `top -o power` or Activity Monitor can be named. --pid N prints the tabs
running in process N. With --json each tab gets "pid", "cpu" and "memory" (bytes); null for a sleeping tab, which has
no process. Tabs that share a process show that process's numbers. The first --usage in a while takes about 2 s,
since CPU is measured over time.

Ids: tab-… for tabs, g-… for groups, w-… for windows (ardia tabs shows them). --group takes a group's id or its
name (case-insensitive, in that window; an exact id wins, and a name two groups share is refused with their ids).
--before and --after take a tab or a group id.

{EXIT_STATUS}
Examples:
  ardia tabs --json
  ardia tabs --usage
  ardia tabs --pid 61234
  ardia tabs open https://example.com news.ycombinator.com --group Work
  ardia tabs move tab-1 tab-2 --group Work
  ardia tabs move tab-3 --top
  ardia tabs pin tab-4 --row
  ardia tabs sleep tab-5 tab-6
"""
GROUPS_DESCRIPTION = f"""\
List and organize tab groups: create (around tabs you name, URLs you open, or one new tab), rename, set the icon,
colour and collapsed state, nest, reorder, pin, move to another window or profile, ungroup, close or delete. New
groups are pinned, as with New Group with Tab in the sidebar, unless --unpinned or --parent says otherwise. A group
made from tabs of another group, with no --parent, --before or --after, goes just above that group, so groups made
one after another from it keep their order and what's left of it stays below. A group argument takes an id or a
name, looked up case-insensitively in the last focused window (--parent: in the window the group goes to); an exact
id wins, and a name two groups share is refused with their ids.

{EXIT_STATUS}
Examples:
  ardia groups create tab-1 tab-2 --name Work --icon 🚀 --color blue
  ardia groups create --parent Work --url https://a.example --url https://b.example --name Reading
  ardia groups update Work --collapse --icon symbol:briefcase
  ardia groups move Reading --parent Projects
  ardia groups ungroup Imported
"""
APPLY_DESCRIPTION = f"""\
Apply several tab and group operations in one call, in order, without touching the tab each window shows. Reads
JSON from FILE, or stdin with - or no FILE: a list of operations, or {{"ops": [...]}}. Every operation is checked
before the first one runs; a target that is gone or private stops the batch at that operation, and the reply says
which ones ran. An id may be $N: what operation N made (its group, else its tabs).

Operations (fields in docs/automation.md): open, tab.move, tab.pin, tab.unpin, tab.activate, tab.mute,
tab.unmute, tab.sleep, tab.wake, tab.close, tab.rename, tab.icon, group.create, group.update, group.move,
group.ungroup, group.close, group.delete.

{EXIT_STATUS}
Example:
  ardia apply <<'EOF'
  [{{"op": "group.create", "urls": ["https://a.example", "https://b.example"], "name": "Research", "pinned": false}},
   {{"op": "group.create", "parent": "$0", "tabs": ["tab-7"], "name": "Papers", "icon": "📚"}},
   {{"op": "group.update", "group": "$1", "collapsed": true}}]
  EOF
"""


def add_parsers(commands, formatter):
    def common(parser, json_help="print the reply as JSON"):
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        parser.add_argument("--json", action="store_true", help=json_help)
        return parser

    def placement(parser, what):
        spot = parser.add_mutually_exclusive_group()
        spot.add_argument("--before", metavar="ID", help=f"put the {what} just before this tab or group")
        spot.add_argument("--after", metavar="ID", help=f"put the {what} just after this tab or group")

    def ids(parser, help_text="tab ids"):
        parser.add_argument("ids", nargs="+", metavar="ID", help=help_text)
        return parser

    tabs = common(commands.add_parser("tabs", help="list and organize tabs", description=TABS_DESCRIPTION, formatter_class=formatter), "print JSON")
    tabs.add_argument("--window", metavar="ID", help="only this window")
    tabs.add_argument("--profile", metavar="ID", help="only this profile")
    tabs.add_argument("--flat", action="store_true", help="one tab per line (with --json, a flat list)")
    tabs.add_argument("--usage", action="store_true", help="each tab's process id, CPU and memory, hottest first")
    tabs.add_argument("--pid", type=int, metavar="N", help="only the tabs running in process N (implies --usage)")
    verbs = tabs.add_subparsers(dest="tabs_command", metavar="<command>")

    opening = common(verbs.add_parser("open", help="open URLs in the background", description="Open one or more URLs as new tabs, in the background, in the last focused window (or --window, or a window\nshowing --profile), at the top level or in --group, where new tabs go or --before/--after a tab or group.\nOnly http, https and file URLs, about:blank and ardia://history, bookmarks, downloads and newtab open.", formatter_class=formatter))
    opening.add_argument("urls", nargs="+", metavar="URL", help="URLs (example.com works)")
    opening.add_argument("--window", metavar="ID", help="a window id")
    opening.add_argument("--profile", metavar="ID", help="a profile id: the tabs belong to it")
    opening.add_argument("--group", metavar="GROUP", help="open them inside this group (id or name)")
    opening.add_argument("--pin", choices=("tile", "row"), help="pin them as Top Apps tiles or pinned rows")
    opening.add_argument("--activate", action="store_true", help="show the first one (never focuses the window)")
    placement(opening, "tabs")

    move = common(ids(verbs.add_parser("move", help="move tabs: into a group, out of one, next to another tab, to a window or profile", description="Move tabs without reloading them. --group puts them in a group (in its window and profile), --top takes\nthem out of every group, --before/--after puts them next to a tab or group (in that tab's group and section),\n--window and --profile move them to another window or profile. The tabs keep the order given.", formatter_class=formatter)))
    target = move.add_mutually_exclusive_group()
    target.add_argument("--group", metavar="GROUP", help="into this group (id or name)")
    target.add_argument("--top", action="store_true", help="out of every group, to the top level")
    move.add_argument("--window", metavar="ID", help="to this window")
    move.add_argument("--profile", metavar="ID", help="to this profile")
    placement(move, "tabs")

    pin = common(ids(verbs.add_parser("pin", help="pin tabs", description="Pin tabs as Top Apps tiles (the default for unpinned tabs) or as pinned rows (--row).")))
    pin.add_argument("--row", action="store_true", help="as pinned rows above the tabs")
    pin.add_argument("--tile", action="store_true", help="as Top Apps tiles")
    for name, text in (
        ("unpin", "unpin tabs (a tab of a pinned group leaves it)"),
        ("mute", "mute tabs"),
        ("unmute", "unmute tabs (and their site, if it was muted)"),
        ("sleep", "put tabs to sleep: pinned ones unload, others are discarded; never the tab a window shows"),
        ("wake", "load sleeping tabs again, in the background"),
        ("close", "close tabs (a pinned tab unloads, as with its close button)"),
    ):
        common(ids(verbs.add_parser(name, help=text, description=text[0].upper() + text[1:] + ".")))
    common(verbs.add_parser("activate", help="show a tab in its window (doesn't focus the window)", description="Show a tab in its window, as clicking it would, without focusing the window.")).add_argument("id", metavar="ID", help="a tab id")
    rename = common(verbs.add_parser("rename", help="give a tab its own name (no NAME resets it)", description="Give a tab its own name, as Rename… does; without NAME, the tab gets the page's title back."))
    rename.add_argument("id", metavar="ID", help="a tab id")
    rename.add_argument("name", nargs="?", metavar="NAME", help="the name")
    icon = common(verbs.add_parser("icon", help="set a tab's icon (no ICON resets it)", description="Set a tab's icon, as Change Icon… does; without ICON, the site's icon comes back."))
    icon.add_argument("id", metavar="ID", help="a tab id")
    icon.add_argument("icon", nargs="?", metavar="ICON", help="an emoji from Ardia's icon picker or symbol:<SF Symbol name>")

    groups = common(commands.add_parser("groups", help="list and organize tab groups", description=GROUPS_DESCRIPTION, formatter_class=formatter), "print JSON")
    groups.add_argument("--window", metavar="ID", help="only this window")
    groups.add_argument("--profile", metavar="ID", help="only this profile")
    gverbs = groups.add_subparsers(dest="groups_command", metavar="<command>")

    def looks(parser):
        parser.add_argument("--icon", metavar="ICON", help=ICON_HELP)
        parser.add_argument("--color", choices=COLORS, metavar="COLOR", help=COLOR_HELP)

    create = common(gverbs.add_parser("create", help="make a group", description="Make a group from the tabs given, the URLs given (opened in the background), or else one new tab.\nThe tabs move out of the groups they were in, without reloading.", formatter_class=formatter))
    create.add_argument("ids", nargs="*", metavar="TAB", help="tab ids to put in it")
    create.add_argument("--url", action="append", default=[], metavar="URL", help="open this URL in it; repeat for several")
    create.add_argument("--name", metavar="NAME", help="its name (default: one made from its tabs)")
    looks(create)
    create.add_argument("--collapsed", action="store_true", help="collapsed")
    create.add_argument("--parent", metavar="GROUP", help="nest it inside this group (id or name)")
    create.add_argument("--unpinned", action="store_true", help="below the pinned section instead of in it")
    create.add_argument("--window", metavar="ID", help="in this window (default: the tabs', else the last focused)")
    create.add_argument("--profile", metavar="ID", help="in this profile")
    placement(create, "group")

    update = common(gverbs.add_parser("update", help="rename, set icon, colour, collapse or expand a group", description="Change a group's name, icon, colour or collapsed state."))
    update.add_argument("id", metavar="GROUP", help="a group id or name")
    update.add_argument("--name", metavar="NAME", help="its name (\"\" for one made from its tabs)")
    looks(update)
    update.add_argument("--reset-icon", action="store_true", help="the default icon")
    fold = update.add_mutually_exclusive_group()
    fold.add_argument("--collapse", action="store_true", help="collapse it")
    fold.add_argument("--expand", action="store_true", help="expand it")

    rename_group = common(gverbs.add_parser("rename", help="rename a group", description="Rename a group (\"\" for a name made from its tabs)."))
    rename_group.add_argument("id", metavar="GROUP", help="a group id or name")
    rename_group.add_argument("name", metavar="NAME", help="the name")

    gmove = common(gverbs.add_parser("move", help="nest, reorder, pin or move a group to another window or profile", description="Move a group: --parent nests it, --top takes it out of its parent, --before/--after puts it next to a\ntab or group, --pin/--unpin moves it in or out of the pinned section, --window and --profile move it there\n(pinned groups are in every window of their profile, so they don't move between windows).", formatter_class=formatter))
    gmove.add_argument("id", metavar="GROUP", help="a group id or name")
    nest = gmove.add_mutually_exclusive_group()
    nest.add_argument("--parent", metavar="GROUP", help="inside this group (id or name)")
    nest.add_argument("--top", action="store_true", help="out of its parent group")
    pinning = gmove.add_mutually_exclusive_group()
    pinning.add_argument("--pin", action="store_true", help="into the pinned section")
    pinning.add_argument("--unpin", action="store_true", help="out of the pinned section")
    gmove.add_argument("--window", metavar="ID", help="to this window")
    gmove.add_argument("--profile", metavar="ID", help="to this profile")
    placement(gmove, "group")

    for name, text in (
        ("ungroup", "ungroup: the tabs stay, the group goes"),
        ("close", "close a group and its tabs (History › Recently Closed Groups brings it back)"),
        ("delete", "delete a group and its tabs"),
    ):
        common(gverbs.add_parser(name, help=text, description=text[0].upper() + text[1:] + ".")).add_argument("id", metavar="GROUP", help="a group id or name")

    batch = common(commands.add_parser("apply", help="apply several tab and group operations at once (JSON)", description=APPLY_DESCRIPTION, formatter_class=formatter))
    batch.add_argument("file", nargs="?", metavar="FILE", help="a JSON file (default: stdin)")


def placed(args, op: dict) -> dict:
    for key in ("before", "after", "window", "profile"):
        value = getattr(args, key, None)
        if value is not None:
            op[key] = value
    return op


def tab_op(args) -> dict:
    verb = args.tabs_command
    if verb == "open":
        op = placed(args, {"op": "open", "urls": args.urls})
        if args.group:
            op["group"] = args.group
        if args.pin:
            op["pin"] = args.pin
        if args.activate:
            op["activate"] = True
        return op
    if verb == "move":
        op = placed(args, {"op": "tab.move", "tabs": args.ids})
        if args.group:
            op["group"] = args.group
        elif args.top:
            op["group"] = None
        return op
    if verb == "pin":
        if args.row and args.tile:
            raise ValueError("give --row or --tile, not both")
        op = {"op": "tab.pin", "tabs": args.ids}
        if args.row or args.tile:
            op["as"] = "row" if args.row else "tile"
        return op
    if verb == "activate":
        return {"op": "tab.activate", "tab": args.id}
    if verb == "rename":
        return {"op": "tab.rename", "tab": args.id, "title": args.name}
    if verb == "icon":
        return {"op": "tab.icon", "tab": args.id, "icon": args.icon}
    return {"op": f"tab.{verb}", "tabs": args.ids}


def group_op(args) -> dict:
    verb = args.groups_command
    if verb == "create":
        op = placed(args, {"op": "group.create"})
        for key, value in (("tabs", args.ids or None), ("urls", args.url or None), ("name", args.name), ("icon", args.icon), ("color", args.color), ("parent", args.parent)):
            if value is not None:
                op[key] = value
        if args.collapsed:
            op["collapsed"] = True
        if args.unpinned:
            op["pinned"] = False
        return op
    if verb == "update":
        op = {"op": "group.update", "group": args.id}
        if args.icon is not None and args.reset_icon:
            raise ValueError("give --icon or --reset-icon, not both")
        for key, value in (("name", args.name), ("icon", args.icon), ("color", args.color)):
            if value is not None:
                op[key] = value
        if args.reset_icon:
            op["icon"] = None
        if args.collapse or args.expand:
            op["collapsed"] = bool(args.collapse)
        if len(op) == 2:
            raise ValueError("give --name, --icon, --reset-icon, --color, --collapse or --expand")
        return op
    if verb == "rename":
        return {"op": "group.update", "group": args.id, "name": args.name}
    if verb == "move":
        op = placed(args, {"op": "group.move", "group": args.id})
        if args.parent:
            op["parent"] = args.parent
        elif args.top:
            op["parent"] = None
        if args.pin or args.unpin:
            op["pinned"] = bool(args.pin)
        if len(op) == 2:
            raise ValueError("give --parent, --top, --pin, --unpin, --before, --after, --window or --profile")
        return op
    return {"op": f"group.{verb}", "group": args.id}


def note_error(code) -> None:
    from ardia_cli import telemetry

    telemetry.note_error_code(code)


def method_failed(command: str, error: MethodError) -> int:
    note_error(error.code)
    if error.code == "unknown_method":
        complain(f"ardia {command}: this Ardia doesn't know {command} yet; update Ardia")
    else:
        complain(f"ardia {command}: {error.message}")
    return 1


def apply_ops(args, command: str, ops: list) -> int:
    from ardia_cli import telemetry

    telemetry.note_count("batch_steps", len(ops))
    try:
        reply = control.call(args.data_dir, "apply", {"ops": ops}, APPLY_TIMEOUT)
    except Unreachable as error:
        if error.sent:
            complain(f"ardia {command}: the connection dropped after the request went out, so it may or may not have run ({error})")
        else:
            complain(f"ardia: {error}")
        return 2
    except MethodError as error:
        return method_failed(command, error)
    reply = reply if isinstance(reply, dict) else {}
    if args.json:
        say(json.dumps(reply, indent=2, ensure_ascii=False))
    else:
        titles = {tab.get("id"): tab.get("title") for tab in reply.get("tabs") or [] if isinstance(tab, dict)}
        for result in reply.get("results") or []:
            say(describe_result(result, titles))
    error = reply.get("error")
    if not reply.get("ok"):
        note_error(error.get("code") if isinstance(error, dict) else "failed")
        message = error.get("message") if isinstance(error, dict) else "it failed"
        ran = reply.get("applied", 0)
        tail = f" ({ran} of {len(ops)} operations ran)" if len(ops) > 1 else ""
        complain(f"ardia {command}: {message}{tail}")
        return 1
    return 0


VERBS = {
    "open": "opened", "tab.move": "moved", "tab.pin": "pinned", "tab.unpin": "unpinned", "tab.activate": "showing",
    "tab.mute": "muted", "tab.unmute": "unmuted", "tab.close": "closed", "tab.rename": "renamed", "tab.icon": "set the icon of",
}


GROUP_VERBS = {"group.update": "updated", "group.move": "moved", "group.ungroup": "ungrouped", "group.close": "closed", "group.delete": "deleted"}


def group_name(result: dict) -> str:
    group = shown(result.get("group"))
    icon = result.get("icon")
    label = result.get("label")
    shown_icon = f"{shown(icon)} " if isinstance(icon, str) and icon != "none" and not icon.startswith("symbol:") else ""
    return f"{shown_icon}{shown(label)} ({group})" if label else group


def tab_name(tab_id, titles: dict) -> str:
    title = titles.get(tab_id)
    return f"{shown(title)} ({shown(tab_id)})" if title else shown(tab_id)


def describe_result(result: dict, titles: dict | None = None) -> str:
    titles = titles or {}
    op = str(result.get("op"))
    tabs = [tab_name(tab, titles) for tab in result.get("tabs") or []]
    outcomes = result.get("outcomes")
    if isinstance(outcomes, dict):
        return "  ".join(f"{tab_name(tab, titles)}: {shown(outcome)}" for tab, outcome in outcomes.items())
    if op == "group.create":
        return f"created group {group_name(result)} with {len(tabs)} tab{'s' if len(tabs) != 1 else ''}"
    if op == "group.ungroup":
        return f"ungrouped {group_name(result)}"
    if op.startswith("group."):
        return f"{GROUP_VERBS.get(op, shown(op))} group {group_name(result)}"
    return f"{VERBS.get(op, shown(op))} {', '.join(tabs)}".rstrip()


def cmd_tabs(args) -> int:
    if args.tabs_command:
        try:
            op = tab_op(args)
        except ValueError as error:
            complain(f"ardia tabs {args.tabs_command}: {error}")
            return 1
        return apply_ops(args, f"tabs {args.tabs_command}", [op])
    tree = read_workspace(args, "tabs")
    if isinstance(tree, int):
        return tree
    if args.pid is not None:
        return print_process_tabs(args, flat_tabs(tree))
    if args.json:
        say(json.dumps(flat_tabs(tree) if args.flat else tree, indent=2, ensure_ascii=False))
    elif args.usage:
        print_usage(by_heat(flat_tabs(tree)))
    elif args.flat:
        for tab in flat_tabs(tree):
            say(tab_line(tab, f"{shown(tab['window'])}  {shown(tab['profile'])}  "))
    else:
        print_tree(tree)
    return 0


def cmd_groups(args) -> int:
    if args.groups_command:
        try:
            op = group_op(args)
        except ValueError as error:
            complain(f"ardia groups {args.groups_command}: {error}")
            return 1
        return apply_ops(args, f"groups {args.groups_command}", [op])
    tree = read_workspace(args, "groups")
    if isinstance(tree, int):
        return tree
    groups = flat_groups(tree)
    if args.json:
        say(json.dumps(groups, indent=2, ensure_ascii=False))
        return 0
    for group in groups:
        say(group_line(group))
    return 0


def cmd_apply(args) -> int:
    try:
        text = sys.stdin.read() if args.file in (None, "-") else open(args.file, encoding="utf-8").read()
        doc = json.loads(text)
    except OSError as error:
        complain(f"ardia apply: {args.file}: {error.strerror or error}")
        return 1
    except ValueError as error:
        complain(f"ardia apply: that isn't JSON ({error})")
        return 1
    ops = doc.get("ops") if isinstance(doc, dict) else doc
    if not isinstance(ops, list) or not ops:
        complain('ardia apply: give a list of operations, or {"ops": [...]}')
        return 1
    return apply_ops(args, "apply", ops)


def read_workspace(args, command: str):
    params = {key: getattr(args, key) for key in ("window", "profile") if getattr(args, key, None)}
    usage = bool(getattr(args, "usage", False) or getattr(args, "pid", None) is not None)
    if usage:
        params["usage"] = True
    try:
        return control.call(args.data_dir, "workspace", params)
    except Unreachable as error:
        complain(f"ardia: {error}")
        return 2
    except MethodError as error:
        if usage and error.code == "bad_request" and "not usage" in error.message:
            note_error("unknown_method")
            complain(f"ardia {command}: this Ardia doesn't know --usage and --pid yet; update Ardia")
            return 1
        return method_failed(command, error)


def by_heat(tabs: list) -> list:
    def heat(tab: dict):
        cpu, memory = tab.get("cpu"), tab.get("memory")
        return (cpu is None and memory is None, -(cpu or 0), -(memory or 0))

    return sorted(tabs, key=heat)


def megabytes(memory) -> str:
    return f"{memory / 1_000_000:.0f} MB" if isinstance(memory, (int, float)) and not isinstance(memory, bool) else "-"


def usage_line(tab: dict) -> str:
    pid, cpu = tab.get("pid"), tab.get("cpu")
    shown_cpu = f"{cpu:.1f}" if isinstance(cpu, (int, float)) and not isinstance(cpu, bool) else "-"
    return f"{pid if isinstance(pid, int) else '-':>7}  {shown_cpu:>6}  {megabytes(tab.get('memory')):>8}  {tab_line(tab)}"


def print_usage(tabs: list) -> None:
    say(f"{'PID':>7}  {'CPU%':>6}  {'MEMORY':>8}    TAB")
    for tab in tabs:
        say(usage_line(tab))
    if tabs and not any(isinstance(tab.get("pid"), int) for tab in tabs) and any(tab.get("memory") is not None for tab in tabs):
        say("(this Ardia doesn't report process ids yet, only CPU and memory; update Ardia for the PID column)")


def print_process_tabs(args, tabs: list) -> int:
    if not any(isinstance(tab.get("pid"), int) for tab in tabs):
        note_error("no_pid")
        complain("ardia tabs: this Ardia doesn't report tab process ids yet; update Ardia (ardia tabs --usage still shows CPU and memory)")
        return 1
    found = by_heat([tab for tab in tabs if tab.get("pid") == args.pid])
    if not found:
        note_error("no_tab")
        complain(f"ardia tabs: no tab runs in process {args.pid}; it may be Ardia itself, its GPU or a utility process, an extension, or a frame of another site (ardia tabs --usage lists every tab's process)")
        return 1
    if args.json:
        say(json.dumps(found, indent=2, ensure_ascii=False))
    else:
        print_usage(found)
    return 0


def walk(items, depth=0, group=None):
    for item in items or []:
        if not isinstance(item, dict):
            continue
        yield item, depth, group
        if item.get("type") in ("group", "folder"):
            yield from walk(item.get("items"), depth + 1, item.get("id") if item.get("type") == "group" else group)


def sections(space: dict):
    return (("Top Apps", space.get("topApps")), ("Pinned", space.get("pinned")), ("Tabs", space.get("tabs")))


def flat_tabs(tree: dict) -> list:
    out = []
    for window in tree.get("windows") or []:
        for space in window.get("spaces") or []:
            for section, items in sections(space):
                for item, _, _ in walk(items):
                    if item.get("type") == "tab":
                        out.append({**item, "window": window.get("id"), "profile": space.get("profile"), "section": section})
    return out


def flat_groups(tree: dict) -> list:
    out = []
    for window in tree.get("windows") or []:
        for space in window.get("spaces") or []:
            for _, items in sections(space):
                for item, depth, _ in walk(items):
                    if item.get("type") == "group":
                        tabs = [t.get("id") for t, _, _ in walk(item.get("items")) if t.get("type") == "tab"]
                        fields = {k: v for k, v in item.items() if k != "items"}
                        out.append({**fields, "window": window.get("id"), "profile": space.get("profile"), "depth": depth, "tabs": tabs})
    return out


def tab_line(tab: dict, prefix: str = "") -> str:
    marks = [m for m, on in (("muted", tab.get("muted")), ("asleep", tab.get("asleep")), (f"pinned {tab.get('pin')}", tab.get("pin"))) if on]
    title = shown(tab.get("title"))
    tail = f"  ({shown(', '.join(marks))})" if marks else ""
    return f"{'*' if tab.get('active') else ' '} {prefix}{shown(tab.get('id'))}  {title}  {shown(tab.get('url'))}{tail}".rstrip()


def group_line(group: dict, indent: str = "") -> str:
    looks = [shown(v) for v in (group.get("icon"), group.get("color")) if v and v != "neutral"]
    marks = [m for m, on in (("collapsed", group.get("collapsed")), ("pinned", group.get("pinned"))) if on]
    parts = [f"group {shown(group.get('id'))}", shown(json.dumps(group.get("label") or "", ensure_ascii=False))]
    if looks or marks:
        parts.append(" ".join(looks + marks))
    if "window" in group:
        parts += [f"window {shown(group['window'])}", f"profile {shown(group['profile'])}"]
        if group.get("parent"):
            parts.append(f"in {shown(group['parent'])}")
    if "tabs" in group:
        parts.append(f"{len(group['tabs'])} tabs")
    return indent + "  ".join(parts)


def print_tree(tree: dict) -> None:
    for window in tree.get("windows") or []:
        flags = [str(window.get("kind", "normal"))] + (["focused"] if window.get("focused") else [])
        say(f"window {shown(window.get('id'))}  {shown(', '.join(flags))}")
        for space in window.get("spaces") or []:
            say(f"  {shown(space.get('profileName') or space.get('profile'))} ({shown(space.get('profile'))}){'  shown' if space.get('shown') else ''}")
            for section, items in sections(space):
                if not items:
                    continue
                say(f"    {section}")
                for item, depth, _ in walk(items):
                    indent = "      " + "    " * depth
                    kind = item.get("type")
                    if kind == "tab":
                        say(indent + tab_line(item))
                    elif kind == "folder":
                        say(f"{indent}  folder {shown(item.get('id'))}  {shown(json.dumps(item.get('name') or '', ensure_ascii=False))}")
                    else:
                        say(group_line(item, indent + "  "))


def run(args, parser) -> int:
    handler = {"tabs": cmd_tabs, "groups": cmd_groups, "apply": cmd_apply}[args.command]
    try:
        return handler(args)
    except KeyboardInterrupt:
        complain(f"ardia {args.command}: interrupted")
        return 130
