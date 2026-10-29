import json
import os
import select
import subprocess
import sys
import time

import gi

gi.require_version('Gio', '2.0')
gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib

MANAGER_XML = '''
<node>
  <interface name="org.freedesktop.DBus.ObjectManager">
    <method name="GetManagedObjects"><arg type="a{oa{sa{sv}}}" direction="out"/></method>
    <signal name="InterfacesAdded"><arg type="o"/><arg type="a{sa{sv}}"/></signal>
    <signal name="InterfacesRemoved"><arg type="o"/><arg type="as"/></signal>
  </interface>
</node>'''

FACTORY_XML = '''
<node>
  <interface name="org.gnome.evolution.dataserver.CalendarFactory">
    <method name="OpenCalendar"><arg type="s" direction="in"/><arg type="s" direction="out"/><arg type="s" direction="out"/></method>
  </interface>
</node>'''

CALENDAR_XML = '''
<node>
  <interface name="org.gnome.evolution.dataserver.Calendar">
    <method name="Open"><arg type="as" direction="out"/></method>
    <method name="Close"/>
    <method name="GetObjectList"><arg type="s" direction="in"/><arg type="as" direction="out"/></method>
    <method name="GetTimezone"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
    <method name="GetView"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
  </interface>
</node>'''

VIEW_XML = '''
<node>
  <interface name="org.gnome.evolution.dataserver.CalendarView">
    <method name="Start"/>
    <method name="Stop"/>
    <method name="SetFlags"><arg type="u" direction="in"/></method>
    <method name="Dispose"/>
    <signal name="ObjectsAdded"><arg type="as"/></signal>
    <signal name="ObjectsModified"><arg type="as"/></signal>
    <signal name="ObjectsRemoved"><arg type="as"/></signal>
    <signal name="Complete"><arg type="s"/><arg type="s"/></signal>
  </interface>
</node>'''

CONTROL_XML = '''
<node>
  <interface name="dev.ardia.FakeEds">
    <method name="EmitObjectsModified"><arg type="s" direction="in"/></method>
    <method name="AddSource"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
    <method name="ChangeSource"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
    <method name="ReplaceObjects"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
    <method name="ReleaseBackend"/>
    <method name="Calls"><arg type="s" direction="out"/></method>
  </interface>
</node>'''

PREFIX = 'org.gnome.evolution.dataserver.'
MANAGER = '/org/gnome/evolution/dataserver/SourceManager'
FACTORY = '/org/gnome/evolution/dataserver/CalendarFactory'
BACKEND = PREFIX + 'Subprocess.Backend.Calendarx4242x2'
CONTROL = 'dev.ardia.FakeEds'


def interface(xml):
    return Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0]


class FakeEds:
    def __init__(self, config, connection):
        self.config = config
        self.connection = connection
        self.sources = {source['uid']: source['data'] for source in config.get('sources', [])}
        self.paths = {}
        self.opened = {}
        self.views = {}
        self.calls = []
        self.registrations = []
        self.backend_owned = False
        self.held = []

    def source_path(self, uid):
        if uid not in self.paths:
            self.paths[uid] = f'{MANAGER}/Source_{len(self.paths) + 1}'
        return self.paths[uid]

    def source_interfaces(self, uid):
        return {PREFIX + 'Source': {'UID': GLib.Variant('s', uid), 'Data': GLib.Variant('s', self.sources[uid])}}

    def manager(self, connection, sender, path, iface, method, parameters, invocation):
        self.calls.append(method)
        objects = {self.source_path(uid): self.source_interfaces(uid) for uid in self.sources}
        invocation.return_value(GLib.Variant('(a{oa{sa{sv}}})', (objects,)))

    def factory(self, connection, sender, path, iface, method, parameters, invocation):
        uid = parameters.unpack()[0]
        self.calls.append(f'OpenCalendar {uid}')
        if uid in self.config.get('deniedOpen', []):
            invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'not allowed to open this calendar')
            return
        if uid not in self.sources:
            invocation.return_dbus_error(PREFIX + 'Calendar.NoSuchCalendar', 'no such calendar')
            return
        if uid in self.config.get('hangOpen', []):
            self.held.append(invocation)
            return
        if not self.backend_owned:
            self.own_backend()
        number = len(self.opened) + 1
        calendar = f'/org/gnome/evolution/dataserver/Subprocess/4242/{number}'
        self.opened[calendar] = uid
        self.registrations.append(self.connection.register_object(calendar, interface(CALENDAR_XML), self.calendar, None, None))
        invocation.return_value(GLib.Variant('(ss)', (calendar, BACKEND)))

    def calendar(self, connection, sender, path, iface, method, parameters, invocation):
        uid = self.opened.get(path, '')
        argument = parameters.unpack()[0] if parameters.n_children() else ''
        self.calls.append(f'{method} {uid} {argument}'.rstrip())
        if method == 'Open':
            invocation.return_value(GLib.Variant('(as)', ([],)))
        elif method == 'Close':
            invocation.return_value(None)
        elif method == 'GetObjectList':
            if uid in self.config.get('deniedRead', []):
                invocation.return_dbus_error(PREFIX + 'Calendar.PermissionDenied', 'the account needs signing in again')
                return
            invocation.return_value(GLib.Variant('(as)', (self.config.get('objects', {}).get(uid, []),)))
        elif method == 'GetTimezone':
            zone = self.config.get('timezones', {}).get(argument)
            if zone is None:
                invocation.return_dbus_error(PREFIX + 'Calendar.ObjectNotFound', 'timezone not found')
            else:
                invocation.return_value(GLib.Variant('(s)', (zone,)))
        elif method == 'GetView':
            view = f'{path}/View_{len(self.views) + 1}'
            self.views[view] = uid
            self.registrations.append(self.connection.register_object(view, interface(VIEW_XML), self.view, None, None))
            invocation.return_value(GLib.Variant('(s)', (view,)))

    def view(self, connection, sender, path, iface, method, parameters, invocation):
        argument = parameters.unpack()[0] if parameters.n_children() else ''
        self.calls.append(f'{method} {self.views.get(path, "")} {argument}'.rstrip())
        invocation.return_value(None)

    def control(self, connection, sender, path, iface, method, parameters, invocation):
        if method == 'EmitObjectsModified':
            uid = parameters.unpack()[0]
            for view, owner in self.views.items():
                if owner == uid:
                    connection.emit_signal(None, view, PREFIX + 'CalendarView', 'ObjectsModified', GLib.Variant('(as)', (['BEGIN:VEVENT'],)))
            invocation.return_value(None)
        elif method == 'AddSource':
            uid, data = parameters.unpack()
            self.sources[uid] = data
            connection.emit_signal(None, MANAGER, 'org.freedesktop.DBus.ObjectManager', 'InterfacesAdded',
                                   GLib.Variant('(oa{sa{sv}})', (self.source_path(uid), self.source_interfaces(uid))))
            invocation.return_value(None)
        elif method == 'ChangeSource':
            uid, data = parameters.unpack()
            self.sources[uid] = data
            connection.emit_signal(None, self.source_path(uid), 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                                   GLib.Variant('(sa{sv}as)', (PREFIX + 'Source', {'Data': GLib.Variant('s', data)}, [])))
            invocation.return_value(None)
        elif method == 'ReplaceObjects':
            uid, objects = parameters.unpack()
            self.config.setdefault('objects', {})[uid] = json.loads(objects)
            for view, owner in self.views.items():
                if owner == uid:
                    connection.emit_signal(None, view, PREFIX + 'CalendarView', 'ObjectsModified', GLib.Variant('(as)', (['BEGIN:VEVENT'],)))
            invocation.return_value(None)
        elif method == 'ReleaseBackend':
            self.release('backend', BACKEND)
            self.backend_owned = False
            for registration in self.registrations:
                connection.unregister_object(registration)
            self.registrations.clear()
            self.opened.clear()
            self.views.clear()
            invocation.return_value(None)
        elif method == 'Calls':
            invocation.return_value(GLib.Variant('(s)', (json.dumps(self.calls),)))

    def own(self, name):
        reply = self.connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName',
                                          GLib.Variant('(su)', (name, 4)), GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)
        assert reply.unpack()[0] == 1, name

    def release(self, label, name):
        self.connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ReleaseName',
                                  GLib.Variant('(s)', (name,)), GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)

    def own_backend(self):
        self.own(BACKEND)
        self.backend_owned = True

    def start(self):
        self.connection.register_object(MANAGER, interface(MANAGER_XML), self.manager, None, None)
        self.connection.register_object(FACTORY, interface(FACTORY_XML), self.factory, None, None)
        self.connection.register_object('/dev/ardia/FakeEds', interface(CONTROL_XML), self.control, None, None)
        self.own(CONTROL)
        self.own(PREFIX + f'Sources{self.config.get("sourcesVersion", 5)}')
        self.own(PREFIX + f'Calendar{self.config.get("calendarVersion", 8)}')
        for name in self.config.get('decoyNames', []):
            self.own(name)


def serve(config):
    loop = GLib.MainLoop()
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    FakeEds(config, connection).start()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, lambda: loop.quit() or False)
    print('ready', flush=True)
    loop.run()


def control(connection, method, args):
    if method == 'Ping':
        reply = connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner',
                                     GLib.Variant('(s)', (CONTROL,)), GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 5000, None)
        return reply.unpack()[0]
    signature = '(' + 's' * len(args) + ')'
    reply = connection.call_sync(CONTROL, '/dev/ardia/FakeEds', CONTROL, method, GLib.Variant(signature, tuple(args)) if args else None,
                                 None, Gio.DBusCallFlags.NONE, 5000, None)
    return json.loads(reply.unpack()[0]) if method == 'Calls' else None


def ask(driver, line, timeout=20):
    driver.stdin.write(line + '\n')
    driver.stdin.flush()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([driver.stdout], [], [], max(0.0, deadline - time.monotonic()))
        if ready:
            reply = driver.stdout.readline()
            if not reply:
                raise RuntimeError(f'driver exited during {line}: {driver.stderr.read()}')
            return json.loads(reply)
    raise TimeoutError(line)


def scenario(driver_path, config, steps):
    server = None
    if config.get('serve', True) and not config.get('activatable'):
        server = subprocess.Popen([sys.executable, '-I', os.path.abspath(__file__), '--serve', json.dumps(config)],
                                  stdout=subprocess.PIPE, text=True)
        ready, _, _ = select.select([server.stdout], [], [], 20)
        assert ready and server.stdout.readline().strip() == 'ready'
    def start_server():
        started = subprocess.Popen([sys.executable, '-I', os.path.abspath(__file__), '--serve', json.dumps(config)], stdout=subprocess.PIPE, text=True)
        ready, _, _ = select.select([started.stdout], [], [], 20)
        assert ready and started.stdout.readline().strip() == 'ready'
        return started

    driver = subprocess.Popen([driver_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    transcript = []
    try:
        for step in steps:
            if 'start' in step:
                server = start_server()
                transcript.append(True)
            elif 'control' in step:
                transcript.append(control(connection, step['control'], step.get('args', [])))
            else:
                transcript.append(ask(driver, step['driver']))
    finally:
        driver.stdin.close()
        driver.wait(timeout=20)
        stderr = driver.stderr.read()
        if server:
            server.terminate()
            server.wait(timeout=20)
    print(json.dumps({'transcript': transcript, 'stderr': stderr, 'code': driver.returncode}))


if __name__ == '__main__':
    if sys.argv[1] == '--control':
        print(json.dumps(control(Gio.bus_get_sync(Gio.BusType.SESSION, None), sys.argv[2], sys.argv[3:])))
    elif sys.argv[1] == '--serve':
        serve(json.loads(open(sys.argv[2][1:]).read() if sys.argv[2].startswith('@') else sys.argv[2]))
    else:
        scenario(sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4]))
