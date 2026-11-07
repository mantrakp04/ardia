import asyncio
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, unquote, urlsplit

from ardia_cli.browse import snapshot
from ardia_cli.redact import redact
from ardia_cli.browse.errors import BrowseError, CdpError, ConnectionLost, Gated

SETTLE_LIMIT = 1.5
FIRST_QUIET = 0.05
QUIET = 0.12
POLL = 0.025
STOP_TIMEOUT = 2.0
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
LONG_LIVED = {"EventSource", "WebSocket"}
MAX_ADDED = 40
MAX_REMOVED_LINES = 5
MAX_REMOVED_REFS = 30
MAX_WRITES = 20
MAX_PATH = 200
WATCH_BUFFER = 1024 * 1024
SAFE_KEY = re.compile(r"[A-Za-z0-9_.\[\]-]{1,40}")
SENSITIVE_KEY = re.compile(r"code|token|pass|pwd|secret|key|sig|auth|session|cred|otp|state|nonce|ticket|jwt", re.I)


@dataclass
class View:
    target: str
    loader: str
    url: str
    title: str
    entries: list = field(default_factory=list)


def entry(level: int, node) -> dict:
    attrs = [attr for attr in snapshot._attrs(node, False) if not attr.startswith("ref=")]
    return {"ref": node.ref, "level": level, "role": node.role, "name": node.name, "value": node.value, "attrs": attrs,
            "line": snapshot._line(node, 0, False)[2:]}


def entries_of(nodes) -> list[dict]:
    return [entry(level, node) for level, node in snapshot.interactive_rows(nodes)]


def view_frame(state, page) -> str:
    return state.frame_for(page) or page.main_frame


async def title_of(page) -> str:
    try:
        title = await page.call("() => document.title", frame=page.main_frame, read=True)
    except ConnectionLost:
        raise
    except BrowseError:
        return ""
    return title if isinstance(title, str) else ""


async def view(state, page, nodes=None) -> View:
    if nodes is None:
        nodes = await snapshot.collect(state, page)
    return View(page.target_id, page.loader(view_frame(state, page)) or "", page.url, await title_of(page), entries_of(nodes))


async def remember(state, page, nodes) -> View:
    seen = await view(state, page, nodes)
    state.extras.setdefault("views", {})[page.target_id] = seen
    return seen


def mark_shown(state, report: dict, after: View):
    shown = state.extras.setdefault("shown", {})
    report["back"] = [row["ref"] for row in report["added"] if shown.get(row["ref"]) == row["line"]]
    shown.update((row["ref"], row["line"]) for row in after.entries)


def note_shown(state, seen: View):
    state.extras.setdefault("shown", {}).update((row["ref"], row["line"]) for row in seen.entries)


def previous(state, page) -> View | None:
    seen = state.extras.get("views", {}).get(page.target_id)
    if seen is None or seen.loader != (page.loader(view_frame(state, page)) or ""):
        return None
    return seen


def key(row: dict) -> tuple:
    return row["role"], row["name"], row["value"], tuple(row["attrs"])


def public(row: dict) -> dict:
    return {name: row[name] for name in ("ref", "role", "name", "value", "attrs")}


def diff(before: View | None, after: View, writes: list | None = None) -> dict:
    new_document = before is None or before.loader != after.loader
    old = {} if new_document else {row["ref"]: row for row in before.entries}
    now = {row["ref"]: row for row in after.entries}
    added = [row for row in after.entries if row["ref"] not in old]
    removed = [] if new_document else [row for row in before.entries if row["ref"] not in now]
    changed = [(old[row["ref"]], row) for row in after.entries if row["ref"] in old and key(old[row["ref"]]) != key(row)]
    return {
        "document": "new" if new_document else "same",
        "url": {"from": before.url, "to": after.url} if before is not None and before.url != after.url else None,
        "title": {"from": before.title, "to": after.title} if before is not None and before.title != after.title else None,
        "added": added,
        "removed": removed,
        "changed": changed,
        "network": list(writes or []),
    }


def was(old: dict, new: dict) -> str:
    if old["value"] != new["value"]:
        return f" (was {old['value']!r})" if old["value"] else " (was empty)"
    if old["name"] != new["name"]:
        return f" (was named {old['name']!r})"
    if old["attrs"] != new["attrs"]:
        return f" (was [{', '.join(old['attrs'])}])" if old["attrs"] else " (was plain)"
    return ""


def network_line(write: dict) -> str:
    statuses = " → ".join(str(status) for status in write.get("statuses") or [])
    outcome = write.get("failed") or statuses or "pending"
    return f"{write['method']} {write['url']} → {outcome}"


def render(report: dict, before_known: bool = True) -> str:
    lines = []
    if report["url"]:
        lines.append(f"url: {masked_url(report['url']['from'])} → {masked_url(report['url']['to'])}")
    if report["title"]:
        lines.append(f"title: {report['title']['from']!r} → {report['title']['to']!r}")
    back = set(report.get("back") or [])
    added = [row for row in report["added"] if row["ref"] not in back]
    if report["document"] == "new" and before_known:
        lines.append(f"new document, {len(report['added'])} interactive nodes:")
    if back:
        refs = [row["ref"] for row in report["added"] if row["ref"] in back]
        more = f" … {len(refs) - MAX_REMOVED_REFS} more" if len(refs) > MAX_REMOVED_REFS else ""
        lines.append(f"+ {len(refs)} back as last shown: {' '.join(refs[:MAX_REMOVED_REFS])}{more}")
    if added:
        base = min(row["level"] for row in added)
        for row in added[:MAX_ADDED]:
            lines.append("+ " + "  " * (row["level"] - base) + row["line"])
        if len(added) > MAX_ADDED:
            lines.append(f"+ … {len(added) - MAX_ADDED} more (run `snapshot -i`)")
    for old, new in report["changed"]:
        lines.append(f"~ {new['line']}{was(old, new)}")
    removed = report["removed"]
    if len(removed) <= MAX_REMOVED_LINES:
        lines.extend(f"- {row['line']}" for row in removed)
    else:
        refs = " ".join(row["ref"] for row in removed[:MAX_REMOVED_REFS])
        more = f" … {len(removed) - MAX_REMOVED_REFS} more" if len(removed) > MAX_REMOVED_REFS else ""
        lines.append(f"- {len(removed)} removed: {refs}{more}")
    writes = report["network"]
    lines.extend(network_line(write) for write in writes[:MAX_WRITES])
    if len(writes) > MAX_WRITES:
        lines.append(f"… {len(writes) - MAX_WRITES} more requests (`network requests`)")
    if report.get("unsettled"):
        lines.append("(the page was still busy after 1.5 s; snapshot again for the final state)")
    if report.get("error"):
        lines.append(f"(couldn't read the page afterwards: {report['error']})")
    return "changes:\n" + "\n".join(lines) if lines else "changes: none"


def as_data(report: dict) -> dict:
    data = {
        "document": report["document"],
        "url": {"from": masked_url(report["url"]["from"]), "to": masked_url(report["url"]["to"])} if report["url"] else None,
        "title": report["title"],
        "added": [public(row) for row in report["added"]],
        "removed": [public(row) for row in report["removed"]],
        "changed": [{"ref": new["ref"], "from": public(old), "to": public(new)} for old, new in report["changed"]],
        "network": report["network"],
        "back": list(report.get("back") or []),
    }
    if report.get("unsettled"):
        data["unsettled"] = True
    if report.get("error"):
        data["error"] = report["error"]
    return data


def clean_url(url: str) -> str:
    url = redact(url)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "(unparseable URL)"
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https", "ws", "wss"):
        return f"{scheme}:…" if scheme else "(no URL)"
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    netloc = host + (f":{port}" if port is not None else "")
    path = "/".join("…" if secret_like(segment) else segment for segment in (parts.path or "/").split("/"))
    if len(path) > MAX_PATH:
        path = path[:MAX_PATH] + "…"
    keys = [(name if SAFE_KEY.fullmatch(name) else "…") + ("=…" if value else "") for name, value in parse_qsl(parts.query, keep_blank_values=True)]
    return f"{scheme}://{netloc}{path}" + ("?" + "&".join(keys) if keys else "")


def secret_like(segment: str) -> bool:
    if ":" in segment or "%3a" in segment.lower():
        return True
    return len(segment) >= 20 and bool(re.search(r"\d", segment)) and bool(re.search(r"[A-Za-z]", segment))


def masked_pair(part: str) -> str:
    name, sep, value = part.partition("=")
    if sep and value and SENSITIVE_KEY.search(unquote(name)):
        return f"{name}=…"
    return part


def masked_url(url: str) -> str:
    url = redact(url)
    try:
        parts = urlsplit(url)
    except ValueError:
        return "(unparseable URL)"
    if parts.scheme.lower() not in ("http", "https"):
        return url if not parts.query and not parts.fragment else f"{parts.scheme}:…"
    netloc = parts.hostname or ""
    if ":" in netloc:
        netloc = f"[{netloc}]"
    if parts.port is not None:
        netloc += f":{parts.port}"
    query = "&".join(masked_pair(part) for part in parts.query.split("&") if part)
    fragment = "…" if "=" in parts.fragment else parts.fragment
    return f"{parts.scheme}://{netloc}{parts.path}" + (f"?{query}" if query else "") + (f"#{fragment}" if fragment else "")


class NetworkWatch:
    def __init__(self, page):
        self.page = page
        self.enabled_here = False
        self.watching = False
        self.records: dict[str, dict] = {}
        self.order: list[str] = []
        self.last_event = 0.0

    def listener(self, event_page, method, params):
        if event_page is not self.page or not method.startswith("Network."):
            return
        request_id = params.get("requestId")
        if not request_id:
            return
        loop = asyncio.get_running_loop()
        self.last_event = loop.time()
        if method == "Network.requestWillBeSent":
            record = self.records.get(request_id)
            request = params.get("request") or {}
            if record is None:
                record = self.records[request_id] = {
                    "method": str(request.get("method") or "GET").upper(),
                    "url": clean_url(str(request.get("url") or "")),
                    "type": params.get("type") or "Other",
                    "statuses": [],
                    "done": False,
                }
                self.order.append(request_id)
            redirect = params.get("redirectResponse")
            if redirect and redirect.get("status") is not None:
                record["statuses"].append(redirect["status"])
        elif request_id in self.records:
            record = self.records[request_id]
            if method == "Network.responseReceived":
                status = (params.get("response") or {}).get("status")
                if status is not None:
                    record["statuses"].append(status)
                record["answered"] = True
            elif method == "Network.loadingFinished":
                record["done"] = True
            elif method == "Network.loadingFailed":
                record["done"] = True
                record["failed"] = "canceled" if params.get("canceled") else str(params.get("errorText") or "failed")[:200]

    async def start(self):
        self.page.state.listeners.append(self.listener)
        self.watching = True
        self.last_event = asyncio.get_running_loop().time()
        if self.page.network_on:
            return
        self.enabled_here = True
        try:
            await self.page.send("Network.enable", {"maxTotalBufferSize": WATCH_BUFFER, "maxResourceBufferSize": WATCH_BUFFER})
        except BrowseError as error:
            if isinstance(error, (CdpError, Gated)):
                self.enabled_here = False
            await self.stop()
            if isinstance(error, ConnectionLost):
                raise
        except BaseException:
            await self.stop()
            raise

    def busy(self) -> bool:
        return any(not record["done"] and not record.get("answered") and record["type"] not in LONG_LIVED for record in self.records.values())

    async def settle(self, page_busy=None) -> bool:
        loop = asyncio.get_running_loop()
        started = loop.time()
        deadline = started + SETTLE_LIMIT
        while True:
            now = loop.time()
            quiet = QUIET if self.records else FIRST_QUIET
            waiting = self.watching and (self.busy() or now - max(self.last_event, started) < quiet)
            if not waiting and page_busy is not None:
                waiting = await page_busy()
            if not waiting:
                return True
            if now >= deadline:
                return False
            await asyncio.sleep(POLL)

    async def stop(self):
        if self.listener in self.page.state.listeners:
            self.page.state.listeners.remove(self.listener)
        self.watching = False
        if not self.enabled_here:
            return
        self.enabled_here = False
        if self.page.network_on or self.page.session_id is None:
            return
        cleanup = asyncio.ensure_future(self.disable(self.page.session_id))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        if cancelled:
            raise asyncio.CancelledError

    async def disable(self, session: str):
        try:
            await asyncio.wait_for(self.page.send("Network.disable"), STOP_TIMEOUT)
            return
        except Exception:
            pass
        if self.page.session_id != session:
            return
        self.page.detach()
        try:
            await asyncio.wait_for(self.page.browser.send("Target.detachFromTarget", {"sessionId": session}), STOP_TIMEOUT)
        except Exception:
            pass

    def writes(self) -> list[dict]:
        rows = []
        for request_id in self.order:
            record = self.records[request_id]
            if record["method"] in READ_METHODS:
                continue
            row = {"method": record["method"], "url": record["url"], "type": record["type"], "statuses": list(record["statuses"])}
            row["status"] = record["statuses"][-1] if record["statuses"] else None
            if record.get("failed"):
                row["failed"] = record["failed"]
            elif not record["done"] and not record.get("answered"):
                row["pending"] = True
            rows.append(row)
        return rows


async def navigation_busy(page, navigations: int):
    if page.navigations == navigations:
        return False
    current = page.lifecycle.get(page.main_frame)
    return not (current and current[0] == page.loader(page.main_frame) and "DOMContentLoaded" in current[1])


async def observe(ctx, page, run):
    if ctx.options.get("no_changes"):
        return await run(), None
    state = ctx.state
    try:
        before = await view(state, page)
    except ConnectionLost:
        raise
    except BrowseError:
        before = None
    watch = NetworkWatch(page)
    navigations = page.navigations
    try:
        await watch.start()
        value = await run()
        settled = await watch.settle(lambda: navigation_busy(page, navigations))
    finally:
        await watch.stop()
    try:
        await page.refresh_frames()
        nodes = await snapshot.collect(state, page)
        state.set_refs(snapshot.refs_of(state, page, nodes), None, page)
        after = await remember(state, page, nodes)
    except ConnectionLost:
        raise
    except BrowseError as error:
        report = diff(None, View(page.target_id, "", page.url, ""), watch.writes())
        report["document"] = "unknown"
        report["error"] = error.message
        return value, report
    report = diff(before, after, watch.writes())
    mark_shown(state, report, after)
    if not settled:
        report["unsettled"] = True
    if before is None:
        report["document"] = "unknown"
    return value, report


def attach(result, report):
    if report is None:
        return result
    result.data["changes"] = as_data(report)
    text = render(report, report["document"] != "unknown")
    if report["document"] == "unknown" and report["added"]:
        text = text.replace("changes:\n", "changes (no view of the page before, so everything shows as added):\n", 1)
    result.text = (result.text if result.text is not None else "✓ Done") + "\n" + text
    return result
