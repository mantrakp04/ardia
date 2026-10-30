import pathlib
import unittest

from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class PrivateDownloadHostTests(unittest.TestCase):
    def setUp(self):
        self.host = (LINUX / 'ac_linux_host.cc').read_text()
        self.files = (LINUX / 'ac_linux_files.cc').read_text()

    def downloads_branch(self):
        request = method(self.host, '  void Request(const base::ListValue& arguments) {')
        branch = request[request.index('if (LinuxDownloadsHandles(name) || linux_downloads::IsDownloadControl(name)) {'):]
        return branch[:branch.index('\n      }\n') + 8]

    def test_download_calls_route_by_the_window_page_profile_including_its_private_session(self):
        branch = self.downloads_branch()
        self.assertIn('linux_downloads::RouteDownloads(profile_name->kind, page_private,', branch)
        self.assertIn('page_private && page->ShutdownStarted()', branch)
        self.assertIn('host_->HostsProfile(profile)', branch)
        self.assertIn('if (!LinuxDownloadOwned(page, *download))', branch)
        self.assertIn('page->GetOriginalProfile()->GetPath().value()', branch)
        self.assertIn('return LinuxDownloadsCall(page, name, input,', branch)
        self.assertIn('linux_downloads::DownloadCommand(name)', branch)
        self.assertIn('linux_downloads::kDownloadCommandService', branch)
        self.assertNotIn('FindRoute', branch)
        self.assertNotIn('kPrivateService', branch)

    def test_controls_no_longer_reach_the_engine_through_the_profile_registry_route(self):
        request = method(self.host, '  void Request(const base::ListValue& arguments) {')
        controls = request.index('linux_downloads::IsDownloadControl(name)')
        generic = request.index('const auto* route = ardiacore::linux_contract::FindRoute(name);')
        self.assertLess(controls, generic)

    def test_private_download_events_reach_only_the_private_windows_that_own_them(self):
        event = method(self.host, 'void ShellHostView::EngineEvent(')
        self.assertIn('if (download->FindBool("offTheRecord").value_or(false) && !ReceivesPrivateDownload(*download)) return;', event)
        receives = method(self.host, 'bool ShellHostView::ReceivesPrivateDownload(')
        self.assertIn('page && page->IsOffTheRecord() && !page->ShutdownStarted()', receives)
        self.assertIn('LinuxDownloadOwned(page, *id)', receives)

    def test_private_removals_reach_only_private_windows_of_their_profile(self):
        event = method(self.host, 'void ShellHostView::EngineEvent(')
        removal = event.index('const bool private_removal = topic == "downloads.removed" && translated.FindBool("offTheRecord").value_or(false);')
        self.assertLess(removal, event.index('if (translated.FindBool("offTheRecord").value_or(false)) return;'))
        self.assertIn('if (private_removal) translated.Remove("offTheRecord");', event)
        self.assertIn('if (!ReceivesRemoval(private_removal, String(translated, "profile"))) return;', event)
        receives = method(self.host, 'bool ShellHostView::ReceivesRemoval(')
        self.assertIn('for (BrowserWindowInterface* member : Members()) {', receives)
        self.assertIn('linux_downloads::DeliversRemoval(private_removal, page->IsOffTheRecord(),', receives)
        self.assertIn('page->GetOriginalProfile()->GetPath().value()', receives)

    def test_the_engine_tags_private_removals_on_linux_only(self):
        engine = (ROOT.parents[1] / 'engine/chromium/src/chrome/browser/ardia/ac_downloads.cc').read_text()
        self.assertIn('#include "build/build_config.h"', engine)
        removal = method(engine, 'base::DictValue Removal(DownloadItem* item) {')
        self.assertIn('base::DictValue removal = base::DictValue().Set("id", item->GetGuid());', removal)
        gated = removal[removal.index('#if BUILDFLAG(IS_LINUX)'):removal.index('#endif')]
        self.assertIn('if (IsOffTheRecord(item)) {', gated)
        self.assertIn('removal.Set("offTheRecord", true);', gated)
        self.assertEqual(engine.count('Post("downloads.removed", Removal(item));'), 2)
        self.assertNotIn('Post("downloads.removed", base::DictValue()', engine)

    def test_file_operations_follow_the_page_profile_into_private_windows(self):
        invoke = method(self.host, 'void ShellHostView::Invoke(')
        files = invoke[invoke.index('if (LinuxFilesHandles(method)) {'):]
        files = files[:files.index('\n  }\n') + 4]
        self.assertIn('page_profile()->ShutdownStarted()', files)
        self.assertNotIn('IsOffTheRecord', files)
        self.assertIn('for (BrowserWindowInterface* member : Members()) {', files)
        self.assertIn('LinuxFilesInvoke(profiles, shell_, method, values, std::move(done))', files)

    def test_the_service_lists_only_the_private_session_own_downloads(self):
        self.assertNotIn('RegularDownloads', self.files)
        page = method(self.files, 'content::DownloadManager* PageDownloads(Profile* profile) {')
        self.assertIn('!profile->ShutdownStarted()', page)
        self.assertIn('profile->GetDownloadManager()', page)
        listed = method(self.files, 'void ListReplied(void* context, const char* json) {')
        self.assertIn('downloads::FilterSnapshot(*value, reply->off_the_record)', listed)
        self.assertIn('ERR_PROFILE_ENDING', listed)
        self.assertIn('LinuxDownloadOwned(profile, *id)', listed)
        ready = method(self.files, 'void ListWhenReady(')
        self.assertIn('profile->GetOriginalProfile()->GetPath().value()', ready)
        self.assertIn('profile->GetWeakPtr()', ready)
        owned = method(self.files, 'bool LinuxDownloadOwned(Profile* profile, const std::string& id) {')
        self.assertIn('manager->GetDownloadByGuid(id)', owned)
        self.assertIn('ListedDownload(item)', owned)
        invoke = method(self.files, 'void LinuxFilesInvoke(')
        self.assertNotIn('IsOffTheRecord', invoke)


if __name__ == '__main__':
    unittest.main()
