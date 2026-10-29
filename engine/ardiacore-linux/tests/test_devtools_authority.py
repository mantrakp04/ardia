import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

import test_page_commands as pages


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATCH = ROOT.parent / 'patches/chromium-linux-devtools-authority.patch'
PINNED = pathlib.Path(os.environ.get('ARDIA_F01_PINNED_SOURCE', '/tmp/ardia-f01-156'))
HASHES = {
    'BUILD.gn': 'a89ff36525038ac327d7dafe4cec60b1129debcd90bc995ba0fa35e70bd7cf45',
    'devtools_window.h': 'dd27c6895da41d0856345de92e0fc3cdaf0d177128c7abdc550dd5f6e1fb8843',
    'devtools_window.cc': '55d2fdbcd1036f3a0e59448bfde41526277d2fe518d1745d8398da6ef4df154d',
    'devtools_window_views.cc': 'a8d8b8f7d7db9f98c693f93da351d25222e3efa8a18cbeb5e80ffed06c5579f1',
}
METHODS = [
    'void DevToolsWindow::RegisterLinuxDevToolsLifecycle()',
    'void DevToolsWindow::BindLinuxDevToolsLease(',
    'void DevToolsWindow::RevokeLinuxDevToolsLease(',
    'void DevToolsWindow::SettleRevokedLinuxLoad()',
    'void DevToolsWindow::ToggleDevToolsWindow(\n    content::WebContents*',
    'void DevToolsWindow::ScheduleShow(',
    'void DevToolsWindow::Show(',
    'void DevToolsWindow::LoadCompleted()',
    'void DevToolsWindow::OnLoadCompleted()',
    'void DevToolsWindow::InspectedContentsClosing()',
    'void DevToolsWindow::SetLoadCompletedCallback(',
    'void DevToolsWindow::ActivateInspectedTab()',
    'void DevToolsWindow::ActivateWindow()',
    'void DevToolsWindow::ActivateContents(',
    'void DevToolsWindow::SetIsDocked(',
    'void DevToolsWindow::Close(',
    'void DevToolsWindow::CloseWindow()',
    'void DevToolsWindow::BeforeUnloadFired(',
    'DevToolsWindow* DevToolsWindow::AsDevToolsWindow(',
    'bool DevToolsWindow::HandleBeforeUnload(',
    'bool DevToolsWindow::InterceptPageBeforeUnload(',
    'bool DevToolsWindow::NeedsToInterceptBeforeUnload(',
    'void DevToolsWindow::OnPageCloseCanceled(',
    'content::WebContents* DevToolsWindow::GetInTabWebContents(',
]


def method(source, signature):
    start = source.index(signature)
    body = source.index('{', start)
    depth = 1
    end = body + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


MAIN = r'''
#include "chrome/browser/devtools/devtools_window.h"
#include "ardia/linux/ac_linux_page_commands.h"

struct Fixture {
  Profile profile;
  content::WebContents a{&profile}, b{&profile};
  BrowserWindowInterface browser{&profile, BrowserWindowInterface::TYPE_NORMAL, {{&a, &b}}};
  bool current = true;
  int presented = 0;
  std::unique_ptr<ardiacore::LinuxPageCommands> commands;
  Fixture(bool install = true) {
    if (install) DevToolsWindow::RegisterLinuxDevToolsLifecycle();
    else ardiacore::InstallLinuxDevToolsDispatcher(nullptr);
    GlobalBrowserCollection::GetInstance()->owners[&b] = &browser;
    commands = Make();
    b.delegate.on_cancel = [this] { DevToolsWindow::OnPageCloseCanceled(&b); };
  }
  ~Fixture() {
    commands.reset();
    DevtoolsUIController::on_update = nullptr;
    DevToolsWindow::on_create = nullptr;
    DevToolsWindow::on_toolbar = nullptr;
    DevToolsWindow::instances.clear();
    GlobalBrowserCollection::GetInstance()->owners.clear();
    base::SequencedTaskRunner::GetCurrentDefault()->Drain();
  }
  std::unique_ptr<ardiacore::LinuxPageCommands> Make() {
    return std::make_unique<ardiacore::LinuxPageCommands>(&b, &profile,
        [this]() -> BrowserWindowInterface* { return current ? &browser : nullptr; },
        [](base::DictValue) {}, true, [this] { presented++; });
  }
  void Open(std::string action = "") {
    base::ListValue args;
    if (!action.empty()) args.Append(action);
    assert(!commands->Dispatch("showDevTools", args));
  }
  DevToolsWindow* tools() { return DevToolsWindow::GetInstanceForInspectedWebContents(&b); }
  void Load(bool docked = true) {
    auto* window = tools();
    window->OnLoadCompleted();
    window->SetIsDocked(docked);
  }
  void Reset() { commands->Reset(); current = false; }
  void Drain() { base::SequencedTaskRunner::GetCurrentDefault()->Drain(); }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "unavailable") {
    Fixture f(false);
    auto error = f.commands->Dispatch("showDevTools", base::ListValue());
    assert(error && error->at("code").GetString() == "ERR_PAGE_UNAVAILABLE");
    assert(!f.tools());
  } else if (mode == "load") {
    Fixture f;
    f.Open();
    auto* window = f.tools();
    assert(window);
    f.Reset();
    auto lookups = GlobalBrowserCollection::GetInstance()->lookups;
    f.Load();
    f.Drain();
    assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    assert(f.browser.window.shows == 0 && f.b.focuses == 0 && f.presented == 0);
    assert(GlobalBrowserCollection::GetInstance()->lookups == lookups);
    assert(!DevToolsWindow::GetInTabWebContents(&f.b, nullptr));
    window->ActivateWindow();
    window->ActivateContents(window->main_web_contents_);
    assert(f.browser.window.activates == 0);
    assert(window->main_web_contents_->view.hides == 1);
    f.current = true;
    f.commands = f.Make();
    f.Open();
    f.Drain();
    assert(f.browser.window.shows == 1 && f.presented == 1);
  } else if (mode == "load-docking-first") {
    Fixture f;
    f.Open(); f.Reset();
    auto* window = f.tools();
    window->SetIsDocked(true);
    assert(window->life_stage_ == DevToolsWindow::kIsDockedSet);
    window->OnLoadCompleted();
    assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    assert(f.browser.window.shows == 0 && f.presented == 0);
    f.current = true; f.commands = f.Make(); f.Open(); f.Drain();
    assert(f.browser.window.shows == 1 && f.presented == 1);
  } else if (mode == "posted") {
    Fixture f;
    f.Open(); f.Load();
    assert(f.browser.window.shows == 1 && f.presented == 1);
    auto lookups = GlobalBrowserCollection::GetInstance()->lookups;
    f.Reset(); f.Drain();
    assert(GlobalBrowserCollection::GetInstance()->lookups == lookups);
    assert(f.browser.strip.activations == 0);
  } else if (mode == "move") {
    Fixture f;
    f.Open(); f.Load();
    BrowserWindowInterface other{&f.profile, BrowserWindowInterface::TYPE_NORMAL, {&f.b}};
    f.browser.strip.tabs = {&f.a};
    GlobalBrowserCollection::GetInstance()->owners[&f.b] = &other;
    auto lookups = GlobalBrowserCollection::GetInstance()->lookups;
    f.Drain();
    assert(GlobalBrowserCollection::GetInstance()->lookups == lookups);
    assert(other.strip.activations == 0);
  } else if (mode == "chrome-takeover") {
    Fixture f;
    f.Open();
    auto* window = f.tools();
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Reset();
    f.Load(); f.Drain();
    assert(f.browser.window.shows == 1 && f.presented == 0);
    assert(window->main_web_contents_->view.hides == 0);
    assert(f.browser.strip.activations == 1);
  } else if (mode == "ardia-takeover") {
    Fixture f;
    f.Open();
    auto old = std::move(f.commands);
    f.commands = f.Make();
    f.Open();
    old->Reset();
    f.Load(); f.Drain();
    assert(f.browser.window.shows == 1 && f.presented == 1);
    assert(f.tools()->main_web_contents_->view.hides == 0);
  } else if (mode == "preexisting") {
    Fixture f;
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(); f.Drain();
    auto* window = f.tools();
    auto shows = f.browser.window.shows;
    f.Open("console");
    f.Reset();
    assert(window->main_web_contents_->view.hides == 0);
    assert(DevToolsWindow::GetInTabWebContents(&f.b, nullptr));
    assert(f.browser.window.shows == shows + 1);
    assert(window->main_web_contents_->beforeunloads == 0);
  } else if (mode == "undocked") {
    Fixture f;
    f.b.can_dock = false;
    f.Open();
    auto* window = f.tools();
    assert(window->undocked_browser_.window.shows == 1);
    f.Reset();
    f.Load(false); f.Drain();
    assert(window->undocked_browser_.window.shows == 1);
    assert(window->undocked_browser_.window.hides == 1);
    assert(window->main_web_contents_->beforeunloads == 0);
    f.current = true; f.commands = f.Make(); f.Open("toggle");
    assert(window->undocked_browser_.window.shows == 2);
  } else if (mode == "close-overlap") {
    Fixture f;
    f.Open(); f.Load(); f.Drain();
    auto* window = f.tools();
    f.Open("toggle");
    assert(window->main_web_contents_->beforeunloads == 1);
    auto old = std::move(f.commands);
    f.commands = f.Make(); f.Open(); f.Open("toggle");
    assert(window->main_web_contents_->beforeunloads == 1);
    old->Reset();
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(!proceed && window->bindings_->detached == 0);
    f.Drain();
    assert(window->main_web_contents_->beforeunloads == 2);
    window->BeforeUnloadFired(window->main_web_contents_, false, &proceed);
    assert(!proceed && window->bindings_->detached == 0);
    assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    f.Open("toggle");
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(proceed && window->bindings_->detached == 1);
  } else if (mode == "toggle-after-quarantine") {
    Fixture f;
    f.Open(); f.Load(); f.Drain();
    auto* window = f.tools();
    auto frontend = window->main_web_contents_->GetWeakPtr();
    frontend->controller.entry.url = "console://state";
    f.Reset();
    assert(frontend->view.hides == 1 && !frontend->view.IsVisible());
    assert(!DevToolsWindow::GetInTabWebContents(&f.b, nullptr));
    f.current = true; f.commands = f.Make();
    f.Open("toggle");
    assert(frontend->beforeunloads == 0 && window->life_stage_ == DevToolsWindow::kLoadCompleted);
    assert(window->linux_devtools_state_.IsCurrent() && frontend->view.IsVisible());
    assert(DevToolsWindow::GetInTabWebContents(&f.b, nullptr) == frontend.get());
    f.Drain();
    assert(f.presented == 2);
    f.Open("toggle");
    assert(frontend->beforeunloads == 1);
    assert(frontend && frontend->controller.entry.url == "console://state");
    Fixture g;
    DevToolsWindow::OpenDevToolsWindow(&g.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    g.Load(); g.Drain();
    g.Reset();
    g.current = true; g.commands = g.Make();
    g.Open("toggle");
    assert(g.tools()->main_web_contents_->beforeunloads == 1);
  } else if (mode == "adopt") {
    Fixture f;
    f.b.can_dock = false;
    f.Open(); f.Load(false); f.Drain();
    auto* window = f.tools();
    auto frontend = window->main_web_contents_->GetWeakPtr();
    const int focuses = frontend->focuses;
    f.Reset();
    assert(window->undocked_browser_.window.hides == 1 && !frontend->view.IsVisible());
    f.current = true; f.commands = f.Make();
    assert(f.commands->AdoptDevTools());
    assert(window->undocked_browser_.window.inactive_shows == 1);
    assert(window->undocked_browser_.window.activates == 0 && frontend->focuses == focuses);
    assert(window->linux_devtools_state_.IsCurrent() && frontend->view.IsVisible());
    assert(frontend->beforeunloads == 0);
    assert(!f.commands->AdoptDevTools());
    Fixture g;
    g.Open(); g.Load(); g.Drain();
    int updates = 0;
    const int activations = g.browser.strip.activations;
    const int activates = g.browser.window.activates;
    DevtoolsUIController::on_update = [&updates] { updates++; };
    g.Reset();
    g.current = true; g.commands = g.Make();
    assert(g.commands->AdoptDevTools());
    assert(updates == 1 && DevToolsWindow::GetInTabWebContents(&g.b, nullptr));
    g.Drain();
    assert(g.browser.window.activates == activates && g.browser.strip.activations == activations);
    DevtoolsUIController::on_update = nullptr;
    Fixture h;
    assert(!h.commands->AdoptDevTools());
    DevToolsWindow::OpenDevToolsWindow(&h.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    h.Load(); h.Drain();
    h.Reset();
    h.current = true; h.commands = h.Make();
    assert(!h.commands->AdoptDevTools());
    assert(h.tools()->main_web_contents_->view.hides == 0);
  } else if (mode == "close-reshow-page-close") {
    Fixture f;
    f.Open(); f.Load(); f.Drain(); f.Open("toggle");
    auto* window = f.tools();
    assert(window->life_stage_ == DevToolsWindow::kClosing);
    f.Open();
    assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(!proceed && f.b.delegate.cancellations == 0 && f.b.beforeunloads == 1);
    assert(window->bindings_->detached == 0 && !window->linux_devtools_state_.has_pending_close());
    window->InspectedContentsClosing();
    assert(!f.tools());
    Fixture g;
    g.Open(); g.Load(); g.Drain(); g.Open("toggle");
    auto* vetoed = g.tools();
    g.Open();
    assert(DevToolsWindow::InterceptPageBeforeUnload(&g.b));
    vetoed->BeforeUnloadFired(vetoed->main_web_contents_, false, &proceed);
    assert(!proceed && g.b.delegate.cancellations == 1 && g.b.beforeunloads == 0);
    assert(vetoed->bindings_->detached == 0 && vetoed->life_stage_ == DevToolsWindow::kLoadCompleted);
  } else if (mode == "chrome-load-callback") {
    int chrome = 0;
    {
      Fixture f;
      f.Open();
      f.tools()->SetLoadCompletedCallback([&chrome] { chrome++; });
      f.Load(); f.Drain();
      assert(chrome == 1 && f.presented == 1);
    }
    {
      Fixture f;
      DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
      f.tools()->SetLoadCompletedCallback([&chrome] { chrome++; });
      f.Open();
      f.Load(); f.Drain();
      assert(chrome == 2 && f.presented == 1);
    }
    {
      Fixture f;
      f.Open();
      f.tools()->SetLoadCompletedCallback([&chrome] { chrome++; });
      f.Reset();
      f.Load(); f.Drain();
      assert(chrome == 3 && f.presented == 0);
    }
  } else if (mode == "reentrant") {
    Fixture f;
    f.Open();
    DevtoolsUIController::on_update = [&f] { f.Reset(); };
    f.Load(); f.Drain();
    assert(f.browser.window.shows == 0 && f.presented == 0);
    assert(f.tools()->main_web_contents_->focuses == 0);
  } else if (mode == "destroy") {
    Fixture f;
    f.Open(); f.Load();
    DevToolsWindow::instances.clear();
    f.Reset(); f.Drain();
    assert(f.browser.strip.activations == 0);
    f.current = true; f.commands = f.Make(); f.Open();
    f.b.Destroy();
    assert(!f.tools()->linux_devtools_state_.IsCurrent());
    f.Load();
    f.tools()->InspectedContentsClosing();
    assert(!f.tools());
    f.Drain();
  } else if (mode == "callback-destroy") {
    Fixture f;
    f.Open(); f.Load(); f.Drain();
    auto old = std::move(f.commands);
    f.commands = std::make_unique<ardiacore::LinuxPageCommands>(&f.b, &f.profile,
        [&f] { return &f.browser; }, [](base::DictValue) {}, true,
        [&f] { f.commands.reset(); });
    auto error = f.commands->Dispatch("showDevTools", base::ListValue());
    assert(error && error->at("code").GetString() == "ERR_PAGE_STALE_TARGET");
    assert(!f.commands);
    old->Reset(); f.Drain();
  } else if (mode == "hide-destroy") {
    Fixture f;
    f.Open(); f.Load();
    f.tools()->main_web_contents_->view.on_hide = [] { DevToolsWindow::instances.clear(); };
    f.Reset(); f.Drain();
    assert(!f.tools());
  } else if (mode == "show-destroy") {
    Fixture f;
    f.Open();
    DevtoolsUIController::on_update = [] { DevToolsWindow::instances.clear(); };
    f.Load(); f.Drain();
    assert(!f.tools() && f.presented == 0);
    DevtoolsUIController::on_update = nullptr;
    Fixture g;
    DevToolsWindow::on_toolbar = [] { DevToolsWindow::instances.clear(); };
    auto error = g.commands->Dispatch("showDevTools", base::ListValue());
    assert(error && error->at("code").GetString() == "ERR_PAGE_DISPATCH");
    assert(!g.tools());
  } else if (mode == "chrome-close") {
    Fixture f;
    f.Open(); f.Load(); f.Drain(); f.Open("toggle");
    auto* window = f.tools();
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    window->CloseWindow();
    f.Reset();
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(!proceed && window->bindings_->detached == 0);
    f.Drain();
    assert(window->main_web_contents_->beforeunloads == 2);
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(proceed && window->bindings_->detached == 1);
    assert(window->main_web_contents_->view.hides == 0);
  } else if (mode == "unhosted") {
    Fixture f;
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(); f.Drain();
    auto* window = f.tools();
    assert(!window->linux_devtools_state_.managed());
    f.Reset();
    assert(window->main_web_contents_->view.hides == 0);
    window->CloseWindow();
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, false, &proceed);
    assert(!proceed && window->life_stage_ == DevToolsWindow::kClosing);
  } else if (mode == "scope") {
    Fixture f;
    auto lease = std::make_shared<ardiacore::LinuxDevToolsLease>(&f.b, [] { return true; });
    {
      ardiacore::ScopedLinuxDevToolsOperation scope(&f.b, lease);
      assert(!ardiacore::ScopedLinuxDevToolsOperation::Capture(&f.a));
      assert(ardiacore::ScopedLinuxDevToolsOperation::Capture(&f.b) == lease);
      assert(!ardiacore::ScopedLinuxDevToolsOperation::Capture(&f.b));
    }
    DevToolsWindow::on_create = [](DevToolsWindow* window) { window->BindLinuxDevToolsLease(nullptr, false); };
    auto error = f.commands->Dispatch("showDevTools", base::ListValue());
    assert(error && error->at("code").GetString() == "ERR_PAGE_DISPATCH");
    f.Reset(); f.Load(); f.Drain();
    assert(f.tools()->main_web_contents_->view.hides == 0 && f.presented == 0);
  } else if (mode.starts_with("page-veto") || mode.starts_with("unhosted-page-veto")) {
    Fixture f;
    const bool undocked = mode.ends_with("-undocked");
    f.b.can_dock = !undocked;
    if (mode.starts_with("page-veto")) f.Open();
    else DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(!undocked); f.Drain();
    auto* window = f.tools();
    assert(!window->linux_devtools_state_.has_pending_close());
    assert(DevToolsWindow::NeedsToInterceptBeforeUnload(&f.b));
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    assert(!DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    bool proceed = true;
    auto reply = [&](bool allow) {
      if (undocked) assert(DevToolsWindow::HandleBeforeUnload(window->main_web_contents_, allow, &proceed));
      else window->BeforeUnloadFired(window->main_web_contents_, allow, &proceed);
    };
    reply(false);
    assert(!proceed && f.b.delegate.cancellations == 1);
    assert(!window->intercepted_page_beforeunload_);
    assert(DevToolsWindow::NeedsToInterceptBeforeUnload(&f.b));
    assert(window->bindings_->detached == 0 && f.b.beforeunloads == 0);
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    reply(true);
    assert(!proceed && f.b.beforeunloads == 1);
    assert(window->intercepted_page_beforeunload_ && window->bindings_->detached == 0);
    f.b.delegate.BeforeUnloadFired(&f.b, false, &proceed);
    assert(!window->intercepted_page_beforeunload_ && f.b.delegate.cancellations == 2);
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    reply(true);
    assert(!proceed && f.b.beforeunloads == 2);
    window->InspectedContentsClosing();
    assert(!f.tools());
  } else if (mode.starts_with("page-overlap")) {
    Fixture f;
    f.Open(); f.Load(); f.Drain(); f.Open("toggle");
    auto* window = f.tools();
    auto old = std::move(f.commands);
    if (mode.find("chrome") != std::string::npos) {
      DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
      f.commands = f.Make();
    } else {
      f.commands = f.Make(); f.Open();
    }
    old->Reset();
    const bool retry = mode.find("retry") != std::string::npos;
    if (retry) window->CloseWindow();
    auto frontend = window->main_web_contents_->GetWeakPtr();
    frontend->controller.entry.url = "unsaved://latest-owner";
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    assert(!DevToolsWindow::NeedsToInterceptBeforeUnload(&f.b));
    bool proceed = true;
    const bool allow = mode.find("allow") != std::string::npos;
    window->BeforeUnloadFired(frontend.get(), allow, &proceed);
    assert(!proceed && f.b.delegate.cancellations == (allow ? 0 : 1));
    assert(f.b.beforeunloads == (allow ? 1 : 0));
    assert(window->intercepted_page_beforeunload_ == allow);
    if (allow) f.b.delegate.BeforeUnloadFired(&f.b, false, &proceed);
    assert(!window->intercepted_page_beforeunload_ && f.b.delegate.cancellations == 1);
    assert(!window->linux_devtools_state_.has_pending_close());
    assert(DevToolsWindow::NeedsToInterceptBeforeUnload(&f.b));
    f.Drain();
    assert(frontend && window->main_web_contents_.get() == frontend.get());
    assert(frontend->controller.entry.url == "unsaved://latest-owner");
    assert(window->bindings_->detached == 0 && frontend->view.hides == 0);
    if (retry) {
      assert(window->linux_devtools_state_.has_pending_close());
      assert(frontend->beforeunloads == 3);
      window->BeforeUnloadFired(frontend.get(), false, &proceed);
      assert(!proceed && !window->linux_devtools_state_.has_pending_close());
      assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    }
    window->CloseWindow();
    window->BeforeUnloadFired(frontend.get(), true, &proceed);
    assert(proceed && window->bindings_->detached == 1);
    assert(frontend && frontend->controller.entry.url == "unsaved://latest-owner");
  } else if (mode == "page-cancel-new-owner") {
    Fixture f;
    f.Open(); f.Load(); f.Drain(); f.Open("toggle");
    auto* window = f.tools();
    auto first = std::move(f.commands);
    f.commands = f.Make(); f.Open(); window->CloseWindow();
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    auto frontend = window->main_web_contents_->GetWeakPtr();
    f.b.delegate.on_cancel = [&f, window] {
      DevToolsWindow::OnPageCloseCanceled(&f.b);
      auto previous = std::move(f.commands);
      f.commands = f.Make(); f.Open();
      previous->Reset();
      window->main_web_contents_->controller.entry.url = "unsaved://reentrant-owner";
      window->CloseWindow();
    };
    bool proceed = true;
    window->BeforeUnloadFired(frontend.get(), false, &proceed);
    assert(!proceed && f.b.delegate.cancellations == 1);
    assert(!window->intercepted_page_beforeunload_ && f.b.beforeunloads == 0);
    assert(window->linux_devtools_state_.has_pending_close());
    first->Reset(); f.Drain();
    assert(frontend->beforeunloads == 3);
    assert(frontend->controller.entry.url == "unsaved://reentrant-owner");
    window->BeforeUnloadFired(frontend.get(), true, &proceed);
    assert(proceed && window->bindings_->detached == 1);
  } else if (mode == "page-cancel-destroy" || mode == "page-cancel-destroy-page") {
    Fixture f;
    f.Open(); f.Load(); f.Drain();
    auto* window = f.tools();
    assert(DevToolsWindow::InterceptPageBeforeUnload(&f.b));
    f.b.delegate.on_cancel = [&f, &mode] {
      DevToolsWindow::OnPageCloseCanceled(&f.b);
      if (mode == "page-cancel-destroy-page") f.b.Destroy();
      f.commands.reset();
      DevToolsWindow::instances.clear();
    };
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, false, &proceed);
    assert(!proceed && f.b.delegate.cancellations == 1 && !f.tools());
    f.Drain();
  } else if (mode == "preexisting-close-reset" || mode == "preexisting-dock-reset" || mode == "preexisting-close-pending-reset") {
    Fixture f;
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(); f.Drain();
    f.Open("console");
    auto* window = f.tools();
    const auto ticket = window->linux_devtools_state_.Capture();
    if (mode == "preexisting-close-pending-reset") f.Open("toggle");
    f.Reset();
    assert(!window->linux_devtools_state_.OwnsFrontend(ticket.epoch));
    assert(window->main_web_contents_->view.hides == 0);
    if (mode == "preexisting-dock-reset") {
      window->SetIsDocked(false);
      assert(!window->is_docked_);
      assert(!window->linux_devtools_state_.IsCurrent(ticket));
      auto activations = f.browser.strip.activations;
      f.Drain();
      assert(f.browser.strip.activations == activations);
    } else {
      window->CloseWindow();
      bool proceed = true;
      if (mode == "preexisting-close-pending-reset") {
        window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
        assert(!proceed && window->bindings_->detached == 0);
        f.Drain();
        assert(window->main_web_contents_->beforeunloads == 2);
      }
      window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
      assert(proceed && window->bindings_->detached == 1);
      assert(!window->linux_devtools_state_.IsCurrent(ticket));
    }
  } else if (mode == "chrome-pending-ardia-show" || mode == "chrome-pending-ardia-close") {
    Fixture f;
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(); f.Drain();
    auto* window = f.tools();
    window->CloseWindow();
    f.Open();
    assert(window->life_stage_ == DevToolsWindow::kLoadCompleted);
    if (mode == "chrome-pending-ardia-close") f.Open("toggle");
    bool proceed = true;
    window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
    assert(!proceed && window->bindings_->detached == 0);
    f.Drain();
    if (mode == "chrome-pending-ardia-close") {
      assert(window->main_web_contents_->beforeunloads == 2);
      window->BeforeUnloadFired(window->main_web_contents_, true, &proceed);
      assert(proceed && window->bindings_->detached == 1);
    }
  } else if (mode == "dock-update-destroy" || mode == "dock-update-takeover") {
    Fixture f;
    DevToolsWindow::OpenDevToolsWindow(&f.b, DevToolsToggleAction::Show(), DevToolsOpenedByAction::kUnknown);
    f.Load(); f.Drain(); f.Open("console"); f.Reset();
    auto* window = f.tools();
    const auto original = window->linux_devtools_state_.Capture();
    auto shows = f.browser.window.shows;
    bool updated = false;
    DevtoolsUIController::on_update = [&] {
      if (updated) return;
      updated = true;
      if (mode == "dock-update-destroy") DevToolsWindow::instances.clear();
      else {
        f.current = true; f.commands = f.Make();
        window->BindLinuxDevToolsLease(std::make_shared<ardiacore::LinuxDevToolsLease>(
            &f.b, [&] { return f.current; }), false);
      }
    };
    window->SetIsDocked(false);
    assert(updated);
    if (mode == "dock-update-destroy") assert(!f.tools());
    else {
      assert(f.browser.window.shows == shows);
      assert(!window->linux_devtools_state_.IsCurrent(original));
    }
    f.Drain();
  } else assert(false);
}
'''


class DevToolsAuthorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (PINNED / 'chrome/browser/devtools/devtools_window.cc').is_file():
            raise unittest.SkipTest('Set ARDIA_F01_PINNED_SOURCE to the small pinned 156 source excerpts')
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-f01-lifecycle-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = pathlib.Path(cls.temp.name)
        for name in HASHES:
            path = pathlib.Path('chrome/browser/devtools') / name
            (cls.root / path).parent.mkdir(parents=True, exist_ok=True)
            if hashlib.sha256((PINNED / path).read_bytes()).hexdigest() != HASHES[name]:
                raise AssertionError(f'Expected unmodified pinned Chromium 156 source: {path}')
            shutil.copyfile(PINNED / path, cls.root / path)
        checked = subprocess.run(['git', 'apply', '--check', str(PATCH)], cwd=cls.root,
                                 capture_output=True, text=True, timeout=20)
        if checked.returncode:
            raise AssertionError(checked.stdout + checked.stderr)
        result = subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(PATCH)],
                                cwd=cls.root, capture_output=True, text=True, timeout=20)
        if result.returncode or 'fuzz' in result.stdout or 'offset' in result.stdout:
            raise AssertionError(result.stdout + result.stderr)
        cls.patched = (cls.root / 'chrome/browser/devtools/devtools_window.cc').read_text()
        cls.header = (cls.root / 'chrome/browser/devtools/devtools_window.h').read_text()
        cls.patch_output = result.stdout
        cls.prepare_fixture()
        cls.binary = cls.root / 'lifecycle'
        compiler = shutil.which('clang++') or shutil.which('g++')
        result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                 '-Wno-missing-field-initializers', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                                 '-I', str(cls.root), '-I', str(pages.SOURCE), *map(str, pages.PRODUCTION),
                                 str(cls.root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def prepare_fixture(cls):
        fixture = pages.FIXTURE.read_text()
        fixture = fixture.replace('#define BUILDFLAG(flag) flag', '#define BUILDFLAG(flag) flag\n#define IS_LINUX 1\n#define IS_MAC 0\n#define IS_ANDROID 0\n#define FROM_HERE 0\n#define DCHECK(x) assert(x)\n#define CHECK_NE(a,b) assert((a)!=(b))')
        fixture = fixture.replace('namespace content {\nclass WebContents;', '''namespace content {
struct DevToolsManagerDelegate { struct DevToolsOptions { std::optional<std::string> panel_id; }; };
struct ChildProcessHost { static constexpr int kInvalidUniqueID = -1; };
class WebContents;''')
        fixture = fixture.replace('class WebContents {\n public:', '''struct FixtureRenderView { void Hide() { hides++; visible = false; auto callback = on_hide; if (callback) callback(); } void Show() { shows++; visible = true; } bool IsVisible() const { return visible; } int hides = 0; int shows = 0; bool visible = true; std::function<void()> on_hide; };
struct FixtureDelegate {
  void ActivateContents(WebContents*) {}
  void BeforeUnloadFired(WebContents*, bool proceed, bool* fire_unload) {
    assert(!proceed);
    cancellations++;
    *fire_unload = false;
    auto callback = on_cancel;
    if (callback) callback();
  }
  int cancellations = 0;
  std::function<void()> on_cancel;
};
class WebContents {
 public:
  FixtureRenderView* GetRenderWidgetHostView() { return &view; }
  FixtureRenderView* GetNativeView() { return &view; }
  FixtureDelegate* GetDelegate() { return &delegate; }
  void SetDelegate(void*) {}
  void SetIgnoreZoomGestures(bool) {}
  void SetInitialFocus() { focuses++; }
  void ClosePage() { close_pages++; auto callback = on_close; if (callback) callback(); }
  int close_pages = 0;
  std::function<void()> on_close;
  void Focus() { focuses++; }
  FixtureRenderView view;
  FixtureDelegate delegate;
  int focuses = 0;
  bool can_dock = true;''')
        fixture = fixture.replace('  std::vector<content::WebContents*> tabs;', '''  content::WebContents* GetActiveWebContents() { return tabs.empty() ? nullptr : tabs.front(); }
  template <typename T> void ActivateTabAt(int index, const T&) { activations++; std::swap(tabs[0], tabs[index]); }
  std::unique_ptr<content::WebContents> DetachWebContentsAtForInsertion(int) { return std::make_unique<content::WebContents>(); }
  int activations = 0;
  std::vector<content::WebContents*> tabs;''')
        fixture = fixture.replace('class TabStripModel {\n public:', 'class TabStripModel {\n public:\n  TabStripModel(std::initializer_list<content::WebContents*> initial = {}) : tabs(initial) {}')
        fixture = fixture.replace('class BrowserWindowInterface {', '''namespace ui { struct BaseWindow {
  void Show() { shows++; }
  void ShowInactive() { inactive_shows++; }
  void Hide() { hides++; }
  void Activate() { activates++; }
  void Close() { closes++; }
  bool IsActive() { return false; }
  int shows = 0, inactive_shows = 0, hides = 0, activates = 0, closes = 0;
}; }
class BrowserWindowInterface {''')
        fixture = fixture.replace('  Profile* profile;\n  Type type', '  ui::BaseWindow* GetWindow() { return &window; }\n  Profile* profile;\n  Type type')
        fixture = fixture.replace('  TabStripModel strip;', '  TabStripModel strip;\n  ui::BaseWindow window;')
        fixture = fixture.replace('enum Type { kShow, kInspect, kConsole };', 'enum Type { kShow, kInspect, kConsole, kShowElementsPanel, kShowConsolePanel = kConsole, kPauseInDebugger = 4, kToggle, kReveal, kNoOp };')
        fixture = fixture.replace('  Type type;\n};', '  static DevToolsToggleAction NoOp() { return {kNoOp}; }\n  Type type() const { return type_; }\n  Type type_;\n};')
        fixture = fixture.replace('window->action = action.type;', 'window->action = action.type();')
        fixture = fixture.replace('enum class DevToolsOpenedByAction { kMainMenuOrMainShortcut };', 'enum class DevToolsOpenedByAction { kUnknown, kMainMenuOrMainShortcut, kToggleShortcut, kPinnedToolbarButton };')
        (cls.root / 'page_commands_fixture.h').write_text(fixture)
        (cls.root / 'native_common.h').write_text('#pragma once\n#define DevToolsWindow LegacyDevToolsWindow\n#include "page_commands_fixture.h"\n#undef DevToolsWindow\n')
        headers = set()
        for source in pages.PRODUCTION + list((pages.SOURCE / 'ardia/linux').glob('ac_linux_*commands.h')) + [pages.SOURCE / 'ardia/linux/ac_linux_find.h', pages.SOURCE / 'ardia/linux/ac_linux_devtools_authority.h']:
            headers.update(re.findall(r'^#include "([^"]+)"', source.read_text(), re.M))
        for header in headers:
            if header.startswith('ardia/linux/'):
                continue
            path = cls.root / header
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('#include "native_common.h"\n')
        declarations = (ROOT / 'tests/fixtures/devtools_lifecycle.h').read_text()
        bodies = '\n'.join('inline ' + method(cls.patched, signature) for signature in METHODS)
        views = (cls.root / 'chrome/browser/devtools/devtools_window_views.cc').read_text()
        bodies += '\ninline ' + method(views, 'void DevToolsWindow::UpdateBrowserWindow()')
        (cls.root / 'native_devtools.h').write_text(declarations + '\n' + bodies + '\n')
        (cls.root / 'chrome/browser/devtools/devtools_window.h').write_text('#include "native_common.h"\n#include "native_devtools.h"\n')
        (cls.root / 'main.cc').write_text(MAIN)

    def run_case(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=20,
                                env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_dispatch_pointer_required_before_open(self): self.run_case('unavailable')
    def test_revoked_load_completes_bookkeeping_without_show_and_can_be_adopted(self):
        self.run_case('load')
        self.run_case('load-docking-first')
    def test_posted_activation_checks_lease_before_browser_lookup(self): self.run_case('posted')
    def test_moved_contents_cannot_activate_todays_browser(self): self.run_case('move')
    def test_deliberate_chrome_takeover_survives_old_revocation(self): self.run_case('chrome-takeover')
    def test_new_ardia_takeover_survives_old_revocation(self): self.run_case('ardia-takeover')
    def test_preexisting_chrome_frontend_never_becomes_owned_or_hidden(self): self.run_case('preexisting')
    def test_preexisting_frontend_accepts_fresh_close_after_reset(self): self.run_case('preexisting-close-reset')
    def test_preexisting_frontend_accepts_fresh_docking_without_old_posted_activation(self): self.run_case('preexisting-dock-reset')
    def test_preexisting_frontend_rejects_old_close_then_retries_fresh_close(self): self.run_case('preexisting-close-pending-reset')
    def test_unmanaged_pending_close_cannot_complete_after_ardia_takeover(self): self.run_case('chrome-pending-ardia-show')
    def test_unmanaged_pending_close_preserves_new_ardia_close_retry(self): self.run_case('chrome-pending-ardia-close')
    def test_actual_docking_update_can_destroy_frontend(self): self.run_case('dock-update-destroy')
    def test_actual_docking_update_cannot_continue_after_owner_takeover(self): self.run_case('dock-update-takeover')
    def test_undocked_quarantine_reveal_and_no_automatic_close(self): self.run_case('undocked')
    def test_old_close_cannot_cancel_or_destroy_new_close_and_veto_preserves_edits(self): self.run_case('close-overlap')
    def test_native_update_reentrancy_revokes_remaining_show_and_focus(self): self.run_case('reentrant')
    def test_toggle_readopts_a_quarantined_frontend_instead_of_closing_it(self): self.run_case('toggle-after-quarantine')
    def test_reclaim_readopts_quarantined_frontends_without_focus(self): self.run_case('adopt')
    def test_stale_close_reply_cannot_veto_an_inspected_page_close(self): self.run_case('close-reshow-page-close')
    def test_chrome_load_completed_callback_is_preserved(self): self.run_case('chrome-load-callback')
    def test_frontend_and_helper_and_contents_destruction_cancel_callbacks(self): self.run_case('destroy')
    def test_scope_consumption_and_reentrant_creation_takeover(self): self.run_case('scope')
    def test_presentation_callback_can_destroy_its_helper(self): self.run_case('callback-destroy')
    def test_quarantine_hide_can_destroy_its_frontend(self): self.run_case('hide-destroy')
    def test_native_show_update_can_destroy_its_frontend(self): self.run_case('show-destroy')
    def test_new_chrome_close_survives_stale_ardia_close_and_reset(self): self.run_case('chrome-close')
    def test_unhosted_chrome_lifecycle_and_veto_behavior_stay_default(self): self.run_case('unhosted')

    def test_managed_page_veto_and_page_body_veto_preserve_chrome_cleanup_and_retry(self):
        self.run_case('page-veto')
        self.run_case('page-veto-undocked')

    def test_unhosted_page_veto_remains_the_control(self):
        self.run_case('unhosted-page-veto')
        self.run_case('unhosted-page-veto-undocked')

    def test_stale_frontend_close_settles_overlapping_page_close_after_ardia_or_chrome_takeover(self):
        for owner in ['ardia', 'chrome']:
            for response in ['allow', 'veto']:
                with self.subTest(owner=owner, response=response):
                    self.run_case(f'page-overlap-{owner}-{response}')

    def test_page_cancellation_retains_newer_frontend_close_retry_and_latest_edits(self):
        self.run_case('page-overlap-ardia-allow-retry')
        self.run_case('page-overlap-chrome-veto-retry')

    def test_page_cancellation_callback_can_replace_owner_and_start_a_new_close(self):
        self.run_case('page-cancel-new-owner')

    def test_page_cancellation_callback_can_destroy_helper_frontend_and_inspected_contents(self):
        self.run_case('page-cancel-destroy')
        self.run_case('page-cancel-destroy-page')

    def test_zero_fuzz_patch_and_guard_placement(self):
        self.assertEqual(self.patch_output.count('patching file'), 4)
        load = method(self.patched, 'void DevToolsWindow::LoadCompleted()')
        self.assertLess(load.index('IsCurrent()'), load.index('Show(action_on_load_)'))
        show = method(self.patched, 'void DevToolsWindow::Show(')
        posted = show[show.index('base::SequencedTaskRunner'):]
        self.assertLess(posted.index('IsCurrent(ticket)'), posted.index('window->ActivateInspectedTab()'))
        self.assertIn('IS_LINUX', self.header)
        build = (self.root / 'chrome/browser/devtools/BUILD.gn').read_text()
        linux_build = '\n  if (is_linux) {\n    public_deps += [ "//ardia/linux:devtools_authority" ]\n    deps += [ "//ui/aura" ]\n  }\n'
        self.assertEqual(build.count(linux_build), 1)
        self.assertEqual(build.replace(linux_build, ''), (PINNED / 'chrome/browser/devtools/BUILD.gn').read_text())
        for name in HASHES:
            if name == 'BUILD.gn': continue
            original = (PINNED / 'chrome/browser/devtools' / name).read_text()
            if name == 'devtools_window.h': patched = self.header
            elif name == 'devtools_window.cc': patched = self.patched
            else: patched = (self.root / 'chrome/browser/devtools' / name).read_text()
            self.assertEqual(non_linux_projection(patched), non_linux_projection(original))


def non_linux_projection(source):
    output = []
    stack = []
    for line in source.splitlines():
        directive = line.strip()
        if directive == '#if BUILDFLAG(IS_LINUX)':
            stack.append(['linux', False])
        elif re.match(r'#if(?:def|ndef)?\b', directive):
            stack.append(['other', True])
            if all(enabled for _, enabled in stack): output.append(line)
        elif directive.startswith('#else'):
            if stack[-1][0] == 'linux': stack[-1][1] = not stack[-1][1]
            elif all(enabled for _, enabled in stack): output.append(line)
        elif directive.startswith('#endif'):
            kind, enabled = stack.pop()
            if kind == 'other' and enabled and all(active for _, active in stack): output.append(line)
        elif all(enabled for _, enabled in stack): output.append(line)
    return re.sub(r'\s+', ' ', '\n'.join(output)).strip()


if __name__ == '__main__':
    unittest.main()
