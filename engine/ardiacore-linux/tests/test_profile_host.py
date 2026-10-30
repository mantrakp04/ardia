import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method


ROOT = Path(__file__).resolve().parents[1]
HOST = Path(os.environ.get('ARDIA_PROFILE_HOST_SOURCE', ROOT / 'src/ardia/linux/ac_linux_host.cc'))


def branch(source, marker):
    return method(source, marker)


class ProfileHostTests(unittest.TestCase):
    def setUp(self):
        self.source = HOST.read_text()

    def test_refused_windows_are_dropped_without_closed_history_and_private_ones_stay_with_their_opener(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        functions = '\n'.join(method(self.source, signature) for signature in (
            'bool PrivateProfileId(', 'void NotifyOpener(', 'void NotifyWindowRefused(', 'void RefuseRequestedWindow('))
        code = r'''
#include "ardia/linux/ac_linux_profiles.h"
#include <cassert>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
std::vector<std::string> log;
namespace base {
struct DictValue {
  std::map<std::string, std::string> values;
  DictValue&& Set(const char* key, std::string value) && { values[key] = std::move(value); return std::move(*this); }
  DictValue Clone() const { return *this; }
};
struct Value {
  DictValue dict;
  explicit Value(DictValue value) : dict(std::move(value)) {}
};
}
namespace ardiacore {
void ReleaseLinuxProfile(std::string_view id) { log.push_back("release:" + std::string(id)); }
}
struct Host {
  std::string name;
  void Event(std::string_view module, std::string_view event, base::Value payload) {
    log.push_back(name + ":" + std::string(module) + "." + std::string(event) + ":" +
                  payload.dict.values["type"] + ":" + payload.dict.values["id"]);
  }
};
std::map<int, Host*>& Hosts() { static std::map<int, Host*> hosts; return hosts; }
struct RequestedWindow { std::string id; std::string page_profile; int opener_host = 0; };
std::map<int, RequestedWindow>& RequestedWindows() { static std::map<int, RequestedWindow> windows; return windows; }
struct Window { void Close() { log.push_back("chrome:close"); } };
struct BrowserWindowInterface {
  Window window;
  Window* GetWindow() { return &window; }
};
ARDIA_NATIVE
int main() {
  Host opener{"opener"};
  Host other{"other"};
  Hosts()[1] = &opener;
  Hosts()[2] = &other;
  RequestedWindows()[7] = {"w-work", "p-work", 1};
  RequestedWindows()[8] = {"w-kept", "", 1};
  RequestedWindows()[9] = {"w-private", "incognito:w-private@", 1};
  BrowserWindowInterface browser;
  RefuseRequestedWindow(&browser, RequestedWindows().find(7));
  assert(!RequestedWindows().contains(7) && RequestedWindows().contains(8));
  assert((log == std::vector<std::string>{
      "opener:ArdiaShell.onWindowEvent:refused:w-work",
      "other:ArdiaShell.onWindowEvent:refused:w-work",
      "chrome:close"}));
  log.clear();
  RefuseRequestedWindow(&browser, RequestedWindows().find(9));
  assert((log == std::vector<std::string>{
      "release:incognito:w-private@",
      "opener:ArdiaShell.onWindowEvent:refused:w-private",
      "chrome:close"}));
  log.clear();
  NotifyOpener(42, base::DictValue().Set("type", "attached").Set("id", "gone"));
  assert(log.empty());
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-profile-host-') as scratch:
            cpp = Path(scratch) / 'refuse.cc'
            binary = Path(scratch) / 'refuse'
            cpp.write_text(code.replace('ARDIA_NATIVE', functions))
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(ROOT / 'src'),
                                     str(ROOT / 'src/ardia/linux/ac_linux_profiles.cc'), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_attach_reports_to_the_opener_and_private_close_is_released_natively(self):
        attach = method(self.source, '  void Attach(base::WeakPtr<BrowserWindowInterface> browser, bool startup) {')
        self.assertIn('return RefuseRequestedWindow(browser.get(), requested);', attach)
        self.assertNotIn('->Close()', attach)
        self.assertIn('if (opener) NotifyOpener(*opener, base::DictValue().Set("type", "attached").Set("id", shell->window_id()));', attach)
        closed = method(self.source, '  void OnBrowserClosed(BrowserWindowInterface* browser) override {')
        self.assertIn('ardiacore::ReleaseLinuxProfile(closed_profile->id);', closed)
        self.assertIn('NotifyOpener(opener, base::DictValue().Set("type", "close").Set("id", closed_window));', closed)
        self.assertNotIn('BroadcastWindowClosed', self.source)

    def test_private_windows_are_reachable_only_by_themselves_and_their_current_opener(self):
        self.assertIn('ardiacore::linux_profiles::WindowReachableBy(target->access(), requester())', self.source)
        self.assertIn('return {window_id_, page_profile_, id_, opener_host_, opener_generation_};', self.source)
        ids = method(self.source, '  if (method == "ArdiaShell.windowIds") {')
        self.assertIn('if (Reaches(host)) ids.Append(host->window_id());', ids)
        request = method(self.source, '  if (method == "ArdiaShell.requestWindowClose") {')
        self.assertIn('!Reaches(target)) continue;', request)
        operations = method(self.source, '  if (method == "ArdiaShell.windowFrame" || method == "ArdiaShell.closeWindow"')
        self.assertIn('(method == "ArdiaShell.focusWindow" ? FocusReaches(host) : Reaches(host))) target = host;', operations)
        open_window = method(self.source, '  if (method == "ArdiaShell.openWindow") {')
        self.assertIn('if (!Reaches(host)) return std::move(done).Run(false, base::Value("No such native window"));', open_window)
        self.assertIn('request.opener_host != id_ || request.opener_generation != renderer_generation_', open_window)
        self.assertIn('opening.opener_host = id_;', open_window)
        self.assertIn('opening.opener_generation = renderer_generation_;', open_window)
        for gone in ('void ShellHostView::DetachBrowser() {', 'ShellHostView::~ShellHostView() {'):
            self.assertIn('ForgetOpenerHost(id_);', method(self.source, gone))
        opening = method(self.source, 'void OpenNativeWindow(')
        self.assertIn('FinishWindowOpening(id, generation, true, base::Value(base::DictValue().Set("pending", true)));', opening)

    def test_downloads_and_files_use_the_window_page_profile(self):
        request = method(self.source, '  void Request(const base::ListValue& arguments) {')
        downloads = request[request.index('if (LinuxDownloadsHandles(name) || linux_downloads::IsDownloadControl(name)) {'):]
        downloads = downloads[:downloads.index('return LinuxDownloadsCall(')]
        self.assertIn('Profile* page = host_->page_profile();', downloads)
        self.assertIn('host_->HostsProfile(profile)', downloads)
        self.assertIn('return LinuxDownloadsCall(page, name, input,', request)
        self.assertNotIn('LinuxDownloadsCall(host_->profile()', request)
        invoke = method(self.source, 'void ShellHostView::Invoke(')
        files = invoke[invoke.index('if (LinuxFilesHandles(method)) {'):]
        files = files[:files.index('\n  }\n') + 4]
        self.assertIn('for (BrowserWindowInterface* member : Members()) {', files)
        self.assertIn('LinuxFilesInvoke(profiles, shell_, method, values, std::move(done))', files)

    def test_site_zoom_resolves_named_profiles_and_routes_private_sessions_off_the_record(self):
        request = method(self.source, '  void Request(const base::ListValue& arguments) {')
        zoom = request[request.index('if (ardiacore::IsLinuxZoomDomainRoute(name)) {'):]
        zoom = zoom[:zoom.index('\n      }\n') + 8]
        self.assertIn('const bool private_session = private_request;', zoom)
        self.assertIn('RoutePrivateCall(name,', zoom)
        self.assertIn('page && host_->HostsProfile(profile)', zoom)
        self.assertIn('prepared->args.Set(ardiacore::linux_private_services::kOffTheRecordKey, true)', zoom)
        self.assertIn('const std::string path = page->GetOriginalProfile()->GetPath().value();', zoom)
        private = zoom[zoom.index('if (private_session) {\n          const std::string path'):]
        self.assertLess(private.index('return;'), private.index('ResolveLinuxProfile('))
        self.assertIn('ardiacore::ResolveLinuxProfile(profile,', zoom)
        self.assertIn('resolved->IsOffTheRecord()', zoom)
        self.assertIn('ProfileError::kPrivateService', zoom)
        self.assertIn('const std::string path = resolved->GetPath().value();', zoom)
        self.assertLess(zoom.index('PrepareLinuxZoomDomain(name, input)'), zoom.index('ResolveLinuxProfile('))
        self.assertNotIn('kWindowMismatch', zoom)
        self.assertNotIn('host_->profile()', zoom)

    def test_window_openings_are_profile_bound_and_bounded(self):
        open_window = branch(self.source, '  if (method == "ArdiaShell.openWindow") {')
        self.assertIn('OpeningWindows().Begin(id, profile_name->id, reply)', open_window)
        self.assertIn('OpeningAdmission::kMismatch', open_window)
        self.assertIn('request.page_profile != profile_name->id', open_window)
        self.assertIn('OpeningWindows().Begin(id, profile_name->id, reply)', open_window)
        self.assertIn('return BeginWindowOpening(std::move(opening), ticket.generation, utility ? profile() : nullptr);', open_window)
        begin = method(self.source, 'void BeginWindowOpening(')
        self.assertIn('base::BindOnce(&ExpireWindowOpening, opening.id, generation), kWindowOpeningLimit', begin)
        self.assertIn('ardiacore::ResolveLinuxProfile(page_profile,', begin)
        opening = method(self.source, 'void OpenNativeWindow(')
        self.assertTrue(opening.split('{', 1)[1].lstrip().startswith('if (!OpeningWindows().Current(opening.id, generation)) return;'))
        self.assertNotIn('std::set<std::string>& OpeningWindows()', self.source)


class ProfileSuggestionTests(unittest.TestCase):
    def setUp(self):
        self.host = HOST.read_text()
        self.suggest = (ROOT / 'src/ardia/linux/ac_linux_suggest.cc').read_text()

    def test_suggestions_are_gated_by_the_app_setting_and_fetched_on_the_window_page_profile(self):
        suggest = method(self.host, '  if (method == "ArdiaSearch.suggest") {')
        self.assertIn('CanFetchSuggestions(profile(), page_profile(), values[0].GetString())', suggest)
        self.assertIn('suggestions_->Fetch(profile(), page_profile(), values[1].GetString(), values[0].GetString(),', suggest)
        gate = method(self.suggest, 'bool CanFetchSuggestions(')
        self.assertIn('Settings().find(setting_profile->GetOriginalProfile()->GetPath())', gate)
        self.assertIn('!network_profile', gate)
        fetch = method(self.suggest, 'void SuggestionClient::Fetch(')
        self.assertIn('std::make_unique<SuggestionFetch>(this, id, network_profile, std::move(reply))', fetch)
        self.assertIn('started->Load(network_profile, GURL(url));', fetch)
        load = method(self.suggest, '  void Load(Profile* profile, const GURL& url) {')
        self.assertIn('profile->GetDefaultStoragePartition()', load)


class ProfilePageCommandTests(unittest.TestCase):
    def test_page_commands_and_devtools_use_the_window_page_profile(self):
        host = HOST.read_text()
        page = method(host, 'ardiacore::LinuxPageCommands* ShellHostView::EnsurePageCommands(')
        self.assertIn('binding->contents(), ProfileOf(binding->contents()->GetBrowserContext()),', page)
        self.assertIn('authority.host->OwnerOf(authority.contents.get())', page)
        self.assertNotIn('binding->contents(), profile(),', page)
        self.assertIn('tools = AddChildView(std::make_unique<ViewportView>(ProfileOf(contents->GetBrowserContext())));', host)
        self.assertIn('binding->SetViewport(AddChildView(std::make_unique<ViewportView>(ProfileOf(binding->contents()->GetBrowserContext()))));', host)
        self.assertNotIn('ViewportView>(profile())', host)


class ProfileServiceTests(unittest.TestCase):
    def setUp(self):
        self.source = Path(os.environ.get('ARDIA_PROFILE_SERVICE_SOURCE', ROOT / 'src/ardia/linux/ac_linux_profile_service.cc')).read_text()

    def test_dying_profiles_are_never_observed_and_private_creation_waits_for_them(self):
        watch = method(self.source, '  bool Watch(Profile* profile) override {')
        self.assertIn('if (!profile || profile->ShutdownStarted()) return false;', watch)
        existing = method(self.source, '  Profile* ExistingOffTheRecord(Profile* original) override {')
        self.assertIn('GetPrimaryOTRProfile(false)', existing)
        create = method(self.source, '  Profile* CreateOffTheRecord(Profile* original) override {')
        self.assertIn('GetPrimaryOTRProfile(true)', create)
        registry = (ROOT / 'src/ardia/linux/ac_linux_profiles.h').read_text()
        self.assertIn('if (existing && (!backend_.Usable(existing) || !backend_.Watch(existing))) {', registry)
        self.assertIn('!backend_.Watch(otr)) {', registry)
        self.assertIn('if (!backend_.Watch(profile)) return false;', registry)
        later = method(self.source, '  void Later(std::function<void()> task) override {')
        self.assertIn('PostDelayedTask', later)
        self.assertNotIn('OffTheRecord(Profile* original) override {\n    if (!Usable(original) || original->IsOffTheRecord()) return nullptr;\n    Profile* otr = original->GetPrimaryOTRProfile(true);\n    if (otr) Watch(otr);', self.source)

    def test_a_profile_directory_that_cannot_be_written_fails_the_load_instead_of_hanging(self):
        writable = method(self.source, 'bool ProfileDirectoryWritable(const base::FilePath& path) {')
        self.assertIn('return base::CreateDirectory(path) && base::PathIsWritable(path);', writable)
        load = method(self.source, '  void Load(const std::string& directory, std::function<void(Profile*)> done) override {')
        self.assertNotIn('CreateProfileAsync', load)
        self.assertIn('if (manager->GetProfileByPath(path)) return CreateProfile(path, std::move(done), true);', load)
        self.assertIn('base::BindOnce(&ProfileDirectoryWritable, path),', load)
        self.assertIn('base::BindOnce(&ChromeProfiles::CreateProfile, path, std::move(done))', load)
        self.assertIn('base::MayBlock()', load)
        create = method(self.source, '  static void CreateProfile(const base::FilePath& path, std::function<void(Profile*)> done, bool writable) {')
        self.assertLess(create.index('if (!writable || !manager) return done(nullptr);'), create.index('manager->CreateProfileAsync('))

    def test_app_profile_stays_the_startup_profile(self):
        pin = method(self.source, 'void PinStartupProfile(const std::string& app_directory) {')
        for pref in ('prefs::kProfileLastUsed', 'prefs::kProfilesLastActive', 'prefs::kBrowserShowProfilePickerOnStartup'):
            self.assertIn(pref, pin)
        self.assertIn('linux_profiles::PinnedStartupProfiles(current, app_directory)', pin)
        registrar = method(self.source, 'void PinStartupProfileFor(Profile* app) {')
        for pref in ('prefs::kProfileLastUsed, prefs::kProfilesLastActive,', 'prefs::kBrowserShowProfilePickerOnStartup'):
            self.assertIn(pref, registrar)
        self.assertIn('registrar->Add(pref, base::BindRepeating(&PinStartupProfile, app_directory));', registrar)
        self.assertIn('PinStartupProfile(app_directory);', registrar)
        app = method(self.source, 'bool SetLinuxAppProfile(Profile* profile) {')
        self.assertIn('PinStartupProfileFor(profile);', app)


if __name__ == '__main__':
    unittest.main()
