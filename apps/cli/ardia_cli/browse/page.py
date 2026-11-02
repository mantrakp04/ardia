import asyncio
import collections
import time
from dataclasses import dataclass, field

from ardia_cli.browse.errors import BrowseError, CdpError, CdpTimeout, OutcomeUnknown
from ardia_cli.browse.inputs import Input
from ardia_cli.browse.js import LIBRARY

WORLD_NAME = "ardia-browse"
CONSOLE_LIMIT = 1000
ERROR_LIMIT = 500
REQUEST_LIMIT = 1000
HIDDEN_TAB = (
    "This tab is in the background, and Chrome doesn't deliver mouse or keyboard input to a hidden tab. "
    "Show it first with `ardia browse tab <id> --show` (Ardia switches its window to that tab), "
    "or open tabs shown with `open --show` or AGENT_BROWSER_SHOW_TAB=1"
)
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
    items: collections.deque = field(default_factory=collections.deque)
    dropped: int = 0

    def add(self, item):
        if len(self.items) >= self.limit:
            self.items.popleft()
            self.dropped += 1
        self.items.append(item)

    def clear(self):
        self.items.clear()
        self.dropped = 0


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
        self.requests_dropped = 0
        self.runtime_on = False
        self.network_on = False
        self.input = Input(self)
        self.navigations = 0
        self.init_scripts: dict[str, str] = {}
        self.url = ""
        self.title = ""

    async def attach(self, browser):
        self.browser = browser
        self.worlds.clear()
        result = await browser.send("Target.attachToTarget", {"targetId": self.target_id, "flatten": True})
        self.session_id = result["sessionId"]
        self.state.sessions[self.session_id] = self
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

    def detach(self):
        if self.session_id:
            self.state.sessions.pop(self.session_id, None)
        self.session_id = None
        self.worlds.clear()

    async def send(self, method: str, params: dict | None = None, input_event: bool = False, timeout: float = 30):
        try:
            return await self.browser.send(method, params, self.session_id, timeout)
        except CdpTimeout:
            if input_event:
                raise OutcomeUnknown(method, "Ardia didn't answer the input event in time") from None
            raise

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

    async def call(self, function: str, *args, frame: str | None = None, by_value: bool = True, await_promise: bool = True, timeout: float = 30):
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
                result = await self.send("Runtime.callFunctionOn", params, timeout=timeout)
            except CdpError as error:
                if attempt == 0 and any(marker in error.cdp_message for marker in STALE_CONTEXT) and not any(isinstance(a, Element) for a in args):
                    self.worlds.pop(frame or self.main_frame, None)
                    await self.refresh_frames()
                    continue
                raise
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
            return await self.call("() => document.visibilityState === 'hidden'", frame=self.main_frame)
        except BrowseError:
            return False

    async def require_visible(self):
        if await self.hidden():
            raise BrowseError(HIDDEN_TAB, code="tab_hidden")

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
        elif method == "Runtime.consoleAPICalled":
            args = params.get("args") or []
            kind = params.get("type", "log")
            self.console.add({
                "type": "warning" if kind == "warn" else kind,
                "text": " ".join(remote_text(arg) for arg in args),
                "args": [{key: arg[key] for key in ("type", "value", "description", "className", "preview") if key in arg} for arg in args],
                "timestamp": params.get("timestamp"),
            })
        elif method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails") or {}
            exception = details.get("exception") or {}
            self.errors.add({
                "text": exception.get("description") or details.get("text") or "Uncaught error",
                "url": details.get("url"),
                "line": details.get("lineNumber"),
                "column": details.get("columnNumber"),
                "timestamp": params.get("timestamp"),
            })
        elif method.startswith("Network."):
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
                    self.requests.popitem(last=False)
                    self.requests_dropped += 1
                record = self.requests[request_id] = {"requestId": request_id}
            elif params.get("redirectResponse"):
                record["redirects"] = record.get("redirects", 0) + 1
            record.update({
                "url": request.get("url", ""),
                "method": request.get("method", "GET"),
                "headers": request.get("headers") or {},
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
                    "responseHeaders": response.get("headers") or {},
                    "protocol": response.get("protocol", ""),
                    "remoteIPAddress": response.get("remoteIPAddress"),
                    "timing": response.get("timing"),
                })
            elif method == "Network.loadingFinished":
                record["finished"] = params.get("timestamp")
                record["encodedDataLength"] = params.get("encodedDataLength")
            elif method == "Network.loadingFailed":
                record["failed"] = params.get("errorText") or "failed"
                record["finished"] = params.get("timestamp")
