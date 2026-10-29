import json
import time

import dbus

from dbusmock import MOCK_IFACE

BUS_NAME = "org.freedesktop.PolicyKit1"
MAIN_OBJ = "/org/freedesktop/PolicyKit1/Authority"
MAIN_IFACE = "org.freedesktop.PolicyKit1.Authority"
SYSTEM_BUS = True
ERROR_FAILED = "org.freedesktop.PolicyKit1.Error.Failed"
ERROR_CANCELLED = "org.freedesktop.PolicyKit1.Error.Cancelled"


def load(mock, parameters):
    mock.AddProperties(MAIN_IFACE, dbus.Dictionary({"BackendName": "ardia-acceptance", "BackendVersion": "0.126", "BackendFeatures": dbus.UInt32(1)}, signature="sv"))
    mock.ardia_mode = parameters.get("mode", "allow")
    mock.ardia_registered = parameters.get("registered", ["dev.ardia.linux.reauthenticate"])
    mock.ardia_calls = []
    mock.ardia_hanging = {}


def _answer(mode):
    if mode == "allow":
        return (True, False, {})
    if mode == "dismiss":
        return (False, False, {"polkit.dismissed": "true"})
    return (False, False, {})


@dbus.service.method(MAIN_IFACE, in_signature="(sa{sv})sa{ss}us", out_signature="(bba{ss})", async_callbacks=("ok_cb", "err_cb"))
def CheckAuthorization(self, subject, action_id, details, flags, cancellation_id, ok_cb, err_cb):
    call = {"action": str(action_id), "flags": int(flags), "cancellation": str(cancellation_id), "kind": str(subject[0]), "at": time.time(), "mode": self.ardia_mode}
    self.ardia_calls.append(call)
    if str(action_id) not in self.ardia_registered:
        err_cb(dbus.exceptions.DBusException(f"Action {action_id} is not registered", name=ERROR_FAILED))
        return
    if not int(flags) & 1:
        ok_cb((False, True, {}))
        return
    if self.ardia_mode == "hang":
        self.ardia_hanging[str(cancellation_id)] = (ok_cb, err_cb)
        return
    ok_cb(_answer(self.ardia_mode))


@dbus.service.method(MAIN_IFACE, in_signature="s", out_signature="")
def CancelCheckAuthorization(self, cancellation_id):
    self.ardia_calls.append({"cancel": str(cancellation_id), "at": time.time()})
    pending = self.ardia_hanging.pop(str(cancellation_id), None)
    if pending:
        pending[1](dbus.exceptions.DBusException("Authorization request was cancelled", name=ERROR_CANCELLED))


@dbus.service.method(MAIN_IFACE, in_signature="(sa{sv})ss", out_signature="")
def RegisterAuthenticationAgent(self, subject, locale, object_path):
    pass


@dbus.service.method(MOCK_IFACE, in_signature="s", out_signature="")
def SetMode(self, mode):
    self.ardia_mode = str(mode)


@dbus.service.method(MOCK_IFACE, in_signature="", out_signature="s")
def Calls(self):
    return json.dumps(self.ardia_calls)


@dbus.service.method(MOCK_IFACE, in_signature="", out_signature="u")
def Hanging(self):
    return len(self.ardia_hanging)
