import pathlib
import re
import unittest

from chromium_series import applied

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PATCH = REPO / 'engine/patches/chromium-linux-companion-browsers.patch'
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
BROWSER_VIEW = 'chrome/browser/ui/views/frame/browser_view.cc'
PERMISSION = 'chrome/browser/ui/views/permissions/permission_prompt_base_view.cc'
UNLOAD = 'chrome/browser/ui/unload_controller.cc'
DELEGATE = 'chrome/browser/ui/browser_tab_strip_model_delegate.cc'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class CompanionPatchTests(unittest.TestCase):
    def setUp(self):
        self.patch = PATCH.read_text()

    def test_the_patch_is_linux_only_and_follows_the_background_window_patch(self):
        series = (REPO / 'engine/patches/series').read_text().splitlines()
        self.assertIn('chromium chromium-linux-companion-browsers.patch linux', series)
        self.assertEqual(series.index('chromium chromium-linux-companion-browsers.patch linux'),
                         series.index('chromium chromium-linux-background-windows.patch linux') + 1)

    def test_the_added_code_has_no_comments(self):
        added = '\n'.join(line[1:] for line in self.patch.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertNotRegex(added, r'(^|\s)//|/\*')

    def test_a_companion_never_shows_and_hosts_its_dialogs_in_the_visible_window(self):
        with applied(PATCH.name, BROWSER_VIEW, PERMISSION, UNLOAD, DELEGATE) as scratch:
            view = (scratch / BROWSER_VIEW).read_text()
            prompt = (scratch / PERMISSION).read_text()
            unload = (scratch / UNLOAD).read_text()
            delegate = (scratch / DELEGATE).read_text()
        for signature in ['void BrowserView::Restore() {', 'void BrowserView::Maximize() {', 'void BrowserView::Minimize() {',
                          'void BrowserView::SetBounds(const gfx::Rect& bounds) {', 'void BrowserView::Deactivate() {',
                          'void BrowserView::FlashFrame(bool flash) {',
                          'void BrowserView::ProcessFullscreen(bool fullscreen, const int64_t display_id) {',
                          'void BrowserView::RequestFullscreen(bool fullscreen, int64_t display_id) {']:
            body = method(view, signature)
            hook = 'g_ardia_linux_present_companion(browser_.get(), false)'
            self.assertIn(hook, body, signature)
            first = min(index for index in (body.find('browser_widget_->'), body.find('in_process_fullscreen_'),
                                            body.find('BrowserWindowFullscreenController'), body.find('#if')) if index >= 0)
            self.assertLess(body.index(hook), first, signature)
        last = method(unload, 'std::pair<bool, bool> IsLastWindow(const BrowserWindowInterface* browser) {')
        self.assertIn('g_ardia_linux_is_companion(other_browser)', last)
        closing = method(unload, 'void UnloadController::OnWindowClosing() {')
        self.assertLess(closing.index('g_ardia_linux_is_companion(browser_.get())'), closing.index('tab_restore_service->BrowserClosing('))
        multitab = method(unload, 'bool UnloadController::CanCloseWithMultipleTabs() {')
        self.assertIn('g_ardia_linux_is_companion(browser)', multitab)
        self.assertIn('g_ardia_linux_window_tab_count(browser_.get())', multitab)
        self.assertIn('total_window_count >= 1 || tab_count <= 1', multitab)
        warn = method(unload, 'UnloadController::MaybeWarnBeforeClosing(')
        self.assertIn('force_skip_warning_user_on_close() || (g_ardia_linux_is_companion && g_ardia_linux_is_companion(browser_.get()))', warn)
        historical = method(delegate, 'std::optional<SessionID> BrowserTabStripModelDelegate::CreateHistoricalTab(')
        self.assertLess(historical.index('UnloadController::From(browser_)->is_attempting_to_close_browser()'),
                        historical.index('service->CreateHistoricalTab('))
        for signature, activate, before in [('void BrowserView::Show() {', 'true', 'InitialWebUIManager::From'),
                                            ('void BrowserView::ShowInactive() {', 'false', 'browser_widget_->IsVisible()'),
                                            ('void BrowserView::Activate() {', 'true', 'InitialWebUIManager::From')]:
            body = method(view, signature)
            hook = f'g_ardia_linux_present_companion(browser_.get(), {activate})'
            self.assertIn(hook, body)
            self.assertLess(body.index(hook), body.index(before), signature)
        for signature in ['WebContentsModalDialogHost* BrowserView::GetWebContentsModalDialogHost() {',
                          'WebContentsModalDialogHost* BrowserView::GetWebContentsModalDialogHostFor(']:
            body = method(view, signature)
            self.assertIn('g_ardia_linux_companion_owner(browser_.get())', body)
            self.assertIn('view && view != this', body)
        native = method(prompt, 'gfx::NativeWindow PermissionPromptBaseView::GetNativeWindow() {')
        self.assertLess(native.index('g_ardia_linux_companion_owner(browser)'), native.index('browser->GetWindow()->GetNativeWindow()'))
        self.assertIn('extern BrowserWindowInterface* (*g_ardia_linux_companion_owner)(', prompt)


class CompanionHostTests(unittest.TestCase):
    def setUp(self):
        self.host = HOST.read_text()

    def test_companions_are_hidden_browsers_kept_out_of_session_restore_and_never_attached(self):
        ensure = method(self.host, 'BrowserWindowInterface* ShellHostView::EnsureMember(')
        for needle in ['params.omit_from_session_restore = true;', 'params.should_trigger_session_restore = false;',
                       'private_window()', 'closing()', 'browser_shutdown::IsTryingToQuit()',
                       'GetBrowserWindowCreationStatusForProfile(*profile) != BrowserWindowInterface::CreationStatus::kOk',
                       'CompanionOwners()[created->GetSessionID().id()] = id_;', 'StartLinuxContentBlocker(this->profile(), profile);',
                       'LinuxDownloadsCall(profile, "downloads.list", base::DictValue(), base::DoNothing());']:
            self.assertIn(needle, ensure)
        self.assertNotRegex(ensure, r'->Show(Inactive)?\(|Activate\(')
        self.assertLess(ensure.index('CompanionOwners()[created->GetSessionID().id()] = id_;'), ensure.index('return created;'))
        attach = method(self.host, '  void Attach(base::WeakPtr<BrowserWindowInterface> browser, bool startup) {')
        self.assertIn('IsCompanion(browser.get())', attach.splitlines()[1])
        present = self.host[self.host.index('  g_ardia_linux_present_companion = '):]
        present = present[:present.index('\n  };\n')]
        self.assertIn('if (!IsCompanion(browser)) return false;', present)
        self.assertIn('return true;', present)
        self.assertIn('host->FocusWindow()', present)

    def test_every_member_is_detached_from_chromes_contents_view_and_reports_its_own_strip(self):
        reattach = method(self.host, 'void ShellHostView::ReattachViewports() {')
        self.assertIn('for (BrowserWindowInterface* member : Members()) {', reattach)
        self.assertIn('chrome_view->SetWebContents(nullptr);', reattach)
        strips = method(self.host, 'base::ListValue ShellHostView::Strips() const {')
        self.assertIn('.Set("strip", member == browser_ ? id_ : member->GetSessionID().id())', strips)
        self.assertIn('.Set("window", id_)', strips)
        observer = method(self.host, 'void ShellHostView::OnTabStripModelChanged(')
        self.assertIn('if (!browser_ || !MemberWithStrip(changed)) return;', observer)
        self.assertIn('TabStripModel* model = changed;', observer)

    def test_a_profile_move_recreates_contents_and_a_transfer_keeps_only_same_profile_contents(self):
        create = method(self.host, 'void ShellHostView::CreateTabIn(')
        retire = create.index('if (binding && binding->contents()->GetBrowserContext() != profile) {')
        self.assertLess(create.index('CanReclaim(binding->claim'), retire)
        self.assertIn('DetachAndDeleteWebContentsAt(index)', create[retire:create.index('if (!binding) {', retire)])
        self.assertIn('const bool same_profile = existing->contents()->GetBrowserContext() == profile;', create)
        self.assertIn('NavigateParams navigation(member, url, ui::PAGE_TRANSITION_TYPED);', create)
        entry = method(self.host, 'void ShellHostView::CreateTab(')
        self.assertIn('if (!HostsProfile(requested)) return std::move(done).Run(false, ProfileFailure(ProfileError::kWindowMismatch));', entry)
        self.assertIn('host->renderer_generation_ != generation', entry)

    def test_one_close_confirms_every_companion_and_closes_them_with_the_window(self):
        ack = method(self.host, 'void ShellHostView::AcknowledgeWindowClose(')
        self.assertLess(ack.index('host->ConfirmCompanions('), ack.index('host->FinishChromePreparations(true);'))
        confirm = method(self.host, 'void ShellHostView::ConfirmCompanions(')
        self.assertIn('RunBeforeUnloadForShutdown(', confirm)
        self.assertIn('ResetBeforeUnloadForShutdown()', confirm)
        self.assertIn('browser_shutdown::IsTryingToQuit()', confirm)
        detach = method(self.host, 'void ShellHostView::DetachBrowser() {')
        self.assertIn('CloseCompanions();', detach)
        close = method(self.host, 'void ShellHostView::CloseCompanions() {')
        self.assertNotIn('DetachAndDeleteWebContentsAt', close)
        self.assertNotIn('set_force_skip_warning_user_on_close', close)
        self.assertIn('RunBeforeUnloadForShutdown(true, base::DoNothing())', close)
        self.assertIn('companion->GetWindow()->Close()', close)
        self.assertIn('g_ardia_linux_is_companion = [](const BrowserWindowInterface* browser) { return IsCompanion(browser); };', self.host)
        self.assertIn('RemoveObserver(this)', close)
        keeps = self.host[self.host.index('  g_ardia_keeps_window_without_tabs = '):]
        keeps = keeps[:keeps.index('\n  };\n')]
        self.assertIn('return host && !host->closing() && !browser_shutdown::IsTryingToQuit();', keeps)

    def test_extension_ui_follows_the_active_engine_profile_without_hiding_companions(self):
        self.assertNotRegex(self.host, r'g_ardia_hidden_from_extensions\s*=')
        select = method(self.host, 'void ShellHostView::SelectProfile(')
        self.assertIn('extension_surfaces_.reset();', select)
        self.assertIn('extension_keybindings_.reset();', select)
        self.assertNotIn('LinuxExtensionsWindowRetired', select)
        self.assertIn('ExtensionSurfaces()->Invoke(method, args, ActiveProfile(),', self.host)
        broadcast = self.host[self.host.index('  extensions.broadcast = '):]
        self.assertIn('(!profile->IsOffTheRecord() && host->ServesProfile(profile))', broadcast[:broadcast.index('\n  });\n')])
        self.assertTrue(re.search(r'method == "ArdiaShell\.setActiveProfile"', self.host))


if __name__ == '__main__':
    unittest.main()
