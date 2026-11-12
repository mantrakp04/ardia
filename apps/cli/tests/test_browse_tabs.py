import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import paths, tabs
from ardia_cli.browse.errors import BrowseError
from ardia_cli.browse.tabs import Registry

SCRATCH = Path.home() / "ardia-scratch"


class RegistryTest(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="browse-tabs-", dir=SCRATCH))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.fd = paths.browse_dir(root)
        self.addCleanup(os.close, self.fd)
        self.locks = {}
        self.one, self.two = self.session("ka", "one"), self.session("kb", "two")

    def session(self, key, name):
        self.locks[key] = paths.take_lock(f"{key}.lock", self.fd)
        self.addCleanup(self.release, key)
        return Registry(self.fd, key, name)

    def release(self, key):
        lock = self.locks.pop(key, None)
        if lock is not None:
            os.close(lock)

    def end(self, key):
        self.release(key)

    def test_an_older_target_list_never_deletes_a_tab_registered_after_it(self):
        taken_by_one = time.time()
        time.sleep(0.01)
        self.assertEqual(self.two.numbers("I", ["NEW"]), {"NEW": "t1"})
        self.two.note_opened("I", "NEW")
        self.one.numbers("I", ["OLD"], present=["OLD"], taken_at=taken_by_one)
        self.assertEqual(self.two.numbers("I", ["NEW"]), {"NEW": "t1"})
        self.assertEqual(self.one.others("I")[0], {"NEW": "two"})
        self.one.numbers("I", ["OLD"], present=["OLD"], taken_at=time.time() + 1)
        self.assertEqual(self.two.numbers("I", ["NEW"]), {"NEW": "t3"})

    def test_close_reservation_and_adoption_exclude_each_other(self):
        self.one.note_opened("I", "A")
        self.assertTrue(self.one.reserve_close("I", "A"))
        self.assertFalse(self.one.reserve_close("I", "A"))
        with self.assertRaises(BrowseError) as caught:
            self.two.note_using("I", "A")
        self.assertEqual(caught.exception.code, "tab_closing")
        self.assertIn("A", self.two.hidden("I"))
        self.one.finish_close("I", "A")
        self.two.note_using("I", "A")
        self.assertFalse(self.one.reserve_close("I", "A"))
        self.end("kb")
        self.assertTrue(self.one.reserve_close("I", "A"))

    def test_temporary_tabs_outlive_their_daemon_and_nobody_else_adopts_them(self):
        self.one.note_temporary("I", "R")
        self.assertEqual(self.one.temporaries("I"), ["R"])
        self.assertEqual(self.two.temporaries("I"), [])
        self.assertEqual(self.two.others("I")[0], {})
        self.assertIn("R", self.two.hidden("I"))
        with self.assertRaises(BrowseError):
            self.two.note_using("I", "R")
        self.one.forget()
        self.end("ka")
        again = self.session("ka", "one")
        self.assertEqual(again.temporaries("I"), ["R"])
        again.drop_temporary("I", "R")
        self.assertEqual(again.temporaries("I"), [])

    def test_a_crowded_registry_stays_small_enough_to_read(self):
        targets = [f"{index:032X}" for index in range(tabs.MAX_IDS + 400)]
        for start in range(0, len(targets), 200):
            self.one.numbers("I", targets[start:start + 200])
        for index in range(30):
            ghost = Registry(self.fd, f"gone{index}", "ghost")
            ghost.note_using("I", targets[0])
            ghost.note_opened("I", targets[index])
        self.one.note_opened("I", "X")
        raw = paths.read_private_json(Registry.file_for("I"), self.fd, None, tabs.MAX_FILE)
        self.assertLessEqual(len(raw["ids"]), tabs.MAX_IDS)
        self.assertEqual(list(raw["using"]), [])
        self.assertEqual(list(raw["opened"]), ["X"])
        self.assertEqual(self.one.numbers("I", [targets[-1]]), {targets[-1]: f"t{len(targets)}"})

    def test_a_file_beyond_the_temporary_cap_starts_over_instead_of_growing(self):
        name = Registry.file_for("I")
        self.one.numbers("I", ["SEED"])
        raw = paths.read_private_json(name, self.fd, None, tabs.MAX_FILE)
        raw["opened"] = {f"{index:032X}": {"key": f"{index % 14:064x}", "session": "reader-session", "temporary": True, "at": index} for index in range(8000)}
        raw["ids"] = {f"{index:032X}": [index + 1, index + 0.5] for index in range(8000)}
        paths.write_private_json(name, self.fd, raw)
        self.assertGreater(os.stat(name, dir_fd=self.fd).st_size, tabs.FILE_BUDGET)
        self.one.note_temporary("I", "MINE")
        self.two.note_opened("I", "THEIRS")
        raw = paths.read_private_json(Registry.file_for("I"), self.fd, None, tabs.MAX_FILE)
        self.assertLessEqual(len(json.dumps(raw)), tabs.FILE_BUDGET)
        self.assertEqual(self.one.temporaries("I"), ["MINE"])
        self.assertEqual(self.one.others("I")[0], {"THEIRS": "two"})
        self.assertEqual(sorted(raw["opened"]), ["MINE", "THEIRS"])


if __name__ == "__main__":
    unittest.main()
