import json
import sys
from pathlib import Path

from ardia_cli import identity

SCRIPTS_DESCRIPTION = """\
Write userscripts in TypeScript or JavaScript, test them against real pages, and install them so Ardia runs them.

A script is a .ts or .js file (a .user.js from Violentmonkey or Tampermonkey works as is) that starts with a
// ==UserScript== block. Keys Ardia reads:
  @name @namespace @version @description
  @match, @exclude-match        Chrome match patterns (https://*.example.com/*, <all_urls>)
  @include, @exclude            globs over the whole URL: * any run, ? zero or one character, \\ escapes (http(s) only)
  @run-at                       document-start | document-end (default) | document-idle
  @inject-into                  page (default, the page's own JavaScript world) | content (an isolated world) | auto (page)
  @noframes                     top frame only (default: every frame)
@grant other than none, @require and @resource are ignored with a warning: there are no GM_* APIs, and relative
imports are bundled by esbuild instead (one IIFE, recent Chrome, not minified; types are stripped, not checked; no
tsconfig.json is read). Imports must stay inside the script's own folder, and nothing from Ardia's data folder.

Commands:
  new NAME           scaffold NAME.user.ts in the current directory
  test FILE          run it once in a background tab of its own and report what it did
  install FILE       build it and have Ardia run it (needs "Let the ardia command control Ardia" on)
  uninstall NAME     remove an installed script by @name or id
  list               the installed scripts
"""
TEST_DESCRIPTION = """\
Build FILE, open a background tab of its own, register the script at document start, open the page, and report.

The script runs where its @match/@include rules say, at its @run-at point, in the top frame and (without @noframes)
every iframe, cross-origin ones included. The report lists the script's own console output and uncaught exceptions
(with positions mapped back to your source files), errors the page threw itself, whether it ran in the top frame
and in iframes, and the --expect value. After the script ran and the page loaded, the test listens for --wait seconds (Chrome
reports an unhandled promise rejection about a second late), retrying --expect (a JavaScript expression, awaited,
in the page's world) until it's truthy. The tab closes at the end unless --keep.

@inject-into content runs in the page's world here (ardia command connections can't create isolated worlds), with
a warning.

Exit status: 0 the script ran without uncaught exceptions and --expect was truthy, 1 otherwise (build error, the
page didn't match, an exception, a falsy --expect), 2 Ardia can't be reached.

Examples:
  ardia scripts test hide-sidebar.user.ts
  ardia scripts test dark.user.ts --url https://github.com/ --expect 'document.documentElement.dataset.dark'
  ardia scripts test x.user.ts --wait 5 --screenshot /tmp/x.png --json
"""
INSTALL_DESCRIPTION = """\
Build FILE and install it: the CLI keeps a copy under <data dir>/Scripts/scripts/<id>/ and regenerates the
Ardia Scripts extension (<data dir>/Scripts/extension/), which Ardia loads into every profile. Installing a script
with the same @name again updates it. Then it waits up to 10 s for Ardia to report each profile.

Exit status: 0 loaded (or Ardia quit and loads it on its next launch), 1 a build or load error, 2 Ardia isn't
running or "Let the ardia command control Ardia" is off, 3 Ardia didn't answer in 10 s (the outcome is unknown).
"""
NEW_TEMPLATE = """\
// ==UserScript==
// @name        {name}
// @namespace   ardia
// @version     0.1.0
// @description {name}
{matches}// @run-at      document-end
// @grant       none
// ==/UserScript==

console.log({quoted}, "ran on", location.href);
"""
ENDPOINT_EPILOG = """\
Endpoint: --ws, else --port (plain DevTools servers only), else $ARDIA_CDP_URL, else
<data dir>/Chromium/ArdiaControl.json with --data-dir or $ARDIA_DATA_DIR, else the installed Ardia's.
"""
UNKNOWN_EXIT = 3


def add_parser(commands, formatter):
    scripts = commands.add_parser(
        "scripts",
        help="write, test and install userscripts",
        description=identity.brand(SCRIPTS_DESCRIPTION),
        formatter_class=formatter,
    )
    sub = scripts.add_subparsers(dest="scripts_command", metavar="<command>")

    new = sub.add_parser("new", help="scaffold NAME.user.ts in the current directory", description="Scaffold NAME.user.ts in the current directory.")
    new.add_argument("name", metavar="NAME", help="the script's @name; the file is NAME.user.ts")
    new.add_argument("--match", action="append", metavar="PATTERN", help="an @match pattern; repeat for several (default: https://example.com/*)")

    test = sub.add_parser("test", help="run a script once in a background tab and report", description=identity.brand(TEST_DESCRIPTION), epilog=identity.brand(ENDPOINT_EPILOG), formatter_class=formatter)
    test.add_argument("file", metavar="FILE", help="the .ts or .js userscript")
    test.add_argument("--url", metavar="URL", help="the page to open (default: the first @match without wildcards in its host)")
    test.add_argument("--expect", metavar="JS", help="a JavaScript expression that must end up truthy")
    test.add_argument("--wait", type=float, default=2, metavar="SECONDS", help="how long to listen after the page loaded, retrying --expect until it's truthy (default 2)")
    test.add_argument("--screenshot", metavar="PATH", help="save a PNG of the tab at the end")
    test.add_argument("--keep", action="store_true", help="leave the tab open")
    test.add_argument("--json", action="store_true", help="print the report as JSON")
    add_endpoint_arguments(test)

    install = sub.add_parser("install", help=f"install a script so {identity.PRODUCT} runs it", description=identity.brand(INSTALL_DESCRIPTION), formatter_class=formatter)
    install.add_argument("file", metavar="FILE", help="the .ts or .js userscript")
    install.add_argument("--data-dir", metavar="DIR", help=f"the {identity.PRODUCT} data dir (default: $ARDIA_DATA_DIR, else the installed app's)")

    uninstall = sub.add_parser("uninstall", help="remove an installed script", description="Remove an installed script by its @name or id. Exit status as for install.")
    uninstall.add_argument("name", metavar="NAME", help=f"the script's @name or id (see {identity.COMMAND} scripts list)")
    uninstall.add_argument("--data-dir", metavar="DIR", help=f"the {identity.PRODUCT} data dir (default: $ARDIA_DATA_DIR, else the installed app's)")

    listing = sub.add_parser("list", help="list the installed scripts", description=f"List the installed scripts and what {identity.PRODUCT} last reported about them.")
    listing.add_argument("--json", action="store_true", help="print JSON")
    listing.add_argument("--data-dir", metavar="DIR", help=f"the {identity.PRODUCT} data dir (default: $ARDIA_DATA_DIR, else the installed app's)")
    return scripts


def add_endpoint_arguments(parser):
    parser.add_argument("--data-dir", metavar="DIR", help=f"the {identity.PRODUCT} data dir to find (default: $ARDIA_DATA_DIR, else the installed app's)")
    parser.add_argument("--port", type=int, metavar="N", help="a plain DevTools server on 127.0.0.1:N (testing)")
    parser.add_argument("--ws", metavar="URL", help="a browser WebSocket URL")


def run(args, parser) -> int:
    command = args.scripts_command
    if command == "new":
        return new(args)
    if command == "test":
        from ardia_cli import redact

        out = sys.stdout = redact.RedactingStream(sys.stdout)
        err = sys.stderr = redact.RedactingStream(sys.stderr)
        redact.install_log_redaction()
        try:
            return test(args)
        finally:
            out.drain()
            err.drain()
    if command in ("install", "uninstall"):
        return change(args)
    if command == "list":
        return listing(args)
    parser.parse_args(["scripts", "--help"])
    return 0


def say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def new(args) -> int:
    from ardia_cli.userscript import ScriptError, check_match, slug

    name = args.name.strip()
    if not name or "\n" in name:
        complain(f"{identity.COMMAND} scripts new: give the script a name")
        return 1
    stem = name if all(c.isalnum() or c in "-_." for c in name) else slug(name)
    path = Path.cwd() / f"{stem}.user.ts"
    patterns = args.match or ["https://example.com/*"]
    try:
        for pattern in patterns:
            check_match(pattern, "match")
    except ScriptError as error:
        complain(f"{identity.COMMAND} scripts new: {error}")
        return 1
    matches = "".join(f"// @match       {pattern}\n" for pattern in patterns)
    try:
        with open(path, "x", encoding="utf-8") as handle:
            handle.write(NEW_TEMPLATE.format(name=name, matches=matches, quoted=json.dumps(name)))
    except FileExistsError:
        complain(f"{identity.COMMAND} scripts new: {path} already exists")
        return 1
    except OSError as error:
        complain(f"{identity.COMMAND} scripts new: {error}")
        return 1
    say(str(path))
    return 0


def test(args) -> int:
    import asyncio

    from ardia_cli import scripts_test
    from ardia_cli.endpoint import EndpointError, data_root, resolve
    from ardia_cli.userscript import ScriptError, build, default_url, url_runs

    try:
        built = build(args.file, sourcemap=True, data_dirs=[data_root(args.data_dir)])
    except ScriptError as error:
        return report_build_error(args, str(error))
    url = args.url or default_url(built.meta)
    if not url:
        return report_build_error(args, "no @match gives a concrete page to open; pass --url URL")
    if args.wait < 0:
        return report_build_error(args, "--wait can't be negative")
    if not url_runs(built.meta, url):
        built.meta.warnings.append(f"{url} doesn't match the script's @match/@include rules, so it won't run there")
    try:
        endpoint = resolve(ws=args.ws, port=args.port, data_dir=args.data_dir)
        report = asyncio.run(scripts_test.run_test(built, url, endpoint, args.expect, args.wait, args.screenshot, args.keep))
    except EndpointError as error:
        complain(f"{identity.COMMAND}: {error}")
        return 2
    except KeyboardInterrupt:
        complain(f"{identity.COMMAND} scripts test: interrupted")
        return 130
    except asyncio.CancelledError:
        complain(f"{identity.COMMAND} scripts test: terminated")
        return 143
    if args.json:
        say(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        say(scripts_test.format_report(report))
    return 0 if report.ok else 1


def report_build_error(args, message: str) -> int:
    if getattr(args, "json", False):
        say(json.dumps({"ok": False, "ran": False, "script": args.file, "error": message}, indent=2, ensure_ascii=False))
    else:
        complain(f"{identity.COMMAND} scripts: {message}")
    return 1


def change(args) -> int:
    from ardia_cli.endpoint import EndpointError, data_root, require_control
    from ardia_cli.scripts_store import Store, StoreError
    from ardia_cli.userscript import ScriptError, build

    root = data_root(args.data_dir)
    built = None
    if args.scripts_command == "install":
        try:
            built = build(args.file, data_dirs=[root])
        except ScriptError as error:
            complain(f"{identity.COMMAND} scripts: {error}")
            return 1
        for warning in built.meta.warnings + built.warnings:
            say(f"warning: {warning}")
        if not built.meta.matches and not built.meta.includes:
            complain(f"{identity.COMMAND} scripts: add an @match or @include line so the script runs somewhere")
            return 1
    try:
        require_control(root)
    except EndpointError as error:
        complain(f"{identity.COMMAND}: {error}")
        return 2
    store = Store(root)
    try:
        with store:
            if built is not None:
                record, generation = store.apply(add=built)
                summary = f"{'updated' if record.get('updated') else 'installed'} {describe(record)}"
            else:
                found = store.find(args.name)
                if found is None:
                    names = ", ".join(m.get("name", m["id"]) for m in store.installed()) or "none"
                    complain(f"{identity.COMMAND} scripts: no installed script is named {args.name!r} (installed: {names})")
                    return 1
                record, generation = store.apply(remove=found["id"])
                summary = f"uninstalled {record.get('name')} ({record['id']})"
            removed_all = not store.extension_present()
        say(summary)
        say(f"generation {generation}")

        def alive() -> bool:
            try:
                require_control(root)
            except EndpointError:
                return False
            return True

        outcome, status = store.wait_status(generation, alive)
    except (StoreError, OSError) as error:
        complain(f"{identity.COMMAND} scripts: {error}")
        return 1
    finally:
        store.close()
    if outcome == "quit":
        say(f"{identity.PRODUCT} quit (or control was turned off) before applying it; it applies the change on its next launch")
        return 0
    if outcome == "timeout":
        say(f"{identity.PRODUCT} hasn't reported generation {generation} after 10 s: the outcome is unknown, it may still be applying it (see {identity.COMMAND} scripts list)")
        return UNKNOWN_EXIT
    if outcome == "superseded":
        say(f"a newer change (generation {status.get('generation')}) replaced this one; {identity.PRODUCT} reported that one:")
        removed_all = False
    return print_profiles(status, removed_all)


def describe(record: dict) -> str:
    version = f" {record['version']}" if record.get("version") else ""
    where = ", ".join(record.get("matches", []) + record.get("includes", [])) or "nowhere"
    return f"{record.get('name')}{version} ({record['id']}): {where} [{record.get('run_at')}, {record.get('world', 'MAIN').lower()} world]"


def profile_lines(status: dict, removed: bool = False) -> tuple[list[str], bool]:
    profiles = status.get("profiles") if isinstance(status, dict) else None
    lines, failed = [], False
    if not isinstance(profiles, dict) or not profiles:
        return [f"{identity.PRODUCT} reported no profiles"], False
    for name, result in profiles.items():
        if not isinstance(result, dict):
            lines.append(f"{name}: unknown result")
        elif result.get("error"):
            failed = True
            lines.append(f"{name}: error {result['error']}")
        elif result.get("disabled"):
            lines.append(f"{name}: turned off in Extensions, so the scripts don't run there")
        elif result.get("removed"):
            lines.append(f"{name}: removed")
        elif result.get("ok"):
            lines.append(f"{name}: {'removed' if removed else 'loaded'}")
        else:
            lines.append(f"{name}: unknown result")
    return lines, failed


def print_profiles(status: dict, removed: bool = False) -> int:
    lines, failed = profile_lines(status, removed)
    for line in lines:
        say(line)
    return 1 if failed else 0


def listing(args) -> int:
    from ardia_cli.endpoint import EndpointError, data_root, explicit_data_root, require_control
    from ardia_cli.scripts_store import Store, StoreError, repair_if_present

    root = data_root(args.data_dir)
    trusted = explicit_data_root(args.data_dir) is not None
    if not trusted:
        try:
            require_control(root)
            trusted = True
        except EndpointError:
            trusted = False
    note = None
    if trusted:
        try:
            note = repair_if_present(root)
        except (StoreError, OSError) as error:
            complain(f"{identity.COMMAND} scripts: can't check the installed scripts ({error})")
            return 1
        if note and not args.json:
            say(f"repaired: {note}")
    store = Store(data_root(args.data_dir))
    try:
        store.open(False)
        scripts = store.installed()
        generation = store.generation()
        status = store.status()
        removed = generation > 0 and not store.extension_present()
    except (StoreError, OSError) as error:
        complain(f"{identity.COMMAND} scripts: {error}")
        return 1
    finally:
        store.close()
    if args.json:
        say(json.dumps({"scripts": scripts, "generation": generation, "status": status, "repaired": note}, indent=2, ensure_ascii=False))
        return 0
    if not scripts:
        say("no scripts installed")
    for record in scripts:
        say(describe(record))
        say(f"  source: {record.get('source_file')}")
    if generation:
        reported = status.get("generation") if status else None
        if reported == generation:
            lines, _ = profile_lines(status, removed)
            say(f"generation {generation}, reported by {identity.PRODUCT}:")
            for line in lines:
                say(f"  {line}")
        else:
            say(f"generation {generation}, not reported by {identity.PRODUCT} yet" + (f" (it last reported {reported})" if reported else ""))
    return 0
