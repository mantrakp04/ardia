#include <algorithm>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "ardia/linux/ac_linux_page_prompt_policy.h"
#include "ardia/linux/ac_linux_page_prompts_internal.h"
#include "base/functional/bind.h"
#include "base/memory/ptr_util.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/file_system_access/file_system_access_permission_request_manager.h"
#include "components/permissions/embedded_permission_prompt_flow_model.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_uma_constants.h"
#include "components/permissions/permission_util.h"
#include "components/permissions/request_type.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "url/origin.h"

extern std::unique_ptr<permissions::PermissionPrompt> (*g_ardia_create_permission_prompt)(
    content::WebContents* web_contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling);

extern bool (*g_ardia_file_system_restore_prompt)(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    base::OnceCallback<void(permissions::PermissionAction)>& callback,
    content::WebContents* web_contents);

extern int (*g_ardia_linux_permission_tab_shown)(content::WebContents*);

namespace ardiacore::linux_page_prompts {
namespace {

const char* KindName(permissions::RequestType type) {
  using permissions::RequestType;
  switch (type) {
    case RequestType::kCameraStream:
      return "camera";
    case RequestType::kMicStream:
      return "microphone";
    case RequestType::kCameraPanTiltZoom:
      return "cameraPanTiltZoom";
    case RequestType::kGeolocation:
      return "location";
    case RequestType::kNotifications:
      return "notifications";
    case RequestType::kClipboard:
      return "clipboard";
    case RequestType::kMidiSysex:
      return "midi";
    case RequestType::kMultipleDownloads:
      return "multipleDownloads";
    case RequestType::kLocalFonts:
      return "localFonts";
    case RequestType::kIdleDetection:
      return "idleDetection";
    case RequestType::kStorageAccess:
    case RequestType::kTopLevelStorageAccess:
      return "storageAccess";
    case RequestType::kWindowManagement:
      return "windowManagement";
    case RequestType::kFileSystemAccess:
      return "fileSystem";
    case RequestType::kKeyboardLock:
      return "keyboardLock";
    case RequestType::kPointerLock:
      return "pointerLock";
    case RequestType::kRegisterProtocolHandler:
      return "protocolHandler";
    case RequestType::kSensors:
      return "sensors";
    case RequestType::kLocalNetwork:
    case RequestType::kLoopbackNetwork:
      return "localNetwork";
    case RequestType::kVrSession:
      return "vr";
    case RequestType::kArSession:
      return "ar";
    case RequestType::kHandTracking:
      return "handTracking";
    case RequestType::kIdentityProvider:
      return "identityProvider";
    case RequestType::kWebAppInstallation:
      return "webAppInstallation";
    case RequestType::kCapturedSurfaceControl:
      return "capturedSurfaceControl";
    case RequestType::kDiskQuota:
      return "diskQuota";
    default:
      return nullptr;
  }
}

void TellDismissed(int asked_window, base::WeakPtr<content::WebContents> contents, std::string id) {
  const int current = contents ? TabFor(contents.get()).window : 0;
  Deliver(asked_window, "permissions.dismissed", base::DictValue().Set("id", id));
  if (current && current != asked_window) Deliver(current, "permissions.dismissed", base::DictValue().Set("id", id));
}

class LinuxPermissionPrompt;

std::map<std::string, base::WeakPtr<LinuxPermissionPrompt>>& Prompts() {
  static base::NoDestructor<std::map<std::string, base::WeakPtr<LinuxPermissionPrompt>>> prompts;
  return *prompts;
}

using Variant = permissions::EmbeddedPermissionPromptFlowModel::Variant;

enum class Step { kAsk, kAlreadyAllowed, kAdvance, kAcknowledge };

Step StepOf(permissions::PermissionPrompt::Delegate* delegate) {
  permissions::EmbeddedPermissionPromptFlowModel* flow = delegate->GetEmbeddedPromptFlowModel();
  if (!flow) return Step::kAsk;
  const bool later_step = delegate->WasCurrentRequestAlreadyDisplayed();
  switch (flow->prompt_variant()) {
    case Variant::kOsPrompt:
      return Step::kAdvance;
    case Variant::kAsk:
    case Variant::kPreviouslyDenied:
      return later_step ? Step::kAcknowledge : Step::kAsk;
    case Variant::kPreviouslyGranted:
      return later_step ? Step::kAcknowledge : Step::kAlreadyAllowed;
    case Variant::kOsSystemSettings:
    case Variant::kAdministratorGranted:
    case Variant::kAdministratorDenied:
    case Variant::kUninitialized:
      return Step::kAcknowledge;
  }
  return Step::kAcknowledge;
}

class LinuxPermissionPrompt : public permissions::PermissionPrompt {
 public:
  LinuxPermissionPrompt(content::WebContents* contents, Delegate* delegate, int window)
      : delegate_(delegate), step_(StepOf(delegate)), contents_(contents->GetWeakPtr()) {
    static int last_id = 0;
    id_ = "p" + std::to_string(++last_id);
    Prompts()[id_] = weak_factory_.GetWeakPtr();
    switch (step_) {
      case Step::kAsk:
      case Step::kAlreadyAllowed:
        AskHost(window);
        break;
      case Step::kAdvance:
        PostToSelf(&LinuxPermissionPrompt::Advance);
        break;
      case Step::kAcknowledge:
        PostToSelf(&LinuxPermissionPrompt::Acknowledge);
        break;
    }
  }

  ~LinuxPermissionPrompt() override {
    Prompts().erase(id_);
    if (asked_window_ && !answered_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(&TellDismissed, asked_window_, contents_, id_));
    }
  }

  bool Resolve(int window, linux_page_prompts::PermissionAnswer answer, bool remember) {
    if (!asked_window_ || answered_ || !contents_) return true;
    if (TabFor(contents_.get()).window != window) return false;
    answered_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxPermissionPrompt::Apply, weak_factory_.GetWeakPtr(), answer, remember));
    return true;
  }

  void Redeliver() {
    if (!asked_window_ || answered_ || !contents_ || request_.empty()) return;
    const LinuxPromptTab tab = TabFor(contents_.get());
    if (!tab.window) return;
    if (tab.window != asked_window_) {
      Deliver(asked_window_, "permissions.dismissed", base::DictValue().Set("id", id_));
      asked_window_ = tab.window;
    }
    base::DictValue request = request_.Clone();
    request.Set("tabId", tab.key);
    Deliver(tab.window, "permissions.requested", std::move(request));
  }

  content::WebContents* contents() const { return contents_.get(); }

  bool UpdateAnchor() override { return true; }
  TabSwitchingBehavior GetTabSwitchingBehavior() override { return TabSwitchingBehavior::kKeepPromptAlive; }
  permissions::PermissionPromptDisposition GetPromptDisposition() const override {
    return permissions::PermissionPromptDisposition::CUSTOM_MODAL_DIALOG;
  }
  bool IsAskPrompt() const override { return step_ == Step::kAsk; }
  std::optional<gfx::Rect> GetViewBoundsInScreen() const override { return std::nullopt; }
  std::vector<permissions::ElementAnchoredBubbleVariant> GetPromptVariants() const override { return {}; }
  std::optional<permissions::feature_params::PermissionElementPromptPosition> GetPromptPosition() const override {
    return std::nullopt;
  }

 private:
  void AskHost(int window) {
    asked_window_ = window;
    base::ListValue kinds;
    std::vector<std::string> seen;
    for (const auto& request : delegate_->Requests()) {
      const char* kind = KindName(request->request_type());
      if (!kind || std::find(seen.begin(), seen.end(), kind) != seen.end()) continue;
      seen.push_back(kind);
      kinds.Append(kind);
    }
    base::DictValue request = base::DictValue()
        .Set("id", id_)
        .Set("origin", delegate_->GetRequestingOrigin().spec())
        .Set("permissions", std::move(kinds));
    request_ = request.Clone();
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::WeakPtr<LinuxPermissionPrompt> prompt, base::DictValue request) {
                         if (!prompt || !prompt->contents_) return;
                         const LinuxPromptTab tab = TabFor(prompt->contents_.get());
                         prompt->asked_window_ = tab.window;
                         request.Set("tabId", tab.key);
                         if (!tab.window || !Deliver(tab.window, "permissions.requested", std::move(request))) {
                           prompt->asked_window_ = 0;
                           prompt->Ignore();
                         }
                       },
                       weak_factory_.GetWeakPtr(), std::move(request)));
  }

  void PostToSelf(void (LinuxPermissionPrompt::*step)()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
                                                                base::BindOnce(step, weak_factory_.GetWeakPtr()));
  }

  bool Current() const { return delegate_->GetCurrentPrompt() == this; }

  void Apply(linux_page_prompts::PermissionAnswer answer, bool remember) {
    if (!Current()) return;
    bool temporary = true;
    for (const auto& request : delegate_->Requests()) {
      temporary &= permissions::PermissionUtil::DoesSupportTemporaryGrants(request->GetContentSettingsType());
    }
    const PromptOptions options(std::monostate{});
    switch (linux_page_prompts::DecidePermission(step_ == Step::kAlreadyAllowed, answer, remember, temporary)) {
      case linux_page_prompts::PermissionAction::kAccept:
        return delegate_->Accept(options);
      case linux_page_prompts::PermissionAction::kAcceptThisTime:
        return delegate_->AcceptThisTime(options);
      case linux_page_prompts::PermissionAction::kDeny:
        return delegate_->Deny(options);
      case linux_page_prompts::PermissionAction::kDismiss:
        return delegate_->Dismiss(options);
    }
  }

  void Advance() {
    if (Current()) delegate_->AdvanceOrFinalizeEmbeddedPromptFlow();
  }

  void Acknowledge() {
    if (Current()) delegate_->Dismiss(PromptOptions(std::monostate{}));
  }

  void Ignore() {
    if (Current()) delegate_->Ignore(PromptOptions(std::monostate{}));
  }

  const raw_ptr<Delegate> delegate_;
  const Step step_;
  const base::WeakPtr<content::WebContents> contents_;
  std::string id_;
  int asked_window_ = 0;
  bool answered_ = false;
  base::DictValue request_;
  base::WeakPtrFactory<LinuxPermissionPrompt> weak_factory_{this};
};

std::unique_ptr<permissions::PermissionPrompt> CreatePrompt(content::WebContents* contents,
                                                            permissions::PermissionPrompt::Delegate* delegate,
                                                            bool* default_handling) {
  const LinuxPromptTab tab = contents ? TabFor(contents) : LinuxPromptTab();
  if (!tab.window) {
    *default_handling = true;
    return nullptr;
  }
  *default_handling = false;
  if (delegate->ShouldCurrentRequestUseQuietUI() && delegate->ShouldDropCurrentRequestIfCannotShowQuietly()) {
    return nullptr;
  }
  return std::make_unique<LinuxPermissionPrompt>(contents, delegate, tab.window);
}

using RestoreCallback = base::OnceCallback<void(permissions::PermissionAction)>;

class LinuxFileRestorePrompt : public content::WebContentsObserver {
 public:
  static std::map<std::string, std::unique_ptr<LinuxFileRestorePrompt>>& All() {
    static base::NoDestructor<std::map<std::string, std::unique_ptr<LinuxFileRestorePrompt>>> prompts;
    return *prompts;
  }

  static void Start(content::WebContents* contents, int window, const url::Origin& origin, RestoreCallback callback) {
    static int last_id = 0;
    const std::string id = "r" + std::to_string(++last_id);
    All()[id] = base::WrapUnique(new LinuxFileRestorePrompt(contents, id, window, std::move(callback)));
    All()[id]->origin_ = origin.GetURL().spec();
    base::DictValue request = base::DictValue()
        .Set("id", id)
        .Set("origin", origin.GetURL().spec())
        .Set("permissions", base::ListValue().Append("fileSystem"));
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](std::string id, base::DictValue request) {
                         auto it = All().find(id);
                         if (it == All().end() || !it->second->web_contents()) return;
                         const LinuxPromptTab tab = TabFor(it->second->web_contents());
                         it->second->window_ = tab.window;
                         request.Set("tabId", tab.key);
                         if (!tab.window || !Deliver(tab.window, "permissions.requested", std::move(request))) {
                           it->second->window_ = 0;
                           it->second->Dismiss();
                         }
                       },
                       id, std::move(request)));
  }

  static std::optional<bool> Resolve(int window, const std::string& id, linux_page_prompts::PermissionAnswer answer,
                                     bool remember) {
    auto it = All().find(id);
    if (it == All().end()) return std::nullopt;
    if (!it->second->web_contents() || TabFor(it->second->web_contents()).window != window) return false;
    permissions::PermissionAction action = permissions::PermissionAction::DISMISSED;
    if (answer == linux_page_prompts::PermissionAnswer::kAccept) {
      action = permissions::PermissionAction::GRANTED_ONCE;
    } else if (answer == linux_page_prompts::PermissionAnswer::kDeny && remember) {
      action = permissions::PermissionAction::DENIED;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxFileRestorePrompt::Finish, id, action, false));
    return true;
  }

  static void RedeliverFor(content::WebContents* contents) {
    for (auto& [id, prompt] : All()) {
      if (prompt->web_contents() != contents || !prompt->window_) continue;
      const LinuxPromptTab tab = TabFor(contents);
      if (!tab.window) continue;
      if (tab.window != prompt->window_) {
        Deliver(prompt->window_, "permissions.dismissed", base::DictValue().Set("id", id));
        prompt->window_ = tab.window;
      }
      Deliver(tab.window, "permissions.requested", base::DictValue()
          .Set("id", id).Set("tabId", tab.key).Set("origin", prompt->origin_)
          .Set("permissions", base::ListValue().Append("fileSystem")));
    }
  }

  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsInPrimaryMainFrame() && navigation->HasCommitted() &&
        !url::IsSameOriginWith(navigation->GetPreviousPrimaryMainFrameURL(), navigation->GetURL())) {
      Dismiss();
    }
  }
  void WebContentsDestroyed() override { Dismiss(); }

 private:
  LinuxFileRestorePrompt(content::WebContents* contents, std::string id, int window, RestoreCallback callback)
      : content::WebContentsObserver(contents),
        id_(std::move(id)),
        window_(window),
        callback_(std::move(callback)) {}

  void Dismiss() {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&LinuxFileRestorePrompt::Finish, id_, permissions::PermissionAction::DISMISSED, true));
    Observe(nullptr);
  }

  static void Finish(std::string id, permissions::PermissionAction action, bool tell_host) {
    auto it = All().find(id);
    if (it == All().end()) return;
    RestoreCallback callback = std::move(it->second->callback_);
    const int window = it->second->window_;
    All().erase(it);
    if (tell_host && window) Deliver(window, "permissions.dismissed", base::DictValue().Set("id", id));
    std::move(callback).Run(action);
  }

  const std::string id_;
  int window_ = 0;
  std::string origin_;
  RestoreCallback callback_;
};

bool AskHostToRestoreFiles(const FileSystemAccessPermissionRequestManager::RequestData& request,
                           RestoreCallback& callback, content::WebContents* contents) {
  const LinuxPromptTab tab = contents ? TabFor(contents) : LinuxPromptTab();
  if (!tab.window) return false;
  LinuxFileRestorePrompt::Start(contents, tab.window, request.origin, std::move(callback));
  return true;
}

}

void InstallPermissionPrompts() {
  g_ardia_create_permission_prompt = &CreatePrompt;
  g_ardia_file_system_restore_prompt = &AskHostToRestoreFiles;
  g_ardia_linux_permission_tab_shown = [](content::WebContents* contents) {
    const LinuxPromptTab tab = contents ? TabFor(contents) : LinuxPromptTab();
    return tab.window ? tab.shown : -1;
  };
}

void RedeliverPermissions(content::WebContents* contents) {
  if (!contents) return;
  std::vector<base::WeakPtr<LinuxPermissionPrompt>> prompts;
  for (const auto& [id, prompt] : Prompts()) {
    if (prompt && prompt->contents() == contents) prompts.push_back(prompt);
  }
  for (const auto& prompt : prompts) {
    if (prompt) prompt->Redeliver();
  }
  LinuxFileRestorePrompt::RedeliverFor(contents);
}

std::string ResolvePermission(int window, const base::DictValue& input) {
  const std::string* id = input.FindString("id");
  const std::string* result = input.FindString("result");
  const std::optional<bool> remember = input.FindBool("remember");
  const auto answer = result ? ParsePermissionAnswer(*result) : std::nullopt;
  if (!id || !answer || !remember || input.size() != 3 ||
      (!ValidPromptId(*id, 'p') && !ValidPromptId(*id, 'r'))) {
    return "permissions.resolve requires {id, result: accept|deny|dismiss, remember}";
  }
  if ((*id)[0] == 'r') {
    const auto resolved = LinuxFileRestorePrompt::Resolve(window, *id, *answer, *remember);
    return resolved.value_or(true) ? std::string() : "The permission request belongs to another window";
  }
  auto it = Prompts().find(*id);
  if (it == Prompts().end() || !it->second) return std::string();
  return it->second->Resolve(window, *answer, *remember) ? std::string()
                                                         : "The permission request belongs to another window";
}

}
