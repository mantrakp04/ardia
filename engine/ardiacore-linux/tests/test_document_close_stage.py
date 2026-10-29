from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_close_fixture import fixture
from document_host_fixture import ROOT, SOURCES
from test_document_close_admission import MAIN as ADMISSION_MAIN


CASES = r'''
  if (mode.starts_with("stage-")) {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    content::WebContents late; b.tabs.tabs = {&late};
    const bool destroy_first = mode.find("destroy-first") != std::string::npos;
    const bool posted = mode.find("posted") != std::string::npos;
    const bool veto = mode.find("veto") != std::string::npos;
    const auto first = destroy_first ? LinuxCloseStage::kDestroy : LinuxCloseStage::kBeginTeardown;
    const auto second = destroy_first ? LinuxCloseStage::kBeginTeardown : LinuxCloseStage::kDestroy;
    auto resume = [&](LinuxCloseStage stage) {
      if (stage == LinuxCloseStage::kDestroy) b.controller->OnWindowCloseComplete();
      else b.controller->OnWindowClosing();
    };
    if (posted) { PrepareOnly(window); async_next_begin = true; }
    assert(b.controller->DeferLinuxClose(first, [&, first] { resume(first); }));
    const auto identity = h.close_.identity();
    if (!posted) {
      assert(h.close_preparations_.size() == 1 && !h.close_.CanClose());
      AckNow(h); files.Drain();
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, [&] {
        assert(h.close_.CanClose() && !h.close_.Irreversible());
        late.needs_unload = true; HandlerChanged(late.frame, true);
        assert(b.controller->DeferLinuxClose(second, [&, second] { resume(second); }));
      });
    } else {
      late.needs_unload = true; HandlerChanged(late.frame, true);
      assert(b.controller->DeferLinuxClose(second, [&, second] { resume(second); }));
    }
    Drain();
    assert(late.dispatches == 1 && !h.close_.Irreversible() && CanCancelLinuxClose(&b));
    assert(h.close_.identity() == identity && h.close_.BlocksWrites() && h.chrome_close_token_);
    const auto token = *h.chrome_close_token_;
    assert(CurrentLinuxCloseToken(&b) == token && late.close_pages == 0 && b.tabs.closed == 0 && !b.destroyed);
    late.Ack(!veto); Drain();
    if (veto) {
      assert(!h.close_.Irreversible() && !h.close_.BlocksWrites() && !b.destroyed);
      assert(late.close_pages == 0 && b.tabs.closed == 0 && !h.chrome_close_token_);
      assert(CurrentLinuxCloseToken(&b).is_empty());
    } else {
      assert(h.close_.Irreversible() && h.close_.BlocksWrites() && !CanCancelLinuxClose(&b));
      assert(h.close_.identity() == identity && *h.chrome_close_token_ == token && late.close_pages == 1);
      b.controller->ClearUnloadState(&late, true); b.controller->OnWindowClosing(); Drain();
      assert(b.destroyed && h.close_.identity() == identity && CurrentLinuxCloseToken(&b) == token);
    }
  }
  if (mode.starts_with("forced-host-")) {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    content::WebContents tab; tab.needs_unload = true; HandlerChanged(tab.frame, true);
    b.tabs.tabs = {&tab}; ignore_unload = true;
    const bool policy = mode.find("policy") != std::string::npos;
    const bool veto = mode.find("veto") != std::string::npos;
    const bool overlap = mode.find("overlap") != std::string::npos;
    auto owner = base::WrapRefCounted(new BrowserCloseManager());
    b.tabs.before_close_all = [&] {
      assert(h.close_.Irreversible() && !CanCancelLinuxClose(&b));
      assert(h.chrome_close_token_ && CurrentLinuxCloseToken(&b) == *h.chrome_close_token_);
    };
    async_next_begin = true;
    before_host_begin = [&] {
      assert(!h.close_.Irreversible() && CanCancelLinuxClose(&b));
      if (policy) ignore_unload = false;
      else owner->StartClosingBrowsers();
      if (overlap) assert(b.controller->DeferLinuxClose(LinuxCloseStage::kDestroy,
          [&] { b.controller->OnWindowCloseComplete(); }));
    };
    owner->StartClosingBrowsers(); AckNow(h); Drain();
    const auto identity = h.close_.identity();
    if (policy) {
      assert(!h.close_.Irreversible() && CanCancelLinuxClose(&b) && h.close_.BlocksWrites());
      assert(tab.dispatches == 1 && tab.close_pages == 0 && b.tabs.closed == 0 && !b.destroyed);
      assert(!b.controller->force_skip_warning_user_on_close());
      tab.Ack(!veto); Drain();
      if (veto) {
        assert(!h.close_.Irreversible() && !h.close_.BlocksWrites() && !b.destroyed);
        assert(tab.close_pages == 0 && b.tabs.closed == 0 && owner->linux_cancelled_);
      } else {
        assert(h.close_.Irreversible() && tab.close_pages == 1);
        b.controller->ClearUnloadState(&tab, true); b.controller->OnWindowClosing(); Drain();
        assert(b.destroyed && h.close_.BlocksWrites());
      }
    } else assert(h.close_.Irreversible() && b.destroyed && h.close_.BlocksWrites());
    assert(h.close_.identity() == identity);
  }
'''


class DocumentCloseStageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-native-stage-')
        root = Path(cls.scratch.name)
        main = ADMISSION_MAIN[:ADMISSION_MAIN.rfind('\n}')] + CASES + ADMISSION_MAIN[ADMISSION_MAIN.rfind('\n}'):]
        (root / 'main.cc').write_text(fixture(root) + main)
        cls.binary = root / 'stage'
        compiler = shutil.which('clang++') or shutil.which('c++')
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), str(ROOT / 'src/ardia/linux/ac_linux_close_hooks.cc'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, mode + '\n' + result.stdout + result.stderr)

    def test_stage_overlap_during_seal_both_orders_and_actual_handler_outcomes(self):
        for first in ['begin-first', 'destroy-first']:
            for outcome in ['allow', 'veto']:
                with self.subTest(first=first, outcome=outcome):
                    self.run_mode('stage-seal-' + first + '-' + outcome)

    def test_stage_overlap_during_posted_begin_both_orders_and_actual_handler_outcomes(self):
        for first in ['begin-first', 'destroy-first']:
            for outcome in ['allow', 'veto']:
                with self.subTest(first=first, outcome=outcome):
                    self.run_mode('stage-posted-' + first + '-' + outcome)

    def test_forced_same_manager_restart_requires_actual_native_begin(self):
        for suffix in ['', '-overlap']:
            with self.subTest(suffix=suffix):
                self.run_mode('forced-host-restart' + suffix)

    def test_forced_policy_withdrawal_retries_vetoable_preflight_before_native_begin(self):
        for suffix in ['', '-overlap']:
            for outcome in ['allow', 'veto']:
                with self.subTest(suffix=suffix, outcome=outcome):
                    self.run_mode('forced-host-policy' + suffix + '-' + outcome)
