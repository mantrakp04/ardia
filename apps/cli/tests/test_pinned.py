import copy
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import browsing, endpoint
from test_linux import write_control

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "linux-session.json"


def row(title, url, pinned_url, kind, folder, profile, parked=False):
    return {"title": title, "url": url, "pinned_url": pinned_url, "kind": kind, "folder": folder, "profile": profile, "parked": parked}


EXPECTED = [
    row("https://git.example/ardia", "https://git.example/ardia", "https://git.example/ardia", "pinned", None, "Work"),
    row("Todo", "https://todo.example/today", "https://todo.example/", "pinned", None, "Personal"),
    row("Inbox", "https://mail.example/inbox", "https://mail.example/", "favorite", None, "Personal"),
    row("Music", "https://music.example/", "https://music.example/", "favorite", "Fun", "Personal"),
    row("A blog", "https://blog.example/post/1", "https://blog.example/", "pinned", "Reading", "Personal"),
    row("A paper", "https://arxiv.example/abs/1", "https://arxiv.example/abs/1", "pinned", "Papers", "Personal"),
    row("Maps", "https://maps.example/", "https://maps.example/", "favorite", None, "Travel", True),
    row("Flights", "https://air.example/booking", "https://air.example/", "pinned", "Trip", "Travel", True),
    row("Rail", "https://rail.example/", "https://rail.example/", "pinned", None, "Travel", True),
    row("Hotel", "https://hotel.example/", "https://hotel.example/", "favorite", "Stays", "Travel", True),
]


def linux_session() -> dict:
    return json.loads(FIXTURE.read_text())


def to_legacy_pin(tab: dict) -> None:
    pin = tab.pop("pin")
    tab["pinned"] = pin is not None
    if pin and pin["as"] == "row":
        tab["pinnedAsRow"] = True
    if pin and pin.get("folder"):
        tab["tileFolder"] = pin["folder"]


def macos_session(legacy: bool = False) -> dict:
    session = linux_session()
    tabs = list(session["tabs"].values())
    if legacy:
        for tab in tabs + [tab for parked in session["parkedPins"].values() for tab in parked["tabs"]]:
            to_legacy_pin(tab)
    windows = []
    for window in session["windows"].values():
        window = dict(window)
        del window["kind"]
        window["incognito"] = False
        windows.append(window)
    return {
        **session,
        "version": 2 if legacy else 9,
        "tabs": tabs,
        "groups": list(session["groups"].values()),
        "splits": [],
        "windows": list(reversed(windows)),
    }


class LinuxPinned(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-pinned-test-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        patch = mock.patch.object(endpoint, "LINUX", True)
        patch.start()
        self.addCleanup(patch.stop)
        write_control(self.root)

    def place(self, session, folder: str = "Default") -> Path:
        ardia = self.root / folder / "Ardia"
        ardia.mkdir(parents=True, exist_ok=True)
        path = ardia / "linux-session.json"
        path.write_text(session if isinstance(session, str) else json.dumps(session))
        return path

    def test_reads_the_linux_session(self):
        self.place(linux_session())
        self.assertEqual(browsing.pinned(self.root), EXPECTED)

    def test_follows_the_app_profile_in_local_state(self):
        self.place(linux_session(), "Profile 3")
        (self.root / "Local State").write_text(json.dumps({"profile": {"last_used": "Profile 3"}}))
        self.assertEqual(browsing.pinned(self.root), EXPECTED)
        for last_used in ("../Default", "Guest Profile", "Profile incognito:x", "System Profile", 7, None):
            (self.root / "Local State").write_text(json.dumps({"profile": {"last_used": last_used}}))
            self.assertEqual(browsing.pinned(self.root), [], last_used)
        (self.root / "Local State").write_text("{")
        self.assertEqual(browsing.pinned(self.root), [])
        self.place(linux_session())
        self.assertEqual(browsing.pinned(self.root), EXPECTED)

    def test_no_session_yet_is_empty(self):
        self.assertEqual(browsing.pinned(self.root), [])
        (self.root / "Default" / "Ardia").mkdir(parents=True)
        self.assertEqual(browsing.pinned(self.root), [])
        self.place([1, 2])
        self.assertEqual(browsing.pinned(self.root), [])

    def test_ignores_macos_session_json_on_linux(self):
        (self.root / "session.json").write_text(json.dumps(macos_session()))
        self.assertEqual(browsing.pinned(self.root), [])

    def test_bad_files_raise(self):
        path = self.place("{\"profiles\":")
        with self.assertRaisesRegex(browsing.BrowsingDataError, "isn't valid JSON"):
            browsing.pinned(self.root)
        path.unlink()
        target = self.root / "elsewhere.json"
        target.write_text(json.dumps(linux_session()))
        path.symlink_to(target)
        with self.assertRaisesRegex(browsing.BrowsingDataError, "can't read"):
            browsing.pinned(self.root)
        path.unlink()
        os.mkfifo(path)
        with self.assertRaisesRegex(browsing.BrowsingDataError, "isn't a regular file"):
            browsing.pinned(self.root)
        path.unlink()
        shutil.rmtree(self.root / "Default")
        (self.root / "real").mkdir()
        (self.root / "real" / "Ardia").mkdir()
        (self.root / "real" / "Ardia" / "linux-session.json").write_text(json.dumps(linux_session()))
        (self.root / "Default").mkdir()
        (self.root / "Default" / "Ardia").symlink_to(self.root / "real" / "Ardia")
        with self.assertRaisesRegex(browsing.BrowsingDataError, "can't read"):
            browsing.pinned(self.root)

    def test_too_big_raises(self):
        self.place(" " * (browsing.MAX_LINUX_SESSION_BYTES + 1))
        with self.assertRaisesRegex(browsing.BrowsingDataError, "too big"):
            browsing.pinned(self.root)

    def test_needs_control_on(self):
        self.place(linux_session())
        (self.root / endpoint.CONTROL_FILE).unlink()
        with self.assertRaisesRegex(browsing.NotRunning, "isn't running"):
            browsing.pinned(self.root)

    def test_skips_private_profiles_and_windows(self):
        session = linux_session()
        session["profiles"]["incognito:w@default"] = {"id": "incognito:w@default", "name": "Private"}
        session["windows"]["secret"] = {"id": "secret", "kind": "private", "profileId": "default", "tabIds": ["t_secret"], "activeTabIds": {}}
        session["windows"]["popup"] = {"id": "popup", "kind": "small", "profileId": "default", "tabIds": ["t_popup"], "activeTabIds": {}}
        session["tabs"]["t_secret"] = {**session["tabs"]["t_todo"], "id": "t_secret", "profileId": "incognito:w@default", "pinKey": "k_secret"}
        session["tabs"]["t_popup"] = {**session["tabs"]["t_todo"], "id": "t_popup", "pinKey": "k_popup", "windowId": "popup"}
        session["parkedPins"]["incognito:w@default"] = copy.deepcopy(session["parkedPins"]["travel"])
        self.place(session)
        self.assertEqual(browsing.pinned(self.root), EXPECTED)

    def test_never_sees_a_half_written_file(self):
        path = self.place(linux_session())
        small = json.dumps(linux_session())
        big = json.dumps({**linux_session(), "closedTabs": [{"id": f"c{i}", "tab": {"url": "https://x.example/" * 40, "profileId": "default"}} for i in range(3000)]})
        stop = threading.Event()
        failures: list[BaseException] = []
        turns = [0]

        def writer():
            try:
                while not stop.is_set():
                    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".org.chromium.Chromium.")
                    with os.fdopen(fd, "w") as handle:
                        handle.write(big if turns[0] % 2 else small)
                    os.replace(temp, path)
                    turns[0] += 1
            except BaseException as error:
                failures.append(error)

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            deadline = time.monotonic() + 1.5
            reads = 0
            while time.monotonic() < deadline:
                self.assertEqual(browsing.pinned(self.root), EXPECTED)
                reads += 1
        finally:
            stop.set()
            thread.join()
        self.assertEqual(failures, [])
        self.assertGreater(reads, 10)
        self.assertGreater(turns[0], 10)

    def test_history_labels_come_from_the_linux_session(self):
        self.place(linux_session())
        for name in ("Default", "Profile w1", "Profile 5"):
            (self.root / name).mkdir(exist_ok=True)
            (self.root / name / "History").write_bytes(b"")
        session = browsing.read_session(self.root, time.monotonic() + 5)
        self.assertEqual([(label, folder.name) for label, folder in browsing.profile_dirs(self.root, session)], [("Personal", "Default"), ("Profile 5", "Profile 5"), ("Work", "Profile w1")])


class MacosPinned(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-pinned-test-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        patch = mock.patch.object(endpoint, "LINUX", False)
        patch.start()
        self.addCleanup(patch.stop)
        write_control(self.root / "Chromium")

    def test_current_session_json(self):
        (self.root / "session.json").write_text(json.dumps(macos_session()))
        self.assertEqual(browsing.pinned(self.root), EXPECTED)

    def test_legacy_pin_fields(self):
        (self.root / "session.json").write_text(json.dumps(macos_session(legacy=True)))
        self.assertEqual(browsing.pinned(self.root), EXPECTED)

    def test_unversioned_or_old_session_is_empty(self):
        for version in (None, 1, True, "9"):
            session = macos_session()
            session["version"] = version
            (self.root / "session.json").write_text(json.dumps(session))
            self.assertEqual(browsing.pinned(self.root), [], version)

    def test_ignores_the_linux_session_on_macos(self):
        ardia = self.root / "Default" / "Ardia"
        ardia.mkdir(parents=True)
        (ardia / "linux-session.json").write_text(json.dumps(linux_session()))
        self.assertEqual(browsing.pinned(self.root), [])


if __name__ == "__main__":
    unittest.main()
