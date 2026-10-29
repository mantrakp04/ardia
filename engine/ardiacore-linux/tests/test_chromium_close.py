from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PATCH = REPO / 'engine/patches/chromium-linux-document-close.patch'
FIXTURES = ROOT / 'tests/fixtures'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def apply_patch(root, patch):
    check = subprocess.run(['git', 'apply', '--check', '--whitespace=nowarn', '-'],
                           input=patch, cwd=root, text=True, capture_output=True, timeout=20)
    if check.returncode:
        raise AssertionError(check.stdout + check.stderr)
    result = subprocess.run(['patch', '-p1', '--fuzz=0', '--batch'], input=patch,
                            cwd=root, text=True, capture_output=True, timeout=20)
    if result.returncode or 'fuzz' in result.stdout:
        raise AssertionError(result.stdout + result.stderr)


def patched_sources(root):
    with tarfile.open(FIXTURES / 'chromium156-close.tar.xz') as archive:
        archive.extractall(root, filter='data')
    apply_patch(root, (FIXTURES / 'helium-0.20.1-close-confirmation.patch').read_text())
    hosted = (REPO / 'engine/patches/chromium-window-hosted.patch').read_text()
    apply_patch(root, hosted[hosted.index('--- a/chrome/browser/ui/unload_controller.cc'):])
    initial = (REPO / 'engine/patches/chromium-initial-document-access.patch').read_text()
    apply_patch(root, initial.split('diff --git a/content/browser/web_contents/web_contents_impl.cc')[0])
    apply_patch(root, PATCH.read_text())
    return (root / 'chrome/browser/ui/unload_controller.cc').read_text(), (root / 'chrome/browser/lifetime/browser_close_manager.cc').read_text()


def production_methods(unload, manager):
    unload_signatures = [
        'bool UnloadController::HandleBeforeClose()',
        'void UnloadController::OnWindowClosing()',
        'UnloadController::UnloadController(',
        'UnloadController::~UnloadController()',
        'bool UnloadController::BeforeUnloadFired(content::WebContents* contents,',
        'UnloadController::GetBrowserClosingStatus() const',
        'bool UnloadController::RunBeforeUnloadForShutdown(',
        'void UnloadController::ResetBeforeUnloadForShutdown()',
        'UnloadController::GetTabsNeedingBeforeUnloadFired() const',
        'void UnloadController::SetLinuxQuitCancel(',
        'void UnloadController::ScheduleLinuxCloseRescan(',
        'void UnloadController::DidFinishNavigation(',
        'void UnloadController::WebContentsDestroyed(',
        'bool UnloadController::IsLinuxClosePreflightReady()',
        'bool UnloadController::DeferLinuxClose(',
        'void UnloadController::CancelWindowClose()',
        'void UnloadController::TransitionTo(',
        'void UnloadController::TabDetachedImpl(',
        'void UnloadController::RenderProcessGone(',
        'void UnloadController::ProcessPendingTabs(',
        'bool UnloadController::HasCompletedUnloadProcessing() const',
        'bool UnloadController::RemoveFromSet(',
        'void UnloadController::ClearUnloadState(',
        'void UnloadController::FinishWarnBeforeClosing(',
        'void UnloadController::OnWindowCloseComplete()',
    ]
    methods = []
    for signature in unload_signatures:
        extracted = method(unload, signature)
        if signature.startswith('UnloadController::GetBrowserClosingStatus'):
            extracted = 'BrowserWindowInterface::ClosingStatus\n' + extracted
        if signature.startswith('UnloadController::GetTabsNeedingBeforeUnloadFired'):
            extracted = 'UnloadController::UnloadListenerSet\n' + extracted
        methods.append(extracted)
    for name in ['StartClosingBrowsers', 'CancelBrowserClose', 'TryToCloseBrowsers', 'OnLinuxTeardownReady', 'OnLinuxCloseReady', 'OnBrowserReportCloseable', 'CheckForDownloadsInProgress', 'OnReportDownloadsCancellable', 'CloseBrowsers']:
        methods.append(method(manager, 'void BrowserCloseManager::' + name + '('))
    methods.append(method(manager, 'base::RepeatingClosure BrowserCloseManager::MakeLinuxQuitCancel('))
    methods.append('BrowserCloseManager::BrowserCloseManager() = default;\nBrowserCloseManager::~BrowserCloseManager() = default;')
    return '\n'.join(methods)


class ChromiumCloseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-chromium156-close-')
        cls.root = Path(cls.scratch.name)
        cls.unload, cls.manager = patched_sources(cls.root)
        for name in ['functional/callback.h', 'functional/bind.h', 'unguessable_token.h', 'check.h', 'location.h', 'no_destructor.h', 'task/single_thread_task_runner.h']:
            target = cls.root / 'base' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('#include "close_base.h"\n')
        for name in ['close_base.h', 'close_content_types.h', 'close_content_support.h']:
            shutil.copyfile(FIXTURES / name, cls.root / name)
        content = (cls.root / 'content/browser/renderer_host/render_frame_host_impl.cc').read_text()
        content_manager = (cls.root / 'content/browser/renderer_host/render_frame_host_manager.cc').read_text()
        content_methods = '\n'.join(method(content, 'void RenderFrameHostImpl::' + name + '(') for name in [
            'SuddenTerminationDisablerChanged',
            'StartLinuxBeforeUnloadDispatch', 'CompleteLinuxBeforeUnloadDispatch',
            'ProcessLinuxBeforeUnloadCompleted', 'DispatchBeforeUnload',
            'ProcessBeforeUnloadCompleted', 'ProcessBeforeUnloadCompletedFromFrame',
            'SimulateBeforeUnloadCompleted', 'SendBeforeUnload',
            'ContinueNavigationAfterBeforeUnloadCheck',
        ])
        content_methods += '\n' + method(content_manager, 'void RenderFrameHostManager::BeforeUnloadCompleted(')
        main = '#include "ardia/linux/ac_linux_close_hooks.h"\n' + production_methods(cls.unload, cls.manager) + '\nnamespace content {\n' + content_methods + '\n}\n' + (FIXTURES / 'close_scenarios.cc').read_text().replace('int main(int argc, char** argv)', (FIXTURES / 'close_review_scenarios.cc').read_text() + (FIXTURES / 'close_fresh_scenarios.cc').read_text() + (FIXTURES / 'close_forced_retry_scenarios.cc').read_text() + (FIXTURES / 'close_stage_scenarios.cc').read_text() + '\nint main(int argc, char** argv)')
        (cls.root / 'main.cc').write_text(main)
        cls.binary = cls.root / 'close'
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise AssertionError('C++ compiler required')
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(cls.root), '-I', str(ROOT / 'src'), str(ROOT / 'src/ardia/linux/ac_linux_close_hooks.cc'), str(cls.root / 'main.cc'), '-o', str(cls.binary)], text=True, capture_output=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_scenario(self, name):
        result = subprocess.run([str(self.binary), name], text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, name + "\n" + result.stdout + result.stderr)

    def test_hook_contract(self):
        self.run_scenario('hooks')

    def test_ordinary_close(self):
        self.run_scenario('ordinary')

    def test_native_timeout_discards_late_beforeunload(self):
        self.run_scenario('timeout')

    def test_multiwindow_quit(self):
        self.run_scenario('quit')

    def test_destroyed_requester_and_manager_lifetime(self):
        self.run_scenario('destroyed')

    def test_ordered_force_shutdown(self):
        self.run_scenario('force')

    def test_download_cancellation(self):
        self.run_scenario('downloads')

    def test_quit_skips_chromiums_download_prompt_once_ardia_asked(self):
        self.run_scenario('ardia-asked-downloads')

    def test_empty_rescan_and_destroy(self):
        self.run_scenario('boundaries')

    def test_chrome_beforeunload_cancellation(self):
        self.run_scenario('chrome-cancel')

    def test_new_window_after_download_confirmation(self):
        self.run_scenario('new-window-downloads')

    def test_renderer_and_tab_retirement_allows_fresh_dispatch(self):
        self.run_scenario('retired-dispatch')

    def test_address_reuse_and_stale_native_continuation(self):
        self.run_scenario('aba')

    def test_posted_destruction_rechecks_authority(self):
        self.run_scenario('posted-destruction')

    def test_reentrant_cancellation(self):
        self.run_scenario('reentrant')

    def test_document_replacement_does_not_deadlock_retry(self):
        self.run_scenario('document-replacement')

    def test_repeated_and_overlapping_quit_managers(self):
        self.run_scenario('repeated-managers')

    def test_destroyed_beforeunload_requester_aborts_quit(self):
        self.run_scenario('destroyed-beforeunload')

    def test_quit_cancellation_preserves_already_started_teardown(self):
        self.run_scenario('partial-teardown')

    def test_reentrant_waiter_when_native_gate_is_synchronous(self):
        self.run_scenario('synchronous-reentry')

    def test_review_retirement_ack(self):
        self.run_scenario('retirement-ack')

    def test_review_detach_ack(self):
        self.run_scenario('detach-ack')

    def test_review_outermost_cancel(self):
        self.run_scenario('outermost-cancel')

    def test_review_delete_requester(self):
        self.run_scenario('delete-requester')

    def test_review_empty_cancel(self):
        self.run_scenario('empty-cancel')

    def test_review_empty_complete(self):
        self.run_scenario('empty-complete')

    def test_review_begun_preflight(self):
        self.run_scenario('begun-preflight')

    def test_review_veto_before_begin(self):
        self.run_scenario('veto-before-begin')

    def test_review_simulated_identity(self):
        self.run_scenario('simulated-identity')

    def test_old_and_new_rpc_ack_ordering(self):
        for old_first in [False, True]:
            for proceed in [False, True]:
                for standalone in [False, True]:
                    self.run_scenario(f'ack-order-{int(old_first)}{int(proceed)}{int(standalone)}')

    def test_document_event_wakes_already_waiting_retry(self):
        for old_first in [False, True]:
            for renderer_loss in [False, True]:
                self.run_scenario(f'waiting-event-{int(old_first)}{int(renderer_loss)}')

    def test_fast_completion_has_immutable_identity(self):
        self.run_scenario('fast-identity')

    def test_legacy_completion_has_immutable_identity(self):
        self.run_scenario('legacy-identity')

    def test_queued_frame_completion_has_immutable_identity(self):
        self.run_scenario('queued-identity')

    def test_destruction_wakes_waiting_retry_without_dangling_request(self):
        self.run_scenario('destroyed-document')

    def test_missing_frame_waits_for_actual_closealltabs_boundary(self):
        self.run_scenario('missing-frame')

    def test_coalesced_request_keeps_original_rpc_identity(self):
        self.run_scenario('coalesced-identity')

    def test_standalone_subframe_overlap(self):
        for old_first in [False, True]:
            for old_veto, bound in [(True, False), (True, True), (False, True)]:
                for new_veto in [False, True]:
                    for callbacks in range(3):
                        for old_reply in [False, True]:
                            self.run_scenario(f'fresh-overlap-{int(old_first)}{int(old_veto)}{int(new_veto)}{int(bound)}{callbacks}{int(old_reply)}')

    def test_final_preflight_before_native_commit(self):
        for change in range(4):
            for synchronous in [False, True]:
                for veto in [False, True]:
                    self.run_scenario(f'fresh-admission-{change}{int(synchronous)}{int(veto)}')

    def test_inline_coalesced_and_reentrant_native_admission(self):
        for mode in ["fresh-inline", "fresh-coalesced", "fresh-native-reentry"]:
            self.run_scenario(mode)

    def test_force_shutdown_resumes_first_destruction_without_rescanning_other_windows(self):
        self.run_scenario('fresh-force')

    def test_begin_has_no_posted_continuation_gap(self):
        self.run_scenario('fresh-no-gap')

    def test_begun_controller_rejects_second_manager_mutations(self):
        for empty in [False, True]:
            for download in [False, True]:
                self.run_scenario(f'fresh-second-{int(empty)}{int(download)}')

    def test_admission_rechecks_reentrant_cancellation_registration_and_sequence(self):
        for mode in range(3):
            self.run_scenario(f'fresh-reentrant-{mode}')

    def test_first_hosted_begin_and_destroy_require_preflight_certificate(self):
        for stage in ['begin', 'destroy']:
            with self.subTest(stage=stage):
                self.run_scenario(f'missing-{stage}-certificate')

    def test_retired_attempt_history_is_bounded_without_replay(self):
        self.run_scenario('retired-attempt-bound')

    def test_forced_retry_rechecks_preflight_and_preserves_current_managers(self):
        for mode in range(4):
            for veto in [False, True] if mode in [1, 3] else [False]:
                for new_window in [False, True]:
                    self.run_scenario(f'force-retry-order-{mode}{int(veto)}{int(new_window)}')

    def test_forced_callbacks_reject_empty_and_stale_attempts(self):
        for mode in range(4):
            self.run_scenario(f'force-retry-lease-{mode}')

    def test_forced_destroy_keeps_only_its_original_begun_lease(self):
        for mode in range(3):
            self.run_scenario(f'force-retry-destroy-{mode}')

    def test_forced_first_destroy_retry_returns_to_vetoable_preflight(self):
        for veto in [False, True]:
            self.run_scenario(f'force-retry-dirty-{int(veto)}')

    def test_forced_begin_cancellation_discards_continuations(self):
        self.run_scenario('force-retry-cancel')

    def test_null_hook_and_unhosted_forced_shutdown_controls(self):
        for mode in [False, True]:
            self.run_scenario(f'force-retry-plain-{int(mode)}')

    def test_cancelled_stage_reply_cannot_resolve_a_new_attempt(self):
        for destroy in [False, True]:
            self.run_scenario(f'stage-cancelled-{int(destroy)}')

    def test_overlapping_begin_destroy_waits_for_actual_beforeunload_reply(self):
        for begin_first in [False, True]:
            for reply_begin_first in [False, True]:
                for veto in [False, True]:
                    self.run_scenario(f'stage-overlap-{int(begin_first)}{int(reply_begin_first)}{int(veto)}')

    def test_admission_uses_only_the_requesting_stage_certificate_and_retry(self):
        for begin in [False, True]:
            for ready in [False, True]:
                self.run_scenario(f'stage-certificate-{int(begin)}{int(ready)}')

    def test_admission_rejects_prepare_absent_stage_and_cancelled_attempt(self):
        for begun in [False, True]:
            self.run_scenario(f'stage-missing-{int(begun)}')

    def test_stage_pending_replacement_during_validator_or_commit_is_rejected(self):
        for during_commit in [False, True]:
            for destroy in [False, True]:
                self.run_scenario(f'stage-replacement-{int(during_commit)}{int(destroy)}')


class ChromiumCloseSourceTests(unittest.TestCase):
    def test_fixture_is_exact_pinned_156_source(self):
        metadata = json.loads((FIXTURES / 'chromium156-close.json').read_text())
        self.assertEqual(metadata['chromium'], '156.0.8078.47')
        with tarfile.open(FIXTURES / 'chromium156-close.tar.xz') as archive:
            self.assertEqual(set(archive.getnames()), set(metadata['sha256']))
            for path, digest in metadata['sha256'].items():
                self.assertEqual(hashlib.sha256(archive.extractfile(path).read()).hexdigest(), digest, path)
            frame = archive.extractfile('content/public/browser/render_frame_host.h').read().decode()
            self.assertIn('virtual WeakDocumentPtr GetWeakDocumentPtr() = 0;', frame)
            document = archive.extractfile('content/public/browser/weak_document_ptr.h').read().decode()
            self.assertIn('RenderFrameHost* AsRenderFrameHostIfValid() const', document)
            browser = archive.extractfile('chrome/browser/ui/browser_window/public/browser_window_interface.h').read().decode()
            self.assertIn('virtual base::WeakPtr<BrowserWindowInterface> GetWeakPtr() = 0;', browser)
            tab_contents = archive.extractfile('chrome/browser/tab_contents/BUILD.gn').read().decode()
            self.assertIn('"//content/public/browser"', method(tab_contents, 'source_set("tab_contents")'))
        helium = metadata['helium']
        self.assertEqual(helium['commit'], 'f29a25968e483f8bb85e47829ccd487bbe229199')
        self.assertEqual(hashlib.sha256((FIXTURES / helium['fixture']).read_bytes()).hexdigest(), helium['sha256'])

    def test_linux_selection_preserves_exact_mac_manifest(self):
        sys.path.insert(0, str(REPO / 'engine/patches/build'))
        spec = importlib.util.spec_from_file_location('close_series', REPO / 'engine/patches/series.py')
        series = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(series)
        mac = series.read_series('mac')
        linux = series.read_series('linux')
        names = '\n'.join(step.kind + ' ' + step.name for step in mac)
        self.assertEqual(hashlib.sha256(names.encode()).hexdigest(), '186fbf2689f80b0e70901d0e59d2b1cdc203e03bca7cab2127d7fc48e0f7eff3')
        self.assertNotIn(PATCH.name, [step.name for step in mac])
        step = next(step for step in linux if step.name == PATCH.name)
        self.assertEqual(series.phase_of(step), 'chromium')
        self.assertEqual(set(step.paths()), {
            ('chrome/browser/lifetime/BUILD.gn', False),
            ('chrome/browser/lifetime/browser_close_manager.cc', False),
            ('chrome/browser/lifetime/browser_close_manager.h', False),
            ('chrome/browser/ui/BUILD.gn', False),
            ('chrome/browser/ui/unload_controller.cc', False),
            ('chrome/browser/ui/unload_controller.h', False),
            ('content/browser/BUILD.gn', False),
            ('content/browser/renderer_host/render_frame_host_impl.cc', False),
            ('content/browser/renderer_host/render_frame_host_impl.h', False),
            ('content/browser/renderer_host/render_frame_host_manager.cc', False),
            ('content/browser/renderer_host/render_frame_host_manager.h', False),
        })
        self.assertIn(('ardia/linux', True), series.layer_paths(str(ROOT)))

    def test_minimal_target_and_linux_gated_dependencies(self):
        build = (ROOT / 'src/ardia/linux/BUILD.gn').read_text()
        hooks = method(build, 'source_set("close_hooks")')
        self.assertEqual(re.findall(r'"(//[^"]+)"', hooks), ['//base'])
        self.assertIn('"ac_linux_close_hooks.cc"', hooks)
        self.assertIn('"ac_linux_close_hooks.h"', hooks)
        self.assertIn('":close_hooks"', method(build, 'source_set("linux")'))
        header = (ROOT / 'src/ardia/linux/ac_linux_close_hooks.h').read_text()
        self.assertEqual(re.findall(r'#include "([^"]+)"', header), ['base/functional/callback.h', 'base/unguessable_token.h'])
        self.assertIn('class BrowserWindowInterface;', header)
        with tempfile.TemporaryDirectory(prefix='ardia-close-gn-') as scratch:
            root = Path(scratch)
            patched_sources(root)
            thaw = (REPO / 'engine/patches/chromium-thaw-live-connections.patch').read_text()
            content_build = 'diff --git a/content/browser/BUILD.gn' + thaw.split('diff --git a/content/browser/BUILD.gn', 1)[1].split('diff --git a/content/public/browser/BUILD.gn', 1)[0]
            apply_patch(root, content_build)
            for path, target in [('chrome/browser/lifetime/BUILD.gn', 'impl'), ('chrome/browser/ui/BUILD.gn', 'unload_controller_impl'), ('content/browser/BUILD.gn', 'browser')]:
                target_text = method((root / path).read_text(), 'source_set("' + target + '")')
                self.assertRegex(target_text, r'if \(is_linux\) \{\s+deps \+= \[ "//ardia/linux:close_hooks" \]\s+\}')

    def test_materialization_copies_hooks_and_detects_drift(self):
        with tempfile.TemporaryDirectory(prefix='ardia-close-layer-') as scratch:
            root = Path(scratch)
            env = dict(os.environ, CHROMIUM_SRC=str(root))
            def apply(*args):
                return subprocess.run([str(ROOT / 'apply.sh'), *args], env=env, text=True, capture_output=True, timeout=20)
            result = apply()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(apply('--check').returncode, 0)
            for name in ['ac_linux_close_hooks.h', 'ac_linux_close_hooks.cc', 'BUILD.gn']:
                source = ROOT / 'src/ardia/linux' / name
                copied = root / 'ardia/linux' / name
                self.assertEqual(source.read_bytes(), copied.read_bytes())
                copied.write_text('drift\n')
                self.assertNotEqual(apply('--check').returncode, 0)
                self.assertEqual(apply().returncode, 0)
                self.assertEqual(source.read_bytes(), copied.read_bytes())


if __name__ == '__main__':
    unittest.main()
