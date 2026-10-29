import os
import pathlib
import subprocess
import tempfile
import unittest

from chromium_series import applied

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
PATCH = ROOT.parents[0] / 'patches/chromium-linux-web-store-uninstall.patch'
DELEGATE = 'chrome/browser/extensions/api/management/chrome_management_api_delegate.cc'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class WebStoreQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='ardia-web-store-')
        cls.binary = pathlib.Path(cls.directory.name) / 'web-store'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
                        '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(ROOT / 'src'),
                        str(LINUX / 'ac_linux_web_store_queue.cc'), str(ROOT / 'tests/web_store_test.cc'),
                        '-o', str(cls.binary)], check=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def run_case(self, name):
        subprocess.run([str(self.binary), name], check=True, text=True, timeout=10,
                       env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})

    def test_only_extension_ids_are_queued(self):
        self.run_case('ids')

    def test_requests_are_claimed_in_order_and_finish_on_uninstall_expiry_or_page_change(self):
        self.run_case('queue')


class WebStoreLifecycleTests(unittest.TestCase):
    def test_real_web_store_waits_requests_expiry_and_page_changes(self):
        import re
        source = LINUX / 'ac_linux_web_store.cc'
        with tempfile.TemporaryDirectory(prefix='ardia-web-store-life-') as directory:
            stubs = pathlib.Path(directory) / 'stubs'
            for header in [source, LINUX / 'ac_linux_web_store.h']:
                for include in re.findall(r'#include "([^"]+)"', header.read_text()):
                    if include.startswith('ardia/'):
                        continue
                    path = stubs / include
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('#include "web_store_support.h"\n')
            binary = pathlib.Path(directory) / 'web-store-life'
            subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++23', '-Wall', '-Wextra', '-Werror', '-g',
                            '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(stubs),
                            '-I', str(ROOT / 'tests/fixtures'), '-I', str(ROOT / 'src'), str(source),
                            str(LINUX / 'ac_linux_web_store_queue.cc'), str(ROOT / 'tests/fixtures/web_store_scenarios.cc'),
                            '-o', str(binary)], check=True, text=True, timeout=180)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30,
                                    env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('web store scenarios passed', result.stdout)


class WebStoreWiringTests(unittest.TestCase):
    store = (LINUX / 'ac_linux_web_store.cc').read_text()
    host = (LINUX / 'ac_linux_host.cc').read_text()

    def test_only_web_store_pages_in_ardia_tabs_are_taken_over(self):
        hook = body(self.store, 'std::unique_ptr<extensions::UninstallDialogDelegate> TakeStoreUninstall(')
        self.assertIn('function->extension()', hook)
        self.assertIn('extension_urls::IsWebstoreDomain(function->source_url())', hook)
        self.assertIn('function->GetSenderWebContents()', hook)
        self.assertIn('HoldsTab().Run(contents)', hook)
        self.assertIn('return nullptr;', hook)
        self.assertIn('g_ardia_linux_store_uninstall = &TakeStoreUninstall;', self.store)

    def test_the_store_page_hears_back_only_when_ardia_removed_the_extension(self):
        close = body(self.store, '  void Close(bool removed) {')
        self.assertIn('OnExtensionUninstallDialogClosed(removed', close)
        self.assertIn('std::exchange(function_, nullptr)', close)
        self.assertIn('queue_.Uninstalled(extension->id())', body(self.store, '  void OnExtensionUninstalled('))

    def test_the_relabel_runs_in_ardias_world_on_store_pages_only(self):
        request = body(self.store, 'void LinuxWebStoreRequest(content::WebContents* contents, Done done) {')
        self.assertIn('IsWebstoreDomain(frame->GetLastCommittedURL())', request)
        self.assertIn('ISOLATED_WORLD_ID_ARDIA_PAGE', request)
        self.assertIn('"Add to Ardia"', self.store)
        self.assertIn('"Remove from Ardia"', self.store)
        self.assertNotIn('chrome.management', self.store)

    def test_the_host_answers_the_shared_bridge_and_installs_the_hook(self):
        command = body(self.host, 'void ShellHostView::TabCommand(')
        self.assertIn('command == "webStoreRequest"', command)
        self.assertIn('ardiacore::LinuxWebStoreRequest(contents, std::move(done))', command)
        self.assertIn('ardiacore::InstallLinuxWebStore(', self.host)
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['ac_linux_web_store.cc', 'ac_linux_web_store.h', 'ac_linux_web_store_queue.cc', 'ac_linux_web_store_queue.h']:
            self.assertIn(f'"{name}"', build)

    def test_extension_views_refuse_page_script(self):
        views = (LINUX / 'ac_linux_extension_views.cc').read_text()
        command = body(views, 'void LinuxExtensionSurfaces::Command(')
        self.assertIn('ERR_PAGE_EVALUATION_REFUSED', command)
        self.assertNotIn('*command == "evaluate" || *command == "captureViewport") return std::move(done).Run(true, base::Value());', command)

    def test_chromium_hook_patch_is_registered_for_linux_and_applies(self):
        series = (ROOT.parents[0] / 'patches/series').read_text()
        self.assertIn('chromium chromium-linux-web-store-uninstall.patch linux', series)
        text = PATCH.read_text()
        added = '\n'.join(line for line in text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertIn('g_ardia_linux_store_uninstall', added)
        self.assertIn('#if BUILDFLAG(IS_LINUX)', added)
        self.assertNotRegex(added, r'(?m)^\+\s*(//|/\*)')
        with applied(PATCH.name, DELEGATE) as directory:
            delegate = body((directory / DELEGATE).read_text(), 'ChromeManagementAPIDelegate::UninstallFunctionDelegate(')
            self.assertLess(delegate.index('g_ardia_linux_store_uninstall(function, target_extension)'),
                            delegate.index('std::make_unique<ManagementUninstallFunctionUninstallDialogDelegate>'))


if __name__ == '__main__':
    unittest.main()
