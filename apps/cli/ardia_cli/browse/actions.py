import asyncio
import json
import random

from ardia_cli.browse.errors import BrowseError, Gated, OutcomeUnknown

SCROLL_DEFAULT = 300
DELIVERY_TIMEOUT = 1.5
NOT_DELIVERED = (
    "{action} was sent, but the page received none of its {missing} events. The tab may not be on screen in Ardia "
    "(just switched, or covered by another tab); check it's shown (`ardia browse tab <id> --show`) before trying again"
)
PARTLY_DELIVERED = "the page received only part of it (no {missing} event arrived), so it may have had an effect"


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
    await scroll_into_view(page, element, humanize)
    quads = (await page.send("DOM.getContentQuads", {"backendNodeId": element.backend_id})).get("quads") or []
    best = None
    for quad in quads:
        xs, ys = quad[0::2], quad[1::2]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > 1 and (best is None or area > best[0]):
            best = (area, min(xs), min(ys), max(xs), max(ys))
    if best is None:
        raise BrowseError(f"Element {element.label} has no visible box (hidden or zero-size)", code="not_visible")
    _, left, top, right, bottom = best
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
        if cover:
            raise BrowseError(
                f"Element {element.label} is covered by {cover}; interact with that element first, snapshot again, then retry",
                data={"coveredBy": cover},
                code="covered",
            )
    return cx, cy, info


async def click(page, element, humanize: bool, count: int = 1, button: str = "left"):
    x, y, _ = await target_point(page, element, humanize)
    mouse = page.input.mouse
    which = mouse_button(button)
    await expect_input(page, element.frame, lambda: page.input.gesture("click", lambda: mouse.click(x, y, button=which, click_count=count, humanize=humanize)),
                       {"mousedown": count, "mouseup": count}, "The click")


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
    if info.get("tag") == "select":
        raise BrowseError(f"{element.label} is a <select>; use `ardia browse select {element.label} <value>`")
    if not info.get("editable") or info.get("disabled"):
        raise BrowseError(f"Element {element.label} isn't an editable field", code="not_editable")
    loader = page.loader(element.frame)
    await focus_field(page, element, info, humanize, tolerate_detach=True)
    element, retargeted = await settle_focus(page, element, loader)
    await clear_field(page, element, humanize)
    if text:
        await type_into(page, element, text, humanize, guard)
    return retargeted


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
        raise BrowseError(f"Element {element.label} is disabled")
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
    await page.focus_element(element)
    return await page.call("(el, values) => ardiaBrowse.selectOptions(el, values)", element, values, frame=element.frame)


async def drag(page, source, target, humanize: bool):
    info = await page.call(
        "(el) => { const i = ardiaBrowse.info(el); let n = el; while (n && n.nodeType === 1) { if (n.draggable || n.getAttribute('draggable') === 'true') { i.draggable = true; break; } n = n.parentElement; } return i; }",
        source, frame=source.frame,
    )
    if info.get("draggable"):
        raise Gated(
            "Input.setInterceptDrags",
            "drag",
            "the source is an HTML5 draggable, and without drag interception a synthetic drag would start a real macOS drag session",
        )
    x1, y1, _ = await target_point(page, source, humanize)
    x2, y2, _ = await target_point(page, target, humanize, check_cover=False)
    mouse = page.input.mouse
    try:
        await expect_input(page, source.frame, lambda: page.input.gesture("drag", lambda: mouse.drag(x1, y1, x2, y2, humanize=humanize)),
                           {"mousedown": 1, "mouseup": 1}, "The drag")
    except asyncio.CancelledError:
        raise
    except OutcomeUnknown:
        raise
    except BrowseError as error:
        if error.code in ("input_not_delivered", "input_unconfirmable", "tab_hidden"):
            raise
        raise OutcomeUnknown("drag", f"the drag was interrupted ({error.message}); any held button was released at the last position") from None


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
    needs = {} if distance == 0 or await page.hidden() else {"wheel": 1}
    await expect_input(page, frame, lambda: page.input.gesture("scroll", lambda: scroll_wheel(page, distance, vertical, humanize, point, frame, selector_element), allow_hidden=True),
                       needs, "The scroll")
