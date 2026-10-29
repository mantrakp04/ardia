import json
import sys

import dbus


def plain(value):
    if isinstance(value, (dbus.Boolean,)):
        return bool(value)
    if isinstance(value, (dbus.Byte, dbus.Int16, dbus.Int32, dbus.Int64, dbus.UInt16, dbus.UInt32, dbus.UInt64)):
        return int(value)
    if isinstance(value, dbus.Double):
        return float(value)
    if isinstance(value, (dbus.String, dbus.ObjectPath, dbus.Signature)):
        return str(value)
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


def main():
    address, dest, path, iface, method, args = sys.argv[1:7]
    signature = sys.argv[7] if len(sys.argv) > 7 else None
    bus = dbus.bus.BusConnection(address)
    proxy = bus.get_object(dest, path, introspect=signature is None)
    call = proxy.get_dbus_method(method, iface)
    options = {"timeout": 30}
    if signature is not None:
        options["signature"] = signature
    result = call(*json.loads(args), **options)
    print(json.dumps(plain(result)))


main()
