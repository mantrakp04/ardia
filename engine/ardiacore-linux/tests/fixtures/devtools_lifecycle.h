#pragma once

#include "ardia/linux/ac_linux_devtools_authority.h"

using content::WebContents;
template <typename T> using scoped_refptr = std::shared_ptr<T>;

struct DevToolsContentsResizingStrategy {
  void CopyFrom(const DevToolsContentsResizingStrategy&) {}
};
struct TabStripUserGestureDetails {
  enum class GestureType { kOther };
  explicit TabStripUserGestureDetails(GestureType) {}
};
class GlobalBrowserCollection {
 public:
  static GlobalBrowserCollection* GetInstance() { static GlobalBrowserCollection collection; return &collection; }
  BrowserWindowInterface* FindBrowserWithTab(content::WebContents* contents) {
    lookups++;
    return owners.contains(contents) ? owners.at(contents) : nullptr;
  }
  int lookups = 0;
  std::map<content::WebContents*, BrowserWindowInterface*> owners;
};
struct DevtoolsUIController {
  static DevtoolsUIController* From(BrowserWindowInterface*) { static DevtoolsUIController controller; return &controller; }
  void UpdateDevtools(content::WebContents*) { if (on_update) on_update(); }
  static inline std::function<void()> on_update;
};
namespace sessions {
struct FixtureSessionID { int id() const { return 1; } };
struct SessionTabHelper {
  static SessionTabHelper* FromWebContents(content::WebContents*) { return nullptr; }
  FixtureSessionID session_id() { return {}; }
};
}
struct PrefsTabHelper { static void CreateForWebContents(content::WebContents*) {} };
struct DevToolsAgentHost {
  static std::shared_ptr<DevToolsAgentHost> GetOrCreateForTab(content::WebContents* contents) {
    return std::make_shared<DevToolsAgentHost>(DevToolsAgentHost{contents});
  }
  bool IsAttached() { return false; }
  content::WebContents* contents;
};
struct DevToolsPolicyDialog { static void Show(content::WebContents*) { assert(false); } };
enum class DevToolsClosedByAction { kUnknown, kMainMenuOrMainShortcut, kToggleShortcut, kPinnedToolbarButton, kCloseButton, kTargetDetach };

class DevToolsWindow {
 public:
  enum LifeStage { kNotLoaded, kOnLoadFired, kIsDockedSet, kLoadCompleted, kClosing };
  enum FrontendType { kFrontendDefault };
  struct OwnedMainWebContents {
    explicit OwnedMainWebContents(std::unique_ptr<content::WebContents> contents) : contents(std::move(contents)) {}
    std::unique_ptr<content::WebContents> contents;
  };
  struct Bindings {
    void AttachTo(DevToolsAgentHost*) {}
    template <typename... T> void CallClientMethod(T&&...) {}
    void Detach() { detached++; }
    int detached = 0;
  };
  DevToolsWindow(Profile* profile, content::WebContents* contents, bool can_dock)
      : profile_(profile), inspected_(contents), can_dock_(can_dock) {
    owned_main_web_contents_ = std::make_unique<OwnedMainWebContents>(std::make_unique<content::WebContents>(profile));
    main_web_contents_ = owned_main_web_contents_->contents.get();
    undocked_browser_.profile = profile;
    undocked_browser_.strip.tabs = {main_web_contents_.get()};
    BindLinuxDevToolsLease(ardiacore::ScopedLinuxDevToolsOperation::Capture(contents), true);
  }
  static bool AllowDevToolsFor(Profile*, content::WebContents* contents) { return contents->devtools_allowed; }
  static DevToolsWindow* GetInstanceForInspectedWebContents(content::WebContents* contents) {
    return instances.contains(contents) ? instances.at(contents).get() : nullptr;
  }
  static DevToolsWindow* FindDevToolsWindow(DevToolsAgentHost* agent) { return GetInstanceForInspectedWebContents(agent->contents); }
  static Profile* GetProfileForDevToolsWindow(content::WebContents* contents) { return contents->profile; }
  static DevToolsWindow* Create(Profile* profile, content::WebContents* contents, FrontendType,
      const std::string&, bool, const std::string&, const std::string&, bool, bool, DevToolsOpenedByAction) {
    auto created = std::make_unique<DevToolsWindow>(profile, contents, contents->can_dock);
    auto* result = created.get();
    instances[contents] = std::move(created);
    result->main_web_contents_->on_close = [contents] { instances.erase(contents); };
    if (on_create) on_create(result);
    return result;
  }
  static void OpenDevToolsWindow(content::WebContents* contents, const DevToolsToggleAction& action, DevToolsOpenedByAction opened) {
    if (contents->devtools_result) ToggleDevToolsWindow(contents, nullptr, true, action, "", opened);
  }
  static void LogDevToolsOpenedByAction(DevToolsOpenedByAction) {}
  static void LogDevToolsOpenedUKM(content::WebContents*) {}
  static void ToggleDevToolsWindow(content::WebContents*, Profile*, bool, const DevToolsToggleAction&,
      const std::string&, DevToolsOpenedByAction,
      const content::DevToolsManagerDelegate::DevToolsOptions& = {});
  static DevToolsWindow* AsDevToolsWindow(content::WebContents*);
  static bool HandleBeforeUnload(content::WebContents*, bool, bool*);
  static bool InterceptPageBeforeUnload(content::WebContents*);
  static bool NeedsToInterceptBeforeUnload(content::WebContents*);
  static void OnPageCloseCanceled(content::WebContents*);
  static void RegisterLinuxDevToolsLifecycle();
  void BindLinuxDevToolsLease(std::shared_ptr<ardiacore::LinuxDevToolsLease>, bool);
  void RevokeLinuxDevToolsLease(uint64_t);
  void SettleRevokedLinuxLoad();
  void ScheduleShow(const DevToolsToggleAction&);
  void Show(const DevToolsToggleAction&);
  void LoadCompleted();
  void OnLoadCompleted();
  void InspectedContentsClosing();
  void SetLoadCompletedCallback(base::OnceClosure);
  void ActivateInspectedTab();
  void ActivateWindow();
  void ActivateContents(content::WebContents*);
  void SetIsDocked(bool);
  void Close(DevToolsClosedByAction);
  void CloseWindow();
  void BeforeUnloadFired(content::WebContents*, bool, bool*);
  static content::WebContents* GetInTabWebContents(content::WebContents*, DevToolsContentsResizingStrategy*);
  content::WebContents* GetInspectedWebContents() { return inspected_; }
  raw_ptr<content::WebContents> GetDevToolsWebContents() { return main_web_contents_; }
  bool IsDocked() { return is_docked_; }
  ui::BaseWindow* GetInspectedBrowserWindow() {
    auto* browser = GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(inspected_);
    return browser ? browser->GetWindow() : nullptr;
  }
  void RegisterModalDialogManager(BrowserWindowInterface*) {}
  void OverrideAndSyncDevToolsRendererPrefs() {}
  void MaybeShowSharedProcessInfobar() {}
  void RemoveSharingInfoBar() {}
  void UpdateBrowserToolbar() { if (on_toolbar) on_toolbar(); }
  void UpdateBrowserWindow();
  void DoAction(const DevToolsToggleAction&) { actions++; }
  void CreateDevToolsBrowser() { browser_ = &undocked_browser_; }
  ardiacore::LinuxDevToolsState linux_devtools_state_;
  LifeStage life_stage_ = kNotLoaded;
  LifeStage linux_close_stage_ = kNotLoaded;
  Profile* profile_;
  content::WebContents* inspected_;
  raw_ptr<content::WebContents> main_web_contents_;
  raw_ptr<content::WebContents> toolbox_web_contents_ = nullptr;
  raw_ptr<BrowserWindowInterface> browser_ = nullptr;
  BrowserWindowInterface undocked_browser_{};
  Bindings binding_storage_;
  Bindings* bindings_ = &binding_storage_;
  bool is_docked_ = true;
  bool can_dock_ = true;
  bool intercepted_page_beforeunload_ = false;
  bool close_on_detach_ = true;
  bool sharing_infobar_ = false;
  int checked_sharing_process_id_ = 0;
  int actions = 0;
  DevToolsClosedByAction closed_by_ = DevToolsClosedByAction::kUnknown;
  DevToolsToggleAction action_on_load_ = DevToolsToggleAction::NoOp();
  base::OnceClosure load_completed_callback_;
  base::OnceClosure linux_load_completed_callback_;
  DevToolsContentsResizingStrategy contents_resizing_strategy_;
  std::unique_ptr<OwnedMainWebContents> owned_main_web_contents_;
  base::WeakPtrFactory<DevToolsWindow> weak_factory_{this};
  static inline std::map<content::WebContents*, std::unique_ptr<DevToolsWindow>> instances;
  static inline std::function<void(DevToolsWindow*)> on_create;
  static inline std::function<void()> on_toolbar;
};

inline std::vector<DevToolsWindow*> GetDevToolsWindowInstances() {
  std::vector<DevToolsWindow*> instances;
  for (const auto& [contents, window] : DevToolsWindow::instances) instances.push_back(window.get());
  return instances;
}
