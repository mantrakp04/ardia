import asyncio
import base64
import difflib
import json
import os
import re
import secrets
import shlex
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli.browse import actions, changes, snapshot
from ardia_cli.browse.errors import BrowseError, ConnectionLost, Gated, OutcomeUnknown, Usage
from ardia_cli.browse.state import parse_ref, wait_until

COMMANDS: dict = {}
ALIASES = {
    "goto": "open", "navigate": "open", "key": "press", "scrollinto": "scrollintoview", "quit": "close", "exit": "close",
    "geolocation": "geo",
}
MUTATING = {
    "open", "click", "dblclick", "type", "fill", "press", "keyboard", "keydown", "keyup", "hover", "check", "uncheck",
    "select", "drag", "upload", "download", "scroll", "scrollintoview", "mouse", "back", "forward", "reload", "tab",
    "find", "auth", "pushstate", "eval", "dialog", "batch", "storage", "cookies", "set", "state", "clipboard", "close", "script",
}
KNOWN_SCHEMES = ("http", "https", "about", "data", "file", "blob", "chrome", "view-source")
LOOPBACK = re.compile(r"^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(/|$)")


@dataclass
class Result:
    data: dict = field(default_factory=dict)
    text: str | None = "✓ Done"
    page_content: bool = False


@dataclass
class Ctx:
    state: object
    options: dict
    cwd: str
    env: dict
    stdin: str | None
    command: str = ""

    @property
    def humanize(self) -> bool:
        return self.options.get("humanize", False)

    @property
    def timeout(self) -> float:
        return float(self.options.get("timeout_ms") or 25000) / 1000

    def path(self, value: str) -> str:
        return str(Path(self.cwd, os.path.expanduser(value)).resolve())


def command(*names):
    def register(function):
        for name in names:
            COMMANDS[name] = function
        return function

    return register


def parse(argv: list[str], flags: dict[str, str] | None = None, aliases: dict[str, str] | None = None):
    flags = flags or {}
    aliases = aliases or {}
    options: dict = {}
    positionals: list[str] = []
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token == "--":
            positionals.extend(argv[index:])
            break
        name, inline = (token.split("=", 1) + [None])[:2] if token.startswith("--") and "=" in token else (token, None)
        name = aliases.get(name, name)
        if name in flags:
            kind = flags[name]
            key = name.lstrip("-").replace("-", "_")
            if kind == "bool":
                options[key] = True
            else:
                if inline is None:
                    if index >= len(argv):
                        raise Usage(f"{name} needs a value")
                    inline = argv[index]
                    index += 1
                if kind == "multi":
                    options.setdefault(key, []).append(inline)
                else:
                    options[key] = inline
            continue
        if token.startswith("-") and len(token) > 1 and not re.match(r"^-\d", token):
            raise Usage(f"Unknown flag: {token}")
        positionals.append(token)
    return options, positionals


def need(positionals: list[str], count: int, usage: str):
    if len(positionals) < count:
        raise Usage(f"Usage: ardia browse {usage}")


def normalize_url(url: str) -> str:
    url = url.strip()
    match = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*):", url)
    if match and match.group(1).lower() in KNOWN_SCHEMES:
        return url
    if LOOPBACK.match(url):
        return "http://" + url
    return "https://" + url


async def page_title(page) -> str:
    try:
        return await page.call("() => document.title", frame=page.main_frame, read=True) or ""
    except BrowseError:
        return ""


async def wait_for_load(page, loader: str | None, timeout: float, until: str = "load"):
    event = {"load": "load", "domcontentloaded": "DOMContentLoaded", "networkidle": "networkIdle"}.get(until, until)

    async def ready():
        main = page.main_frame
        current = page.lifecycle.get(main)
        if current and (loader is None or current[0] == loader) and event in current[1]:
            return True
        if event in ("load", "DOMContentLoaded"):
            try:
                state = await page.call("() => document.readyState", frame=main, read=True)
            except BrowseError as error:
                if error.code == "tab_detached":
                    raise
                return False
            frame_loader = page.loader(main)
            if loader is not None and frame_loader != loader:
                return False
            return state == "complete" or (event == "DOMContentLoaded" and state == "interactive")
        return False

    await wait_until(ready, timeout, 0.05, f"the page to reach {until}")


async def navigate(ctx: Ctx, page, url: str, until: str = "load"):
    from ardia_cli.browse import readpages

    before = await readpages.before_navigating(page, url)
    try:
        result = await page.send("Page.navigate", {"url": url}, timeout=ctx.timeout)
    except Gated:
        raise BrowseError(f"Ardia's policy only lets the ardia command open web pages (http, https, data, about:blank); {url} isn't one") from None
    if result.get("errorText"):
        raise BrowseError(f"Navigation to {url} failed: {result['errorText']}")
    loader = result.get("loaderId")
    if loader:
        await wait_for_load(page, loader, ctx.timeout, until)
    else:
        await readpages.after_same_document(page, before, asyncio.get_running_loop().time() + ctx.timeout)
    await page.refresh_frames()


def wants_show(ctx: Ctx, options: dict) -> bool:
    return bool(options.get("show") or ctx.options.get("show") or str(ctx.env.get("AGENT_BROWSER_SHOW_TAB") or "").lower() in ("1", "true", "yes", "on"))


async def new_tab(ctx: Ctx, url: str | None, label: str | None = None, window: bool = False, show: bool = False):
    state = ctx.state
    await state.connect()
    params = {"url": "about:blank", "background": True}
    if window:
        params["newWindow"] = True
    try:
        result = await state.browser.send("Target.createTarget", params)
    except Gated as error:
        raise BrowseError(f"Ardia's policy refused to open a tab for the ardia command ({error.refusal})") from None
    target_id = result["targetId"]
    state.opened.add(target_id)
    state.registry.note_opened(state.instance, target_id)
    state.target_infos.setdefault(target_id, {"targetId": target_id, "url": "about:blank", "title": "", "type": "page"})
    state.tab_id(target_id)
    if label:
        if label in state.labels:
            raise BrowseError(f"The label {label} is already used by another tab")
        state.labels[label] = target_id
    state.current = target_id
    if state.pin_tab:
        state.extras["pinned_target"] = target_id
    page = await state.page(target_id)
    await apply_open_options(ctx, page)
    if url:
        await navigate(ctx, page, normalize_url(url))
    if show:
        await show_tab(ctx, page)
    return page


async def show_tab(ctx: Ctx, page):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 5
    nudge = 0.0
    shown_since = None
    while True:
        if loop.time() >= nudge:
            await ctx.state.browser.send("Target.activateTarget", {"targetId": page.target_id})
            nudge = loop.time() + 1
        if not await page.hidden() and await tab_shown(ctx.state, page) is not False:
            shown_since = shown_since or loop.time()
            if loop.time() - shown_since >= SHOWN_HOLD:
                return
        else:
            shown_since = None
            nudge = min(nudge, loop.time() + 0.2)
        if loop.time() >= deadline:
            raise BrowseError("Ardia didn't show the tab; switch to it in Ardia, or try `ardia browse tab <id> --show` again")
        await asyncio.sleep(0.1)


async def tab_shown(state, page) -> bool | None:
    try:
        infos = (await state.browser.send("Target.getTargets", {"filter": [{"type": "tab"}]})).get("targetInfos") or []
    except BrowseError:
        return None
    await page.refresh_frames()
    same = [info for info in infos if info.get("type") == "tab" and info.get("url") == page.url and isinstance(info.get("embedderData"), dict)]
    return bool(same[0]["embedderData"].get("tabActive")) if len(same) == 1 else None


async def apply_open_options(ctx: Ctx, page):
    from ardia_cli.browse import react

    for feature in ctx.options.get("enable") or []:
        if feature != "react-devtools":
            raise BrowseError(f"Unknown --enable feature: {feature} (react-devtools)")
        if "react" not in page.init_scripts.values():
            await add_init_script(ctx, page, react.HOOK, "react")
    for path in ctx.options.get("init_scripts") or []:
        source = Path(ctx.path(path)).read_text(encoding="utf-8")
        await add_init_script(ctx, page, source, None)
    if ctx.options.get("capture_console"):
        from ardia_cli.browse import capture

        await capture.activate(ctx, page, "console", page.enable_runtime)
        ctx.state.leases.add("console")


async def add_init_script(ctx: Ctx, page, source: str, tag: str | None) -> str:
    result = await page.send("Page.addScriptToEvaluateOnNewDocument", {"source": source})
    identifier = result["identifier"]
    page.init_scripts[identifier] = tag or source
    ctx.state.extras.setdefault("init_sources", {})[identifier] = source
    ctx.state.leases.add("init")
    return identifier


def borrowed_tab(state) -> str | None:
    attached = (getattr(state, "extras", None) or {}).get("attached")
    current = getattr(state, "current", None)
    return attached if current and current == attached else None


async def current_or_new(ctx: Ctx):
    state = ctx.state
    await state.connect()
    borrowed = borrowed_tab(state)
    if state.current and state.current in state.target_infos and not borrowed:
        return await state.page()
    page = await new_tab(ctx, None)
    if borrowed:
        note_own_tab(state, page, borrowed)
    return page


def note_own_tab(state, page, borrowed: str):
    notice = (f"→ Opened in its own background tab [{state.tab_id(page.target_id)}], since this session uses your tab "
              f"[{state.tab_id(borrowed)}] and won't navigate it; `tab {state.tab_id(borrowed)}` goes back")
    state.extras["notice"] = "\n".join(part for part in (state.extras.get("notice"), notice) if part)


def refuse_on_borrowed(ctx: Ctx, page, what: str):
    borrowed = borrowed_tab(ctx.state)
    if borrowed and borrowed == page.target_id:
        tab = ctx.state.tab_id(borrowed)
        raise BrowseError(
            f"This session is using your tab [{tab}] (it had no tab of its own), so it won't {what} it. To drive that tab anyway, "
            f"pick it with `ardia browse tab {tab}`; to browse on your own, use `ardia browse open <url>`",
            data={"tabId": tab}, code="borrowed_tab",
        )


@command("open")
async def cmd_open(ctx: Ctx, argv):
    options, args = parse(argv, {"--enable": "multi", "--init-script": "multi", "--capture-console": "bool", "--headers": "value", "--label": "value", "--show": "bool"})
    if options.get("headers"):
        raise Usage("ardia browse can't scope headers to an origin at launch; run `ardia browse set headers <json>` before `open`")
    ctx.options.setdefault("enable", []).extend(sum((value.split(",") for value in options.get("enable") or []), []))
    ctx.options.setdefault("init_scripts", []).extend(options.get("init_script") or [])
    if options.get("capture_console"):
        ctx.options["capture_console"] = True
    state = ctx.state
    await state.connect()
    url = normalize_url(args[0]) if args else None
    show = wants_show(ctx, options)
    borrowed = state.extras.get("attached") if state.current and state.current == state.extras.get("attached") else None
    came_from = "about:blank"
    reporting = bool(url) and not ctx.options.get("no_changes") and state.extras.get("top_command") != "script"
    fresh_tab = not (state.current and state.current in state.target_infos and not borrowed)
    if fresh_tab:
        page = await new_tab(ctx, None if reporting else url, options.get("label"), show=show and not reporting)
    else:
        page = await state.page()
        came_from = page.url
        await apply_open_options(ctx, page)
    if reporting:
        await changes.settled(page, lambda: navigate(ctx, page, url))
    elif url and not fresh_tab:
        await navigate(ctx, page, url)
    if show and (reporting or not fresh_tab):
        await show_tab(ctx, page)
    background = await page.takes_input() if fresh_tab and not show else None
    await page.refresh_frames()
    title = await page_title(page)
    data = {"url": page.url, "title": title}
    text = f"✓ {title}\n  {page.url}"
    if background is not None:
        tab = state.tab_id(page.target_id)
        data.update({"tabId": tab, "background": True, "takesInput": background})
        if borrowed:
            from ardia_cli import command_metrics

            left = state.tab_id(borrowed)
            data["left"] = left
            command_metrics.flag("open_moved_tab", True)
            where = (f"→ [{tab}] is this session's tab now, a background tab of its own, since this session uses your tab [{left}] "
                     f"and won't navigate it; `tab {left}` goes back")
        else:
            where = f"→ Opened in its own background tab [{tab}]"
        if borrowed or not background:
            text += f"\n{where}; " + ("it takes input without being shown" if background else f"this Ardia doesn't deliver input there. use: ardia browse tab {tab} --show (or open <url> --show)")
    result = Result(data, text)
    if reporting:
        report = await changes.arrival(ctx, page, came_from)
        if report is not None:
            changes.attach(result, report)
    return result


@command("back", "forward")
async def cmd_history(ctx: Ctx, argv):
    page = await ctx.state.page()
    refuse_on_borrowed(ctx, page, f"go {ctx.command} in")
    history = await page.send("Page.getNavigationHistory")
    index = history.get("currentIndex", 0)
    entries = history.get("entries") or []
    step = -1 if ctx.command == "back" else 1
    if not 0 <= index + step < len(entries) or (index + step == 0 and entries[0].get("url") == "about:blank" and page.target_id in ctx.state.opened):
        return Result({"url": page.url}, page.url)
    before = page.navigations
    before_url = page.url
    await page.call(f"() => {{ history.go({step}); return true; }}", frame=page.main_frame)

    async def moved():
        if page.navigations != before:
            try:
                return await page.call("() => document.readyState === 'complete'", frame=page.main_frame, read=True)
            except BrowseError:
                return False
        return page.url != before_url

    await wait_until(moved, ctx.timeout, 0.05, "the history navigation")
    await page.refresh_frames()
    return Result({"url": page.url}, page.url)


@command("reload")
async def cmd_reload(ctx: Ctx, argv):
    page = await ctx.state.page()
    refuse_on_borrowed(ctx, page, "reload")
    before = page.navigations
    await page.send("Page.reload", {})
    await wait_until(lambda: _settled(page, before), ctx.timeout, 0.05, "the reload")
    await page.refresh_frames()
    return Result({"url": page.url}, page.url)


async def _settled(page, before):
    if page.navigations == before:
        return False
    current = page.lifecycle.get(page.main_frame)
    return bool(current and current[0] == page.loader(page.main_frame) and "load" in current[1])


@command("pushstate")
async def cmd_pushstate(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "pushstate <url>")
    page = await ctx.state.page()
    refuse_on_borrowed(ctx, page, "change the address of")
    url = await page.call("(u) => ardiaBrowse.pushState(u)", args[0], frame=page.main_frame)
    page.url = url
    return Result({"url": url}, url)


@command("snapshot")
async def cmd_snapshot(ctx: Ctx, argv):
    from ardia_cli import notes

    options, args = parse(
        argv,
        {"--interactive": "bool", "--compact": "bool", "--depth": "value", "--selector": "value", "--urls": "bool", "--cursor": "bool", "--diff": "bool"},
        {"-i": "--interactive", "-c": "--compact", "-d": "--depth", "-s": "--selector", "-u": "--urls", "-C": "--cursor"},
    )
    selector = options.get("selector") or (args[0] if args else None)
    depth = int(options["depth"]) if options.get("depth") is not None else None
    if options.get("diff") and (selector or depth is not None):
        raise Usage("snapshot --diff compares the whole page, so it takes no -s or -d")
    page = await ctx.state.page()
    await page.refresh_frames()
    before = changes.previous(ctx.state, page) if options.get("diff") else None
    text, _ = await snapshot.take(ctx.state, page, bool(options.get("interactive")), bool(options.get("compact")), depth, selector, bool(options.get("urls")))
    origin = page.frames.get(page.main_frame, {}).get("origin") or page.url
    data = {"origin": origin if origin.endswith("/") else origin + "/", "refs": ctx.state.refs_json(), "snapshot": text}
    body = text or "(empty page)"
    if options.get("diff"):
        if before is None:
            data["changes"] = None
            body = "(no earlier snapshot of this document in this session, so here is all of it)\n" + body
        else:
            report = changes.diff(before, ctx.state.extras["views"][page.target_id])
            data["changes"] = changes.as_data(report)
            body = changes.render(report)
    root = ctx.state.config.get("data_root")
    site, header = notes.header(Path(root), page.url) if root else (None, None)
    if header:
        data["notes"] = {"site": site, "header": header}
        body = header + "\n" + body
    return Result(data, body, page_content=True)


@command("notes")
async def cmd_notes(ctx: Ctx, argv):
    from ardia_cli import notes

    tab = None
    if "--tab" in argv:
        at = argv.index("--tab")
        if at + 1 >= len(argv):
            raise Usage("--tab needs a tab id (t1, or the tab-… id `ardia windows` prints)")
        tab, argv = argv[at + 1], argv[:at] + argv[at + 2:]
    request = notes.parse_args(argv)
    if request.text == "-":
        request.text = ctx.stdin or ""
    url = None
    if request.site is None and request.action != "list":
        if tab is not None:
            await ctx.state.connect()
            await ctx.state.refresh_targets()
            page = await ctx.state.page(await ctx.state.find_tab(tab))
        else:
            page = await ctx.state.page()
        await page.refresh_frames()
        url = page.url
    return notes.run_request(Path(ctx.state.config["data_root"]), request, url)


async def resolve(ctx: Ctx, selector: str):
    return await ctx.state.locate(selector)


@command("click")
async def cmd_click(ctx: Ctx, argv):
    options, args = parse(argv, {"--new-tab": "bool", "--button": "value", "--no-humanize": "bool"})
    need(args, 1, "click <selector> [--new-tab]")
    page, element = await resolve(ctx, args[0])
    humanize = ctx.humanize and not options.get("no_humanize")
    if options.get("new_tab"):
        href = await page.call("(el) => { const a = el.closest('a[href]'); return a ? a.href : null; }", element, frame=element.frame)
        if not href:
            raise BrowseError(f"--new-tab needs a link; {args[0]} has no href")
        previous = ctx.state.current
        tab = await new_tab(ctx, href)
        ctx.state.current = previous or tab.target_id
        return Result({"clicked": args[0], "newTab": ctx.state.tab_id(tab.target_id), "url": tab.url})
    _, report = await changes.observe(ctx, page, lambda: actions.click(page, element, humanize, 1, options.get("button") or "left"))
    return changes.attach(Result({"clicked": args[0]}), report)


@command("dblclick")
async def cmd_dblclick(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "dblclick <selector>")
    page, element = await resolve(ctx, args[0])
    _, report = await changes.observe(ctx, page, lambda: actions.click(page, element, ctx.humanize and not options.get("no_humanize"), 2))
    return changes.attach(Result({"clicked": args[0], "count": 2}), report)


@command("hover")
async def cmd_hover(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "hover <selector>")
    page, element = await resolve(ctx, args[0])
    _, report = await changes.observe(ctx, page, lambda: actions.hover(page, element, ctx.humanize and not options.get("no_humanize")))
    return changes.attach(Result({"hovered": args[0]}), report)


@command("focus")
async def cmd_focus(ctx: Ctx, argv):
    _, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "focus <selector>")
    page, element = await resolve(ctx, args[0])
    _, report = await changes.observe(ctx, page, lambda: page.focus_element(element))
    return changes.attach(Result({"focused": args[0]}), report)


@command("fill")
async def cmd_fill(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "fill <selector> <text>")
    page, element = await resolve(ctx, args[0])
    text = " ".join(args[1:])
    humanize = ctx.humanize and not options.get("no_humanize")
    typeahead = await actions.combo_kind(page, element) == "typeahead"

    async def run():
        if not (typeahead and text):
            return await actions.fill(page, element, text, humanize), []
        await actions.watch_suggestions(page, element)
        try:
            filled = await actions.fill(page, element, text, humanize)
            return filled, (await actions.settled_suggestions(page, element, actions.SUGGESTION_HINT_WAIT))[1]
        finally:
            await actions.unwatch_suggestions(page, element)

    ((retargeted, stored), found), report = await changes.observe(ctx, page, run)
    result = filled_result("filled", args[0], retargeted, text, stored)
    if found:
        result.data["suggestions"] = [item["text"] for item in found]
        best = text if actions.unique_match(text, found) else found[0]["text"]
        result.text += (f"\n→ {len(found)} suggestion{'s' if len(found) != 1 else ''} showing, none picked. "
                        f"To pick one: ardia browse select {args[0]} {shlex.quote(best)}")
    return changes.attach(result, report)


def filled_result(key: str, selector: str, retargeted: bool, text: str, stored: str | dict | None) -> Result:
    if stored is None:
        return typed_result(key, selector, retargeted)
    if isinstance(stored, dict):
        now = stored["value"]
        shown = "(couldn't read it back)" if now is None else now or "empty"
        return Result({key: selector, "cell": stored["cell"], "value": now, "was": stored["was"]},
                      f'✓ Done\n~ gridcell "{stored["cell"]}": {shown} (was {stored["was"] or "empty"})')
    note = "✓ Done" if stored == text else f"✓ Done (the field holds {stored or 'nothing'})"
    return Result({key: selector, "value": stored}, note)


def typed_result(key: str, selector: str, retargeted: bool) -> Result:
    if not retargeted:
        return Result({key: selector})
    return Result({key: selector, "retargeted": True},
                  f"✓ Done (the page replaced {selector} with a new field when it was focused; typed into that one)")


@command("type")
async def cmd_type(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool", "--delay": "value"})
    need(args, 2, "type <selector> <text>")
    page, element = await resolve(ctx, args[0])
    retargeted, report = await changes.observe(ctx, page, lambda: actions.type_text(page, element, " ".join(args[1:]), ctx.humanize and not options.get("no_humanize")))
    return changes.attach(typed_result("typed", args[0], retargeted), report)


@command("press")
async def cmd_press(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "press <key>")
    page = await ctx.state.page()
    humanize = ctx.humanize and not options.get("no_humanize")
    frame = ctx.state.frame_for(page) or page.main_frame
    _, report = await changes.observe(ctx, page, lambda: actions.expect_input(
        page, frame, lambda: page.input.gesture("press", lambda: page.input.press_combo(args[0], humanize)), {"keydown": 1}, "The key press"))
    return changes.attach(Result({"pressed": args[0]}), report)


@command("keydown", "keyup")
async def cmd_keydown(ctx: Ctx, argv):
    _, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, f"{ctx.command} <key>")
    page = await ctx.state.page()
    down = ctx.command == "keydown"
    frame = ctx.state.frame_for(page) or page.main_frame
    await actions.expect_input(page, frame, lambda: page.input.gesture(ctx.command, lambda: page.input.press_combo(args[0], False, down_only=down, up_only=not down), keep_held=True),
                               {"keydown" if down else "keyup": 1}, f"The {ctx.command}")
    return Result({"key": args[0], "down" if down else "up": True})


@command("keyboard")
async def cmd_keyboard(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "keyboard type|inserttext <text>")
    page = await ctx.state.page()
    text = " ".join(args[1:])
    if args[0] == "inserttext":
        frame = ctx.state.frame_for(page) or page.main_frame
        await page.require_visible()
        _, report = await changes.observe(ctx, page, lambda: actions.expect_input(
            page, frame, lambda: page.input.gesture("keyboard inserttext", lambda: page.send("Input.insertText", {"text": text}, input_event=True)),
            {"beforeinput|input": 1} if text else {}, "The text insert"))
        return changes.attach(Result({"inserted": True}), report)
    if args[0] != "type":
        raise Usage(f"Unknown keyboard subcommand: {args[0]} (type or inserttext)")
    keyboard = page.input.keyboard()
    humanize = ctx.humanize and not options.get("no_humanize")
    frame = ctx.state.frame_for(page) or page.main_frame
    _, report = await changes.observe(ctx, page, lambda: actions.expect_input(
        page, frame, lambda: page.input.gesture("keyboard type", lambda: keyboard.type_text(text, humanize=humanize)), {"keydown": len(text)}, "The typing"))
    return changes.attach(Result({"typed": True}), report)


@command("check", "uncheck")
async def cmd_check(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, f"{ctx.command} <selector>")
    page, element = await resolve(ctx, args[0])
    wanted = ctx.command == "check"
    _, report = await changes.observe(ctx, page, lambda: actions.set_checked(page, element, wanted, ctx.humanize and not options.get("no_humanize")))
    return changes.attach(Result({"checked" if wanted else "unchecked": args[0]}), report)


@command("select")
async def cmd_select(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "select <selector> <value...>")
    page, element = await resolve(ctx, args[0])
    return await select_in(ctx, page, element, args[0], args[1:], ctx.humanize and not options.get("no_humanize"))


async def select_in(ctx: Ctx, page, element, selector: str, values: list[str], humanize: bool) -> Result:
    if await actions.combo_kind(page, element) == "select":
        _, report = await changes.observe(ctx, page, lambda: actions.select(page, element, values))
        return changes.attach(Result({"selected": values}), report)
    where = await field_name(page, element, selector)
    picked, report = await changes.observe(ctx, page, lambda: actions.choose(page, element, values, humanize, where))
    text = "\n".join(f'✓ Picked "{item["picked"]}"' + (f' for "{item["value"]}"' if plain(item["picked"]) != plain(item["value"]) else "") for item in picked)
    return changes.attach(Result({"selected": values, "picked": [item["picked"] for item in picked]}, text), report)


async def field_name(page, element, selector: str) -> str:
    names = await page.call("(el) => ardiaBrowse.labelText(el).concat([el.getAttribute('placeholder') || ''])", element, frame=element.frame, read=True)
    name = next((" ".join(str(item).split()) for item in names or [] if str(item).strip()), "")
    return f'"{name}" ({selector})' if name else selector


@command("drag")
async def cmd_drag(ctx: Ctx, argv):
    from ardia_cli import command_metrics

    options, args = parse(argv, {"--no-humanize": "bool", "--before": "bool", "--after": "bool"})
    need(args, 2, "drag <source> <target> [--before|--after]")
    if options.get("before") and options.get("after"):
        raise Usage("drag takes --before or --after, not both")
    side = "before" if options.get("before") else "after" if options.get("after") else None
    if side:
        command_metrics.flag("drag_side_given", True)
    page, source = await resolve(ctx, args[0])
    target_page, target = await resolve(ctx, args[1])
    if target_page is not page:
        raise BrowseError("Both ends of a drag must be in the same tab")
    listed = await actions.list_before(page, source, target)
    outcome, report = await changes.observe(ctx, page, lambda: actions.drag(page, source, target, ctx.humanize and not options.get("no_humanize"), side))
    if listed:
        position = await actions.list_after(page, source.frame, listed)
        if position:
            outcome["position"] = position
    return changes.attach(Result({"dragged": args[0], "to": args[1], **outcome}, drag_text(outcome)), report)


def drag_text(outcome: dict) -> str:
    if not outcome.get("html5"):
        text = "✓ Done"
    elif not outcome.get("started"):
        text = "✓ Done (the page didn't start an HTML5 drag, so it was a plain mouse drag)"
    elif outcome.get("dropped") is False:
        text = "✓ Done (HTML5 drag; the target didn't accept the drop, so the page got no drop event)"
    else:
        text = "✓ Done (HTML5 drag and drop)"
    position = outcome.get("position")
    if position and position["to"] != position["from"]:
        text += f"\nmoved to {position['to']} of {position['count']} (was {position['from']})"
    elif position:
        text += f"\nthe order didn't change: still {position['to']} of {position['count']}"
    if outcome.get("interceptionLeftOn"):
        text += "\n  Ardia didn't confirm drag interception was turned off; it ends when this session disconnects (30 s idle)"
    return text


@command("upload")
async def cmd_upload(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "upload <selector> <files...>")
    files = [ctx.path(item) for item in args[1:]]
    for item in files:
        if not os.path.isfile(item):
            raise BrowseError(f"No such file: {item}")
    page, element = await resolve(ctx, args[0])

    async def run():
        try:
            await page.send("DOM.setFileInputFiles", {"files": files, "backendNodeId": element.backend_id})
        except Gated as error:
            raise error.during("upload") from None

    _, report = await changes.observe(ctx, page, run)
    return changes.attach(Result({"uploaded": files}), report)


@command("scroll")
async def cmd_scroll(ctx: Ctx, argv):
    options, args = parse(argv, {"--selector": "value", "--no-humanize": "bool"}, {"-s": "--selector"})
    direction = args[0] if args else "down"
    amount = float(args[1]) if len(args) > 1 else actions.SCROLL_DEFAULT
    page = await ctx.state.page()
    element = None
    if options.get("selector"):
        page, element = await resolve(ctx, options["selector"])
    _, report = await changes.observe(ctx, page, lambda: actions.scroll(page, direction, amount, ctx.humanize and not options.get("no_humanize"), element))
    return changes.attach(Result({"scrolled": True}), report)


@command("scrollintoview")
async def cmd_scrollintoview(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "scrollintoview <selector>")
    page, element = await resolve(ctx, args[0])
    humanize = ctx.humanize and not options.get("no_humanize")
    await page.input.gesture("scrollintoview", lambda: actions.scroll_into_view(page, element, humanize), allow_hidden=True)
    return Result({"scrolled": args[0]})


@command("mouse")
async def cmd_mouse(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "mouse move <x> <y> | down [button] | up [button] | wheel <dy> [dx]")
    page = await ctx.state.page()
    mouse = page.input.mouse
    humanize = ctx.humanize and not options.get("no_humanize")
    action = args[0]
    if action == "move":
        need(args, 3, "mouse move <x> <y>")
        x, y = float(args[1]), float(args[2])
        needs = {} if await page.call("(x, y) => ardiaBrowse.overFrame(x, y)", x, y, frame=page.main_frame, read=True) else {"mousemove": 1}
        await actions.expect_input(page, page.main_frame, lambda: page.input.gesture("mouse move", lambda: mouse.move(x, y, humanize=humanize), keep_held=True),
                                   needs, "The mouse move")
        return Result({"moved": True})
    if action in ("down", "up"):
        button = actions.mouse_button(args[1] if len(args) > 1 else None)
        run = (lambda: mouse.down(button)) if action == "down" else (lambda: mouse.up(button))
        x, y = mouse._position
        over = await page.call("(x, y) => ardiaBrowse.overFrame(x, y)", x, y, frame=page.main_frame, read=True)
        await actions.expect_input(page, page.main_frame, lambda: page.input.gesture(f"mouse {action}", run, keep_held=True),
                                   {} if over else {"mousedown" if action == "down" else "mouseup": 1}, f"The mouse {action}")
        return Result({action: True})
    if action == "wheel":
        need(args, 2, "mouse wheel <dy> [dx]")
        dy = float(args[1])
        dx = float(args[2]) if len(args) > 2 else 0
        x, y = mouse._position
        over = await page.call("(x, y) => ardiaBrowse.overFrame(x, y)", x, y, frame=page.main_frame, read=True)
        wheel = {"type": "mouseWheel", "x": int(x), "y": int(y), "deltaX": dx, "deltaY": dy}
        await actions.expect_input(page, page.main_frame, lambda: page.input.gesture("mouse wheel", lambda: page.send("Input.dispatchMouseEvent", wheel, input_event=True), keep_held=True),
                                   {} if over else {"wheel": 1}, "The wheel")
        return Result({"scrolled": True})
    raise Usage(f"Unknown mouse action: {action}")


@command("wait")
async def cmd_wait(ctx: Ctx, argv):
    options, args = parse(
        argv,
        {"--text": "value", "--url": "value", "--load": "value", "--fn": "value", "--state": "value", "--timeout": "value", "--download": "bool"},
        {"-t": "--text", "-u": "--url", "-l": "--load", "-f": "--fn"},
    )
    timeout = float(options["timeout"]) / 1000 if options.get("timeout") else ctx.timeout
    if options.get("download"):
        path = ctx.path(args[0]) if args else None
        saved = await wait_download(ctx, None, path, timeout)
        return Result({"path": saved, "waited": "download"}, f"✓ Downloaded to {saved}")
    if not options and args and re.fullmatch(r"\d+(\.\d+)?", args[0]):
        ms = float(args[0])
        await asyncio.sleep(ms / 1000)
        return Result({"ms": int(ms), "waited": "timeout"})
    page = await ctx.state.page()
    if options.get("text") is not None:
        wanted = options["text"]
        await wait_until(lambda: page.call("(t) => !!document.body && document.body.innerText.includes(t)", wanted, frame=page.main_frame, read=True), timeout, 0.1, f"text {wanted!r}")
        return Result({"text": wanted, "waited": "text"}, wanted)
    if options.get("url") is not None:
        pattern = options["url"]

        async def url_matches():
            await page.refresh_frames()
            return glob_match(pattern, page.url)

        await wait_until(url_matches, timeout, 0.1, f"the URL to match {pattern}")
        return Result({"url": page.url, "waited": "url"}, page.url)
    if options.get("load") is not None:
        until = options["load"]
        if until not in ("load", "domcontentloaded", "networkidle"):
            raise Usage("--load takes load, domcontentloaded or networkidle")
        await page.refresh_frames()
        await wait_for_load(page, page.loader(page.main_frame), timeout, until)
        return Result({"state": until})
    if options.get("fn") is not None:
        expression = options["fn"]

        async def truthy():
            value = await evaluate_main(page, expression)
            return {"value": value} if value else None

        result = await wait_until(truthy, timeout, 0.1, f"{expression} to be truthy")
        return Result({"result": result["value"]}, json.dumps(result["value"], ensure_ascii=False, indent=2))
    need(args, 1, "wait <selector|ms> | --text | --url | --load | --fn")
    selector = args[0]
    wanted_state = options.get("state") or "visible"

    async def selector_state():
        ref = parse_ref(selector)
        try:
            if ref:
                found_page, element = await ctx.state.resolve_ref(ref)
            else:
                found_page, element = await ctx.state.locate(selector, page)
        except BrowseError as error:
            if error.code in ("not_found", "stale_ref"):
                return wanted_state in ("hidden", "detached")
            raise
        if wanted_state == "attached":
            return True
        if wanted_state == "detached":
            return False
        visible = await found_page.call("(el) => ardiaBrowse.visible(el)", element, frame=element.frame)
        return visible if wanted_state == "visible" else not visible

    await wait_until(selector_state, timeout, 0.1, f"{selector} to be {wanted_state}")
    return Result({"selector": selector, "waited": "selector"})


def glob_match(pattern: str, url: str) -> bool:
    if pattern == url or pattern in url and "*" not in pattern:
        return True
    regex = ""
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if pattern.startswith("**", index):
            regex += ".*"
            index += 2
            continue
        regex += "[^/]*" if char == "*" else ("." if char == "?" else re.escape(char))
        index += 1
    return re.fullmatch(regex, url) is not None


async def evaluate_main(page, expression: str):
    result = await page.send("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True, "userGesture": False}, timeout=60, mutation=True)
    if "exceptionDetails" in result:
        details = result["exceptionDetails"]
        description = (details.get("exception") or {}).get("description") or details.get("text") or "error"
        raise BrowseError(f"Evaluation error: {description}")
    remote = result.get("result") or {}
    if remote.get("type") == "undefined":
        return None
    if "value" in remote:
        return remote["value"]
    return remote.get("unserializableValue") or remote.get("description")


@command("eval")
async def cmd_eval(ctx: Ctx, argv):
    options, args = parse(argv, {"--base64": "bool", "--stdin": "bool"}, {"-b": "--base64"})
    if options.get("stdin"):
        script = ctx.stdin or ""
    else:
        need(args, 1, "eval <js> | -b <base64> | --stdin")
        script = " ".join(args)
        if options.get("base64"):
            script = base64.b64decode(script).decode("utf-8")
    page = await ctx.state.page()
    if FETCHING.search(script):
        hint_once(ctx.state, "fetch", FETCH_HINT)
    value = await evaluate_main(page, script)
    origin = page.frames.get(page.main_frame, {}).get("origin") or ""
    return Result({"origin": origin + "/" if origin and not origin.endswith("/") else origin, "result": value}, json.dumps(value, ensure_ascii=False, indent=2), page_content=True)


@command("get")
async def cmd_get(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "get text|html|value|attr|title|url|count|box|styles|cdp-url [selector]")
    what = args[0]
    if what == "cdp-url":
        await ctx.state.connect()
        url = ctx.state.endpoint.ws
        from urllib.parse import urlsplit

        parts = urlsplit(url)
        if not ctx.state.endpoint.explicit or parts.query or parts.username or parts.password or "token" in url.lower():
            raise BrowseError("This CDP URL carries a control token, so ardia browse never prints it; drive the page with ardia browse commands (`eval` for JavaScript)")
        return Result({"cdpUrl": url}, url)
    page = await ctx.state.page()
    if what == "title":
        title = await page_title(page)
        return Result({"title": title}, title, page_content=True)
    if what == "url":
        await page.refresh_frames()
        return Result({"url": page.url}, page.url)
    if what == "count":
        need(args, 2, "get count <selector>")
        frame = ctx.state.frame_for(page) or page.main_frame
        count = await page.call("(s) => ardiaBrowse.queryAll(s).length", args[1], frame=frame, read=True)
        return Result({"count": count, "selector": args[1]}, str(count))
    need(args, 2, f"get {what} <selector>")
    page, element = await resolve(ctx, args[1])
    origin = page.frames.get(element.frame, {}).get("origin") or ""
    origin = origin + "/" if origin and not origin.endswith("/") else origin
    if what == "text":
        value = await page.call("(el) => (el.innerText != null ? el.innerText : el.textContent || '').trim()", element, frame=element.frame)
        return Result({"origin": origin, "text": value}, value, page_content=True)
    if what == "html":
        value = await page.call("(el) => el.innerHTML", element, frame=element.frame)
        return Result({"origin": origin, "html": value}, value, page_content=True)
    if what == "value":
        value = await page.call("(el) => 'value' in el ? el.value : (el.isContentEditable ? el.innerText : null)", element, frame=element.frame)
        return Result({"value": value}, "" if value is None else str(value), page_content=True)
    if what == "attr":
        need(args, 3, "get attr <selector> <name>")
        value = await page.call("(el, n) => el.getAttribute(n)", element, args[2], frame=element.frame)
        return Result({"attribute": args[2], "value": value}, "" if value is None else value, page_content=True)
    if what == "box":
        from ardia_cli.browse.actions import frame_offset, rect

        box = await rect(page, element)
        ox, oy = await frame_offset(page, element.frame)
        box = {"x": box["x"] + ox, "y": box["y"] + oy, "width": box["width"], "height": box["height"]}
        box = {key: (int(value) if float(value).is_integer() else value) for key, value in box.items()}
        text = "\n".join(f"{key + ':':<8}{box[key]}" for key in ("x", "y", "width", "height"))
        return Result(box, text)
    if what == "styles":
        styles = await page.call("(el) => ardiaBrowse.styles(el)", element, frame=element.frame)
        return Result({"styles": styles}, "\n".join(f"{key}: {value}" for key, value in styles.items()))
    raise Usage(f"Unknown get subcommand: {what}")


@command("is")
async def cmd_is(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "is visible|enabled|checked <selector>")
    what = args[0]
    page, element = await resolve(ctx, args[1])
    origin = page.frames.get(element.frame, {}).get("origin") or ""
    if what == "visible":
        value = await page.call("(el) => ardiaBrowse.visible(el)", element, frame=element.frame)
    elif what in ("enabled", "checked"):
        info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
        value = not info["disabled"] if what == "enabled" else info["checked"]
    else:
        raise Usage(f"Unknown is subcommand: {what} (visible, enabled, checked)")
    return Result({"origin": origin + "/" if origin else origin, what: bool(value)}, "true" if value else "false")


FIND_ACTIONS = ("click", "fill", "type", "check", "uncheck", "select", "hover", "focus", "dblclick", "text")
FIND_LOCATORS = ("role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth")
MAX_CANDIDATES = 8
BATCH_DEFAULT_CAP = 6000
SHOWN_HOLD = 0.3
FIND_WAIT = 1.5


def find_arguments(args: list[str], name: str | None) -> tuple[str, list[str], str | None]:
    locator, args = args[0], list(args[1:])
    if "=" in locator and locator.split("=", 1)[0] in FIND_LOCATORS:
        locator, first = locator.split("=", 1)
        args.insert(0, first)
    if locator == "role" and args and args[0] in FIND_ACTIONS and len(args) > 1 and args[1] not in FIND_ACTIONS:
        args[0], args[1] = args[1], args[0]
    if locator == "role" and name is None and len(args) >= 2 and args[1] not in FIND_ACTIONS:
        name = args.pop(1)
    return locator, args, name


@command("find")
async def cmd_find(ctx: Ctx, argv):
    options, args = parse(argv, {"--name": "value", "--exact": "bool", "--no-humanize": "bool"})
    need(args, 1, "find <locator> <value> [action] [text]")
    locator, args, wanted_name = find_arguments(args, options.get("name"))
    need(args, 1, "find <locator> <value> [action] [text]")
    page = await ctx.state.page()
    frame = ctx.state.frame_for(page) or page.main_frame
    exact = bool(options.get("exact"))
    if locator == "nth":
        need(args, 2, "find nth <index> <selector> [action] [text]")
        index, value, rest = int(args[0]), args[1], args[2:]
    else:
        value, rest = args[0], args[1:]

    async def locate():
        element, role, name = None, "", ""
        if locator == "role":
            element, role, name = await find_role(ctx, page, frame, value, wanted_name, exact)
        elif locator == "text":
            element = await page.element_from(await page.call("(t, e) => ardiaBrowse.findText(t, e)", value, exact, frame=frame, by_value=False, read=True), frame, f"text={value}")
        elif locator == "label":
            element = await page.element_from(await page.call("(t, e) => ardiaBrowse.findLabel(t, e)", value, exact, frame=frame, by_value=False, read=True), frame, f"label={value}")
        elif locator in ("placeholder", "alt", "title"):
            element = await page.element_from(await page.call("(a, t, e) => ardiaBrowse.findAttr(a, t, e)", locator, value, exact, frame=frame, by_value=False, read=True), frame, f"{locator}={value}")
        elif locator == "testid":
            element = await page.element_from(await page.call("(t) => ardiaBrowse.findAttr('data-testid', t, true)", value, frame=frame, by_value=False, read=True), frame, f"testid={value}")
        elif locator in ("first", "last", "nth"):
            position = {"first": 0, "last": -1}.get(locator, index if locator == "nth" else 0)
            remote = await page.call("(s, i) => { const all = ardiaBrowse.queryAll(s); return all.at(i) || null; }", value, position, frame=frame, by_value=False, read=True)
            element = await page.element_from(remote, frame, f"{locator} {value}")
        else:
            raise Usage(f"Unknown locator: {locator} (role, text, label, placeholder, alt, title, testid, first, last, nth)")
        if element is None:
            raise BrowseError(f"Element not found: {locator} {value}", code="not_found")
        return element, role, name

    loop = asyncio.get_running_loop()
    deadline = loop.time() + FIND_WAIT
    while True:
        try:
            element, role, name = await locate()
            break
        except BrowseError as error:
            if error.code != "not_found" or loop.time() >= deadline:
                raise
        await asyncio.sleep(0.15)
    action = rest[0] if rest else "click"
    if action not in FIND_ACTIONS:
        raise Usage(f"Unknown action '{action}' for find. Valid actions: {', '.join(FIND_ACTIONS)}.")
    ref = ctx.state.add_ref(page, element, role, name)
    element.label = f"@{ref}"
    humanize = ctx.humanize and not options.get("no_humanize")
    if action == "click":
        _, report = await changes.observe(ctx, page, lambda: actions.click(page, element, humanize))
        return changes.attach(Result({"clicked": f"@{ref}"}), report)
    if action == "dblclick":
        _, report = await changes.observe(ctx, page, lambda: actions.click(page, element, humanize, 2))
        return changes.attach(Result({"clicked": f"@{ref}", "count": 2}), report)
    if action == "fill":
        text = " ".join(rest[1:])
        (retargeted, stored), report = await changes.observe(ctx, page, lambda: actions.fill(page, element, text, humanize))
        return changes.attach(filled_result("filled", f"@{ref}", retargeted, text, stored), report)
    if action == "type":
        retargeted, report = await changes.observe(ctx, page, lambda: actions.type_text(page, element, " ".join(rest[1:]), humanize))
        return changes.attach(typed_result("typed", f"@{ref}", retargeted), report)
    if action in ("check", "uncheck"):
        _, report = await changes.observe(ctx, page, lambda: actions.set_checked(page, element, action == "check", humanize))
        return changes.attach(Result({action + "ed": f"@{ref}"}), report)
    if action == "select":
        return await select_in(ctx, page, element, f"@{ref}", rest[1:], humanize)
    if action == "hover":
        _, report = await changes.observe(ctx, page, lambda: actions.hover(page, element, humanize))
        return changes.attach(Result({"hovered": f"@{ref}"}), report)
    if action == "focus":
        _, report = await changes.observe(ctx, page, lambda: page.focus_element(element))
        return changes.attach(Result({"focused": f"@{ref}"}), report)
    text = await page.call("(el) => (el.innerText != null ? el.innerText : el.textContent || '').trim()", element, frame=element.frame)
    return Result({"ref": f"@{ref}", "text": text}, text, page_content=True)


def plain(text: str) -> str:
    return " ".join(str(text or "").split()).casefold()


def role_candidates(nodes: list, role: str, name: str | None, exact: bool) -> tuple[list, str]:
    wanted = snapshot.ROLE_NAMES.get(role, role).lower()
    of_role = []
    for node in nodes:
        if node.get("ignored") or node.get("backendDOMNodeId") is None:
            continue
        node_role = str((node.get("role") or {}).get("value") or "")
        if snapshot.ROLE_NAMES.get(node_role, node_role).lower() == wanted:
            of_role.append((node, " ".join(str((node.get("name") or {}).get("value") or "").split())))
    if name is None:
        return of_role, "role"
    target = plain(name.removesuffix("…"))
    if name.endswith("…"):
        starting = [item for item in of_role if plain(item[1]).startswith(target)]
        if starting:
            return starting, "partial"
    same = [item for item in of_role if (item[1] == " ".join(name.split()) if exact else plain(item[1]) == target)]
    if same or exact:
        return same, "exact"
    return [item for item in of_role if target in plain(item[1])], "partial"


async def find_role(ctx, page, frame, role, name, exact):
    tree = await page.send("Accessibility.getFullAXTree", {"frameId": frame}, timeout=60)
    nodes = tree.get("nodes") or []
    found, how = role_candidates(nodes, role, name, exact)
    shown = snapshot.ROLE_NAMES.get(role, role)
    resolved = []
    for node, node_name in found[:MAX_CANDIDATES + 1]:
        element = await page.resolve_backend(node["backendDOMNodeId"], frame, f"role={role}")
        if element is not None:
            resolved.append((element, node_name))
    if len(resolved) == 1 or (resolved and name is None):
        element, node_name = resolved[0]
        return element, shown, node_name
    if not resolved:
        close = list(dict.fromkeys(node_name for _, node_name in role_candidates(nodes, role, None, False)[0] if node_name))[:MAX_CANDIDATES]
        named = f' named "{name}"' if name is not None else ""
        hint = f"; the {shown}s here are: " + ", ".join(f'"{snapshot.shown_name(text)}"' for text in close) if close and name is not None else ""
        raise BrowseError(f"No {shown}{named} on this page{hint}", data={"candidates": close}, code="not_found")
    listed = []
    for element, node_name in resolved[:MAX_CANDIDATES]:
        listed.append({"ref": "@" + ctx.state.add_ref(page, element, shown, node_name), "name": node_name})
    more = f" (and {len(found) - MAX_CANDIDATES} more)" if len(found) > MAX_CANDIDATES else ""
    kind = "are named exactly" if how == "exact" else "have names containing"
    fix = "Use one of their refs" if how == "exact" else "Use a ref, or the full name"
    lines = "\n".join(f'  {shown} "{snapshot.shown_name(item["name"])}" [ref={item["ref"][1:]}]' for item in listed)
    raise BrowseError(
        f'{len(found)} {shown}s {kind} "{name}"{more}, so nothing was clicked. {fix}:\n{lines}',
        data={"candidates": listed}, code="ambiguous",
    )


@command("tab")
async def cmd_tab(ctx: Ctx, argv):
    options, args = parse(argv, {"--label": "value", "--show": "bool"})
    state = ctx.state
    await state.connect()
    action = args[0] if args else "list"
    if action == "list":
        from ardia_cli.browse import tabs as tab_registry

        await state.refresh_targets()
        tabs = state.describe_tabs(await tab_registry.app_tab_map(state))
        return Result({"tabs": tabs}, "\n".join(tab_line(tab, state.session) for tab in tabs) or "No tabs")
    if action == "new":
        page = await new_tab(ctx, args[1] if len(args) > 1 else None, options.get("label"), show=wants_show(ctx, options))
        return Result({"tabId": state.tab_id(page.target_id), "targetId": page.target_id, "url": page.url}, page.url or "about:blank")
    if action == "close":
        await state.refresh_targets()
        target_id = await state.find_tab(args[1]) if len(args) > 1 else state.current
        if target_id is None:
            raise BrowseError("This session has no current tab to close")
        if target_id not in state.opened:
            raise BrowseError(f"Tab [{state.tab_id(target_id)}] is one of the user's tabs; ardia browse only closes tabs this session opened")
        if not state.registry.reserve_close(state.instance, target_id):
            users = state.registry.others(state.instance)[1].get(target_id) or ["another session"]
            raise BrowseError(f"Tab [{state.tab_id(target_id)}] is in use by session {', '.join(users)}, so it stays open", code="tab_in_use")
        tab = state.tab_id(target_id)
        try:
            await state.browser.send("Target.closeTarget", {"targetId": target_id})
        finally:
            state.registry.finish_close(state.instance, target_id)
        state.forget_target(target_id)
        return Result({"closed": tab, "targetId": target_id}, f"✓ Tab [{tab}] closed")
    if action == "active":
        target_id = await user_active_tab(state)
        if not target_id:
            raise BrowseError("The user isn't on a web page right now (New Tab or another Ardia view)")
        action = target_id
    await state.refresh_targets()
    target_id = await state.find_tab(action)
    state.current = target_id
    state.extras.pop("attached", None)
    if state.pin_tab:
        state.extras["pinned_target"] = target_id
    page = await state.page(target_id)
    if wants_show(ctx, options):
        await show_tab(ctx, page)
    title = await page_title(page)
    from ardia_cli.browse import tabs as tab_registry

    await tab_registry.app_tab_map(state)
    data = {"tabId": state.tab_id(target_id), "appTabId": state.app_tabs.get(target_id), "targetId": target_id, "title": title, "url": page.url}
    return Result(data, f"✓ {title}\n  {page.url}")


def tab_line(tab: dict, session: str) -> str:
    notes = []
    if tab.get("openedBy"):
        notes.append("opened by this session" if tab["openedBySession"] else f"opened by session {tab['openedBy']}")
    users = [user for user in tab.get("usedBy") or [] if user != tab.get("openedBy")]
    if users:
        notes.append(f"in use by session {', '.join(users)}")
    app = f" {tab['appTabId']} " if tab.get("appTabId") else ""
    extra = f" ({'; '.join(notes)})" if notes else ""
    return f"{'→' if tab['active'] else ' '} [{tab['tabId']}]{app} {tab['title'] or tab['url']} - {tab['url']}{extra}"


async def user_active_tab(state):
    endpoint = state.endpoint
    if not endpoint or not endpoint.active:
        raise BrowseError("`tab active` needs the token path (Ardia's own control server), not --port or --ws")
    import urllib.request

    def fetch():
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with direct.open(endpoint.active, timeout=3) as response:
            return json.loads(response.read(64 * 1024))

    answer = await asyncio.to_thread(fetch)
    return answer.get("targetId") if isinstance(answer, dict) else None


@command("window")
async def cmd_window(ctx: Ctx, argv):
    _, args = parse(argv)
    if not args or args[0] != "new":
        raise Usage("Usage: ardia browse window new [url]")
    page = await new_tab(ctx, args[1] if len(args) > 1 else None, window=True)
    return Result({"tabId": ctx.state.tab_id(page.target_id), "url": page.url}, page.url or "about:blank")


@command("frame")
async def cmd_frame(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "frame <selector|@ref|name|url|main>")
    page = await ctx.state.page()
    await page.refresh_frames()
    target = args[0]
    if target == "main":
        ctx.state.frames.pop(page.target_id, None)
        return Result({"frame": "main"})
    frame_id = None
    for frame in page.frames.values():
        if frame["parent"] and (frame["name"] == target or frame["url"] == target or (target in frame["url"] and len(target) > 3)):
            frame_id = frame["id"]
            break
    if frame_id is None:
        page, element = await resolve(ctx, target)
        described = await page.send("DOM.describeNode", {"backendNodeId": element.backend_id})
        frame_id = (described.get("node") or {}).get("frameId")
        if not frame_id or frame_id not in page.frames:
            raise BrowseError(f"{target} isn't an iframe this tab can reach (ardia browse doesn't attach cross-process iframes)")
    ctx.state.frames[page.target_id] = frame_id
    return Result({"frame": frame_id, "url": page.frames[frame_id]["url"]})


@command("dialog")
async def cmd_dialog(ctx: Ctx, argv):
    _, args = parse(argv)
    action = args[0] if args else "status"
    page = await ctx.state.page()
    dialog = page.dialog
    if action == "status":
        if not dialog:
            return Result({"hasDialog": False}, "✓ No dialog is currently open")
        return Result({"hasDialog": True, "type": dialog.get("type"), "message": dialog.get("message"), "defaultPrompt": dialog.get("defaultPrompt")},
                      f"Dialog open: {dialog.get('type')} {json.dumps(dialog.get('message', ''), ensure_ascii=False)}", page_content=True)
    if action not in ("accept", "dismiss"):
        raise Usage("Usage: ardia browse dialog accept [text] | dismiss | status")
    if not dialog:
        raise BrowseError("No dialog is currently open")
    params = {"accept": action == "accept"}
    if action == "accept" and len(args) > 1:
        params["promptText"] = " ".join(args[1:])
    await page.send("Page.handleJavaScriptDialog", params)
    page.dialog = None
    return Result({"handled": action})


@command("storage")
async def cmd_storage(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "storage local|session [get [key] | set <key> <value> | clear | remove <key>]")
    kind = args[0]
    if kind not in ("local", "session"):
        raise Usage("storage takes local or session")
    rest = args[1:]
    op = rest[0] if rest and rest[0] in ("get", "set", "clear", "remove") else "get"
    if rest and rest[0] in ("get", "set", "clear", "remove"):
        rest = rest[1:]
    page = await ctx.state.page()
    if op != "get":
        refuse_on_borrowed(ctx, page, f"{op} the {kind} storage of")
    frame = ctx.state.frame_for(page) or page.main_frame
    if op == "set":
        need(rest, 2, f"storage {kind} set <key> <value>")
        await page.call("(k, o, key, v) => ardiaBrowse.storage(k, o, key, v)", kind, "set", rest[0], " ".join(rest[1:]), frame=frame)
        return Result({"set": rest[0]})
    if op in ("clear", "remove"):
        await page.call("(k, o, key) => ardiaBrowse.storage(k, o, key)", kind, op, rest[0] if rest else None, frame=frame)
        return Result({op: True}, "✓ Storage cleared" if op == "clear" else "✓ Done")
    data = await page.call("(k, o, key) => ardiaBrowse.storage(k, o, key)", kind, "get", rest[0] if rest else None, frame=frame, read=True)
    text = "\n".join(f"{key}: {value}" for key, value in data.items()) or "(empty)"
    return Result({"data": data}, text, page_content=True)


@command("cookies")
async def cmd_cookies(ctx: Ctx, argv):
    options, args = parse(argv, {"--url": "value", "--domain": "value", "--path": "value", "--httpOnly": "bool", "--secure": "bool",
                                 "--sameSite": "value", "--expires": "value", "--curl": "value"})
    action = args[0] if args else "get"
    page = await ctx.state.page()
    if action != "get":
        refuse_on_borrowed(ctx, page, f"{action} cookies through")
    try:
        if action == "get":
            cookies = (await page.send("Network.getCookies", {"urls": [page.url]} if page.url.startswith("http") else {})).get("cookies") or []
            return Result({"cookies": cookies}, "\n".join(f"{c['name']}={c['value']}" for c in cookies) or "(no cookies)", page_content=True)
        if action == "clear":
            await page.send("Network.clearBrowserCookies")
            return Result({"cleared": True}, "✓ Cookies cleared")
        if action == "set":
            if options.get("curl"):
                cookies = parse_cookie_file(Path(ctx.path(options["curl"])).read_text(encoding="utf-8"))
                domain = options.get("domain")
                for name, value in cookies:
                    params = {"name": name, "value": value}
                    params.update({"domain": domain} if domain else {"url": page.url})
                    await page.send("Network.setCookie", params)
                return Result({"set": len(cookies)}, f"✓ Set {len(cookies)} cookies")
            need(args, 3, "cookies set <name> <value> [--url|--domain|--path|--httpOnly|--secure|--sameSite|--expires]")
            params = {"name": args[1], "value": args[2]}
            for key in ("url", "domain", "path"):
                if options.get(key):
                    params[key] = options[key]
            if not any(key in params for key in ("url", "domain")):
                params["url"] = page.url
            if options.get("httpOnly"):
                params["httpOnly"] = True
            if options.get("secure"):
                params["secure"] = True
            if options.get("sameSite"):
                params["sameSite"] = options["sameSite"].capitalize()
            if options.get("expires"):
                params["expires"] = float(options["expires"])
            result = await page.send("Network.setCookie", params)
            if result.get("success") is False:
                raise BrowseError("The browser refused that cookie")
            return Result({"set": args[1]})
    except Gated as error:
        raise error.during(f"cookies {action}") from None
    raise Usage(f"Unknown cookies operation: {action} (get, set, clear)")


def parse_cookie_file(text: str) -> list[tuple[str, str]]:
    text = text.strip()
    if text.startswith("["):
        return [(item["name"], str(item["value"])) for item in json.loads(text)]
    match = re.search(r"(?:-b|--cookie)\s+(['\"])(.*?)\1", text, re.S) or re.search(r"-H\s+(['\"])cookie:\s*(.*?)\1", text, re.I | re.S)
    header = match.group(2) if match else re.sub(r"^cookie:\s*", "", text, flags=re.I)
    pairs = []
    for part in header.split(";"):
        if "=" in part:
            name, value = part.strip().split("=", 1)
            pairs.append((name.strip(), value.strip()))
    if not pairs:
        raise BrowseError("No cookies found in that file (JSON array, cURL command or Cookie header)")
    return pairs


DEVICES = {
    "iphone 14": (390, 844, 3, True, "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"),
    "iphone 15 pro": (393, 852, 3, True, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    "iphone 12": (390, 844, 3, True, "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"),
    "pixel 7": (412, 915, 2.625, True, "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"),
    "ipad pro 11": (834, 1194, 2, True, "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"),
    "desktop": (1280, 800, 1, False, None),
}


@command("set")
async def cmd_set(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "set viewport|device|geo|offline|headers|credentials|media ...")
    setting = ALIASES.get(args[0], args[0])
    page = await ctx.state.page()
    refuse_on_borrowed(ctx, page, f"change the {setting} of")
    try:
        if setting == "viewport":
            need(args, 3, "set viewport <w> <h> [scale]")
            width, height = int(args[1]), int(args[2])
            scale = float(args[3]) if len(args) > 3 else 1.0
            await page.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
            ctx.state.leases.add("emulation")
            from ardia_cli import command_metrics

            command_metrics.flag("viewport_set", True)
            return Result({"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
        if setting == "device":
            need(args, 2, "set device <name>")
            device = DEVICES.get(" ".join(args[1:]).lower())
            if device is None:
                raise BrowseError(f"Unknown device: {' '.join(args[1:])} ({', '.join(sorted(DEVICES))})")
            width, height, scale, mobile, agent = device
            await page.send("Emulation.setTouchEmulationEnabled", {"enabled": mobile})
            await page.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": mobile})
            if agent:
                await page.send("Emulation.setUserAgentOverride", {"userAgent": agent})
            ctx.state.leases.add("emulation")
            return Result({"device": " ".join(args[1:]), "width": width, "height": height})
        if setting == "geo":
            need(args, 3, "set geo <lat> <lng>")
            await page.send("Emulation.setGeolocationOverride", {"latitude": float(args[1]), "longitude": float(args[2]), "accuracy": 10})
            ctx.state.leases.add("emulation")
            return Result({"latitude": float(args[1]), "longitude": float(args[2])})
        if setting == "offline":
            offline = (args[1] if len(args) > 1 else "on").lower() in ("on", "true", "1")
            await page.enable_network()
            await page.send("Network.emulateNetworkConditions", {"offline": offline, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
            ctx.state.leases.add("emulation")
            return Result({"offline": offline})
        if setting == "headers":
            need(args, 2, "set headers <json>")
            headers = json.loads(" ".join(args[1:]))
            await page.enable_network()
            await page.send("Network.setExtraHTTPHeaders", {"headers": headers})
            ctx.state.leases.add("emulation")
            return Result({"headers": sorted(headers)})
        if setting in ("credentials", "auth"):
            need(args, 3, "set credentials <user> <pass>")
            from ardia_cli.browse import capture

            await capture.enable_credentials(ctx, page, args[1], args[2])
            return Result({"username": args[1]})
        if setting == "media":
            features = []
            scheme = next((value for value in args[1:] if value in ("dark", "light", "no-preference")), None)
            if scheme:
                features.append({"name": "prefers-color-scheme", "value": scheme})
            if "reduced-motion" in args[1:]:
                features.append({"name": "prefers-reduced-motion", "value": "reduce"})
            await page.send("Emulation.setEmulatedMedia", {"features": features})
            ctx.state.leases.add("emulation")
            return Result({"features": features})
    except Gated as error:
        if error.reason == "on a tab the user can see":
            from ardia_cli import command_metrics

            command_metrics.flag("viewport_tab_taken", True)
        raise error.during(f"set {setting}", error.data.get("detail") if error.data else None) from None
    raise Usage(f"Unknown setting: {setting}")


@command("state")
async def cmd_state(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "state save|load <path>")
    page = await ctx.state.page()
    if args[0] != "save":
        refuse_on_borrowed(ctx, page, "load cookies and storage into")
    path = ctx.path(args[1])
    try:
        if args[0] == "save":
            cookies = (await page.send("Network.getAllCookies")).get("cookies") or []
            local = await page.call("() => ardiaBrowse.storage('local', 'get')", frame=page.main_frame, read=True)
            origin = page.frames.get(page.main_frame, {}).get("origin")
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"cookies": cookies, "origins": [{"origin": origin, "localStorage": [{"name": k, "value": v} for k, v in local.items()]}]}, handle, indent=2)
            return Result({"path": args[1]}, f"✓ State saved to {args[1]}")
        if args[0] == "load":
            saved = json.loads(Path(path).read_text(encoding="utf-8"))
            if saved.get("cookies"):
                await page.send("Network.setCookies", {"cookies": saved["cookies"]})
            origin = page.frames.get(page.main_frame, {}).get("origin")
            for entry in saved.get("origins") or []:
                if entry.get("origin") == origin:
                    for item in entry.get("localStorage") or []:
                        await page.call("(k, v) => ardiaBrowse.storage('local', 'set', k, v)", item["name"], item["value"], frame=page.main_frame)
            return Result({"path": args[1]}, f"✓ State loaded from {args[1]}")
    except Gated as error:
        raise error.during(f"state {args[0]}") from None
    raise Usage("Usage: ardia browse state save|load <path>")


async def wait_download(ctx: Ctx, trigger, destination: str | None, timeout: float) -> str:
    import tempfile

    await ctx.state.connect()
    folder = os.path.dirname(destination) if destination else tempfile.mkdtemp(prefix="ardia-browse-download-")
    try:
        await ctx.state.browser.send("Browser.setDownloadBehavior", {"behavior": "allowAndName", "downloadPath": folder, "eventsEnabled": True})
    except Gated as error:
        raise error.during("download" if trigger else "wait --download") from None
    done = asyncio.get_running_loop().create_future()
    seen = {}

    def listener(_page, method, params):
        if method == "Browser.downloadWillBegin" and not seen:
            seen.update(guid=params.get("guid"), name=params.get("suggestedFilename") or "download")
        if method == "Browser.downloadProgress" and params.get("guid") == seen.get("guid") and params.get("state") in ("completed", "canceled") and not done.done():
            done.set_result(params.get("state"))

    ctx.state.listeners.append(listener)
    try:
        if trigger is not None:
            await trigger()
        outcome = await asyncio.wait_for(done, timeout)
    except asyncio.TimeoutError:
        raise BrowseError(f"No download finished in {timeout:g}s", code="timeout") from None
    finally:
        ctx.state.listeners.remove(listener)
        try:
            await ctx.state.browser.send("Browser.setDownloadBehavior", {"behavior": "default"})
        except BrowseError:
            pass
    if outcome != "completed":
        raise BrowseError("The download was canceled")
    target = destination or os.path.join(folder, os.path.basename(seen["name"]))
    os.replace(os.path.join(folder, seen["guid"]), target)
    return target


@command("download")
async def cmd_download(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "download <selector> <path>")
    page, element = await resolve(ctx, args[0])
    await wait_download(ctx, lambda: actions.click(page, element, ctx.humanize), ctx.path(args[1]), ctx.timeout)
    return Result({"path": args[1]}, f"✓ Downloaded to {args[1]}")


@command("highlight")
async def cmd_highlight(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "highlight <selector>")
    page, element = await resolve(ctx, args[0])
    try:
        await page.send("DOM.enable")
        await page.send("Overlay.enable")
        await page.send("Overlay.highlightNode", {"backendNodeId": element.backend_id, "highlightConfig": {
            "contentColor": {"r": 111, "g": 168, "b": 220, "a": 0.66}, "borderColor": {"r": 255, "g": 0, "b": 0, "a": 1}, "showInfo": True}})
    except Gated as error:
        raise error.during("highlight") from None
    return Result({"highlighted": args[0]})


@command("clipboard")
async def cmd_clipboard(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "clipboard read|write <text>|copy|paste")
    page = await ctx.state.page()
    action = args[0]
    try:
        if action in ("copy", "paste"):
            command_name = "copy" if action == "copy" else "paste"
            await page.send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "Meta", "code": "MetaLeft", "windowsVirtualKeyCode": 91, "modifiers": 4})
            try:
                await page.send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": "c" if action == "copy" else "v", "modifiers": 4, "commands": [command_name]})
            finally:
                await page.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Meta", "code": "MetaLeft", "windowsVirtualKeyCode": 91})
            return Result({action: True})
        origin = page.frames.get(page.main_frame, {}).get("origin")
        await ctx.state.browser.send("Browser.grantPermissions", {"origin": origin, "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
        if action == "read":
            text = await evaluate_main(page, "navigator.clipboard.readText()")
            return Result({"text": text}, text, page_content=True)
        if action == "write":
            need(args, 2, "clipboard write <text>")
            await page.call("(t) => navigator.clipboard.writeText(t)", " ".join(args[1:]), frame=page.main_frame)
            return Result({"written": True})
    except Gated as error:
        detail = f"the {action} editing command" if action in ("copy", "paste") else None
        raise error.during(f"clipboard {action}", detail) from None
    raise Usage(f"Unknown clipboard operation: {action}")


@command("addinitscript")
async def cmd_addinitscript(ctx: Ctx, argv):
    options, args = parse(argv, {"--stdin": "bool"})
    source = ctx.stdin if options.get("stdin") else " ".join(args)
    if not source:
        raise Usage("Usage: ardia browse addinitscript <js> | --stdin")
    page = await ctx.state.page()
    refuse_on_borrowed(ctx, page, "add a script to")
    identifier = await add_init_script(ctx, page, source, None)
    return Result({"identifier": identifier}, identifier)


@command("removeinitscript")
async def cmd_removeinitscript(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 1, "removeinitscript <id>")
    page = await ctx.state.page()
    if args[0] not in page.init_scripts:
        raise BrowseError(f"No init script {args[0]} in this tab")
    await page.send("Page.removeScriptToEvaluateOnNewDocument", {"identifier": args[0]})
    page.init_scripts.pop(args[0], None)
    ctx.state.extras.get("init_sources", {}).pop(args[0], None)
    if not any(p.init_scripts for p in ctx.state.pages.values()):
        ctx.state.leases.discard("init")
    return Result({"removed": args[0]})


@command("read")
async def cmd_read(ctx: Ctx, argv):
    from ardia_cli.browse import readpages, readurl

    options, args = parse(argv, readpages.flags(), readpages.ALIASES)
    if readpages.scrolls(options):
        return await readpages.run_scroll(ctx, options, args)
    if readpages.single_fetch(options, args):
        return await asyncio.to_thread(readurl.run, args[0], options, ctx.options)
    if readpages.wants_pages(options, args):
        return await readpages.run(ctx, options, args)
    if options.get("llms") or options.get("require_md") or options.get("http"):
        page = await ctx.state.page()
        return readurl.run(page.url, options, ctx.options)
    page = await ctx.state.page()
    frame = ctx.state.frame_for(page) or page.main_frame
    selector = options.get("selector")
    if selector:
        content = await page.call("(s) => ardiaBrowse.queryAll(s).map((el) => ardiaBrowse.readable(el)).filter(Boolean).join('\\n\\n')",
                                  selector, frame=frame, read=True)
    else:
        content = await page.call("() => ardiaBrowse.readable()", frame=frame, read=True)
    content = readurl.post_process(content, options)
    readpages.note_virtualized(content)
    return Result({"content": content, "contentType": "text/html", "finalUrl": page.url, "source": "active-tab-html", "truncated": False, "url": page.url},
                  content, page_content=True)


@command("script")
async def cmd_script(ctx: Ctx, argv):
    from ardia_cli.browse import script

    options, _ = parse(argv, {"--timeout": "value", "--stdin": "bool"})
    return await script.run(ctx, ctx.stdin or "", script.parse_timeout(options.get("timeout")))


@command("vitals")
async def cmd_vitals(ctx: Ctx, argv):
    _, args = parse(argv)
    page = await current_or_new(ctx) if args else await ctx.state.page()
    if args:
        await navigate(ctx, page, normalize_url(args[0]))
    data = await page.call("() => ardiaBrowse.vitals()", frame=page.main_frame, read=True)
    from ardia_cli.browse import react

    data["hydration"] = await react.hydration(page) if "react" in page.init_scripts.values() else None

    def ms(value):
        return "-" if value is None else (f"{value:.1f}ms" if value < 10 else f"{value:.0f}ms")

    hydration = data["hydration"] or {}
    text = "\n".join([
        f"url: {data['url']}",
        f"ttfb: {ms(data['ttfb'])}  fcp: {ms(data['fcp'])}  lcp: {ms(data['lcp'])}  cls: {round(data['cls'], 4):g}  inp: {ms(data['inp'])}",
        f"lcp: element: {data['lcpElement'] or '-'}",
        f"hydration: {ms(hydration.get('duration'))}  phases: {hydration.get('phases', 0)}  hydratedComponents: {hydration.get('components', 0)}",
    ])
    return Result(data, text)


@command("diff")
async def cmd_diff(ctx: Ctx, argv):
    from ardia_cli.browse import media

    _, args = parse(argv[:1])
    need(args, 1, "diff snapshot|screenshot|url ...")
    kind = args[0]
    rest = argv[1:]
    if kind == "snapshot":
        options, _ = parse(rest, {"--baseline": "value", "--selector": "value", "--compact": "bool", "--depth": "value", "--interactive": "bool"},
                           {"-b": "--baseline", "-s": "--selector", "-c": "--compact", "-d": "--depth", "-i": "--interactive"})
        before = Path(ctx.path(options["baseline"])).read_text(encoding="utf-8") if options.get("baseline") else (ctx.state.last_snapshot or "")
        page = await ctx.state.page()
        after, _ = await snapshot.take(ctx.state, page, bool(options.get("interactive")), bool(options.get("compact")),
                                       int(options["depth"]) if options.get("depth") else None, options.get("selector"))
        return diff_result(before, after)
    if kind == "screenshot":
        return await media.diff_screenshot(ctx, rest)
    if kind == "url":
        options, positional = parse(rest, {"--screenshot": "bool", "--full": "bool", "--wait-until": "value", "--selector": "value", "--compact": "bool", "--depth": "value"},
                                    {"-s": "--selector", "-c": "--compact", "-d": "--depth"})
        need(positional, 2, "diff url <url1> <url2>")
        page = await current_or_new(ctx)
        shots = []
        texts = []
        for url in positional[:2]:
            await navigate(ctx, page, normalize_url(url), options.get("wait_until") or "load")
            text, _ = await snapshot.take(ctx.state, page, False, bool(options.get("compact")), int(options["depth"]) if options.get("depth") else None, options.get("selector"))
            texts.append(text)
            if options.get("screenshot"):
                shots.append(await media.capture_png(page, bool(options.get("full"))))
        result = diff_result(texts[0], texts[1])
        if shots:
            result.data["screenshot"] = media.compare_pngs(shots[0], shots[1], 0.1, None)
        return result
    raise Usage(f"Unknown diff kind: {kind} (snapshot, screenshot, url)")


def diff_result(before: str, after: str) -> Result:
    lines = list(difflib.unified_diff(before.splitlines(), after.splitlines(), "before", "after", lineterm=""))
    additions = sum(1 for line in lines if line.startswith("+") and not line.startswith("+++"))
    removals = sum(1 for line in lines if line.startswith("-") and not line.startswith("---"))
    unchanged = len(before.splitlines()) - removals if before else 0
    text = "\n".join(lines)
    return Result({"diff": text, "additions": additions, "removals": removals, "unchanged": max(unchanged, 0), "changed": bool(lines)},
                  text or "No changes", page_content=True)


@command("session")
async def cmd_session(ctx: Ctx, argv):
    _, args = parse(argv, {"--json": "bool"})
    if args and args[0] == "info":
        state = ctx.state
        return Result({
            "session": state.session,
            "connected": state.connected,
            "tabs": len(state.opened),
            "current": state.tab_id(state.current) if state.current else None,
            "refs": len(state.refs),
            "captures": sorted(state.leases),
        })
    return Result({"session": ctx.state.session}, ctx.state.session)


@command("batch")
async def cmd_batch(ctx: Ctx, argv):
    options, args = parse(argv, {"--bail": "bool"})
    lines = args if args else [line for line in (ctx.stdin or "").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    runs = []
    for line in lines:
        line = line.strip()
        argv_item = json.loads(line) if line.startswith("[") else shlex.split(line)
        if not isinstance(argv_item, list) or not all(isinstance(item, str) for item in argv_item):
            raise Usage(f"A batch command must be a JSON array of strings or a command line: {line}")
        runs.append(argv_item)
    from ardia_cli.browse.daemon import run_one

    names = [ALIASES.get(item[0], item[0]) if item else "" for item in runs]
    closing = bool(names) and names[-1] == "close" and not runs[-1][1:] and "close" not in names[:-1]
    if closing:
        runs.pop()
    batch_extras(ctx).pop("close_after_batch", None)
    outcomes = []
    for index, item in enumerate(runs):
        name = ALIASES.get(item[0], item[0]) if item else ""
        if name in ("batch", "close"):
            why = "batch can't run inside batch" if name == "batch" else (
                "close ends this session, so in a batch it only runs as the last line; to close this session's tab and go on, use `tab close`")
            outcomes.append({"command": item, "success": False, "result": None, "error": why})
            if options.get("bail"):
                break
            continue
        try:
            command, line_options = batch_line_options(item)
        except Usage as error:
            outcomes.append({"command": item, "success": False, "result": None, "error": error.message, "code": error.code})
            if options.get("bail"):
                break
            continue
        if line_options.pop("full", False):
            ctx.options["full"] = True
        wider = line_options.pop("max_output", None)
        if wider is not None:
            current = ctx.options.get("max_output")
            current = BATCH_DEFAULT_CAP if current is None else int(current)
            ctx.options["max_output"] = 0 if 0 in (current, wider) else max(current, wider)
        result, error = await run_one(ctx, command, line_options)
        failed = error is None and bool(getattr(result, "failed", False))
        outcome = {"command": item, "success": error is None and not failed, "result": result.data if result else None,
                   "error": error.message if error else ("the command reported a failure" if failed else None), "text": result.text if result else None}
        if error is not None and error.code:
            outcome["code"] = error.code
        outcomes.append(outcome)
        if isinstance(error, (OutcomeUnknown, ConnectionLost)):
            outcomes.extend({"command": rest, "success": False, "result": None, "error": "not run: an earlier command's outcome is unknown",
                             "code": "not_run", "text": None} for rest in runs[index + 1:])
            break
        if not outcome["success"] and options.get("bail"):
            break
    if closing:
        if len(outcomes) == len(runs) and all(outcome["success"] for outcome in outcomes):
            batch_extras(ctx)["close_after_batch"] = True
        else:
            outcomes.append({"command": ["close"], "success": False, "result": None, "code": "not_run", "text": None,
                             "error": "close not run: an earlier line failed or didn't run, so the session stays open"})
    text = "\n\n".join((outcome["text"] if outcome["success"] or outcome.get("text") else f"✗ {outcome['error']}") or "" for outcome in outcomes)
    for outcome in outcomes:
        outcome.pop("text", None)
    result = Result({"results": outcomes}, text)
    result.batch = outcomes
    if any(not outcome["success"] for outcome in outcomes):
        result.failed = True
    return result


FETCHING = re.compile(r"\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+DOMParser\b|\bwindow\.open\s*\(")
FETCH_HINT = ("→ tip: to read other pages, `ardia browse read <url> <url>…` (or `read --links <pattern>` for this page's links) reads "
              "them in one call, through your logins and after their scripts run; `ardia browse script` loops over pages with clicks and fills")
PAGE_BY_PAGE_HINT = ("→ tip: reading page after page? `ardia browse read <url> <url>…` reads many in one call (`read --links <pattern>` "
                     "takes every matching link on this page), and `ardia browse script` loops over pages that need clicks")
PAGE_BY_PAGE = 3


def hint_once(state, key: str, text: str):
    hinted = state.extras.setdefault("hinted", set())
    if key in hinted:
        return
    hinted.add(key)
    state.extras["notice"] = "\n".join(part for part in (state.extras.get("notice"), text) if part)


def reads_page(name: str, argv: list[str]) -> bool:
    if name == "get":
        return bool(argv) and argv[0] in ("text", "html")
    return name == "read" and not [arg for arg in argv if not arg.startswith("-")]


def note_reading(state, name: str, argv: list[str], result) -> None:
    streak = state.extras.setdefault("page_reads", {"pages": 0, "arrived": False})
    navigated = ((getattr(result, "data", None) or {}).get("changes") or {}).get("document") == "new"
    if name in ("open", "back", "forward") and (name != "open" or [arg for arg in argv if not arg.startswith("-")]) or navigated:
        streak["arrived"] = True
        return
    if reads_page(name, argv):
        if streak["arrived"]:
            streak["pages"] += 1
            streak["arrived"] = False
            if streak["pages"] >= PAGE_BY_PAGE:
                hint_once(state, "page_by_page", PAGE_BY_PAGE_HINT)
        return
    if name not in ("wait", "notes", "tab", "get", "is", "screenshot", "snapshot", "eval"):
        streak.update(pages=0, arrived=False)


LINE_OPTIONS = {"full": "full", "max_output": "max_output", "no_changes": "no_changes", "no_text": "no_text", "humanize": "humanize", "show": "show",
                "annotate": "annotate", "capture_console": "capture_console"}


def batch_extras(ctx) -> dict:
    extras = getattr(ctx.state, "extras", None)
    return extras if isinstance(extras, dict) else {}


def batch_line_options(item: list[str]) -> tuple[list[str], dict]:
    from ardia_cli.browse import cli as browse_cli

    found, rest = browse_cli.split_globals(item)
    unusable = sorted(f"--{key.replace('_', '-')}" for key in found if key not in LINE_OPTIONS and key not in ("no_humanize", "json"))
    if unusable:
        raise Usage(f"{', '.join(unusable)} applies to the whole session, so it goes on the `batch` command, not a line inside it")
    line = {LINE_OPTIONS[key]: value for key, value in found.items() if key in LINE_OPTIONS}
    if found.get("no_humanize"):
        line["humanize"] = False
    if line.get("max_output") is not None:
        try:
            line["max_output"] = int(line["max_output"])
        except ValueError:
            raise Usage(f"--max-output takes a number of characters, not {line['max_output']}") from None
    return rest, line


def boundary(text: str) -> str:
    nonce = secrets.token_hex(4)
    return f"<<<PAGE_CONTENT {nonce}>>>\n{text}\n<<<END_PAGE_CONTENT {nonce}>>>"


SKIPPED = {
    "connect": "ardia browse always drives the running Ardia (pick the endpoint with --data-dir, --port or --ws)",
    "inspect": "opening DevTools on the user's tab isn't something the ardia command does",
    "install": "Ardia is the browser; there's nothing to install",
    "upgrade": "Ardia updates the ardia command itself",
    "doctor": "run `ardia browse session info` instead",
    "dashboard": "not part of ardia browse",
    "chat": "Ardia has no AI features, by the owner's decision",
    "mcp": "not part of ardia browse",
    "profiles": "ardia browse never reads browser profiles",
    "confirm": "action confirmation (--confirm-actions) isn't part of ardia browse",
    "deny": "action confirmation (--confirm-actions) isn't part of ardia browse",
    "swipe": "iOS isn't supported",
    "tap": "iOS isn't supported",
    "device": "iOS isn't supported",
    "skills": "use `ardia skills install`",
}
