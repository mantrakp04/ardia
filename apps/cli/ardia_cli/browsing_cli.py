import json

from ardia_cli import browsing
from ardia_cli.endpoint import DATA_DIR_HELP, data_root
from ardia_cli.printable import complain, say, shown

READS = """\
Reads <data dir>/session.json and Chromium's History files, never cookies, passwords, Login Data or Web Data.
Needs Ardia running with "Let the ardia command control Ardia" on. Incognito, guest and system profiles are skipped.

Exit status: 0 done, 1 the data couldn't be read or ran out of time (20 s), 2 Ardia can't be reached.
"""
PINNED_DESCRIPTION = f"""\
List the user's favorites (the tiles) and pinned tabs (tabs in pinned folders), in profile order. Each row has
title, url, pinned_url, kind (favorite or pinned), folder, profile and parked (a profile no window shows).

{READS}"""
HISTORY_DESCRIPTION = f"""\
List recent history per URL, newest first: url, title, visits (in the window), total_visits, last_visit (ISO 8601,
local time) and profile. Only http(s) pages; subframe navigations and hidden URLs are left out. --domains rolls it
up per domain (domain, visits, pages, last_visit, top_title, profile), most visited first.

{READS}
Examples:
  ardia history
  ardia history --days 7 --domains --limit 20
  ardia history --profile Work --json
"""


def add_parsers(commands, formatter):
    pinned = commands.add_parser("pinned", help="list favorites and pinned tabs", description=PINNED_DESCRIPTION, formatter_class=formatter)
    pinned.add_argument("--json", action="store_true", help="print JSON")
    pinned.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)

    history = commands.add_parser("history", help="list recent history", description=HISTORY_DESCRIPTION, formatter_class=formatter)
    history.add_argument("--days", type=float, default=1, metavar="N", help="how far back to look (default 1)")
    history.add_argument("--limit", type=int, default=200, metavar="N", help="at most this many rows (default 200, 0 for all)")
    history.add_argument("--profile", metavar="P", help="a profile name or its folder under Chromium/ (default: all)")
    history.add_argument("--domains", action="store_true", help="one row per domain instead of per URL")
    history.add_argument("--json", action="store_true", help="print JSON")
    history.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)


def run(args) -> int:
    root = data_root(args.data_dir)
    try:
        if args.command == "pinned":
            rows = browsing.pinned(root)
        else:
            if args.days <= 0:
                complain("ardia history: --days must be more than 0")
                return 1
            if args.limit < 0:
                complain("ardia history: --limit can't be negative")
                return 1
            rows = browsing.history(root, days=args.days, limit=args.limit or None, profile=args.profile, domains=args.domains)
    except browsing.NotRunning as error:
        complain(f"ardia: {error}")
        return 2
    except browsing.BrowsingDataError as error:
        complain(f"ardia {args.command}: {error}")
        return 1
    except KeyboardInterrupt:
        complain(f"ardia {args.command}: interrupted")
        return 130
    if args.json:
        say(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0
    describe = describe_pin if args.command == "pinned" else describe_domain if args.domains else describe_visit
    for row in rows:
        say(describe(row))
    return 0


def describe_pin(row: dict) -> str:
    parts = [row["kind"].ljust(8), row["title"] or row["url"], row["url"]]
    if row.get("folder"):
        parts.append(f"(folder {row['folder']})")
    parts.append(f"[{row['profile']}]" + (" parked" if row.get("parked") else ""))
    return "  ".join(shown(part) for part in parts)


def describe_visit(row: dict) -> str:
    return "  ".join(shown(part) for part in [row["last_visit"], f"{row['visits']:>4}", row["title"] or "-", row["url"], f"[{row['profile']}]"])


def describe_domain(row: dict) -> str:
    pages = f"{row['pages']} page{'s' if row['pages'] != 1 else ''}"
    return "  ".join(shown(part) for part in [f"{row['visits']:>5}", row["domain"], pages, row["top_title"] or "-", f"[{row['profile']}]"])
