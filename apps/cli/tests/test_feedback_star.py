import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ardia_cli import caller, cli, endpoint, feedback, star, telemetry, telemetry_scrub, usage
from test_telemetry import CLEARED, INSTALL_ID, Stub, attributes, scratch_dir, write_consent


class Case(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.data = self.temp / "data"
        self.data.mkdir()
        self.home = self.temp / "cli"
        self.stub = Stub()
        self.addCleanup(self.stub.close)
        env = {k: v for k, v in os.environ.items() if k not in CLEARED + ("ARDIA_CLI_HOME", usage.STAR_PROMPT_ENV) + usage.CI_ENV}
        env.update({"ARDIA_CLI_HOME": str(self.home), telemetry.TEST_URL_ENV: self.stub.url})
        for patch in (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.data),
            mock.patch.object(caller, "_current", caller.Caller("Claude Code")),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        spawn = mock.patch.object(telemetry, "spawn_flusher")
        self.spawn = spawn.start()
        self.addCleanup(spawn.stop)

    def run_cli(self, *argv, stdin=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(sys, "stdin", stdin or io.StringIO("")):
            try:
                status = cli.main(list(argv))
            except SystemExit as stop:
                status = stop.code
        return status, out.getvalue(), err.getvalue()

    def spool(self) -> list[dict]:
        path = self.data / telemetry.FOLDER / telemetry.SPOOL
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def feedback_events(self) -> list[dict]:
        return [record for record in self.spool() if record["event"] == feedback.EVENT]

    def local_feedback(self) -> list[dict]:
        path = self.home / usage.FOLDER / feedback.LOCAL_FILE
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


class ScrubTest(unittest.TestCase):
    def test_free_text_drops_secrets_emails_url_queries_and_home_names(self):
        text, truncated = telemetry_scrub.free_text(
            "open https://bob:pw@example.com/reset?code=abc#x failed\nfor jane.doe@example.org with ghp_abcdefghijklmnopqrstuvwx12\n"
            "in /Users/jane/site card 4111 1111 1111 1111 id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08\n"
            "Authorization: Bearer abcdefghijk123\npassword=hunter2 api_key: 'zz'",
            1000,
        )
        for leaked in ("bob", "pw@", "code=abc", "jane.doe", "ghp_", "abcdefghijk123", "hunter2", "'zz'", "/Users/jane", "4111", "9f86d08"):
            self.assertNotIn(leaked, text)
        self.assertIn("https://example.com/reset?<redacted> failed", text)
        self.assertIn("for <email> with <secret>", text)
        self.assertTrue(text.endswith("\n<redacted>"), text)
        self.assertIn("/Users/<user>/site", text)
        self.assertFalse(truncated)

    def test_free_text_keeps_commands_versions_and_refs(self):
        text, _ = telemetry_scrub.free_text("ardia browse click @e7 on 0.2.44 exited 2 at 16:53", 1000)
        self.assertEqual(text, "ardia browse click @e7 on 0.2.44 exited 2 at 16:53")

    def test_free_text_stays_fast_on_huge_input_and_never_cuts_a_token_in_half(self):
        started = telemetry.time.monotonic()
        for text in ("a" * 65536, "a1" * 32768, "x@" * 30000, "ok " * 600 + "ghp_" + "Z9" * 400):
            clean, truncated = telemetry_scrub.free_text(text, 1000)
            self.assertTrue(truncated)
            self.assertNotIn("Z9Z9", clean)
        self.assertLess(telemetry.time.monotonic() - started, 1)

    def test_free_text_drops_secret_values_under_quoted_keys(self):
        for text in (
            '{"password":"hunter2","api_key":"short-key"}',
            "{'password': 'hunter2', 'api_key': 'short-key'}",
            'password = "hunter2" api_key = "short-key"',
            '`password`: `hunter2` and api_key => "short-key"',
            '{"password": "hun\\"ter2", "api_key": "short-key"}',
        ):
            with self.subTest(text=text):
                clean, _ = telemetry_scrub.free_text(text, 1000)
                self.assertNotIn("hunter2", clean.replace("\\", ""))
                self.assertNotIn("ter2", clean)
                self.assertNotIn("short-key", clean)
                self.assertTrue(clean.endswith("<redacted>"), clean)

    def test_free_text_drops_an_unterminated_quoted_value_to_the_end(self):
        for text in ('password="' + "hunter2 " * 400, "token: '" + "hunter2 " * 40, '{"api_key": "hunter2 hunter2'):
            with self.subTest(text=text[:20]):
                clean, _ = telemetry_scrub.free_text(text, 1000)
                self.assertNotIn("hunter2", clean)

    def test_free_text_close_variants(self):
        cases = {
            "password: hunter2\nuser: bob": "hunter2",
            "Authorization: Basic dXNlcjpodW50ZXIy then it failed": "dXNlcjpodW50ZXIy",
            "Authorization: Basic abc123": "abc123",
            "the page went to /reset?token=hunter2&next=home": "hunter2",
            "it asked for ?api_key=short-key on reload": "short-key",
            "cookie=sid=hunter2; path=/": "hunter2",
        }
        for text, secret in cases.items():
            with self.subTest(text=text):
                self.assertNotIn(secret, telemetry_scrub.free_text(text, 1000)[0])

    def assert_scrubbed(self, text, *secrets, keep=()):
        clean, _ = telemetry_scrub.free_text(text, 1000)
        for secret in secrets:
            self.assertNotIn(secret, clean, clean)
        for kept in keep:
            self.assertIn(kept, clean, clean)
        return clean

    def test_unterminated_value_with_a_dangling_escape(self):
        self.assert_scrubbed('{"password":"hunter2\\', "hunter2")
        self.assert_scrubbed("{'token': 'hunter2\\", "hunter2")
        self.assert_scrubbed('{"api_key": "abc\\"hunter2\\', "hunter2", "abc")

    def test_sensitive_headers_lose_everything_after_the_colon(self):
        self.assert_scrubbed('Authorization: Bearer "shortsecret"', "shortsecret")
        self.assert_scrubbed("Cookie: session=shortsecret; other=anothersecret", "shortsecret", "anothersecret")
        self.assert_scrubbed("Set-Cookie: sid=shortsecret; Path=/; HttpOnly", "shortsecret")
        self.assert_scrubbed("Proxy-Authorization: Basic zz", "zz")
        self.assert_scrubbed("X-Auth-Token: t1", "t1")
        self.assert_scrubbed("X-Client-Secret: s1\nX-Goog-Api-Key: k1", "s1", "k1")
        self.assert_scrubbed("the request sent Authorization: Bearer abc and failed", "abc")

    def test_every_digest_parameter_goes(self):
        self.assert_scrubbed(
            'Authorization: Digest username="bob", realm="r", nonce="n0nce", uri="/x", response="r3sp0nse", opaque="0paque"',
            "bob", "n0nce", "r3sp0nse", "0paque",
        )
        self.assert_scrubbed('authorization=Digest username="bob", response="r3sp0nse"', "bob", "r3sp0nse")

    def test_pairs_after_a_sensitive_key_go_in_cookie_lists(self):
        self.assert_scrubbed("session=shortsecret; other=anothersecret", "shortsecret", "anothersecret")
        self.assert_scrubbed("it set token=t0k; refresh=r3fresh; theme=dark", "t0k", "r3fresh", "dark", keep=("it set",))

    def test_curl_headers(self):
        clean = self.assert_scrubbed(
            "curl -H 'Authorization: Bearer abc' --header \"X-Api-Key: k123\" -H 'Cookie: a=b; c=d' -H 'Accept: text/html' https://example.com/api",
            "abc", "k123", "a=b", "c=d",
            keep=("curl -H",),
        )
        self.assertNotIn("example.com", clean)
        self.assert_scrubbed("curl -H'authorization: token zz9' -H \"cookie: x=1", "zz9", "x=1")

    def test_http_request_dump(self):
        dump = (
            "POST /api/login HTTP/1.1\r\n"
            "Host: example.com\r\n"
            "Cookie: session=s3ss; csrf=c5rf\r\n"
            "Authorization: Bearer t0ken\r\n"
            "X-Api-Key: k3y\r\n"
            "Content-Type: application/json\r\n"
            "\r\n"
            '{"username":"bob","password":"hunter2","remember":true}'
        )
        self.assert_scrubbed(dump, "s3ss", "c5rf", "t0ken", "k3y", "hunter2", keep=("Host: example.com", "POST /api/login"))

    def test_codex_round_four(self):
        self.assert_scrubbed(
            'curl -H "Authorization: Digest username=\\"bob-secret\\", realm=\\"r\\", nonce=\\"n0nce\\", response=\\"r3sp\\"" https://example.com/x\nthen click failed',
            "bob-secret", "n0nce", "r3sp", "then click failed", keep=("curl -H",),
        )
        self.assert_scrubbed('session="first-secret"; other=second-secret', "first-secret", "second-secret")
        self.assert_scrubbed('it sent Bearer "quoted-secret" and got 401', "quoted-secret", keep=("it sent",))
        self.assert_scrubbed(
            "GET / HTTP/1.1\nAuthorization: Digest username=\"bob\",\n  response=\"f0lded-secret\",\n\topaque=\"tab-secret\"\nAccept: text/html",
            "f0lded-secret", "tab-secret", "Accept", keep=("GET / HTTP/1.1",),
        )

    def test_text_after_a_keyword_goes_to_the_end(self):
        clean = self.assert_scrubbed("the token expired: abc123 again\nsnapshot -i was fine", "abc123", "again", "snapshot", keep=("the ",))
        self.assertIn("<redacted>", clean)
        self.assert_scrubbed("X-Goog-Api-Key: k1\nnext", "k1", "next")
        self.assert_scrubbed("my Private Key was pasted: MIIEv", "MIIEv")
        self.assert_scrubbed("auth header was abc", "abc")

    def test_backslash_continuations_go_too(self):
        self.assert_scrubbed("curl -H 'Authorization: Basic x' \\\n  -d 'k=s3cret' https://a.test\nok then", "s3cret", "ok then")

    def test_an_unclosed_quote_goes_with_the_rest(self):
        self.assert_scrubbed('password="line one\nline-two-secret" tail\nafter', "line one", "line-two-secret", "tail", "after")
        self.assert_scrubbed("token='a\nb-secret\nc-secret", "b-secret", "c-secret")

    def test_apostrophes_change_nothing(self):
        self.assert_scrubbed("the token didn't refresh\nsnapshot was fine", "refresh", "snapshot", keep=("the ",))

    def test_codex_round_five(self):
        self.assertEqual(telemetry_scrub.free_text('password = r"""first\nhunter2"""', 1000)[0], "<redacted>")
        self.assertEqual(telemetry_scrub.free_text('session=a"first\nhunter2"', 1000)[0], "<redacted>")

    def test_everything_after_the_first_keyword_goes(self):
        clean = self.assert_scrubbed("snapshot -i hid a button\nthen the token broke\nand later snapshot", "broke", "later", keep=("snapshot -i hid a button\nthen the ",))
        self.assertTrue(clean.endswith("<redacted>"))

    def test_feedback_and_command_both_go_through_the_scrubber(self):
        props = feedback.properties('{"password":"hunter2"}', 'ardia browse fill @e2 "x" --headers {"api_key":"short-key"}', Path("/nonexistent"), {})
        self.assertNotIn("hunter2", props["text"])
        self.assertNotIn("short-key", props["about_command"])

    def test_free_text_caps_length(self):
        text, truncated = telemetry_scrub.free_text("word " * 400, 1000)
        self.assertLessEqual(len(text), 1000)
        self.assertTrue(truncated)


class FeedbackTest(Case):
    def test_sends_a_cli_feedback_event_with_agent_version_and_recent_commands(self):
        write_consent(self.data)
        with mock.patch("ardia_cli.browse.cli.main", return_value=0):
            self.run_cli("--data-dir", str(self.data), "browse", "snapshot", "-i")
            self.run_cli("--data-dir", str(self.data), "browse", "click", "@e3")
        status, out, _ = self.run_cli("feedback", "--data-dir", str(self.data), "--command", "ardia browse click @e3", "click passed but https://a.test/x?sid=1 didn't change; mail a@b.co")
        self.assertEqual(status, 0)
        self.assertEqual(out.strip(), "Thanks, sent to Ardia's developer.")
        events = self.feedback_events()
        self.assertEqual(len(events), 1)
        props = events[0]["properties"]
        self.assertEqual(events[0]["distinct_id"], INSTALL_ID)
        self.assertEqual(props["text"], "click passed but https://a.test/x?<redacted> didn't change; mail <email>")
        self.assertEqual(props["about_command"], "ardia browse click @e3")
        self.assertEqual(props["agent"], "Claude Code")
        self.assertEqual(props["recent_commands"], ["browse snapshot", "browse click"])
        self.assertEqual(props["cli_version"], telemetry.__version__)
        self.assertEqual(props["$environment"], telemetry.environment_for(self.data))
        self.spawn.assert_called()

    def test_flushes_at_once_even_inside_the_usual_interval_and_reaches_the_collector(self):
        write_consent(self.data)
        dir_fd = telemetry.open_folder(self.data)
        try:
            telemetry.write_state(dir_fd, 0, telemetry.time.time() + 60)
        finally:
            os.close(dir_fd)
        self.run_cli("feedback", "--data-dir", str(self.data), "the error didn't say which flag was wrong")
        self.assertEqual(self.spawn.call_count, 1)
        self.assertEqual(telemetry.flush(self.data, self.stub.url, "production"), "done")
        sent = [attributes(record) for record in self.stub.records() if record["body"]["stringValue"] == feedback.EVENT]
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["text"], "the error didn't say which flag was wrong")
        self.assertEqual(sent[0]["$lib"], telemetry.LIB)

    def test_waits_while_the_flusher_backs_off(self):
        write_consent(self.data)
        dir_fd = telemetry.open_folder(self.data)
        try:
            telemetry.write_state(dir_fd, 3, telemetry.time.time() + 600)
        finally:
            os.close(dir_fd)
        self.run_cli("feedback", "--data-dir", str(self.data), "slow")
        self.spawn.assert_not_called()
        self.assertEqual(len(self.feedback_events()), 1)

    def test_reads_stdin(self):
        write_consent(self.data)
        status, _, _ = self.run_cli("feedback", "--data-dir", str(self.data), stdin=io.StringIO("from stdin\n"))
        self.assertEqual(status, 0)
        self.assertEqual(self.feedback_events()[0]["properties"]["text"], "from stdin")

    def test_empty_text_is_a_usage_error(self):
        status, _, err = self.run_cli("feedback", "--data-dir", str(self.data))
        self.assertEqual(status, 2)
        self.assertIn("needs text", err)

    def test_saves_locally_when_sharing_is_off(self):
        status, out, _ = self.run_cli("feedback", "--data-dir", str(self.data), "nothing to send")
        self.assertEqual(status, 0)
        self.assertIn("stayed on this Mac", out)
        self.assertEqual(self.spool(), [])
        self.assertEqual(self.local_feedback()[0]["text"], "nothing to send")
        self.spawn.assert_not_called()

    def test_saves_locally_under_opt_outs_and_test_endpoints(self):
        write_consent(self.data)
        for extra in ({"DO_NOT_TRACK": "1"}, {"ARDIA_TELEMETRY": "off"}, {"ARDIA_PORT": "9222"}):
            with mock.patch.dict(os.environ, extra):
                self.run_cli("feedback", "--data-dir", str(self.data), f"opted out {extra}")
        self.assertEqual(self.spool(), [])
        self.assertEqual(len(self.local_feedback()), 3)

    def test_rate_limited_per_install_and_deduplicated(self):
        write_consent(self.data)
        for index in range(feedback.DAILY_LIMIT):
            self.run_cli("feedback", "--data-dir", str(self.data), f"note {index}")
        status, out, _ = self.run_cli("feedback", "--data-dir", str(self.data), "one too many")
        self.assertEqual(status, 0)
        self.assertIn("20 notes went out", out)
        self.assertEqual(len(self.feedback_events()), feedback.DAILY_LIMIT)
        self.assertEqual(self.local_feedback()[-1]["text"], "one too many")
        status, out, _ = self.run_cli("feedback", "--data-dir", str(self.data), "note 3")
        self.assertIn("already sent", out)

    def test_limit_frees_up_after_a_day(self):
        now = 1_000_000.0
        for index in range(feedback.DAILY_LIMIT):
            self.assertEqual(usage.take_feedback_slot(self.home, f"d{index}", feedback.DAILY_LIMIT, feedback.WINDOW_S, now), "ok")
        self.assertEqual(usage.take_feedback_slot(self.home, "late", feedback.DAILY_LIMIT, feedback.WINDOW_S, now + 60), "limited")
        self.assertEqual(usage.take_feedback_slot(self.home, "late", feedback.DAILY_LIMIT, feedback.WINDOW_S, now + feedback.WINDOW_S + 1), "ok")


def call(argv):
    return SimpleNamespace(argv=argv, command="browse", subcommand=None, browse_argv=argv)


class TaskCountTest(Case):
    def record(self, argv, at, status=0, env=None):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch.object(usage.time, "time", return_value=at):
            usage.record(call(argv), status, os.environ if env is None else env)
        return err.getvalue()

    def tasks(self, count, start=0.0, argv=("open", "https://example.com")):
        shown = []
        for index in range(count):
            at = start + index * (usage.TASK_GAP_S + 60)
            shown.append(self.record(list(argv), at))
            shown.append(self.record(["snapshot", "-i"], at + 5))
        return "".join(shown), start + count * (usage.TASK_GAP_S + 60)

    def state(self):
        return usage.read(self.home)

    def test_a_task_is_a_stretch_of_work_ended_by_a_half_hour_gap(self):
        self.record(["open", "https://a.test"], 0)
        self.record(["click", "@e1"], 60)
        self.record(["click", "@e2"], 60 + usage.TASK_GAP_S - 1)
        self.assertEqual(self.state()["tasks"]["done"] if "done" in self.state()["tasks"] else 0, 0)
        self.record(["snapshot"], 60 + usage.TASK_GAP_S * 3)
        self.assertEqual(self.state()["tasks"]["done"], 1)
        self.assertFalse(self.state()["tasks"]["open"])

    def test_read_only_or_failed_commands_dont_start_a_task(self):
        self.record(["snapshot", "-i"], 0)
        self.record(["help"], 10)
        self.record(["click", "@e1"], 20, status=1)
        self.record(["snapshot"], usage.TASK_GAP_S * 3)
        self.assertEqual(self.state()["tasks"].get("done", 0), 0)

    def test_asks_once_after_the_fifth_task(self):
        shown, later = self.tasks(5)
        self.assertEqual(shown, "")
        self.assertEqual(self.record(["click", "@e1"], later), usage.STAR_PROMPT + "\n")
        self.assertEqual(self.record(["click", "@e1"], later + usage.TASK_GAP_S * 2), "")
        more, _ = self.tasks(10, later + usage.TASK_GAP_S * 4)
        self.assertEqual(more, "")

    def test_never_asks_in_test_contexts(self):
        for argv, env in (
            (["--port", "9222", "open", "https://a.test"], {}),
            (["--ws=ws://127.0.0.1:1/devtools/browser/x", "open", "https://a.test"], {}),
            (["open", "https://a.test"], {"ARDIA_PORT": "9222"}),
            (["open", "https://a.test"], {"ARDIA_DATA_DIR": str(self.temp / "throwaway")}),
            (["--data-dir", str(self.temp / "throwaway"), "open", "https://a.test"], {}),
        ):
            with self.subTest(argv=argv, env=env):
                shutil.rmtree(self.home, True)
                with mock.patch.dict(os.environ, env):
                    for index in range(8):
                        self.assertEqual(self.record(argv, index * (usage.TASK_GAP_S + 60)), "")
                self.assertEqual(self.state()["tasks"].get("done", 0), 0)

    def test_installed_data_dir_counts(self):
        argv = ["--data-dir", str(self.data), "open", "https://a.test"]
        _, later = self.tasks(5, argv=argv)
        self.assertEqual(self.record(argv, later), usage.STAR_PROMPT + "\n")

    def test_env_opt_out_and_ci_keep_counting_but_stay_quiet(self):
        for env in ({usage.STAR_PROMPT_ENV: "0"}, {"CI": "true"}):
            with self.subTest(env=env):
                shutil.rmtree(self.home, True)
                with mock.patch.dict(os.environ, env):
                    shown, later = self.tasks(7)
                    self.assertEqual(shown + self.record(["click"], later), "")
                self.assertGreaterEqual(self.state()["tasks"]["done"], 5)
                self.assertNotIn("prompted_at", self.state().get("star", {}))

    def test_never_asks_after_star_ran(self):
        usage.mark_starred(self.home, "gh")
        shown, later = self.tasks(6)
        self.assertEqual(shown + self.record(["click"], later), "")

    def test_a_checkout_without_a_cli_home_records_nothing(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ARDIA_CLI_HOME")
            self.assertIsNone(usage.recording_home(os.environ))
            with mock.patch.object(usage, "locked") as locked:
                usage.record(call(["open", "x"]), 0, os.environ)
            locked.assert_not_called()

    def test_runs_through_the_cli_and_prints_on_stderr(self):
        with mock.patch.object(usage, "TASKS_BEFORE_ASKING", 1), mock.patch("ardia_cli.browse.cli.main", return_value=0):
            with mock.patch.object(usage.time, "time", return_value=0):
                self.run_cli("browse", "open", "https://a.test")
            with mock.patch.object(usage.time, "time", return_value=usage.TASK_GAP_S * 2):
                status, out, err = self.run_cli("browse", "click", "@e1")
        self.assertEqual(status, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, usage.STAR_PROMPT + "\n")
        self.assertEqual(self.state()["recent"], ["browse open", "browse click"])

    def test_recent_keeps_the_last_five_names_and_exit_codes(self):
        for index, name in enumerate(["open", "click", "fill", "press", "snapshot", "eval"]):
            self.record([name, "secret-arg"], index, status=1 if name == "eval" else 0)
        self.assertEqual(self.state()["recent"], ["browse click", "browse fill", "browse press", "browse snapshot", "browse eval (exit 1)"])


class StarTest(Case):
    def args(self, data_dir=None):
        return SimpleNamespace(data_dir=data_dir)

    def star(self, run, which, data_dir=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = star.run(self.args(data_dir), run=run, which=which)
        return status, out.getvalue(), err.getvalue()

    def fake_run(self, codes):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            code = codes[0] if "api" in command else codes[1]
            return subprocess.CompletedProcess(command, code, "", "")

        return run, calls

    def test_stars_through_gh_when_it_works(self):
        run, calls = self.fake_run((0, 0))
        status, out, _ = self.star(run, lambda name: "/opt/homebrew/bin/gh")
        self.assertEqual(status, 0)
        self.assertEqual(calls, [["/opt/homebrew/bin/gh", "api", "--method", "PUT", "/user/starred/mantrakp04/ardia", "--silent"]])
        self.assertIn("Starred", out)
        self.assertEqual(usage.read(self.home)["star"]["via"], "gh")

    def test_opens_the_page_in_a_new_ardia_tab_when_gh_isnt_signed_in(self):
        run, calls = self.fake_run((4, 0))
        status, out, _ = self.star(run, lambda name: "/usr/local/bin/gh", data_dir="/tmp/d")
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 2)
        browse = calls[1]
        self.assertEqual(browse[:4], [sys.executable, "-I", "-m", "ardia_cli"])
        self.assertEqual(browse[4:], ["--data-dir", "/tmp/d", "browse", "--session", star.SESSION, "open", star.URL, "--show"])
        self.assertIn("Ask the user to click Star", out)
        self.assertEqual(usage.read(self.home)["star"]["via"], "browser")

    def test_skips_gh_when_it_isnt_installed(self):
        run, calls = self.fake_run((0, 0))
        status, _, _ = self.star(run, lambda name: None)
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("api", calls[0])

    def test_reports_when_neither_works_and_still_never_asks_again(self):
        run, _ = self.fake_run((1, 2))
        status, out, err = self.star(run, lambda name: "/usr/bin/gh")
        self.assertEqual(status, 1)
        self.assertIn(star.URL, err)
        self.assertTrue(usage.read(self.home)["star"]["done_at"])
        self.assertFalse(usage.due_for_prompt({**usage.read(self.home), "tasks": {"done": 99}}))

    def test_gh_timeout_falls_back(self):
        def run(command, **kwargs):
            if "api" in command:
                raise subprocess.TimeoutExpired(command, 20)
            return subprocess.CompletedProcess(command, 0, "", "")

        status, out, _ = self.star(run, lambda name: "/usr/bin/gh")
        self.assertEqual(status, 0)
        self.assertIn("new Ardia tab", out)

    def test_star_command_is_wired_into_the_cli(self):
        with mock.patch.object(star, "star_with_gh", return_value=True) as gh:
            status, out, _ = self.run_cli("star")
        self.assertEqual(status, 0)
        gh.assert_called_once()
        self.assertIn("Starred", out)


if __name__ == "__main__":
    unittest.main()
