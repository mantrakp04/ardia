import asyncio
import base64
import json
import re
import secrets
import signal
import time
from dataclasses import dataclass, field
from pathlib import Path

from ardia_cli import identity
from ardia_cli.cdp import Cdp, CdpError, ConnectionLost
from ardia_cli.endpoint import NOT_REACHABLE, Endpoint, EndpointError
from ardia_cli.redact import redact
from ardia_cli import urlmatch
from ardia_cli.userscript import SOURCE_URL_PREFIX, Build, SourceMap, rules

CONNECT_TIMEOUT = 10
RUN_TIMEOUT = 30
LOAD_GRACE = 10
CLEANUP_TIMEOUT = 5
EXPECT_POLL = 0.1
MAX_PAGE_ERRORS = 5
MAX_TEXT = 2000
LEVELS = {"warning": "warn", "startGroup": "group", "startGroupCollapsed": "groupCollapsed", "endGroup": "groupEnd"}

MATCHER = urlmatch.JS
PRELUDE = """\
(() => {{
const mark = {mark};
const rules = {rules};
const debug = console.debug.bind(console);
const href = location.href;
const top = window.top === window;
const verdict = ({matcher})(rules, href);
if (rules.noframes && !top) {{ debug(mark, "skip", href, top, "@noframes"); return; }}
if (verdict !== "run") {{ debug(mark, "skip", href, top, verdict); return; }}
const run = () => {{
debug(mark, "start", href, top, "");
try {{
"""
POSTLUDE = """\
}} finally {{
debug(mark, "done", href, top, "");
}}
}};
const afterDomReady = (next) => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", next, {{ once: true }}) : next();
const idle = () => {{
let ran = false;
const go = () => {{ if (!ran) {{ ran = true; run(); }} }};
if (document.readyState === "complete") go();
else {{ window.addEventListener("load", go, {{ once: true }}); setTimeout(go, 200); }}
}};
if (rules.runAt === "document-start") run();
else if (rules.runAt === "document-end") afterDomReady(run);
else afterDomReady(idle);
}})();
//# sourceURL={source_url}
"""


@dataclass
class Report:
    script: str
    url: str
    final_url: str | None = None
    run_at: str = ""
    frames: list = field(default_factory=list)
    console: list = field(default_factory=list)
    exceptions: list = field(default_factory=list)
    page_errors: list = field(default_factory=list)
    page_console: int = 0
    expect: dict | None = None
    screenshot: str | None = None
    warnings: list = field(default_factory=list)
    error: str | None = None
    kept: str | None = None

    @property
    def ran(self) -> bool:
        return any(frame["state"] in ("start", "done") for frame in self.frames)

    @property
    def unsettled(self) -> int:
        starts = sum(1 for frame in self.frames if frame["state"] == "start")
        dones = sum(1 for frame in self.frames if frame["state"] == "done")
        return max(0, starts - dones)

    @property
    def ok(self) -> bool:
        if self.error or not self.ran or self.exceptions or self.unsettled:
            return False
        return self.expect is None or (not self.expect.get("error") and bool(self.expect.get("truthy")))

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "ran": self.ran,
            "unfinished_passes": self.unsettled,
            "script": self.script,
            "url": self.url,
            "final_url": self.final_url,
            "run_at": self.run_at,
            "frames": self.frames,
            "console": self.console,
            "exceptions": self.exceptions,
            "page_errors": self.page_errors,
            "page_console_messages": self.page_console,
            "expect": self.expect,
            "screenshot": self.screenshot,
            "warnings": self.warnings,
            "error": self.error,
            "kept_target": self.kept,
        }


def wrap(build: Build, mark: str) -> tuple[str, str, int]:
    source_url = f"{SOURCE_URL_PREFIX}{build.meta.id}.user.js"
    head = PRELUDE.format(mark=json.dumps(mark), rules=json.dumps(rules(build.meta)), matcher=MATCHER)
    body = build.js if build.js.endswith("\n") else build.js + "\n"
    tail = POSTLUDE.format(source_url=source_url)
    return head + body + tail, source_url, head.count("\n")


class Run:
    def __init__(self, build: Build, url: str, report: Report):
        self.build = build
        self.url = url
        self.report = report
        self.mark = secrets.token_hex(12)
        self.source, self.source_url, offset = wrap(build, self.mark)
        self.map = SourceMap(build.sourcemap, offset)
        self.body = range(offset, offset + build.js.count("\n") + (0 if build.js.endswith("\n") else 1))
        self.location = re.compile(re.escape(self.source_url) + r":(\d+):(\d+)")
        self.top_session: str | None = None
        self.top_settled = asyncio.Event()
        self.loaded = asyncio.Event()
        self.children: set[asyncio.Task] = set()
        self.cdp: Cdp | None = None

    def mapped(self, line: int, column: int) -> str:
        if line not in self.body:
            return f"{identity.COMMAND} test wrapper"
        found = self.map.lookup(line, column)
        if found:
            return f"{found[0]}:{found[1]}:{found[2]}"
        return f"{self.build.path.name} (compiled):{line - self.body.start + 1}:{column + 1}"

    def map_text(self, text: str) -> str:
        return self.location.sub(lambda m: self.mapped(int(m.group(1)) - 1, int(m.group(2)) - 1), text)

    def ours(self, frames: list) -> dict | None:
        return next((frame for frame in frames if frame.get("url") == self.source_url), None)

    def on_event(self, method: str, params: dict, session: str | None):
        if method == "Runtime.consoleAPICalled":
            self.on_console(params, session)
        elif method == "Runtime.exceptionThrown":
            self.on_exception(params.get("exceptionDetails") or {}, session)
        elif method == "Page.loadEventFired" and session == self.top_session:
            self.loaded.set()
        elif method == "Target.attachedToTarget" and session and params.get("sessionId") and params["sessionId"] != self.top_session:
            task = asyncio.ensure_future(self.setup_child(params["sessionId"], bool(params.get("waitingForDebugger"))))
            self.children.add(task)
            task.add_done_callback(self.children.discard)

    def on_console(self, params: dict, session: str | None):
        args = params.get("args") or []
        if args and args[0].get("value") == self.mark:
            values = [arg.get("value") for arg in args[1:5]]
            state, href, top, detail = (values + [None] * 4)[:4]
            self.report.frames.append({"url": href, "top": bool(top), "state": state, "detail": detail or None})
            if top and state in ("done", "skip"):
                self.top_settled.set()
            return
        frames = (params.get("stackTrace") or {}).get("callFrames") or []
        frame = self.ours(frames)
        if frame is None:
            self.report.page_console += 1
            return
        text = " ".join(describe(arg) for arg in args)
        self.report.console.append(
            {
                "level": LEVELS.get(params.get("type", "log"), params.get("type", "log")),
                "text": clip(self.map_text(text)),
                "at": self.mapped(frame.get("lineNumber", 0), frame.get("columnNumber", 0)),
                "frame": None if session == self.top_session else "iframe",
            }
        )

    def on_exception(self, details: dict, session: str | None):
        exception = details.get("exception") or {}
        description = exception.get("description") or exception.get("value")
        text = details.get("text") or "Uncaught"
        message = f"{text} {description}" if description and text in ("Uncaught", "Uncaught (in promise)") else (description or text)
        frames = (details.get("stackTrace") or {}).get("callFrames") or []
        frame = self.ours(frames)
        ours = frame is not None or details.get("url") == self.source_url or self.source_url in str(message)
        entry = {"text": clip(self.map_text(str(message))), "frame": None if session == self.top_session else "iframe"}
        if frame is not None:
            entry["at"] = self.mapped(frame.get("lineNumber", 0), frame.get("columnNumber", 0))
        elif details.get("url") == self.source_url:
            entry["at"] = self.mapped(details.get("lineNumber", 0), details.get("columnNumber", 0))
        if ours:
            self.report.exceptions.append(entry)
        elif len(self.report.page_errors) < MAX_PAGE_ERRORS:
            self.report.page_errors.append(entry)

    async def setup_child(self, session: str, waiting: bool):
        try:
            await self.cdp.send("Runtime.enable", session=session)
            await self.cdp.send("Page.enable", session=session)
            await self.cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": self.source}, session=session)
            await self.cdp.send(
                "Target.setAutoAttach",
                {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True},
                session=session,
            )
        except (CdpError, ConnectionLost):
            pass
        finally:
            if waiting:
                try:
                    await self.cdp.send("Runtime.runIfWaitingForDebugger", session=session)
                except (CdpError, ConnectionLost):
                    pass


def describe(arg: dict) -> str:
    if arg.get("preview"):
        return preview(arg["preview"])
    if "value" in arg:
        value = arg["value"]
        return value if isinstance(value, str) else json.dumps(value)
    if "unserializableValue" in arg:
        return arg["unserializableValue"]
    if arg.get("type") == "undefined":
        return "undefined"
    return arg.get("description") or arg.get("className") or arg.get("type", "?")


def preview(data: dict) -> str:
    items = []
    for prop in data.get("properties") or []:
        value = prop.get("value", prop.get("type", "?"))
        if prop.get("type") == "string":
            value = json.dumps(value, ensure_ascii=False)
        items.append(value if data.get("subtype") == "array" else f"{prop.get('name')}: {value}")
    if data.get("overflow"):
        items.append("…")
    if data.get("subtype") == "array":
        return "[" + ", ".join(items) + "]"
    if data.get("type") == "object" and data.get("subtype") in (None, "") and data.get("description") in ("Object", None):
        return "{" + ", ".join(items) + "}"
    head = data.get("description") or data.get("type", "?")
    return f"{head} {{{', '.join(items)}}}" if items else head


def clip(text: str) -> str:
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + f"… ({len(text) - MAX_TEXT} more characters)"


async def run_test(build: Build, url: str, endpoint: Endpoint, expect: str | None, wait: float, screenshot: str | None, keep: bool) -> Report:
    report = Report(script=str(build.path), url=url, run_at=build.meta.run_at)
    report.warnings.extend(build.meta.warnings + build.warnings)
    if build.meta.world == "ISOLATED":
        report.warnings.append(
            f"@inject-into content: this test runs the script in the page's world ({identity.COMMAND} command connections can't "
            "create isolated worlds); installed, it runs in an isolated world and can't see page globals"
        )
    loop = asyncio.get_running_loop()
    main = asyncio.current_task()
    for signum in (signal.SIGTERM, signal.SIGHUP):
        loop.add_signal_handler(signum, main.cancel)
    run = Run(build, url, report)
    cdp = run.cdp = Cdp(endpoint.ws)
    try:
        await cdp.open(CONNECT_TIMEOUT)
    except Exception as error:
        if endpoint.explicit:
            raise EndpointError(redact(f"can't connect to {endpoint.source} ({error or type(error).__name__})")) from None
        raise EndpointError(NOT_REACHABLE) from None
    cdp.listeners.append(run.on_event)
    target = None
    script_id = None
    try:
        try:
            created = await cdp.send("Target.createTarget", {"url": "about:blank", "background": True})
            target = created["targetId"]
            attached = await cdp.send("Target.attachToTarget", {"targetId": target, "flatten": True})
            session = run.top_session = attached["sessionId"]
            await cdp.send("Runtime.enable", session=session)
            await cdp.send("Page.enable", session=session)
            script_id = (await cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": run.source}, session=session)).get("identifier")
            if not build.meta.noframes:
                await cdp.send("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True}, session=session)
            navigated = await cdp.send("Page.navigate", {"url": url}, session=session, timeout=RUN_TIMEOUT)
            if navigated.get("errorText"):
                report.error = f"couldn't open {url}: {navigated['errorText']}"
                return report
            await settle(run, cdp)
            if not run.top_settled.is_set():
                report.error = (
                    f"the script's first pass in the top frame didn't finish within {RUN_TIMEOUT}s (an endless loop?)"
                    if report.unsettled
                    else f"the top frame didn't run or skip the script within {RUN_TIMEOUT}s"
                )
                return report
            report.final_url = await final_url(cdp, target)
            report.expect = await listen(cdp, session, expect, wait)
            if not build.meta.noframes:
                await check_frames(cdp, session, report)
            if screenshot:
                report.screenshot = await capture(cdp, session, screenshot, report)
        except ConnectionLost:
            raise EndpointError(NOT_REACHABLE if not endpoint.explicit else redact(f"lost the connection to {endpoint.source}")) from None
        except CdpError as error:
            report.error = redact(str(error))
        return report
    finally:
        await cleanup(cdp, run, target, script_id, keep, report)


async def settle(run: Run, cdp: Cdp):
    started = time.monotonic()
    lost = asyncio.ensure_future(cdp.closed.wait())
    settled = asyncio.ensure_future(run.top_settled.wait())
    try:
        await asyncio.wait({lost, settled}, timeout=RUN_TIMEOUT, return_when=asyncio.FIRST_COMPLETED)
        if cdp.closed.is_set():
            raise ConnectionLost()
        if not run.top_settled.is_set():
            return
        remaining = max(0.0, min(LOAD_GRACE, RUN_TIMEOUT - (time.monotonic() - started)))
        loaded = asyncio.ensure_future(run.loaded.wait())
        try:
            await asyncio.wait({lost, loaded}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
        finally:
            loaded.cancel()
        if cdp.closed.is_set():
            raise ConnectionLost()
    finally:
        for task in (lost, settled):
            task.cancel()


async def check_frames(cdp: Cdp, session: str, report: Report):
    counted = await evaluate_plain(cdp, session, 'document.querySelectorAll("iframe, frame").length')
    frames = counted if isinstance(counted, int) else 0
    reported = sum(1 for frame in report.frames if not frame["top"] and frame["state"] in ("done", "skip"))
    if frames > reported:
        report.warnings.append(
            f"{frames - reported} of the page's {frames} iframes never reported back: they hadn't loaded, or they show "
            f"an extension's or the browser's own page, which {identity.PRODUCT}'s control connection never reaches (a --port test "
            "server does)"
        )


async def sleep_or_lost(cdp: Cdp, seconds: float):
    try:
        await asyncio.wait_for(cdp.closed.wait(), seconds)
    except asyncio.TimeoutError:
        return
    raise ConnectionLost()


async def final_url(cdp: Cdp, target: str) -> str | None:
    try:
        info = await cdp.send("Target.getTargetInfo", {"targetId": target})
    except CdpError:
        return None
    return (info.get("targetInfo") or {}).get("url")


EXPECT_WRAPPER = """(async () => {{
const value = await (
{expression}
);
let shown;
if (value === undefined) shown = {{ undefined: true }};
else if (value === null || ["string", "number", "boolean"].includes(typeof value)) shown = {{ value }};
else if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") shown = {{ value: String(value) }};
else {{
try {{ shown = {{ value: JSON.parse(JSON.stringify(value)) }}; }} catch {{ shown = {{ value: Object.prototype.toString.call(value) }}; }}
if (typeof Node !== "undefined" && value instanceof Node) shown = {{ value: value.nodeName ? `<${{value.nodeName.toLowerCase()}}>` : String(value) }};
}}
return {{ truthy: Boolean(value), ...shown }};
}})()"""


async def evaluate(cdp: Cdp, session: str, expression: str) -> dict:
    result = await cdp.send(
        "Runtime.evaluate",
        {"expression": EXPECT_WRAPPER.format(expression=expression), "returnByValue": True, "awaitPromise": True, "userGesture": False},
        session=session,
    )
    if "exceptionDetails" in result:
        details = result["exceptionDetails"]
        exception = details.get("exception") or {}
        return {"error": clip(exception.get("description") or details.get("text") or "threw")}
    value = (result.get("result") or {}).get("value")
    if not isinstance(value, dict):
        return {"error": "the expression's value couldn't be read"}
    return {"truthy": bool(value.get("truthy")), "value": value.get("value"), **({"undefined": True} if value.get("undefined") else {})}


async def evaluate_plain(cdp: Cdp, session: str, expression: str):
    result = await cdp.send("Runtime.evaluate", {"expression": expression, "returnByValue": True}, session=session)
    return (result.get("result") or {}).get("value")


async def listen(cdp: Cdp, session: str, expression: str | None, wait: float) -> dict | None:
    deadline = time.monotonic() + max(wait, 0)
    outcome = None
    while expression is not None:
        outcome = await evaluate(cdp, session, expression)
        outcome["expression"] = expression
        if (not outcome.get("error") and outcome.get("truthy")) or time.monotonic() >= deadline:
            break
        await sleep_or_lost(cdp, EXPECT_POLL)
    remaining = deadline - time.monotonic()
    if remaining > 0:
        await sleep_or_lost(cdp, remaining)
    return outcome


async def capture(cdp: Cdp, session: str, path: str, report: Report) -> str | None:
    try:
        shot = await cdp.send("Page.captureScreenshot", {"format": "png"}, session=session, timeout=10)
        target = Path(path).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(shot["data"]))
        return str(target)
    except (CdpError, OSError, KeyError, ValueError) as error:
        report.warnings.append(f"no screenshot: {error}")
        return None


async def cleanup(cdp: Cdp, run: Run, target: str | None, script_id: str | None, keep: bool, report: Report):
    async def steps():
        for task in list(run.children):
            task.cancel()
        if target and keep:
            report.kept = target
            return
        if script_id and run.top_session:
            try:
                await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {"identifier": script_id}, session=run.top_session, timeout=CLEANUP_TIMEOUT)
            except (CdpError, ConnectionLost):
                pass
        if target:
            try:
                await cdp.send("Target.closeTarget", {"targetId": target}, timeout=CLEANUP_TIMEOUT)
            except (CdpError, ConnectionLost):
                pass

    try:
        await asyncio.wait_for(steps(), CLEANUP_TIMEOUT * 2)
    except (asyncio.TimeoutError, Exception):
        pass
    await cdp.close()


def format_report(report: Report) -> str:
    lines = [f"warning: {warning}" for warning in report.warnings]
    lines.append(f"url: {report.final_url or report.url}")
    top = [frame for frame in report.frames if frame["top"]]
    sub = [frame for frame in report.frames if not frame["top"]]
    if top:
        last = top[-1]
        if last["state"] == "skip":
            lines.append(f"top frame: skipped ({last['detail']})")
        elif last["state"] == "start":
            lines.append(f"top frame: ran at {report.run_at}, but its first pass never finished")
        else:
            lines.append(f"top frame: ran at {report.run_at}")
    elif not report.error:
        lines.append("top frame: the script never ran")
    if sub:
        ran = sum(1 for frame in sub if frame["state"] == "done")
        skipped = sum(1 for frame in sub if frame["state"] == "skip")
        lines.append(f"iframes: ran in {ran}, skipped {skipped}")
    for entry in report.console:
        where = f"  ({entry['at']}{', iframe' if entry['frame'] else ''})"
        lines.append(f"console.{entry['level']}: {entry['text']}{where}")
    for entry in report.exceptions:
        where = f"  ({entry['at']})" if entry.get("at") and entry["at"] not in entry["text"] else ""
        lines.append(f"exception{' in iframe' if entry['frame'] else ''}: {entry['text']}{where}")
    for entry in report.page_errors:
        first = entry["text"].splitlines()[0] if entry["text"] else ""
        lines.append(f"page error (not from the script): {first}")
    if report.expect is not None:
        if report.expect.get("error"):
            lines.append(f"expect: {report.expect['expression']} threw {report.expect['error']}")
        else:
            value = "undefined" if report.expect.get("undefined") else json.dumps(report.expect.get("value"), ensure_ascii=False)
            verdict = "truthy" if report.expect.get("truthy") else "falsy"
            lines.append(f"expect: {report.expect['expression']} -> {clip(value)} ({verdict})")
    if report.screenshot:
        lines.append(f"screenshot: {report.screenshot}")
    if report.kept:
        lines.append(f"kept the tab open (target {report.kept})")
    lines.append("ok" if report.ok else f"failed: {failure(report)}")
    return redact("\n".join(lines))


def failure(report: Report) -> str:
    if report.error:
        return report.error
    if not report.ran:
        return "the script didn't run on this page"
    if report.exceptions:
        return f"{len(report.exceptions)} uncaught exception{'s' if len(report.exceptions) > 1 else ''}"
    if report.unsettled:
        return "the script's first pass never finished in some frame (an endless loop?)"
    return "--expect wasn't truthy"
