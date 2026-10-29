import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method as extract

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia' / 'linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()

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


class FullScreenRestoreHostTests(unittest.TestCase):
    def test_restore_is_routed_and_limited_to_the_launch_renderer(self):
        branch = extract(HOST, '  if (method == "ArdiaShell.restoreFullScreen")')
        self.assertIn('startup_', branch)
        self.assertIn('is_utility()', branch)
        self.assertIn('FullScreenRestorer().Begin(', branch)
        self.assertIn('RestoreFullScreenNow()', branch)

    def test_windows_enter_browser_fullscreen_when_they_become_available(self):
        enter = extract(HOST, 'void ShellHostView::RestoreFullScreenNow()')
        self.assertIn('FullScreenRestorer().Enter(window_id_', enter)
        self.assertIn('ToggleBrowserFullscreenMode(false)', enter)
        self.assertIn('IsMinimized()', enter)
        self.assertIn('RestoreFullScreenNow();', extract(HOST, 'void ShellHostView::RendererReady()'))
        self.assertIn('RestoreFullScreenNow();', extract(HOST, 'void ShellHostView::Initialize()'))

    def test_entered_fullscreen_settles_the_restore_and_refocuses(self):
        changed = extract(HOST, 'void ShellHostView::OnWidgetShowStateChanged(')
        self.assertIn('FullScreenRestorer().Entered(window_id_)', changed)
        self.assertIn('FinishFullScreenRestore();', changed)
        finish = extract(HOST, 'void FinishFullScreenRestore()')
        self.assertIn('FullScreenRestorer().Finish()', finish)
        self.assertIn('WindowFocus().HandBack(', finish)

    def test_expired_windows_report_windowed_so_the_store_forgets_the_stamp(self):
        expire = extract(HOST, 'void ExpireFullScreenRestore()')
        self.assertIn('FullScreenRestorer().Expire()', expire)
        self.assertIn('Set("type", "fullScreen")', expire)
        self.assertIn('Set("on", false)', expire)
        self.assertIn('FullScreenRestorer().Forget(', extract(HOST, 'void OnBrowserClosed('))

    def test_helper_is_built_and_comment_free(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ('"ac_linux_fullscreen_restore.cc"', '"ac_linux_fullscreen_restore.h"'):
            self.assertIn(name, build)
        for path in (LINUX / 'ac_linux_fullscreen_restore.h', LINUX / 'ac_linux_fullscreen_restore.cc'):
            self.assertIsNone(re.search(r'//|/\*', path.read_text()), path)


if __name__ == '__main__':
    unittest.main()
