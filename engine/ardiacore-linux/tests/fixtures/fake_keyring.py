import json
import subprocess
import sys
import threading

import gi

gi.require_version('Gio', '2.0')
gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib

SECRETS_XML = '''
<node>
  <interface name="org.freedesktop.Secret.Service">
    <method name="OpenSession"><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="v" direction="out"/><arg type="o" direction="out"/></method>
    <method name="SearchItems"><arg type="a{ss}" direction="in"/><arg type="ao" direction="out"/><arg type="ao" direction="out"/></method>
    <method name="Unlock"><arg type="ao" direction="in"/><arg type="ao" direction="out"/><arg type="o" direction="out"/></method>
    <method name="GetSecrets"><arg type="ao" direction="in"/><arg type="o" direction="in"/><arg type="a{o(oayays)}" direction="out"/></method>
  </interface>
</node>'''

PROMPT_XML = '''
<node>
  <interface name="org.freedesktop.Secret.Prompt">
    <method name="Prompt"><arg type="s" direction="in"/></method>
    <method name="Dismiss"/>
    <signal name="Completed"><arg type="b"/><arg type="v"/></signal>
  </interface>
</node>'''

SESSION_XML = '''
<node>
  <interface name="org.freedesktop.Secret.Session">
    <method name="Close"/>
  </interface>
</node>'''

WALLET_XML = '''
<node>
  <interface name="org.kde.KWallet">
    <method name="isEnabled"><arg type="b" direction="out"/></method>
    <method name="networkWallet"><arg type="s" direction="out"/></method>
    <method name="keyDoesNotExist"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
    <method name="open"><arg type="s" direction="in"/><arg type="x" direction="in"/><arg type="s" direction="in"/><arg type="i" direction="out"/></method>
    <method name="readPassword"><arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
    <method name="close"><arg type="i" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="in"/><arg type="i" direction="out"/></method>
  </interface>
</node>'''

ITEM = '/org/freedesktop/secrets/collection/login/1'
PROMPT = '/org/freedesktop/secrets/prompt/p1'
SESSION = '/org/freedesktop/secrets/session/s1'


class Keyring:
    def __init__(self, config, connection):
        self.config = config
        self.connection = connection
        self.locked = config.get('locked', False)
        self.calls = []

    def secrets(self, connection, sender, path, interface, method, parameters, invocation):
        self.calls.append(method)
        items = self.config.get('items', [])
        if method == 'OpenSession':
            invocation.return_value(GLib.Variant('(vo)', (GLib.Variant('s', ''), SESSION)))
        elif method == 'SearchItems':
            attributes = parameters.unpack()[0]
            found = [ITEM for item in items if all(item['attributes'].get(k) == v for k, v in attributes.items())]
            invocation.return_value(GLib.Variant('(aoao)', ([] if self.locked else found, found if self.locked else [])))
        elif method == 'Unlock':
            if not self.locked:
                invocation.return_value(GLib.Variant('(aoo)', (parameters.unpack()[0], '/')))
            else:
                invocation.return_value(GLib.Variant('(aoo)', ([], PROMPT)))
        elif method == 'GetSecrets':
            if self.locked:
                invocation.return_dbus_error('org.freedesktop.Secret.Error.IsLocked', 'locked')
                return
            secret = items[0]['secret'].encode() if items else b''
            invocation.return_value(GLib.Variant('(a{o(oayays)})', ({ITEM: (SESSION, b'', secret, 'text/plain')},)))

    def prompt(self, connection, sender, path, interface, method, parameters, invocation):
        self.calls.append(method)
        if method != 'Prompt':
            invocation.return_value(None)
            return
        queued = self.config.get('prompts')
        answer = queued.pop(0) if queued else self.config.get('prompt', 'accept')
        if answer == 'fail':
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', 'prompt failed')
            return
        invocation.return_value(None)
        if answer == 'never':
            return
        dismissed = answer != 'accept'
        if not dismissed:
            self.locked = False

        def complete():
            connection.emit_signal(None, PROMPT, 'org.freedesktop.Secret.Prompt', 'Completed',
                                   GLib.Variant('(bv)', (dismissed, GLib.Variant('ao', [] if dismissed else [ITEM]))))
            return False
        GLib.timeout_add(50, complete)

    def session(self, connection, sender, path, interface, method, parameters, invocation):
        self.calls.append('Close')
        invocation.return_value(None)

    def wallet(self, connection, sender, path, interface, method, parameters, invocation):
        self.calls.append(method)
        wallet = self.config['kwallet']
        if method == 'isEnabled':
            invocation.return_value(GLib.Variant('(b)', (wallet.get('enabled', True),)))
        elif method == 'networkWallet':
            invocation.return_value(GLib.Variant('(s)', ('kdewallet',)))
        elif method == 'keyDoesNotExist':
            _, folder, key = parameters.unpack()
            present = folder == wallet.get('folder') and key == wallet.get('key')
            invocation.return_value(GLib.Variant('(b)', (not present,)))
        elif method == 'open':
            invocation.return_value(GLib.Variant('(i)', (wallet.get('handle', 7),)))
        elif method == 'readPassword':
            handle, folder, key, _ = parameters.unpack()
            ok = folder == wallet.get('folder') and key == wallet.get('key')
            invocation.return_value(GLib.Variant('(s)', (wallet.get('secret', '') if ok else '',)))
        elif method == 'close':
            invocation.return_value(GLib.Variant('(i)', (0,)))


def main():
    config = json.loads(open(sys.argv[1][1:]).read() if sys.argv[1].startswith('@') else sys.argv[1])
    command = sys.argv[2:]
    loop = GLib.MainLoop()
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    keyring = Keyring(config, connection)
    owned = []
    if config.get('secretService', True):
        connection.register_object('/org/freedesktop/secrets', Gio.DBusNodeInfo.new_for_xml(SECRETS_XML).interfaces[0], keyring.secrets, None, None)
        connection.register_object(PROMPT, Gio.DBusNodeInfo.new_for_xml(PROMPT_XML).interfaces[0], keyring.prompt, None, None)
        connection.register_object(SESSION, Gio.DBusNodeInfo.new_for_xml(SESSION_XML).interfaces[0], keyring.session, None, None)
        owned.append('org.freedesktop.secrets')
    if 'kwallet' in config:
        connection.register_object('/modules/kwalletd6', Gio.DBusNodeInfo.new_for_xml(WALLET_XML).interfaces[0], keyring.wallet, None, None)
        owned.append('org.kde.kwalletd6')
    for name in owned:
        reply = connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName',
                                     GLib.Variant('(su)', (name, 4)), GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)
        assert reply.unpack()[0] == 1, name
    if command == ['--serve']:
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, lambda: loop.quit() or False)
        print('ready', flush=True)
        loop.run()
        return
    result = {}

    def run():
        done = subprocess.run(command, capture_output=True, text=True, timeout=60)
        result['stdout'] = done.stdout
        result['stderr'] = done.stderr
        result['code'] = done.returncode
        GLib.idle_add(loop.quit)

    threading.Thread(target=run, daemon=True).start()
    loop.run()
    print(json.dumps({'output': result.get('stdout', ''), 'stderr': result.get('stderr', ''), 'code': result.get('code'), 'calls': keyring.calls}))


if __name__ == '__main__':
    main()
