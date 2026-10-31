import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'
LINUX = SOURCE / 'ardia' / 'linux'

LEDGER = r'''#include <cassert>
#include <optional>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_fullscreen_restore.h"

using ardia::linux_window::FullScreenRestore;

static void OnlyTheFirstLaunchRequestIsAccepted() {
  FullScreenRestore restore;
  assert(!restore.active());
  assert(restore.Begin({"main", "w2"}, "main"));
  assert(restore.active());
  assert(!restore.Begin({"w3"}, "w3"));
  assert(!restore.Wants("w3"));
  FullScreenRestore empty;
  assert(!empty.Begin({}, ""));
  assert(!empty.active());
  assert(!empty.Begin({"main"}, ""));
}

static void MalformedIdsAreDroppedAndDuplicatesCollapse() {
  FullScreenRestore restore;
  assert(restore.Begin({"", "main", "main", std::string(200, 'x'), "a/b", "w2"}, ""));
  assert(restore.Wants("main"));
  assert(restore.Wants("w2"));
  assert(!restore.Wants(""));
  assert(!restore.Wants("a/b"));
  assert(restore.Enter("main", false));
  assert(!restore.Enter("main", false));
}

static void AvailableWindowsEnterAndFinishWithFocus() {
  FullScreenRestore restore;
  restore.Begin({"main", "w2"}, "w2");
  assert(restore.Enter("main", false));
  assert(!restore.Wants("main"));
  assert(!restore.Finish());
  restore.Entered("main");
  assert(!restore.Finish());
  assert(restore.Enter("w2", false));
  restore.Entered("w2");
  assert(restore.Finish() == std::optional<std::string>("w2"));
  assert(!restore.active());
  assert(!restore.Finish());
}

static void AlreadyFullscreenWindowsAreNotToggled() {
  FullScreenRestore restore;
  restore.Begin({"main"}, "main");
  assert(!restore.Enter("main", true));
  assert(!restore.Finish());
  assert(!restore.active());
}

static void WindowsThatNeverArriveAreGivenUp() {
  FullScreenRestore restore;
  restore.Begin({"main", "late", "stuck"}, "main");
  assert(restore.Enter("main", false));
  restore.Entered("main");
  assert(restore.Enter("stuck", false));
  const auto gone = restore.Expire();
  assert((gone == std::vector<std::string>{"late", "stuck"}));
  assert(!restore.Wants("late"));
  assert(!restore.Enter("late", false));
  assert(restore.Finish() == std::optional<std::string>("main"));
  assert(!restore.active());
}

static void AClosedWindowIsGivenUpAtOnce() {
  FullScreenRestore restore;
  restore.Begin({"main", "w2"}, "");
  assert(restore.Forget("w2"));
  assert(!restore.Forget("w2"));
  assert(restore.Enter("main", false));
  restore.Entered("main");
  assert(!restore.Finish());
  assert(!restore.active());
}

static void UnrequestedFullscreenIsIgnored() {
  FullScreenRestore restore;
  restore.Begin({"main"}, "");
  restore.Entered("other");
  assert(restore.Wants("main"));
}

int main() {
  OnlyTheFirstLaunchRequestIsAccepted();
  MalformedIdsAreDroppedAndDuplicatesCollapse();
  AvailableWindowsEnterAndFinishWithFocus();
  AlreadyFullscreenWindowsAreNotToggled();
  WindowsThatNeverArriveAreGivenUp();
  AClosedWindowIsGivenUpAtOnce();
  UnrequestedFullscreenIsIgnored();
}
'''


class FullScreenRestoreLedgerTests(unittest.TestCase):
    def test_ledger(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-fullscreen-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'ledger.cc').write_text(LEDGER)
            binary = root / 'ledger'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                    str(root / 'ledger.cc'), str(LINUX / 'ac_linux_fullscreen_restore.cc'), '-o', str(binary)],
                                   capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)


if __name__ == '__main__':
    unittest.main()
