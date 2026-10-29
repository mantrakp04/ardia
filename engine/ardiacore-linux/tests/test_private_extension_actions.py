import os
import pathlib
import re
import unittest

from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
ACTIONS = REPO / 'engine/chromium/src/chrome/browser/ardia/ac_extension_actions.cc'
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
TREE = pathlib.Path(os.environ.get('ARDIA_CHROMIUM_156_SRC', pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'))


class PrivateExtensionActionTests(unittest.TestCase):
    def test_the_action_watch_lives_on_the_original_profile_so_its_events_are_never_tagged_off_the_record(self):
        actions = ACTIONS.read_text()
        watch = actions[actions.index('AC_PROFILE_CALL(ac_extensions_watch_actions) {'):]
        self.assertIn('ardia::StateFor<ardia::ActionWatch>(call.profile());', watch)
        service = (ROOT / 'src/ardia/linux/ac_linux_extension_service.cc').read_text()
        call = method(service, 'void CallProfile(')
        original = call[call.index('case ext::PrivateRoute::kOriginal:'):call.index('case ext::PrivateRoute::kEnding:')]
        self.assertIn('window.profile->GetOriginalProfile()', original)
        extensions = (ROOT / 'src/ardia/linux/ac_linux_extensions.cc').read_text()
        self.assertIn('name == "extensions.watchActions"', method(extensions, 'PrivateRoute PrivateWindowRoute('))
        emit = method(actions, '  void Emit(const extensions::ExtensionId& extension_id,')
        self.assertIn('ardia::Emit("extensions.action", profile(),', emit)
        self.assertNotIn('offTheRecord', actions)
        self.assertEqual(len(re.findall(r'"extensions\.action"', actions)), 1)

    def test_chrome_redirects_the_action_dispatcher_from_incognito_to_the_original_profile(self):
        header = TREE / 'chrome/browser/extensions/extension_action_dispatcher.h'
        if not header.exists():
            self.skipTest('Chromium 156 source tree is unavailable')
        self.assertIn('static const bool kServiceRedirectedInIncognito = true;', header.read_text())

    def test_the_host_forwards_action_events_to_private_windows_of_the_profile(self):
        event = method(HOST.read_text(), 'void ShellHostView::EngineEvent(')
        self.assertNotIn('private_window()', event)
        self.assertNotIn('IsOffTheRecord', event)
        self.assertIn('ardiacore::LinuxProfileNameForPath(String(translated, "profile"))', event)


if __name__ == '__main__':
    unittest.main()
