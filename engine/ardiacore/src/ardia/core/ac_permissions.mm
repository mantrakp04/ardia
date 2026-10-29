#include "ardia/core/ac_permissions.h"

#include <map>
#include <memory>
#include <optional>
#include <variant>
#include <vector>

#include "base/memory/ptr_util.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/file_system_access/file_system_access_permission_request_manager.h"
#include "chrome/browser/permissions/system/system_permission_settings.h"
#include "components/permissions/embedded_permission_prompt_flow_model.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_uma_constants.h"
#include "components/permissions/permission_util.h"
#include "components/permissions/request_type.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_fake_media.h"
#include "ardia/core/ac_test_system_permissions.h"
#include "url/origin.h"

namespace ardiacore {

namespace {

NSString* KindName(permissions::RequestType type) {
  using permissions::RequestType;
  switch (type) {
    case RequestType::kCameraStream:
      return @"camera";
    case RequestType::kMicStream:
      return @"microphone";
    case RequestType::kCameraPanTiltZoom:
      return @"cameraPanTiltZoom";
    case RequestType::kGeolocation:
      return @"location";
    case RequestType::kNotifications:
      return @"notifications";
    case RequestType::kClipboard:
      return @"clipboard";
    case RequestType::kMidiSysex:
      return @"midi";
    case RequestType::kMultipleDownloads:
      return @"multipleDownloads";
    case RequestType::kLocalFonts:
      return @"localFonts";
    case RequestType::kIdleDetection:
      return @"idleDetection";
    case RequestType::kStorageAccess:
    case RequestType::kTopLevelStorageAccess:
      return @"storageAccess";
    case RequestType::kWindowManagement:
      return @"windowManagement";
    case RequestType::kFileSystemAccess:
      return @"fileSystem";
    case RequestType::kKeyboardLock:
      return @"keyboardLock";
    case RequestType::kPointerLock:
      return @"pointerLock";
    case RequestType::kRegisterProtocolHandler:
      return @"protocolHandler";
    case RequestType::kSensors:
      return @"sensors";
    case RequestType::kLocalNetwork:
    case RequestType::kLoopbackNetwork:
      return @"localNetwork";
    case RequestType::kVrSession:
      return @"vr";
    case RequestType::kArSession:
      return @"ar";
    case RequestType::kHandTracking:
      return @"handTracking";
    case RequestType::kIdentityProvider:
      return @"identityProvider";
    case RequestType::kWebAppInstallation:
      return @"webAppInstallation";
    case RequestType::kCapturedSurfaceControl:
      return @"capturedSurfaceControl";
    case RequestType::kDiskQuota:
      return @"diskQuota";
    default:
      return nil;
  }
}

class ACPermissionPrompt;

std::map<std::string, base::WeakPtr<ACPermissionPrompt>>& Prompts() {
  static base::NoDestructor<std::map<std::string, base::WeakPtr<ACPermissionPrompt>>>
      prompts;
  return *prompts;
}

using Variant = permissions::EmbeddedPermissionPromptFlowModel::Variant;

enum class Step { kAsk, kAlreadyAllowed, kSystemPrompt, kAcknowledge };

Step StepOf(permissions::PermissionPrompt::Delegate* delegate) {
  permissions::EmbeddedPermissionPromptFlowModel* flow =
      delegate->GetEmbeddedPromptFlowModel();
  if (!flow) {
    return Step::kAsk;
  }
  const bool later_step = delegate->WasCurrentRequestAlreadyDisplayed();
  switch (flow->prompt_variant()) {
    case Variant::kOsPrompt:
      return Step::kSystemPrompt;
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

class ACPermissionPrompt : public permissions::PermissionPrompt {
 public:
  ACPermissionPrompt(content::WebContents* contents, Delegate* delegate)
      : delegate_(delegate), step_(StepOf(delegate)) {
    static int last_id = 0;
    id_ = "p" + std::to_string(++last_id);
    Prompts()[id_] = weak_factory_.GetWeakPtr();
    switch (step_) {
      case Step::kAsk:
      case Step::kAlreadyAllowed:
        AskHost(contents);
        break;
      case Step::kSystemPrompt:
        PostToSelf(&ACPermissionPrompt::AskSystem);
        break;
      case Step::kAcknowledge:
        PostToSelf(&ACPermissionPrompt::Acknowledge);
        break;
    }
  }

  ~ACPermissionPrompt() override {
    Prompts().erase(id_);
    if (asked_host_ && !answered_) {
      NSString* request_id = base::SysUTF8ToNSString(id_);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(
                         [](NSString* request_id) {
                           HostPermissionRequestDismissed(request_id);
                         },
                         request_id));
    }
  }

  void Resolve(const std::string& result, bool remember) {
    if (!asked_host_ || answered_) {
      return;
    }
    answered_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ACPermissionPrompt::Apply,
                                  weak_factory_.GetWeakPtr(), result, remember));
  }

  bool UpdateAnchor() override { return true; }
  TabSwitchingBehavior GetTabSwitchingBehavior() override {
    return TabSwitchingBehavior::kKeepPromptAlive;
  }
  permissions::PermissionPromptDisposition GetPromptDisposition() const override {
    return permissions::PermissionPromptDisposition::CUSTOM_MODAL_DIALOG;
  }
  bool IsAskPrompt() const override { return step_ == Step::kAsk; }
  std::optional<gfx::Rect> GetViewBoundsInScreen() const override {
    return std::nullopt;
  }
  std::vector<permissions::ElementAnchoredBubbleVariant> GetPromptVariants()
      const override {
    return {};
  }
  std::optional<permissions::feature_params::PermissionElementPromptPosition>
  GetPromptPosition() const override {
    return std::nullopt;
  }

 private:
  void AskHost(content::WebContents* contents) {
    asked_host_ = true;
    NSMutableOrderedSet<NSString*>* kinds = [NSMutableOrderedSet orderedSet];
    for (const auto& request : delegate_->Requests()) {
      if (NSString* kind = KindName(request->request_type())) {
        [kinds addObject:kind];
      }
    }
    NSDictionary* request = @{
      @"id" : base::SysUTF8ToNSString(id_),
      @"origin" : base::SysUTF8ToNSString(delegate_->GetRequestingOrigin().spec()),
      @"permissions" : kinds.array,
    };
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<ACPermissionPrompt> prompt,
               base::WeakPtr<content::WebContents> contents, NSDictionary* request) {
              if (prompt && contents) {
                HostPermissionRequest(contents.get(), request);
              }
            },
            weak_factory_.GetWeakPtr(), contents->GetWeakPtr(), request));
  }

  void PostToSelf(void (ACPermissionPrompt::*step)()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(step, weak_factory_.GetWeakPtr()));
  }

  bool Current() const { return delegate_->GetCurrentPrompt() == this; }

  void Apply(const std::string& result, bool remember) {
    if (!Current()) {
      return;
    }
    Delegate* delegate = delegate_;
    const PromptOptions options(std::monostate{});
    if (step_ == Step::kAlreadyAllowed) {
      if (result == "deny" && remember) {
        delegate->Deny(options);
      } else {
        delegate->Dismiss(options);
      }
      return;
    }
    if (result == "accept") {
      bool one_time = !remember;
      for (const auto& request : delegate->Requests()) {
        one_time &= permissions::PermissionUtil::DoesSupportTemporaryGrants(
            request->GetContentSettingsType());
      }
      if (one_time) {
        delegate->AcceptThisTime(options);
      } else {
        delegate->Accept(options);
      }
    } else if (result == "deny" && remember) {
      delegate->Deny(options);
    } else {
      delegate->Dismiss(options);
    }
  }

  void AskSystem() {
    if (!Current()) {
      return;
    }
    std::vector<ContentSettingsType> types;
    for (const auto& request : delegate_->Requests()) {
      types.push_back(request->GetContentSettingsType());
    }
    pending_system_answers_ = types.size();
    for (ContentSettingsType type : types) {
      system_permission_settings::Request(
          type, base::BindOnce(&ACPermissionPrompt::OnSystemAnswer,
                               weak_factory_.GetWeakPtr(), types));
    }
  }

  void OnSystemAnswer(std::vector<ContentSettingsType> types) {
    if (pending_system_answers_ == 0 || --pending_system_answers_ > 0 || !Current()) {
      return;
    }
    for (ContentSettingsType type : types) {
      if (system_permission_settings::CanPrompt(type)) {
        return;
      }
    }
    delegate_->AdvanceOrFinalizeEmbeddedPromptFlow();
  }

  void Acknowledge() {
    if (Current()) {
      delegate_->Dismiss(PromptOptions(std::monostate{}));
    }
  }

  const raw_ptr<Delegate> delegate_;
  const Step step_;
  std::string id_;
  bool asked_host_ = false;
  bool answered_ = false;
  size_t pending_system_answers_ = 0;
  base::WeakPtrFactory<ACPermissionPrompt> weak_factory_{this};
};

std::unique_ptr<permissions::PermissionPrompt> CreatePrompt(
    content::WebContents* contents,
    permissions::PermissionPrompt::Delegate* delegate,
    bool* default_handling) {
  if (!WindowHost::ForContents(contents)) {
    *default_handling = true;
    return nullptr;
  }
  *default_handling = false;
  return std::make_unique<ACPermissionPrompt>(contents, delegate);
}

using RestoreCallback = base::OnceCallback<void(permissions::PermissionAction)>;

class ACFileRestorePrompt : public content::WebContentsObserver {
 public:
  static std::map<std::string, std::unique_ptr<ACFileRestorePrompt>>& All() {
    static base::NoDestructor<std::map<std::string, std::unique_ptr<ACFileRestorePrompt>>>
        prompts;
    return *prompts;
  }

  static void Start(content::WebContents* contents,
                    const url::Origin& origin,
                    RestoreCallback callback) {
    static int last_id = 0;
    const std::string id = "r" + std::to_string(++last_id);
    All()[id] = base::WrapUnique(new ACFileRestorePrompt(contents, id, std::move(callback)));
    NSDictionary* request = @{
      @"id" : base::SysUTF8ToNSString(id),
      @"origin" : base::SysUTF8ToNSString(origin.GetURL().spec()),
      @"permissions" : @[ @"fileSystem" ],
    };
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](std::string id, NSDictionary* request) {
                         auto it = All().find(id);
                         if (it != All().end() && it->second->web_contents()) {
                           HostPermissionRequest(it->second->web_contents(), request);
                         }
                       },
                       id, request));
  }

  static bool Resolve(const std::string& id, const std::string& result, bool remember) {
    if (!All().contains(id)) {
      return false;
    }
    permissions::PermissionAction action = permissions::PermissionAction::DISMISSED;
    if (result == "accept") {
      action = permissions::PermissionAction::GRANTED_ONCE;
    } else if (result == "deny" && remember) {
      action = permissions::PermissionAction::DENIED;
    }
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ACFileRestorePrompt::Finish, id, action,
                                  false));
    return true;
  }

  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsInPrimaryMainFrame() && navigation->HasCommitted() &&
        !url::IsSameOriginWith(navigation->GetPreviousPrimaryMainFrameURL(),
                               navigation->GetURL())) {
      Dismiss();
    }
  }
  void WebContentsDestroyed() override { Dismiss(); }

 private:
  ACFileRestorePrompt(content::WebContents* contents,
                      std::string id,
                      RestoreCallback callback)
      : content::WebContentsObserver(contents),
        id_(std::move(id)),
        callback_(std::move(callback)) {}

  void Dismiss() {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ACFileRestorePrompt::Finish, id_,
                                  permissions::PermissionAction::DISMISSED,
                                  true));
    Observe(nullptr);
  }

  static void Finish(std::string id, permissions::PermissionAction action, bool tell_host) {
    auto it = All().find(id);
    if (it == All().end()) {
      return;
    }
    RestoreCallback callback = std::move(it->second->callback_);
    All().erase(it);
    if (tell_host) {
      HostPermissionRequestDismissed(base::SysUTF8ToNSString(id));
    }
    std::move(callback).Run(action);
  }

  const std::string id_;
  RestoreCallback callback_;
};

bool AskHostToRestoreFiles(
    const FileSystemAccessPermissionRequestManager::RequestData& request,
    RestoreCallback& callback,
    content::WebContents* contents) {
  if (!WindowHost::ForContents(contents)) {
    return false;
  }
  ACFileRestorePrompt::Start(contents, request.origin, std::move(callback));
  return true;
}

}

void InstallPermissionPrompts() {
  MaybeInstallTestSystemPermissions();
  InstallFakeMediaDevices();
  g_ardia_create_permission_prompt = &CreatePrompt;
  g_ardia_file_system_restore_prompt = &AskHostToRestoreFiles;
}

void ResolvePermission(const std::string& request_id,
                       const std::string& result,
                       bool remember) {
  if (ACFileRestorePrompt::Resolve(request_id, result, remember)) {
    return;
  }
  auto it = Prompts().find(request_id);
  if (it == Prompts().end() || !it->second) {
    return;
  }
  it->second->Resolve(result, remember);
}

}
