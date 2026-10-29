import os
import pathlib
import re
import unittest

from test_downloads import compile_and_run
from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
PATCHES = ROOT.parent / 'patches'
HELPER = 'chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.cc'
TREE = pathlib.Path(os.environ.get('ARDIA_CHROMIUM_156_SRC', pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'))


def file_hunks(patch, path):
    sections = re.split(r'^(?=--- )', patch, flags=re.M)
    return [section for section in sections if section.startswith(f'--- a/{path}')]


class AutoPictureInPictureProfileTests(unittest.TestCase):
    def test_the_preference_reaches_every_regular_profile_and_later_loads(self):
        output = compile_and_run(self, 'auto-pip-preference', [ROOT / 'tests/fixtures/auto_pip_preference_scenarios.cc'])
        self.assertIn('auto pip preference scenarios passed', output)

    def test_the_host_sets_the_preference_for_all_profiles_not_only_the_app_profile(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        branch = method(host, '  if (method == "webView.setAutoPictureInPicture") {')
        self.assertIn('ardiacore::SetLinuxAutoPictureInPicture(enabled);', branch)
        self.assertNotIn('GetForProfile(profile())', branch)

    def test_the_service_applies_to_loaded_profiles_and_observes_new_ones(self):
        service = (LINUX / 'ac_linux_auto_pip_service.cc').read_text()
        self.assertIn('public ProfileManagerObserver', service)
        self.assertIn('manager->GetLoadedProfiles()', service)
        added = method(service, '  void OnProfileAdded(Profile* profile) override {')
        self.assertIn('preference_.Added(profile);', added)
        regular = method(service, '  static bool Regular(Profile* profile) {')
        self.assertIn('profile->IsRegularProfile() && !profile->ShutdownStarted()', regular)
        self.assertIn('ContentSettingsType::AUTO_PICTURE_IN_PICTURE', service)
        self.assertIn('OnProfileManagerDestroying', service)
        gn = (LINUX / 'BUILD.gn').read_text()
        for name in ('"ac_linux_auto_pip.h",', '"ac_linux_auto_pip_service.cc",', '"ac_linux_auto_pip_service.h",'):
            self.assertIn(name, gn)


class PrivateWindowAutoPictureInPictureTests(unittest.TestCase):
    def test_private_windows_run_on_the_primary_incognito_profile(self):
        service = (LINUX / 'ac_linux_profile_service.cc').read_text()
        self.assertIn('return original->GetPrimaryOTRProfile(true);', method(service, '  Profile* CreateOffTheRecord(Profile* original) override {'))
        self.assertIn('return original->GetPrimaryOTRProfile(false);', method(service, '  Profile* ExistingOffTheRecord(Profile* original) override {'))
        self.assertNotIn('CreateUniqueForIncognito', service)

    def test_no_patch_lifts_chrome_incognito_block_or_allows_auto_entry(self):
        touching = []
        for patch in sorted(PATCHES.glob('*.patch')):
            for hunk in file_hunks(patch.read_text(), HELPER):
                touching.append(patch.name)
                removed = [line for line in hunk.splitlines() if line.startswith('-') and not line.startswith('---')]
                added = [line for line in hunk.splitlines() if line.startswith('+') and not line.startswith('+++')]
                self.assertFalse([line for line in removed if 'CONTENT_SETTING' in line or 'IsPrimaryOTRProfile' in line or 'blocked_due_to_content_setting_' in line], patch.name)
                self.assertFalse([line for line in added if 'CONTENT_SETTING_ALLOW' in line or 'CONTENT_SETTING_ASK' in line], patch.name)
        self.assertEqual(sorted(set(touching)), ['chromium-auto-pip-global-switch.patch', 'chromium-linux-auto-pip.patch'])

    def test_chrome_treats_ask_as_block_in_a_primary_incognito_profile(self):
        helper = TREE / HELPER
        if not helper.exists():
            self.skipTest('Chromium 156 source tree is unavailable')
        source = helper.read_text()
        eligible = method(source, 'bool AutoPictureInPictureTabHelper::IsEligibleForAutoPictureInPicture(')
        ask = eligible[eligible.index('} else if (setting == CONTENT_SETTING_ASK &&'):]
        self.assertIn('->IsPrimaryOTRProfileWithRegularParent()) {', ask[:400])
        self.assertIn('return false;', ask[:600])
        enter = method(source, 'void AutoPictureInPictureTabHelper::MaybeEnterAutoPictureInPicture() {')
        self.assertLess(enter.index('IsEligibleForAutoPictureInPicture('), enter.index('EnterAutoPictureInPicture();'))
        self.assertIn('return CONTENT_SETTING_BLOCK;', method(source, 'ContentSetting AutoPictureInPictureTabHelper::GetCurrentContentSetting() const {').split('GURL url')[0])

    def test_the_linux_host_never_enters_picture_in_picture_without_a_control_press(self):
        sources = {path.name: path.read_text() for path in LINUX.glob('*.cc')}
        callers = sorted(name for name, text in sources.items() if re.search(r'->Enter(Auto)?PictureInPicture\(', text))
        self.assertEqual(callers, ['ac_linux_page_media.cc'])
        request = method(sources['ac_linux_page_media.cc'], 'void LinuxPageMedia::RequestPictureInPicture(')
        self.assertLess(request.index('ParseLinuxControlPress(args)'), request.index('session->EnterPictureInPicture();'))


if __name__ == '__main__':
    unittest.main()
