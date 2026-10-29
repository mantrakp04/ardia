import json

import dbus

from dbusmock import MOCK_IFACE

BUS_NAME = "org.freedesktop.FileManager1"
MAIN_OBJ = "/org/freedesktop/FileManager1"
MAIN_IFACE = "org.freedesktop.FileManager1"
SYSTEM_BUS = False


def load(mock, parameters):
    mock.ardia_calls = []
    mock.ardia_fail = bool(parameters.get("fail", False))


def _record(self, method, uris, startup_id):
    self.ardia_calls.append({"method": method, "uris": [str(u) for u in uris], "startupId": str(startup_id)})
    if self.ardia_fail:
        raise dbus.exceptions.DBusException("the file manager refused", name="org.freedesktop.DBus.Error.Failed")


@dbus.service.method(MAIN_IFACE, in_signature="ass", out_signature="")
def ShowItems(self, uris, startup_id):
    _record(self, "ShowItems", uris, startup_id)


@dbus.service.method(MAIN_IFACE, in_signature="ass", out_signature="")
def ShowFolders(self, uris, startup_id):
    _record(self, "ShowFolders", uris, startup_id)


@dbus.service.method(MAIN_IFACE, in_signature="ass", out_signature="")
def ShowItemProperties(self, uris, startup_id):
    _record(self, "ShowItemProperties", uris, startup_id)


@dbus.service.method(MOCK_IFACE, in_signature="b", out_signature="")
def SetFail(self, fail):
    self.ardia_fail = bool(fail)


@dbus.service.method(MOCK_IFACE, in_signature="", out_signature="s")
def Calls(self):
    return json.dumps(self.ardia_calls)
