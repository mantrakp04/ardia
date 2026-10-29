import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
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

    def test_a_backend_that_vanished_unnoticed_is_reopened_once(self):
        transcript = self.run_bus(CONFIG, [
            {'driver': f'objects work {START} {END}'}, {'control': 'ReleaseBackend'},
            {'driver': f'objects work {START} {END}'}, {'control': 'Calls'}])
        self.assertEqual(transcript[2]['status'], 'ok')
        self.assertEqual(transcript[2]['objects'], [EVENT])
        self.assertEqual(transcript[3].count('OpenCalendar work'), 2)

    def test_close_disposes_views_and_closes_calendars(self):
        transcript = self.run_bus(CONFIG, [
            {'driver': f'objects work {START} {END}'}, {'driver': 'close'}, {'control': 'Calls'}])
        calls = transcript[2]
        self.assertIn('Dispose work', calls)
        self.assertIn('Close work', calls)

    def test_the_newest_interface_versions_win(self):
        config = {**CONFIG, 'sourcesVersion': 4, 'calendarVersion': 7, 'decoyNames': [
            'org.gnome.evolution.dataserver.Sources3', 'org.gnome.evolution.dataserver.CalendarFactoryX',
            'org.gnome.evolution.dataserver.Calendar6']}
        sources, objects = self.run_bus(config, [{'driver': 'sources'}, {'driver': f'objects work {START} {END}'}])
        self.assertEqual(sources['status'], 'ok')
        self.assertEqual(objects['objects'], [EVENT])

    def test_losing_the_session_bus_reports_unavailable_without_killing_the_process(self):
        driver = self.build()
        with tempfile.TemporaryDirectory(prefix='ardia-calendar-lost-') as scratch:
            address = f'unix:path={scratch}/bus'
            daemon = subprocess.Popen(['dbus-daemon', '--session', '--nofork', f'--address={address}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if pathlib.Path(scratch, 'bus').exists():
                        break
                    time.sleep(0.05)
                client = subprocess.Popen([str(driver)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                          env={**os.environ, 'DBUS_SESSION_BUS_ADDRESS': address})
                client.stdin.write('probe\n')
                client.stdin.flush()
                first = json.loads(client.stdout.readline())
                daemon.terminate()
                daemon.wait(timeout=20)
                client.stdin.write('wait 300\nprobe\n')
                client.stdin.flush()
                waited = json.loads(client.stdout.readline())
                second = json.loads(client.stdout.readline())
                client.stdin.close()
                self.assertEqual(client.wait(timeout=20), 0, client.stderr.read())
            finally:
                if daemon.poll() is None:
                    daemon.kill()
        self.assertEqual(first['status'], 'unavailable')
        self.assertIn('Evolution Data Server', first['message'])
        self.assertEqual(waited['changes'], [])
        self.assertEqual(second['status'], 'unavailable')

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

    def test_the_standalone_probe_answers_while_a_calendar_open_is_stuck(self):
        config = {**CONFIG, 'sources': SOURCES + [{'uid': 'slow', 'data': WORK}], 'hangOpen': ['slow']}
        started, probe, joined = self.run_bus(config, [
            {'driver': f'bgobjects slow {START} {END} 4000'}, {'driver': 'probe-standalone'}, {'driver': 'join'}])
        self.assertTrue(started['started'])
        self.assertEqual(probe['status'], 'ok')
        self.assertLess(probe['elapsedMs'], 1500)
        self.assertTrue(joined['timedOut'])

    def test_a_data_server_that_appears_later_is_noticed(self):
        probe, started, waited, sources = self.run_bus({**CONFIG, 'serve': False}, [
            {'driver': 'probe'}, {'start': True}, {'driver': 'wait 4000'}, {'driver': 'sources'}])
        self.assertEqual(probe['status'], 'unavailable')
        self.assertEqual(waited['changes'], ['service'])
        self.assertEqual(sources['status'], 'ok')

    def test_objects_stop_at_the_reply_byte_budget_and_say_so(self):
        big = [EVENT.replace('Standup', f'Standup {i} ' + 'x' * 1000) for i in range(3)]
        full, capped = self.run_bus({**CONFIG, 'objects': {'work': big}}, [
            {'driver': f'objects work {START} {END} 60000 100000'}, {'driver': f'objects work {START} {END} 60000 2500'}])
        self.assertEqual((len(full['objects']), full['truncated']), (3, False))
        self.assertEqual((capped['status'], len(capped['objects']), capped['truncated']), ('ok', 2, True))

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


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class CalendarSourceTests(unittest.TestCase):
    eds = (LINUX / 'ac_linux_calendar_eds.cc').read_text()
    service = (LINUX / 'ac_linux_calendar_service.cc').read_text()
    header = (LINUX / 'ac_linux_calendar_service.h').read_text()
    host = (LINUX / 'ac_linux_host.cc').read_text()
    adapter = (ROOT.parents[1] / 'apps/linux/src/hostCalendar.ts').read_text()

    def test_the_helper_loads_gio_at_runtime_and_never_links_chromium(self):
        self.assertIn('dlopen("libgio-2.0.so.0", RTLD_NOW | RTLD_LOCAL)', self.eds)
        self.assertNotIn('g_bus_get', self.eds)
        self.assertNotIn('#include "base/', self.eds)
        self.assertNotIn('#include <gio', self.eds)

    def test_the_build_registers_the_calendar_sources(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for source in ['ac_linux_calendar_eds.cc', 'ac_linux_calendar_eds.h', 'ac_linux_calendar_service.cc', 'ac_linux_calendar_service.h']:
            self.assertEqual(build.count(f'"{source}"'), 1, source)

    def test_one_app_wide_service_owns_a_glib_pumped_thread_off_the_ui_thread(self):
        self.assertIn('static base::NoDestructor<LinuxCalendarService> service;', self.service)
        self.assertIn('base::Thread thread_{"ArdiaCalendar"};', self.service)
        self.assertIn('thread_.StartWithOptions(base::Thread::Options(base::MessagePumpType::UI, 0));', self.service)
        invoke = body(self.service, 'void Invoke(base::FilePath documents')
        self.assertIn('thread_.task_runner()->PostTaskAndReplyWithResult(', invoke)
        self.assertIn('ui->PostTask(FROM_HERE, base::BindOnce(&LinuxCalendarService::Changed', self.service)
        self.assertNotIn('LOG(', self.service + self.eds)

    def test_status_never_queues_behind_the_calendar_thread(self):
        invoke = body(self.service, 'void Invoke(base::FilePath documents')
        status = invoke[invoke.index('if (method == "ArdiaCalendar.status")'):]
        self.assertIn('probe_runner_->PostTaskAndReplyWithResult(', status[:status.index('return;')])
        probe = body(self.service, 'Reply ProbeStatus(const base::FilePath& documents)')
        self.assertIn('eds::ProbeEds()', probe)
        self.assertNotIn('Client()', probe)
        self.assertIn('base::MayBlock()', self.service[self.service.index('probe_runner_'):])

    def test_a_data_server_appearing_triggers_a_recheck(self):
        changed = body(self.service, 'void Changed(eds::EdsChange change)')
        self.assertIn('if (change == eds::EdsChange::kService) Recheck();', changed)
        recheck = body(self.service, 'void Recheck()')
        self.assertIn('probe_runner_->PostTaskAndReplyWithResult(', recheck)

    def test_objects_have_one_deadline_one_byte_budget_and_clamped_times(self):
        objects = body(self.service, 'Reply Objects(const base::ListValue& values)')
        self.assertIn('base::Milliseconds(eds::kRequestBudgetMs)', objects)
        self.assertIn('eds::kMaxReplyBytes - used', objects)
        self.assertIn('.Set("truncated", truncated)', objects)
        self.assertLess(objects.index('std::fabs(start) > kMaxTimeMs'), objects.index('static_cast<int64_t>(start)'))

    def test_nothing_reads_calendars_before_the_user_connects(self):
        run = body(self.service, 'Reply Run(base::FilePath documents')
        guard = run.index('if (!connected)')
        for method in ['Sources()', 'Objects(values)', 'Timezones(values)']:
            self.assertGreater(run.index(f'return {method}'), guard)
        self.assertIn('"ERR_CALENDAR_NOT_CONNECTED"', run)
        self.assertNotIn('Sources(', body(self.service, 'Reply ProbeStatus(const base::FilePath& documents)'))

    def test_the_host_routes_calendar_calls_through_the_app_profile_and_rebroadcasts_changes(self):
        bootstrap = body(self.host, 'base::DictValue ShellHostView::Bootstrap(')
        self.assertIn('AppendLinuxCalendarCapabilities(capabilities);', bootstrap)
        invoke = body(self.host, 'void ShellHostView::Invoke(')
        route = invoke[invoke.index('if (LinuxCalendarInvokes(method))'):]
        route = route[:route.index('if (LinuxSyncInvokes(method))')]
        self.assertIn('WatchCalendar();', route)
        self.assertIn('LinuxCalendarInvoke(DocumentDirectory(profile()), method, values, std::move(done));', route)
        self.assertNotIn('page_profile()', route)
        watch = body(self.host, 'void ShellHostView::WatchCalendar(')
        self.assertIn('host->Event("ArdiaCalendar", "onCalendarChanged", base::Value(change.Clone()));', watch)

    def test_native_and_adapter_agree_on_methods_and_the_consent_document(self):
        methods = re.findall(r'"(ArdiaCalendar\.\w+)"', body(self.service, 'constexpr std::string_view kMethods[]'))
        adapter = re.search(r'CALENDAR_CAPABILITIES = \[([^\]]+)\]', self.adapter).group(1)
        self.assertEqual(methods, re.findall(r'"(ArdiaCalendar\.\w+)"', adapter))
        self.assertIn('kLinuxCalendarConsentDocument[] = "linux-calendar.json";', self.header)
        self.assertIn('CALENDAR_CONSENT_DOCUMENT = "linux-calendar.json";', self.adapter)


if __name__ == '__main__':
    unittest.main()
