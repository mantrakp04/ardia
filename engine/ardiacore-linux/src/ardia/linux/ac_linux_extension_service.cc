#include "ardia/linux/ac_linux_extension_service.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_contract.h"
#include "ardia/linux/ac_linux_extension_views.h"
#include "ardia/linux/ac_linux_extensions.h"
#include "ardia/linux/ac_linux_profile_service.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "base/base64.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/extensions/extension_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/extensions/extension_popup_types.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_install_prompt_client.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/install_prompt_data.h"
#include "extensions/common/extension.h"
#include "extensions/common/file_util.h"
#include "extensions/common/manifest.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"

namespace ardiacore {
bool BackgroundInstance();
}

extern bool (*g_ardia_extension_install_prompt)(
    Profile* profile,
    content::WebContents* parent,
    const extensions::InstallPromptData& prompt,
    extensions::ExtensionInstallPromptClient::DoneCallback* done_callback);

extern bool (*g_ardia_extension_side_panel)(
    BrowserWindowInterface* browser_window,
    content::WebContents* web_contents,
    const extensions::ExtensionId& extension_id,
    bool open);

extern std::optional<bool> (*g_ardia_open_action_popup)(
    BrowserWindowInterface& browser,
    const extensions::Extension& extension,
    ShowPopupCallback& callback,
    std::string* error);

namespace ardia {
namespace {

namespace ext = linux_extensions;
using Done = LinuxExtensionsDone;
using InstallDone = extensions::ExtensionInstallPromptClient::DoneCallback;
using InstallPayload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
using InstallResult = extensions::ExtensionInstallPromptClient::Result;

static_assert(ext::kPromptInstall == extensions::InstallPromptData::INSTALL_PROMPT);
static_assert(ext::kPromptReEnable == extensions::InstallPromptData::RE_ENABLE_PROMPT);
static_assert(ext::kPromptPermissions == extensions::InstallPromptData::PERMISSIONS_PROMPT);
static_assert(ext::kPromptExternal == extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT);
static_assert(ext::kPromptRemote == extensions::InstallPromptData::REMOTE_INSTALL_PROMPT);
static_assert(ext::kPromptRepair == extensions::InstallPromptData::REPAIR_PROMPT);

constexpr base::TaskTraits kFileReads = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                         base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN};
constexpr size_t kMaxCallJson = 1024 * 1024;

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

LinuxExtensionsDelegate& Delegate() {
  static base::NoDestructor<LinuxExtensionsDelegate> delegate;
  return *delegate;
}

void AbortPromptForDestroyedParent(std::string request);

class PromptParentWatch : public content::WebContentsObserver {
 public:
  explicit PromptParentWatch(content::WebContents* parent) : content::WebContentsObserver(parent) {}

  void Track(std::string request) { request_ = std::move(request); }

  void WebContentsDestroyed() override {
    Observe(nullptr);
    if (request_.empty()) return;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&AbortPromptForDestroyedParent, request_));
  }

 private:
  std::string request_;
};

struct PendingInstall {
  InstallDone done;
  base::WeakPtr<Profile> profile;
  std::unique_ptr<PromptParentWatch> parent;
};

ext::PromptLedger<PendingInstall>& Prompts() {
  static base::NoDestructor<ext::PromptLedger<PendingInstall>> prompts;
  return *prompts;
}

void Answer(PendingInstall pending, InstallResult result) {
  if (!pending.profile || pending.done.is_null()) return;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(pending.done), InstallPayload(result)));
}

void AbortPromptForDestroyedParent(std::string request) {
  const auto* entry = Prompts().Find(request);
  if (!entry) return;
  const int window = entry->window;
  auto pending = Prompts().Take(request);
  if (!pending) return;
  auto& delegate = Delegate();
  if (delegate.deliver) {
    delegate.deliver.Run(window, "extensions.installPromptCancelled", base::DictValue().Set("requestId", request));
  }
  Answer(std::move(*pending), InstallResult::ABORTED);
}

std::string ProfileId(const Profile* profile) {
  return ardiacore::LinuxProfileName(profile).value_or("");
}

const extensions::Extension* Enabled(content::BrowserContext* context, const std::string& id) {
  const extensions::Extension* extension = extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(id);
  if (extension && context->IsOffTheRecord() && !extensions::util::IsIncognitoEnabled(id, context)) return nullptr;
  return extension;
}

std::string PngDataUrl(const gfx::Image& image) {
  if (image.IsEmpty()) return "";
  const gfx::ImageSkiaRep& rep = image.ToImageSkia()->GetRepresentation(2.0f);
  const auto png = gfx::PNGCodec::EncodeBGRASkBitmap(rep.GetBitmap(), false);
  return png ? "data:image/png;base64," + base::Base64Encode(*png) : "";
}

std::string ReadIcon(const base::FilePath& root, const std::string& relative) {
  const auto clean = ext::ResourcePath(relative);
  if (!clean) return "";
  const base::FilePath real_root = base::MakeAbsoluteFilePath(root);
  const base::FilePath real_file = base::MakeAbsoluteFilePath(root.Append(*clean));
  if (real_root.empty() || real_file.empty() || !real_root.IsParent(real_file)) return "";
  std::string bytes;
  if (!base::ReadFileToStringWithMaxSize(real_file, &bytes, ext::kMaxIconBytes)) return "";
  return ext::DataUrl(*clean, bytes);
}

struct IconJob {
  std::string id;
  base::FilePath root;
  std::string relative;
};

std::map<std::string, std::string> ReadIcons(std::vector<IconJob> jobs) {
  std::map<std::string, std::string> icons;
  for (const auto& job : jobs) icons[job.id] = ReadIcon(job.root, job.relative);
  return icons;
}

struct EngineReply {
  std::string name;
  base::DictValue input;
  base::WeakPtr<Profile> profile;
  Done done;
};

void Decorated(base::WeakPtr<Profile> profile, base::ListValue entries, Done done,
               std::map<std::string, std::string> icons) {
  if (!profile) return Fail(std::move(done), "ERR_PROFILE", "The profile closed");
  auto* registry = extensions::ExtensionRegistry::Get(profile.get());
  base::ListValue list;
  for (const auto& entry : entries) {
    const std::string& id = *entry.GetDict().FindString("id");
    const extensions::Extension* extension = registry->GetExtensionById(id, extensions::ExtensionRegistry::EVERYTHING);
    std::optional<ext::ManifestFacts> facts;
    if (extension) facts = ext::ReadManifest(*extension->manifest()->value());
    list.Append(ext::DecorateEntry(entry.GetDict(), facts ? &*facts : nullptr, icons[id]));
  }
  std::move(done).Run(true, base::Value(base::DictValue().Set("extensions", std::move(list))));
}

void Listed(base::WeakPtr<Profile> profile, const base::Value& reply, Done done) {
  auto entries = ext::Entries(reply);
  if (!entries) return Fail(std::move(done), "ERR_BAD_REPLY", "The extension list is not valid");
  if (!profile) return Fail(std::move(done), "ERR_PROFILE", "The profile closed");
  auto* registry = extensions::ExtensionRegistry::Get(profile.get());
  std::vector<IconJob> jobs;
  for (const auto& entry : *entries) {
    const std::string& id = *entry.GetDict().FindString("id");
    const extensions::Extension* extension = registry->GetExtensionById(id, extensions::ExtensionRegistry::EVERYTHING);
    if (!extension) continue;
    const auto facts = ext::ReadManifest(*extension->manifest()->value());
    if (facts.action_icon_path) jobs.push_back({id, extension->path(), *facts.action_icon_path});
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, kFileReads, base::BindOnce(&ReadIcons, std::move(jobs)),
      base::BindOnce(&Decorated, profile, std::move(*entries), std::move(done)));
}

void EngineReplied(void* context, const char* json) {
  std::unique_ptr<EngineReply> reply(static_cast<EngineReply*>(context));
  auto value = json ? base::JSONReader::Read(json, base::JSON_PARSE_RFC) : std::nullopt;
  if (!value) return Fail(std::move(reply->done), "ERR_BAD_REPLY", "The engine reply is not JSON");
  if (value->is_dict()) {
    if (const base::Value* error = value->GetDict().Find("error")) {
      return Fail(std::move(reply->done), "ERR_ENGINE",
                  error->is_string() ? error->GetString() : "Engine service failed");
    }
  }
  if (reply->name == "extensions.list") return Listed(reply->profile, *value, std::move(reply->done));
  if (reply->name == "search.engines") {
    auto engines = ext::SearchEngines(*value);
    if (!engines) return Fail(std::move(reply->done), "ERR_BAD_REPLY", "Missing search engines");
    return std::move(reply->done).Run(true, base::Value(std::move(*engines)));
  }
  if (const auto change = ext::ChangeFor(reply->name, reply->input, *value); change && reply->profile) {
    Delegate().broadcast.Run(reply->profile.get(), "extensions.changed", ext::ChangeEvent(*change, ProfileId(reply->profile.get())));
  }
  std::move(reply->done).Run(true, std::move(*value));
}

void KeepDeveloperModeForReload(Profile* profile, const std::string& name, const base::DictValue& input) {
  if (!ext::ReloadsExtensionFolder(name, input)) return;
  const std::string* id = input.FindString("id");
  const extensions::Extension* extension =
      id ? extensions::ExtensionRegistry::Get(profile)->GetExtensionById(*id, extensions::ExtensionRegistry::EVERYTHING)
         : nullptr;
  if (!extension || !extensions::Manifest::IsUnpackedLocation(extension->location())) return;
  extensions::util::SetDeveloperModeForProfile(profile, true);
}

void Forward(Profile* profile, const std::string& name, base::DictValue input, Done done) {
  const auto* route = ardiacore::linux_contract::FindRoute(name);
  if (!route) return Fail(std::move(done), "ERR_UNKNOWN_CALL", "This call is unavailable on Linux");
  base::DictValue sent = input.Clone();
  if (name == "extensions.configure") {
    auto configured = ext::Configuration(input);
    if (!configured) return Fail(std::move(done), "ERR_EXTENSION_REQUEST", "Unsupported or invalid extension options");
    sent = std::move(*configured);
  }
  const auto json = base::WriteJson(sent);
  if (!json) return Fail(std::move(done), "ERR_EXTENSION_REQUEST", "The request is not JSON");
  KeepDeveloperModeForReload(profile, name, input);
  const std::string service(route->service);
  const std::string path = profile->GetPath().value();
  ac_engine_call(service.c_str(), path.c_str(), json->c_str(), &EngineReplied,
                 new EngineReply{name, std::move(input), profile->GetWeakPtr(), std::move(done)});
}

struct Inspected {
  std::string error;
  std::optional<ext::ManifestFacts> facts;
  std::string id;
  std::string icon;
};

Inspected Inspect(base::FilePath path) {
  Inspected result;
  std::u16string error;
  scoped_refptr<extensions::Extension> extension = extensions::file_util::LoadExtension(
      path, extensions::mojom::ManifestLocation::kUnpacked, extensions::Extension::FOLLOW_SYMLINKS_ANYWHERE, &error);
  if (!extension) {
    result.error = error.empty() ? "Manifest file is missing or unreadable" : base::UTF16ToUTF8(error);
    return result;
  }
  result.facts = ext::ReadManifest(*extension->manifest()->value());
  result.id = extension->id();
  if (result.facts->icon_path) result.icon = ReadIcon(path, *result.facts->icon_path);
  return result;
}

void InspectUnpacked(const base::DictValue& input, Done done) {
  const std::string path = *input.FindString("path");
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, kFileReads, base::BindOnce(&Inspect, base::FilePath(path)),
      base::BindOnce(
          [](std::string path, Done done, Inspected inspected) {
            if (!inspected.facts) return Fail(std::move(done), "ERR_EXTENSION_INVALID", inspected.error);
            std::move(done).Run(true, base::Value(ext::Package(*inspected.facts, inspected.id, path, inspected.icon)));
          },
          path, std::move(done)));
}

class FolderChooser : public ui::SelectFileDialog::Listener {
 public:
  static void Start(gfx::NativeWindow window, Done done) {
    auto* chooser = new FolderChooser(std::move(done));
    chooser->dialog_ = ui::SelectFileDialog::Create(chooser, nullptr);
    chooser->dialog_->SelectFile(ui::SelectFileDialog::SELECT_FOLDER, u"Select the extension's folder",
                                 base::FilePath(), nullptr, 0, base::FilePath::StringType(), window);
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override {
    const std::string path = file.path().value();
    Finish(ext::ValidFolderPath(path) ? base::Value(path) : base::Value());
  }
  void FileSelectionCanceled() override { Finish(base::Value()); }

 private:
  friend class base::DeleteHelper<FolderChooser>;

  explicit FolderChooser(Done done) : done_(std::move(done)) {}
  ~FolderChooser() override = default;

  void Finish(base::Value result) {
    if (done_) std::move(done_).Run(true, std::move(result));
    if (dialog_) dialog_->ListenerDestroyed();
    base::SingleThreadTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, this);
  }

  Done done_;
  scoped_refptr<ui::SelectFileDialog> dialog_;
};

void ResolvePrompt(const LinuxExtensionWindow& window, Profile* profile, const base::DictValue& input, Done done) {
  const std::string request = *input.FindString("requestId");
  switch (Prompts().Check(request, window.window, ProfileId(profile))) {
    case ext::PromptResolve::kUnknown:
      return Fail(std::move(done), "ERR_EXTENSION_PROMPT_STALE", "No such pending install prompt");
    case ext::PromptResolve::kWrongWindow:
    case ext::PromptResolve::kWrongProfile:
      return Fail(std::move(done), "ERR_EXTENSION_PROMPT_STALE", "The prompt belongs to another window");
    case ext::PromptResolve::kResolved:
      break;
  }
  auto pending = Prompts().Take(request);
  const bool accepted = input.Find("accepted")->GetBool();
  if (pending) Answer(std::move(*pending), accepted ? InstallResult::ACCEPTED : InstallResult::USER_CANCELED);
  std::move(done).Run(true, base::Value());
}

content::WebContents* ProfileTab(const LinuxExtensionWindow& window, Profile* profile, const std::string& key, std::string* code) {
  content::WebContents* contents = window.tab.Run(key);
  if (!contents) *code = "ERR_TAB_UNAVAILABLE";
  else if (contents->GetBrowserContext() != profile) *code = "ERR_PROFILE_WINDOW";
  return code->empty() ? contents : nullptr;
}

void ActionStates(const LinuxExtensionWindow& window, Profile* profile, const base::DictValue& input, Done done) {
  std::string code;
  content::WebContents* contents = ProfileTab(window, profile, *input.FindString("tabId"), &code);
  if (!contents) return Fail(std::move(done), code, "The tab is not this profile's tab in this window");
  content::BrowserContext* context = contents->GetBrowserContext();
  const int tab_id = extensions::ExtensionTabUtil::GetTabId(contents);
  base::DictValue states;
  for (const auto& id : *input.FindList("ids")) {
    const extensions::Extension* extension = Enabled(context, id.GetString());
    extensions::ExtensionAction* action =
        extension ? extensions::ExtensionActionManager::Get(context)->GetExtensionAction(*extension) : nullptr;
    if (!action) continue;
    gfx::Image icon = action->GetExplicitlySetIcon(tab_id);
    if (icon.IsEmpty()) icon = action->GetDeclarativeIcon(tab_id);
    ext::ActionFacts facts;
    facts.title = action->GetTitle(tab_id);
    facts.badge = action->GetDisplayBadgeText(tab_id);
    facts.badge_color = action->GetBadgeBackgroundColor(tab_id);
    facts.badge_text_color = action->GetBadgeTextColor(tab_id);
    facts.popup = action->GetPopupUrl(tab_id).spec();
    facts.enabled = action->GetIsVisible(tab_id);
    facts.icon = PngDataUrl(icon);
    states.Set(id.GetString(), ext::ActionState(facts));
  }
  std::move(done).Run(true, base::Value(std::move(states)));
}

void SidePanelUrl(const LinuxExtensionWindow& window, Profile* profile, const base::DictValue& input, Done done) {
  std::string code;
  content::WebContents* contents = ProfileTab(window, profile, *input.FindString("tabId"), &code);
  if (!contents) return Fail(std::move(done), code, "The tab is not this profile's tab in this window");
  content::BrowserContext* context = contents->GetBrowserContext();
  const extensions::Extension* extension = Enabled(context, *input.FindString("extensionId"));
  auto* service = extension ? extensions::SidePanelService::Get(context) : nullptr;
  if (!service) return std::move(done).Run(true, base::Value());
  const auto options = service->GetOptions(*extension, extensions::ExtensionTabUtil::GetTabId(contents));
  if (!options.path || !options.enabled.value_or(false)) return std::move(done).Run(true, base::Value());
  std::move(done).Run(true, base::Value(extension->GetResourceURL(*options.path).spec()));
}

bool InstallPromptHook(Profile* profile, content::WebContents* parent, const extensions::InstallPromptData& prompt,
                       InstallDone* done) {
  const extensions::Extension* extension = prompt.extension();
  auto& delegate = Delegate();
  if (!extension || !done || done->is_null() || !profile || profile->IsOffTheRecord() || !delegate.deliver) return false;
  if (prompt.type() == extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(std::move(*done), InstallPayload(InstallResult::ABORTED)));
    return true;
  }
  const int window = delegate.window_for.Run(profile, parent, 0);
  if (!window) return false;
  base::ListValue permissions;
  for (size_t i = 0; i < prompt.GetPermissionCount(); ++i) permissions.Append(base::UTF16ToUTF8(prompt.GetPermission(i)));
  std::string icon;
  if (!prompt.icon().IsEmpty()) {
    if (auto png = prompt.icon().As1xPNGBytes(); png && png->size())
      icon = "data:image/png;base64," + base::Base64Encode(base::span<const uint8_t>(*png));
  }
  const std::string key = delegate.tab_key.Run(window, parent);
  base::DictValue payload = base::DictValue()
      .Set("profile", ProfileId(profile))
      .Set("id", extension->id())
      .Set("name", extension->name())
      .Set("version", extension->VersionString())
      .Set("type", ext::PromptTypeName(prompt.type()))
      .Set("icon", icon)
      .Set("permissions", std::move(permissions))
      .Set("tabId", key.empty() ? base::Value() : base::Value(key));
  auto watch = parent ? std::make_unique<PromptParentWatch>(parent) : nullptr;
  PromptParentWatch* parent_watch = watch.get();
  auto request = Prompts().Add(ProfileId(profile), window, payload.Clone(),
                               PendingInstall{std::move(*done), profile->GetWeakPtr(), std::move(watch)});
  if (!request) {
    LOG(WARNING) << "[ardia] extension install prompt for " << extension->id() << ": too many pending prompts";
    return false;
  }
  payload.Set("requestId", *request);
  if (parent_watch) parent_watch->Track(*request);
  if (delegate.deliver.Run(window, "extensions.installPrompt", std::move(payload))) return true;
  auto pending = Prompts().Take(*request);
  if (pending) *done = std::move(pending->done);
  return false;
}

bool SidePanelHook(BrowserWindowInterface* browser, content::WebContents* contents,
                   const extensions::ExtensionId& extension_id, bool open) {
  auto& delegate = Delegate();
  if (!contents && browser && browser->GetActiveTabInterface()) contents = browser->GetActiveTabInterface()->GetContents();
  if (!contents || !delegate.deliver) return false;
  const BrowserWindowInterface* owner = GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  const int window = delegate.window_of_browser.Run(owner ? owner : browser);
  const std::string key = window ? delegate.tab_key.Run(window, contents) : std::string();
  if (key.empty()) return false;
  return delegate.deliver.Run(window, "extensions.sidePanel",
                              base::DictValue().Set("tabId", key).Set("extensionId", extension_id).Set("open", base::Value(open)));
}

std::optional<bool> ActionPopupHook(BrowserWindowInterface& browser, const extensions::Extension& extension,
                                    ShowPopupCallback& callback, std::string* error) {
  auto& delegate = Delegate();
  const int window = delegate.window_of_browser ? delegate.window_of_browser.Run(&browser) : 0;
  LinuxExtensionSurfaces* surfaces = window ? delegate.surfaces.Run(window) : nullptr;
  if (!surfaces) return std::nullopt;
  tabs::TabInterface* tab = browser.GetActiveTabInterface();
  const std::string key = tab && tab->GetContents() ? delegate.tab_key.Run(window, tab->GetContents()) : std::string();
  if (key.empty()) {
    *error = "Failed to open popup.";
    return false;
  }
  surfaces->ExpectPopup(extension.id(), std::move(callback));
  if (delegate.deliver.Run(window, "extensions.actionPopup",
                           base::DictValue().Set("tabId", key).Set("extensionId", extension.id()))) {
    return true;
  }
  if (auto taken = surfaces->TakePendingPopup()) callback = std::move(*taken);
  *error = "Failed to open popup.";
  return false;
}

void Retarget(int window, bool closing) {
  auto& delegate = Delegate();
  for (const auto& request : Prompts().OfWindow(window)) {
    const auto* entry = Prompts().Find(request);
    Profile* profile = entry ? entry->done.profile.get() : nullptr;
    if (closing && entry && entry->done.parent) {
      content::WebContents* tab = entry->done.parent->web_contents();
      const int holder = tab && profile && delegate.window_for ? delegate.window_for.Run(profile, tab, window) : 0;
      const std::string key = holder && delegate.tab_key ? delegate.tab_key.Run(holder, tab) : std::string();
      if (key.empty() || !Prompts().Move(request, holder)) continue;
      base::DictValue payload = Prompts().Find(request)->payload.Clone();
      payload.Set("tabId", key);
      if (delegate.deliver.Run(holder, "extensions.installPrompt", payload.Clone())) {
        Prompts().SetPayload(request, std::move(payload));
        continue;
      }
      if (auto pending = Prompts().Take(request)) Answer(std::move(*pending), InstallResult::USER_CANCELED);
      continue;
    }
    const int next = profile && delegate.window_for ? delegate.window_for.Run(profile, nullptr, window) : 0;
    if (next && Prompts().Move(request, next)) {
      base::DictValue payload = Prompts().Find(request)->payload.Clone();
      payload.Set("tabId", base::Value());
      if (delegate.deliver.Run(next, "extensions.installPrompt", std::move(payload))) continue;
    }
    if (auto pending = Prompts().Take(request)) Answer(std::move(*pending), InstallResult::USER_CANCELED);
  }
}

}

LinuxExtensionWindow::LinuxExtensionWindow() = default;
LinuxExtensionWindow::LinuxExtensionWindow(const LinuxExtensionWindow&) = default;
LinuxExtensionWindow& LinuxExtensionWindow::operator=(const LinuxExtensionWindow&) = default;
LinuxExtensionWindow::~LinuxExtensionWindow() = default;

LinuxExtensionsDelegate::LinuxExtensionsDelegate() = default;
LinuxExtensionsDelegate::LinuxExtensionsDelegate(LinuxExtensionsDelegate&&) = default;
LinuxExtensionsDelegate& LinuxExtensionsDelegate::operator=(LinuxExtensionsDelegate&&) = default;
LinuxExtensionsDelegate::~LinuxExtensionsDelegate() = default;

void LinuxExtensionsProfile(std::string_view requested, base::OnceCallback<void(Profile*, std::string)> done) {
  namespace profiles = ardiacore::linux_profiles;
  const auto name = profiles::ParseProfileName(requested);
  if (!name) return std::move(done).Run(nullptr, std::string(profiles::ProfileErrorCode(profiles::ProfileError::kInvalid)));
  if (name->kind == profiles::ProfileKind::kPrivate)
    return std::move(done).Run(nullptr, std::string(profiles::ProfileErrorCode(profiles::ProfileError::kPrivateService)));
  ardiacore::ResolveLinuxProfile(requested, base::BindOnce(
      [](base::OnceCallback<void(Profile*, std::string)> done, Profile* profile, profiles::ProfileError error) {
        if (profile && profile->IsOffTheRecord()) error = profiles::ProfileError::kPrivateService;
        if (!profile || error != profiles::ProfileError::kNone) {
          return std::move(done).Run(nullptr, std::string(profiles::ProfileErrorCode(
              error == profiles::ProfileError::kNone ? profiles::ProfileError::kUnavailable : error)));
        }
        std::move(done).Run(profile, std::string());
      },
      std::move(done)));
}

Profile* LinuxExtensionViewProfile(Profile* page_profile, std::string_view requested, std::string* code) {
  if (!page_profile) {
    *code = "ERR_WINDOW_CLOSED";
    return nullptr;
  }
  if (page_profile->IsOffTheRecord() && page_profile->ShutdownStarted()) {
    *code = "ERR_PROFILE_ENDING";
    return nullptr;
  }
  if (!ardiacore::LinuxProfileHosts(requested, page_profile)) {
    *code = "ERR_PROFILE_WINDOW";
    return nullptr;
  }
  return page_profile;
}

bool LinuxExtensionsHandles(std::string_view name) {
  return ext::LinuxHandles(name);
}

namespace {

void CallProfile(const LinuxExtensionWindow& window, const std::string& name, std::string_view requested,
                 base::OnceCallback<void(Profile*, std::string)> done) {
  if (window.profile && window.profile->IsOffTheRecord()) {
    switch (ext::PrivateWindowRoute(name, window.profile->ShutdownStarted())) {
      case ext::PrivateRoute::kWindow:
        return std::move(done).Run(window.profile, std::string());
      case ext::PrivateRoute::kOriginal:
        return std::move(done).Run(window.profile->GetOriginalProfile(), std::string());
      case ext::PrivateRoute::kEnding:
        return std::move(done).Run(nullptr, "ERR_PROFILE_ENDING");
      case ext::PrivateRoute::kRefused:
        return std::move(done).Run(nullptr, "ERR_PROFILE_PRIVATE");
    }
  }
  if (!ext::UsesWindowProfile(name)) return LinuxExtensionsProfile(requested, std::move(done));
  if (!window.profile) return std::move(done).Run(nullptr, "ERR_WINDOW_CLOSED");
  std::move(done).Run(window.profile, std::string());
}

void Dispatch(const LinuxExtensionWindow& window, const std::string& name, base::DictValue input, Done done,
              Profile* profile, std::string code) {
  if (!profile) {
    return Fail(std::move(done), code.empty() ? "ERR_PROFILE_UNAVAILABLE" : code,
                code == "ERR_PROFILE_PRIVATE" ? "Extensions are unavailable in private windows"
                                              : "The extension profile is unavailable");
  }
  if (name == "extensions.inspectUnpacked") return InspectUnpacked(input, std::move(done));
  if (name == "extensions.chooseFolder") {
    if (ardiacore::BackgroundInstance()) {
      LOG(WARNING) << "[ardia] extensions.chooseFolder: background instance, no folder panel shown";
      return std::move(done).Run(true, base::Value());
    }
    const gfx::NativeWindow owner = window.native_window ? window.native_window.Run() : gfx::NativeWindow();
    if (!owner) return Fail(std::move(done), "ERR_WINDOW_CLOSED", "The window closed before the folder picker opened");
    return FolderChooser::Start(owner, std::move(done));
  }
  if (name == "extensions.resolveInstallPrompt") return ResolvePrompt(window, profile, input, std::move(done));
  if (name == "extensions.actionStates") return ActionStates(window, profile, input, std::move(done));
  if (name == "extensions.sidePanelUrl") return SidePanelUrl(window, profile, input, std::move(done));
  Forward(profile, name, std::move(input), std::move(done));
}

}

void LinuxExtensionsCall(const LinuxExtensionWindow& window, std::string_view requested_profile,
                         const std::string& name, const base::Value* args, Done done) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!args || (!args->is_none() && !args->is_string()))
    return Fail(std::move(done), "ERR_EXTENSION_REQUEST", "Extension arguments must be JSON text");
  const std::string json = args->is_string() ? args->GetString() : "{}";
  if (json.size() > kMaxCallJson || json.find('\0') != std::string::npos)
    return Fail(std::move(done), "ERR_EXTENSION_REQUEST", "Oversized extension request");
  auto parsed = base::JSONReader::Read(json, base::JSON_PARSE_RFC, 32);
  if (!parsed || !parsed->is_dict())
    return Fail(std::move(done), "ERR_EXTENSION_REQUEST", "Extension arguments must be a JSON object");
  base::DictValue input = std::move(*parsed).TakeDict();
  if (const auto invalid = ext::ValidateRequest(name, input); !invalid.empty())
    return Fail(std::move(done), "ERR_EXTENSION_REQUEST", invalid);
  CallProfile(window, name, requested_profile, base::BindOnce(&Dispatch, window, name, std::move(input), std::move(done)));
}

std::string LinuxExecuteExtensionAction(content::WebContents* contents, const base::ListValue& values) {
  if (!contents || values.size() != 1 || !values[0].is_string() || !ext::ValidExtensionId(values[0].GetString()))
    return "";
  const extensions::Extension* extension = Enabled(contents->GetBrowserContext(), values[0].GetString());
  auto* runner = extensions::ExtensionActionRunner::GetForWebContents(contents);
  if (!extension || !runner) return "none";
  switch (runner->RunAction(extension, true)) {
    case extensions::ExtensionAction::ShowAction::kShowPopup:
      return "popup";
    case extensions::ExtensionAction::ShowAction::kToggleSidePanel:
      return "sidePanel";
    case extensions::ExtensionAction::ShowAction::kNone:
      return "none";
  }
  return "none";
}

void StartLinuxExtensions(LinuxExtensionsDelegate delegate) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Delegate() = std::move(delegate);
  g_ardia_extension_install_prompt = &InstallPromptHook;
  g_ardia_extension_side_panel = &SidePanelHook;
  g_ardia_open_action_popup = &ActionPopupHook;
}

void LinuxExtensionsWindowRetired(int window) {
  Retarget(window, false);
}

void LinuxExtensionsWindowClosing(int window) {
  Retarget(window, true);
}

}
