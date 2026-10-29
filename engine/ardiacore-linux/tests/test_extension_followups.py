import pathlib
import re
import tempfile
import unittest

from chromium_series import applied
from test_downloads import compile_and_run
from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'
CHROMIUM = pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'
NEW_SOURCES = ['ac_linux_extension_shortcuts', 'ac_linux_extension_keybindings', 'ac_linux_native_messaging']


def added_lines(patch):
    return '\n'.join(line for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++'))


def dry_run(patch, *relatives):
    with applied(patch.name, *relatives):
        pass


class ExtensionFollowupHelperTests(unittest.TestCase):
    def test_shortcut_book_and_native_messaging_lookup(self):
        with tempfile.TemporaryDirectory(prefix='ardia-extension-followups-') as directory:
            scratch = pathlib.Path(directory)
            for folder in ('first', 'second'):
                (scratch / folder).mkdir()
            (scratch / 'second/com.example.host.json').write_text('{}')
            (scratch / 'first/com.example.both.json').write_text('{}')
            (scratch / 'second/com.example.both.json').write_text('{}')
            (scratch / 'first/com.example.folder.json').mkdir()
            output = compile_and_run(self, 'extension-followups', [
                LINUX / 'ac_linux_extension_shortcuts.cc', LINUX / 'ac_linux_native_messaging.cc',
                FIXTURES / 'extension_followups_scenarios.cc',
            ], args=[str(scratch)])
        self.assertIn('extension follow-up scenarios passed', output)


class NativeMessagingSearchOrderTests(unittest.TestCase):
    def test_password_manager_manifest_folders_are_searched_after_ardia_own(self):
        source = CHROMIUM / 'chrome/browser/extensions/api/messaging/launch_context_posix.cc'
        paths = CHROMIUM / 'chrome/common/chrome_paths.cc'
        if not source.exists() or not paths.exists():
            self.skipTest('the Chromium 156 source tree is unavailable')
        text = source.read_text()
        markers = ['DIR_USER_NATIVE_MESSAGING, host_name', 'DIR_CHROME_USER_NATIVE_MESSAGING, host_name',
                   'g_ardia_native_messaging_manifest(host_name)', 'DIR_NATIVE_MESSAGING, host_name',
                   'DIR_CHROME_NATIVE_MESSAGING, host_name']
        if 'g_ardia_native_messaging_manifest(host_name)' not in text:
            self.skipTest('the Chromium 156 tree does not carry the native messaging patch')
        order = [text.index(marker) for marker in markers]
        self.assertEqual(order, sorted(order))
        defined = paths.read_text()
        chrome_system = defined[defined.index('case chrome::DIR_CHROME_NATIVE_MESSAGING:'):][:400]
        self.assertIn('"/etc/opt/chrome/native-messaging-hosts"', chrome_system)
        self.assertIn('"/etc/chromium/native-messaging-hosts"', defined)
        chrome_user = defined[defined.index('case chrome::DIR_CHROME_USER_NATIVE_MESSAGING:'):][:300]
        self.assertIn('DIR_CHROME_USER_DATA', chrome_user)
        self.assertIn('GetChromeUserDataDirectory(&cur)', defined[defined.index('case chrome::DIR_CHROME_USER_DATA:'):][:200])
        linux_paths = (CHROMIUM / 'chrome/common/chrome_paths_linux.cc').read_text()
        chrome_user_data = linux_paths[linux_paths.index('bool GetChromeUserDataDirectory('):]
        chrome_user_data = chrome_user_data[:chrome_user_data.index('\n}\n')]
        self.assertIn('std::string data_dir_basename = "google-chrome";', chrome_user_data)


class ExtensionShortcutWiringTests(unittest.TestCase):
    host = (LINUX / 'ac_linux_host.cc').read_text()
    glue = (LINUX / 'ac_linux_extension_keybindings.cc').read_text()

    def test_ardia_shortcuts_run_first_and_extensions_never_shadow_them(self):
        key = method(self.host, 'void ShellHostView::OnKeyEvent(ui::KeyEvent* event) {')
        self.assertIn('AcceleratorPressed(accelerator) || ExtensionShortcutPressed(*event, shortcuts_.contains(accelerator))', key)
        self.assertLess(key.index('AcceleratorPressed(accelerator)'), key.index('ExtensionShortcutPressed'))
        pressed = method(self.host, 'bool ShellHostView::ExtensionShortcutPressed(')
        self.assertIn('!ExtensionsListening()', pressed)
        self.assertNotIn('IsOffTheRecord()', pressed)
        self.assertIn('ui::Accelerator(event.key_code(), event.flags())', pressed)
        self.assertIn('linux_extension_shortcuts::kActionShortcutEvent', pressed)
        self.assertIn('ExtensionTabKey(contents)', pressed)
        self.assertIn('GetWeakPtr()', pressed)

    def test_registry_lifetime_follows_the_window_keyboard_handler(self):
        unregister = method(self.host, 'void ShellHostView::UnregisterAccelerators() {')
        self.assertIn('extension_keybindings_.reset();', unregister)
        detach = method(self.host, 'void ShellHostView::DetachBrowser() {')
        self.assertLess(detach.index('UnregisterAccelerators();'), detach.index('browser_ = nullptr;'))
        destructor = method(self.host, 'ShellHostView::~ShellHostView() {')
        self.assertIn('UnregisterAccelerators();', destructor)

    def test_private_windows_only_get_incognito_allowed_extensions(self):
        populate = self.glue[self.glue.index('bool LinuxExtensionKeybindings::PopulateCommands('):]
        populate = populate[:populate.index('\n}\n')]
        self.assertIn('browser_context()->IsOffTheRecord()', populate)
        self.assertIn('extensions::util::IsIncognitoEnabled(extension->id(), browser_context())', populate)
        self.assertLess(populate.index('IsIncognitoEnabled'), populate.index('GetNamedCommands'))

    def test_the_unused_suspend_path_is_gone(self):
        header = (LINUX / 'ac_linux_extension_keybindings.h').read_text()
        book = (LINUX / 'ac_linux_extension_shortcuts.h').read_text()
        self.assertNotIn('OnShortcutHandlingSuspended', header + self.glue)
        self.assertNotIn('SetSuspended', book)

    def test_glue_registers_actions_and_regular_commands_only(self):
        self.assertIn('ShouldIgnoreCommand(const std::string&) const {\n  return false;', self.glue)
        self.assertIn('extensions::CommandService::REGULAR', self.glue)
        self.assertNotIn('CommandService::GLOBAL', self.glue)
        self.assertIn('ActionInfo::Type::kAction', self.glue)
        self.assertIn('NotifyEventTargets(', self.glue)
        self.assertIn('GetActiveWebContents()', self.glue)
        events = re.findall(r'"(extensions\.actionShortcut)"', (LINUX / 'ac_linux_extension_shortcuts.h').read_text())
        api = (REPO / 'packages/ardiacore/src/engine/api.ts').read_text()
        self.assertEqual(events, ['extensions.actionShortcut'])
        self.assertIn('"extensions.actionShortcut": ActionPopupRequest;', api)


class ExtensionFollowupPatchTests(unittest.TestCase):
    series = (REPO / 'engine/patches/series').read_text()

    def test_settings_overrides_patch_enables_search_providers_but_not_homepage_or_startup_pages(self):
        self.assertIn('chromium chromium-linux-settings-overrides.patch linux', self.series)
        patch = REPO / 'engine/patches/chromium-linux-settings-overrides.patch'
        text = patch.read_text()
        added = added_lines(text)
        self.assertIn('+    "platforms": ["win", "mac", "linux"]', added)
        self.assertIn('-    "platforms": ["win", "mac"]', text)
        self.assertNotRegex(added, r'^\+\s*(//|/\*)')
        api = text[text.index('+++ b/chrome/browser/extensions/api/settings_overrides/settings_overrides_api.cc'):]
        self.assertEqual(api.count('+#if !BUILDFLAG(IS_LINUX)'), 2)
        guarded = api[api.index('+#if !BUILDFLAG(IS_LINUX)'):]
        self.assertLess(guarded.index('settings->homepage'), guarded.index('+#endif'))
        second = guarded[guarded.index('+#endif') + 1:]
        second = second[second.index('+#if !BUILDFLAG(IS_LINUX)'):]
        self.assertLess(second.index('settings->startup_pages'), second.index('+#endif'))
        self.assertLess(second.index('+#endif'), second.index('settings->search_engine'))
        dry_run(patch, 'chrome/common/extensions/api/_manifest_features.json',
                'chrome/browser/extensions/api/settings_overrides/settings_overrides_api.cc')

    def test_chromium_extension_accelerators_are_not_registered_on_linux(self):
        self.assertIn('chromium chromium-linux-extension-keybindings.patch linux', self.series)
        patch = REPO / 'engine/patches/chromium-linux-extension-keybindings.patch'
        text = patch.read_text()
        self.assertNotRegex(added_lines(text), r'^\+\s*(//|/\*)')
        views = text[text.index('+++ b/chrome/browser/ui/views/extensions/extension_keybinding_registry_views.cc'):]
        self.assertIn('+#if BUILDFLAG(IS_LINUX)\n+  return false;\n+#else', views)
        action = text[text.index('+++ b/chrome/browser/ui/views/extensions/extension_action_delegate_desktop.cc'):]
        register = action[action.index('ExtensionActionDelegateDesktop::RegisterCommand() {'):]
        self.assertTrue(register.split('\n')[1] == '+#if !BUILDFLAG(IS_LINUX)', register[:200])
        dry_run(patch, 'chrome/browser/ui/views/extensions/extension_keybinding_registry_views.cc',
                'chrome/browser/ui/views/extensions/extension_action_delegate_desktop.cc')

    def test_native_messaging_patch_adds_a_linux_lookup_hook_the_host_installs(self):
        self.assertIn('chromium chromium-linux-native-messaging-hosts.patch linux', self.series)
        patch = REPO / 'engine/patches/chromium-linux-native-messaging-hosts.patch'
        text = patch.read_text()
        added = added_lines(text)
        self.assertNotRegex(added, r'^\+\s*(//|/\*)')
        declaration = 'base::FilePath (*g_ardia_native_messaging_manifest)(const std::string& host_name)'
        self.assertIn(declaration + ' = nullptr;', added)
        self.assertIn('allow_user_level_hosts', added)
        self.assertNotIn('PathExists', added)
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn(f'extern {declaration};', host)
        lookup = method(host, 'base::FilePath NativeMessagingManifest(const std::string& host_name) {')
        self.assertIn('linux_native_messaging::FindManifest(', lookup)
        self.assertIn('linux_native_messaging::ExtraUserDirectories(', lookup)
        start = method(host, 'void StartLinuxHost() {')
        self.assertLess(start.index('g_ardia_native_messaging_manifest = &NativeMessagingManifest;'), start.index('StartLinuxExtensions('))
        self.assertLess(text.index('DIR_CHROME_USER_NATIVE_MESSAGING'), text.index('g_ardia_native_messaging_manifest(host_name)'))
        self.assertLess(text.index('g_ardia_native_messaging_manifest(host_name)'), text.index('DIR_NATIVE_MESSAGING, host_name'))
        dry_run(patch, 'chrome/browser/extensions/api/messaging/launch_context_posix.cc')


class ExtensionFollowupSourceRules(unittest.TestCase):
    def test_new_sources_have_no_comments_and_are_built(self):
        build = (LINUX / 'BUILD.gn').read_text()
        target = build[build.index('source_set("linux")'):]
        for name in NEW_SOURCES:
            for suffix in ['.cc', '.h']:
                path = LINUX / f'{name}{suffix}'
                self.assertIn(f'"{name}{suffix}"', target)
                self.assertIsNone(re.search(r'(^|\s)//(?!\s*nogncheck)|/\*', path.read_text()), path)
        self.assertIn('"//chrome/browser/tab_list"', target)
        fixture = (FIXTURES / 'extension_followups_scenarios.cc').read_text()
        self.assertIsNone(re.search(r'(^|\s)//|/\*', fixture))


if __name__ == '__main__':
    unittest.main()
