import pathlib
import subprocess
import tempfile
import unittest

from chromium_series import applied

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
PATCH = ROOT.parents[0] / 'patches/chromium-linux-autoplay-policy.patch'


def body(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class AutoplayFollowerTests(unittest.TestCase):
    def test_existing_tabs_follow_an_autoplay_setting_change(self):
        import os
        import re
        source = LINUX / 'ac_linux_autoplay.cc'
        with tempfile.TemporaryDirectory(prefix='ardia-autoplay-follow-') as directory:
            stubs = pathlib.Path(directory) / 'stubs'
            for header in [source, LINUX / 'ac_linux_autoplay.h']:
                for include in re.findall(r'#include "([^"]+)"', header.read_text()):
                    if include.startswith('ardia/'):
                        continue
                    path = stubs / include
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('#include "autoplay_support.h"\n')
            binary = pathlib.Path(directory) / 'autoplay-follow'
            subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++23', '-Wall', '-Wextra', '-Werror', '-g',
                            '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(stubs),
                            '-I', str(ROOT / 'tests/fixtures'), '-I', str(ROOT / 'src'), str(source),
                            str(ROOT / 'tests/fixtures/autoplay_scenarios.cc'), '-o', str(binary)],
                           check=True, text=True, timeout=180)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('autoplay scenarios passed', result.stdout)


class AutoplayPolicyTests(unittest.TestCase):
    def test_pages_learn_the_sites_autoplay_block_at_document_start(self):
        channel = (LINUX / 'ac_linux_page_channel.cc').read_text()
        greet = body(channel, 'void LinuxPageChannel::Greet(content::RenderFrameHost& frame) {')
        self.assertIn('LinuxAutoplayBlocked(frame.GetOutermostMainFrame()->GetLastCommittedURL(), frame.GetBrowserContext())', greet)
        self.assertIn('Options().PageConfig(frame.IsInPrimaryMainFrame(), block_autoplay)', greet)
        attach = body(channel, 'void LinuxPageChannel::Attach(LinuxPageChannelHooks hooks) {')
        self.assertIn('FollowLinuxAutoplay(&GetWebContents(), base::BindRepeating(&LinuxPageChannel::RefreshPageConfig', attach)

    def test_the_block_reads_the_pages_own_profile_autoplay_setting(self):
        autoplay = (LINUX / 'ac_linux_autoplay.cc').read_text()
        install = body(autoplay, 'void InstallLinuxAutoplayPolicy() {')
        self.assertIn('g_ardia_linux_autoplay_blocked = ', install)
        self.assertIn('extern bool (*g_ardia_linux_autoplay_blocked)(content::WebContents* contents);', autoplay)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn('InstallLinuxAutoplayPolicy();', host)
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['ac_linux_autoplay.cc', 'ac_linux_autoplay.h']:
            self.assertIn(f'"{name}"', build)

    def test_chromium_hook_skips_engagement_bypasses_for_blocked_sites(self):
        series = (ROOT.parents[0] / 'patches/series').read_text()
        self.assertIn('chromium chromium-linux-autoplay-policy.patch linux', series)
        self.assertLess(series.index('chromium-linux-navigation-hold-hook.patch'), series.index('chromium-linux-autoplay-policy.patch'))
        text = PATCH.read_text()
        added = '\n'.join(line for line in text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertIn('bool (*g_ardia_linux_autoplay_blocked)(content::WebContents* contents) = nullptr;', added)
        self.assertIn('return blink::mojom::AutoplayPolicy::kDocumentUserActivationRequired;', added)
        self.assertNotRegex(added, r'(?m)^\+\s*(//|/\*)')
        with applied(PATCH.name, 'chrome/browser/chrome_content_browser_client.cc') as directory:
            patched = (directory / 'chrome/browser/chrome_content_browser_client.cc').read_text()
            policy = body(patched, 'blink::mojom::AutoplayPolicy GetAutoplayPolicyForWebContents(')
            self.assertLess(policy.index('g_ardia_linux_autoplay_blocked(web_contents)'), policy.index('DetermineWebContentsAutoplayPolicy('))
            self.assertLess(patched.index('bool (*g_ardia_linux_autoplay_blocked)'), patched.index('namespace {\n\nconst char kAIManagerUserDataKey'))


if __name__ == '__main__':
    unittest.main()
