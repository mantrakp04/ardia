import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
FIXTURE = ROOT / 'tests/fixtures/page_commands.h'
PRODUCTION = [SOURCE / 'ardia/linux/ac_linux_page_commands.cc', SOURCE / 'ardia/linux/ac_linux_find.cc', SOURCE / 'ardia/linux/ac_linux_devtools_authority.cc']
MAIN = r'''
#include "ardia/linux/ac_linux_page_commands.h"
#include "ardia/linux/ac_linux_find.h"
#include "ardia/linux/ac_linux_devtools_authority.h"

using ardiacore::LinuxPageCommands;
using base::ListValue;
using find_in_page::SelectionAction;

bool FixtureDevToolsDispatch(content::WebContents* contents, ardiacore::LinuxDevToolsAction action,
    std::shared_ptr<ardiacore::LinuxDevToolsLease> lease, base::OnceClosure ready) {
  if (!lease->Matches(contents)) return false;
  auto* tools = DevToolsWindow::GetInstanceForInspectedWebContents(contents);
  if (action == ardiacore::LinuxDevToolsAction::kAdopt) {
    if (!tools || !tools->quarantined) return false;
    tools->quarantined = false;
    tools->adoptions++;
    return true;
  }
  if (action == ardiacore::LinuxDevToolsAction::kToggle && tools && tools->IsDocked()) {
    tools->frontend.DispatchBeforeUnload(false);
    return true;
  }
  auto toggle = action == ardiacore::LinuxDevToolsAction::kInspect ? DevToolsToggleAction::Inspect()
      : action == ardiacore::LinuxDevToolsAction::kConsole ? DevToolsToggleAction::ShowConsolePanel()
      : DevToolsToggleAction::Show();
  DevToolsWindow::OpenDevToolsWindow(contents, toggle, DevToolsOpenedByAction::kMainMenuOrMainShortcut);
  tools = DevToolsWindow::GetInstanceForInspectedWebContents(contents);
  if (!tools) return false;
  tools->SetLoadCompletedCallback([ready = std::move(ready)]() mutable { std::move(ready).Run(); });
  return true;
}

struct Fixture {
  Profile profile;
  content::WebContents a{&profile}, b{&profile};
  find_in_page::FindTabHelper find_a{&a}, find_b{&b};
  BrowserWindowInterface browser{&profile, BrowserWindowInterface::TYPE_NORMAL, {{&a, &b}}};
  std::vector<base::DictValue> events;
  bool current = true;
  int presented = 0;
  std::unique_ptr<LinuxPageCommands> commands;
  Fixture(bool ui = true, bool presentation = true) {
    ardiacore::InstallLinuxDevToolsDispatcher(FixtureDevToolsDispatch);
    LinuxPageCommands::Presentation present;
    if (presentation) present = [this] { presented++; };
    commands = std::make_unique<LinuxPageCommands>(
        &b, &profile, [this]() -> BrowserWindowInterface* { return current ? &browser : nullptr; },
        [this](base::DictValue event) { events.push_back(std::move(event)); }, ui, present);
  }
  void Ok(std::string_view command, ListValue args = {}) {
    assert(!commands->Dispatch(command, args));
  }
  void Error(std::string_view code, std::string_view command, ListValue args = {}) {
    auto error = commands->Dispatch(command, args);
    assert(error && error->at("code").GetString() == code);
    assert(!error->at("message").GetString().empty());
  }
  void Find(std::string text, bool forward = true, bool next = false) {
    Ok("find", ListValue().Append(text).Append(forward).Append(next));
  }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  std::string mode(argv[1]);
  if (mode == "find") {
    Fixture f;
    f.Find("needle");
    assert(f.find_a.starts == 0 && f.find_b.starts == 1);
    int first = f.find_b.request;
    f.find_b.Reply(first, 5, 1, false);
    const auto& event = f.events.back();
    assert(event.at("type").GetString() == "findResult");
    const auto& value = event.at("value").GetDict();
    assert(value.at("count").GetInt() == 5 && value.at("active").GetInt() == 1);
    assert(!value.at("final").GetBool());
    f.find_b.Reply(first, 5, 1, true);
    assert(f.events.back().at("value").GetDict().at("final").GetBool());
    f.Find("needle", true, true);
    assert(f.find_b.direction && f.find_b.session == first);
    f.Find("needle", false, true);
    assert(!f.find_b.direction && f.find_b.session == first);
    f.Find("other", true, false);
    assert(f.find_b.session > first);
    size_t count = f.events.size();
    f.find_b.Reply(first, 99, 99, true);
    assert(f.events.size() == count);
    f.Ok("stopFinding", ListValue().Append(false));
    assert(f.find_b.selection == SelectionAction::kKeep && f.find_b.observers.empty());
    f.Find("other");
    assert(f.find_b.starts == 5);
    f.Find("");
    assert(f.find_b.selection == SelectionAction::kClear && f.find_b.observers.empty());
    const auto& empty = f.events.back().at("value").GetDict();
    assert(empty.at("count").GetInt() == 0 && empty.at("active").GetInt() == 0 && empty.at("final").GetBool());
    f.Find("again");
    f.Ok("stopFinding", ListValue().Append(true));
    assert(f.find_b.selection == SelectionAction::kClear);
    f.b.find_available = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "find", ListValue().Append("needle").Append(true).Append(false));
    return 0;
  }
  if (mode == "lifetime") {
    Fixture f;
    f.Find("old");
    const int old = f.find_b.request;
    f.current = false;
    f.find_b.Reply(old, 9, 1, true);
    assert(f.events.empty() && f.find_b.observers.empty() && f.find_b.aborted);
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    f.commands->Reset();
    f.current = true;
    f.Error("ERR_PAGE_STALE_TARGET", "find", ListValue().Append("replacement").Append(true).Append(false));
    f.commands.reset();
    f.commands = std::make_unique<LinuxPageCommands>(&f.b, &f.profile,
        [&f] { return &f.browser; }, [&f](base::DictValue event) { f.events.push_back(std::move(event)); }, false,
        LinuxPageCommands::Presentation());
    f.Find("new");
    f.find_b.Reply(old, 9, 1, true);
    assert(f.events.empty());
    f.find_b.Reply(f.find_b.request, 2, 1, true);
    assert(f.events.size() == 1);
    f.browser.strip.tabs = {&f.a};
    f.find_b.Reply(f.find_b.request, 2, 2, true);
    assert(f.events.size() == 1 && f.find_b.observers.empty());
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    return 0;
  }
  if (mode == "authority") {
    Fixture f;
    Profile foreign;
    f.b.profile = &foreign;
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    f.b.profile = &f.profile;
    f.browser.profile = &foreign;
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    f.browser.profile = &f.profile;
    f.browser.type = BrowserWindowInterface::TYPE_DEVTOOLS;
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    f.browser.type = BrowserWindowInterface::TYPE_NORMAL;
    assert(f.a.prints == 0 && f.b.prints == 0);
    f.profile.path.name = "Profile work";
    f.Ok("print");
    f.Ok("runPageCommand", ListValue().Append("savePage"));
    f.Ok("showDevTools");
    f.profile.path.name = "Default";
    f.profile.otr = true;
    f.Ok("find", ListValue().Append("needle").Append(true).Append(false));
    f.Ok("print");
    f.Ok("runPageCommand", ListValue().Append("savePage"));
    f.Ok("showDevTools");
    f.b.devtools_allowed = false;
    f.Error("ERR_PAGE_POLICY", "showDevTools");
    f.b.devtools_allowed = true;
    f.profile.prefs.ints["downloadRestrictions"] = 3;
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("savePage"));
    f.profile.prefs.ints["downloadRestrictions"] = 0;
    f.profile.primary_otr = false;
    f.Error("ERR_PAGE_PROFILE", "print");
    f.Error("ERR_PAGE_PROFILE", "find", ListValue().Append("needle").Append(true).Append(false));
    f.profile.otr = false;
    f.profile.primary_otr = true;
    f.profile.regular = false;
    f.Error("ERR_PAGE_PROFILE", "print");
    f.profile.regular = true;
    assert(f.b.prints == 2 && f.b.saves == 2 && f.a.prints == 0);
    return 0;
  }
  if (mode == "arguments") {
    Fixture f;
    assert(LinuxPageCommands::Handles("find") && LinuxPageCommands::Handles("print"));
    assert(!LinuxPageCommands::Handles("reload"));
    f.Error("ERR_PAGE_ARGUMENT", "find");
    f.Error("ERR_PAGE_ARGUMENT", "find", ListValue().Append("x").Append(true).Append("false"));
    f.Error("ERR_PAGE_ARGUMENT", "stopFinding");
    f.Error("ERR_PAGE_ARGUMENT", "print", ListValue().Append(true));
    f.Error("ERR_PAGE_ARGUMENT", "runPageCommand");
    f.Error("ERR_PAGE_UNSUPPORTED", "runPageCommand", ListValue().Append("caretBrowsing"));
    f.Error("ERR_PAGE_UNSUPPORTED", "runPageCommand", ListValue().Append("unknown"));
    f.Error("ERR_PAGE_ARGUMENT", "showDevTools", ListValue().Append("unknown"));
    f.Error("ERR_PAGE_ARGUMENT", "showDevTools", ListValue().Append("show"));
    f.Error("ERR_PAGE_ARGUMENT", "showDevTools", ListValue().Append(false));
    f.Error("ERR_PAGE_UNSUPPORTED", "unknown");
    return 0;
  }
  if (mode == "print") {
    Fixture f;
    f.Ok("print");
    f.profile.prefs.bools["previewDisabled"] = true;
    f.Ok("print");
    f.Ok("runPageCommand", ListValue().Append("systemPrint"));
    assert(f.a.prints == 0 && f.a.basics == 0 && f.b.prints == 2 && f.b.basics == 1);
    f.profile.prefs.bools["print"] = false;
    f.Error("ERR_PAGE_POLICY", "print");
    f.profile.prefs.bools["print"] = true;
    f.b.restrictions = CONTENT_RESTRICTION_PRINT;
    f.Error("ERR_PAGE_POLICY", "print");
    f.a.preview = true;
    printing::PrintPreviewDialogController::GetInstance()->creating = true;
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("systemPrint"));
    f.b.preview = true;
    f.Ok("runPageCommand", ListValue().Append("systemPrint"));
    f.b.preview = false;
    f.b.restrictions = 0;
    f.b.modal = true;
    f.Error("ERR_PAGE_POLICY", "print");
    f.b.modal = false;
    f.b.crashed = true;
    f.Error("ERR_PAGE_POLICY", "print");
    f.b.crashed = false;
    f.b.print_result = false;
    f.Error("ERR_PAGE_DISPATCH", "print");
    f.b.print_manager = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
    f.b.print_manager = true;
    f.b.frame.live = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
    f.b.frame.live = true;
    content::WebContents pdf_guest(&f.profile);
    pdf_guest.print_manager = false;
    f.b.pdf_frame = &pdf_guest.frame;
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
    f.b.pdf_frame = nullptr;
    f.b.selected_frame = &pdf_guest.frame;
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
    f.b.selected_frame = nullptr;
    f.b.core_available = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "print");
    return 0;
  }
  if (mode == "save") {
    Fixture f;
    f.Ok("runPageCommand", ListValue().Append("savePage"));
    assert(f.a.saves == 0 && f.b.saves == 1);
    process.prefs.bools["fileDialogs"] = false;
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("savePage"));
    process.prefs.bools["fileDialogs"] = true;
    f.profile.prefs.ints["downloadRestrictions"] = 3;
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("savePage"));
    f.profile.prefs.ints["downloadRestrictions"] = 0;
    f.b.restrictions = CONTENT_RESTRICTION_SAVE;
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("savePage"));
    f.b.restrictions = 0;
    f.b.controller.entry.url = "chrome://settings";
    f.Error("ERR_PAGE_POLICY", "runPageCommand", ListValue().Append("savePage"));
    f.b.controller.entry.url = "https://example.test/";
    f.b.mime = "application/pdf";
    f.b.pdf_handles_save = true;
    f.Ok("runPageCommand", ListValue().Append("savePage"));
    assert(f.b.pdf_saves == 1 && f.b.saves == 1);
    f.b.pdf_handles_save = false;
    f.Ok("runPageCommand", ListValue().Append("savePage"));
    assert(f.b.saves == 2);
    f.b.controller.committed = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("savePage"));
    return 0;
  }
  if (mode == "devtools") {
    Fixture f;
    f.Ok("showDevTools");
    auto* tools = DevToolsWindow::GetInstanceForInspectedWebContents(&f.b);
    assert(tools && !DevToolsWindow::GetInstanceForInspectedWebContents(&f.a));
    assert(tools->action == DevToolsToggleAction::kShow);
    tools->loaded();
    assert(f.presented == 1);
    f.Ok("showDevTools", ListValue().Append("inspect"));
    assert(tools->action == DevToolsToggleAction::kInspect);
    f.Ok("showDevTools", ListValue().Append("console"));
    assert(tools->action == DevToolsToggleAction::kConsole);
    f.Ok("showDevTools", ListValue().Append("toggle"));
    assert(tools->frontend.beforeunloads == 1);
    tools->frontend_available = false;
    f.Error("ERR_PAGE_UNAVAILABLE", "showDevTools", ListValue().Append("toggle"));
    tools->frontend_available = true;
    tools->docked = false;
    f.Ok("showDevTools", ListValue().Append("toggle"));
    assert(tools->action == DevToolsToggleAction::kShow && tools->frontend.beforeunloads == 1);
    auto delayed = tools->loaded;
    f.commands->Reset();
    delayed();
    assert(f.presented == 1);
    Fixture g;
    g.b.devtools_allowed = false;
    g.Error("ERR_PAGE_POLICY", "showDevTools");
    g.b.devtools_allowed = true;
    g.b.devtools_result = false;
    g.Error("ERR_PAGE_DISPATCH", "showDevTools");
    Fixture no_layout(true, false);
    no_layout.Error("ERR_PAGE_UNAVAILABLE", "showDevTools");
    return 0;
  }
  if (mode == "background") {
    Fixture f(false);
    f.Error("ERR_PAGE_UNAVAILABLE", "print");
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("savePage"));
    f.Error("ERR_PAGE_UNAVAILABLE", "showDevTools");
    assert(f.b.prints == 0 && f.b.basics == 0 && f.b.saves == 0);
    assert(!DevToolsWindow::GetInstanceForInspectedWebContents(&f.b));
    f.Find("safe");
    return 0;
  }
  assert(false);
}
'''


class PageCommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-f01-native-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = pathlib.Path(cls.temp.name)
        headers = set()
        for source in PRODUCTION + list((SOURCE / 'ardia/linux').glob('ac_linux_*commands.h')) + [SOURCE / 'ardia/linux/ac_linux_find.h', SOURCE / 'ardia/linux/ac_linux_devtools_authority.h']:
            headers.update(re.findall(r'^#include "([^"]+)"', source.read_text(), re.M))
        for header in headers:
            if header.startswith('ardia/linux/'):
                continue
            path = cls.root / header
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('#include "page_commands_fixture.h"\n')
        shutil.copyfile(FIXTURE, cls.root / 'page_commands_fixture.h')
        (cls.root / 'main.cc').write_text(MAIN)
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        cls.binary = cls.root / 'commands'
        result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                                 '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                                 '-I', str(cls.root), '-I', str(SOURCE),
                                 *map(str, PRODUCTION), str(cls.root / 'main.cc'), '-o', str(cls.binary)],
                                capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def run_case(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=20,
                                env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_find_exact_pane_sessions_previous_next_hide_empty_and_missing_helper(self):
        self.run_case('find')

    def test_release_reclaim_transfer_and_renderer_authority_reject_stale_results(self):
        self.run_case('lifetime')

    def test_exact_window_profile_and_supported_profile_kinds(self):
        self.run_case('authority')

    def test_current_argument_contracts_and_explicit_caret_browsing_rejection(self):
        self.run_case('arguments')

    def test_print_exact_pane_policy_errors_and_preview_ownership(self):
        self.run_case('print')

    def test_save_exact_pane_policy_pdf_and_uncommitted_errors(self):
        self.run_case('save')

    def test_devtools_exact_pane_toggle_inspect_console_and_stale_load(self):
        self.run_case('devtools')

    def test_background_rejects_native_ui_before_dispatch(self):
        self.run_case('background')


if __name__ == '__main__':
    unittest.main()
