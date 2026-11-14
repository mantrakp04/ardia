#include "ardia/win/host.h"

#include <commctrl.h>
#include <dwmapi.h>

#include <cmath>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "ardia/win/main.h"
#include "ardia/win/page_links.h"
#include "ardia/win/private_sessions.h"
#include "ardia/win/profiles.h"
#include "ardia/win/tab_calls.h"
#include "ardia/win/tab_events.h"
#include "ardia/win/tab_state.h"
#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
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
#include "chrome/browser/ui/unload_controller.h"
#include "components/tabs/public/tab_interface.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/base/base_window.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/events/event.h"
#include "ui/events/types/event_type.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

namespace ardia_win {

namespace {

constexpr int kParkedAt = -32000;
constexpr char kOfferedPrefix[] = "ardiacore:";
constexpr int kOpenRequestTries = 20;
constexpr base::TimeDelta kOpenRequestWait = base::Milliseconds(25);
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

void MakeBare(HWND window) {
  LONG_PTR style = ::GetWindowLongPtrW(window, GWL_STYLE);
  style &= ~static_cast<LONG_PTR>(WS_CHILD | WS_CAPTION | WS_THICKFRAME |
                                  WS_SYSMENU | WS_MINIMIZEBOX |
                                  WS_MAXIMIZEBOX | WS_VISIBLE);
  style |= WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
  ::SetWindowLongPtrW(window, GWL_STYLE, style);
  LONG_PTR extended = ::GetWindowLongPtrW(window, GWL_EXSTYLE);
  extended &= ~static_cast<LONG_PTR>(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE |
                                     WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE |
                                     WS_EX_STATICEDGE);
  ::SetWindowLongPtrW(window, GWL_EXSTYLE, extended);
  const DWORD square = DWMWCP_DONOTROUND;
  ::DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, &square,
                          sizeof(square));
  const BOOL no_transitions = TRUE;
  ::DwmSetWindowAttribute(window, DWMWA_TRANSITIONS_FORCEDISABLED,
                          &no_transitions, sizeof(no_transitions));
  const DWM_SYSTEMBACKDROP_TYPE no_backdrop = DWMSBT_NONE;
  ::DwmSetWindowAttribute(window, DWMWA_SYSTEMBACKDROP_TYPE, &no_backdrop,
                          sizeof(no_backdrop));
  ::SetWindowPos(window, nullptr, kParkedAt, kParkedAt, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                     SWP_FRAMECHANGED);
}

void SetOwner(HWND window, HWND owner) {
  ::SetWindowLongPtrW(window, GWLP_HWNDPARENT,
                      reinterpret_cast<LONG_PTR>(owner));
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
  if (message == WM_WINDOWPOSCHANGED) {
    Host::Get()->ParentMoved(window);
  }
  if (message == WM_NCDESTROY) {
    ::RemoveWindowSubclass(window, &ParentProcedure, id);
  }
  return ::DefSubclassProc(window, message, w_param, l_param);
}

int Integer(const base::DictValue& args, std::string_view key) {
  return static_cast<int>(args.FindDouble(key).value_or(0));
}

int Scaled(double value, double scale) {
  return static_cast<int>(std::lround(value * scale));
}

void Shape(HWND window,
           int x,
           int y,
           int width,
           int height,
           int radius,
           const base::ListValue* holes,
           double scale) {
  if (radius <= 0 && (!holes || holes->empty())) {
    ::SetWindowRgn(window, nullptr, TRUE);
    return;
  }
  HRGN region = radius > 0
                    ? ::CreateRoundRectRgn(0, 0, width + 1, height + 1,
                                           radius * 2, radius * 2)
                    : ::CreateRectRgn(0, 0, width, height);
  if (holes) {
    for (const base::Value& entry : *holes) {
      const base::ListValue* hole = entry.GetIfList();
      if (!hole || hole->size() < 4) {
        continue;
      }
      double left = (*hole)[0].GetIfDouble().value_or(0);
      double top = (*hole)[1].GetIfDouble().value_or(0);
      double wide = (*hole)[2].GetIfDouble().value_or(0);
      double high = (*hole)[3].GetIfDouble().value_or(0);
      const int round =
          hole->size() > 4
              ? Scaled((*hole)[4].GetIfDouble().value_or(0), scale)
              : 0;
      const int cut_left = Scaled(left, scale) - x;
      const int cut_top = Scaled(top, scale) - y;
      const int cut_right = Scaled(left + wide, scale) - x;
      const int cut_bottom = Scaled(top + high, scale) - y;
      HRGN cut = round > 0
                     ? ::CreateRoundRectRgn(cut_left, cut_top, cut_right + 1,
                                            cut_bottom + 1, round * 2,
                                            round * 2)
                     : ::CreateRectRgn(cut_left, cut_top, cut_right,
                                       cut_bottom);
      ::CombineRgn(region, region, cut, RGN_DIFF);
      ::DeleteObject(cut);
    }
  }
  ::SetWindowRgn(window, region, TRUE);
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
  if (verb == "tab.call") {
    content::WebContents* contents = Find(Text(args, "key"));
    if (!contents) {
      std::move(reply).Run(Error("no such tab"));
      return;
    }
    if (std::optional<base::DictValue> done = CallTab(contents, args)) {
      std::move(reply).Run(std::move(*done));
      return;
    }
    if (!CallTabMethod(contents, Text(args, "method"), args, reply)) {
      std::move(reply).Run(Error("unknown method"));
    }
    return;
  }
  base::DictValue result;
  if (verb == "tab.show") {
    result = ShowTab(args, window);
  } else if (verb == "tab.close") {
    result = CloseTab(args);
  } else if (verb == "tab.discard") {
    result = DiscardOffered(args);
  } else if (verb == "tabs.list") {
    result = ListTabs();
  } else if (verb == "host.info") {
    result = Info();
  } else if (verb == "peek.config") {
    PageLinks::Configure(args);
    result = PageLinks::Config();
  } else if (verb == "tab.links") {
    content::WebContents* contents = Find(Text(args, "key"));
    PageLinks* links = contents ? PageLinks::FromWebContents(contents) : nullptr;
    result = Ok();
    result.Set("scriptFrames", links ? links->ScriptFrames() : 0);
  } else if (verb == "profile.release") {
    PrivateSessions::Get()->Release(Text(args, "profile"));
    result = Ok();
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

int Host::BrowsersOf(Profile* profile) const {
  int count = 0;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&](BrowserWindowInterface* browser) {
        count += browser->GetProfile() == profile;
        return true;
      });
  return count;
}

int Host::CloseBrowsersOf(Profile* profile) {
  std::vector<base::WeakPtr<BrowserWindowInterface>> found;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&](BrowserWindowInterface* browser) {
        if (browser->GetProfile() == profile) {
          found.push_back(browser->GetWeakPtr());
        }
        return true;
      });
  for (const base::WeakPtr<BrowserWindowInterface>& weak : found) {
    if (!weak) {
      continue;
    }
    Browser* browser = static_cast<Browser*>(weak.get());
    auto hosted = hosted_.find(browser);
    if (hosted != hosted_.end()) {
      Hide(browser, hosted->second);
      hosted_.erase(hosted);
    }
    foreign_.erase(browser);
    TabStripModel* model = browser->GetTabStripModel();
    for (int index = 0; model && index < model->count(); ++index) {
      content::WebContents* contents = model->GetWebContentsAt(index);
      TabState* state = TabState::FromWebContents(contents);
      if (!state) {
        continue;
      }
      state->set_closed_by_host();
      auto tab = tabs_.find(state->key());
      if (tab != tabs_.end() && tab->second == contents) {
        tabs_.erase(tab);
      }
    }
    UnloadController::From(browser)->set_force_skip_warning_user_on_close(
        true);
    browser->GetWindow()->Close();
  }
  return static_cast<int>(found.size());
}

void Host::ForgetProfile(Profile* profile) {
  profile_names_.erase(profile);
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
      SetOwner(window, nullptr);
    }
    hosted.parent = nullptr;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&Host::CloseSparePages, weak_factory_.GetWeakPtr()));
}

void Host::CloseSparePages() {
  std::vector<base::WeakPtr<BrowserWindowInterface>> spare;
  for (const auto& entry : hosted_) {
    const HWND parent = entry.second.parent;
    if ((!parent || !::IsWindow(parent)) &&
        entry.first->GetTabStripModel()->empty()) {
      spare.push_back(entry.first->GetWeakPtr());
    }
  }
  for (const base::WeakPtr<BrowserWindowInterface>& weak : spare) {
    if (!weak) {
      continue;
    }
    Browser* browser = static_cast<Browser*>(weak.get());
    hosted_.erase(browser);
    browser->GetWindow()->Close();
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
    TabEvents::Attach(existing);
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
  int64_t opening_navigation_id = 0;
  {
    base::AutoReset<bool> creating(&creating_tab_, true);
    NavigateParams params(browser, GURL(url.empty() ? "about:blank" : url),
                          ui::PAGE_TRANSITION_TYPED);
    params.disposition = WindowOpenDisposition::NEW_BACKGROUND_TAB;
    params.window_action = NavigateParams::WindowAction::kNoAction;
    base::WeakPtr<content::NavigationHandle> opening = Navigate(&params);
    if (opening) {
      opening_navigation_id = opening->GetNavigationId();
    }
    contents = params.navigated_or_inserted_contents;
  }
  if (!contents) {
    std::move(reply).Run(Error("the tab did not open"));
    return;
  }
  tabs_[key] = contents;
  TabState* state = TabState::Bind(contents, key);
  if (url.empty()) {
    state->WatchOpeningBlank(opening_navigation_id);
  }
  state->NoteNavigation();
  TabEvents::Attach(contents);
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
  if (!args.FindBool("visible").value_or(true)) {
    if (found->second.shown == key) {
      Hide(browser, found->second);
    }
    return Ok();
  }
  if (!::IsWindow(parent)) {
    return Error("no window");
  }
  if (!Fits(found->second, parent, key)) {
    Browser* page = FreePageFor(
        parent, Profile::FromBrowserContext(contents->GetBrowserContext()),
        browser);
    if (!page || !MoveTab(contents, browser, page)) {
      return Error("no page window for the tab");
    }
    browser = page;
    found = hosted_.find(browser);
    if (found == hosted_.end()) {
      return Error("the page window went away");
    }
  }
  Hosted& hosted = found->second;
  HWND window = WindowOf(browser);
  if (!window) {
    return Error("the browser has no window");
  }
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab && index != model->active_index()) {
    model->ActivateTabAt(index);
  }
  hosted.parent = parent;
  WatchParent(parent);
  SetOwner(window, parent);
  double scale = Text(args, "unit") == "px"
                     ? 1.0
                     : ::GetDpiForWindow(parent) / 96.0;
  int x = Scaled(args.FindDouble("x").value_or(0), scale);
  int y = Scaled(args.FindDouble("y").value_or(0), scale);
  int width = Scaled(args.FindDouble("x").value_or(0) +
                         args.FindDouble("width").value_or(0),
                     scale) -
              x;
  int height = Scaled(args.FindDouble("y").value_or(0) +
                          args.FindDouble("height").value_or(0),
                      scale) -
               y;
  hosted.place = gfx::Rect(x, y, width, height);
  Place(window, hosted);
  Shape(window, x, y, width, height,
        Scaled(args.FindDouble("radius").value_or(0), scale),
        args.FindList("holes"), scale);
  if (!::IsWindowVisible(window)) {
    browser->GetWindow()->ShowInactive();
    Place(window, hosted);
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

std::optional<base::DictValue> Host::CallTab(content::WebContents* contents,
                                             const base::DictValue& args) {
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
    TabState* state = TabState::FromWebContents(contents);
    if (state && state->OnlyShowedOpeningBlank()) {
      params.should_replace_current_entry = true;
    }
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
    return std::nullopt;
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
  result.Set("privateSessions", PrivateSessions::Get()->LiveSessions());
  result.Set("pageWindows", static_cast<int>(hosted_.size()));
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
    tab.Set("session",
            PrivateSessions::Get()->SessionNumber(Profile::FromBrowserContext(
                contents->GetBrowserContext())));
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
  if (Browser* free = FreePageFor(parent, profile, nullptr)) {
    return free;
  }
  for (auto& entry : hosted_) {
    if (entry.second.parent == parent && entry.second.profile == profile) {
      return entry.first;
    }
  }
  return NewPage(parent, profile);
}

Browser* Host::FreePageFor(HWND parent,
                           Profile* profile,
                           const Browser* except) {
  for (auto& entry : hosted_) {
    if (entry.first != except && entry.second.parent == parent &&
        entry.second.profile == profile && entry.second.shown.empty()) {
      return entry.first;
    }
  }
  return except ? NewPage(parent, profile) : nullptr;
}

bool Host::Fits(const Hosted& hosted, HWND parent,
                const std::string& key) const {
  const bool free = hosted.shown.empty() || hosted.shown == key;
  const bool here = hosted.parent == parent || !hosted.parent ||
                    !::IsWindow(hosted.parent);
  return free && here;
}

Browser* Host::NewPage(HWND parent, Profile* profile) {
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
  Browser* from = BrowserOf(contents);
  if (!from) {
    return false;
  }
  auto current = hosted_.find(from);
  if (current != hosted_.end() && current->second.parent == parent &&
      current->second.profile == profile) {
    return true;
  }
  Browser* target = BrowserFor(parent, profile);
  if (!target) {
    return false;
  }
  if (from == target) {
    return true;
  }
  return MoveTab(contents, from, target);
}

bool Host::MoveTab(content::WebContents* contents,
                   Browser* from,
                   Browser* target) {
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
  MakeBare(window);
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
    const bool active = ::GetActiveWindow() == window;
    browser->GetWindow()->Hide();
    if (active && hosted.parent) {
      ::SetActiveWindow(hosted.parent);
    }
  }
}

void Host::Place(HWND window, const Hosted& hosted) {
  if (!hosted.parent || !::IsWindow(hosted.parent)) {
    return;
  }
  POINT origin = {hosted.place.x(), hosted.place.y()};
  ::ClientToScreen(hosted.parent, &origin);
  ::SetWindowPos(window, nullptr, origin.x, origin.y, hosted.place.width(),
                 hosted.place.height(),
                 SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER);
}

void Host::ParentMoved(HWND parent) {
  for (auto& entry : hosted_) {
    const Hosted& hosted = entry.second;
    if (hosted.parent != parent || hosted.shown.empty()) {
      continue;
    }
    if (HWND window = WindowOf(entry.first)) {
      Place(window, hosted);
    }
  }
}

void Host::WatchParent(HWND parent) {
  if (!parent || parents_.contains(parent)) {
    return;
  }
  parents_.insert(parent);
  ::SetWindowSubclass(parent, &ParentProcedure, kParentSubclass, 0);
}

std::string Host::PageKeyFor(ui::Event* event) const {
  aura::Window* target = static_cast<aura::Window*>(event->target());
  if (!target || !target->GetHost()) {
    return std::string();
  }
  HWND window = target->GetHost()->GetAcceleratedWidget();
  if (!window) {
    return std::string();
  }
  for (const auto& entry : hosted_) {
    if (!entry.second.shown.empty() && WindowOf(entry.first) == window) {
      return entry.second.shown;
    }
  }
  return std::string();
}

bool Host::Shows(const std::string& key) const {
  for (const auto& entry : hosted_) {
    if (entry.second.shown == key) {
      return true;
    }
  }
  return false;
}

void Host::FocusFor(ui::Event* event) {
  const std::string key = PageKeyFor(event);
  if (key.empty()) {
    return;
  }
  if (content::WebContents* contents = Find(key)) {
    if (TabState* state = TabState::FromWebContents(contents)) {
      state->Send("pagePress", base::DictValue());
    }
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
  payload.Set("fromClick", false);
  if (!foreground || foreign || opener_key.empty() ||
      !OpenRequest::FromWebContents(contents)) {
    Emit("tab.opened", std::move(payload));
    return;
  }
  EmitOpened(std::move(payload), contents->GetWeakPtr(), opener_key, 0);
}

void Host::EmitOpened(base::DictValue payload,
                      base::WeakPtr<content::WebContents> contents,
                      std::string opener_key,
                      int tries) {
  if (!contents) {
    return;
  }
  OpenRequest* request = OpenRequest::FromWebContents(contents.get());
  content::WebContents* opener = Find(opener_key);
  PageLinks* links = opener ? PageLinks::FromWebContents(opener) : nullptr;
  const bool linked = request && request->clicked() && links &&
                      links->TakeNewTabLink(
                          {request->url(), contents->GetVisibleURL()});
  if (request && !linked && tries < kOpenRequestTries &&
      (!request->started() || request->clicked())) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&Host::EmitOpened, weak_factory_.GetWeakPtr(),
                       std::move(payload), contents, std::move(opener_key),
                       tries + 1),
        kOpenRequestWait);
    return;
  }
  if (linked) {
    payload.Set("fromClick", true);
    payload.Set("url", request->url().spec());
    if (std::optional<gfx::PointF> point =
            PageLinks::RecentClickPoint(opener_key)) {
      base::DictValue at;
      at.Set("x", point->x());
      at.Set("y", point->y());
      payload.Set("point", std::move(at));
    }
  }
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
    auto orphan = hosted_.find(browser);
    if (orphan != hosted_.end() &&
        (!orphan->second.parent || !::IsWindow(orphan->second.parent)) &&
        tab_strip_model->empty()) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(&Host::CloseSparePages, weak_factory_.GetWeakPtr()));
    }
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
  if (event->type() == ui::EventType::kMousePressed ||
      event->type() == ui::EventType::kMouseReleased) {
    PageLinks::NoteMouse(*event, PageKeyFor(event));
  }
}

void Host::OnTouchEvent(ui::TouchEvent* event) {
  if (event->type() == ui::EventType::kTouchPressed) {
    FocusFor(event);
  }
}

}
