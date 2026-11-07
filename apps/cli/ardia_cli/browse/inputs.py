import asyncio
import random

from ardia_cli.browse.errors import ConnectionLost, OutcomeUnknown, Usage

RELEASE_TIMEOUT = 2.0
MODIFIER_BITS = {"Alt": 1, "Control": 2, "Meta": 4, "Shift": 8}
MODIFIER_KEYS = {
    "Alt": ("Alt", "AltLeft", 18),
    "Control": ("Control", "ControlLeft", 17),
    "Meta": ("Meta", "MetaLeft", 91),
    "Shift": ("Shift", "ShiftLeft", 16),
}
MODIFIER_ALIASES = {
    "alt": "Alt", "option": "Alt", "control": "Control", "ctrl": "Control", "meta": "Meta", "cmd": "Meta",
    "command": "Meta", "super": "Meta", "shift": "Shift", "controlormeta": "Meta",
}
NAMED_KEYS = {
    "Enter": ("Enter", "Enter", 13, "\r"),
    "Tab": ("Tab", "Tab", 9, None),
    "Escape": ("Escape", "Escape", 27, None),
    "Backspace": ("Backspace", "Backspace", 8, None),
    "Delete": ("Delete", "Delete", 46, None),
    "Space": (" ", "Space", 32, " "),
    "ArrowUp": ("ArrowUp", "ArrowUp", 38, None),
    "ArrowDown": ("ArrowDown", "ArrowDown", 40, None),
    "ArrowLeft": ("ArrowLeft", "ArrowLeft", 37, None),
    "ArrowRight": ("ArrowRight", "ArrowRight", 39, None),
    "Home": ("Home", "Home", 36, None),
    "End": ("End", "End", 35, None),
    "PageUp": ("PageUp", "PageUp", 33, None),
    "PageDown": ("PageDown", "PageDown", 34, None),
    "Insert": ("Insert", "Insert", 45, None),
    **{f"F{n}": (f"F{n}", f"F{n}", 111 + n, None) for n in range(1, 13)},
}
KEY_ALIASES = {
    "return": "Enter", "esc": "Escape", "del": "Delete", "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft",
    "right": "ArrowRight", "pgup": "PageUp", "pgdn": "PageDown", " ": "Space", "spacebar": "Space",
}
EDITING_SHORTCUTS = {
    ("a",): "selectAll",
    ("z",): "undo",
    ("y",): "redo",
    ("z", "Shift"): "redo",
}


def humanize_default(env: dict) -> bool:
    def on(name: str) -> bool:
        return (env.get(name) or "").strip().lower() not in ("", "0", "false", "no", "off")

    return on("AGENT_BROWSER_HUMANIZE") and not on("AGENT_BROWSER_NO_HUMANIZE")


def parse_key(name: str) -> tuple[str, str, int, str | None]:
    from pydoll.constants import CHAR_TO_KEY_INFO

    canonical = KEY_ALIASES.get(name.lower(), name)
    for known in NAMED_KEYS:
        if known.lower() == canonical.lower():
            return NAMED_KEYS[known]
    modifier = MODIFIER_ALIASES.get(name.lower())
    if modifier:
        key, code, keycode = MODIFIER_KEYS[modifier]
        return key, code, keycode, None
    if len(name) == 1:
        key, code, keycode = CHAR_TO_KEY_INFO.get(name, (name, "", 0))
        return key, code, keycode, name
    raise Usage(f"Unknown key: {name}")


def parse_combo(combo: str) -> tuple[list[str], str | None]:
    parts = combo.split("+") if combo != "+" else ["+"]
    if combo.endswith("++"):
        parts = combo[:-2].split("+") + ["+"]
    parts = [part for part in parts if part != ""] or [combo]
    modifiers = []
    for part in parts[:-1]:
        modifier = MODIFIER_ALIASES.get(part.lower())
        if not modifier:
            raise Usage(f"Unknown modifier in {combo}: {part} (use Control, Alt, Shift or Meta)")
        modifiers.append(modifier)
    last = parts[-1]
    if MODIFIER_ALIASES.get(last.lower()) and not modifiers:
        return [MODIFIER_ALIASES[last.lower()]], None
    parse_key(last)
    return modifiers, last


def steady_keyboard_class():
    from pydoll.interactions.keyboard import Keyboard

    class SteadyKeyboard(Keyboard):
        @staticmethod
        def _should_make_typo() -> bool:
            return False

    return SteadyKeyboard


def human_mouse_class():
    from pydoll.exceptions import CommandExecutionTimeout, WebSocketConnectionClosed
    from pydoll.interactions.mouse import Mouse

    class HumanMouse(Mouse):
        held = None
        interception = None

        async def _dispatch_move(self, x: float, y: float, *, wait: bool = True) -> None:
            interception = self.interception if self._pressed_button is not None else None
            if interception is not None and interception.data is not None:
                await interception.over(x, y)
                self._position = (x, y)
                return
            await super()._dispatch_move(x, y, wait=wait)
            if interception is not None:
                await interception.moved(x, y)

        async def _dispatch_button(self, event_type, button, click_count: int = 1):
            pressed = getattr(event_type, "value", event_type) == "mousePressed"
            if not pressed and self.interception is not None:
                await self.interception.release(*self._position)
            if pressed:
                self.held = button
            await super()._dispatch_button(event_type, button, click_count)
            if not pressed:
                self.held = None

        async def _send(self, command):
            try:
                await super()._send(command)
            except WebSocketConnectionClosed:
                raise ConnectionLost() from None
            except CommandExecutionTimeout:
                raise OutcomeUnknown("the mouse input", "Ardia didn't answer an input event in time") from None

        async def _send_nowait(self, command):
            try:
                await super()._send_nowait(command)
            except WebSocketConnectionClosed:
                raise ConnectionLost() from None

    return HumanMouse


class KeyTarget:
    def __init__(self, page, held: dict):
        self.page = page
        self.held = held

    async def _execute_command(self, command):
        params = command.get("params") or {}
        kind = params.get("type")
        key = params.get("key")
        if kind in ("keyDown", "rawKeyDown"):
            self.held[key] = params
        await self.page.send(command["method"], params, input_event=True)
        if kind == "keyUp":
            self.held.pop(key, None)
        return {}

    async def _execute_commands(self, commands):
        for command in commands:
            await self._execute_command(command)


class FocusedKeyTarget(KeyTarget):
    def __init__(self, page, held: dict, element, guard=None):
        super().__init__(page, held)
        self.element = element
        self.guard = guard

    async def focus(self):
        await self.page.focus_element(self.element)
        if self.guard is not None:
            await self.guard()


class StreamMouse:
    held = None
    _pressed_button = None
    _position = (0.0, 0.0)


class Input:
    def __init__(self, page):
        self.page = page
        self.held_keys: dict = {}
        self.mouse = None

    def bind(self, viewport=None):
        mouse_class = human_mouse_class()
        if self.mouse is None:
            self.mouse = mouse_class(self.page.browser.link, session_id=self.page.session_id)
            width, height = viewport or (1280, 800)
            self.mouse._position = (random.uniform(0.3, 0.7) * width, random.uniform(0.55, 0.9) * height)
        else:
            self.mouse._connection_handler = self.page.browser.link
            self.mouse._session_id = self.page.session_id

    @property
    def holding(self) -> bool:
        return bool(self.held_keys) or (self.mouse is not None and self.mouse.held is not None)

    def keyboard(self, element=None, guard=None):
        keyboard_class = steady_keyboard_class()
        target = FocusedKeyTarget(self.page, self.held_keys, element, guard) if element is not None else KeyTarget(self.page, self.held_keys)
        return keyboard_class(target)

    async def release_held(self):
        for key, params in list(self.held_keys.items()):
            up = {key_name: value for key_name, value in params.items() if key_name in ("key", "code", "windowsVirtualKeyCode")}
            up["type"] = "keyUp"
            try:
                await self.page.send("Input.dispatchKeyEvent", up, input_event=True, timeout=RELEASE_TIMEOUT)
            finally:
                self.held_keys.pop(key, None)
        if self.mouse is not None and self.mouse.held is not None:
            button = self.mouse.held
            x, y = self.mouse._position
            try:
                await self.page.send(
                    "Input.dispatchMouseEvent",
                    {"type": "mouseReleased", "x": int(round(x)), "y": int(round(y)), "button": getattr(button, "value", button), "clickCount": 1},
                    input_event=True, timeout=RELEASE_TIMEOUT,
                )
            finally:
                self.mouse.held = None
                self.mouse._pressed_button = None

    async def release_all(self):
        if not self.holding:
            return True
        try:
            await asyncio.shield(asyncio.wait_for(self.release_held(), RELEASE_TIMEOUT))
            return True
        except BaseException:
            self.held_keys.clear()
            if self.mouse is not None:
                self.mouse.held = None
                self.mouse._pressed_button = None
            return False

    async def gesture(self, action: str, run, keep_held: bool = False, allow_hidden: bool = False):
        if not allow_hidden and not self.holding:
            await self.page.require_visible()
        try:
            result = await run()
        except BaseException as error:
            if self.holding:
                released = await self.release_all()
                if not released and not isinstance(error, (asyncio.CancelledError, ConnectionLost, OutcomeUnknown)):
                    raise OutcomeUnknown(action, "a held key or mouse button couldn't be released") from None
            raise
        if self.holding and not keep_held:
            if not await self.release_all():
                raise OutcomeUnknown(action, "a held key or mouse button couldn't be released")
        return result

    def track_stream_event(self, method: str, params: dict):
        kind = params.get("type")
        if method == "Input.dispatchKeyEvent" and params.get("key"):
            if kind in ("keyDown", "rawKeyDown"):
                self.held_keys[params["key"]] = dict(params)
            elif kind == "keyUp":
                self.held_keys.pop(params["key"], None)
        elif method == "Input.dispatchMouseEvent":
            if self.mouse is None:
                self.mouse = StreamMouse()
            if "x" in params and "y" in params:
                self.mouse._position = (float(params["x"]), float(params["y"]))
            if kind == "mousePressed":
                self.mouse.held = params.get("button") or "left"
            elif kind == "mouseReleased":
                self.mouse.held = None

    async def press_combo(self, combo: str, humanize: bool, down_only: bool = False, up_only: bool = False):
        modifiers, last = parse_combo(combo)
        bits = 0
        hold = (lambda: random.uniform(0.05, 0.12)) if humanize else (lambda: 0)
        gap = (lambda: random.uniform(0.03, 0.08)) if humanize else (lambda: 0)

        async def key_event(kind, key, code, keycode, text=None, commands=None):
            params = {"type": kind, "key": key, "code": code, "windowsVirtualKeyCode": keycode, "modifiers": bits}
            if text is not None and kind == "keyDown":
                params["text"] = text
                params["unmodifiedText"] = text
            if commands:
                params["commands"] = commands
            if kind == "keyDown" and text is None:
                params["type"] = "rawKeyDown"
            if params["type"] in ("keyDown", "rawKeyDown"):
                self.held_keys[key] = params
            await self.page.send("Input.dispatchKeyEvent", params, input_event=True)
            if kind == "keyUp":
                self.held_keys.pop(key, None)

        if not up_only:
            for modifier in modifiers:
                key, code, keycode = MODIFIER_KEYS[modifier]
                bits |= MODIFIER_BITS[modifier]
                await key_event("keyDown", key, code, keycode)
                await asyncio.sleep(gap())
        else:
            for modifier in modifiers:
                bits |= MODIFIER_BITS[modifier]
        if last is not None:
            key, code, keycode, text = parse_key(last)
            if bits & (MODIFIER_BITS["Control"] | MODIFIER_BITS["Meta"] | MODIFIER_BITS["Alt"]):
                text = None
            elif text is not None and bits & MODIFIER_BITS["Shift"] and len(text) == 1:
                text = text.upper()
            commands = None
            if bits & (MODIFIER_BITS["Control"] | MODIFIER_BITS["Meta"]) and len(last) == 1:
                shortcut = (last.lower(),) + (("Shift",) if bits & MODIFIER_BITS["Shift"] else ())
                command = EDITING_SHORTCUTS.get(shortcut)
                commands = [command] if command else None
            if not up_only:
                await key_event("keyDown", key, code, keycode, text, commands)
            if not down_only:
                await asyncio.sleep(hold())
                await key_event("keyUp", key, code, keycode)
        if not down_only:
            for modifier in reversed(modifiers):
                key, code, keycode = MODIFIER_KEYS[modifier]
                bits &= ~MODIFIER_BITS[modifier]
                await asyncio.sleep(gap())
                await key_event("keyUp", key, code, keycode)
