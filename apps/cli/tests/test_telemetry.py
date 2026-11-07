import contextlib
import contextvars
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, command_metrics, endpoint, telemetry, telemetry_scrub
from ardia_cli.browse import daemon
from ardia_cli.browse.errors import StaleRef

REAL_SPAWN = telemetry.spawn_flusher
SCRATCH = Path.home() / "ardia-scratch"
INSTALL_ID = "0b6f4c1e-8d2a-4f3b-9c5d-1e2f3a4b5c6d"
CLEARED = (
    "ARDIA_PORT", "ARDIA_WS", "ARDIA_CDP_URL", "ARDIA_DATA_DIR", "AGENT_BROWSER_CDP", "DO_NOT_TRACK", "ARDIA_TELEMETRY",
    telemetry.TEST_URL_ENV,
)


def scratch_dir() -> Path:
    base = SCRATCH if SCRATCH.is_dir() else Path(tempfile.gettempdir())
    return Path(tempfile.mkdtemp(prefix="telemetry", dir=base)).resolve()


def write_consent(root: Path, **fields) -> None:
    doc = {"sharing": True, "installId": INSTALL_ID, "version": 1, **fields}
    (root / telemetry.CONSENT_FILE).write_text(json.dumps(doc))


class Stub:
    def __init__(self, status: int = 200):
        self.status = status
        self.bodies: list[dict] = []
        self.headers: list[dict] = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                stub.bodies.append(json.loads(self.rfile.read(length)))
                stub.headers.append(dict(self.headers))
                self.send_response(stub.status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1/logs"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def records(self) -> list[dict]:
        return [record for body in self.bodies for record in body["resourceLogs"][0]["scopeLogs"][0]["logRecords"]]


def attributes(record: dict) -> dict:
    out = {}
    for item in record["attributes"]:
        (kind, value), = item["value"].items()
        out[item["key"]] = json.loads(value) if kind == "stringValue" and value[:1] in ("[", "{") else value
    return out


class TelemetryCase(unittest.TestCase):
    def setUp(self):
        self.root = scratch_dir()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.stub = Stub()
        self.addCleanup(self.stub.close)
        env = {k: v for k, v in os.environ.items() if k not in CLEARED}
        env.update({"ARDIA_DATA_DIR": str(self.root), telemetry.TEST_URL_ENV: self.stub.url})
        for patch in (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.root / "not-the-installed-app"),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        spawn = mock.patch.object(telemetry, "spawn_flusher")
        self.spawn = spawn.start()
        self.addCleanup(spawn.stop)
        telemetry._reported.clear()
        command_metrics.last_request_shareable = False
        write_consent(self.root)

    def spool(self) -> list[dict]:
        path = self.root / telemetry.FOLDER / telemetry.SPOOL
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines()]

    def spool_text(self) -> str:
        path = self.root / telemetry.FOLDER / telemetry.SPOOL
        return path.read_text() if path.exists() else ""

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                status = cli.main(list(argv))
            except SystemExit as stop:
                status = stop.code
        return status, out.getvalue(), err.getvalue()


class ConsentTest(TelemetryCase):
    def test_sharing_on_gives_the_install_id(self):
        self.assertEqual(telemetry.consent(self.root), INSTALL_ID)

    def test_sharing_off_missing_or_odd_files_give_nothing(self):
        write_consent(self.root, sharing=False)
        self.assertIsNone(telemetry.consent(self.root))
        write_consent(self.root, installId="not-a-uuid")
        self.assertIsNone(telemetry.consent(self.root))
        write_consent(self.root, version=2)
        self.assertIsNone(telemetry.consent(self.root))
        (self.root / telemetry.CONSENT_FILE).write_text("{")
        self.assertIsNone(telemetry.consent(self.root))
        (self.root / telemetry.CONSENT_FILE).unlink()
        self.assertIsNone(telemetry.consent(self.root))
        real = self.root / "real.json"
        real.write_text(json.dumps({"sharing": True, "installId": INSTALL_ID}))
        (self.root / telemetry.CONSENT_FILE).symlink_to(real)
        self.assertIsNone(telemetry.consent(self.root))

    def test_a_version_zero_file_counts(self):
        write_consent(self.root, version=0)
        self.assertEqual(telemetry.consent(self.root), INSTALL_ID)

    def test_opt_outs_and_test_endpoints_record_nothing(self):
        cases = [
            ({"DO_NOT_TRACK": "1"}, ["config", "path"]),
            ({"DO_NOT_TRACK": "true"}, ["config", "path"]),
            ({"ARDIA_TELEMETRY": "0"}, ["config", "path"]),
            ({"ARDIA_TELEMETRY": "off"}, ["config", "path"]),
            ({"ARDIA_PORT": "9222"}, ["config", "path"]),
            ({"ARDIA_WS": "ws://127.0.0.1:1/devtools/browser/x"}, ["config", "path"]),
            ({"ARDIA_CDP_URL": "ws://127.0.0.1:1/devtools/browser/x"}, ["config", "path"]),
            ({"AGENT_BROWSER_CDP": "9222"}, ["config", "path"]),
            ({telemetry.TEST_URL_ENV: "https://example.com/v1/logs"}, ["config", "path"]),
            ({}, ["--port", "1", "windows"]),
            ({}, ["windows", "--ws=ws://127.0.0.1:1/devtools/browser/x"]),
            ({}, ["browse", "--cdp", "9222", "session", "list"]),
        ]
        for extra, argv in cases:
            with self.subTest(extra=extra, argv=argv), mock.patch.dict(os.environ, extra):
                self.assertIsNone(telemetry.cli_target(argv, os.environ))
        with mock.patch.dict(os.environ, {"DO_NOT_TRACK": "1"}):
            self.run_cli("config", "path")
        self.assertEqual(self.spool(), [])

    def test_a_dev_build_never_sends_to_production(self):
        os.environ.pop(telemetry.TEST_URL_ENV)
        self.assertIsNone(telemetry.logs_url(os.environ))
        with mock.patch.object(telemetry, "__version__", "0.2.45"):
            self.assertEqual(telemetry.logs_url(os.environ), telemetry.LOGS_URL)

    def test_the_data_dir_flag_picks_the_consent_file(self):
        other = scratch_dir()
        self.addCleanup(shutil.rmtree, other, True)
        self.assertEqual(telemetry.cli_target(["history", "--data-dir", str(other)], os.environ).root, other)
        self.assertEqual(telemetry.cli_target([f"--data-dir={other}", "history"], os.environ).root, other)
        self.assertEqual(telemetry.cli_target(["on", "x", "--", "prog", "--data-dir", "/elsewhere"], os.environ).root, self.root)
        self.run_cli("--data-dir", str(other), "config", "path")
        self.assertEqual(self.spool(), [])

    def test_turning_sharing_off_deletes_the_spool(self):
        self.run_cli("config", "path")
        self.assertEqual(len(self.spool()), 1)
        write_consent(self.root, sharing=False, installId=None)
        self.run_cli("config", "path")
        self.assertFalse((self.root / telemetry.FOLDER / telemetry.SPOOL).exists())


class CommandEventTest(TelemetryCase):
    def test_one_event_per_command_with_names_only(self):
        status, _, _ = self.run_cli("history", "--days", "7", "--profile", "SecretProfileName", "--json")
        records = self.spool()
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["event"], "cli_command")
        self.assertEqual(record["distinct_id"], INSTALL_ID)
        props = record["properties"]
        self.assertEqual(props["command"], "history")
        self.assertIsNone(props["subcommand"])
        self.assertEqual(props["exit_code"], status)
        self.assertEqual(props["flags"], "--days,--json,--profile")
        self.assertIsInstance(props["total_ms"], int)
        self.assertIsInstance(props["startup_ms"], int)
        self.assertGreaterEqual(props["total_ms"], props["startup_ms"])
        self.assertEqual(props["cli_version"], telemetry.__version__)
        self.assertNotIn("SecretProfileName", self.spool_text())
        self.spawn.assert_called_once()

    def test_subcommands_unknown_commands_and_help(self):
        self.run_cli("config", "path")
        self.run_cli("open-my-secret-site.example")
        self.run_cli("exec", "print(1)")
        self.run_cli("--help")
        names = [(r["properties"]["command"], r["properties"]["subcommand"]) for r in self.spool()]
        self.assertEqual(names, [("config", "path"), ("unknown", None), ("exec", None), ("none", None)])
        self.assertEqual(self.spool()[-1]["properties"]["exit_code"], 0)
        self.assertNotIn("secret", self.spool_text())
        self.assertNotIn("print", self.spool_text())

    def test_browse_records_the_command_name_and_known_flags_only(self):
        self.run_cli("browse", "--json", "session", "list", "--hunter2")
        records = self.spool()
        self.assertEqual(records[0]["properties"]["command"], "browse")
        self.assertEqual(records[0]["properties"]["subcommand"], "session")
        self.assertEqual(records[0]["properties"]["flags"], "--json")
        self.assertNotIn("hunter2", self.spool_text())
        self.assertEqual(telemetry.browse_command(["https://example.com/private"])[0], "other")
        self.assertEqual(telemetry.browse_command(["--json", "fill", "@e1", "--secret"])[0], "fill")
        name, allowed = telemetry.browse_command(["snapshot", "-i"])
        self.assertEqual(name, "snapshot")
        self.assertIn("-i", allowed)

    def test_browse_error_codes_and_metrics_come_back_from_the_daemon(self):
        request = {"argv": ["click", "@e3"], "options": {"json": False, "humanize": True}}

        def in_command():
            command_metrics.begin(request)
            started = command_metrics.clock()
            command_metrics.spent("connect_ms", started)
            command_metrics.cdp_call(started)
            return daemon.render(request["options"], error=StaleRef("e3", "its document is gone"))

        code, out, err = contextvars.copy_context().run(in_command)
        answer = json.loads(daemon.encode_answer(code, out, err, command_metrics.answer_fields(request)))
        self.assertEqual(answer["code"], "stale_ref")
        self.assertEqual(answer["metrics"]["cdp_calls"], 1)
        self.assertIs(answer["metrics"]["humanize"], True)
        self.assertIn("action_ms", answer["metrics"])
        self.assertNotIn("code", json.loads(daemon.encode_answer(0, "", "")))
        daemon.render({}, error=StaleRef("e3", "gone"))
        self.assertIsNone(command_metrics.current.get())

        def failing():
            telemetry.note_error_code(answer["code"])
            return 1

        telemetry.track(["browse", "click", "@e3"], failing)
        self.assertEqual(self.spool()[-1]["properties"]["error_code"], "stale_ref")

    def test_daemon_metrics_are_merged_cleaned_and_capped(self):
        def answered():
            telemetry.note_browse(["snapshot", "-i"])
            telemetry.note_daemon_start(time.monotonic() - 0.25)
            telemetry.note_answer({
                "exit": 0, "out": "x" * 40, "err": "y" * 2,
                "metrics": {"snapshot_build_ms": 12.6, "snapshot_nodes": 300, "snapshot_chars": 9000, "cdp_calls": 7, "cdp_ms_total": 3.2,
                            "connect_ms": float("inf"), "attach_ms": 10 ** 12, "output_truncated": True, "humanize": "yes",
                            "page_title": "Secret page", "network_writes_count": 2},
            })
            return 0

        telemetry.track(["browse", "snapshot", "-i"], answered)
        props = self.spool()[-1]["properties"]
        self.assertEqual(props["subcommand"], "snapshot")
        self.assertEqual(props["snapshot_build_ms"], 13)
        self.assertEqual((props["snapshot_nodes"], props["snapshot_chars"], props["cdp_calls"], props["cdp_ms_total"]), (300, 9000, 7, 3))
        self.assertEqual(props["output_chars"], 42)
        self.assertIs(props["output_truncated"], True)
        self.assertIs(props["daemon_spawned"], True)
        self.assertGreaterEqual(props["daemon_start_ms"], 250)
        self.assertEqual(props["attach_ms"], command_metrics.MAX_MS)
        self.assertEqual(props["network_writes_count"], 2)
        for dropped in ("connect_ms", "humanize", "page_title"):
            self.assertNotIn(dropped, props)
        self.assertNotIn("Secret", self.spool_text())

    def test_render_counts_snapshot_size_batches_and_truncation(self):
        from ardia_cli.browse.commands import Result

        request = {"argv": ["snapshot"], "options": {}}

        def in_command():
            command_metrics.begin(request)
            daemon.render({}, result=Result({"snapshot": "a\nb\nc", "changes": {"network": [{}, {}], "unsettled": True}}, "a\nb\nc"), name="snapshot")
            batch = Result({}, "done")
            batch.batch = [1, 2, 3]
            daemon.render({}, result=batch, name="batch")
            daemon.render({"max_output": 5}, result=Result({}, "z" * 50, page_content=True), name="snapshot")

        contextvars.copy_context().run(in_command)
        values = request["metrics"].values
        self.assertEqual((values["snapshot_nodes"], values["snapshot_chars"]), (3, 5))
        self.assertEqual((values["network_writes_count"], values["unsettled"], values["batch_steps"]), (2, True, 3))
        self.assertIs(values["output_truncated"], True)
        self.assertIn("snapshot_build_ms", command_metrics.answer_fields(request)["metrics"])

    def test_the_version_fast_path_records_nothing(self):
        self.run_cli("--version")
        self.assertEqual(self.spool(), [])


class ExceptionTest(TelemetryCase):
    def crash(self, error: BaseException, argv=("config", "path")):
        def boom():
            raise error

        with self.assertRaises(type(error)):
            telemetry.track(list(argv), boom)

    def test_an_unhandled_crash_sends_a_scrubbed_exception(self):
        secret = "/Users/someone/Library/Secret Folder/notes.txt"
        try:
            open(secret)
        except OSError as error:
            caught = error
        self.crash(caught)
        records = self.spool()
        self.assertEqual([r["event"] for r in records], ["$exception", "cli_command"])
        props = records[0]["properties"]
        self.assertEqual(props["$exception_level"], "fatal")
        self.assertEqual(props["source"], "cli_unhandled")
        entry = props["$exception_list"][0]
        self.assertEqual(entry["type"], "FileNotFoundError")
        self.assertEqual(entry["mechanism"], {"type": "cli_unhandled", "handled": False, "synthetic": False})
        self.assertEqual(entry["value"], "[Errno 2] No such file or directory")
        frames = entry["stacktrace"]["frames"]
        self.assertTrue(frames)
        self.assertEqual(set(frames[0]), {"platform", "lang", "function", "module", "filename", "lineno", "colno", "resolved", "in_app"})
        self.assertIn("ardia_cli.telemetry", [f["module"] for f in frames])
        self.assertEqual(records[1]["properties"]["error_code"], "unhandled_exception")
        text = self.spool_text()
        for leak in ("someone", "Secret", "/Users", str(Path.home()), Path.home().name, __file__):
            self.assertNotIn(leak, text)

    def test_messages_with_input_text_are_dropped(self):
        for message in (
            "can't open https://bank.example.com/acct?id=1 now",
            "bad path /private/var/folders/x/y.json here",
            "token tok-ABCDEFGHIJKLMNOP1234 leaked",
            "invalid literal for int() with base 10: 'my password'",
            "first line\nsecond line",
        ):
            with self.subTest(message=message):
                self.assertEqual(telemetry_scrub.exception_value(ValueError(message)), "ValueError")

    def test_messages_of_non_builtin_errors_are_dropped(self):
        class PageError(Exception):
            pass

        self.assertEqual(telemetry_scrub.exception_value(PageError("Welcome back, Jane Doe")), "PageError")

    def test_frames_outside_known_modules_are_hidden(self):
        namespace = {"__name__": "my_private_plugin"}
        exec("def private_function():\n    raise RuntimeError('x')\n", namespace)
        try:
            namespace["private_function"]()
        except RuntimeError as error:
            frames = telemetry_scrub.frames(error)
        self.assertEqual(frames[-1]["module"], "<other>")
        self.assertEqual(frames[-1]["function"], "<other>")
        self.assertIsNone(frames[-1]["lineno"])

    def test_exceptions_are_deduped_and_capped(self):
        for _ in range(3):
            self.crash(RuntimeError("same"))
        kinds = [ValueError, KeyError, TypeError, LookupError, IndexError, AttributeError, NameError, ArithmeticError,
                 BufferError, EOFError, ImportError, MemoryError, ReferenceError, SyntaxError, SystemError]
        for kind in kinds:
            self.crash(kind("different"))
        exceptions = [r for r in self.spool() if r["event"] == "$exception"]
        self.assertEqual(len(exceptions), telemetry.MAX_EXCEPTIONS)

    def test_interrupts_and_exits_are_not_crashes(self):
        self.crash(KeyboardInterrupt())
        self.crash(SystemExit(3))
        records = self.spool()
        self.assertEqual([r["event"] for r in records], ["cli_command", "cli_command"])
        self.assertEqual([r["properties"]["exit_code"] for r in records], [130, 3])

    def test_the_browse_daemon_reports_through_its_config(self):
        command_metrics.last_request_shareable = True
        try:
            raise KeyError("page secret")
        except KeyError as error:
            telemetry.report_exception(error, "browse_daemon", {"data_root": str(self.root), "ws": "ws://x/devtools/browser/y"})
            self.assertEqual(self.spool(), [])
            telemetry.report_exception(error, "browse_daemon", {"data_root": str(self.root), "ws": None, "port": None})
        props = self.spool()[0]["properties"]
        self.assertEqual(props["source"], "browse_daemon")
        self.assertEqual(props["$exception_level"], "error")
        self.assertEqual(props["$exception_values"], ["KeyError"])
        self.assertNotIn("page secret", self.spool_text())
        self.spawn.assert_not_called()


class SpoolTest(TelemetryCase):
    def record(self, size: int = 0) -> dict:
        return telemetry.event("cli_command", INSTALL_ID, {"command": "x", "pad": "p" * size})

    def test_the_spool_is_private(self):
        self.run_cli("config", "path")
        folder = self.root / telemetry.FOLDER
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((folder / telemetry.SPOOL).stat().st_mode), 0o600)

    def test_the_spool_is_capped_in_count_and_size(self):
        for _ in range(telemetry.MAX_EVENTS + 50):
            os.close(telemetry.append(self.root, [self.record()]))
        self.assertEqual(len(self.spool()), telemetry.MAX_EVENTS)
        for _ in range(80):
            os.close(telemetry.append(self.root, [self.record(8000)]))
        size = (self.root / telemetry.FOLDER / telemetry.SPOOL).stat().st_size
        self.assertLessEqual(size, telemetry.MAX_SPOOL_BYTES)
        self.assertEqual(self.spool()[-1]["properties"]["pad"], "p" * 8000)

    def test_flush_is_rate_limited(self):
        self.run_cli("config", "path")
        self.run_cli("config", "path")
        self.assertEqual(self.spawn.call_count, 1)


class FlushTest(TelemetryCase):
    def queue(self, *argv):
        self.run_cli(*(argv or ("config", "path")))

    def flush(self) -> str:
        return telemetry.flush(self.root, self.stub.url, "dev")

    def state(self) -> dict:
        return json.loads((self.root / telemetry.FOLDER / telemetry.FLUSH_STATE).read_text())

    def test_otlp_shape_matches_the_app(self):
        self.queue("browse", "session", "list")
        self.assertEqual(self.flush(), "done")
        body = self.stub.bodies[0]
        self.assertEqual(list(body), ["resourceLogs"])
        resource = {a["key"]: a["value"] for a in body["resourceLogs"][0]["resource"]["attributes"]}
        self.assertEqual(resource["service.name"], {"stringValue": "ardia-cli"})
        self.assertEqual(resource["deployment.environment"], {"stringValue": "development"})
        self.assertEqual(resource["os.type"], {"stringValue": "darwin"})
        self.assertIn("host.arch", resource)
        scope = body["resourceLogs"][0]["scopeLogs"][0]
        self.assertEqual(scope["scope"], {"name": "ardia.analytics"})
        record = scope["logRecords"][0]
        self.assertEqual(set(record), {"timeUnixNano", "severityNumber", "severityText", "body", "attributes"})
        self.assertEqual((record["severityNumber"], record["severityText"]), (9, "INFO"))
        self.assertEqual(record["body"], {"stringValue": "cli_command"})
        self.assertRegex(record["timeUnixNano"], r"^\d{13}000000$")
        self.assertEqual([a["key"] for a in record["attributes"][:3]], ["event", "uuid", "distinct_id"])
        attrs = attributes(record)
        self.assertEqual(attrs["distinct_id"], INSTALL_ID)
        self.assertEqual(attrs["$lib"], "ardia-cli")
        self.assertEqual(attrs["subcommand"], "session")
        self.assertIs(attrs["$geoip_disable"], True)
        exit_code = next(a for a in record["attributes"] if a["key"] == "exit_code")
        self.assertEqual(exit_code["value"], {"intValue": "0"})
        self.assertNotIn("error_code", attrs)
        self.assertEqual(self.stub.headers[0]["Content-Type"], "application/json")
        self.assertEqual(self.spool(), [])
        self.assertEqual(self.state()["failures"], 0)

    def test_exception_lists_are_json_strings_like_the_app(self):
        try:
            raise ValueError("boom")
        except ValueError as error:
            record = telemetry.exception_record(error, "cli_unhandled", True, INSTALL_ID, "dev")
        encoded = telemetry.event_record(record, ({}, frozenset()))
        exception_list = next(a for a in encoded["attributes"] if a["key"] == "$exception_list")
        self.assertIn("stringValue", exception_list["value"])
        self.assertEqual(json.loads(exception_list["value"]["stringValue"])[0]["type"], "ValueError")

    def test_unknown_browse_names_become_other_at_send_time(self):
        record = telemetry.event("cli_command", INSTALL_ID, {"command": "browse", "subcommand": "zzzunknown"})
        attrs = attributes(telemetry.event_record(record, telemetry.browse_names()))
        self.assertEqual(attrs["subcommand"], "other")
        record["properties"]["subcommand"] = "goto"
        attrs = attributes(telemetry.event_record(record, telemetry.browse_names()))
        self.assertEqual(attrs["subcommand"], "open")

    def test_a_failed_send_keeps_the_events_and_backs_off(self):
        self.stub.status = 503
        self.queue()
        self.assertEqual(self.flush(), "failed")
        self.assertEqual(len(self.spool()), 1)
        self.assertEqual(self.state()["failures"], 1)
        self.assertAlmostEqual(self.state()["next_at"], time.time() + telemetry.FIRST_BACKOFF_S, delta=5)
        self.assertEqual(self.flush(), "failed")
        self.assertAlmostEqual(self.state()["next_at"], time.time() + 2 * telemetry.FIRST_BACKOFF_S, delta=5)
        self.stub.status = 200
        self.assertEqual(self.flush(), "done")
        self.assertEqual(self.spool(), [])
        self.assertEqual(self.state()["failures"], 0)

    def test_a_rejected_batch_is_dropped(self):
        self.stub.status = 400
        self.queue()
        self.assertEqual(self.flush(), "done")
        self.assertEqual(self.spool(), [])

    def test_flush_checks_consent_again(self):
        self.queue()
        write_consent(self.root, sharing=False, installId=None)
        self.assertEqual(self.flush(), "off")
        self.assertEqual(self.stub.bodies, [])
        self.assertFalse((self.root / telemetry.FOLDER / telemetry.SPOOL).exists())

    def test_events_from_an_older_install_id_are_dropped(self):
        self.queue()
        write_consent(self.root, installId="11111111-2222-4333-8444-555555555555")
        self.queue()
        self.assertEqual(self.flush(), "done")
        self.assertEqual([attributes(r)["distinct_id"] for r in self.stub.records()], ["11111111-2222-4333-8444-555555555555"])

    def test_a_large_backlog_goes_in_batches(self):
        for _ in range(telemetry.BATCH_SIZE + 20):
            os.close(telemetry.append(self.root, [telemetry.event("cli_command", INSTALL_ID, {"command": "x"})]))
        self.assertEqual(self.flush(), "done")
        self.assertEqual([len(b["resourceLogs"][0]["scopeLogs"][0]["logRecords"]) for b in self.stub.bodies], [100, 20])


class DetachedFlushTest(TelemetryCase):
    def test_a_command_flushes_in_the_background(self):
        self.spawn.side_effect = REAL_SPAWN
        spool = self.root / telemetry.FOLDER / telemetry.SPOOL
        started = time.monotonic()
        status, _, _ = self.run_cli("config", "path")
        self.assertEqual(status, 0)
        self.assertLess(time.monotonic() - started, 2)
        deadline = time.monotonic() + 10
        while not self.stub.bodies and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(len(self.stub.records()), 1)
        self.assertEqual(attributes(self.stub.records()[0])["command"], "config")
        deadline = time.monotonic() + 5
        while spool.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(spool.exists())


class ReviewFindingsTest(TelemetryCase):
    def test_built_in_messages_never_carry_input_text(self):
        try:
            "x".encode("PrivatePatientRecord")
        except LookupError as error:
            caught = error
        self.assertIn("PrivatePatientRecord", str(caught))
        command_metrics.last_request_shareable = True
        try:
            raise caught
        except LookupError as error:
            telemetry.report_exception(error, "browse_daemon", {"data_root": str(self.root)})
        self.assertNotIn("PrivatePatientRecord", self.spool_text())
        self.assertEqual(self.spool()[0]["properties"]["$exception_values"], ["LookupError"])
        for error, expected in (
            (ValueError("Welcome back Jane"), "ValueError"),
            (KeyError("dashboard"), "KeyError"),
            (FileNotFoundError(2, "No such file or directory", "/Users/x/secret"), "[Errno 2] No such file or directory"),
            (ZeroDivisionError("division by zero"), "division by zero"),
            (RuntimeError("Event loop is closed"), "Event loop is closed"),
        ):
            with self.subTest(error=error):
                self.assertEqual(telemetry_scrub.exception_value(error), expected)

    def test_the_daemon_honours_each_requests_opt_out(self):
        def crash_in(request):
            command_metrics.begin(request)
            try:
                raise RuntimeError("boom")
            except RuntimeError as error:
                telemetry.report_exception(error, "browse_daemon", {"data_root": str(self.root)})

        contextvars.copy_context().run(crash_in, {"argv": ["click"], "options": {}, "telemetry": False})
        contextvars.copy_context().run(crash_in, {"argv": ["click"], "options": {}})
        self.assertEqual(self.spool(), [])
        try:
            raise OSError("daemon died")
        except OSError as error:
            telemetry.report_exception(error, "browse_daemon", {"data_root": str(self.root)}, fatal=True)
        self.assertEqual(self.spool(), [])
        contextvars.copy_context().run(crash_in, {"argv": ["click"], "options": {}, "telemetry": True})
        self.assertEqual(len(self.spool()), 1)
        with mock.patch.dict(os.environ, {"DO_NOT_TRACK": "1"}):
            self.assertFalse(telemetry.shareable(os.environ))
        self.assertTrue(telemetry.shareable(os.environ))

    def test_revoking_consent_mid_flush_stops_later_batches(self):
        for _ in range(telemetry.BATCH_SIZE + 20):
            os.close(telemetry.append(self.root, [telemetry.event("cli_command", INSTALL_ID, {"command": "x"})]))
        posted = telemetry.post

        def revoke_after_first(url, body):
            status = posted(url, body)
            write_consent(self.root, sharing=False, installId=None)
            return status

        with mock.patch.object(telemetry, "post", side_effect=revoke_after_first):
            self.assertEqual(self.flush_now(), "off")
        self.assertEqual(len(self.stub.bodies), 1)
        self.assertFalse((self.root / telemetry.FOLDER / telemetry.SPOOL).exists())

    def test_a_rotated_install_id_mid_flush_drops_the_old_events(self):
        for _ in range(telemetry.BATCH_SIZE + 20):
            os.close(telemetry.append(self.root, [telemetry.event("cli_command", INSTALL_ID, {"command": "x"})]))
        posted = telemetry.post

        def rotate_after_first(url, body):
            status = posted(url, body)
            write_consent(self.root, installId="11111111-2222-4333-8444-555555555555")
            return status

        with mock.patch.object(telemetry, "post", side_effect=rotate_after_first):
            self.assertEqual(self.flush_now(), "revoked")
        self.assertEqual(len(self.stub.bodies), 1)
        self.assertEqual(self.spool(), [])

    def flush_now(self) -> str:
        return telemetry.flush(self.root, self.stub.url, "dev")

    def test_concurrent_commands_start_one_flusher(self):
        spawned = self.root / "spawned"
        code = (
            "import os, sys, time\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parents[1])!r})\n"
            "from pathlib import Path\n"
            "from ardia_cli import telemetry\n"
            "read = telemetry.read_state\n"
            "telemetry.read_state = lambda fd: (read(fd), time.sleep(0.3))[0]\n"
            "telemetry.spawn_flusher = lambda where: open(sys.argv[2], 'a').write('x')\n"
            "while time.time() < float(sys.argv[3]):\n"
            "    time.sleep(0.001)\n"
            "telemetry.start_flush(telemetry.open_folder(Path(sys.argv[1])), telemetry.Target(Path(sys.argv[1]), 'http://127.0.0.1:9/', 'dev'))\n"
        )
        telemetry.open_folder(self.root)
        go = str(time.time() + 1.0)
        processes = [subprocess.Popen([sys.executable, "-I", "-c", code, str(self.root), str(spawned), go]) for _ in range(4)]
        for process in processes:
            self.assertEqual(process.wait(20), 0)
        self.assertEqual(spawned.read_text(), "x")

    def test_a_relative_data_dir_reaches_the_flusher_absolute(self):
        here = os.getcwd()
        self.addCleanup(os.chdir, here)
        os.chdir(self.root.parent)
        where = telemetry.cli_target(["history", "--data-dir", self.root.name], os.environ)
        self.assertTrue(where.root.is_absolute())
        self.assertEqual(where.root, self.root)


if __name__ == "__main__":
    unittest.main()
