#pragma once

#include <algorithm>
#include <cassert>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <variant>
#include <vector>

#define BUILDFLAG(flag) flag
#ifndef ENABLE_PRINTING
#define ENABLE_PRINTING 1
#endif
#ifndef ENABLE_PRINT_PREVIEW
#define ENABLE_PRINT_PREVIEW 1
#endif
#ifndef ENABLE_BASIC_PRINT_DIALOG
#define ENABLE_BASIC_PRINT_DIALOG 1
#endif
#ifndef ENABLE_PDF
#define ENABLE_PDF 1
#endif

namespace base {
class OnceClosure {
 public:
  OnceClosure() = default;
  template <typename F> OnceClosure(F fn) : fn_(std::move(fn)) {}
  bool is_null() const { return !fn_; }
  explicit operator bool() const { return static_cast<bool>(fn_); }
  void Run() { auto fn = std::move(fn_); if (fn) fn(); }
  void Reset() { fn_ = nullptr; }
 private:
  std::function<void()> fn_;
};

template <typename T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(T* value, std::weak_ptr<bool> alive) : value_(value), alive_(alive) {}
  T* get() const { return alive_.expired() ? nullptr : value_; }
  T* operator->() const { return get(); }
  explicit operator bool() const { return get(); }
  void reset() { value_ = nullptr; alive_.reset(); }
 private:
  T* value_ = nullptr;
  std::weak_ptr<bool> alive_;
};
template <typename T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* value) : value_(value) {}
  WeakPtr<T> GetWeakPtr() { return {value_, alive_}; }
  void InvalidateWeakPtrs() { alive_ = std::make_shared<bool>(true); }
 private:
  T* value_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};
template <typename Signature> class RepeatingCallback;
template <typename R, typename... Args> class RepeatingCallback<R(Args...)> {
 public:
  RepeatingCallback() = default;
  template <typename F> RepeatingCallback(F f) : fn_(std::move(f)) {}
  R Run(Args... args) const { return fn_(std::forward<Args>(args)...); }
  explicit operator bool() const { return static_cast<bool>(fn_); }
  void Reset() { fn_ = nullptr; }
 private:
  std::function<R(Args...)> fn_;
};
template <typename F, typename... Bound> auto BindRepeating(F fn, Bound... bound) {
  return [fn, bound...](auto&&... args) {
    return fn(bound..., std::forward<decltype(args)>(args)...);
  };
}
template <typename C, typename... Args, typename... Bound>
auto BindOnce(void (C::*fn)(Args...), WeakPtr<C> weak, Bound... bound) {
  return [fn, weak, bound...]() mutable { if (weak) (weak.get()->*fn)(std::move(bound)...); };
}
template <typename F, typename... Bound> auto BindOnce(F fn, Bound... bound) {
  return [fn, bound...]() mutable { return fn(std::move(bound)...); };
}
class SequencedTaskRunner {
 public:
  static SequencedTaskRunner* GetCurrentDefault() { static SequencedTaskRunner runner; return &runner; }
  static bool HasCurrentDefault() { return true; }
  void PostTask(int, OnceClosure task) { tasks.push_back(std::move(task)); }
  template <typename T> bool DeleteSoon(int, std::unique_ptr<T> object) {
    std::shared_ptr<T> owned(std::move(object));
    tasks.push_back(OnceClosure([owned]() mutable { owned.reset(); }));
    return true;
  }
  void Drain() {
    while (!tasks.empty()) {
      auto pending = std::move(tasks);
      tasks.clear();
      for (auto& task : pending) std::move(task).Run();
    }
  }
  std::vector<OnceClosure> tasks;
};
class DictValue;
class Value {
 public:
  Value() = default;
  Value(const char* v) : value_(std::string(v)) {}
  Value(std::string v) : value_(std::move(v)) {}
  Value(std::string_view v) : value_(std::string(v)) {}
  Value(bool v) : value_(v) {}
  Value(int v) : value_(v) {}
  Value(DictValue v);
  bool is_string() const { return std::holds_alternative<std::string>(value_); }
  bool is_bool() const { return std::holds_alternative<bool>(value_); }
  bool is_dict() const { return std::holds_alternative<std::shared_ptr<DictValue>>(value_); }
  DictValue& GetMutableDict() { return *std::get<std::shared_ptr<DictValue>>(value_); }
  const std::string& GetString() const { return std::get<std::string>(value_); }
  bool GetBool() const { return std::get<bool>(value_); }
  int GetInt() const { return std::get<int>(value_); }
  const DictValue& GetDict() const { return *std::get<std::shared_ptr<DictValue>>(value_); }
 private:
  std::variant<std::monostate, std::string, bool, int, std::shared_ptr<DictValue>> value_;
};
class DictValue {
 public:
  DictValue& Set(std::string key, Value value) { values_[key] = std::move(value); return *this; }
  const Value& at(std::string key) const { return values_.at(key); }
  bool contains(std::string key) const { return values_.contains(key); }
  const std::string* FindString(std::string_view key) const {
    auto found = values_.find(std::string(key));
    return found != values_.end() && found->second.is_string() ? &found->second.GetString() : nullptr;
  }
  DictValue* FindDict(std::string_view key) {
    auto found = values_.find(std::string(key));
    return found != values_.end() && found->second.is_dict() ? &found->second.GetMutableDict() : nullptr;
  }
 private:
  std::map<std::string, Value> values_;
};
inline Value::Value(DictValue v) : value_(std::make_shared<DictValue>(std::move(v))) {}
class ListValue : public std::vector<Value> {
 public:
  ListValue& Append(Value value) { push_back(std::move(value)); return *this; }
};
inline std::u16string UTF8ToUTF16(const std::string& text) {
  return std::u16string(text.begin(), text.end());
}
struct UserMetricsAction { explicit UserMetricsAction(const char*) {} };
inline void RecordAction(UserMetricsAction) {}
}

template <typename T> class raw_ptr {
 public:
  raw_ptr(T* ptr = nullptr) : ptr_(ptr) {}
  T* get() const { return ptr_; }
  T* operator->() const { return ptr_; }
  operator T*() const { return ptr_; }
 private:
  T* ptr_;
};

namespace prefs {
inline constexpr char kPrintingEnabled[] = "print";
inline constexpr char kPrintPreviewDisabled[] = "previewDisabled";
inline constexpr char kAllowFileSelectionDialogs[] = "fileDialogs";
}
namespace policy {
enum class DownloadRestriction { NONE, ALL_FILES = 3 };
namespace policy_prefs { inline constexpr char kDownloadRestrictions[] = "downloadRestrictions"; }
}
inline constexpr int CONTENT_RESTRICTION_PRINT = 1;
inline constexpr int CONTENT_RESTRICTION_SAVE = 2;
class PrefService {
 public:
  bool GetBoolean(std::string_view key) const { return bools.at(std::string(key)); }
  int GetInteger(std::string_view key) const { return ints.at(std::string(key)); }
  std::map<std::string, bool> bools{{"print", true}, {"previewDisabled", false}, {"fileDialogs", true}};
  std::map<std::string, int> ints{{"downloadRestrictions", 0}};
};
class Profile {
 public:
  struct Path {
    std::string name = "Default";
    Path BaseName() const { return *this; }
    const std::string& value() const { return name; }
  };
  bool IsRegularProfile() const { return regular && !otr; }
  bool IsOffTheRecord() const { return otr; }
  bool IsIncognitoProfile() const { return otr && primary_otr; }
  Path GetPath() const { return path; }
  PrefService* GetPrefs() { return prefs_available ? &prefs : nullptr; }
  bool regular = true;
  bool otr = false;
  bool primary_otr = true;
  bool prefs_available = true;
  Path path;
  PrefService prefs;
};
namespace chrome { inline constexpr char kInitialProfile[] = "Default"; }
namespace content {
class WebContents;
class WebContentsObserver {
 public:
  explicit WebContentsObserver(WebContents* contents);
  virtual ~WebContentsObserver();
  void Observe(WebContents* contents);
  virtual void WebContentsDestroyed() {}
 private:
  WebContents* observed_ = nullptr;
};
class RenderFrameHost {
 public:
  bool IsRenderFrameLive() { return live; }
  bool live = true;
  WebContents* contents = nullptr;
};
struct NavigationEntry {
  std::string url = "https://example.test/";
  const std::string& GetURL() const { return url; }
};
struct NavigationController {
  NavigationEntry* GetLastCommittedEntry() { return committed ? &entry : nullptr; }
  bool committed = true;
  NavigationEntry entry;
};
class WebContents {
 public:
  explicit WebContents(Profile* profile = nullptr) : profile(profile) { frame.contents = this; }
  ~WebContents() { Destroy(); }
  base::WeakPtr<WebContents> GetWeakPtr() { return weak.GetWeakPtr(); }
  static WebContents* FromRenderFrameHost(RenderFrameHost* frame) { return frame->contents; }
  Profile* GetBrowserContext() { return profile; }
  NavigationController& GetController() { return controller; }
  bool IsCrashed() { return crashed; }
  std::string GetContentsMimeType() { return mime; }
  RenderFrameHost* GetPrimaryMainFrame() { return &frame; }
  void OnSavePage() { saves++; }
  void DispatchBeforeUnload(bool auto_cancel) { assert(!auto_cancel); beforeunloads++; }
  void Destroy() {
    if (destroyed) return;
    destroyed = true;
    auto pending = observers;
    for (auto* observer : pending) observer->WebContentsDestroyed();
    weak.InvalidateWeakPtrs();
  }
  Profile* profile;
  bool destroyed = false;
  bool crashed = false;
  bool core_available = true;
  bool find_available = true;
  bool print_manager = true;
  bool print_result = true;
  bool preview = false;
  bool modal = false;
  bool devtools_allowed = true;
  bool devtools_result = true;
  bool pdf_handles_save = false;
  int restrictions = 0;
  int prints = 0;
  int basics = 0;
  int saves = 0;
  int pdf_saves = 0;
  int beforeunloads = 0;
  std::string mime = "text/html";
  NavigationController controller;
  RenderFrameHost frame;
  RenderFrameHost* pdf_frame = nullptr;
  RenderFrameHost* selected_frame = nullptr;
  std::vector<WebContentsObserver*> observers;
  base::WeakPtrFactory<WebContents> weak{this};
};
inline WebContentsObserver::WebContentsObserver(WebContents* contents) { Observe(contents); }
inline WebContentsObserver::~WebContentsObserver() { Observe(nullptr); }
inline void WebContentsObserver::Observe(WebContents* contents) {
  if (observed_) std::erase(observed_->observers, this);
  observed_ = contents;
  if (observed_) observed_->observers.push_back(this);
}
inline bool IsSavableURL(const std::string& url) { return url.starts_with("https:") || url.starts_with("http:"); }
}
class TabStripModel {
 public:
  static constexpr int kNoTab = -1;
  int GetIndexOfWebContents(content::WebContents* contents) const {
    auto found = std::find(tabs.begin(), tabs.end(), contents);
    return found == tabs.end() ? kNoTab : found - tabs.begin();
  }
  std::vector<content::WebContents*> tabs;
};
class BrowserWindowInterface {
 public:
  enum Type { TYPE_NORMAL, TYPE_DEVTOOLS };
  Profile* GetProfile() { return profile; }
  Type GetType() { return type; }
  TabStripModel* GetTabStripModel() { return &strip; }
  Profile* profile;
  Type type = TYPE_NORMAL;
  TabStripModel strip;
};
class CoreTabHelper {
 public:
  static CoreTabHelper* FromWebContents(content::WebContents* contents) {
    static CoreTabHelper helper;
    helper.contents = contents;
    return contents->core_available ? &helper : nullptr;
  }
  int content_restrictions() { return contents->restrictions; }
  content::WebContents* contents;
};
struct BrowserProcess {
  PrefService* local_state() { return available ? &prefs : nullptr; }
  bool available = true;
  PrefService prefs;
};
inline BrowserProcess process;
inline BrowserProcess* g_browser_process = &process;
namespace web_modal {
class WebContentsModalDialogManager {
 public:
  static WebContentsModalDialogManager* FromWebContents(content::WebContents* contents) {
    static WebContentsModalDialogManager helper;
    helper.contents = contents;
    return &helper;
  }
  bool IsDialogActive() { return contents->modal; }
  content::WebContents* contents;
};
}
namespace printing {
inline content::RenderFrameHost* GetFrameToPrint(content::WebContents* contents) { return contents->selected_frame ? contents->selected_frame : &contents->frame; }
inline content::RenderFrameHost* GetFullPagePlugin(content::WebContents*) { return nullptr; }
inline bool StartPrint(content::WebContents* contents, bool preview_disabled, bool selection) {
  assert(!selection);
  assert(preview_disabled == contents->profile->prefs.GetBoolean(prefs::kPrintPreviewDisabled));
  contents->prints++;
  return contents->print_result;
}
inline void StartBasicPrint(content::WebContents* contents) { contents->basics++; }
class PrintViewManager {
 public:
  static PrintViewManager* FromWebContents(content::WebContents* contents) {
    static PrintViewManager manager;
    return contents->print_manager ? &manager : nullptr;
  }
};
class PrintPreviewDialogController {
 public:
  static PrintPreviewDialogController* GetInstance() { static PrintPreviewDialogController controller; return &controller; }
  bool GetPrintPreviewForContents(content::WebContents* contents) { return contents->preview; }
  bool is_creating_print_preview_dialog() { return creating; }
  bool creating = false;
};
}
namespace pdf_frame_util {
inline content::RenderFrameHost* FindFullPagePdfExtensionHost(content::WebContents*) { return nullptr; }
inline content::RenderFrameHost* FindPdfChildFrame(content::RenderFrameHost* embedder) { return embedder->contents->pdf_frame; }
}
namespace chrome_pdf::features { inline bool IsOopifPdfEnabled() { return true; } }
namespace pdf_extension_util {
inline bool MaybeDispatchSaveEvent(content::RenderFrameHost* frame) {
  frame->contents->pdf_saves++;
  return frame->contents->pdf_handles_save;
}
}
struct DevToolsToggleAction {
  enum Type { kShow, kInspect, kConsole };
  static DevToolsToggleAction Show() { return {kShow}; }
  static DevToolsToggleAction Inspect() { return {kInspect}; }
  static DevToolsToggleAction ShowConsolePanel() { return {kConsole}; }
  Type type;
};
enum class DevToolsOpenedByAction { kMainMenuOrMainShortcut };
class DevToolsWindow {
 public:
  static bool AllowDevToolsFor(Profile* profile, content::WebContents* contents) {
    assert(profile == contents->profile);
    return contents->devtools_allowed;
  }
  static DevToolsWindow* GetInstanceForInspectedWebContents(content::WebContents* contents) {
    auto found = windows.find(contents);
    return found == windows.end() ? nullptr : found->second.get();
  }
  static void OpenDevToolsWindow(content::WebContents* contents, const DevToolsToggleAction& action, DevToolsOpenedByAction) {
    if (!contents->devtools_result) return;
    auto& window = windows[contents];
    if (!window) window = std::make_unique<DevToolsWindow>();
    window->action = action.type;
    window->opens++;
  }
  bool IsDocked() { return docked; }
  raw_ptr<content::WebContents> GetDevToolsWebContents() { return frontend_available ? &frontend : nullptr; }
  void SetLoadCompletedCallback(std::function<void()> callback) { loaded = std::move(callback); }
  bool docked = true;
  bool frontend_available = true;
  content::WebContents frontend;
  DevToolsToggleAction::Type action = DevToolsToggleAction::kShow;
  int opens = 0;
  int adoptions = 0;
  bool quarantined = false;
  std::function<void()> loaded;
  static inline std::map<content::WebContents*, std::unique_ptr<DevToolsWindow>> windows;
};
namespace find_in_page {
enum class SelectionAction { kKeep, kClear, kActivate };
class FindTabHelper;
class FindResultObserver {
 public:
  virtual ~FindResultObserver() = default;
  virtual void OnFindResultAvailable(content::WebContents*) = 0;
  virtual void OnFindEmptyText(content::WebContents*) {}
  virtual void OnFindTabHelperDestroyed(FindTabHelper*) {}
};
struct FindNotificationDetails {
  int request_id() const { return request; }
  int number_of_matches() const { return count; }
  int active_match_ordinal() const { return active; }
  bool final_update() const { return final; }
  int request = 0;
  int count = 0;
  int active = 0;
  bool final = false;
};
class FindTabHelper {
 public:
  explicit FindTabHelper(content::WebContents* contents) : contents(contents) { helpers[contents] = this; }
  ~FindTabHelper() {
    auto pending = observers;
    for (auto* observer : pending) observer->OnFindTabHelperDestroyed(this);
    assert(observers.empty());
    helpers.erase(contents);
  }
  static FindTabHelper* FromWebContents(content::WebContents* contents) {
    return contents->find_available && helpers.contains(contents) ? helpers.at(contents) : nullptr;
  }
  void AddObserver(FindResultObserver* observer) { observers.push_back(observer); }
  void RemoveObserver(FindResultObserver* observer) { std::erase(observers, observer); }
  void StartFinding(std::u16string query, bool forward, bool sensitive, bool match) {
    assert(!sensitive && match);
    if (aborted || query != text) session = ++request;
    else ++request;
    text = std::move(query);
    aborted = false;
    direction = forward;
    starts++;
  }
  void StopFinding(SelectionAction action) {
    assert(action != SelectionAction::kActivate);
    selection = action;
    aborted = true;
    text.clear();
    stops++;
  }
  void Reply(int id, int count, int active, bool final) {
    if (aborted || id < session) return;
    result = {id, count, active, final};
    auto pending = observers;
    for (auto* observer : pending) observer->OnFindResultAvailable(contents);
  }
  const FindNotificationDetails& find_result() { return result; }
  content::WebContents* contents;
  std::vector<FindResultObserver*> observers;
  std::u16string text;
  bool aborted = true;
  bool direction = true;
  int starts = 0;
  int stops = 0;
  int request = 0;
  int session = 0;
  SelectionAction selection = SelectionAction::kClear;
  FindNotificationDetails result;
  static inline std::map<content::WebContents*, FindTabHelper*> helpers;
};
}
