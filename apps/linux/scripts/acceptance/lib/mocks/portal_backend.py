import json
import time

import dbus

from dbusmock import MOCK_IFACE

BUS_NAME = "org.freedesktop.impl.portal.desktop.ardiaacceptance"
MAIN_OBJ = "/org/freedesktop/portal/desktop"
MAIN_IFACE = "org.freedesktop.impl.portal.FileChooser"
SYSTEM_BUS = False
SCREENCAST_IFACE = "org.freedesktop.impl.portal.ScreenCast"
APPCHOOSER_IFACE = "org.freedesktop.impl.portal.AppChooser"


def load(mock, parameters):
    mock.ardia_calls = []
    mock.ardia_answers = {"OpenFile": [], "SaveFile": [], "SaveFiles": []}
    mock.ardia_default = parameters.get("default", {"response": 1})
    mock.AddProperties(MAIN_IFACE, dbus.Dictionary({"version": dbus.UInt32(4)}, signature="sv"))


def _plain(value):
    if isinstance(value, dbus.Boolean):
        return bool(value)
    if isinstance(value, (dbus.Byte, dbus.Int16, dbus.Int32, dbus.Int64, dbus.UInt16, dbus.UInt32, dbus.UInt64)):
        return int(value)
    if isinstance(value, dbus.Array) and value.signature == "y":
        return bytes(value).rstrip(b"\0").decode("utf-8", "replace")
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return str(value) if isinstance(value, (dbus.String, dbus.ObjectPath)) else value


def _answer(self, method, handle, app_id, parent, title, options):
    self.ardia_calls.append({"method": method, "handle": str(handle), "appId": str(app_id), "parent": str(parent), "title": str(title), "options": _plain(options), "at": time.time()})
    queue = self.ardia_answers.get(method) or []
    answer = queue.pop(0) if queue else self.ardia_default
    delay = answer.get("delay", 0)
    if delay:
        time.sleep(delay)
    results = {}
    if answer.get("uris"):
        results["uris"] = dbus.Array([dbus.String(u) for u in answer["uris"]], signature="s")
    if answer.get("filter"):
        for name, patterns in options.get("filters", []):
            if str(name) == answer["filter"]:
                results["current_filter"] = dbus.Struct((dbus.String(name), dbus.Array([dbus.Struct((dbus.UInt32(kind), dbus.String(glob)), signature="us") for kind, glob in patterns], signature="(us)")), signature="sa(us)")
    if "choices" in answer:
        results["choices"] = dbus.Array([dbus.Struct((dbus.String(a), dbus.String(b)), signature="ss") for a, b in answer["choices"]], signature="(ss)")
    return (dbus.UInt32(answer.get("response", 0)), dbus.Dictionary(results, signature="sv"))


@dbus.service.method(MAIN_IFACE, in_signature="osssa{sv}", out_signature="ua{sv}")
def OpenFile(self, handle, app_id, parent, title, options):
    return _answer(self, "OpenFile", handle, app_id, parent, title, options)


@dbus.service.method(MAIN_IFACE, in_signature="osssa{sv}", out_signature="ua{sv}")
def SaveFile(self, handle, app_id, parent, title, options):
    return _answer(self, "SaveFile", handle, app_id, parent, title, options)


@dbus.service.method(MAIN_IFACE, in_signature="osssa{sv}", out_signature="ua{sv}")
def SaveFiles(self, handle, app_id, parent, title, options):
    return _answer(self, "SaveFiles", handle, app_id, parent, title, options)


@dbus.service.method(MOCK_IFACE, in_signature="ss", out_signature="")
def Answer(self, method, answer):
    self.ardia_answers.setdefault(str(method), []).append(json.loads(str(answer)))


@dbus.service.method(MOCK_IFACE, in_signature="s", out_signature="")
def SetDefault(self, answer):
    self.ardia_default = json.loads(str(answer))


@dbus.service.method(MOCK_IFACE, in_signature="", out_signature="s")
def Calls(self):
    return json.dumps(self.ardia_calls)
