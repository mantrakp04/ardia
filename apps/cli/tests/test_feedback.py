import contextlib
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ardia_cli import caller, cli, endpoint, feedback, telemetry, telemetry_scrub, usage
from test_telemetry import CLEARED, INSTALL_ID, Stub, attributes, scratch_dir, write_consent

REPO = Path(__file__).resolve().parents[3]
APP_SESSION = "01960a4e-7c1d-7b2a-9f00-1234567890ab"
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class FeedbackService:
    def __init__(self):
        self.statuses = {"create": 201, "upload": 200, "complete": 200}
        self.requests: list[dict] = []
        self.files: dict[str, bytes] = {}
        self.issue_url = "https://github.com/mantrakp04/ardia/issues/1234"
        service = self

        class Handler(BaseHTTPRequestHandler):
            def answer(self, step: str, payload: dict):
                status = service.statuses[step]
                data = json.dumps(payload if 200 <= status < 300 else {"error": "nope", "message": f"{step} refused"}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def read_body(self) -> bytes:
                return self.rfile.read(int(self.headers.get("Content-Length") or 0))

            def do_POST(self):
                raw = self.read_body()
                step = "complete" if self.path.endswith("/complete") else "create"
                service.requests.append({"step": step, "path": self.path, "headers": dict(self.headers), "body": json.loads(raw or b"{}")})
                if step == "create":
                    self.answer(step, {"id": "FB-7K2Q", "name": "Brave Otter", "upload_token": "FB-7K2Q.1999999999.sig", "upload_urls": {}, "expires_at": "x"})
                else:
                    self.answer(step, {"id": "FB-7K2Q", "name": "Brave Otter", "issue_url": service.issue_url})

            def do_PUT(self):
                raw = self.read_body()
                service.requests.append({"step": "upload", "path": self.path, "headers": dict(self.headers), "body": raw})
                service.files[self.path.rsplit("/", 1)[-1]] = raw
                self.answer("upload", {})

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/feedback"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def steps(self) -> list[str]:
        return [request["step"] for request in self.requests]

    def created(self) -> dict:
        return next(request for request in self.requests if request["step"] == "create")


def closed_port_url() -> str:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    return f"http://127.0.0.1:{port}/api/feedback"


class FeedbackCase(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.data = self.temp / "data"
        self.data.mkdir()
        self.home = self.temp / "cli"
        self.service = FeedbackService()
        self.addCleanup(self.service.close)
        dropped = CLEARED + ("ARDIA_CLI_HOME", feedback.TEST_URL_ENV, usage.STAR_PROMPT_ENV) + usage.CI_ENV
        env = {k: v for k, v in os.environ.items() if k not in dropped}
        env.update({"ARDIA_CLI_HOME": str(self.home), feedback.TEST_URL_ENV: self.service.url})
        for patch in (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.temp / "not-the-installed-app"),
            mock.patch.object(caller, "_current", caller.Caller("Claude Code")),
            mock.patch.object(telemetry, "spawn_flusher"),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        telemetry._process_session = None

    def send(self, *args, stdin=None, data_dir=True):
        argv = ["feedback", *(["--data-dir", str(self.data)] if data_dir else []), *args]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(sys, "stdin", stdin or io.StringIO("")):
            try:
                status = cli.main(argv)
            except SystemExit as stop:
                status = stop.code
        return status, out.getvalue(), err.getvalue()

    def kept(self) -> list[dict]:
        path = self.home / usage.FOLDER / feedback.LOCAL_FILE
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


class ScrubTest(unittest.TestCase):
    def clean(self, text: str) -> str:
        return telemetry_scrub.free_text(text, 4000)[0]

    def assert_scrubbed(self, text, *secrets, keep=()):
        clean = self.clean(text)
        for secret in secrets:
            self.assertNotIn(secret, clean, clean)
        for kept in keep:
            self.assertIn(kept, clean, clean)
        return clean

    def test_urls_emails_known_keys_cards_and_home_names(self):
        clean = self.assert_scrubbed(
            "open https://bob:pw@example.com/reset?code=abc#x failed\nfor jane.doe@example.org with ghp_abcdefghijklmnopqrstuvwx12\n"
            "in /Users/jane/site card 4111 1111 1111 1111 id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "bob", "pw@", "code=abc", "jane.doe", "ghp_", "/Users/jane", "4111", "9f86d08",
        )
        self.assertIn("https://example.com/reset?<redacted> failed", clean)
        self.assertIn("for <email> with <secret>", clean)
        self.assertIn("/Users/<user>/site", clean)
        self.assertIn("card <number>", clean)

    def test_known_key_formats_and_jwts(self):
        for secret in (
            "github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "sk-proj-abcdefghijklmnop1234", "sk_live_abcdefghij12345",
            "xoxb-1234567890-abcdefghij", "AKIAABCDEFGHIJKLMNOP", "AIzaSyA1234567890abcdefghijklmnopqrstu", "glpat-abcdefghij0123456789",
            "npm_abcdefghijklmnopqrstuvwxyz0123456789", "hf_abcdefghijklmnopqrstuvwxyz01234567",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        ):
            with self.subTest(secret=secret[:12]):
                self.assertEqual(self.clean(f"it printed {secret} then quit"), "it printed <secret> then quit")

    def test_key_value_secrets_keep_their_names(self):
        cases = {
            "password=hunter2 and then": "password=<redacted> and then",
            "api_key: 'short-key' was rejected": "api_key: <redacted> was rejected",
            '{"password":"hunter2","remember":true}': '{"password":<redacted>,"remember":true}',
            "{'client_secret': 'abc', 'page': 2}": "{'client_secret': <redacted>, 'page': 2}",
            'access_token => "zz9" next': "access_token => <redacted> next",
            "SESSION_ID=abc123; theme=dark": "SESSION_ID=<redacted>; theme=dark",
            "ardia browse fill @e2 --password hunter2 --session work": "ardia browse fill @e2 --password <redacted> --session work",
            "token: abc123 then snapshot failed": "token: <redacted> then snapshot failed",
            "export GITHUB_TOKEN=abc123def": "export GITHUB_TOKEN=<redacted>",
            "DB_PASSWORD=hunter2\nSTRIPE_SECRET_KEY=whsec_1": "DB_PASSWORD=<redacted>\nSTRIPE_SECRET_KEY=<redacted>",
            "os.environ['API_TOKEN'] = 'tok9'": "os.environ['API_TOKEN'] = <redacted>",
            'headers = {"Authorization": "Bearer abc"}': 'headers = {"Authorization": <redacted>}',
            "curl -u bob:hunter2 https://a.test": "curl -u <redacted> https://a.test",
            "mysql://root:hunter2@db:3306/x": "mysql://db:3306/x",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.clean(text), expected)

    def test_quoted_and_escaped_values_go_whole(self):
        for text in (
            '{"password": "hun\\"ter2", "api_key": "short-key"}',
            'password = "hunter2 with spaces" api_key = "short-key"',
            '`password`: `hunter2` and api_key => "short-key"',
            'password = r"""first\nhunter2"""',
            '{"password":"hunter2\\',
            'curl -d "{\\"password\\":\\"hunter2\\"}" https://a.test',
        ):
            with self.subTest(text=text):
                clean = self.clean(text)
                self.assertNotIn("hunter2", clean)
                self.assertNotIn("ter2", clean)
                self.assertNotIn("short-key", clean)

    def test_auth_headers_and_schemes(self):
        self.assert_scrubbed("Authorization: Bearer abcdefghijk123\nnext line", "abcdefghijk123", keep=("Authorization: <redacted>", "next line"))
        self.assert_scrubbed('Authorization: Bearer "shortsecret" ok', "shortsecret")
        self.assert_scrubbed("Basic dXNlcjpodW50ZXIy then it failed", "dXNlcjpodW50ZXIy", keep=("then it failed",))
        self.assert_scrubbed('it sent Bearer "quoted-secret" and got 401', "quoted-secret", keep=("it sent", "and got 401"))
        self.assert_scrubbed("Cookie: session=shortsecret; other=anothersecret", "shortsecret", "anothersecret")
        self.assert_scrubbed('Cookie: session="shortsecret"; other=anothersecret', "shortsecret", "anothersecret")
        self.assert_scrubbed("Set-Cookie: sid=shortsecret; Path=/; HttpOnly", "shortsecret")
        self.assert_scrubbed("Proxy-Authorization: Basic zz", "zz")
        self.assert_scrubbed("X-Auth-Token: t1\nX-Goog-Api-Key: k1", "t1", "k1")
        self.assert_scrubbed(
            'Authorization: Digest username="bob",\n  response="f0lded-secret",\n\topaque="tab-secret"\nAccept: text/html',
            "bob", "f0lded-secret", "tab-secret", keep=("Accept: text/html",),
        )
        clean = self.assert_scrubbed(
            "curl -H 'Authorization: Bearer abc' --header \"X-Api-Key: k123\" -H 'Cookie: a=b; c=d' -H 'Accept: text/html' https://example.com/api?q=1",
            "abc", "k123", "a=b", "c=d", "q=1", keep=("curl -H", "Accept: text/html", "https://example.com/api?<redacted>"),
        )
        self.assertNotIn("Bearer abc", clean)

    def test_http_request_dump(self):
        dump = (
            "POST /api/login HTTP/1.1\r\nHost: example.com\r\nCookie: session=s3ss; csrf=c5rf\r\nAuthorization: Bearer t0ken\r\n"
            'X-Api-Key: k3y\r\nContent-Type: application/json\r\n\r\n{"username":"bob","password":"hunter2","remember":true}'
        )
        self.assert_scrubbed(dump, "s3ss", "c5rf", "t0ken", "k3y", "hunter2", keep=("Host: example.com", "POST /api/login", '"remember":true'))

    def test_private_key_blocks(self):
        self.assert_scrubbed("here:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\nkqhkiG9w0BAQE\n-----END RSA PRIVATE KEY-----\nthen", "MIIEv", "kqhk", keep=("then",))

    def test_talking_about_sessions_auth_and_tokens_survives(self):
        for text in (
            "ardia browse session list shows nothing after ardia browse --session work open https://example.com",
            "ardia browse auth save github failed: the token expired and auth load said no saved state",
            "the Bearer token expired; Authorization header missing from the docs",
            "basic usage of --session work is unclear; session cookies vanish after reload",
            "the token didn't refresh\nsnapshot was fine",
            "password fields are skipped by fill, which is right, but the error says element_not_editable",
            "ardia browse click @e7 on 0.2.44 exited 2 at 16:53 after 1234 ms",
        ):
            with self.subTest(text=text):
                self.assertEqual(self.clean(text), text)

    def test_numbers_that_fail_luhn_stay(self):
        self.assertEqual(self.clean("took 1234 5678 9012 3456 ms"), "took 1234 5678 9012 3456 ms")

    def test_stays_fast_on_huge_input_and_never_cuts_a_token_in_half(self):
        started = time.monotonic()
        for text in ("a" * 65536, "a1" * 32768, "x@" * 30000, "ok " * 2000 + "ghp_" + "Z9" * 400, 'password="' + "x" * 60000, "Digest a=" * 8000):
            clean, truncated = telemetry_scrub.free_text(text, 4000)
            self.assertTrue(truncated)
            self.assertNotIn("Z9Z9", clean)
            self.assertLessEqual(len(clean), 4000)
        self.assertLess(time.monotonic() - started, 2)

    def test_only_placeholders_counts_as_empty(self):
        self.assertTrue(telemetry_scrub.only_placeholders("<secret> <email>, <redacted>"))
        self.assertFalse(telemetry_scrub.only_placeholders("<secret> broke"))


class TitleAndDescriptionTest(FeedbackCase):
    def test_title_is_required_and_capped(self):
        status, _, err = self.send("description only")
        self.assertEqual(status, 2)
        self.assertIn("needs --title", err)
        status, _, err = self.send("--title", "   ", "description")
        self.assertEqual(status, 2)
        status, _, err = self.send("--title", "x" * 68, "description")
        self.assertEqual(status, 2)
        self.assertIn("68 characters; keep it to 67", err)
        self.assertEqual(self.service.requests, [])
        status, out, _ = self.send("--title", "y" * 67, "description")
        self.assertEqual(status, 0, out)
        self.assertEqual(self.service.created()["body"]["title"], "y" * 67)

    def test_title_whitespace_collapses_and_secrets_go(self):
        self.send("--title", "  fill   fails\non token=abc123 ", "description")
        self.assertEqual(self.service.created()["body"]["title"], "fill fails on token=<redacted>")

    def test_description_is_required(self):
        status, _, err = self.send("--title", "t")
        self.assertEqual(status, 2)
        self.assertIn("needs a description", err)

    def test_reads_stdin(self):
        status, _, _ = self.send("--title", "t", stdin=io.StringIO("from stdin\n"))
        self.assertEqual(status, 0)
        self.assertEqual(self.service.created()["body"]["description"], "from stdin")

    def test_empty_after_scrubbing_is_refused(self):
        for args in (("--title", "t", "ghp_abcdefghijklmnopqrstuvwx12 a@b.co"), ("--title", "ghp_abcdefghijklmnopqrstuvwx12", "real text")):
            with self.subTest(args=args):
                status, _, err = self.send(*args)
                self.assertEqual(status, 2)
                self.assertIn("nothing is left", err)
        self.assertEqual(self.service.requests, [])
        self.assertEqual(self.kept(), [])

    def test_body_matches_the_contract_and_carries_no_raw_length(self):
        write_consent(self.data, lastVersion="0.2.45", lastBuild=245, sessionOpen=True, sessionId=APP_SESSION)
        self.send("--title", "t", "--kind", "slow", "--command", "ardia browse open https://a.test/x?sid=1", "it took 9 s for bob@example.com")
        body = self.service.created()["body"]
        self.assertEqual(set(body), {
            "kind", "title", "description", "source", "install_id", "session_id", "app_version", "app_build", "channel",
            "os_version", "arch", "cli_version", "watch_days", "diagnostics", "attachments",
        })
        self.assertEqual(body["kind"], "slow")
        self.assertEqual(body["source"], "cli")
        self.assertEqual(body["description"], "it took 9 s for <email>")
        self.assertEqual(body["session_id"], APP_SESSION)
        self.assertEqual((body["app_version"], body["app_build"]), ("0.2.45", "245"))
        self.assertEqual(body["diagnostics"]["about_command"], "ardia browse open https://a.test/x?<redacted>")
        self.assertEqual(body["diagnostics"]["agent"], "Claude Code")
        self.assertNotIn("text_chars", json.dumps(body))
        self.assertEqual(body["watch_days"], 0)


class IdentityTest(FeedbackCase):
    def test_sharing_on_uses_the_install_id_and_prints_the_answer(self):
        write_consent(self.data)
        status, out, _ = self.send("--title", "t", "d")
        self.assertEqual(status, 0)
        self.assertEqual(self.service.created()["body"]["install_id"], INSTALL_ID)
        self.assertEqual(out.splitlines(), ["Sent. Reference FB-7K2Q.", "Issue: https://github.com/mantrakp04/ardia/issues/1234", "You appear to us as Brave Otter."])

    def test_sharing_off_sends_with_a_one_time_id(self):
        write_consent(self.data, sharing=False)
        self.send("--title", "t", "first")
        self.send("--title", "t", "second")
        ids = [request["body"]["install_id"] for request in self.service.requests if request["step"] == "create"]
        self.assertEqual(len(ids), 2)
        self.assertNotIn(INSTALL_ID, ids)
        self.assertNotEqual(ids[0], ids[1])
        self.assertTrue(all(UUID4.match(value) for value in ids))

    def test_no_consent_file_still_sends(self):
        status, out, _ = self.send("--title", "t", "d")
        self.assertEqual(status, 0)
        self.assertIn("(a one-time id: sharing is off)", out)

    def test_an_expired_watch_counts_as_sharing_off(self):
        write_consent(self.data, sharingUntil=int((time.time() - 60) * 1000))
        self.send("--title", "t", "d")
        self.assertNotEqual(self.service.created()["body"]["install_id"], INSTALL_ID)
        write_consent(self.data, sharingUntil=int((time.time() + 3600) * 1000), watchReport="FB-AB12")
        self.send("--title", "t", "d2")
        created = [request for request in self.service.requests if request["step"] == "create"]
        self.assertEqual(created[-1]["body"]["install_id"], INSTALL_ID)

    def test_a_newer_consent_version_is_read(self):
        write_consent(self.data, version=7, somethingNew={"x": 1})
        self.send("--title", "t", "d")
        self.assertEqual(self.service.created()["body"]["install_id"], INSTALL_ID)

    def test_session_id_without_an_open_app_session_is_per_process(self):
        write_consent(self.data, sessionOpen=False, sessionId=APP_SESSION)
        self.send("--title", "t", "d")
        session = self.service.created()["body"]["session_id"]
        self.assertNotEqual(session, APP_SESSION)
        self.assertEqual(session[14], "7")


class SendingTest(FeedbackCase):
    def test_headers_and_the_three_steps(self):
        attachment = self.temp / "shot.png"
        attachment.write_bytes(b"\x89PNG" + b"x" * 100)
        status, _, _ = self.send("--title", "t", "--attach", str(attachment), "d")
        self.assertEqual(status, 0)
        self.assertEqual(self.service.steps(), ["create", "upload", "complete"])
        for request in self.service.requests:
            self.assertEqual(request["headers"]["X-Ardia-Key"], telemetry.CLI_INGEST_KEY)
        upload, complete = self.service.requests[1], self.service.requests[2]
        self.assertEqual(upload["path"], "/api/feedback/FB-7K2Q/files/attachment-1.png")
        self.assertEqual(upload["headers"]["Authorization"], "Bearer FB-7K2Q.1999999999.sig")
        self.assertEqual(upload["headers"]["Content-Type"], "image/png")
        self.assertEqual(complete["headers"]["Authorization"], "Bearer FB-7K2Q.1999999999.sig")
        self.assertEqual(self.service.files["attachment-1.png"], attachment.read_bytes())
        self.assertEqual(self.service.created()["body"]["attachments"], [{"name": "attachment-1.png", "bytes": 104, "type": "image/png"}])

    def test_sent_only_after_a_2xx_complete(self):
        for step, status_code in (("create", 503), ("upload", 500), ("complete", 500), ("complete", 401)):
            with self.subTest(step=step, status=status_code):
                self.service.requests.clear()
                self.service.statuses = {"create": 201, "upload": 200, "complete": 200, step: status_code}
                attachment = self.temp / "log.txt"
                attachment.write_text("log line")
                status, out, _ = self.send("--title", "t", "--attach", str(attachment), f"{step} {status_code}")
                self.assertEqual(status, 1)
                self.assertNotIn("Sent", out)
                self.assertIn(f"HTTP {status_code}: {step} refused", out)
                self.assertIn("kept on this Mac", out)
                self.assertEqual(self.kept()[-1]["description"], f"{step} {status_code}")
        self.service.statuses = {"create": 201, "upload": 200, "complete": 200}
        status, out, _ = self.send("--title", "t", "--attach", str(attachment), "complete 500")
        self.assertEqual(status, 0, out)
        self.assertIn("Sent. Reference FB-7K2Q.", out)

    def test_offline_keeps_it_and_says_the_network_failed(self):
        with mock.patch.dict(os.environ, {feedback.TEST_URL_ENV: closed_port_url()}):
            status, out, _ = self.send("--title", "t", "offline now")
        self.assertEqual(status, 1)
        self.assertRegex(out, r"^Not sent: the network failed \(.+\)\. It's kept on this Mac: .+feedback\.jsonl\n$")
        entry = self.kept()[0]
        self.assertEqual(entry["description"], "offline now")
        self.assertIn("the network failed", entry["reason"])

    def test_each_reason_is_named(self):
        cases = [
            ({"DO_NOT_TRACK": "1"}, "DO_NOT_TRACK=1 is set"),
            ({"ARDIA_TELEMETRY": "off"}, "ARDIA_TELEMETRY=off is set"),
            ({"ARDIA_PORT": "9222"}, "ARDIA_PORT points ardia at a test browser"),
            ({feedback.TEST_URL_ENV: "https://evil.example/api/feedback"}, "ARDIA_FEEDBACK_URL isn't a loopback http:// URL"),
            ({feedback.TEST_URL_ENV: ""}, "this ardia is a checkout build (0.0.0.dev0)"),
        ]
        for extra, reason in cases:
            with self.subTest(extra=extra), mock.patch.dict(os.environ, extra):
                status, out, _ = self.send("--title", "t", f"case {extra}")
                self.assertEqual(status, 1)
                self.assertIn(f"Not sent: {reason}", out)
                self.assertNotIn("sharing", out.lower())
        self.assertEqual(self.service.requests, [])
        self.assertEqual(len(self.kept()), len(cases))

    def test_an_origin_only_override_gets_the_api_path(self):
        origin = self.service.url.removesuffix("/api/feedback")
        with mock.patch.dict(os.environ, {feedback.TEST_URL_ENV: origin}):
            status, _, _ = self.send("--title", "t", "d")
        self.assertEqual(status, 0)
        self.assertEqual(self.service.created()["path"], "/api/feedback")

    def test_rate_limited_and_deduplicated(self):
        for index in range(feedback.DAILY_LIMIT):
            self.send("--title", "t", f"note {index}")
        status, out, _ = self.send("--title", "t", "one too many")
        self.assertEqual(status, 1)
        self.assertIn("20 reports already went out", out)
        self.assertEqual(self.service.steps().count("create"), feedback.DAILY_LIMIT)
        status, out, _ = self.send("--title", "t", "note 3")
        self.assertEqual(status, 0)
        self.assertIn("already went out", out)

    def test_a_failed_send_frees_its_slot(self):
        self.service.statuses["create"] = 503
        self.send("--title", "t", "try me")
        self.service.statuses["create"] = 201
        status, out, _ = self.send("--title", "t", "try me")
        self.assertEqual(status, 0, out)

    def test_a_busy_count_keeps_it_and_says_so(self):
        with mock.patch.object(usage, "take_feedback_slot", return_value="busy"):
            status, out, _ = self.send("--title", "t", "busy")
        self.assertEqual(status, 1)
        self.assertIn("another ardia was updating the report count", out)
        self.assertEqual(self.kept()[0]["description"], "busy")

    def test_a_checkout_without_a_cli_home_writes_nothing(self):
        os.environ.pop("ARDIA_CLI_HOME")
        with mock.patch.object(usage, "open_folder") as opened, mock.patch.object(usage, "locked") as locked:
            status, out, _ = self.send("--title", "t", "no home")
            self.assertEqual(status, 0)
            with mock.patch.dict(os.environ, {"DO_NOT_TRACK": "1"}):
                status, out, _ = self.send("--title", "t", "no home, not sent")
        opened.assert_not_called()
        locked.assert_not_called()
        self.assertEqual(status, 1)
        self.assertIn("It wasn't saved either", out)

    def test_a_checkout_without_a_data_dir_reads_no_consent_file(self):
        with mock.patch.object(telemetry, "read_consent") as read:
            self.send("--title", "t", "d", data_dir=False)
        read.assert_not_called()


class AttachTest(FeedbackCase):
    def file(self, name: str, size: int = 10) -> str:
        path = self.temp / name
        path.write_bytes(b"x" * size)
        return str(path)

    def test_names_follow_the_contract(self):
        files = [self.file(name) for name in ("a.mp4", "t.json.gz", "x.ips", "y.ips", "s.png", "notes.txt")]
        status, _, _ = self.send("--title", "t", *[arg for file in files for arg in ("--attach", file)], "d")
        self.assertEqual(status, 0)
        names = [item["name"] for item in self.service.created()["body"]["attachments"]]
        self.assertEqual(names, ["recording.mp4", "trace.json.gz", "crash-1.ips", "crash-2.ips", "attachment-1.png", "attachment-2.txt"])
        self.assertEqual(sorted(self.service.files), sorted(names))

    def test_refusals(self):
        with mock.patch.object(feedback, "OTHER_FILE_BYTES", 5), mock.patch.object(feedback, "RECORDING", ("recording.mp4", 5, "video/mp4")):
            cases = [
                ([self.file("a.exe")], "can't attach this kind of file"),
                ([self.file("big.png", 6)], "over the 0 MB limit"),
                ([self.file("big.mp4", 6)], "over the 0 MB limit"),
                ([self.file("a.mp4", 1), self.file("b.mp4", 1)], "only one .mp4"),
                ([self.file("empty.txt", 0)], "the file is empty"),
                ([str(self.temp / "missing.png")], "No such file"),
                ([str(self.temp)], "not a file"),
                ([self.file(f"f{index}.txt", 1) for index in range(feedback.MAX_ATTACHMENTS + 1)], "at most 10 files"),
            ]
            for files, message in cases:
                with self.subTest(message=message):
                    status, _, err = self.send("--title", "t", *[arg for file in files for arg in ("--attach", file)], "d")
                    self.assertEqual(status, 2)
                    self.assertIn(message, err)
        self.assertEqual(self.service.requests, [])


class TelemetrySessionAndKeyTest(unittest.TestCase):
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
            mock.patch.object(telemetry, "spawn_flusher"),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        telemetry._reported.clear()
        telemetry._process_session = None

    def run_cli(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                return cli.main(list(argv))
            except SystemExit as stop:
                return stop.code

    def spool(self) -> list[dict]:
        path = self.root / telemetry.FOLDER / telemetry.SPOOL
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def local(self) -> list[dict]:
        folder = self.root / telemetry.FOLDER / telemetry.LOCAL_FOLDER
        return [json.loads(line) for path in sorted(folder.glob("cli-*.jsonl")) for line in path.read_text().splitlines()]

    def test_events_carry_the_app_session_while_it_is_open(self):
        write_consent(self.root, sessionOpen=True, sessionId=APP_SESSION)
        self.run_cli("config", "path")
        self.assertEqual(self.spool()[-1]["properties"]["$session_id"], APP_SESSION)

    def test_events_carry_one_uuid7_per_process_otherwise(self):
        write_consent(self.root, sessionOpen=False, sessionId=APP_SESSION)
        self.run_cli("config", "path")
        self.run_cli("config", "path")
        sessions = {record["properties"]["$session_id"] for record in self.spool()}
        self.assertEqual(len(sessions), 1)
        session = sessions.pop()
        self.assertNotEqual(session, APP_SESSION)
        self.assertEqual(session[14], "7")

    def test_a_watch_tags_events(self):
        write_consent(self.root, sharingUntil=int((time.time() + 3600) * 1000), watchReport="FB-AB12")
        self.run_cli("config", "path")
        self.assertEqual(self.spool()[-1]["properties"]["watch_report"], "FB-AB12")
        write_consent(self.root, sharingUntil="2020-01-01T00:00:00Z", watchReport="FB-AB12")
        self.assertIsNone(telemetry.consent(self.root))

    def test_a_newer_version_and_unknown_fields_still_count(self):
        for version in (2, 9):
            write_consent(self.root, version=version, futureField=[1, 2])
            self.assertEqual(telemetry.consent(self.root), INSTALL_ID)

    def test_posts_carry_the_cli_ingest_key(self):
        write_consent(self.root)
        self.run_cli("config", "path")
        self.assertEqual(telemetry.flush(self.root, self.stub.url, "test"), "done")
        self.assertTrue(self.stub.headers)
        self.assertTrue(all(headers["X-Ardia-Key"] == telemetry.CLI_INGEST_KEY for headers in self.stub.headers))
        sent = attributes(self.stub.records()[-1])
        self.assertTrue(sent["$session_id"])

    def test_the_cli_key_matches_the_shared_constants(self):
        source = REPO / "packages" / "core" / "src" / "ingestKeys.ts"
        if not source.exists():
            self.skipTest("packages/core/src/ingestKeys.ts isn't there yet")
        found = re.search(r'CLI_INGEST_KEY = "([^"]+)"', source.read_text())
        self.assertEqual(found.group(1), telemetry.CLI_INGEST_KEY)
        self.assertIn(f'INGEST_KEY_HEADER = "{telemetry.INGEST_KEY_HEADER}"', source.read_text())

    def test_local_copy_keeps_events_with_sharing_on_and_off(self):
        write_consent(self.root)
        self.run_cli("config", "path")
        self.assertEqual(self.spool()[-1]["distinct_id"], INSTALL_ID)
        write_consent(self.root, sharing=False)
        self.run_cli("config", "path")
        self.assertEqual(self.spool(), [])
        local = self.local()
        self.assertEqual([record["sent"] for record in local], [True, False])
        self.assertEqual(local[0]["distinct_id"], INSTALL_ID)
        self.assertEqual(local[1]["distinct_id"], telemetry.LOCAL_ONLY_ID)
        self.assertTrue(all(record["event"] == "cli_command" and record["properties"]["$session_id"] for record in local))
        folder = self.root / telemetry.FOLDER / telemetry.LOCAL_FOLDER
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        name = f"cli-{time.strftime('%Y-%m-%d', time.gmtime())}.jsonl"
        self.assertEqual((folder / name).stat().st_mode & 0o777, 0o600)

    def test_opt_outs_and_checkouts_keep_no_local_copy(self):
        write_consent(self.root)
        with mock.patch.dict(os.environ, {"DO_NOT_TRACK": "1"}):
            self.run_cli("config", "path")
        os.environ.pop(telemetry.TEST_URL_ENV)
        self.run_cli("config", "path")
        self.assertEqual(self.local(), [])

    def test_local_copy_drops_days_older_than_seven(self):
        day = 86400
        now = time.time()
        record = {"uuid": "u", "event": "cli_command", "distinct_id": "local", "timestamp": "t", "properties": {}}
        for back in (9, 7, 6, 0):
            self.assertTrue(telemetry.keep_local_copy(self.root, [record], False, now - back * day))
        folder = self.root / telemetry.FOLDER / telemetry.LOCAL_FOLDER
        kept = sorted(path.name for path in folder.glob("cli-*.jsonl"))
        expected = sorted(telemetry.local_name(now - back * day) for back in (6, 0))
        self.assertEqual(kept, expected)

    def test_local_copy_is_capped_oldest_lines_first(self):
        now = time.time()
        with mock.patch.object(telemetry, "MAX_LOCAL_BYTES", 2000):
            for index in range(40):
                record = {"uuid": f"u{index:02d}", "event": "cli_command", "distinct_id": "local", "timestamp": "t", "properties": {"pad": "x" * 40}}
                telemetry.keep_local_copy(self.root, [record], False, now - (2 - index // 20) * 86400)
        folder = self.root / telemetry.FOLDER / telemetry.LOCAL_FOLDER
        files = sorted(folder.glob("cli-*.jsonl"))
        self.assertLessEqual(sum(path.stat().st_size for path in files), 2000)
        uuids = [json.loads(line)["uuid"] for path in files for line in path.read_text().splitlines()]
        self.assertEqual(uuids, [f"u{index:02d}" for index in range(40 - len(uuids), 40)])
        self.assertGreater(len(uuids), 10)

    def test_a_shared_local_folder_made_by_the_app_is_used(self):
        folder = self.root / telemetry.FOLDER
        folder.mkdir(mode=0o700)
        (folder / telemetry.LOCAL_FOLDER).mkdir(mode=0o755)
        record = {"uuid": "u", "event": "e", "distinct_id": "local", "timestamp": "t", "properties": {}}
        self.assertTrue(telemetry.keep_local_copy(self.root, [record], False))
        os.chmod(folder / telemetry.LOCAL_FOLDER, 0o777)
        self.assertFalse(telemetry.keep_local_copy(self.root, [record], False))


@unittest.skipUnless(shutil.which("node") and (REPO / "infra" / "feedback" / "server.mjs").exists(), "needs node and infra/feedback")
class LocalServiceEndToEndTest(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.store = self.temp / "service"
        self.server = subprocess.Popen(
            ["node", str(REPO / "infra" / "feedback" / "server.mjs"), "--local", str(self.store), "--port", "0"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self.addCleanup(self.stop)
        line = self.server.stdout.readline()
        found = re.search(r"http://127\.0\.0\.1:(\d+)", line)
        if not found:
            self.fail(f"the feedback service didn't start: {line}{self.server.stdout.read() if self.server.poll() is not None else ''}")
        self.url = f"http://127.0.0.1:{found.group(1)}"
        self.data = self.temp / "data"
        self.data.mkdir()
        self.home = self.temp / "cli"

    def stop(self):
        self.server.terminate()
        try:
            self.server.wait(10)
        except subprocess.TimeoutExpired:
            self.server.kill()
        self.server.stdout.close()

    def ardia(self, *argv) -> subprocess.CompletedProcess:
        env = {k: v for k, v in os.environ.items() if k not in CLEARED + ("ARDIA_CLI_HOME",)}
        env.update({"ARDIA_CLI_HOME": str(self.home), feedback.TEST_URL_ENV: self.url})
        return subprocess.run(
            [sys.executable, "-m", "ardia_cli", "feedback", "--data-dir", str(self.data), *argv],
            cwd=REPO / "apps" / "cli", env=env, capture_output=True, text=True, timeout=60,
        )

    def test_a_report_with_a_file_lands_in_the_service(self):
        write_consent(self.data, sessionOpen=True, sessionId=APP_SESSION)
        shot = self.temp / "shot.png"
        shot.write_bytes(b"\x89PNG" + os.urandom(2048))
        done = self.ardia("--title", "snapshot hides dialog buttons", "--kind", "bug", "--attach", str(shot),
                          "the Save button in a dialog had no ref; Authorization: Bearer abc123 was in the log")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        reference = re.search(r"^Sent\. Reference (FB-[A-Z0-9]+)\.$", done.stdout, re.M).group(1)
        self.assertRegex(done.stdout, r"\nIssue: file://.+issue\.md\n")
        self.assertRegex(done.stdout, r"You appear to us as [A-Z][a-z]+ [A-Z][a-z]+\.\n$")
        folder = self.store / "feedback" / reference
        report = json.loads((folder / "report.json").read_text())
        self.assertEqual(report["install_id"], INSTALL_ID)
        self.assertEqual(report["session_id"], APP_SESSION)
        self.assertEqual(report["source"], "cli")
        self.assertNotIn("abc123", report["description"])
        self.assertEqual((folder / "attachment-1.png").read_bytes(), shot.read_bytes())
        self.assertTrue((folder / "complete.json").exists())
        print(f"\n[e2e] {done.stdout.strip()}")

    def test_sharing_off_gets_a_one_time_id(self):
        done = self.ardia("--title", "idea", "--kind", "idea", "a --json flag on ardia windows")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        reference = re.search(r"Reference (FB-[A-Z0-9]+)", done.stdout).group(1)
        report = json.loads((self.store / "feedback" / reference / "report.json").read_text())
        self.assertNotEqual(report["install_id"], INSTALL_ID)
        self.assertIn("(a one-time id: sharing is off)", done.stdout)

    def test_a_refusal_from_the_service_is_reported_and_kept(self):
        done = self.ardia("--title", "t", "--attach", str(self.temp / "nothing.png"), "d")
        self.assertEqual(done.returncode, 2)
        self.stop()
        offline = self.ardia("--title", "t", "service is down")
        self.assertEqual(offline.returncode, 1)
        self.assertIn("Not sent: the network failed", offline.stdout)


if __name__ == "__main__":
    unittest.main()
