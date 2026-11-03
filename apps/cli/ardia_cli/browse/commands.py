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

from ardia_cli.browse import actions, snapshot
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
    "find", "auth", "pushstate", "eval", "dialog", "batch", "storage", "cookies", "set", "state", "clipboard", "close",
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
        return self.options.get("humanize", True)

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


async def text_of(page, expression: str):
    return await page.call(f"() => ({expression})", frame=page.main_frame, read=True)


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
            except BrowseError:
                return False
            frame_loader = page.loader(main)
            if loader is not None and frame_loader != loader:
                return False
            return state == "complete" or (event == "DOMContentLoaded" and state == "interactive")
        return False

    await wait_until(ready, timeout, 0.05, f"the page to reach {until}")


async def navigate(ctx: Ctx, page, url: str, until: str = "load"):
    try:
        result = await page.send("Page.navigate", {"url": url}, timeout=ctx.timeout)
    except Gated:
        raise BrowseError(f"Ardia's policy only lets the ardia command open web pages (http, https, data, about:blank); {url} isn't one") from None
    if result.get("errorText"):
        raise BrowseError(f"Navigation to {url} failed: {result['errorText']}")
    loader = result.get("loaderId")
    if loader:
        await wait_for_load(page, loader, ctx.timeout, until)
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
    except Gated:
        raise BrowseError("Ardia's policy refused to open a tab for the ardia command") from None
    target_id = result["targetId"]
    state.opened.add(target_id)
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
    while True:
        if loop.time() >= nudge:
            await ctx.state.browser.send("Target.activateTarget", {"targetId": page.target_id})
            nudge = loop.time() + 1
        if not await page.hidden():
            return
        if loop.time() >= deadline:
            raise BrowseError("Ardia didn't show the tab; switch to it in Ardia, or try `ardia browse tab <id> --show` again")
        await asyncio.sleep(0.1)


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


async def current_or_new(ctx: Ctx):
    state = ctx.state
    await state.connect()
    if state.current and state.current in state.target_infos:
        return await state.page()
    return await new_tab(ctx, None)


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
    if state.current and state.current in state.target_infos:
        page = await state.page()
        await apply_open_options(ctx, page)
        if url:
            await navigate(ctx, page, url)
        if wants_show(ctx, options):
            await show_tab(ctx, page)
    else:
        page = await new_tab(ctx, url, options.get("label"), show=wants_show(ctx, options))
    await page.refresh_frames()
    title = await page_title(page)
    return Result({"url": page.url, "title": title}, f"✓ {title}\n  {page.url}")


@command("back", "forward")
async def cmd_history(ctx: Ctx, argv):
    page = await ctx.state.page()
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
    url = await page.call("(u) => ardiaBrowse.pushState(u)", args[0], frame=page.main_frame)
    page.url = url
    return Result({"url": url}, url)


@command("snapshot")
async def cmd_snapshot(ctx: Ctx, argv):
    options, args = parse(
        argv,
        {"--interactive": "bool", "--compact": "bool", "--depth": "value", "--selector": "value", "--urls": "bool", "--cursor": "bool"},
        {"-i": "--interactive", "-c": "--compact", "-d": "--depth", "-s": "--selector", "-u": "--urls", "-C": "--cursor"},
    )
    selector = options.get("selector") or (args[0] if args else None)
    page = await ctx.state.page()
    depth = int(options["depth"]) if options.get("depth") is not None else None
    text, _ = await snapshot.take(ctx.state, page, bool(options.get("interactive")), bool(options.get("compact")), depth, selector, bool(options.get("urls")))
    origin = page.frames.get(page.main_frame, {}).get("origin") or page.url
    data = {"origin": origin if origin.endswith("/") else origin + "/", "refs": ctx.state.refs_json(), "snapshot": text}
    return Result(data, text or "(empty page)", page_content=True)


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
    await actions.click(page, element, humanize, 1, options.get("button") or "left")
    return Result({"clicked": args[0]})


@command("dblclick")
async def cmd_dblclick(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "dblclick <selector>")
    page, element = await resolve(ctx, args[0])
    await actions.click(page, element, ctx.humanize and not options.get("no_humanize"), 2)
    return Result({"clicked": args[0], "count": 2})


@command("hover")
async def cmd_hover(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "hover <selector>")
    page, element = await resolve(ctx, args[0])
    await actions.hover(page, element, ctx.humanize and not options.get("no_humanize"))
    return Result({"hovered": args[0]})


@command("focus")
async def cmd_focus(ctx: Ctx, argv):
    _, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "focus <selector>")
    page, element = await resolve(ctx, args[0])
    await page.focus_element(element)
    return Result({"focused": args[0]})


@command("fill")
async def cmd_fill(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "fill <selector> <text>")
    page, element = await resolve(ctx, args[0])
    retargeted = await actions.fill(page, element, " ".join(args[1:]), ctx.humanize and not options.get("no_humanize"))
    return typed_result("filled", args[0], retargeted)


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
    retargeted = await actions.type_text(page, element, " ".join(args[1:]), ctx.humanize and not options.get("no_humanize"))
    return typed_result("typed", args[0], retargeted)


@command("press")
async def cmd_press(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, "press <key>")
    page = await ctx.state.page()
    humanize = ctx.humanize and not options.get("no_humanize")
    frame = ctx.state.frame_for(page) or page.main_frame
    await actions.expect_input(page, frame, lambda: page.input.gesture("press", lambda: page.input.press_combo(args[0], humanize)),
                               {"keydown": 1}, "The key press")
    return Result({"pressed": args[0]})


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
        await actions.expect_input(page, frame, lambda: page.input.gesture("keyboard inserttext", lambda: page.send("Input.insertText", {"text": text}, input_event=True)),
                                   {"beforeinput|input": 1} if text else {}, "The text insert")
        return Result({"inserted": True})
    if args[0] != "type":
        raise Usage(f"Unknown keyboard subcommand: {args[0]} (type or inserttext)")
    keyboard = page.input.keyboard()
    humanize = ctx.humanize and not options.get("no_humanize")
    frame = ctx.state.frame_for(page) or page.main_frame
    await actions.expect_input(page, frame, lambda: page.input.gesture("keyboard type", lambda: keyboard.type_text(text, humanize=humanize)),
                               {"keydown": len(text)}, "The typing")
    return Result({"typed": True})


@command("check", "uncheck")
async def cmd_check(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 1, f"{ctx.command} <selector>")
    page, element = await resolve(ctx, args[0])
    wanted = ctx.command == "check"
    await actions.set_checked(page, element, wanted, ctx.humanize and not options.get("no_humanize"))
    return Result({"checked" if wanted else "unchecked": args[0]})


@command("select")
async def cmd_select(ctx: Ctx, argv):
    _, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "select <selector> <value...>")
    page, element = await resolve(ctx, args[0])
    await actions.select(page, element, args[1:])
    return Result({"selected": args[1:]})


@command("drag")
async def cmd_drag(ctx: Ctx, argv):
    options, args = parse(argv, {"--no-humanize": "bool"})
    need(args, 2, "drag <source> <target>")
    page, source = await resolve(ctx, args[0])
    target_page, target = await resolve(ctx, args[1])
    if target_page is not page:
        raise BrowseError("Both ends of a drag must be in the same tab")
    await actions.drag(page, source, target, ctx.humanize and not options.get("no_humanize"))
    return Result({"dragged": args[0], "to": args[1]})


@command("upload")
async def cmd_upload(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "upload <selector> <files...>")
    files = [ctx.path(item) for item in args[1:]]
    for item in files:
        if not os.path.isfile(item):
            raise BrowseError(f"No such file: {item}")
    page, element = await resolve(ctx, args[0])
    try:
        await page.send("DOM.setFileInputFiles", {"files": files, "backendNodeId": element.backend_id})
    except Gated:
        raise Gated("DOM.setFileInputFiles", "upload") from None
    return Result({"uploaded": files})


@command("scroll")
async def cmd_scroll(ctx: Ctx, argv):
    options, args = parse(argv, {"--selector": "value", "--no-humanize": "bool"}, {"-s": "--selector"})
    direction = args[0] if args else "down"
    amount = float(args[1]) if len(args) > 1 else actions.SCROLL_DEFAULT
    page = await ctx.state.page()
    element = None
    if options.get("selector"):
        page, element = await resolve(ctx, options["selector"])
    await actions.scroll(page, direction, amount, ctx.humanize and not options.get("no_humanize"), element)
    return Result({"scrolled": True})


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
            raise BrowseError("This CDP URL carries a control token, so ardia browse never prints it; use `ardia exec` to drive the browser from Python")
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


FIND_ACTIONS = ("click", "fill", "type", "check", "uncheck", "hover", "focus", "dblclick", "text")


@command("find")
async def cmd_find(ctx: Ctx, argv):
    options, args = parse(argv, {"--name": "value", "--exact": "bool", "--no-humanize": "bool"})
    need(args, 2, "find <locator> <value> [action] [text]")
    locator = args[0]
    page = await ctx.state.page()
    frame = ctx.state.frame_for(page) or page.main_frame
    exact = bool(options.get("exact"))
    if locator == "nth":
        need(args, 3, "find nth <index> <selector> [action] [text]")
        index, value, rest = int(args[1]), args[2], args[3:]
    else:
        value, rest = args[1], args[2:]
    element = None
    role = ""
    name = ""
    if locator == "role":
        element, role, name = await find_role(page, frame, value, options.get("name"), exact)
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
    action = rest[0] if rest else "click"
    if action not in FIND_ACTIONS:
        raise Usage(f"Unknown action '{action}' for find. Valid actions: {', '.join(FIND_ACTIONS)}.")
    ref = ctx.state.add_ref(page, element, role, name)
    element.label = f"@{ref}"
    humanize = ctx.humanize and not options.get("no_humanize")
    if action == "click":
        await actions.click(page, element, humanize)
        return Result({"clicked": f"@{ref}"})
    if action == "dblclick":
        await actions.click(page, element, humanize, 2)
        return Result({"clicked": f"@{ref}", "count": 2})
    if action == "fill":
        retargeted = await actions.fill(page, element, " ".join(rest[1:]), humanize)
        return typed_result("filled", f"@{ref}", retargeted)
    if action == "type":
        retargeted = await actions.type_text(page, element, " ".join(rest[1:]), humanize)
        return typed_result("typed", f"@{ref}", retargeted)
    if action in ("check", "uncheck"):
        await actions.set_checked(page, element, action == "check", humanize)
        return Result({action + "ed": f"@{ref}"})
    if action == "hover":
        await actions.hover(page, element, humanize)
        return Result({"hovered": f"@{ref}"})
    if action == "focus":
        await page.focus_element(element)
        return Result({"focused": f"@{ref}"})
    text = await page.call("(el) => (el.innerText != null ? el.innerText : el.textContent || '').trim()", element, frame=element.frame)
    return Result({"ref": f"@{ref}", "text": text}, text, page_content=True)


async def find_role(page, frame, role, name, exact):
    tree = await page.send("Accessibility.getFullAXTree", {"frameId": frame}, timeout=60)
    wanted = role.lower()
    for node in tree.get("nodes") or []:
        if node.get("ignored"):
            continue
        node_role = str((node.get("role") or {}).get("value") or "")
        if node_role.lower() != wanted or node.get("backendDOMNodeId") is None:
            continue
        node_name = str((node.get("name") or {}).get("value") or "").strip()
        if name is not None:
            if exact and node_name != name:
                continue
            if not exact and name.lower() not in node_name.lower():
                continue
        element = await page.resolve_backend(node["backendDOMNodeId"], frame, f"role={role}")
        if element is not None:
            return element, node_role, node_name
    return None, role, name or ""


@command("tab")
async def cmd_tab(ctx: Ctx, argv):
    options, args = parse(argv, {"--label": "value", "--show": "bool"})
    state = ctx.state
    await state.connect()
    action = args[0] if args else "list"
    if action == "list":
        await state.refresh_targets()
        tabs = state.describe_tabs()
        lines = [f"{'→' if tab['active'] else ' '} [{tab['tabId']}] {tab['title'] or tab['url']} - {tab['url']}" for tab in tabs]
        return Result({"tabs": tabs}, "\n".join(lines) or "No tabs")
    if action == "new":
        page = await new_tab(ctx, args[1] if len(args) > 1 else None, options.get("label"), show=wants_show(ctx, options))
        return Result({"tabId": state.tab_id(page.target_id), "targetId": page.target_id, "url": page.url}, page.url or "about:blank")
    if action == "close":
        await state.refresh_targets()
        target_id = state.find_tab(args[1]) if len(args) > 1 else state.current
        if target_id is None:
            raise BrowseError("This session has no current tab to close")
        if target_id not in state.opened:
            raise BrowseError(f"Tab [{state.tab_id(target_id)}] is one of the user's tabs; ardia browse only closes tabs this session opened")
        tab = state.tab_id(target_id)
        await state.browser.send("Target.closeTarget", {"targetId": target_id})
        state.forget_target(target_id)
        return Result({"closed": tab, "targetId": target_id}, f"✓ Tab [{tab}] closed")
    if action == "active":
        target_id = await user_active_tab(state)
        if not target_id:
            raise BrowseError("The user isn't on a web page right now (New Tab or another Ardia view)")
        action = target_id
    await state.refresh_targets()
    target_id = state.find_tab(action)
    state.current = target_id
    if state.pin_tab:
        state.extras["pinned_target"] = target_id
    page = await state.page(target_id)
    if wants_show(ctx, options):
        await show_tab(ctx, page)
    title = await page_title(page)
    return Result({"tabId": state.tab_id(target_id), "targetId": target_id, "title": title, "url": page.url}, f"✓ {title}\n  {page.url}")


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
            raise BrowseError(f"{target} isn't an iframe this tab can reach (a cross-process iframe needs `ardia exec`)")
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
        raise Gated(error.method, f"cookies {action}") from None
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
    try:
        if setting == "viewport":
            need(args, 3, "set viewport <w> <h> [scale]")
            width, height = int(args[1]), int(args[2])
            scale = float(args[3]) if len(args) > 3 else 1.0
            await page.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
            ctx.state.leases.add("emulation")
            return Result({"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
        if setting == "device":
            need(args, 2, "set device <name>")
            device = DEVICES.get(" ".join(args[1:]).lower())
            if device is None:
                raise BrowseError(f"Unknown device: {' '.join(args[1:])} ({', '.join(sorted(DEVICES))})")
            width, height, scale, mobile, agent = device
            await page.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": mobile})
            await page.send("Emulation.setTouchEmulationEnabled", {"enabled": mobile})
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
        raise Gated(error.method, f"set {setting}", error.data.get("detail") if error.data else None) from None
    raise Usage(f"Unknown setting: {setting}")


@command("state")
async def cmd_state(ctx: Ctx, argv):
    _, args = parse(argv)
    need(args, 2, "state save|load <path>")
    page = await ctx.state.page()
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
        raise Gated(error.method, f"state {args[0]}") from None
    raise Usage("Usage: ardia browse state save|load <path>")


async def wait_download(ctx: Ctx, trigger, destination: str | None, timeout: float) -> str:
    import tempfile

    await ctx.state.connect()
    folder = os.path.dirname(destination) if destination else tempfile.mkdtemp(prefix="ardia-browse-download-")
    try:
        await ctx.state.browser.send("Browser.setDownloadBehavior", {"behavior": "allowAndName", "downloadPath": folder, "eventsEnabled": True})
    except Gated:
        raise Gated("Browser.setDownloadBehavior", "download" if trigger else "wait --download") from None
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
        raise Gated(error.method, "highlight") from None
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
        raise Gated(error.method, f"clipboard {action}", detail) from None
    raise Usage(f"Unknown clipboard operation: {action}")


@command("addinitscript")
async def cmd_addinitscript(ctx: Ctx, argv):
    options, args = parse(argv, {"--stdin": "bool"})
    source = ctx.stdin if options.get("stdin") else " ".join(args)
    if not source:
        raise Usage("Usage: ardia browse addinitscript <js> | --stdin")
    page = await ctx.state.page()
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
    from ardia_cli.browse import readurl

    options, args = parse(argv, readurl.FLAGS)
    if args:
        return readurl.run(args[0], options, ctx.options)
    if options.get("llms") or options.get("require_md"):
        page = await ctx.state.page()
        return readurl.run(page.url, options, ctx.options)
    page = await ctx.state.page()
    frame = ctx.state.frame_for(page) or page.main_frame
    content = await page.call("() => ardiaBrowse.readable()", frame=frame, read=True)
    content = readurl.post_process(content, options)
    return Result({"content": content, "contentType": "text/html", "finalUrl": page.url, "source": "active-tab-html", "truncated": False, "url": page.url},
                  content, page_content=True)


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
    lines = args if args else [line for line in (ctx.stdin or "").splitlines() if line.strip()]
    runs = []
    for line in lines:
        line = line.strip()
        argv_item = json.loads(line) if line.startswith("[") else shlex.split(line)
        if not isinstance(argv_item, list) or not all(isinstance(item, str) for item in argv_item):
            raise Usage(f"A batch command must be a JSON array of strings or a command line: {line}")
        runs.append(argv_item)
    from ardia_cli.browse.daemon import run_one

    outcomes = []
    for item in runs:
        name = ALIASES.get(item[0], item[0]) if item else ""
        if name in ("batch", "close"):
            outcomes.append({"command": item, "success": False, "result": None, "error": f"{name} can't run inside batch"})
            continue
        result, error = await run_one(ctx, item)
        outcome = {"command": item, "success": error is None, "result": result.data if result else None, "error": error.message if error else None,
                   "text": result.text if result else None}
        if error is not None and error.code:
            outcome["code"] = error.code
        outcomes.append(outcome)
        if isinstance(error, (OutcomeUnknown, ConnectionLost)):
            outcomes.extend({"command": rest, "success": False, "result": None, "error": "not run: an earlier command's outcome is unknown",
                             "code": "not_run", "text": None} for rest in runs[runs.index(item) + 1:])
            break
        if error is not None and options.get("bail"):
            break
    text = "\n\n".join((outcome["text"] if outcome["success"] else f"✗ {outcome['error']}") or "" for outcome in outcomes)
    for outcome in outcomes:
        outcome.pop("text", None)
    result = Result({"results": outcomes}, text)
    result.batch = outcomes
    if any(not outcome["success"] for outcome in outcomes):
        result.failed = True
    return result


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
