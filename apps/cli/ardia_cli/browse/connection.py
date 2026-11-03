import asyncio
import logging

from ardia_cli import guard
from ardia_cli.browse.errors import POLICY_REFUSAL, CdpError, CdpTimeout, ConnectionLost, Gated, OutcomeUnknown, Unreachable

MAX_MESSAGE = 256 * 1024 * 1024
CONNECT_TIMEOUT = 10
EVENTS = (
    "Target.targetCreated",
    "Target.targetDestroyed",
    "Target.targetInfoChanged",
    "Target.detachedFromTarget",
    "Target.attachedToTarget",
    "Inspector.detached",
    "Inspector.targetCrashed",
    "Page.lifecycleEvent",
    "Page.frameNavigated",
    "Page.navigatedWithinDocument",
    "Page.loadEventFired",
    "Page.domContentEventFired",
    "Page.javascriptDialogOpening",
    "Page.javascriptDialogClosed",
    "Page.frameDetached",
    "Page.screencastFrame",
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Runtime.executionContextsCleared",
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Network.loadingFinished",
    "Network.loadingFailed",
    "Network.dataReceived",
    "Fetch.requestPaused",
    "Fetch.authRequired",
    "Tracing.dataCollected",
    "Tracing.tracingComplete",
    "Browser.downloadWillBegin",
    "Browser.downloadProgress",
)


MUTATING_METHODS = frozenset({
    "Page.navigate", "Page.reload", "Page.handleJavaScriptDialog", "Page.addScriptToEvaluateOnNewDocument",
    "Page.removeScriptToEvaluateOnNewDocument", "Page.bringToFront", "DOM.setFileInputFiles", "DOM.focus", "Network.setCookie",
    "Network.setCookies", "Network.clearBrowserCookies", "Network.setExtraHTTPHeaders", "Network.emulateNetworkConditions",
    "Fetch.fulfillRequest", "Fetch.failRequest", "Fetch.continueRequest", "Fetch.continueWithAuth", "Overlay.highlightNode",
    "Target.createTarget", "Target.closeTarget", "Target.activateTarget", "Browser.setDownloadBehavior", "Browser.grantPermissions",
})


def is_mutation(method: str) -> bool:
    return method in MUTATING_METHODS or method.startswith(("Input.", "Emulation."))


def link_class():
    from pydoll.connection.connection_handler import ConnectionHandler
    from pydoll.exceptions import WebSocketConnectionClosed

    class Link(ConnectionHandler):
        def __init__(self, ws: str):
            super().__init__(ws_address=ws, ws_connector=guard.direct_connect)
            self.used = False
            self.lost = asyncio.Event()
            self.closing = False

        async def _establish_new_connection(self):
            if self.used:
                raise WebSocketConnectionClosed()
            self.used = True
            await self._teardown_connection()
            self._ws_connection = await self._ws_connector(self._ws_address, max_size=MAX_MESSAGE)
            self._events_handler.network_logs.clear()
            self._events_handler.network_logs = _Discard()
            self._events_handler.start()
            self._receive_task = asyncio.create_task(self._receive_events())
            self._receive_task.add_done_callback(lambda _task: self.lost.set())

    return Link


class _Discard(list):
    def append(self, _item):
        return None


class Browser:
    def __init__(self, endpoint, on_event):
        self.endpoint = endpoint
        self.on_event = on_event
        self.link = None
        self.closed_by_us = False

    @property
    def instance(self) -> str | None:
        return self.endpoint.instance

    async def open(self):
        guard.install()
        logging.getLogger("pydoll").setLevel(logging.CRITICAL)
        self.link = link_class()(self.endpoint.ws)
        try:
            await asyncio.wait_for(self.link._ensure_active_connection(), CONNECT_TIMEOUT)
        except Exception as error:
            from ardia_cli.browse.daemon import unreachable_message

            raise Unreachable(unreachable_message(self.endpoint, error)) from None
        for name in EVENTS:
            await self.link.register_callback(name, self._event)

    def _event(self, message: dict):
        try:
            self.on_event(message.get("method"), message.get("params") or {}, message.get("sessionId"))
        except Exception:
            logging.getLogger("ardia_cli.browse").exception("event handler failed")

    @property
    def alive(self) -> bool:
        return self.link is not None and not self.link.lost.is_set()

    async def send(self, method: str, params: dict | None = None, session: str | None = None, timeout: float = 30, mutation: bool = False):
        from pydoll.exceptions import CommandExecutionTimeout, CommandFailed, WebSocketConnectionClosed

        method = getattr(method, "value", method)
        if not self.alive:
            raise ConnectionLost()
        command = {"method": method, "params": params or {}}
        if session:
            command["sessionId"] = session
        try:
            response = await self.link.execute_command(command, timeout=timeout)
        except CommandFailed as error:
            text = str(error)
            if POLICY_REFUSAL in text:
                raise Gated(method) from None
            detail = text.split(": ", 1)[1] if ": " in text else text
            detail = detail.rsplit(" (code", 1)[0]
            raise CdpError(method, detail) from None
        except CommandExecutionTimeout:
            if mutation or is_mutation(method):
                raise OutcomeUnknown(f"`{method}`", f"Ardia didn't answer {method} in {timeout:g}s after it was sent") from None
            raise CdpTimeout(method, timeout) from None
        except WebSocketConnectionClosed:
            raise ConnectionLost() from None
        return response.get("result") or {}

    async def send_nowait(self, method: str, params: dict | None = None, session: str | None = None):
        from pydoll.exceptions import WebSocketConnectionClosed

        if not self.alive:
            raise ConnectionLost()
        command = {"method": method, "params": params or {}}
        if session:
            command["sessionId"] = session
        try:
            await self.link.execute_command_nowait(command)
        except WebSocketConnectionClosed:
            raise ConnectionLost() from None

    async def close(self):
        self.closed_by_us = True
        if self.link is not None:
            self.link.closing = True
            try:
                await asyncio.wait_for(self.link.close(), 3)
            except Exception:
                pass
