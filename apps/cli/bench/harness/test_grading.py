import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browseruse_side
import grading
import opencode_side
import runner

BASELINE = 1_000
SENT_AT = "2026-11-09T10:00:00.000Z"
SENT_AT_MS = grading.epoch_ms(SENT_AT)


def check(passed, reset_at):
    return {"pass": passed, "reset_at_ms": reset_at}


class PassRule(unittest.TestCase):
    def test_every_combination(self):
        for passed in (True, False):
            for reset in (True, False):
                for timed_out in (True, False):
                    with self.subTest(passed=passed, reset=reset, timed_out=timed_out):
                        result = check(passed, BASELINE + 5 if reset else BASELINE)
                        ok, was_reset = grading.grade(result, timed_out, baseline_reset_at_ms=BASELINE)
                        self.assertEqual(was_reset, reset)
                        self.assertEqual(ok, passed and not reset and not timed_out)

    def test_a_check_without_reset_at_is_never_a_reset(self):
        self.assertEqual(grading.grade({"pass": True}, False, baseline_reset_at_ms=BASELINE), (True, False))

    def test_a_reset_after_the_prompt_went_out_counts_without_a_baseline(self):
        self.assertTrue(grading.reset_by_agent(check(True, SENT_AT_MS + 1), sent_at_ms=SENT_AT_MS))
        self.assertFalse(grading.reset_by_agent(check(True, SENT_AT_MS - 1), sent_at_ms=SENT_AT_MS))

    def test_aside_records_follow_the_same_rule(self):
        contender = {"id": "aside-opus", "kind": "aside"}
        for passed in (True, False):
            for reset in (True, False):
                for status in ("done", "timeout"):
                    with self.subTest(passed=passed, reset=reset, status=status):
                        reset_at = SENT_AT_MS + 500 if reset else SENT_AT_MS - 500
                        raw = {"status": status, "sent_at": SENT_AT, "check": check(passed, reset_at)}
                        record = runner.normalize_aside(raw, "calendar", contender, "calendar--aside-opus--r1")
                        self.assertEqual(record["reset_by_agent"], reset)
                        self.assertEqual(record["timed_out"], status == "timeout")
                        self.assertEqual(record["pass"], passed and not reset and status != "timeout")


class FailedWaitsStopTheProcess(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.fake = self.dir / "fake-browser"
        self.fake.write_text("#!/bin/sh\nexec sleep 60\n")
        self.fake.chmod(0o755)
        self.started = []
        real_popen = subprocess.Popen

        def popen(*args, **kwargs):
            proc = real_popen(*args, **kwargs)
            self.started.append(proc)
            return proc

        patcher = mock.patch.object(subprocess, "Popen", popen)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.reap)

    def reap(self):
        for proc in self.started:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)

    def opts(self):
        return {"cdp_port": 1, "relay_port": 1, "extension": str(self.dir), "window_size": "800,600",
                "browse_entry": str(self.dir / "browse.js")}

    def failing_wait(self, *args, **kwargs):
        raise RuntimeError("port never opened")

    def assert_stopped(self):
        self.assertEqual(len(self.started), 1)
        proc = self.started[0]
        deadline = time.monotonic() + 10
        while proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertIsNotNone(proc.poll())
        with self.assertRaises(ProcessLookupError):
            os.killpg(proc.pid, 0)

    def test_opencode_chrome(self):
        with mock.patch.object(opencode_side, "chrome_binary", return_value=self.fake), \
                mock.patch.object(opencode_side, "wait_until", self.failing_wait), \
                open(os.devnull, "wb") as logs, self.assertRaises(RuntimeError):
            opencode_side.launch_chrome(self.opts(), self.dir, logs)
        self.assert_stopped()

    def test_opencode_relay(self):
        with mock.patch.object(opencode_side, "node_bin", return_value=str(self.fake)), \
                mock.patch.object(opencode_side, "relay_env", return_value={"PATH": "/usr/bin:/bin"}), \
                mock.patch.object(opencode_side, "wait_until", self.failing_wait), \
                open(os.devnull, "wb") as logs, self.assertRaises(RuntimeError):
            opencode_side.start_relay(self.opts(), self.dir, logs)
        self.assert_stopped()

    def test_browseruse_chrome(self):
        with mock.patch.object(browseruse_side, "chrome_binary", return_value=self.fake), \
                mock.patch.object(opencode_side, "wait_until", self.failing_wait), \
                open(os.devnull, "wb") as logs, self.assertRaises(RuntimeError):
            browseruse_side.launch_chrome(self.opts(), self.dir, logs)
        self.assert_stopped()


if __name__ == "__main__":
    unittest.main()
