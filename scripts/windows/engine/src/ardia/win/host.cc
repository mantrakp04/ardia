#include "ardia/win/host.h"

#include <commctrl.h>

#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "ardia/win/main.h"
#include "ardia/win/profiles.h"
#include "ardia/win/tab_state.h"
#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/tabs/public/tab_interface.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/base/base_window.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/events/event.h"
#include "ui/events/types/event_type.h"
#include "url/gurl.h"

namespace ardia_win {

namespace {

constexpr wchar_t kParkingClass[] = L"ArdiaParkedPages";
constexpr char kOfferedPrefix[] = "ardiacore:";
constexpr UINT_PTR kParentSubclass = 0xA2D1A;

base::DictValue Ok() {
  base::DictValue result;
  result.Set("ok", true);
  return result;
}

HWND WindowOf(BrowserWindowInterface* browser) {
  ui::BaseWindow* window = browser->GetWindow();
  if (!window) {
    return nullptr;
  }
  gfx::NativeWindow native = window->GetNativeWindow();
  if (!native || !native->GetHost()) {
    return nullptr;
  }
  return native->GetHost()->GetAcceleratedWidget();
}

void MakeChild(HWND window, HWND parent) {
  LONG_PTR style = ::GetWindowLongPtrW(window, GWL_STYLE);
  style &= ~static_cast<LONG_PTR>(WS_POPUP | WS_CAPTION | WS_THICKFRAME |
                                  WS_SYSMENU | WS_MINIMIZEBOX |
                                  WS_MAXIMIZEBOX | WS_VISIBLE);
  style |= WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
  ::SetWindowLongPtrW(window, GWL_STYLE, style);
  LONG_PTR extended = ::GetWindowLongPtrW(window, GWL_EXSTYLE);
  extended &= ~static_cast<LONG_PTR>(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE |
                                     WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE |
                                     WS_EX_STATICEDGE);
  ::SetWindowLongPtrW(window, GWL_EXSTYLE, extended);
  ::SetParent(window, parent);
  ::SetWindowPos(window, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                     SWP_FRAMECHANGED);
}

LRESULT CALLBACK ParentProcedure(HWND window,
                                 UINT message,
                                 WPARAM w_param,
                                 LPARAM l_param,
                                 UINT_PTR id,
                                 DWORD_PTR data) {
  if (message == WM_DESTROY) {
    Host::Get()->ParentDestroying(window);
  }
  if (message == WM_NCDESTROY) {
    ::RemoveWindowSubclass(window, &ParentProcedure, id);
  }
  return ::DefSubclassProc(window, message, w_param, l_param);
}

HWND CreateParkingWindow() {
  HINSTANCE instance = ::GetModuleHandleW(nullptr);
  WNDCLASSEXW window_class = {};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = &::DefWindowProcW;
  window_class.hInstance = instance;
  window_class.lpszClassName = kParkingClass;
  ::RegisterClassExW(&window_class);
  return ::CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kParkingClass,
                           L"", WS_POPUP | WS_CLIPCHILDREN, 0, 0, 1280, 800,
                           nullptr, nullptr, instance, nullptr);
}

int Integer(const base::DictValue& args, std::string_view key) {
  return static_cast<int>(args.FindDouble(key).value_or(0));
}

std::string Text(const base::DictValue& args, std::string_view key) {
  const std::string* value = args.FindString(key);
  return value ? *value : std::string();
}

}

Host::Host() = default;

Host::~Host() = default;

Host* Host::Get() {
  static base::NoDestructor<Host> host;
  return host.get();
}

void Host::Start() {
  if (started_) {
    return;
  }
  started_ = true;
  parking_ = CreateParkingWindow();
  browsers_observation_.Observe(GlobalBrowserCollection::GetInstance());
}

void Host::Call(const std::string& verb,
                base::DictValue args,
                HWND window,
                Reply reply) {
  if (verb == "tab.create") {
    CreateTab(std::move(args), window, std::move(reply));
    return;
  }
  base::DictValue result;
  if (verb == "tab.show") {
    result = ShowTab(args, window);
  } else if (verb == "tab.close") {
    result = CloseTab(args);
  } else if (verb == "tab.call") {
    result = CallTab(args);
  } else if (verb == "tab.discard") {
    result = DiscardOffered(args);
  } else if (verb == "tabs.list") {
    result = ListTabs();
  } else if (verb == "host.info") {
    result = Info();
  } else if (verb == "app.quit") {
    std::move(reply).Run(Ok());
    QuitApp();
    return;
  } else {
    result = Error("unknown verb");
  }
  std::move(reply).Run(std::move(result));
}

bool Host::Keeps(const BrowserWindowInterface* browser) const {
  for (const auto& entry : hosted_) {
    if (entry.first == browser) {
      return true;
    }
  }
  return false;
}

void Host::TabDestroyed(TabState* state) {
  auto found = tabs_.find(state->key());
  if (found != tabs_.end() && found->second == state->web_contents()) {
    tabs_.erase(found);
  }
}

void Host::ParentDestroying(HWND parent) {
  parents_.erase(parent);
  for (auto& entry : hosted_) {
    Hosted& hosted = entry.second;
    if (hosted.parent != parent) {
      continue;
    }
    Hide(entry.first, hosted);
    if (HWND window = WindowOf(entry.first)) {
      ::SetParent(window, parking_);
    }
    hosted.parent = nullptr;
  }
}

void Host::CreateTab(base::DictValue args, HWND parent, Reply reply) {
  std::string key = Text(args, "key");
  if (key.empty() || !::IsWindow(parent)) {
    std::move(reply).Run(Error("a tab needs a key and a window"));
    return;
  }
  std::string adopt = Text(args, "adopt");
  content::WebContents* existing = Find(key);
  if (!existing && !adopt.empty()) {
    existing = FindOffered(adopt);
    if (!existing) {
      std::move(reply).Run(Error("the offered tab is gone"));
      return;
    }
    tabs_[key] = existing;
    TabState::Bind(existing, key)->NoteNavigation();
  }
  if (existing) {
    if (!PlaceTab(existing, parent)) {
      std::move(reply).Run(Error("the tab could not move to this window"));
      return;
    }
    base::DictValue result;
    result.Set("tab", TabState::IdOf(existing));
    std::move(reply).Run(std::move(result));
    return;
  }
  std::string profile_name = Text(args, "profile");
  WithProfile(profile_name,
              base::BindOnce(&Host::CreateTabInProfile,
                             weak_factory_.GetWeakPtr(), std::move(key),
                             Text(args, "url"), profile_name, parent,
                             std::move(reply)));
}

void Host::CreateTabInProfile(std::string key,
                              std::string url,
                              std::string profile_name,
                              HWND parent,
                              Reply reply,
                              Profile* profile) {
  if (!profile || !::IsWindow(parent)) {
    std::move(reply).Run(Error("the profile did not load"));
    return;
  }
  profile_names_[profile] = profile_name;
  if (content::WebContents* existing = Find(key)) {
    PlaceTab(existing, parent);
    base::DictValue result;
    result.Set("tab", TabState::IdOf(existing));
    std::move(reply).Run(std::move(result));
    return;
  }
  Browser* browser = BrowserFor(parent, profile);
  if (!browser) {
    std::move(reply).Run(Error("no browser for this profile"));
    return;
  }
  content::WebContents* contents = nullptr;
  {
    base::AutoReset<bool> creating(&creating_tab_, true);
    NavigateParams params(browser, GURL(url.empty() ? "about:blank" : url),
                          ui::PAGE_TRANSITION_TYPED);
    params.disposition = WindowOpenDisposition::NEW_BACKGROUND_TAB;
    params.window_action = NavigateParams::WindowAction::kNoAction;
    Navigate(&params);
    contents = params.navigated_or_inserted_contents;
  }
  if (!contents) {
    std::move(reply).Run(Error("the tab did not open"));
    return;
  }
  tabs_[key] = contents;
  TabState::Bind(contents, key)->NoteNavigation();
  base::DictValue result;
  result.Set("tab", TabState::IdOf(contents));
  std::move(reply).Run(std::move(result));
}

base::DictValue Host::ShowTab(const base::DictValue& args, HWND parent) {
  std::string key = Text(args, "key");
  content::WebContents* contents = Find(key);
  if (!contents) {
    return Error("no such tab");
  }
  Browser* browser = BrowserOf(contents);
  auto found = hosted_.find(browser);
  if (found == hosted_.end()) {
    return Error("the tab is not in a hosted window");
  }
  Hosted& hosted = found->second;
  if (!args.FindBool("visible").value_or(true)) {
    if (hosted.shown == key) {
      Hide(browser, hosted);
    }
    return Ok();
  }
  if (!::IsWindow(parent)) {
    return Error("no window");
  }
  HWND window = WindowOf(browser);
  if (!window) {
    return Error("the browser has no window");
  }
  for (auto& entry : hosted_) {
    if (entry.first != browser && entry.second.parent == parent &&
        !entry.second.shown.empty()) {
      Hide(entry.first, entry.second);
    }
  }
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab && index != model->active_index()) {
    model->ActivateTabAt(index);
  }
  hosted.parent = parent;
  WatchParent(parent);
  if (::GetParent(window) != parent) {
    ::SetParent(window, parent);
  }
  int x = Integer(args, "x");
  int y = Integer(args, "y");
  int width = Integer(args, "width");
  int height = Integer(args, "height");
  ::SetWindowPos(window, HWND_TOP, x, y, width, height, SWP_NOACTIVATE);
  if (!::IsWindowVisible(window)) {
    browser->GetWindow()->ShowInactive();
    ::SetWindowPos(window, HWND_TOP, x, y, width, height, SWP_NOACTIVATE);
  }
  hosted.shown = key;
  return Ok();
}

base::DictValue Host::CloseTab(const base::DictValue& args) {
  std::string key = Text(args, "key");
  content::WebContents* contents = Find(key);
  if (!contents) {
    return Ok();
  }
  if (TabState* state = TabState::FromWebContents(contents)) {
    state->set_closed_by_host();
  }
  tabs_.erase(key);
  Browser* browser = BrowserOf(contents);
  if (!browser) {
    return Ok();
  }
  auto found = hosted_.find(browser);
  if (found != hosted_.end() && found->second.shown == key) {
    Hide(browser, found->second);
  }
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab) {
    model->CloseWebContentsAt(index,
                              TabCloseTypes::CLOSE_USER_GESTURE |
                                  TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  }
  return Ok();
}

base::DictValue Host::DiscardOffered(const base::DictValue& args) {
  content::WebContents* contents = FindOffered(Text(args, "adopt"));
  if (!contents) {
    return Ok();
  }
  TabState* state = TabState::FromWebContents(contents);
  if (state && !state->key().empty()) {
    return Error("the tab is in use");
  }
  Browser* browser = BrowserOf(contents);
  if (!browser) {
    return Ok();
  }
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab) {
    model->CloseWebContentsAt(index, TabCloseTypes::CLOSE_NONE);
  }
  return Ok();
}

base::DictValue Host::CallTab(const base::DictValue& args) {
  content::WebContents* contents = Find(Text(args, "key"));
  if (!contents) {
    return Error("no such tab");
  }
  std::string method = Text(args, "method");
  content::NavigationController& controller = contents->GetController();
  if (method == "loadUrl") {
    bool user_initiated = args.FindBool("userInitiated").value_or(false);
    content::NavigationController::LoadURLParams params(
        GURL(Text(args, "url")));
    params.transition_type =
        user_initiated
            ? ui::PageTransitionFromInt(ui::PAGE_TRANSITION_TYPED |
                                        ui::PAGE_TRANSITION_FROM_ADDRESS_BAR)
            : ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
    params.has_user_gesture = user_initiated;
    controller.LoadURLWithParams(params);
  } else if (method == "goBack") {
    if (controller.CanGoBack()) {
      controller.GoBack();
    }
  } else if (method == "goForward") {
    if (controller.CanGoForward()) {
      controller.GoForward();
    }
  } else if (method == "goToOffset") {
    int offset = Integer(args, "offset");
    if (controller.CanGoToOffset(offset)) {
      controller.GoToOffset(offset);
    }
  } else if (method == "reload") {
    controller.Reload(content::ReloadType::NORMAL, true);
  } else if (method == "forceReload") {
    controller.Reload(content::ReloadType::BYPASSING_CACHE, true);
  } else if (method == "stopLoading") {
    contents->Stop();
  } else if (method == "setMuted") {
    contents->SetAudioMuted(args.FindBool("muted").value_or(false));
  } else if (method == "focus") {
    Browser* browser = BrowserOf(contents);
    HWND window = browser ? WindowOf(browser) : nullptr;
    if (window && ::IsWindowVisible(window)) {
      ::SetFocus(window);
      contents->Focus();
    }
  } else {
    return Error("unknown method");
  }
  return Ok();
}

base::DictValue Host::Info() {
  base::DictValue result;
  result.Set("chromium", version_info::GetVersionNumber());
  result.Set("userDataDir",
             base::WideToUTF8(g_browser_process->profile_manager()
                                  ->user_data_dir()
                                  .value()));
  return result;
}

base::DictValue Host::ListTabs() {
  base::ListValue tabs;
  for (const auto& entry : tabs_) {
    content::WebContents* contents = entry.second;
    base::DictValue tab;
    tab.Set("key", entry.first);
    tab.Set("tab", TabState::IdOf(contents));
    tab.Set("url", contents->GetVisibleURL().spec());
    tab.Set("title", base::UTF16ToUTF8(contents->GetTitle()));
    tab.Set("loading", contents->IsLoading());
    Browser* browser = BrowserOf(contents);
    auto found = hosted_.find(browser);
    tab.Set("shown", found != hosted_.end() && found->second.shown == entry.first);
    HWND window = browser ? WindowOf(browser) : nullptr;
    RECT bounds = {};
    if (window) {
      ::GetWindowRect(window, &bounds);
    }
    tab.Set("windowVisible", window && ::IsWindowVisible(window));
    tab.Set("left", static_cast<int>(bounds.left));
    tab.Set("top", static_cast<int>(bounds.top));
    tab.Set("width", static_cast<int>(bounds.right - bounds.left));
    tab.Set("height", static_cast<int>(bounds.bottom - bounds.top));
    tabs.Append(std::move(tab));
  }
  base::DictValue result;
  result.Set("tabs", std::move(tabs));
  return result;
}

content::WebContents* Host::Find(const std::string& key) const {
  auto found = tabs_.find(key);
  return found == tabs_.end() ? nullptr : found->second.get();
}

content::WebContents* Host::FindOffered(const std::string& adopt) const {
  std::string_view prefix = kOfferedPrefix;
  if (!adopt.starts_with(prefix)) {
    return nullptr;
  }
  int id = 0;
  if (!base::StringToInt(adopt.substr(prefix.size()), &id)) {
    return nullptr;
  }
  std::vector<Browser*> browsers;
  for (const auto& entry : hosted_) {
    browsers.push_back(entry.first);
  }
  browsers.insert(browsers.end(), foreign_.begin(), foreign_.end());
  for (Browser* browser : browsers) {
    TabStripModel* model = browser->GetTabStripModel();
    for (int index = 0; index < model->count(); ++index) {
      content::WebContents* contents = model->GetWebContentsAt(index);
      if (TabState::IdOf(contents) == id) {
        return contents;
      }
    }
  }
  return nullptr;
}

Browser* Host::BrowserFor(HWND parent, Profile* profile) {
  for (auto& entry : hosted_) {
    if (entry.second.parent == parent && entry.second.profile == profile) {
      return entry.first;
    }
  }
  Browser* browser = nullptr;
  {
    base::AutoReset<bool> creating(&creating_browser_, true);
    BrowserWindowCreateParams params(BrowserWindowInterface::TYPE_NORMAL,
                                     *profile, true);
    params.omit_from_session_restore = true;
    params.should_trigger_session_restore = false;
    params.initial_bounds = gfx::Rect(0, 0, 1280, 800);
    params.initial_show_state = ui::mojom::WindowShowState::kNormal;
    browser = static_cast<Browser*>(CreateBrowserWindow(std::move(params)));
  }
  if (!browser) {
    return nullptr;
  }
  Hosted hosted;
  hosted.parent = parent;
  hosted.profile = profile;
  hosted_[browser] = hosted;
  WatchParent(parent);
  Adopt(browser);
  return browser;
}

Browser* Host::BrowserOf(content::WebContents* contents) const {
  return static_cast<Browser*>(
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents));
}

Browser* Host::OwnerOf(const TabStripModel* model) const {
  for (const auto& entry : hosted_) {
    if (entry.first->GetTabStripModel() == model) {
      return entry.first;
    }
  }
  for (Browser* browser : foreign_) {
    if (browser->GetTabStripModel() == model) {
      return browser;
    }
  }
  return nullptr;
}

bool Host::PlaceTab(content::WebContents* contents, HWND parent) {
  Profile* profile =
      Profile::FromBrowserContext(contents->GetBrowserContext());
  Browser* target = BrowserFor(parent, profile);
  if (!target) {
    return false;
  }
  Browser* from = BrowserOf(contents);
  if (from == target) {
    return true;
  }
  if (!from) {
    return false;
  }
  TabStripModel* source = from->GetTabStripModel();
  int index = source->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return false;
  }
  auto found = hosted_.find(from);
  TabState* state = TabState::FromWebContents(contents);
  if (found != hosted_.end() && state && found->second.shown == state->key()) {
    Hide(from, found->second);
  }
  base::AutoReset<bool> moving(&moving_tab_, true);
  std::unique_ptr<tabs::TabModel> moved =
      source->DetachTabAtForInsertion(index);
  if (!moved) {
    return false;
  }
  TabStripModel* model = target->GetTabStripModel();
  model->InsertDetachedTabAt(model->count(), std::move(moved),
                             AddTabTypes::ADD_NONE);
  return true;
}

void Host::Adopt(Browser* browser) {
  browser->GetTabStripModel()->AddObserver(this);
  Park(browser);
}

void Host::Park(Browser* browser) {
  HWND window = WindowOf(browser);
  if (!window) {
    return;
  }
  MakeChild(window, parking_);
  if (ui::BaseWindow* base_window = browser->GetWindow()) {
    if (gfx::NativeWindow native = base_window->GetNativeWindow()) {
      native->AddPreTargetHandler(this);
    }
  }
}

void Host::ParkForeign(base::WeakPtr<BrowserWindowInterface> browser) {
  if (!browser) {
    return;
  }
  Browser* foreign = static_cast<Browser*>(browser.get());
  if (foreign_.contains(foreign)) {
    Park(foreign);
  }
}

void Host::Hide(Browser* browser, Hosted& hosted) {
  hosted.shown.clear();
  HWND window = WindowOf(browser);
  if (window && ::IsWindowVisible(window)) {
    HWND focus = ::GetFocus();
    if (focus && (focus == window || ::IsChild(window, focus)) &&
        hosted.parent) {
      ::SetFocus(hosted.parent);
    }
    browser->GetWindow()->Hide();
  }
}

void Host::WatchParent(HWND parent) {
  if (!parent || parents_.contains(parent)) {
    return;
  }
  parents_.insert(parent);
  ::SetWindowSubclass(parent, &ParentProcedure, kParentSubclass, 0);
}

void Host::FocusFor(ui::Event* event) {
  aura::Window* target = static_cast<aura::Window*>(event->target());
  if (!target || !target->GetHost()) {
    return;
  }
  HWND window = target->GetHost()->GetAcceleratedWidget();
  if (!window || !(::GetWindowLongPtrW(window, GWL_STYLE) & WS_CHILD)) {
    return;
  }
  HWND focus = ::GetFocus();
  if (focus != window && !(focus && ::IsChild(window, focus))) {
    ::SetFocus(window);
  }
}

void Host::NoteOpened(Browser* browser,
                      TabStripModel* model,
                      content::WebContents* contents,
                      int index,
                      bool foreground) {
  base::DictValue payload;
  payload.Set("adopt", kOfferedPrefix + base::NumberToString(TabState::IdOf(contents)));
  payload.Set("url", contents->GetVisibleURL().spec());
  payload.Set("foreground", foreground);
  bool foreign = foreign_.contains(browser);
  payload.Set("window", foreign);
  payload.Set("profile", NameOf(browser->GetProfile()));
  std::string opener_key;
  content::WebContents* opener = nullptr;
  if (tabs::TabInterface* opener_tab = model->GetOpenerOfTabAt(index)) {
    opener = opener_tab->GetContents();
  }
  if (!opener) {
    opener = contents->GetFirstWebContentsInLiveOriginalOpenerChain();
  }
  if (opener) {
    if (TabState* state = TabState::FromWebContents(opener)) {
      opener_key = state->key();
    }
  }
  payload.Set("opener", opener_key);
  HWND parent = nullptr;
  auto found = hosted_.find(browser);
  if (found != hosted_.end()) {
    parent = found->second.parent;
  }
  payload.Set("parent", base::NumberToString(reinterpret_cast<uintptr_t>(parent)));
  Emit("tab.opened", std::move(payload));
}

std::string Host::NameOf(Profile* profile) const {
  auto found = profile_names_.find(profile);
  return found == profile_names_.end() ? NameOfProfile(profile)
                                       : found->second;
}

void Host::OnTabStripModelChanged(TabStripModel* tab_strip_model,
                                  const TabStripModelChange& change,
                                  const TabStripSelectionChange& selection) {
  Browser* browser = OwnerOf(tab_strip_model);
  if (!browser) {
    return;
  }
  if (change.type() == TabStripModelChange::kInserted) {
    if (creating_tab_ || moving_tab_) {
      return;
    }
    for (const auto& inserted : change.GetInsert()->contents) {
      content::WebContents* contents = inserted.contents;
      TabState* state = TabState::FromWebContents(contents);
      if (state && !state->key().empty()) {
        continue;
      }
      NoteOpened(browser, tab_strip_model, contents, inserted.index,
                 selection.new_contents == contents);
    }
    return;
  }
  if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      if (removed.remove_reason != TabRemovedReason::kDeleted) {
        continue;
      }
      TabState* state = TabState::FromWebContents(removed.contents);
      if (!state || state->key().empty()) {
        continue;
      }
      auto found = hosted_.find(browser);
      if (found != hosted_.end() && found->second.shown == state->key()) {
        Hide(browser, found->second);
      }
      if (!state->closed_by_host()) {
        state->Send("windowClose", base::DictValue());
      }
      tabs_.erase(state->key());
    }
  }
}

void Host::OnBrowserCreated(BrowserWindowInterface* browser) {
  if (creating_browser_ ||
      browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) {
    return;
  }
  Browser* foreign = static_cast<Browser*>(browser);
  foreign_.insert(foreign);
  foreign->GetTabStripModel()->AddObserver(this);
  if (WindowOf(browser)) {
    Park(foreign);
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&Host::ParkForeign, weak_factory_.GetWeakPtr(),
                                browser->GetWeakPtr()));
}

void Host::OnBrowserClosed(BrowserWindowInterface* browser) {
  Browser* closed = static_cast<Browser*>(browser);
  hosted_.erase(closed);
  foreign_.erase(closed);
}

void Host::OnMouseEvent(ui::MouseEvent* event) {
  if (event->type() == ui::EventType::kMousePressed) {
    FocusFor(event);
  }
}

void Host::OnTouchEvent(ui::TouchEvent* event) {
  if (event->type() == ui::EventType::kTouchPressed) {
    FocusFor(event);
  }
}

}
