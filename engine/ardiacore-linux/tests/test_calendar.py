import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'

PERSONAL = '[Data Source]\nDisplayName=Personal\nEnabled=true\nParent=local-stub\n\n[Calendar]\nBackendName=local\nColor=#becedd\n'
WORK = ('[Data Source]\nDisplayName=Work\\sCalendar\nEnabled=true\nParent=goa-account\n\n[Calendar]\nBackendName=caldav\n'
        'Color=#62a0ea\n\n[WebDAV Backend]\nEmailAddress=me@example.com\n')
TASKS = '[Data Source]\nDisplayName=Chores\nEnabled=true\n\n[Task List]\nBackendName=local\n'
ACCOUNT = '[Data Source]\nDisplayName=me@example.com\nEnabled=true\n\n[Collection]\nBackendName=google\nIdentity=me@example.com\n'
EVENT = 'BEGIN:VEVENT\r\nUID:standup\r\nDTSTART:20261028T150000Z\r\nDTEND:20261028T153000Z\r\nSUMMARY:Standup\r\nEND:VEVENT\r\n'
ZONE = 'BEGIN:VTIMEZONE\r\nTZID:/freedesktop.org/Tzfile/Europe/Berlin\r\nEND:VTIMEZONE\r\n'
SOURCES = [{'uid': 'personal', 'data': PERSONAL}, {'uid': 'work', 'data': WORK}, {'uid': 'chores', 'data': TASKS},
           {'uid': 'goa-account', 'data': ACCOUNT}, {'uid': 'denied', 'data': PERSONAL}, {'uid': 'expired', 'data': WORK}]
CONFIG = {'sources': SOURCES, 'objects': {'work': [EVENT]}, 'timezones': {'/freedesktop.org/Tzfile/Europe/Berlin': ZONE},
          'deniedOpen': ['denied'], 'deniedRead': ['expired']}
START = 1761609600000
END = 1761739200000


def requirements(test):
    if not shutil.which('dbus-run-session') or not shutil.which('pkg-config'):
        test.skipTest('dbus-run-session and pkg-config are required')
    try:
        import gi
        gi.require_version('Gio', '2.0')
    except (ImportError, ValueError):
        test.skipTest('PyGObject is unavailable')
    compiler = shutil.which('clang++') or shutil.which('c++')
    if compiler is None:
        test.skipTest('C++ compiler is unavailable')
    return compiler


class CalendarBusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-calendar-')
        cls.driver = pathlib.Path(cls.directory.name) / 'calendar_eds_driver'
        cls.built = None

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def build(self):
        compiler = requirements(self)
        if type(self).built is None:
            glib = subprocess.run(['pkg-config', '--cflags', '--libs', 'glib-2.0'], capture_output=True, text=True, timeout=30)
            self.assertEqual(glib.returncode, 0, glib.stderr)
            compiled = subprocess.run([
                compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
                '-fno-omit-frame-pointer', '-pthread', '-I', str(ROOT / 'src'), str(LINUX / 'ac_linux_calendar_eds.cc'),
                str(FIXTURES / 'calendar_eds_driver.cc'), *glib.stdout.split(), '-ldl', '-o', str(self.driver),
            ], capture_output=True, text=True, timeout=300)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            type(self).built = True
        return self.driver

    def run_bus(self, config, steps, session_config=None):
        driver = self.build()
        session = [f'--config-file={session_config}'] if session_config else []
        result = subprocess.run(['dbus-run-session', *session, '--', sys.executable, '-I', str(FIXTURES / 'fake_eds.py'), '--scenario',
                                 str(driver), json.dumps(config), json.dumps(steps)], capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        wrapped = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(wrapped['code'], 0, wrapped['stderr'])
        self.assertNotIn('ERROR: AddressSanitizer', wrapped['stderr'])
        return wrapped['transcript']

    def test_no_data_server_on_the_session_bus_is_unavailable_not_empty(self):
        probe, sources, objects = self.run_bus({'serve': False}, [
            {'driver': 'probe'}, {'driver': 'sources'}, {'driver': f'objects work {START} {END}'}])
        for reply in (probe, sources, objects):
            self.assertEqual(reply['status'], 'unavailable')
            self.assertIn('Evolution Data Server', reply['message'])
        self.assertEqual(sources['sources'], [])

    def test_sources_carry_every_key_file_group_and_mark_calendars(self):
        (sources,) = self.run_bus(CONFIG, [{'driver': 'sources'}])
        self.assertEqual(sources['status'], 'ok')
        by_uid = {source['uid']: source for source in sources['sources']}
        self.assertEqual(set(by_uid), {'personal', 'work', 'chores', 'goa-account', 'denied', 'expired'})
        self.assertEqual({uid for uid, source in by_uid.items() if source['calendar']}, {'personal', 'work', 'denied', 'expired'})
        self.assertEqual(by_uid['work']['data']['Data Source']['DisplayName'], 'Work Calendar')
        self.assertEqual(by_uid['work']['data']['Data Source']['Parent'], 'goa-account')
        self.assertEqual(by_uid['work']['data']['WebDAV Backend']['EmailAddress'], 'me@example.com')
        self.assertEqual(by_uid['goa-account']['data']['Collection']['Identity'], 'me@example.com')

    def test_objects_open_the_calendar_once_with_a_utc_range_query_and_a_silent_view(self):
        first, second, zone, missing, calls = self.run_bus(CONFIG, [
            {'driver': f'objects work {START} {END}'}, {'driver': f'objects work {START} {END}'},
            {'driver': 'timezone work /freedesktop.org/Tzfile/Europe/Berlin'}, {'driver': 'timezone work Mars/Olympus'},
            {'control': 'Calls'}])
        self.assertEqual((first['status'], first['objects']), ('ok', [EVENT]))
        self.assertEqual(second['objects'], [EVENT])
        self.assertEqual((zone['status'], zone['ics']), ('ok', ZONE))
        self.assertEqual(missing['status'], 'failed')
        self.assertIn('timezone not found', missing['message'])
        self.assertEqual(calls.count('OpenCalendar work'), 1)
        self.assertIn('Open work', calls)
        query = '(occur-in-time-range? (make-time "20251028T000000Z") (make-time "20251029T120000Z"))'
        self.assertEqual(calls.count(f'GetObjectList work {query}'), 2)
        self.assertIn('GetView work #t', calls)
        self.assertLess(calls.index('SetFlags work 0'), calls.index('Start work'))

    def test_refused_and_expired_calendars_report_denied(self):
        refused, expired = self.run_bus(CONFIG, [{'driver': f'objects denied {START} {END}'}, {'driver': f'objects expired {START} {END}'}])
        self.assertEqual(refused['status'], 'denied')
        self.assertIn('not allowed to open this calendar', refused['message'])
        self.assertEqual(expired['status'], 'denied')
        self.assertIn('needs signing in again', expired['message'])

    def test_view_source_and_backend_changes_reach_the_listener(self):
        transcript = self.run_bus(CONFIG, [
            {'driver': f'objects work {START} {END}'}, {'driver': 'sources'},
            {'control': 'EmitObjectsModified', 'args': ['work']}, {'driver': 'wait 3000'},
            {'control': 'AddSource', 'args': ['added', PERSONAL]}, {'driver': 'wait 3000'},
            {'control': 'ChangeSource', 'args': ['work', WORK.replace('Enabled=true', 'Enabled=false')]}, {'driver': 'wait 3000'},
            {'control': 'ReleaseBackend'}, {'driver': 'wait 3000'},
            {'driver': f'objects work {START} {END}'}, {'control': 'Calls'}])
        self.assertEqual(transcript[3]['changes'], ['objects'])
        self.assertEqual(transcript[5]['changes'], ['sources'])
        self.assertEqual(transcript[7]['changes'], ['sources'])
        self.assertEqual(transcript[9]['changes'], ['service'])
        self.assertEqual(transcript[10]['objects'], [EVENT])
        self.assertEqual(transcript[11].count('OpenCalendar work'), 2)

    def test_a_hung_calendar_is_bounded_by_the_request_budget_then_skipped_while_others_answer(self):
        config = {**CONFIG, 'sources': SOURCES + [{'uid': 'slow', 'data': WORK}], 'hangOpen': ['slow']}
        hung, again, work = self.run_bus(config, [
            {'driver': f'objects slow {START} {END} 1500'}, {'driver': f'objects slow {START} {END} 60000'}, {'driver': f'objects work {START} {END} 60000'}])
        self.assertEqual((hung['status'], hung['timedOut']), ('failed', True))
        self.assertLess(hung['elapsedMs'], 4000)
        self.assertEqual(again['status'], 'failed')
        self.assertIn("didn't answer", again['message'])
        self.assertLess(again['elapsedMs'], 500)
        self.assertEqual(work['objects'], [EVENT])
        expired = self.run_bus(config, [{'driver': f'objects work {START} {END} 0'}])[0]
        self.assertEqual((expired['status'], expired['timedOut']), ('failed', True))

    def test_unrepresentable_ranges_build_no_query(self):
        (ok, far, huge, negative) = self.run_bus({'serve': False}, [
            {'driver': f'query {START} {END}'}, {'driver': 'query 0 253402300800000'},
            {'driver': 'query 0 9223372036854775807'}, {'driver': 'query -62135596800001 0'}])
        self.assertEqual(ok['query'], '(occur-in-time-range? (make-time "20251028T000000Z") (make-time "20251029T120000Z"))')
        self.assertIsNone(far['query'])
        self.assertIsNone(huge['query'])
        self.assertIsNone(negative['query'])

    def test_probing_never_starts_an_activatable_data_server_but_reading_does(self):
        with tempfile.TemporaryDirectory(prefix='ardia-calendar-bus-') as scratch:
            root = pathlib.Path(scratch)
            services = root / 'services'
            services.mkdir()
            (root / 'config.json').write_text(json.dumps(CONFIG))
            for name in ['org.gnome.evolution.dataserver.Sources5', 'org.gnome.evolution.dataserver.Calendar8']:
                (services / f'{name}.service').write_text(
                    f'[D-BUS Service]\nName={name}\nExec={sys.executable} -I {FIXTURES / "fake_eds.py"} --serve @{root / "config.json"}\n')
            (root / 'session.conf').write_text(f'''<busconfig><type>session</type><listen>unix:tmpdir={root}</listen>
<servicedir>{services}</servicedir><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>''')
            probe, before, sources, after = self.run_bus({**CONFIG, 'activatable': True}, [
                {'driver': 'probe'}, {'control': 'Ping'}, {'driver': 'sources'}, {'control': 'Ping'}], root / 'session.conf')
        self.assertEqual(probe['status'], 'ok')
        self.assertFalse(before)
        self.assertEqual(sources['status'], 'ok')
        self.assertTrue(after)


if __name__ == '__main__':
    unittest.main()
