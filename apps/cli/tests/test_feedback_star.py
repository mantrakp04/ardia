import contextlib
import io
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

from ardia_cli import caller, cli, endpoint, star, telemetry, usage
from test_telemetry import CLEARED, Stub, scratch_dir


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
