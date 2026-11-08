import asyncio
import time
from dataclasses import asdict, dataclass

from ardia_cli import command_metrics, control
from ardia_cli.caller import Caller
from ardia_cli.browse.connection import Browser
from ardia_cli.browse.errors import BrowseError, CdpError, ConnectionLost, StaleRef, Unreachable
from ardia_cli.browse.page import Page
from ardia_cli.browse.tabs import Registry

PAGE_SCHEMES = ("http:", "https:", "about:", "data:", "blob:", "file:")
ACTIVE_TIMEOUT = 3.0
PROBE_TIMEOUT = 3.0
UNKNOWN = object()
NO_PAGE = (
    "The user isn't on a web page right now (New Tab or another Ardia view) and this session has no tab yet. "
    "Open one with `ardia browse open <url>`, or pick one with `ardia browse tab list` and `ardia browse tab <id>`"
)


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
        self.registry = Registry(config.get("browse_fd"), config.get("key") or "", self.session)
        self.app_tabs: dict[str, str] = {}
        self.app_generations: dict[str, int | None] = {}
        self._current: str | None = None
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
        self.background_live: bool | None = None
        self.caller: Caller | None = None
        self.announced: Caller | None = None

    @property
    def current(self) -> str | None:
        return self._current

    @current.setter
    def current(self, target_id: str | None):
        if target_id != self._current:
            self.registry.note_using(self.instance, target_id)
        self._current = target_id

    @property
    def connected(self) -> bool:
        return self.browser is not None and self.browser.alive

    async def connect(self):
        if self.connected:
            return
        started = command_metrics.clock()
        command_metrics.flag("reconnected_after_idle", self.instance is not None)
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
        self.announced = None
        announcing = asyncio.ensure_future(self.announce_caller(endpoint))
        try:
            await browser.open()
        finally:
            await announcing
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
        from ardia_cli.browse import temptabs

        await temptabs.sweep(self)
        command_metrics.spent("connect_ms", started)

    async def announce_caller(self, endpoint):
        caller = self.caller
        if caller is None or caller == self.announced or endpoint is None or endpoint.explicit:
            return
        self.announced = caller
        await control.announce(control.announce_path(endpoint.source), caller)

    async def disconnect(self):
        browser, self.browser = self.browser, None
        for page in self.pages.values():
            page.detach()
        self.sessions.clear()
        if browser is not None:
            await browser.close()

    async def refresh_targets(self) -> list[dict]:
        taken_at = time.time()
        infos = (await self.browser.send("Target.getTargets")).get("targetInfos") or []
        pages = [info for info in infos if info.get("type") == "page" and str(info.get("url", "")).startswith(PAGE_SCHEMES)]
        self.target_infos = {info["targetId"]: info for info in pages}
        for target_id in list(self.pages) + ([self.current] if self.current else []):
            if target_id not in self.target_infos:
                self.forget_target(target_id)
        every_target = {info["targetId"] for info in infos if info.get("targetId")}
        self.tab_ids.update(self.registry.numbers(self.instance, self.target_infos, present=every_target, taken_at=taken_at))
        return pages

    def forget_target(self, target_id: str):
        page = self.pages.pop(target_id, None)
        if page:
            page.detach()
        was_opened = target_id in self.opened
        self.opened.discard(target_id)
        self.frames.pop(target_id, None)
        self.target_infos.pop(target_id, None)
        self.extras.get("views", {}).pop(target_id, None)
        for label, owner in list(self.labels.items()):
            if owner == target_id:
                del self.labels[label]
        if self.current == target_id and not self.pin_tab:
            self.extras["lost_tab"] = {"target": target_id, "app": self.app_tabs.get(target_id), "tab": self.tab_ids.get(target_id),
                                       "generation": self.app_generations.get(target_id), "opened": was_opened,
                                       "borrowed": self.extras.get("attached") == target_id}
            self.current = None
        self.app_tabs.pop(target_id, None)
        self.app_generations.pop(target_id, None)

    def tab_id(self, target_id: str) -> str:
        if target_id not in self.tab_ids:
            shared = self.registry.numbers(self.instance, [target_id]).get(target_id)
            if shared is None:
                shared = f"t{self.next_tab}"
                self.next_tab += 1
            self.tab_ids[target_id] = shared
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
        started = command_metrics.clock()
        explicit = target_id is not None
        target_id = target_id or self.current
        if target_id is None:
            if self.pin_tab and self.extras.get("pinned_target"):
                raise BrowseError(
                    "The session's pinned tab was closed. Recover with `ardia browse tab new <url>` or pick one from `ardia browse tab list`",
                    data={"targetId": self.extras.get("pinned_target")},
                    code="tab_gone",
                )
            if self.extras.get("had_tab"):
                target_id = await self.follow_lost_tab()
            else:
                target_id = await self.attach_active()
        if target_id not in self.target_infos:
            await self.refresh_targets()
            if target_id not in self.target_infos:
                self.forget_target(target_id)
                if not explicit and target_id == self.extras.get("lost_tab", {}).get("target"):
                    return await self.page()
                raise BrowseError("That tab was closed", data={"targetId": target_id}, code="tab_gone")
        page = self.pages.get(target_id)
        if page is None:
            page = self.pages[target_id] = Page(self, target_id)
        if page.session_id is None or page.browser is not self.browser:
            await page.attach(self.browser)
        self.extras["had_tab"] = True
        command_metrics.spent("attach_ms", started)
        return page

    async def follow_lost_tab(self) -> str:
        lost = self.extras.get("lost_tab") or {}
        gone = f" [{lost['tab']}]" if lost.get("tab") else ""
        fix = "Pick one with `ardia browse tab active` or `ardia browse tab <id>`, or open one with `ardia browse open <url>`"
        app_tab = lost.get("app")
        if app_tab:
            from ardia_cli.browse import tabs

            await self.refresh_targets()
            found = await tabs.app_tab_target(self, app_tab)
            if found.get("target"):
                target_id = found["target"]
                self.current = target_id
                self.app_tabs[target_id] = app_tab
                self.extras.pop("lost_tab", None)
                if lost.get("borrowed"):
                    self.extras["attached"] = target_id
                if lost.get("opened"):
                    self.opened.add(target_id)
                    self.registry.note_opened(self.instance, target_id)
                if self.pin_tab and self.extras.get("pinned_target") == lost.get("target"):
                    self.extras["pinned_target"] = target_id
                self.extras["notice"] = (f"→ Ardia replaced the page of this session's tab{gone} ({app_tab}), so the session follows it: "
                                         f"[{self.tab_id(target_id)}] {found.get('title') or found.get('url') or ''}")
                return target_id
            if found.get("asleep"):
                raise BrowseError(f"This session's tab{gone} ({app_tab}) is still open in Ardia, but Ardia unloaded its page, so there is "
                                  f"nothing to drive until it loads again (click it in Ardia, or `ardia browse open <url>` for a copy). {fix}",
                                  data={"appTabId": app_tab}, code="tab_asleep")
        raise BrowseError(f"This session's tab{gone} is gone (closed, or Ardia replaced its page and didn't say which page took over). {fix}",
                          code="tab_gone")

    async def attach_active(self) -> str:
        target_id = await self.active_target()
        if target_id is UNKNOWN:
            target_id = await self.shown_target()
        if not target_id:
            raise BrowseError(NO_PAGE, code="no_tab")
        await self.refresh_targets()
        if target_id not in self.target_infos:
            raise BrowseError(NO_PAGE, code="no_tab")
        self.current = target_id
        self.extras["attached"] = target_id
        if self.pin_tab:
            self.extras["pinned_target"] = target_id
        from ardia_cli.browse import tabs

        await tabs.app_tab_map(self)
        info = self.target_infos[target_id]
        label = " - ".join(part for part in (info.get("title"), info.get("url")) if part)
        self.extras["notice"] = f"→ This session had no tab, so it uses the active one: [{self.tab_id(target_id)}] {label}"
        return target_id

    async def active_target(self):
        endpoint = self.endpoint
        if endpoint is None or not endpoint.active:
            return UNKNOWN

        def fetch():
            import json
            import urllib.request

            direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with direct.open(endpoint.active, timeout=ACTIVE_TIMEOUT) as response:
                return json.loads(response.read(64 * 1024))

        try:
            answer = await asyncio.wait_for(asyncio.to_thread(fetch), ACTIVE_TIMEOUT + 1)
        except Exception:
            return UNKNOWN
        if answer is None:
            return None
        target_id = answer.get("targetId") if isinstance(answer, dict) else UNKNOWN
        return target_id if target_id is None or isinstance(target_id, str) else UNKNOWN

    async def shown_target(self) -> str | None:
        await self.refresh_targets()
        candidates = [target_id for target_id, info in self.target_infos.items() if info.get("url") != "about:blank"]
        probes = await asyncio.gather(*(self.probe(target_id) for target_id in candidates))
        focused = [target_id for target_id, (visible, has_focus) in zip(candidates, probes) if visible and has_focus]
        visible = [target_id for target_id, (shown, _) in zip(candidates, probes) if shown]
        return (focused or visible or [None])[0]

    async def probe(self, target_id: str) -> tuple[bool, bool]:
        from ardia_cli.browse.page import WORLD_NAME

        try:
            attached = await self.browser.send("Target.attachToTarget", {"targetId": target_id, "flatten": True}, timeout=PROBE_TIMEOUT)
        except BrowseError:
            return False, False
        session = attached["sessionId"]
        try:
            tree = await self.browser.send("Page.getFrameTree", None, session, PROBE_TIMEOUT)
            frame = tree["frameTree"]["frame"]["id"]
            world = await self.browser.send("Page.createIsolatedWorld", {"frameId": frame, "worldName": WORLD_NAME}, session, PROBE_TIMEOUT)
            result = await self.browser.send("Runtime.evaluate", {
                "expression": "[document.visibilityState === 'visible', document.hasFocus()]",
                "contextId": world["executionContextId"], "returnByValue": True,
            }, session, PROBE_TIMEOUT)
            visible, focused = (result.get("result") or {}).get("value") or (False, False)
            return bool(visible), bool(focused)
        except (BrowseError, KeyError, TypeError, ValueError):
            return False, False
        finally:
            try:
                await self.browser.send("Target.detachFromTarget", {"sessionId": session}, timeout=PROBE_TIMEOUT)
            except BrowseError:
                pass

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
            raise StaleRef(ref_id, "the element is no longer in the page" + await self.redrawn_as(page, ref))
        connected = await page.call("(el) => el.isConnected", element, frame=ref.frame)
        if not connected:
            raise StaleRef(ref_id, "the element was removed from the page" + await self.redrawn_as(page, ref))
        return page, element

    async def redrawn_as(self, page: Page, ref: Ref) -> str:
        from ardia_cli.browse import snapshot

        if not ref.role or not ref.name:
            return ""
        try:
            nodes = await snapshot.collect(self, page)
            self.set_refs(snapshot.refs_of(self, page, nodes), None, page)
        except ConnectionLost:
            raise
        except Exception:
            return ""
        same = [node.ref for node in snapshot.walk(nodes) if node.ref and node.role == ref.role and node.name == ref.name]
        if len(same) != 1:
            return ""
        return f'; the page redrew it, and the same {ref.role} "{ref.name}" is now @{same[0]}'

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

    def describe_tabs(self, app_tabs: dict[str, str] | None = None) -> list[dict]:
        opened_elsewhere, used_elsewhere = self.registry.others(self.instance)
        hidden = self.registry.hidden(self.instance) - {self.current}
        rows = []
        for target_id, info in self.target_infos.items():
            if info.get("url") == "about:blank" and target_id not in self.opened and target_id != self.current or target_id in hidden:
                continue
            rows.append({
                "tabId": self.tab_id(target_id),
                "appTabId": (app_tabs or {}).get(target_id) or self.app_tabs.get(target_id),
                "label": next((label for label, owner in self.labels.items() if owner == target_id), None),
                "targetId": target_id,
                "title": info.get("title") or "",
                "url": info.get("url") or "",
                "type": "page",
                "active": target_id == self.current,
                "openedBySession": target_id in self.opened,
                "openedBy": self.session if target_id in self.opened else opened_elsewhere.get(target_id),
                "usedBy": used_elsewhere.get(target_id, []),
            })
        rows.sort(key=lambda row: int(row["tabId"][1:]) if row["tabId"][1:].isdigit() else 0)
        return rows

    async def find_tab(self, ref: str) -> str:
        from ardia_cli.browse import tabs

        if ref in self.labels:
            return self.labels[ref]
        for target_id, tab in self.tab_ids.items():
            if tab == ref and target_id in self.target_infos:
                return target_id
        shared = self.registry.target_of(self.instance, ref)
        if shared in self.target_infos:
            return shared
        if ref in self.target_infos:
            return ref
        upper = ref.upper()
        matches = [target_id for target_id in self.target_infos if target_id.startswith(upper) and len(ref) >= 6]
        if len(matches) == 1:
            return matches[0]
        if ref.isdigit():
            raise BrowseError(f"Tab ids look like t{ref}, not {ref}; run `ardia browse tab` to list open tabs")
        if tabs.APP_TAB.fullmatch(ref):
            found = await tabs.app_tab_target(self, ref)
            if found.get("target"):
                self.app_tabs[found["target"]] = ref
                return found["target"]
            raise BrowseError(found["error"], data={"appTabId": ref, "candidates": found.get("candidates", [])}, code=found["code"])
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
