import asyncio
import collections
import json
import time
from dataclasses import dataclass, field

from ardia_cli.browse.errors import BrowseError, CdpError, CdpTimeout, Gated, OutcomeUnknown
from ardia_cli.browse.inputs import Input
from ardia_cli.browse.js import LIBRARY

WORLD_NAME = "ardia-browse"
CONSOLE_LIMIT = 1000
ERROR_LIMIT = 500
REQUEST_LIMIT = 1000
RECORD_TEXT_LIMIT = 64 * 1024
HEADER_VALUE_LIMIT = 8 * 1024
HEADERS_LIMIT = 64 * 1024
REQUEST_BYTES = 32 * 1024 * 1024
HIDDEN_TAB = (
    "[{tab}] is a background tab, and this Ardia doesn't deliver mouse or keyboard input to background tabs. "
    "use: ardia browse tab {tab} --show (or open <url> --show)"
)
LIVE_WAIT = 0.5
DETACHED = "Ardia detached this tab from the ardia command while it was in use (the tab closed, crashed, went to sleep or moved to a window Ardia keeps for itself). Run the command again"
CRASHED = "This tab's page crashed. `ardia browse reload` brings it back; `ardia browse close` or `tab close` closes it"
CRASH_PROBE = 5.0
CRASH_SAFE = frozenset({"Inspector.enable", "Page.reload", "Page.navigate"})
STALE_CONTEXT = ("Cannot find context", "Execution context was destroyed", "Cannot find default execution context", "Inspected target navigated")


@dataclass
class Element:
    frame: str
    object_id: str
    backend_id: int
    label: str


@dataclass
class Ring:
    limit: int
    max_bytes: int = 16 * 1024 * 1024
    items: collections.deque = field(default_factory=collections.deque)
    sizes: collections.deque = field(default_factory=collections.deque)
    dropped: int = 0
    total: int = 0

    def add(self, item):
        size = record_size(item)
        while self.items and (len(self.items) >= self.limit or self.total + size > self.max_bytes):
            self.items.popleft()
            self.total -= self.sizes.popleft()
            self.dropped += 1
        self.items.append(item)
        self.sizes.append(size)
        self.total += size

    def clear(self):
        self.items.clear()
        self.sizes.clear()
        self.total = 0
        self.dropped = 0


def record_size(item) -> int:
    return len(json.dumps(item, ensure_ascii=False, default=str))


def clip(text, limit: int = RECORD_TEXT_LIMIT):
    if not isinstance(text, str) or len(text) <= limit:
        return text
    return text[:limit] + f"… [{len(text) - limit} more characters]"


def clip_headers(headers) -> dict:
    out = {}
    used = 0
    for name, value in (headers or {}).items():
        value = clip(str(value), HEADER_VALUE_LIMIT)
        used += len(name) + len(value)
        if used > HEADERS_LIMIT:
            out["…"] = "more headers omitted"
            break
        out[name] = value
    return out


def remote_text(arg: dict) -> str:
    kind = arg.get("type")
    if "value" in arg:
        value = arg["value"]
        if kind == "string":
            return value
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)
    if kind == "undefined":
        return "undefined"
    preview = arg.get("preview")
    if preview and preview.get("properties") is not None:
        props = preview["properties"]
        if preview.get("subtype") == "array":
            inner = ", ".join(p.get("value", "") for p in props)
            return f"[{inner}{', …' if preview.get('overflow') else ''}]"
        inner = ", ".join(f"{p.get('name')}: {p.get('value', '')}" for p in props)
        return "{" + inner + (", …" if preview.get("overflow") else "") + "}"
    return arg.get("description") or arg.get("unserializableValue") or kind or ""


class Page:
    def __init__(self, state, target_id: str):
        self.state = state
        self.target_id = target_id
        self.session_id: str | None = None
        self.browser = None
        self.frames: dict[str, dict] = {}
        self.main_frame: str | None = None
        self.worlds: dict[str, tuple[str, int]] = {}
        self.lifecycle: dict[str, tuple[str, set]] = {}
        self.dialog: dict | None = None
        self.console = Ring(CONSOLE_LIMIT)
        self.errors = Ring(ERROR_LIMIT)
        self.requests: collections.OrderedDict = collections.OrderedDict()
        self.request_sizes: dict = {}
        self.requests_dropped = 0
        self.runtime_on = False
        self.network_on = False
        self.input = Input(self)
        self.navigations = 0
        self.init_scripts: dict[str, str] = {}
        self.url = ""
        self.title = ""
        self.drag_intercepted: asyncio.Future | None = None
        self.calls: set = set()
        self.dropped: set = set()
        self.crashed = False
        self.needs_enable = False

    async def attach(self, browser):
        self.browser = browser
        self.worlds.clear()
        try:
            result = await browser.send("Target.attachToTarget", {"targetId": self.target_id, "flatten": True})
        except Gated as error:
            from ardia_cli import command_metrics
            from ardia_cli.browse import tabs

            command_metrics.flag("attach_refused", True)
            raise error.during(None, await tabs.where_app_has(self.state, self.target_id) if error.reason else None) from None
        self.session_id = result["sessionId"]
        self.state.sessions[self.session_id] = self
        known, self.crashed = self.crashed, False
        try:
            await self.send("Inspector.enable", timeout=CRASH_PROBE)
        except Gated:
            self.crashed = known
        except BrowseError:
            pass
        if self.crashed:
            self.needs_enable = True
            return
        await self.enable_page()

    async def enable_page(self):
        await self.send("Page.enable")
        await self.send("Page.setLifecycleEventsEnabled", {"enabled": True})
        await self.refresh_frames()
        if self.runtime_on:
            self.runtime_on = False
            await self.enable_runtime()
        if self.network_on:
            self.network_on = False
            await self.enable_network()
        viewport = None
        try:
            metrics = await self.send("Page.getLayoutMetrics")
            css = metrics.get("cssVisualViewport") or {}
            viewport = (css.get("clientWidth") or 1280, css.get("clientHeight") or 800)
        except BrowseError:
            pass
        self.input.bind(viewport)
        self.needs_enable = False

    def mark_crashed(self):
        self.crashed = True
        self.worlds.clear()
        for call in self.calls:
            self.dropped.add(call)
            call.cancel()

    async def revive(self, timeout: float):
        await self.send("Page.reload", {})
        await self.recovered(timeout)

    async def recovered(self, timeout: float):
        from ardia_cli import command_metrics
        from ardia_cli.browse.state import wait_until

        command_metrics.flag("crashed_reloaded", True)
        self.crashed = False
        await self.enable_page()

        async def loaded():
            return await self.call("() => document.readyState", frame=self.main_frame) == "complete"

        await wait_until(loaded, timeout, 0.1, "the crashed page to reload")

    def detach(self):
        if self.session_id:
            self.state.sessions.pop(self.session_id, None)
        self.session_id = None
        self.worlds.clear()
        for call in self.calls:
            self.dropped.add(call)
            call.cancel()

    async def send(self, method: str, params: dict | None = None, input_event: bool = False, timeout: float = 30, mutation: bool = False):
        from ardia_cli.browse.connection import is_mutation

        if self.session_id is None:
            raise BrowseError(DETACHED, code="tab_detached")
        if self.crashed and method not in CRASH_SAFE:
            raise BrowseError(CRASHED, code="tab_crashed")
        call = asyncio.ensure_future(self.browser.send(method, params, self.session_id, timeout))
        self.calls.add(call)
        try:
            return await call
        except asyncio.CancelledError:
            if call not in self.dropped:
                raise
            if input_event or mutation or is_mutation(method):
                raise OutcomeUnknown(f"`{method}`", f"Ardia detached the tab before it answered {method}") from None
            if self.crashed:
                raise BrowseError(CRASHED, code="tab_crashed") from None
            raise BrowseError(DETACHED, code="tab_detached") from None
        except CdpTimeout:
            if input_event or mutation or is_mutation(method):
                raise OutcomeUnknown(f"`{method}`", f"Ardia didn't answer {method} in {timeout:g}s after it was sent") from None
            raise
        finally:
            self.calls.discard(call)
            self.dropped.discard(call)

    async def refresh_frames(self) -> dict:
        tree = (await self.send("Page.getFrameTree"))["frameTree"]
        frames = {}

        def walk(node, parent):
            frame = node["frame"]
            frames[frame["id"]] = {
                "id": frame["id"],
                "url": frame.get("url", "") + frame.get("urlFragment", ""),
                "loader": frame.get("loaderId"),
                "parent": parent,
                "name": frame.get("name") or "",
                "origin": frame.get("securityOrigin") or "",
            }
            for child in node.get("childFrames") or []:
                walk(child, frame["id"])

        walk(tree, None)
        self.frames = frames
        self.main_frame = tree["frame"]["id"]
        self.url = frames[self.main_frame]["url"]
        return frames

    def loader(self, frame_id: str) -> str | None:
        frame = self.frames.get(frame_id)
        return frame and frame.get("loader")

    async def world(self, frame_id: str | None = None) -> int:
        frame_id = frame_id or self.main_frame
        if frame_id not in self.frames:
            await self.refresh_frames()
            if frame_id not in self.frames:
                raise BrowseError("That frame is gone. Run `ardia browse frame main` or snapshot again")
        loader = self.loader(frame_id)
        cached = self.worlds.get(frame_id)
        if cached and cached[0] == loader:
            return cached[1]
        result = await self.send("Page.createIsolatedWorld", {"frameId": frame_id, "worldName": WORLD_NAME})
        context = result["executionContextId"]
        await self.send("Runtime.evaluate", {"expression": LIBRARY, "contextId": context, "returnByValue": True})
        self.worlds[frame_id] = (loader, context)
        return context

    async def call(self, function: str, *args, frame: str | None = None, by_value: bool = True, await_promise: bool = True, timeout: float = 30,
                   read: bool = False):
        frame = frame or self.state.frame_for(self)
        for attempt in (0, 1):
            context = await self.world(frame)
            arguments = []
            for arg in args:
                if isinstance(arg, Element):
                    arguments.append({"objectId": arg.object_id})
                else:
                    arguments.append({"value": arg})
            params = {
                "functionDeclaration": function,
                "executionContextId": context,
                "arguments": arguments,
                "returnByValue": by_value,
                "awaitPromise": await_promise,
            }
            try:
                result = await self.send("Runtime.callFunctionOn", params, timeout=timeout, mutation=not read)
            except CdpError as error:
                if not any(marker in error.cdp_message for marker in STALE_CONTEXT):
                    raise
                self.worlds.pop(frame or self.main_frame, None)
                if read and attempt == 0 and not any(isinstance(a, Element) for a in args):
                    await self.refresh_frames()
                    continue
                if not read and "destroyed" in error.cdp_message:
                    raise OutcomeUnknown("the page script", "the page changed document while it ran") from None
                raise BrowseError("The page changed document before this could run, so it wasn't applied; snapshot again", code="document_changed") from None
            if "exceptionDetails" in result:
                details = result["exceptionDetails"]
                description = (details.get("exception") or {}).get("description") or details.get("text") or "error"
                raise BrowseError(description.split("\n    at ")[0])
            remote = result.get("result") or {}
            return remote.get("value") if by_value else remote
        raise BrowseError("the page navigated while reading it; try again")

    async def element_from(self, remote: dict, frame: str, label: str) -> Element | None:
        if not remote or remote.get("subtype") == "null" or remote.get("type") == "undefined" or "objectId" not in remote:
            return None
        node = (await self.send("DOM.describeNode", {"objectId": remote["objectId"]}))["node"]
        return Element(frame, remote["objectId"], node["backendNodeId"], label)

    async def elements_from(self, remote: dict, frame: str, label: str, limit: int = 300) -> list:
        if not remote or "objectId" not in remote:
            return []
        props = await self.send("Runtime.getProperties", {"objectId": remote["objectId"], "ownProperties": True})
        indexed = []
        for prop in props.get("result") or []:
            name = prop.get("name", "")
            value = prop.get("value") or {}
            if name.isdigit() and value.get("objectId"):
                indexed.append((int(name), value))
        indexed.sort(key=lambda item: item[0])
        described = await asyncio.gather(*(self.send("DOM.describeNode", {"objectId": value["objectId"]}) for _, value in indexed[:limit]))
        return [Element(frame, value["objectId"], d["node"]["backendNodeId"], label) for (_, value), d in zip(indexed, described)]

    async def resolve_backend(self, backend_id: int, frame: str, label: str) -> Element | None:
        context = await self.world(frame)
        try:
            result = await self.send("DOM.resolveNode", {"backendNodeId": backend_id, "executionContextId": context})
        except CdpError:
            return None
        remote = result.get("object") or {}
        if "objectId" not in remote:
            return None
        return Element(frame, remote["objectId"], backend_id, label)

    async def hidden(self) -> bool:
        try:
            return await self.call("() => document.visibilityState === 'hidden'", frame=self.main_frame, read=True)
        except BrowseError:
            return False

    async def takes_input(self) -> bool:
        if not await self.hidden():
            return True
        loop = asyncio.get_running_loop()
        deadline = loop.time() + LIVE_WAIT
        while loop.time() < deadline:
            await asyncio.sleep(0.05)
            if not await self.hidden():
                self.state.background_live = True
                return True
        if self.state.background_live is None:
            self.state.background_live = False
        return False

    def show_hint(self) -> str:
        return HIDDEN_TAB.format(tab=self.state.tab_id(self.target_id))

    async def require_visible(self):
        if not await self.takes_input():
            tab = self.state.tab_id(self.target_id)
            raise BrowseError(self.show_hint(), data={"tabId": tab, "use": f"ardia browse tab {tab} --show"}, code="tab_hidden")

    async def focus_element(self, element: Element):
        await self.send("DOM.focus", {"backendNodeId": element.backend_id})

    async def enable_runtime(self):
        if not self.runtime_on:
            await self.send("Runtime.enable")
            self.runtime_on = True

    async def enable_network(self):
        if not self.network_on:
            await self.send("Network.enable", {"maxTotalBufferSize": 50 * 1024 * 1024, "maxResourceBufferSize": 10 * 1024 * 1024})
            self.network_on = True

    def on_event(self, method: str, params: dict):
        if method == "Page.lifecycleEvent":
            frame, loader, name = params.get("frameId"), params.get("loaderId"), params.get("name")
            current = self.lifecycle.get(frame)
            if not current or current[0] != loader or name == "init":
                current = (loader, set())
                self.lifecycle[frame] = current
            current[1].add(name)
        elif method == "Page.frameNavigated":
            frame = params.get("frame") or {}
            frame_id = frame.get("id")
            if frame_id:
                self.frames[frame_id] = {
                    "id": frame_id,
                    "url": frame.get("url", "") + frame.get("urlFragment", ""),
                    "loader": frame.get("loaderId"),
                    "parent": frame.get("parentId"),
                    "name": frame.get("name") or "",
                    "origin": frame.get("securityOrigin") or "",
                }
                self.worlds.pop(frame_id, None)
                if not frame.get("parentId"):
                    self.crashed = False
                    self.main_frame = frame_id
                    self.url = self.frames[frame_id]["url"]
                    self.navigations += 1
        elif method == "Page.navigatedWithinDocument":
            frame_id = params.get("frameId")
            if frame_id in self.frames:
                self.frames[frame_id]["url"] = params.get("url", "")
                if frame_id == self.main_frame:
                    self.url = params.get("url", "")
        elif method == "Page.frameDetached":
            frame_id = params.get("frameId")
            self.frames.pop(frame_id, None)
            self.worlds.pop(frame_id, None)
        elif method == "Page.javascriptDialogOpening":
            self.dialog = dict(params)
            if self.state.auto_dialog and params.get("type") in ("alert", "beforeunload"):
                asyncio.ensure_future(self._auto_accept())
        elif method == "Page.javascriptDialogClosed":
            self.dialog = None
        elif method == "Runtime.executionContextsCleared":
            pass
        elif method == "Input.dragIntercepted":
            waiter = self.drag_intercepted
            if waiter is not None and not waiter.done():
                waiter.set_result(params.get("data") or {})
        elif method == "Runtime.consoleAPICalled":
            args = params.get("args") or []
            kind = params.get("type", "log")
            self.console.add({
                "type": "warning" if kind == "warn" else kind,
                "text": clip(" ".join(remote_text(arg) for arg in args)),
                "args": [{key: clip(arg[key]) if isinstance(arg[key], str) else arg[key]
                          for key in ("type", "value", "description", "className", "preview") if key in arg} for arg in args[:20]],
                "timestamp": params.get("timestamp"),
            })
        elif method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails") or {}
            exception = details.get("exception") or {}
            self.errors.add({
                "text": clip(exception.get("description") or details.get("text") or "Uncaught error"),
                "url": clip(details.get("url"), 4096),
                "line": details.get("lineNumber"),
                "column": details.get("columnNumber"),
                "timestamp": params.get("timestamp"),
            })
        elif method.startswith("Network.") and self.network_on:
            self.on_network(method, params)
        self.state.on_page_event(self, method, params)

    async def _auto_accept(self):
        try:
            await self.send("Page.handleJavaScriptDialog", {"accept": True})
        except BrowseError:
            pass

    def on_network(self, method: str, params: dict):
        request_id = params.get("requestId")
        if not request_id:
            return
        if method == "Network.requestWillBeSent":
            request = params.get("request") or {}
            record = self.requests.get(request_id)
            if record is None:
                if len(self.requests) >= REQUEST_LIMIT:
                    oldest, _ = self.requests.popitem(last=False)
                    self.request_sizes.pop(oldest, None)
                    self.requests_dropped += 1
                record = self.requests[request_id] = {"requestId": request_id}
            elif params.get("redirectResponse"):
                record["redirects"] = record.get("redirects", 0) + 1
            record.update({
                "url": clip(request.get("url", ""), 16 * 1024),
                "method": request.get("method", "GET"),
                "headers": clip_headers(request.get("headers")),
                "postData": (request.get("postData") or "")[:65536] or None,
                "resourceType": params.get("type") or "Other",
                "timestamp": int((params.get("wallTime") or time.time()) * 1000),
                "monotonic": params.get("timestamp"),
            })
        else:
            record = self.requests.get(request_id)
            if record is None:
                return
            if method == "Network.responseReceived":
                response = params.get("response") or {}
                record.update({
                    "status": response.get("status"),
                    "statusText": response.get("statusText", ""),
                    "mimeType": response.get("mimeType", ""),
                    "responseHeaders": clip_headers(response.get("headers")),
                    "protocol": response.get("protocol", ""),
                    "remoteIPAddress": response.get("remoteIPAddress"),
                    "timing": response.get("timing"),
                })
            elif method == "Network.loadingFinished":
                record["finished"] = params.get("timestamp")
                record["encodedDataLength"] = params.get("encodedDataLength")
            elif method == "Network.loadingFailed":
                record["failed"] = clip(params.get("errorText") or "failed", 1024)
                record["finished"] = params.get("timestamp")
        self.account_request(request_id)

    def account_request(self, request_id):
        record = self.requests.get(request_id)
        if record is None:
            return
        self.request_sizes[request_id] = record_size(record)
        while len(self.requests) > 1 and sum(self.request_sizes.values()) > REQUEST_BYTES:
            oldest, _ = self.requests.popitem(last=False)
            self.request_sizes.pop(oldest, None)
            self.requests_dropped += 1
