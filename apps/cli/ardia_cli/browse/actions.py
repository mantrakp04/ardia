import asyncio
import contextlib
import json
import random
import re

from ardia_cli import command_metrics
from ardia_cli.browse import fields
from ardia_cli.browse.errors import BrowseError, CdpError, Gated, OutcomeUnknown

SCROLL_DEFAULT = 300
DELIVERY_TIMEOUT = 1.5
NOT_DELIVERED = (
    "{action} was sent, but the page received none of its {missing} events. The tab may not be on screen in Ardia "
    "(just switched, or covered by another tab); check it's shown (`ardia browse tab <id> --show`) before trying again"
)
INTERCEPT_TIMEOUT = 1.5
CLEANUP_TIMEOUT = 2.0
DRAG_GATED = "the source is an HTML5 draggable, and without drag interception a synthetic drag would start a real macOS drag session"
CLEANUPS: set = set()
PARTLY_DELIVERED = "the page received only part of it (no {missing} event arrived), so it may have had an effect"
SUGGESTION_TIMEOUT = 4.0
LAYOUT_WAIT = 2.0
SANE_VIEWPORT = {"width": 1280, "height": 800}
SUGGESTION_HINT_WAIT = 1.2
SUGGESTION_SETTLE = 0.35
EXACT = 3
MAX_SUGGESTIONS = 8
EMAIL = re.compile(r"[^\s@<>()\[\],;:\"']+@[^\s@<>()\[\],;:\"']+\.[A-Za-z]{2,}")
ENABLE_WAIT = 1.5
EDITOR_WAIT = 1.0
COMMIT_WAIT = 0.5
POLL = 0.05
INSERTED_INPUT_TYPES = frozenset({"text", "search", "email", "url", "tel", "number"})
DRAG_FAR_SHARE = 0.75
DISABLED_STATE = """(el) => ({
  native: el.matches(":disabled") || !!(el.closest && el.closest("button:disabled, fieldset:disabled")),
  aria: el.getAttribute("aria-disabled") === "true",
})"""
CELL_OF = "(el) => el.closest('[role=gridcell], [role=cell], td')"
CELL_START = """(cell) => {
  globalThis.ardiaCellFocusBefore = document.activeElement;
  const editable = (n) => !n.disabled && (n.tagName === "SELECT" || n.isContentEditable
    || ((n.tagName === "INPUT" || n.tagName === "TEXTAREA") && !n.readOnly && n.type !== "hidden"));
  const grid = cell.closest("[role=grid], [role=treegrid], [role=table], table");
  const row = cell.closest("[role=row], tr");
  const rows = grid ? Array.from(grid.querySelectorAll("[role=row], tr")) : [];
  globalThis.ardiaCellSpot = {
    cell, grid, id: cell.id || null,
    row: row && row.getAttribute("aria-rowindex"), column: cell.getAttribute("aria-colindex"),
    rowIndex: row ? rows.indexOf(row) : -1, cellIndex: row ? Array.from(row.children).indexOf(cell) : -1,
  };
  const was = (cell.innerText || cell.textContent || "").trim();
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const box = cell.getBoundingClientRect();
  const hit = box.width && box.height ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
  if (active && editable(active) && (cell.contains(active) || hit && (hit === active || active.contains(hit)))) {
    globalThis.ardiaCellInner = active;
    return { was, inner: true, open: true };
  }
  const inner = Array.from(cell.querySelectorAll("input, textarea, select, [contenteditable=true], [role=combobox], [role=textbox]"))
    .find((n) => editable(n) || n.getAttribute("role") === "combobox");
  globalThis.ardiaCellInner = inner || null;
  return { was, inner: !!inner, open: false };
}"""
CELL_INNER = "() => globalThis.ardiaCellInner || null"
CELL_EDITOR = """(cell) => {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  if (!active || active === document.body || active === document.documentElement) return null;
  const editable = !active.disabled && (active.tagName === "SELECT" || active.isContentEditable
    || ((active.tagName === "INPUT" || active.tagName === "TEXTAREA") && !active.readOnly));
  if (!editable) return null;
  return cell.contains(active) || active !== globalThis.ardiaCellFocusBefore ? active : null;
}"""
CELL_EDITOR_STATE = """(editor) => {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const open = editor.isConnected && active === editor;
  if (!open) return { open: false };
  const ids = (editor.getAttribute("aria-errormessage") || "") + " " + (editor.getAttribute("aria-describedby") || "");
  const said = ids.split(/\\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean)
    .map((n) => (n.innerText || n.textContent || "").trim()).filter(Boolean);
  const message = said.join(" ") || editor.validationMessage || "";
  return { open: true, invalid: editor.getAttribute("aria-invalid") === "true" || !!editor.validationMessage, message };
}"""
CELL_FIND = """() => {
  const spot = globalThis.ardiaCellSpot;
  if (!spot) return null;
  if (spot.cell.isConnected) return spot.cell;
  if (spot.id && document.getElementById(spot.id)) return document.getElementById(spot.id);
  if (!spot.grid || !spot.grid.isConnected) return null;
  const rows = Array.from(spot.grid.querySelectorAll("[role=row], tr"));
  if (spot.row && spot.column) {
    const row = rows.find((r) => r.getAttribute("aria-rowindex") === spot.row);
    const cell = row && row.querySelector('[aria-colindex="' + spot.column + '"]');
    if (cell) return cell;
  }
  const row = spot.rowIndex >= 0 ? rows[spot.rowIndex] : null;
  return row && spot.cellIndex >= 0 ? row.children[spot.cellIndex] || null : null;
}"""
CELL_NOW = "() => { const cell = (" + CELL_FIND + ")(); return cell ? (cell.innerText || cell.textContent || '').trim() : null; }"
SETTLED_FRAMES = "() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))"
CELL_REVEAL = """() => {
  const cell = (""" + CELL_FIND + """)();
  if (!cell) return false;
  const margin = 16;
  const box = cell.getBoundingClientRect();
  let scroller = cell.parentElement;
  while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX + getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  let area = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  if (scroller && scroller !== document.body) {
    const outer = scroller.getBoundingClientRect();
    const left = outer.left + scroller.clientLeft, top = outer.top + scroller.clientTop;
    area = { left: Math.max(0, left), top: Math.max(0, top), right: Math.min(innerWidth, left + scroller.clientWidth),
             bottom: Math.min(innerHeight, top + scroller.clientHeight) };
  }
  const inside = box.left >= area.left && box.top >= area.top && box.right <= area.right - margin && box.bottom <= area.bottom - margin;
  const hit = inside && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (!hit || !cell.contains(hit)) cell.scrollIntoView({ block: "center", inline: "center" });
  return true;
}"""
LIST_BEFORE = """(source, target) => {
  let item = source;
  while (item.parentElement && !item.parentElement.contains(target)) item = item.parentElement;
  const list = item.parentElement;
  if (!list || item.contains(target)) return null;
  const like = (n) => n.tagName === item.tagName;
  const items = Array.from(list.children).filter(like);
  const onto = Array.from(list.children).find((n) => n.contains(target));
  if (!onto || !like(onto) || items.length < 2) return null;
  const role = (item.getAttribute("role") || "").toLowerCase();
  const carrier = source.closest("[draggable=true]") || source;
  const sortable = /^(LI|TR|OPTION|DT)$/.test(item.tagName) || ["listitem", "row", "option", "treeitem"].includes(role)
    || carrier === item || !!source.closest("[aria-roledescription*=sortable i]");
  if (!sortable) return null;
  const key = (n) => (n.textContent || "").replace(/\\s+/g, " ").trim();
  const text = key(item);
  if (!text || items.filter((n) => key(n) === text).length !== 1) return null;
  globalThis.ardiaDragList = { list, tag: item.tagName, text };
  return { from: items.indexOf(item) + 1, count: items.length };
}"""
LIST_AFTER = """() => {
  const spot = globalThis.ardiaDragList;
  globalThis.ardiaDragList = null;
  if (!spot || !spot.list.isConnected) return null;
  const key = (n) => (n.textContent || "").replace(/\\s+/g, " ").trim();
  const items = Array.from(spot.list.children).filter((n) => n.tagName === spot.tag);
  const hits = items.filter((n) => key(n) === spot.text);
  return hits.length === 1 ? { to: items.indexOf(hits[0]) + 1, count: items.length } : null;
}"""


async def input_counts(page, frame):
    return await page.call("() => ardiaBrowse.inputWatch()", frame=frame)


def delivered(now: dict, before: dict, name: str) -> int:
    return sum(now.get(part, 0) - before.get(part, 0) for part in name.split("|"))


async def expect_input(page, frame, run, needs: dict, action: str):
    from ardia_cli.browse.errors import ConnectionLost, OutcomeUnknown

    frame = frame or page.main_frame
    loader = page.loader(frame)
    try:
        before = await input_counts(page, frame)
    except ConnectionLost:
        raise
    except BrowseError as error:
        raise BrowseError(f"Couldn't watch this frame for input, so {action.lower()} wasn't sent ({error.message})", code="input_unconfirmable") from None
    result = await run()
    if not needs or before.get("activeFrame") and any(key in name for name in needs for key in ("keydown", "keyup", "input")):
        return result
    loop = asyncio.get_running_loop()
    deadline = loop.time() + DELIVERY_TIMEOUT
    while True:
        try:
            await page.refresh_frames()
            if frame not in page.frames or page.loader(frame) != loader:
                return result
            now = await input_counts(page, frame)
        except ConnectionLost:
            raise
        except BrowseError as error:
            if left_document(error):
                return result
            raise OutcomeUnknown(action.lower(), f"it was sent, but confirming it reached the page failed ({error.message})") from None
        missing = [name for name, count in needs.items() if delivered(now, before, name) < count]
        if not missing:
            return result
        if loop.time() >= deadline:
            names = " or ".join(part for name in missing for part in name.split("|"))
            if all(delivered(now, before, name) == 0 for name in needs):
                raise BrowseError(NOT_DELIVERED.format(action=action, missing="/".join(needs).replace("|", "/")), data={"missing": missing}, code="input_not_delivered")
            raise OutcomeUnknown(action.lower(), PARTLY_DELIVERED.format(missing=names))
        await asyncio.sleep(0.05)


def left_document(error: BrowseError) -> bool:
    return error.code == "document_changed" or error.code == "outcome_unknown" and "changed document" in error.message


def mouse_button(name: str | None):
    from pydoll.protocol.input.types import MouseButton

    name = (name or "left").lower()
    mapping = {"left": MouseButton.LEFT, "right": MouseButton.RIGHT, "middle": MouseButton.MIDDLE}
    if name not in mapping:
        raise BrowseError(f"Unknown mouse button: {name} (left, right or middle)")
    return mapping[name]


class ScrollDriver:
    def __init__(self, page, point, frame, scripted=False, element=None):
        self.page = page
        self.point = point
        self.frame = frame
        self.scripted = scripted
        self.element = element

    async def _execute_command(self, command):
        from pydoll.constants import Scripts

        method = command["method"]
        params = command.get("params") or {}
        if method == "Runtime.evaluate":
            expression = params.get("expression", "")
            if expression == Scripts.GET_VIEWPORT_CENTER:
                return {"result": {"result": {"value": json.dumps([int(self.point[0]), int(self.point[1])])}}}
            value = await self.page.call(f"() => ({expression})", frame=self.frame)
            return {"result": {"result": {"value": value}}}
        if method == "Input.dispatchMouseEvent":
            params = dict(params)
            params["x"], params["y"] = int(self.point[0]), int(self.point[1])
            if self.scripted:
                dx, dy = params.get("deltaX") or 0, params.get("deltaY") or 0
                if self.element is not None:
                    await self.page.call("(el, x, y) => el.scrollBy(x, y)", self.element, dx, dy, frame=self.element.frame)
                else:
                    await self.page.call("(x, y) => scrollBy(x, y)", dx, dy, frame=self.frame)
                return {"result": {}}
        await self.page.send(method, params, input_event=True)
        return {"result": {}}


async def viewport(page, frame=None):
    return await page.call("() => ardiaBrowse.viewport()", frame=frame or page.main_frame, read=True)


async def rect(page, element):
    return await page.call("(el) => ardiaBrowse.rect(el)", element, frame=element.frame)


async def frame_offset(page, frame: str) -> tuple[float, float]:
    if frame == page.main_frame:
        return 0.0, 0.0
    owner = await page.send("DOM.getFrameOwner", {"frameId": frame})
    quads = (await page.send("DOM.getContentQuads", {"backendNodeId": owner["backendNodeId"]})).get("quads") or []
    if not quads:
        return 0.0, 0.0
    quad = quads[0]
    return min(quad[0::2]), min(quad[1::2])


async def scroll_wheel(page, distance: float, vertical: bool, humanize: bool, point=None, frame=None, element=None):
    from pydoll.constants import ScrollPosition
    from pydoll.interactions.scroll import Scroll

    mouse = page.input.mouse
    scripted = await page.hidden()
    if point is None:
        vp = await viewport(page)
        x, y = mouse._position
        if not (8 <= x <= vp["width"] - 8 and 8 <= y <= vp["height"] - 8):
            x, y = vp["width"] * random.uniform(0.35, 0.65), vp["height"] * random.uniform(0.35, 0.65)
        point = (x, y)
    if scripted:
        pass
    elif humanize and abs(mouse._position[0] - point[0]) + abs(mouse._position[1] - point[1]) > 2:
        await mouse.move(point[0], point[1], humanize=True)
    elif not humanize:
        mouse._position = point
    if distance == 0:
        return
    if humanize:
        position = (ScrollPosition.DOWN if distance > 0 else ScrollPosition.UP) if vertical else (ScrollPosition.RIGHT if distance > 0 else ScrollPosition.LEFT)
        await Scroll(ScrollDriver(page, point, frame or page.main_frame, scripted, element)).by(position, abs(distance), humanize=True)
        return
    if scripted:
        await ScrollDriver(page, point, frame or page.main_frame, True, element)._execute_command({
            "method": "Input.dispatchMouseEvent", "params": {"type": "mouseWheel", "deltaX": 0 if vertical else int(distance), "deltaY": int(distance) if vertical else 0}})
        return
    await page.send("Input.dispatchMouseEvent", {
        "type": "mouseWheel", "x": int(point[0]), "y": int(point[1]),
        "deltaX": 0 if vertical else int(distance), "deltaY": int(distance) if vertical else 0,
    }, input_event=True)


def _outside(r, vp, margin=4) -> bool:
    return r["y"] < margin or r["y"] + min(r["height"], vp["height"] * 0.8) > vp["height"] - margin or r["x"] < 0 or r["x"] + min(r["width"], vp["width"]) > vp["width"]


async def laid_out(page):
    vp = await viewport(page)
    if vp["width"] >= 1 and vp["height"] >= 1:
        return
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LAYOUT_WAIT
    while loop.time() < deadline:
        await asyncio.sleep(0.1)
        vp = await viewport(page)
        if vp["width"] >= 1 and vp["height"] >= 1:
            return
    if not {"emulation", "offscreen"} & page.state.leases:
        try:
            await page.send("Emulation.setDeviceMetricsOverride", {**SANE_VIEWPORT, "deviceScaleFactor": 0, "mobile": False})
        except (Gated, CdpError):
            pass
        else:
            page.temporary_metrics = True
            vp = await viewport(page)
            if vp["width"] >= 1 and vp["height"] >= 1:
                return
    raise BrowseError(
        f"This tab has no size yet ({vp['width']}×{vp['height']}: Ardia hasn't laid it out), so there's nowhere to click. Show it with "
        f"`ardia browse tab {page.state.tab_id(page.target_id)} --show`, or wait a moment and retry", code="no_viewport",
    )


async def restore_metrics(page):
    if not getattr(page, "temporary_metrics", False):
        return
    page.temporary_metrics = False
    with contextlib.suppress(BrowseError):
        await page.send("Emulation.clearDeviceMetricsOverride", timeout=CLEANUP_TIMEOUT)


async def scroll_into_view(page, element, humanize: bool):
    if not humanize or element.frame != page.main_frame:
        await page.send("DOM.scrollIntoViewIfNeeded", {"backendNodeId": element.backend_id})
        return
    for _ in range(5):
        r = await rect(page, element)
        vp = await viewport(page)
        if r["width"] == 0 and r["height"] == 0:
            break
        if not _outside(r, vp):
            return
        dy = (r["y"] + r["height"] / 2) - vp["height"] / 2
        dy = max(-vp["scrollY"], min(dy, vp["docHeight"] - vp["height"] - vp["scrollY"]))
        dx = 0
        if r["x"] < 0 or r["x"] + min(r["width"], vp["width"]) > vp["width"]:
            dx = (r["x"] + r["width"] / 2) - vp["width"] / 2
            dx = max(-vp["scrollX"], min(dx, vp["docWidth"] - vp["width"] - vp["scrollX"]))
        if abs(dy) < 2 and abs(dx) < 2:
            break
        if abs(dy) >= 2:
            await scroll_wheel(page, dy, True, True)
        if abs(dx) >= 2:
            await scroll_wheel(page, dx, False, True)
        await asyncio.sleep(0.15)
    r = await rect(page, element)
    vp = await viewport(page)
    if _outside(r, vp):
        await page.send("DOM.scrollIntoViewIfNeeded", {"backendNodeId": element.backend_id})


async def target_point(page, element, humanize: bool, check_cover: bool = True):
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if not info.get("connected"):
        raise BrowseError(f"Element {element.label} was removed from the page")
    await laid_out(page)
    await scroll_into_view(page, element, humanize)
    box = await element_box(page, element)
    if box is None:
        raise BrowseError(f"Element {element.label} has no visible box (hidden or zero-size)", code="not_visible")
    left, top, right, bottom = box
    cx, cy = (left + right) / 2, (top + bottom) / 2
    if humanize:
        cx += random.uniform(-0.2, 0.2) * (right - left)
        cy += random.uniform(-0.2, 0.2) * (bottom - top)
    if check_cover:
        ox, oy = await frame_offset(page, element.frame)
        cover = await page.call("(el, x, y) => ardiaBrowse.hitTest(el, x, y)", element, cx - ox, cy - oy, frame=element.frame)
        if cover and humanize:
            cx, cy = (left + right) / 2, (top + bottom) / 2
            cover = await page.call("(el, x, y) => ardiaBrowse.hitTest(el, x, y)", element, cx - ox, cy - oy, frame=element.frame)
        if cover and cover.startswith("nothing"):
            vp = await viewport(page)
            raise BrowseError(
                f"Element {element.label} is outside the visible page (its middle is at {cx - ox:.0f},{cy - oy:.0f} in a {vp['width']}×{vp['height']} "
                "viewport), so a click there would land on nothing. Scroll it into view (scrollintoview), or snapshot again if the page moved",
                data={"point": [cx, cy], "viewport": [vp["width"], vp["height"]]}, code="outside_viewport",
            )
        if cover:
            raise BrowseError(
                f"Element {element.label} is covered by {cover}; interact with that element first, snapshot again, then retry",
                data={"coveredBy": cover},
                code="covered",
            )
    return cx, cy, info


async def disabled_state(page, element) -> dict:
    state = await page.call(DISABLED_STATE, element, frame=element.frame, read=True)
    return state if isinstance(state, dict) else {}


async def wait_enabled(page, element, strict: bool = True):
    state = await disabled_state(page, element)
    if not (state.get("native") or state.get("aria")):
        return
    command_metrics.flag("waited_for_enabled", True)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + ENABLE_WAIT
    while loop.time() < deadline:
        await asyncio.sleep(POLL)
        state = await disabled_state(page, element)
        if not (state.get("native") or state.get("aria")):
            return
    if state.get("native") or strict:
        raise BrowseError(
            f"Element {element.label} is disabled, and it stayed disabled for {ENABLE_WAIT:g} s. Do what enables it first "
            "(it usually depends on another field: To after From); in a batch, put that line before this one",
            code="disabled",
        )


async def click(page, element, humanize: bool, count: int = 1, button: str = "left"):
    await wait_enabled(page, element, strict=False)
    x, y, _ = await target_point(page, element, humanize)
    mouse = page.input.mouse
    which = mouse_button(button)
    async def press():
        if humanize or count == 1:
            return await mouse.click(x, y, button=which, click_count=count, humanize=humanize)
        for number in range(1, count + 1):
            await mouse.click(x, y, button=which, click_count=number, humanize=False)

    await expect_input(page, element.frame, lambda: page.input.gesture("click", press), {"mousedown": count, "mouseup": count}, "The click")


async def hover(page, element, humanize: bool):
    x, y, _ = await target_point(page, element, humanize, check_cover=False)
    await expect_input(page, element.frame, lambda: page.input.gesture("hover", lambda: page.input.mouse.move(x, y, humanize=humanize)),
                       {"mousemove": 1}, "The hover")


async def focus_field(page, element, info, humanize: bool, tolerate_detach: bool = False):
    from ardia_cli.browse.errors import CdpError

    try:
        if humanize and not info.get("focused"):
            await click(page, element, True)
        else:
            await page.focus_element(element)
    except CdpError as error:
        if not tolerate_detach or "focusable" not in error.cdp_message:
            raise


REPLACEMENT = """(old) => {
  const active = document.activeElement;
  if (!active || active === old || active === document.body) return null;
  const info = ardiaBrowse.info(active);
  if (!info.editable || info.disabled) return null;
  const keys = ["id", "name", "placeholder", "aria-label", "title"];
  const same = active.tagName === old.tagName && (active.type || "") === (old.type || "")
    && keys.some((key) => old.getAttribute(key) && old.getAttribute(key) === active.getAttribute(key));
  return same ? active : null;
}"""


async def settle_focus(page, element, loader: str | None):
    connected = await page.call("(el) => el.isConnected", element, frame=element.frame)
    if connected:
        return element, False
    await page.refresh_frames()
    if page.loader(element.frame) != loader:
        raise BrowseError(f"The page navigated when {element.label} was focused, so nothing was typed", code="element_replaced")
    remote = await page.call(REPLACEMENT, element, frame=element.frame, by_value=False)
    replacement = await page.element_from(remote, element.frame, f"the field that replaced {element.label}")
    if replacement is None:
        raise BrowseError(
            f"{element.label} was replaced when it was focused, and focus didn't land on a matching field in the same page, "
            "so nothing was typed. Snapshot again and use the new ref",
            code="element_replaced",
        )
    return replacement, True


async def type_into(page, element, text: str, humanize: bool, guard=None):
    keyboard = page.input.keyboard(element=element, guard=guard)
    await expect_input(page, element.frame, lambda: page.input.gesture("type", lambda: keyboard.type_text(text, humanize=humanize)),
                       {"keydown": len(text), "keyup": len(text)}, "The typing")


async def clear_field(page, element, humanize: bool):
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if not info.get("value"):
        return
    await expect_input(page, element.frame, lambda: page.input.gesture("clear", lambda: page.input.press_combo("Meta+a", humanize)),
                       {"keydown": 2}, "Select all")
    await expect_input(page, element.frame, lambda: page.input.gesture("clear", lambda: page.input.press_combo("Backspace", humanize)),
                       {"keydown": 1}, "Backspace")
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if info.get("value"):
        raise BrowseError(f"Couldn't clear {element.label}; it still holds text")


async def fill(page, element, text: str, humanize: bool, guard=None):
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if info.get("disabled"):
        await wait_enabled(page, element)
        info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if info.get("tag") == "select" and guard is None:
        return False, await pick_option(page, element, text)
    if not info.get("editable") or info.get("disabled"):
        cell = await cell_of(page, element) if guard is None else None
        if cell is not None:
            return False, await fill_cell(page, element, cell, text, humanize)
        raise BrowseError(f"Element {element.label} isn't an editable field", code="not_editable")
    if info.get("tag") == "input" and info.get("type") in fields.SET_DIRECTLY:
        return False, await set_value(page, element, info["type"], text)
    loader = page.loader(element.frame)
    await focus_field(page, element, info, humanize, tolerate_detach=True)
    element, retargeted = await settle_focus(page, element, loader)
    await clear_field(page, element, humanize)
    if text and inserts_at_once(info, humanize, guard) and await plain_input(page, element, info):
        await insert_text(page, element, text)
    elif text:
        await type_into(page, element, text, humanize, guard)
    return retargeted, None


def inserts_at_once(info: dict, humanize: bool, guard) -> bool:
    if humanize or guard is not None:
        return False
    if info.get("tag") == "input":
        return (info.get("type") or "text") in INSERTED_INPUT_TYPES
    return info.get("tag") == "textarea" or bool(info.get("editable"))


async def plain_input(page, element, info: dict) -> bool:
    if info.get("tag") != "input":
        return True
    return await combo_kind(page, element) is None


async def pick_option(page, element, text: str) -> str:
    options = await page.call(
        "(el) => Array.from(el.options).filter((o) => !o.disabled).map((o) => ({ text: (o.label || o.textContent || '').trim(), exact: [o.value] }))",
        element, frame=element.frame, read=True,
    )
    try:
        index = pick_suggestion(text, options or [], element.label)
    except BrowseError as error:
        raise BrowseError(error.message.replace("suggestion", "option"), data=error.data, code=error.code) from None
    await select(page, element, [options[index]["exact"][0]])
    command_metrics.flag("fill_picked_option", True)
    return options[index]["text"]


async def cell_of(page, element):
    remote = await page.call(CELL_OF, element, frame=element.frame, by_value=False, read=True)
    return await page.element_from(remote, element.frame, f"the cell of {element.label}") if isinstance(remote, dict) else None


async def press_key(page, frame, key: str, humanize: bool):
    await expect_input(page, frame, lambda: page.input.gesture("press", lambda: page.input.press_combo(key, humanize)), {"keydown": 1}, "The key press")


async def poll(check, timeout: float):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        found = await check()
        if found or loop.time() >= deadline:
            return found
        await asyncio.sleep(POLL)


async def cell_editor(page, cell, humanize: bool):
    started = await page.call(CELL_START, cell, frame=cell.frame)
    if started.get("inner"):
        inner = await page.call(CELL_INNER, frame=cell.frame, by_value=False)
        field = await page.element_from(inner, cell.frame, f"the field in {cell.label}")
        if field is not None:
            return started["was"], field, bool(started.get("open"))

    await scroll_into_view(page, cell, humanize)
    await page.call(SETTLED_FRAMES, frame=cell.frame, read=True)
    await page.call(CELL_REVEAL, frame=cell.frame)
    await page.call(SETTLED_FRAMES, frame=cell.frame, read=True)
    found = await page.call(CELL_FIND, frame=cell.frame, by_value=False, read=True)
    shown = await page.element_from(found, cell.frame, cell.label) if isinstance(found, dict) else None
    if shown is None:
        raise BrowseError(f"The grid redrew {cell.label} when it scrolled into view, and the cell couldn't be found again; snapshot and retry",
                          code="element_replaced")

    async def focused():
        remote = await page.call(CELL_EDITOR, shown, frame=shown.frame, by_value=False, read=True)
        return await page.element_from(remote, shown.frame, f"the editor of {cell.label}") if isinstance(remote, dict) else None

    await click(page, shown, humanize, 2)
    editor = await poll(focused, EDITOR_WAIT)
    if editor is None:
        await press_key(page, cell.frame, "Enter", humanize)
        editor = await poll(focused, EDITOR_WAIT)
    if editor is None:
        raise BrowseError(
            f"Double-clicking {cell.label} and pressing Enter opened no editor, so nothing was typed. Snapshot to see what it "
            "opened, or focus the cell and use `keyboard type <text>` then `press Enter`",
            code="not_editable",
        )
    return started["was"], editor, True


async def set_editor(page, editor, text: str, humanize: bool):
    kind = await combo_kind(page, editor)
    if kind == "select":
        await pick_option(page, editor, text)
    elif kind == "datalist":
        known = await page.call("(el) => ardiaBrowse.datalistValues(el)", editor, frame=editor.frame, read=True) or []
        items = [{"text": item, "pieces": []} for item in known]
        levels = [match_level(text, item) for item in items]
        best = max(levels, default=0)
        await fill(page, editor, known[levels.index(best)] if best and levels.count(best) == 1 else text, humanize)
    elif kind in ("typeahead", "button"):
        await choose(page, editor, [text], humanize, editor.label)
    else:
        await fill(page, editor, text, humanize)


async def commit_cell(page, editor, humanize: bool):
    state = await page.call(CELL_EDITOR_STATE, editor, frame=editor.frame, read=True)
    if not state.get("open"):
        return
    await press_key(page, editor.frame, "Enter", humanize)

    async def closed():
        now = await page.call(CELL_EDITOR_STATE, editor, frame=editor.frame, read=True)
        return None if now.get("open") else True

    if await poll(closed, COMMIT_WAIT):
        return
    state = await page.call(CELL_EDITOR_STATE, editor, frame=editor.frame, read=True)
    with contextlib.suppress(BrowseError):
        await press_key(page, editor.frame, "Escape", humanize)
    said = f": {state['message'].rstrip('.')}" if state.get("message") else ""
    raise BrowseError(
        f"The cell's editor stayed open after Enter{said}. The edit was cancelled (Escape), so the cell keeps its old value",
        data={"message": state.get("message") or None}, code="rejected",
    )


async def fill_cell(page, element, cell, text: str, humanize: bool) -> dict | None:
    cell.label = element.label
    was, editor, opened = await cell_editor(page, cell, humanize)
    names = await page.call("(el) => ardiaBrowse.labelText(el)", editor, frame=editor.frame, read=True) or []
    name = next((" ".join(str(item).split()) for item in names if str(item).strip()), "")
    await set_editor(page, editor, text, humanize)
    command_metrics.add("cell_edits")
    if not opened:
        return None
    await commit_cell(page, editor, humanize)
    now = await page.call(CELL_NOW, frame=cell.frame, read=True)
    return {"cell": name or element.label, "value": now, "was": was}


async def insert_text(page, element, text: str):
    command_metrics.flag("fill_inserted_text", True)
    await expect_input(page, element.frame, lambda: page.input.gesture("fill", lambda: page.send("Input.insertText", {"text": text}, input_event=True)),
                       {"beforeinput|input": 1}, "The text insert")


async def set_value(page, element, kind: str, text: str) -> str:
    wanted = fields.normalize(kind, text)
    await page.focus_element(element)
    outcome = await page.call(fields.SET_VALUE, element, wanted, frame=element.frame)
    stored = outcome.get("stored")
    if not outcome.get("set"):
        raise BrowseError(
            f"The {kind} input {element.label} refused {wanted!r} (it holds {stored!r}); {fields.FORMATS[kind]}",
            data={"value": stored}, code="bad_value",
        )
    return stored


async def type_text(page, element, text: str, humanize: bool):
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    loader = page.loader(element.frame)
    await focus_field(page, element, info, humanize, tolerate_detach=True)
    element, retargeted = await settle_focus(page, element, loader)
    await type_into(page, element, text, humanize)
    return retargeted


async def set_checked(page, element, wanted: bool, humanize: bool):
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if info.get("checked") == wanted:
        return
    if info.get("disabled"):
        await wait_enabled(page, element)
    target = element
    try:
        await target_point(page, element, humanize, check_cover=False)
    except BrowseError as error:
        if error.code != "not_visible":
            raise
        label = await page.call("(el) => (el.labels && el.labels[0]) || null", element, frame=element.frame, by_value=False)
        target = await page.element_from(label, element.frame, f"label of {element.label}")
        if target is None:
            raise
    await click(page, target, humanize)
    await asyncio.sleep(0.05)
    info = await page.call("(el) => ardiaBrowse.info(el)", element, frame=element.frame)
    if info.get("checked") != wanted:
        raise BrowseError(f"Clicking {element.label} didn't {'check' if wanted else 'uncheck'} it")


async def select(page, element, values: list[str]):
    await wait_enabled(page, element)
    await page.focus_element(element)
    return await page.call("(el, values) => ardiaBrowse.selectOptions(el, values)", element, values, frame=element.frame)


def plain(text) -> str:
    return " ".join(str(text or "").split()).casefold()


def match_level(value: str, item: dict) -> int:
    wanted = plain(value)
    if not wanted:
        return 0
    exact = [item["text"], *(item.get("exact") or [])]
    exact += [email for value in exact for email in EMAIL.findall(value)]
    if any(plain(value) == wanted for value in exact):
        return EXACT
    if any(plain(piece) == wanted for piece in item.get("pieces") or []):
        return 2
    return 1 if wanted in plain(item["text"]) else 0


def exact_pick(value: str, items: list[dict]) -> int | None:
    exact = [index for index, item in enumerate(items) if match_level(value, item) == EXACT]
    return exact[0] if len(exact) == 1 else None


def pick_suggestion(value: str, items: list[dict], where: str) -> int:
    levels = [match_level(value, item) for item in items]
    best = max(levels, default=0)
    listed = ", ".join(f'"{item["text"]}"' for item in items[:MAX_SUGGESTIONS]) + (f" (and {len(items) - MAX_SUGGESTIONS} more)" if len(items) > MAX_SUGGESTIONS else "")
    if best == 0:
        if not items:
            raise BrowseError(f'No suggestions appeared in {where} for "{value}"', data={"suggestions": []}, code="no_match")
        raise BrowseError(f'None of the suggestions in {where} match "{value}": {listed}', data={"suggestions": [item["text"] for item in items]}, code="no_match")
    top = [index for index, level in enumerate(levels) if level == best]
    if len(top) > 1:
        names = ", ".join(f'"{items[index]["text"]}"' for index in top[:MAX_SUGGESTIONS])
        raise BrowseError(
            f'"{value}" matches {len(top)} suggestions in {where}: {names}. Give the full text or the email to pick one',
            data={"suggestions": [items[index]["text"] for index in top]}, code="ambiguous",
        )
    return top[0]


def unique_match(value: str, items: list[dict]) -> bool:
    try:
        pick_suggestion(value, items, "")
    except BrowseError:
        return False
    return True


async def combo_kind(page, element) -> str | None:
    return await page.call("(el) => ardiaBrowse.comboKind(el)", element, frame=element.frame, read=True)


async def suggestions_now(page, element):
    remote = await page.call("(el) => ardiaBrowse.suggestions(el)", element, frame=element.frame, by_value=False, read=True)
    items = await page.call("() => globalThis.ardiaBrowseSuggestions || []", frame=element.frame, read=True)
    options = await page.elements_from(remote, element.frame, "suggestion", 200)
    return options, items[: len(options)]


async def unlinked_note(page, element) -> str:
    linked = await page.call("(el) => ardiaBrowse.popupsOf(el).length", element, frame=element.frame, read=True)
    if linked:
        return ""
    lists = await page.call("(el) => ardiaBrowse.unlinkedListboxes(el)", element, frame=element.frame, read=True)
    shown = f" (visible lists: {', '.join(lists)})" if lists else ""
    return ("no list of suggestions is linked to this field (aria-controls, aria-owns, aria-activedescendant, or one inside the same "
            f"component){shown}, so picking one automatically could pick another field's option. Click the option yourself: "
            "find role option click --name <text>")


async def watch_suggestions(page, element):
    await page.call("(el) => ardiaBrowse.watchSuggestions(el)", element, frame=element.frame)


async def unwatch_suggestions(page, element):
    with contextlib.suppress(BrowseError):
        await page.call("(el) => ardiaBrowse.unwatchSuggestions(el)", element, frame=element.frame)


def suggestions_ready(watch: dict) -> bool:
    return (not watch["busy"] and watch["changed"] > 0 and watch["changed"] >= watch["since"]
            and (watch["now"] - watch["changed"]) / 1000 >= SUGGESTION_SETTLE)


def quiet(watch: dict) -> bool:
    return not watch["busy"] and (watch["now"] - max(watch["changed"], watch["since"])) / 1000 >= SUGGESTION_SETTLE


async def settled_suggestions(page, element, timeout: float, value: str | None = None):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        watch = await page.call("(el) => ardiaBrowse.suggestionState(el)", element, frame=element.frame, read=True)
        if suggestions_ready(watch):
            options, items = await suggestions_now(page, element)
            return options, items, True
        if value is not None and quiet(watch):
            options, items = await suggestions_now(page, element)
            if exact_pick(value, items) is not None:
                return options, items, False
        if loop.time() >= deadline:
            options, items = await suggestions_now(page, element)
            return options, items, False
        await asyncio.sleep(0.1)


async def stale_refusal(page, element, value: str, items: list[dict], where: str, timeout: float) -> BrowseError:
    unlinked = await unlinked_note(page, element)
    if unlinked:
        return BrowseError(f"Nothing was picked in {where}: {unlinked}", code="no_fresh_suggestions")
    listed = ", ".join(f'"{item["text"]}"' for item in items[:MAX_SUGGESTIONS])
    showing = f" What's showing: {listed}." if items else ""
    return BrowseError(
        f'The suggestions in {where} didn\'t change within {timeout:g} s after typing "{value}", so they may be for an earlier query, and '
        f"none matches it exactly, so nothing was picked.{showing} Pick with the exact text or email, or click an option yourself "
        "(find role option click --name <text>)",
        data={"suggestions": [item["text"] for item in items]}, code="no_fresh_suggestions",
    )


async def choose(page, element, values: list[str], humanize: bool, where: str, timeout: float = SUGGESTION_TIMEOUT) -> list[dict]:
    kind = await combo_kind(page, element)
    if kind is not None:
        await wait_enabled(page, element)
    if kind is None:
        raise BrowseError(f"{element.label} isn't a <select> or a combobox, so there's nothing to pick from; use fill or click", code="not_selectable")
    picked = []
    for value in values:
        if kind == "datalist":
            known = await page.call("(el) => ardiaBrowse.datalistValues(el)", element, frame=element.frame, read=True)
            index = pick_suggestion(value, [{"text": item, "pieces": []} for item in known], where)
            await fill(page, element, known[index], humanize)
            picked.append({"value": value, "picked": known[index]})
            continue
        await watch_suggestions(page, element)
        try:
            if kind == "typeahead":
                await fill(page, element, value, humanize)
                options, items, fresh = await settled_suggestions(page, element, timeout, value)
            else:
                expanded = await page.call("(el) => el.getAttribute('aria-expanded') === 'true'", element, frame=element.frame, read=True)
                if not expanded:
                    await click(page, element, humanize)
                    options, items, fresh = await settled_suggestions(page, element, timeout, value)
                else:
                    options, items = await suggestions_now(page, element)
                    fresh = True
            if not fresh and exact_pick(value, items) is None:
                raise await stale_refusal(page, element, value, items, where, timeout)
        finally:
            await unwatch_suggestions(page, element)
        index = exact_pick(value, items) if not fresh else pick_suggestion(value, items, where)
        option = options[index]
        option.label = f'the suggestion "{items[index]["text"]}"'
        await click(page, option, humanize)
        picked.append({"value": value, "picked": items[index]["text"]})
    return picked


class DragInterception:
    def __init__(self, page, source_frame: str, target_frame: str):
        self.page = page
        self.source_frame = source_frame
        self.target_frame = target_frame
        self.intercepted: asyncio.Future | None = None
        self.data: dict | None = None
        self.ended = False
        self.position = (0.0, 0.0)
        self.before: dict = {}
        self.before_source: dict = {}
        self.cleanup: asyncio.Future | None = None
        self.cleaned = True

    async def start(self):
        self.before = await input_counts(self.page, self.target_frame)
        self.before_source = self.before if self.source_frame == self.target_frame else await input_counts(self.page, self.source_frame)
        self.intercepted = asyncio.get_running_loop().create_future()
        self.page.drag_intercepted = self.intercepted
        self.cleaned = False
        try:
            await self.page.send("Input.setInterceptDrags", {"enabled": True})
        except Gated as error:
            self.page.drag_intercepted = None
            self.cleaned = True
            raise error.during("drag", DRAG_GATED) from None
        except BaseException:
            await self.finish()
            raise
        self.page.input.mouse.interception = self

    async def dispatch(self, kind: str, x: float, y: float, timeout: float = 30):
        await self.page.send("Input.dispatchDragEvent", {"type": kind, "x": int(round(x)), "y": int(round(y)), "data": self.data, "modifiers": 0},
                             input_event=True, timeout=timeout)

    async def page_started_drag(self) -> bool:
        try:
            now = await self.page.call("() => ardiaBrowse.inputWatch()", frame=self.source_frame, timeout=CLEANUP_TIMEOUT)
        except BrowseError:
            return False
        return now.get("dragstart", 0) > self.before_source.get("dragstart", 0)

    async def handed_over(self) -> dict:
        try:
            return await asyncio.wait_for(asyncio.shield(self.intercepted), INTERCEPT_TIMEOUT)
        except asyncio.TimeoutError:
            raise OutcomeUnknown("drag", "the page started an HTML5 drag, but Ardia didn't hand it over in time") from None

    async def moved(self, x: float, y: float):
        self.position = (x, y)
        if self.data is None and self.intercepted.done():
            self.data = self.intercepted.result()
            await self.dispatch("dragEnter", x, y)

    async def over(self, x: float, y: float):
        self.position = (x, y)
        await self.dispatch("dragOver", x, y)

    async def release(self, x: float, y: float):
        self.position = (x, y)
        if self.ended:
            return
        if self.data is None:
            if not self.intercepted.done() and not await self.page_started_drag():
                return
            self.data = await self.handed_over()
            await self.dispatch("dragEnter", x, y)
        await self.dispatch("dragOver", x, y)
        await self.dispatch("drop", x, y)
        self.ended = True

    async def _clean(self):
        page = self.page
        if page.input.mouse is not None:
            page.input.mouse.interception = None
        try:
            try:
                if self.data is None and not self.ended:
                    if self.intercepted.done():
                        self.data = self.intercepted.result()
                    elif await self.page_started_drag():
                        with contextlib.suppress(asyncio.TimeoutError):
                            self.data = await asyncio.wait_for(asyncio.shield(self.intercepted), INTERCEPT_TIMEOUT)
                if self.data is not None and not self.ended:
                    await self.dispatch("dragCancel", *self.position, timeout=CLEANUP_TIMEOUT)
                    self.ended = True
            finally:
                await page.input.release_held()
        finally:
            if page.drag_intercepted is self.intercepted:
                page.drag_intercepted = None
            await page.send("Input.setInterceptDrags", {"enabled": False}, timeout=CLEANUP_TIMEOUT)
            self.cleaned = True

    async def finish(self):
        if self.cleanup is None:
            self.cleanup = asyncio.ensure_future(self._clean())
            CLEANUPS.add(self.cleanup)
            self.cleanup.add_done_callback(CLEANUPS.discard)
        try:
            await asyncio.shield(self.cleanup)
        except asyncio.CancelledError:
            with contextlib.suppress(BaseException):
                await asyncio.wait([self.cleanup])
            raise
        except Exception:
            pass

    async def dropped(self) -> bool | None:
        try:
            now = await input_counts(self.page, self.target_frame)
        except BrowseError:
            return None
        return now.get("drop", 0) > self.before.get("drop", 0)


async def draggable(page, element) -> bool:
    return bool(await page.call(
        "(el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (n.draggable || n.getAttribute('draggable') === 'true') return true; return false; }",
        element, frame=element.frame, read=True,
    ))


def interrupted_drag(error: BrowseError) -> BrowseError:
    if error.code in ("input_not_delivered", "input_unconfirmable", "tab_hidden", "policy_refused"):
        return error
    return OutcomeUnknown("drag", f"the drag was interrupted ({error.message}); any held button was released at the last position")


def drop_point(box: tuple, source: tuple, side: str | None) -> tuple[float, float]:
    left, top, right, bottom = box
    cx, cy = (left + right) / 2, (top + bottom) / 2
    vertical = abs(cy - source[1]) >= abs(cx - source[0])
    forward = cy > source[1] if vertical else cx > source[0]
    after = forward if side is None else side == "after"
    share = DRAG_FAR_SHARE if after else 1 - DRAG_FAR_SHARE
    if vertical:
        return cx, top + (bottom - top) * share
    return left + (right - left) * share, cy


async def element_box(page, element) -> tuple | None:
    quads = (await page.send("DOM.getContentQuads", {"backendNodeId": element.backend_id})).get("quads") or []
    best = None
    for quad in quads:
        xs, ys = quad[0::2], quad[1::2]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > 1 and (best is None or area > best[0]):
            best = (area, min(xs), min(ys), max(xs), max(ys))
    return best[1:] if best else None


async def list_before(page, source, target) -> dict | None:
    if source.frame != target.frame:
        return None
    found = await page.call(LIST_BEFORE, source, target, frame=source.frame)
    return found if isinstance(found, dict) else None


async def list_after(page, frame: str, before: dict) -> dict | None:
    try:
        found = await page.call(LIST_AFTER, frame=frame, read=True)
    except BrowseError:
        return None
    if not isinstance(found, dict):
        return None
    command_metrics.flag("drag_list_position", True)
    return {"from": before["from"], "to": found["to"], "count": found["count"]}


async def drag(page, source, target, humanize: bool, side: str | None = None) -> dict:
    interception = DragInterception(page, source.frame, target.frame) if await draggable(page, source) else None
    if interception is not None:
        await interception.start()
    mouse = page.input.mouse
    try:
        x1, y1, _ = await target_point(page, source, humanize)
        x2, y2, _ = await target_point(page, target, humanize, check_cover=False)
        box = await element_box(page, target)
        if box is not None:
            x2, y2 = drop_point(box, (x1, y1), side)

        async def run():
            try:
                await mouse.drag(x1, y1, x2, y2, humanize=humanize)
            finally:
                if interception is not None:
                    await interception.finish()

        needs = {"mousedown": 1, "mouseup": 1} if interception is None else {"mousedown": 1, "dragend|mouseup": 1}
        try:
            await expect_input(page, source.frame, lambda: page.input.gesture("drag", run), needs, "The drag")
        except asyncio.CancelledError:
            raise
        except OutcomeUnknown:
            raise
        except BrowseError as error:
            raise interrupted_drag(error) from None
    finally:
        if interception is not None:
            await interception.finish()
    if interception is None:
        return {"html5": False}
    started = interception.data is not None
    outcome = {"html5": True, "started": started, "dropped": await interception.dropped() if started else False}
    if not interception.cleaned:
        outcome["interceptionLeftOn"] = True
    return outcome


async def scroll(page, direction: str, amount: float, humanize: bool, selector_element=None):
    direction = (direction or "down").lower()
    if direction not in ("up", "down", "left", "right"):
        raise BrowseError(f"Unknown scroll direction: {direction} (up, down, left or right)")
    vertical = direction in ("up", "down")
    distance = amount if direction in ("down", "right") else -amount
    point = None
    frame = None
    if selector_element is not None:
        r = await rect(page, selector_element)
        ox, oy = await frame_offset(page, selector_element.frame)
        point = (ox + r["x"] + r["width"] * random.uniform(0.35, 0.65), oy + r["y"] + r["height"] * random.uniform(0.35, 0.65))
        frame = selector_element.frame
    needs = {} if distance == 0 or not await page.takes_input() else {"wheel": 1}
    await expect_input(page, frame, lambda: page.input.gesture("scroll", lambda: scroll_wheel(page, distance, vertical, humanize, point, frame, selector_element), allow_hidden=True),
                       needs, "The scroll")
