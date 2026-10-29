from pathlib import Path
import unittest

LINUX = Path(__file__).resolve().parents[1] / 'src/ardia/linux'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class PowerBusTests(unittest.TestCase):
    source = (LINUX / 'ac_linux_power.cc').read_text()

    def test_power_monitor_owns_its_system_bus_connection(self):
        self.assertNotIn('GetSharedSystemBus', self.source)
        self.assertNotIn('dbus_thread_linux', self.source)
        bus = body(self.source, 'scoped_refptr<dbus::Bus> PrivateSystemBus(')
        self.assertIn('options.bus_type = dbus::Bus::SYSTEM', bus)
        self.assertIn('options.connection_type = dbus::Bus::PRIVATE', bus)
        self.assertIn('options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(', bus)
        self.assertIn('bus_ = PrivateSystemBus()', body(self.source, 'void LinuxPowerMonitor::Watch('))

    def test_the_build_does_not_need_chromiums_shared_bus_for_power(self):
        self.assertEqual((LINUX / 'BUILD.gn').read_text().count('"//components/dbus"'), 1)


if __name__ == '__main__':
    unittest.main()
