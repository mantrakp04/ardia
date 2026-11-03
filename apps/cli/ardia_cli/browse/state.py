import asyncio
from dataclasses import asdict, dataclass

from ardia_cli.browse.connection import Browser
from ardia_cli.browse.errors import BrowseError, CdpError, ConnectionLost, StaleRef, Unreachable
from ardia_cli.browse.page import Page

PAGE_SCHEMES = ("http:", "https:", "about:", "data:", "blob:", "file:")


@dataclass
class Ref:
    id: str
    instance: str
    target: str
    frame: str
    loader: str
    generation: int
    backend: int
    role: str
    name: str


class RestartedBrowser(BrowseError):
    exit_code = 2


class State:
    def __init__(self, config: dict, resolve_endpoint):
        self.config = config
        self.resolve_endpoint = resolve_endpoint
        self.session = config["session"]
        self.browser: Browser | None = None
        self.instance: str | None = None
        self.endpoint = None
        self.pages: dict[str, Page] = {}
        self.sessions: dict[str, Page] = {}
        self.tab_ids: dict[str, str] = {}
        self.next_tab = 1
        self.labels: dict[str, str] = {}
        self.current: str | None = None
        self.opened: set[str] = set()
        self.frames: dict[str, str] = {}
        self.refs: dict[str, Ref] = {}
        self.issued_refs = 0
        self.ref_keys: dict[tuple, str] = {}
        self.current_refs: list[str] = []
        self.generation = 0
        self.last_snapshot: str | None = None
        self.auto_dialog = not config.get("no_auto_dialog")
        self.pin_tab = bool(config.get("pin_tab"))
        self.leases: set[str] = set()
        self.extras: dict = {}
        self.lost = False
        self.restarted = False
        self.target_infos: dict[str, dict] = {}
        self.listeners: list = []

    @property
    def connected(self) -> bool:
        return self.browser is not None and self.browser.alive

    async def connect(self):
        if self.connected:
            return
        if self.browser is not None and not self.browser.closed_by_us:
            self.lost = True
        if self.lost:
            raise ConnectionLost()
        endpoint = self.resolve_endpoint()
        if self.instance is not None and endpoint.instance != self.instance:
            self.restarted = True
            raise RestartedBrowser(
                "Ardia restarted (or control was turned off and on) since this session started, so its tabs and refs are gone. "
                "Start over with `ardia browse open <url>`",
                code="browser_restarted",
            )
        browser = Browser(endpoint, self.on_event)
        await browser.open()
        self.browser = browser
        self.endpoint = endpoint
        self.instance = endpoint.instance
        for page in self.pages.values():
            page.detach()
        self.sessions.clear()
        try:
            await browser.send("Target.setDiscoverTargets", {"discover": True})
        except BrowseError:
            pass
        await self.refresh_targets()

    async def disconnect(self):
        browser, self.browser = self.browser, None
        for page in self.pages.values():
            page.detach()
        self.sessions.clear()
        if browser is not None:
            await browser.close()

    async def refresh_targets(self) -> list[dict]:
        infos = (await self.browser.send("Target.getTargets")).get("targetInfos") or []
        pages = [info for info in infos if info.get("type") == "page" and str(info.get("url", "")).startswith(PAGE_SCHEMES)]
        self.target_infos = {info["targetId"]: info for info in pages}
        for target_id in list(self.pages):
            if target_id not in self.target_infos:
                self.forget_target(target_id)
        return pages

    def forget_target(self, target_id: str):
        page = self.pages.pop(target_id, None)
        if page:
            page.detach()
        self.opened.discard(target_id)
        self.frames.pop(target_id, None)
        self.target_infos.pop(target_id, None)
        for label, owner in list(self.labels.items()):
            if owner == target_id:
                del self.labels[label]
        if self.current == target_id and not self.pin_tab:
            self.current = None

    def tab_id(self, target_id: str) -> str:
        if target_id not in self.tab_ids:
            self.tab_ids[target_id] = f"t{self.next_tab}"
            self.next_tab += 1
        return self.tab_ids[target_id]

    def on_event(self, method: str, params: dict, session_id: str | None):
        if session_id:
            page = self.sessions.get(session_id)
            if page is not None:
                if method in ("Inspector.detached", "Inspector.targetCrashed"):
                    page.detach()
                    return
                page.on_event(method, params)
            return
        if method in ("Target.targetCreated", "Target.targetInfoChanged"):
            info = params.get("targetInfo") or {}
            if info.get("type") == "page" and str(info.get("url", "")).startswith(PAGE_SCHEMES):
                self.target_infos[info["targetId"]] = info
        elif method == "Target.targetDestroyed":
            self.forget_target(params.get("targetId"))
        elif method == "Target.detachedFromTarget":
            page = self.sessions.get(params.get("sessionId"))
            if page:
                page.detach()
        for listener in list(self.listeners):
            listener(None, method, params)

    def on_page_event(self, page: Page, method: str, params: dict):
        for listener in list(self.listeners):
            listener(page, method, params)

    async def page(self, target_id: str | None = None) -> Page:
        await self.connect()
        target_id = target_id or self.current
        if target_id is None:
            if self.pin_tab and self.extras.get("pinned_target"):
                raise BrowseError(
                    "The session's pinned tab was closed. Recover with `ardia browse tab new <url>` or pick one from `ardia browse tab list`",
                    data={"targetId": self.extras.get("pinned_target")},
                    code="tab_gone",
                )
            raise BrowseError(
                "This session has no tab yet. Open one with `ardia browse open <url>`, or pick one of the user's tabs "
                "with `ardia browse tab list` and `ardia browse tab <id>`",
                code="no_tab",
            )
        if target_id not in self.target_infos:
            await self.refresh_targets()
            if target_id not in self.target_infos:
                self.forget_target(target_id)
                raise BrowseError("That tab was closed", data={"targetId": target_id}, code="tab_gone")
        page = self.pages.get(target_id)
        if page is None:
            page = self.pages[target_id] = Page(self, target_id)
        if page.session_id is None or page.browser is not self.browser:
            await page.attach(self.browser)
        return page

    def frame_for(self, page: Page) -> str | None:
        frame = self.frames.get(page.target_id)
        if frame and frame not in page.frames:
            raise BrowseError(
                "The frame chosen with `ardia browse frame` is gone, so commands won't fall back to another document. "
                "Run `ardia browse frame main` or choose another frame",
                code="frame_gone",
            )
        return frame

    def set_refs(self, refs: list[Ref], snapshot_text: str | None, page: Page | None = None):
        self.generation += 1
        if page is not None:
            self.prune_refs(page)
        for ref in refs:
            ref.generation = self.generation
            self.refs[ref.id] = ref
        self.current_refs = [ref.id for ref in refs]
        if snapshot_text is not None:
            self.last_snapshot = snapshot_text

    def prune_refs(self, page: Page):
        live = {(frame_id, frame.get("loader")) for frame_id, frame in page.frames.items()}
        for key, ref_id in list(self.ref_keys.items()):
            instance, target, frame, loader, _ = key
            if instance != self.instance or (target == page.target_id and (frame, loader) not in live):
                del self.ref_keys[key]
                self.refs.pop(ref_id, None)

    def next_ref(self) -> str:
        self.issued_refs += 1
        return f"e{self.issued_refs}"

    def ref_for_node(self, page: Page, frame: str, backend: int) -> str:
        key = (self.instance, page.target_id, frame, page.loader(frame) or "", backend)
        ref_id = self.ref_keys.get(key)
        if ref_id is None:
            ref_id = self.ref_keys[key] = self.next_ref()
        return ref_id

    def snapshot_refs(self) -> list[Ref]:
        return [self.refs[ref_id] for ref_id in self.current_refs if ref_id in self.refs]

    def add_ref(self, page: Page, element, role: str = "", name: str = "") -> str:
        ref_id = self.ref_for_node(page, element.frame, element.backend_id)
        known = self.refs.get(ref_id)
        ref = Ref(ref_id, self.instance, page.target_id, element.frame, page.loader(element.frame) or "",
                  self.generation, element.backend_id, role or (known.role if known else ""), name or (known.name if known else ""))
        self.refs[ref.id] = ref
        return ref.id

    async def resolve_ref(self, ref_id: str):
        ref = self.refs.get(ref_id)
        if ref is None:
            if ref_id[1:].isdigit() and int(ref_id[1:]) <= self.issued_refs:
                raise StaleRef(ref_id, "it came from an earlier snapshot, and refs are never reused")
            raise BrowseError(f"Unknown ref: {ref_id}", code="unknown_ref")
        if ref.instance != self.instance:
            raise StaleRef(ref_id, "Ardia restarted since that snapshot")
        if ref.target not in self.target_infos and ref.target not in self.pages:
            raise StaleRef(ref_id, "its tab was closed")
        try:
            page = await self.page(ref.target)
        except BrowseError as error:
            if error.code == "tab_gone":
                raise StaleRef(ref_id, "its tab was closed") from None
            raise
        await page.refresh_frames()
        frame = page.frames.get(ref.frame)
        if frame is None:
            raise StaleRef(ref_id, "its frame is gone")
        if frame.get("loader") != ref.loader:
            raise StaleRef(ref_id, "the page navigated since that snapshot")
        element = await page.resolve_backend(ref.backend, ref.frame, f"@{ref_id}")
        if element is None:
            raise StaleRef(ref_id, "the element is no longer in the page")
        connected = await page.call("(el) => el.isConnected", element, frame=ref.frame)
        if not connected:
            raise StaleRef(ref_id, "the element was removed from the page")
        return page, element

    async def locate(self, selector: str, page: Page | None = None):
        ref = parse_ref(selector)
        if ref:
            return await self.resolve_ref(ref)
        page = page or await self.page()
        frame = self.frame_for(page) or page.main_frame
        try:
            remote = await page.call("(s) => ardiaBrowse.query(s)", selector, frame=frame, by_value=False, read=True)
        except BrowseError as error:
            raise BrowseError(f"Invalid selector {selector}: {error.message}") from None
        element = await page.element_from(remote, frame, selector)
        if element is None:
            raise BrowseError(
                f"Element not found: {selector}. Verify the selector, role, or name is correct and the element exists in the DOM.",
                code="not_found",
            )
        return page, element

    def describe_tabs(self) -> list[dict]:
        rows = []
        for target_id, info in self.target_infos.items():
            if info.get("url") == "about:blank" and target_id not in self.opened and target_id != self.current:
                continue
            rows.append({
                "tabId": self.tab_id(target_id),
                "label": next((label for label, owner in self.labels.items() if owner == target_id), None),
                "targetId": target_id,
                "title": info.get("title") or "",
                "url": info.get("url") or "",
                "type": "page",
                "active": target_id == self.current,
                "openedBySession": target_id in self.opened,
            })
        rows.sort(key=lambda row: int(row["tabId"][1:]))
        return rows

    def find_tab(self, ref: str) -> str:
        if ref in self.labels:
            return self.labels[ref]
        for target_id, tab in self.tab_ids.items():
            if tab == ref and target_id in self.target_infos:
                return target_id
        if ref in self.target_infos:
            return ref
        upper = ref.upper()
        matches = [target_id for target_id in self.target_infos if target_id.startswith(upper) and len(ref) >= 6]
        if len(matches) == 1:
            return matches[0]
        if ref.isdigit():
            raise BrowseError(f"Tab ids look like t{ref}, not {ref}; run `ardia browse tab` to list open tabs")
        raise BrowseError(f"Tab {ref} not found; run `ardia browse tab` to list open tabs", code="tab_not_found")

    def refs_json(self) -> dict:
        return {ref.id: {"name": ref.name, "role": ref.role} for ref in self.snapshot_refs()}

    def ref_records(self) -> list[dict]:
        return [asdict(ref) for ref in self.refs.values()]


def parse_ref(selector: str) -> str | None:
    if selector.startswith("@") and selector[1:2] == "e" and selector[2:].isdigit():
        return selector[1:]
    if selector.startswith("ref=") and selector[4:5] == "e" and selector[5:].isdigit():
        return selector[4:]
    return None


async def wait_until(check, timeout: float, interval: float = 0.1, what: str = "condition"):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        value = await check()
        if value:
            return value
        if loop.time() >= deadline:
            raise BrowseError(f"Timed out after {timeout * 1000:g}ms waiting for {what}", code="timeout")
        await asyncio.sleep(interval)


def unreachable(error: Exception) -> Unreachable:
    return Unreachable(str(error))


def is_policy(error: Exception) -> bool:
    return isinstance(error, CdpError) and "isn't allowed for the ardia command" in error.cdp_message
