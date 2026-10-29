import json
import os
import socket
import struct
import subprocess
import sys
import time

KEYS = {
    "escape": 1, "esc": 1, "minus": 12, "equal": 13, "backspace": 14, "tab": 15, "bracketleft": 26, "bracketright": 27,
    "return": 28, "enter": 28, "ctrl": 29, "control": 29, "semicolon": 39, "apostrophe": 40, "grave": 41, "shift": 42,
    "backslash": 43, "comma": 51, "period": 52, "slash": 53, "alt": 56, "space": 57, "capslock": 58, "home": 102,
    "up": 103, "pageup": 104, "prior": 104, "left": 105, "right": 106, "end": 107, "down": 108, "pagedown": 109,
    "next": 109, "insert": 110, "delete": 111, "ralt": 100, "altgr": 100, "compose": 100, "super": 125, "logo": 125, "meta": 125, "menu": 127,
}
for index, letter in enumerate("qwertyuiop"):
    KEYS[letter] = 16 + index
for index, letter in enumerate("asdfghjkl"):
    KEYS[letter] = 30 + index
for index, letter in enumerate("zxcvbnm"):
    KEYS[letter] = 44 + index
for index, digit in enumerate("1234567890"):
    KEYS[digit] = 2 + index
for index in range(10):
    KEYS[f"f{index + 1}"] = 59 + index
KEYS["f11"] = 87
KEYS["f12"] = 88
PLAIN = {"-": "minus", "=": "equal", "[": "bracketleft", "]": "bracketright", ";": "semicolon", "'": "apostrophe", "`": "grave", "\\": "backslash", ",": "comma", ".": "period", "/": "slash", " ": "space", "\n": "return", "\t": "tab"}
SHIFTED = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "minus", "+": "equal", "{": "bracketleft", "}": "bracketright", ":": "semicolon", '"': "apostrophe", "~": "grave", "|": "backslash", "<": "comma", ">": "period", "?": "slash"}
MODIFIERS = {"shift": (42, 1), "ctrl": (29, 4), "control": (29, 4), "alt": (56, 8), "super": (125, 64), "logo": (125, 64), "meta": (125, 64)}


def wl_string(text):
    data = text.encode() + b"\0"
    return struct.pack("<I", len(data)) + data + b"\0" * ((4 - len(data) % 4) % 4)


def message(object_id, opcode, payload=b""):
    return struct.pack("<II", object_id, ((8 + len(payload)) << 16) | opcode) + payload


class Keyboard:
    def __init__(self, path, keymap):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(path)
        self.buffer = b""
        self.globals = {}
        self.started = time.monotonic()
        self.mods = 0
        self.sock.sendall(message(1, 1, struct.pack("<I", 2)) + message(1, 0, struct.pack("<I", 3)))
        self.read_until_sync()
        seat = self.globals.get("wl_seat")
        manager = self.globals.get("zwp_virtual_keyboard_manager_v1")
        if not seat or not manager:
            raise SystemExit("the compositor offers no wl_seat or zwp_virtual_keyboard_manager_v1")
        self.sock.sendall(
            message(2, 0, struct.pack("<I", seat[0]) + wl_string("wl_seat") + struct.pack("<II", 1, 4))
            + message(2, 0, struct.pack("<I", manager[0]) + wl_string("zwp_virtual_keyboard_manager_v1") + struct.pack("<II", 1, 5))
            + message(5, 0, struct.pack("<II", 4, 6))
        )
        self.load_keymap(keymap)

    def load_keymap(self, keymap):
        data = keymap.encode() + b"\0"
        fd = os.memfd_create("ardia-keymap")
        os.write(fd, data)
        os.lseek(fd, 0, 0)
        self.sock.sendmsg([message(6, 0, struct.pack("<II", 1, len(data)))], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, struct.pack("i", fd))])
        os.close(fd)
        self.roundtrip()

    def read_until_sync(self):
        while True:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise SystemExit("the compositor closed the connection")
            self.buffer += chunk
            while len(self.buffer) >= 8:
                object_id, word = struct.unpack_from("<II", self.buffer)
                size = word >> 16
                if len(self.buffer) < size:
                    break
                body = self.buffer[8:size]
                opcode = word & 0xFFFF
                self.buffer = self.buffer[size:]
                if object_id == 2 and opcode == 0:
                    name, length = struct.unpack_from("<II", body)
                    interface = body[8:8 + length - 1].decode()
                    version = struct.unpack_from("<I", body, 8 + ((length + 3) // 4) * 4)[0]
                    self.globals[interface] = (name, version)
                elif object_id == 1 and opcode == 0:
                    raise SystemExit(f"Wayland error {body!r}")
                elif object_id == self.sync_id and opcode == 0:
                    return

    sync_id = 3

    def roundtrip(self):
        self.sync_id = max(self.sync_id, 6) + 1
        self.sock.sendall(message(1, 0, struct.pack("<I", self.sync_id)))
        self.read_until_sync()

    def now(self):
        return int((time.monotonic() - self.started) * 1000) & 0xFFFFFFFF

    def key(self, code, pressed):
        self.sock.sendall(message(6, 1, struct.pack("<III", self.now(), code, 1 if pressed else 0)))

    def modifiers(self):
        self.sock.sendall(message(6, 2, struct.pack("<IIII", self.mods, 0, 0, 0)))

    def press_mod(self, name, pressed):
        code, mask = MODIFIERS[name]
        self.key(code, pressed)
        self.mods = (self.mods | mask) if pressed else (self.mods & ~mask)
        self.modifiers()

    def tap(self, code, hold=0.012):
        self.key(code, True)
        self.roundtrip()
        time.sleep(hold)
        self.key(code, False)
        self.roundtrip()

    def combo(self, text):
        parts = [p.lower() for p in text.split("+")]
        name = parts.pop()
        mods = [m for m in parts if m in MODIFIERS]
        for mod in mods:
            self.press_mod(mod, True)
        self.roundtrip()
        self.tap(KEYS[name])
        for mod in reversed(mods):
            self.press_mod(mod, False)
        self.roundtrip()

    def type(self, text, delay):
        for char in text:
            shifted = char.isupper() or char in SHIFTED
            name = SHIFTED.get(char) or PLAIN.get(char) or char.lower()
            if name not in KEYS:
                raise ValueError(f"no key for {char!r}")
            if shifted:
                self.press_mod("shift", True)
            self.tap(KEYS[name])
            if shifted:
                self.press_mod("shift", False)
            self.roundtrip()
            time.sleep(delay)


def compile_keymap(layout="us", variant="", options=""):
    args = ["xkbcli", "compile-keymap", "--layout", layout]
    if variant:
        args += ["--variant", variant]
    if options:
        args += ["--options", options]
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def main():
    runtime, display = sys.argv[1], sys.argv[2]
    keymap = compile_keymap()
    keyboard = Keyboard(os.path.join(runtime, display), keymap)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            if request["op"] == "combo":
                keyboard.combo(request["combo"])
            elif request["op"] == "type":
                keyboard.type(request["text"], request.get("delay", 0.02))
            elif request["op"] == "keymap":
                keyboard.load_keymap(compile_keymap(request.get("layout", "us"), request.get("variant", ""), request.get("options", "")))
            elif request["op"] == "tap":
                keyboard.tap(KEYS[request["key"]])
            elif request["op"] in ("down", "up"):
                pressed = request["op"] == "down"
                if request["key"] in MODIFIERS:
                    keyboard.press_mod(request["key"], pressed)
                else:
                    keyboard.key(KEYS[request["key"]], pressed)
                keyboard.roundtrip()
            print(json.dumps({"ok": True}), flush=True)
        except Exception as error:
            print(json.dumps({"ok": False, "error": str(error)}), flush=True)


main()
