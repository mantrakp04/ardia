import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()
PATCH = (REPO / 'engine/patches/chromium-linux-page-prompts.patch').read_text()
SERIES = (REPO / 'engine/patches/series').read_text()
PASSWORDS = (LINUX / 'ac_linux_password_prompts.cc').read_text()
PERMISSIONS = (LINUX / 'ac_linux_permission_prompts.cc').read_text()
EXTERNAL = (LINUX / 'ac_linux_external_apps.cc').read_text()
BUILD = (LINUX / 'BUILD.gn').read_text()

POLICY_TEST = r'''
#include <cassert>
#include <string>
#include "ardia/linux/ac_linux_page_prompt_policy.h"
using namespace ardiacore::linux_page_prompts;
int main() {
  assert(DecidePermission(false, PermissionAnswer::kAccept, true, true) == PermissionAction::kAccept);
  assert(DecidePermission(false, PermissionAnswer::kAccept, false, true) == PermissionAction::kAcceptThisTime);
  assert(DecidePermission(false, PermissionAnswer::kAccept, false, false) == PermissionAction::kAccept);
  assert(DecidePermission(false, PermissionAnswer::kDeny, true, true) == PermissionAction::kDeny);
  assert(DecidePermission(false, PermissionAnswer::kDeny, false, true) == PermissionAction::kDismiss);
  assert(DecidePermission(false, PermissionAnswer::kDismiss, true, true) == PermissionAction::kDismiss);
  assert(DecidePermission(true, PermissionAnswer::kAccept, true, true) == PermissionAction::kDismiss);
  assert(DecidePermission(true, PermissionAnswer::kDeny, true, true) == PermissionAction::kDeny);
  assert(DecidePermission(true, PermissionAnswer::kDeny, false, true) == PermissionAction::kDismiss);
  assert(!ParsePermissionAnswer("Accept") && !ParsePermissionAnswer("") && ParsePermissionAnswer("deny"));
  assert(ValidPromptId("p1", 'p') && ValidPromptId("x123", 'x') && ValidPromptId("r9", 'r'));
  assert(!ValidPromptId("p", 'p') && !ValidPromptId("p0", 'p') && !ValidPromptId("x1", 'p') && !ValidPromptId("p1a", 'p'));
  assert(!ValidPromptId("p" + std::string(30, '1'), 'p'));
  assert(PasswordAnswerFits(PasswordAnswer::kSave, PasswordState::kSave));
  assert(PasswordAnswerFits(PasswordAnswer::kUpdate, PasswordState::kUpdate));
  assert(!PasswordAnswerFits(PasswordAnswer::kSave, PasswordState::kOther));
  assert(!PasswordAnswerFits(PasswordAnswer::kNever, PasswordState::kUpdate));
  assert(!PasswordAnswerFits(PasswordAnswer::kNope, PasswordState::kSave));
  assert(PasswordAnswerFits(PasswordAnswer::kDismiss, PasswordState::kOther));
  assert(!ParsePasswordAnswer("delete") && ParsePasswordAnswer("nope"));
  assert(!ParseAutofillAnswer("yes") && ParseAutofillAnswer("decline"));
  assert(!KnownExternalApp("") && !KnownExternalApp("xdg-open") && KnownExternalApp("Obsidian"));
  ExternalAppText none = DescribeExternalApp("", "https://a.test", "nosuch", false);
  assert(none.title == "No application is set to open this link" && none.remember.empty());
  assert(none.message.find("nosuch:") != std::string::npos);
  ExternalAppText app = DescribeExternalApp("Obsidian", "https://a.test", "obsidian", true);
  assert(app.title.find("Obsidian") != std::string::npos);
  assert(app.message == "https://a.test wants to open this application.");
  assert(app.remember == "Always allow https://a.test to open links of this type in Obsidian");
  assert(DescribeExternalApp("Obsidian", "", "obsidian", false).message == "This page wants to open this application.");
  assert(DescribeExternalApp("Obsidian", "http://a.test", "obsidian", false).remember.empty());
  return 0;
}
'''


class PagePromptPolicyTest(unittest.TestCase):
    def test_policy_decisions(self):
        compiler = shutil.which('c++') or shutil.which('g++') or shutil.which('clang++')
        if not compiler:
            self.skipTest('no C++ compiler')
        with tempfile.TemporaryDirectory() as scratch:
            source = pathlib.Path(scratch) / 'policy.cc'
            source.write_text(POLICY_TEST)
            binary = pathlib.Path(scratch) / 'policy'
            subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-fsanitize=address,undefined',
                            '-I', str(ROOT / 'src'), str(source), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


class PagePromptWiringTest(unittest.TestCase):
    def test_patch_is_linux_only_and_hooks_each_prompt(self):
        self.assertIn('chromium chromium-linux-page-prompts.patch linux\n', SERIES)
        for path in ('chrome/browser/ui/views/permissions/permission_prompt_factory.cc',
                     'components/permissions/permission_request_manager.cc',
                     'chrome/browser/ui/views/file_system_access/file_system_access_restore_permission_bubble_view.cc',
                     'chrome/browser/external_protocol/external_protocol_handler.cc',
                     'chrome/browser/ui/views/autofill/autofill_bubble_handler_impl.cc',
                     'chrome/browser/ui/passwords/manage_passwords_ui_controller.cc'):
            self.assertIn(f'+++ b/{path}\n', PATCH)
        self.assertIn('+  if (!delegate && g_ardia_external_protocol_dialog &&\n', PATCH)
        forwarded = re.findall(r'^\+  if \(AutofillBubbleHandler\* ardia = ArdiaAutofillBubbleHandler\(web_contents\)\) \{$', PATCH, re.M)
        self.assertEqual(len(forwarded), 18)

    def test_every_hook_the_patch_defines_is_installed(self):
        for hook in ('g_ardia_create_permission_prompt', 'g_ardia_file_system_restore_prompt',
                     'g_ardia_linux_permission_tab_shown'):
            self.assertIn(f'  {hook} = ', PERMISSIONS)
        self.assertIn('  g_ardia_external_protocol_dialog = &AskHost;', EXTERNAL)
        self.assertIn('  g_ardia_password_bubble = &HandlePasswordBubble;', PASSWORDS)
        self.assertIn('  g_ardia_linux_password_bubble_hidden = &PasswordBubbleHidden;', PASSWORDS)
        self.assertIn('+  if (g_ardia_linux_password_bubble_hidden) {\n', PATCH)
        self.assertIn('ardiacore::StartLinuxPagePrompts(std::move(prompts));', HOST)
        for source in ('ac_linux_page_prompts.cc', 'ac_linux_permission_prompts.cc', 'ac_linux_password_prompts.cc',
                       'ac_linux_autofill_prompts.cc', 'ac_linux_external_apps.cc'):
            self.assertIn(f'"{source}"', BUILD)

    def test_prompt_answers_come_only_from_a_trusted_shell(self):
        request = HOST.index('  void Request(const base::ListValue& arguments) {')
        trusted = HOST.index('!host_->Trusted(web_ui())', request)
        handled = HOST.index('ardiacore::LinuxPagePromptCallHandles(name)', request)
        self.assertLess(trusted, handled)
        self.assertIn('ardiacore::LinuxPagePromptCall(host_->id(), name, parsed->GetDict())', HOST)
        command = HOST.index('void ShellHostView::TabCommand(')
        claimed = HOST.index('TabBinding* binding = ClaimedBinding(args);', command)
        prompt = HOST.index('ardiacore::LinuxPagePromptCommandHandles(command)', command)
        self.assertLess(claimed, prompt)

    def test_password_answers_never_carry_a_password(self):
        self.assertIn('if (key == "password") return "Passwords never travel on the page command route";', PASSWORDS)
        self.assertNotRegex(PASSWORDS, r'\bLOG\(|\bVLOG\(|\bDLOG\(|printf\(')
        self.assertNotIn('password_value', PASSWORDS.split('base::DictValue()\n      .Set("state", name)')[1].split(';')[0])

    def test_an_answer_reaches_only_the_offer_it_was_given_for(self):
        resolve = PASSWORDS[PASSWORDS.index('std::string ResolvePasswordPrompt('):]
        self.assertLess(resolve.index('OfferOf(*current) != open->offer'), resolve.index('model->SavePassword('))
        self.assertLess(resolve.index('offer != open->id'), resolve.index('model->SavePassword('))
        self.assertLess(resolve.index('shown != contents->GetPrimaryMainFrame()'), resolve.index('model->SavePassword('))
        self.assertIn('prompt->Set("offer", open->id);', PASSWORDS)

    def test_abusive_quiet_requests_are_dropped_and_open_prompts_follow_their_tab(self):
        self.assertIn('delegate->ShouldCurrentRequestUseQuietUI() && delegate->ShouldDropCurrentRequestIfCannotShowQuietly()',
                      PERMISSIONS)
        self.assertEqual(HOST.count('ardiacore::RedeliverLinuxPermissionPrompts('), 2)
        self.assertIn('tab.shown = shown == 1 ? 1 : shown == 0 ? 0 : -1;', HOST)
        self.assertIn('return tab.window ? tab.shown : -1;', PERMISSIONS)

    def test_external_apps_need_an_active_initiator_and_honor_the_checkbox_policy(self):
        self.assertIn('frame && frame->IsActive()', EXTERNAL)
        self.assertIn('prefs::kExternalProtocolDialogShowAlwaysOpenCheckbox', EXTERNAL)
        self.assertIn('ExternalProtocolHandler::MayRememberAllowDecisionsForThisOrigin', EXTERNAL)
        self.assertIn('"xdg-mime", "query", "default", "x-scheme-handler/" + scheme', EXTERNAL)

    def test_answers_are_checked_against_the_window_that_shows_the_tab(self):
        self.assertIn('if (TabFor(contents_.get()).window != window) return false;', PERMISSIONS)
        self.assertIn('if (contents && TabFor(contents).window != window) return "The request belongs to another window";',
                      EXTERNAL)


if __name__ == '__main__':
    unittest.main()
