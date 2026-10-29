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
HOST_FIXTURE = ROOT / 'tests/fixtures/page_command_host.h'
HOST = SOURCE / 'ardia/linux/ac_linux_host.cc'
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
  if (mode == "teardown") {
    Fixture f;
    f.Find("needle");
    f.b.Destroy();
    assert(f.find_b.observers.empty() && f.find_b.aborted);
    f.Error("ERR_PAGE_STALE_TARGET", "print");
    Fixture g;
    auto helper = std::make_unique<find_in_page::FindTabHelper>(&g.b);
    g.Find("needle");
    helper.reset();
    g.commands->Reset();
    return 0;
  }
  if (mode == "rebind") {
    Fixture f;
    f.Find("old");
    auto old_request = f.find_b.request;
    f.commands->Reset();
    assert(f.find_b.observers.empty() && f.find_b.aborted);
    f.commands = std::make_unique<LinuxPageCommands>(&f.a, &f.profile,
        [&f] { return &f.browser; }, [&f](base::DictValue event) { f.events.push_back(std::move(event)); }, false,
        LinuxPageCommands::Presentation());
    f.Find("replacement");
    f.find_b.Reply(old_request, 8, 8, true);
    assert(f.events.empty());
    assert(f.find_a.starts == 1 && f.find_b.starts == 1);
    f.find_a.Reply(f.find_a.request, 1, 1, true);
    assert(f.events.size() == 1);
    return 0;
  }
  if (mode == "reentrant") {
    Fixture f;
    std::unique_ptr<LinuxPageCommands> commands;
    commands = std::make_unique<LinuxPageCommands>(&f.b, &f.profile,
        [&f] { return &f.browser; }, [&commands](base::DictValue) { commands.reset(); }, false,
        LinuxPageCommands::Presentation());
    assert(!commands->Dispatch("find", ListValue().Append("needle").Append(true).Append(false)));
    f.find_b.Reply(f.find_b.request, 2, 1, true);
    assert(!commands && f.find_b.observers.empty());
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
  if (mode == "buildflags") {
    Fixture f;
#if !ENABLE_PRINTING
    f.Error("ERR_PAGE_UNAVAILABLE", "print");
#else
    f.Ok("print");
#endif
#if !ENABLE_PRINTING || !ENABLE_PRINT_PREVIEW || !ENABLE_BASIC_PRINT_DIALOG
    f.Error("ERR_PAGE_UNAVAILABLE", "runPageCommand", ListValue().Append("systemPrint"));
#endif
    return 0;
  }
  assert(false);
}
'''


JOINED_MAIN = r'''
struct Joined {
  Profile profile;
  content::WebContents left{&profile}, right{&profile};
  find_in_page::FindTabHelper find_left{&left}, find_right{&right};
  BrowserWindowInterface browser{&profile, BrowserWindowInterface::TYPE_NORMAL, {{&left, &right}}};
  ShellHostView host{&profile, &browser};
  HostMessageHandler handler;
  Joined() {
    ardiacore::background = false;
    ardiacore::InstallLinuxDevToolsDispatcher(FixtureDevToolsDispatch);
    host.CommitRenderer(&handler);
    host.Bind(7, &left, "left");
    host.Bind(8, &right, "right");
  }
  ~Joined() {
    host.bindings_.clear();
    Drain();
  }
  std::pair<bool, base::Value> Call(int id, std::string claim, std::string command, ListValue args = {}) {
    base::DictValue request;
    request_table[&request] = {id, claim, command, args};
    std::optional<std::pair<bool, base::Value>> reply;
    host.TabCommand(request, [&reply](bool ok, base::Value value) { reply.emplace(ok, std::move(value)); });
    request_table.erase(&request);
    assert(reply);
    return *reply;
  }
  void Ok(int id, std::string claim, std::string command, ListValue args = {}) {
    auto [ok, value] = Call(id, claim, command, args);
    assert(ok);
  }
  void Fails(std::string_view code, int id, std::string claim, std::string command, ListValue args = {}) {
    auto [ok, value] = Call(id, claim, command, args);
    assert(!ok && value.GetDict().at("code").GetString() == code);
    assert(!value.GetDict().at("message").GetString().empty());
  }
  static ListValue Needle(std::string text = "needle") { return ListValue().Append(text).Append(true).Append(false); }
  void Drain() { base::SequencedTaskRunner::GetCurrentDefault()->Drain(); }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  std::string mode(argv[1]);
  if (mode == "panes") {
    Joined f;
    f.Ok(8, "right", "find", Joined::Needle());
    assert(f.find_right.starts == 1 && f.find_left.starts == 0);
    f.find_right.Reply(f.find_right.request, 3, 1, true);
    assert(f.handler.events.size() == 1);
    const auto& event = f.handler.events.back();
    assert(event.module == "ArdiaWebView" && event.event == "8");
    assert(event.payload.GetDict().at("type").GetString() == "pageEvent" && event.payload.GetDict().at("claim").GetString() == "right");
    assert(event.payload.GetDict().at("event").GetDict().at("name").GetString() == "find");
    const auto& value = event.payload.GetDict().at("event").GetDict().at("data").GetDict();
    assert(value.at("count").GetInt() == 3 && value.at("active").GetInt() == 1 && value.at("final").GetBool());
    f.Ok(7, "left", "print");
    assert(f.left.prints == 1 && f.right.prints == 0);
    f.Ok(8, "right", "runPageCommand", ListValue().Append("savePage"));
    f.Ok(7, "left", "runPageCommand", ListValue().Append("systemPrint"));
    assert(f.right.saves == 1 && f.left.saves == 0 && f.left.basics == 1 && f.right.basics == 0);
    assert(f.host.Binding(7)->page_commands && f.host.Binding(8)->page_commands);
    assert(f.host.Binding(7)->page_commands != f.host.Binding(8)->page_commands);
    f.Ok(8, "right", "stopFinding", ListValue().Append(true));
    assert(f.find_right.observers.empty() && f.find_left.stops == 0);
    f.Ok(8, "right", "showDevTools", ListValue().Append("inspect"));
    auto* tools = DevToolsWindow::GetInstanceForInspectedWebContents(&f.right);
    assert(tools && !DevToolsWindow::GetInstanceForInspectedWebContents(&f.left));
    assert(tools->action == DevToolsToggleAction::kInspect);
    tools->loaded();
    assert(f.host.presentations == std::vector<content::WebContents*>{&f.right});
    f.Ok(8, "right", "showDevTools", ListValue().Append("console"));
    assert(tools->action == DevToolsToggleAction::kConsole);
    f.Ok(8, "right", "showDevTools", ListValue().Append("toggle"));
    assert(tools->frontend.beforeunloads == 1);
    auto legacy = f.Call(8, "right", "reload");
    assert(legacy.first && legacy.second.GetString() == "legacy");
    return 0;
  }
  if (mode == "stale") {
    Joined f;
    f.Ok(8, "right", "find", Joined::Needle());
    const int old = f.find_right.request;
    f.host.Binding(8)->claim = "intruder";
    f.find_right.Reply(old, 4, 1, true);
    assert(f.handler.events.empty() && f.find_right.observers.empty());
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "intruder", "print");
    assert(f.right.prints == 0);
    f.host.Bind(8, &f.right, "right-2");
    f.Ok(8, "right-2", "find", Joined::Needle());
    f.find_right.Reply(old, 9, 9, true);
    assert(f.handler.events.empty());
    f.find_right.Reply(f.find_right.request, 2, 1, true);
    assert(f.handler.events.size() == 1);
    HostMessageHandler next;
    f.host.CommitRenderer(&next);
    f.find_right.Reply(f.find_right.request, 5, 2, true);
    assert(f.handler.events.size() == 1 && next.events.empty());
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right-2", "find", Joined::Needle());
    f.host.Bind(8, &f.right, "right-3");
    f.Ok(8, "right-3", "find", Joined::Needle());
    f.find_right.Reply(f.find_right.request, 1, 1, true);
    assert(next.events.size() == 1 && f.handler.events.size() == 1);
    f.host.document_alive_.reset();
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right-3", "print");
    f.host.Binding(8)->ResetPageCommands();
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right-3", "print");
    assert(f.right.prints == 0);
    Joined strip;
    strip.browser.strip.tabs = {&strip.left};
    strip.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    strip.Ok(7, "left", "print");
    Joined utility;
    utility.host.utility = true;
    utility.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    Joined unauthorized;
    unauthorized.Ok(8, "right", "find", Joined::Needle());
    unauthorized.handler.authorized = false;
    unauthorized.find_right.Reply(unauthorized.find_right.request, 3, 3, true);
    assert(unauthorized.handler.events.empty());
    unauthorized.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    Joined generation;
    generation.host.Binding(8)->renderer_generation = 0;
    generation.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    Joined moved;
    moved.Ok(8, "right", "find", Joined::Needle());
    moved.host.bindings_[8]->contents_ = &moved.left;
    moved.find_right.Reply(moved.find_right.request, 6, 1, true);
    assert(moved.handler.events.empty());
    moved.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "print");
    assert(strip.right.prints == 0 && utility.right.prints == 0 && unauthorized.right.prints == 0 &&
           moved.left.prints == 0 && moved.right.prints == 0);
    return 0;
  }
  if (mode == "migration") {
    Joined f;
    content::WebContents fresh{&f.profile};
    find_in_page::FindTabHelper find_fresh{&fresh};
    f.Ok(8, "right", "find", Joined::Needle());
    const int old = f.find_right.request;
    f.Ok(8, "right", "showDevTools", ListValue().Append("inspect"));
    f.browser.strip.tabs = {&f.left, &fresh};
    tab_ids[&fresh] = 9;
    auto moved = std::move(f.host.bindings_[8]);
    f.host.bindings_.erase(8);
    moved->page_.reset();
    moved->ResetPageCommands();
    moved->contents_ = &fresh;
    moved->page_ = std::make_shared<ardiacore::FakePage>(&f.handler, 9, moved->claim);
    f.host.bindings_[9] = std::move(moved);
    assert(!f.host.Binding(9)->page_commands && !f.host.Binding(9)->page_command_request);
    f.find_right.Reply(old, 5, 5, true);
    assert(f.handler.events.empty() && f.find_right.observers.empty());
    f.Ok(9, "right", "find", Joined::Needle());
    assert(find_fresh.starts == 1 && f.find_right.starts == 1);
    find_fresh.Reply(find_fresh.request, 2, 1, true);
    assert(f.handler.events.size() == 1 && f.handler.events.back().event == "9");
    f.Ok(9, "right", "showDevTools", ListValue().Append("inspect"));
    assert(DevToolsWindow::GetInstanceForInspectedWebContents(&fresh));
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "find", Joined::Needle());
    f.host.bindings_.clear();
    f.Drain();
    return 0;
  }
  if (mode == "envelope") {
    Joined f;
    f.Ok(8, "right", "find", Joined::Needle());
    f.host.Binding(8)->page()->epoch = 2;
    f.find_right.Reply(f.find_right.request, 3, 1, true);
    assert(f.handler.events.empty());
    f.Ok(8, "right", "find", Joined::Needle());
    f.find_right.Reply(f.find_right.request, 3, 2, true);
    assert(f.handler.events.size() == 1);
    f.host.Binding(8)->page()->provisional = true;
    f.find_right.Reply(f.find_right.request, 3, 3, true);
    assert(f.handler.events.size() == 1);
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "find", Joined::Needle());
    f.Ok(8, "right", "print");
    assert(f.right.prints == 1);
    f.host.Binding(8)->page()->provisional = false;
    f.host.Binding(8)->page_.reset();
    f.Fails("ERR_PAGE_STALE_TARGET", 8, "right", "find", Joined::Needle());
    f.Ok(7, "left", "find", Joined::Needle());
    f.host.Binding(7)->ResetPageCommands();
    assert(!f.host.Binding(7)->page_command_request);
    return 0;
  }
  if (mode == "background") {
    Joined f;
    ardiacore::background = true;
    f.Fails("ERR_PAGE_UNAVAILABLE", 8, "right", "print");
    f.Fails("ERR_PAGE_UNAVAILABLE", 8, "right", "runPageCommand", ListValue().Append("systemPrint"));
    f.Fails("ERR_PAGE_UNAVAILABLE", 8, "right", "runPageCommand", ListValue().Append("savePage"));
    f.Fails("ERR_PAGE_UNAVAILABLE", 8, "right", "showDevTools");
    f.Fails("ERR_PAGE_UNAVAILABLE", 8, "right", "showDevTools", ListValue().Append("inspect"));
    assert(f.right.prints == 0 && f.right.basics == 0 && f.right.saves == 0);
    assert(!DevToolsWindow::GetInstanceForInspectedWebContents(&f.right));
    f.Ok(8, "right", "find", Joined::Needle());
    f.find_right.Reply(f.find_right.request, 1, 1, true);
    assert(f.handler.events.size() == 1);
    return 0;
  }
  if (mode == "unsupported") {
    Joined f;
    f.Fails("ERR_PAGE_UNSUPPORTED", 8, "right", "runPageCommand", ListValue().Append("caretBrowsing"));
    f.Fails("ERR_PAGE_UNSUPPORTED", 8, "right", "runPageCommand", ListValue().Append("bogus"));
    f.Fails("ERR_PAGE_ARGUMENT", 8, "right", "runPageCommand");
    f.Fails("ERR_PAGE_ARGUMENT", 8, "right", "runPageCommand", ListValue().Append(true));
    f.Fails("ERR_PAGE_ARGUMENT", 8, "right", "showDevTools", ListValue().Append("bogus"));
    f.Fails("ERR_PAGE_STALE_TARGET", 9, "none", "find", Joined::Needle());
    auto legacy = f.Call(9, "none", "reload");
    assert(!legacy.first && legacy.second.GetString() == "No such live tab");
    assert(f.right.saves == 0 && f.right.prints == 0 && f.right.basics == 0);
    return 0;
  }
  if (mode == "adopt") {
    Joined f;
    f.host.AdoptDevTools(f.host.Binding(8));
    assert(!f.host.Binding(8)->page_commands);
    DevToolsWindow::OpenDevToolsWindow(&f.right, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kMainMenuOrMainShortcut);
    auto* tools = DevToolsWindow::GetInstanceForInspectedWebContents(&f.right);
    tools->quarantined = true;
    f.host.Bind(8, &f.right, "right-2");
    f.host.AdoptDevTools(f.host.Binding(8));
    assert(f.host.Binding(8)->page_commands && tools->adoptions == 1 && !tools->quarantined);
    assert(!DevToolsWindow::GetInstanceForInspectedWebContents(&f.left));
    f.host.AdoptDevTools(f.host.Binding(7));
    assert(!f.host.Binding(7)->page_commands);
    tools->quarantined = true;
    f.host.Bind(8, &f.right, "right-3");
    f.host.Binding(8)->claim.clear();
    f.host.AdoptDevTools(f.host.Binding(8));
    assert(!f.host.Binding(8)->page_commands && tools->adoptions == 1);
    Joined background;
    ardiacore::background = true;
    DevToolsWindow::OpenDevToolsWindow(&background.right, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kMainMenuOrMainShortcut);
    auto* hidden = DevToolsWindow::GetInstanceForInspectedWebContents(&background.right);
    hidden->quarantined = true;
    background.host.AdoptDevTools(background.host.Binding(8));
    assert(hidden->quarantined && hidden->adoptions == 0);
    return 0;
  }
  if (mode == "reset") {
    Joined f;
    f.Ok(8, "right", "showDevTools");
    auto* tools = DevToolsWindow::GetInstanceForInspectedWebContents(&f.right);
    auto delayed = tools->loaded;
    f.host.Binding(8)->ResetPageCommands();
    assert(!f.host.Binding(8)->page_commands);
    delayed();
    assert(f.host.presentations.empty());
    f.Drain();
    f.Ok(7, "left", "find", Joined::Needle());
    f.handler.on_event = [&f] { f.host.Binding(7)->ResetPageCommands(); };
    f.find_left.Reply(f.find_left.request, 1, 1, true);
    assert(!f.host.Binding(7)->page_commands && f.find_left.observers.empty() && f.find_left.aborted);
    assert(f.handler.events.size() == 1);
    f.handler.on_event = nullptr;
    f.Drain();
    f.Ok(7, "left", "find", Joined::Needle("again"));
    assert(f.host.Binding(7)->page_commands && f.find_left.observers.size() == 1);
    f.host.bindings_.erase(7);
    assert(f.find_left.observers.empty());
    f.Drain();
    return 0;
  }
  assert(false);
}
'''


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def prepare_headers(root):
    headers = set()
    for source in PRODUCTION + list((SOURCE / 'ardia/linux').glob('ac_linux_*commands.h')) + [SOURCE / 'ardia/linux/ac_linux_find.h', SOURCE / 'ardia/linux/ac_linux_devtools_authority.h']:
        headers.update(re.findall(r'^#include "([^"]+)"', source.read_text(), re.M))
    for header in headers:
        if header.startswith('ardia/linux/'):
            continue
        path = root / header
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#include "page_commands_fixture.h"\n')
    shutil.copyfile(FIXTURE, root / 'page_commands_fixture.h')


def joined_source():
    host = HOST.read_text()
    declaration = host[host.index('class ShellHostView : public views::View,'):]
    authority = method(declaration, '  struct PageCommandAuthority {') + ';\n'
    command = method(host, 'void ShellHostView::TabCommand(')
    prologue = command[:command.index('  content::WebContents* contents = binding->contents();\n')]
    methods = '\n'.join(method(host, signature) for signature in [
        'TabBinding* ShellHostView::PageCommandBinding(',
        'void ShellHostView::EmitPageCommandEvent(',
        'ardiacore::LinuxPageCommands* ShellHostView::EnsurePageCommands(',
        'void ShellHostView::PageCommand(',
        'void ShellHostView::AdoptDevTools(',
    ]) + '\n' + prologue + '  std::move(done).Run(true, base::Value("legacy"));\n}\n'
    fixture = HOST_FIXTURE.read_text().replace('#pragma once\n', '').replace('#include "page_commands_fixture.h"\n', '')
    fixture = fixture.replace('ARDIA_RESET_PAGE_COMMANDS', method(host, 'void TabBinding::ResetPageCommands('))
    fixture = fixture.replace('ARDIA_AUTHORITY', authority).replace('ARDIA_HOST_METHODS', methods)
    return MAIN[:MAIN.index('struct Fixture {')] + fixture + JOINED_MAIN


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
        cls.compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not cls.compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        cls.binary = cls.compile('commands')

    @classmethod
    def compile(cls, name, flags=()):
        binary = cls.root / name
        result = subprocess.run([cls.compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                                 '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                                 '-I', str(cls.root), '-I', str(SOURCE), *flags,
                                 *map(str, PRODUCTION), str(cls.root / 'main.cc'), '-o', str(binary)],
                                capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        return binary

    def run_case(self, mode, binary=None):
        result = subprocess.run([str(binary or self.binary), mode], capture_output=True, text=True, timeout=20,
                                env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_find_exact_pane_sessions_previous_next_hide_empty_and_missing_helper(self):
        self.run_case('find')

    def test_release_reclaim_transfer_and_renderer_authority_reject_stale_results(self):
        self.run_case('lifetime')

    def test_contents_and_find_helper_destruction(self):
        self.run_case('teardown')

    def test_rebind_stops_old_contents_before_observing_replacement(self):
        self.run_case('rebind')

    def test_result_can_destroy_its_own_commands(self):
        self.run_case('reentrant')

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

    def test_disabled_printing_preview_basic_dialog_and_pdf_builds(self):
        for name, flags in [('no-print', ['-DENABLE_PRINTING=0', '-DENABLE_PRINT_PREVIEW=0']),
                            ('no-preview', ['-DENABLE_PRINT_PREVIEW=0']),
                            ('no-basic', ['-DENABLE_BASIC_PRINT_DIALOG=0']),
                            ('no-pdf', ['-DENABLE_PDF=0'])]:
            with self.subTest(name=name):
                self.run_case('buildflags', self.compile(name, flags))



class JoinedDispatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-f01-joined-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = pathlib.Path(cls.temp.name)
        prepare_headers(cls.root)
        (cls.root / 'main.cc').write_text(joined_source())
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        cls.binary = cls.root / 'joined'
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

    def test_two_panes_route_every_command_and_find_result_to_their_own_binding(self):
        self.run_case('panes')

    def test_captured_claim_generation_document_handler_and_strip_reject_stale_authority(self):
        self.run_case('stale')

    def test_contents_migration_resets_and_rebuilds_find_and_devtools_for_the_new_tab(self):
        self.run_case('migration')

    def test_find_results_travel_through_the_captured_page_request(self):
        self.run_case('envelope')

    def test_background_launch_refuses_native_ui_but_keeps_find(self):
        self.run_case('background')

    def test_unknown_page_commands_reject_with_stable_codes(self):
        self.run_case('unsupported')

    def test_reclaim_readopts_only_quarantined_devtools_of_a_current_claim(self):
        self.run_case('adopt')

    def test_reset_is_terminal_reentrant_and_deferred(self):
        self.run_case('reset')


class JoinedHostSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = HOST.read_text()

    def assertBefore(self, body, first, second):
        self.assertIn(first, body)
        self.assertIn(second, body)
        self.assertLess(body.index(first), body.index(second))

    def test_authority_is_reset_before_it_changes(self):
        host = self.host
        release = method(host, '  if (method == "tab.release") {')
        self.assertBefore(release, 'binding->ResetPageCommands();', 'DisposeTemporary(binding)')
        self.assertBefore(release, 'binding->ResetPageCommands();', 'binding->claim.clear();')
        self.assertBefore(method(host, '  void RetireRenderer()'), 'binding->ResetPageCommands();', 'binding->claim.clear();')
        self.assertBefore(method(host, 'void ShellHostView::CreateTab('), 'binding->ResetPageCommands();', 'binding->claim = claim;')
        self.assertBefore(method(host, 'void TabBinding::MoveTo('), 'ResetPageCommands();', 'owner_ = owner;')
        self.assertBefore(method(host, 'void TabBinding::Rebind('), 'ResetPageCommands();', 'Observe(contents);')
        self.assertBefore(method(host, 'TabBinding::~TabBinding('), 'ResetPageCommands();', 'RemoveViewports();')
        self.assertBefore(method(host, 'void TabBinding::WebContentsDestroyed('), 'ResetPageCommands();', 'contents_ = nullptr;')
        self.assertBefore(method(host, 'void ShellHostView::OnTabStripModelChanged('), 'binding->ResetPageCommands();', 'binding->Rebind(contents);')

    def test_dispatch_registration_launch_configuration_and_lifecycle(self):
        host = self.host
        command = method(host, 'void ShellHostView::TabCommand(')
        self.assertBefore(command, 'return PageCommand(binding, command, values, std::move(done));', 'content::WebContents* contents = binding->contents();')
        page = method(host, 'ardiacore::LinuxPageCommands* ShellHostView::EnsurePageCommands(')
        self.assertIn('!ardiacore::BackgroundInstance()', page)
        self.assertNotIn('getenv', page)
        self.assertIn('EnsurePageCommands(binding)', method(host, 'void ShellHostView::PageCommand('))
        self.assertBefore(method(host, 'void ShellHostView::CreateTab('), 'binding->claim = claim;', 'AdoptDevTools(binding);')
        self.assertBefore(method(host, 'void ShellHostView::OnTabStripModelChanged('), 'binding->ResetPageCommands();', 'LayoutPane(binding.get());')
        start = method(host, 'void StartLinuxHost()')
        self.assertIn('DevToolsWindow::RegisterLinuxDevToolsLifecycle();', start)
        self.assertIn('g_ardia_devtools_dock_changed = ', start)
        self.assertIn('found->second->OnDevToolsDockChanged(inspected, devtools);', start)
        emit = method(host, 'void ShellHostView::EmitPageCommandEvent(')
        self.assertIn('ardiacore::EmitLinuxPageEvent(request, "find"', emit)
        self.assertNotIn('SendEvent', emit)
        self.assertBefore(method(host, 'void ShellHostView::PageCommand('), 'binding->page_command_request = std::move(request);', 'commands->Dispatch(command, values)')
        layout = method(host, 'void ShellHostView::LayoutPane(')
        self.assertBefore(layout, 'DevToolsWindow::GetInTabWebContents(contents, &strategy)', 'ApplyDevToolsContentsResizingStrategy(')
        self.assertIn('strategy.hide_inspected_contents()', layout)
        self.assertIn('LayoutPane(binding);', method(host, 'void ShellHostView::SetViewport('))

    def test_gn_registers_helpers_and_minimal_authority_target(self):
        build = (SOURCE / 'ardia/linux/BUILD.gn').read_text()
        authority = method(build, 'source_set("devtools_authority")')
        self.assertEqual(re.findall(r'"(//[^"]+)"', authority), ['//base', '//content/public/browser'])
        linux = method(build, 'source_set("linux")')
        for source in ['ac_linux_find.cc', 'ac_linux_find.h', 'ac_linux_page_commands.cc', 'ac_linux_page_commands.h']:
            self.assertIn(f'"{source}"', linux)
        for label in [':devtools_authority', '//chrome/browser/devtools', '//components/find_in_page', '//components/web_modal',
                      '//chrome/browser/printing', '//chrome/browser/pdf', '//pdf:features', '//printing/buildflags']:
            self.assertIn(f'"{label}"', linux)
        self.assertNotIn('ac_linux_devtools_authority.cc', linux)

    def test_series_selects_devtools_authority_only_for_linux(self):
        import importlib.util
        import sys
        sys.path.insert(0, str(ROOT.parent / 'patches/build'))
        spec = importlib.util.spec_from_file_location('page_series', ROOT.parent / 'patches/series.py')
        series = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(series)
        name = 'chromium-linux-devtools-authority.patch'
        self.assertNotIn(name, [step.name for step in series.read_series('mac')])
        step = next(step for step in series.read_series('linux') if step.name == name)
        self.assertEqual(series.phase_of(step), 'chromium')
        self.assertEqual(set(step.paths()), {(f'chrome/browser/devtools/{path}', False) for path in
                                             ['BUILD.gn', 'devtools_window.h', 'devtools_window.cc', 'devtools_window_views.cc']})


if __name__ == '__main__':
    unittest.main()
