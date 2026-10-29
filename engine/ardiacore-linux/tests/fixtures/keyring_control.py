import json
import os
import subprocess
import sys
import time

import gi

gi.require_version('Gio', '2.0')
gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib

SERVICE = 'org.freedesktop.secrets'
SERVICE_PATH = '/org/freedesktop/secrets'
LOGIN = '/org/freedesktop/secrets/collection/login'
SECRETS = 'org.freedesktop.Secret.Service'
INTERNAL = 'org.gnome.keyring.InternalUnsupportedGuiltRiddenInterface'


def call(bus, path, interface, method, parameters, reply):
    return bus.call_sync(SERVICE, path, interface, method, parameters, GLib.VariantType(reply),
                         Gio.DBusCallFlags.NONE, 10000, None).unpack()


def session(bus):
    return call(bus, SERVICE_PATH, SECRETS, 'OpenSession', GLib.Variant('(sv)', ('plain', GLib.Variant('s', ''))), '(vo)')[1]


def items(bus, schema):
    unlocked, locked = call(bus, SERVICE_PATH, SECRETS, 'SearchItems', GLib.Variant('(a{ss})', ({'xdg:schema': schema},)), '(aoao)')
    secrets = {}
    if unlocked:
        found = call(bus, SERVICE_PATH, SECRETS, 'GetSecrets', GLib.Variant('(aoo)', (unlocked, session(bus))), '(a{o(oayays)})')[0]
        secrets = {path: bytes(value[2]).decode() for path, value in found.items()}
    out = []
    for path, is_locked in [(p, False) for p in unlocked] + [(p, True) for p in locked]:
        attributes = call(bus, path, 'org.freedesktop.DBus.Properties', 'Get',
                          GLib.Variant('(ss)', ('org.freedesktop.Secret.Item', 'Attributes')), '(v)')[0]
        out.append({'locked': is_locked, 'account': attributes.get('account'), 'secret': secrets.get(path)})
    return out


def answer_prompt(answer, password):
    env = {**os.environ, 'DISPLAY': os.environ['PROMPT_DISPLAY']}
    found = subprocess.run(['xdotool', 'search', '--sync', '--onlyvisible', '--class', 'gcr-prompter'], env=env,
                           capture_output=True, text=True, timeout=20)
    window = found.stdout.split()[0]
    title = subprocess.run(['xdotool', 'getwindowname', window], env=env, capture_output=True, text=True, timeout=10).stdout.strip()
    subprocess.run(['xdotool', 'windowfocus', '--sync', window], env=env, timeout=10, check=True)
    if answer == 'unlock':
        subprocess.run(['xdotool', 'type', '--delay', '20', password], env=env, timeout=20, check=True)
        subprocess.run(['xdotool', 'key', 'Return'], env=env, timeout=10, check=True)
    else:
        subprocess.run(['xdotool', 'key', 'Escape'], env=env, timeout=10, check=True)
    for _ in range(100):
        shown = subprocess.run(['xdotool', 'search', '--onlyvisible', '--class', 'gcr-prompter'], env=env,
                               capture_output=True, text=True, timeout=10).stdout.split()
        if window not in shown:
            return title
        time.sleep(0.1)
    raise SystemExit(f'the {title} prompt stayed open')


def main():
    address, command = sys.argv[1], sys.argv[2]
    flags = Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION
    bus = Gio.DBusConnection.new_for_address_sync(address, flags, None, None)
    if command == 'lock':
        call(bus, SERVICE_PATH, SECRETS, 'Lock', GLib.Variant('(ao)', ([LOGIN],)), '(aoo)')
        result = True
    elif command == 'unlock':
        secret = (session(bus), b'', sys.argv[3].encode(), 'text/plain')
        call(bus, SERVICE_PATH, INTERNAL, 'UnlockWithMasterPassword', GLib.Variant('(o(oayays))', (LOGIN, secret)), '()')
        result = True
    elif command == 'locked':
        result = call(bus, LOGIN, 'org.freedesktop.DBus.Properties', 'Get',
                      GLib.Variant('(ss)', ('org.freedesktop.Secret.Collection', 'Locked')), '(v)')[0]
    elif command == 'prompt':
        result = answer_prompt(sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else '')
    elif command == 'items':
        result = items(bus, sys.argv[3])
    else:
        raise SystemExit(f'unknown command {command}')
    print(json.dumps(result))


main()
