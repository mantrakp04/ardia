#include "ardia/linux/ac_linux_host.h"

#include <sys/stat.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_policy.h"
#include "ardia/linux/ac_linux_contract.h"
#include "ardia/linux/ac_linux_auto_pip_service.h"
#include "ardia/linux/ac_linux_autoplay.h"
#include "ardia/linux/ac_linux_web_store.h"
#include "ardia/linux/ac_linux_background_dialogs.h"
#include "ardia/linux/ac_linux_calendar_service.h"
#include "ardia/linux/ac_linux_close.h"
#include "ardia/linux/ac_linux_close_hooks.h"
#include "ardia/linux/ac_linux_credential_service.h"
#include "ardia/linux/ac_linux_credentials.h"
#include "ardia/linux/ac_linux_live_service.h"
#include "ardia/linux/ac_linux_sync_service.h"
#include "ardia/linux/ac_linux_dialog_views.h"
#include "ardia/linux/ac_linux_document_service.h"
#include "ardia/linux/ac_linux_downloads.h"
#include "ardia/linux/ac_linux_extension_keybindings.h"
#include "ardia/linux/ac_linux_extension_service.h"
#include "ardia/linux/ac_linux_extension_views.h"
#include "ardia/linux/ac_linux_extensions.h"
#include "ardia/linux/ac_linux_native_messaging.h"
#include "ardia/linux/ac_linux_files.h"
#include "ardia/linux/ac_linux_fullscreen_restore.h"
#include "ardia/linux/ac_linux_import_formats.h"
#include "ardia/linux/ac_linux_import_service.h"
#include "ardia/linux/ac_linux_launch_config.h"
#include "ardia/linux/ac_linux_page_channel.h"
#include "ardia/linux/ac_linux_page_commands.h"
#include "ardia/linux/ac_linux_memory_saver.h"
#include "ardia/linux/ac_linux_page_media.h"
#include "ardia/linux/ac_linux_power.h"
#include "ardia/linux/ac_linux_tab_policy.h"
#include "ardia/linux/ac_linux_launch_steps.h"
#include "ardia/linux/ac_linux_page_state.h"
#include "ardia/linux/ac_linux_private_services.h"
#include "ardia/linux/ac_linux_profile_service.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "ardia/core/ac_launch_switches.h"
#include "ardia/linux/ac_linux_session.h"
#include "ardia/linux/ac_linux_site_controls_service.h"
#include "ardia/linux/ac_linux_window_caption.h"
#include "ardia/linux/ac_linux_window_lifecycle.h"
#include "ardia/linux/ac_linux_favicons.h"
#include "ardia/linux/ac_linux_page_status.h"
#include "ardia/linux/ac_linux_suggest.h"
#include "ardia/linux/ac_linux_typeahead_input.h"
#include "ardia/linux/host_bootstrap.h"
#include "base/auto_reset.h"
#include "base/base_paths.h"
#include "base/base64.h"
#include "base/check.h"
#include "base/command_line.h"
#include "base/files/file_enumerator.h"
#include "base/files/file.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/process/process_handle.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/system/sys_info.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/sequence_bound.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "base/uuid.h"
#include "base/unguessable_token.h"
#include "base/values.h"
#include "chrome/browser/ardia/public/ac_engine.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/resource_coordinator/lifecycle_unit_state.mojom.h"
#include "chrome/browser/resource_coordinator/tab_lifecycle_unit_external.h"
#include "chrome/browser/tab_list/tab_removed_reason.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/create_browser_window.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/browser_window_state.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/exclusive_access/fullscreen_controller.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "chrome/browser/ui/view_ids.h"
#include "chrome/browser/ui/views/frame/browser_frame_view.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/browser_widget.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "chrome/browser/ui/views/tab_contents/chrome_web_contents_view_focus_helper.h"
#include "chrome/common/chrome_paths.h"
#include "components/search_engines/template_url.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "components/search_engines/template_url_service.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/sessions/core/session_id.h"
#include "components/version_info/version_info.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/page.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/url_data_source.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "content/public/browser/webui_config.h"
#include "content/public/browser/webui_config_map.h"
#include "content/public/common/url_constants.h"
#include "crypto/sha2.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "net/base/net_errors.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/blink/public/common/frame/user_activation_state.h"
#include "third_party/blink/public/mojom/favicon/favicon_url.mojom.h"
#include "ui/aura/client/focus_client.h"
#include "ui/aura/window.h"
#include "ui/aura/window_targeter.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/compositor_observer.h"
#include "ui/compositor/layer.h"
#include "ui/display/display.h"
#include "ui/display/screen.h"
#include "ui/aura/window_observer.h"
#include "ui/base/base_window.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/ime/input_method.h"
#include "ui/base/ime/text_input_type.h"
#include "ui/base/ime/text_input_client.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/rect_conversions.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/events/event_constants.h"
#include "ui/events/event.h"
#include "ui/events/event_handler.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/keycodes/keyboard_code_conversion.h"
#include "ui/native_theme/native_theme.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/controls/native/native_view_host.h"
#include "ui/views/focus/focus_manager.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"
#include "ui/views/view_targeter.h"
#include "ui/views/view_targeter_delegate.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_observer.h"
#include "ui/wm/core/window_modality_controller.h"
#include "url/gurl.h"
#include "url/origin.h"

extern bool (*g_ardia_keeps_window_without_tabs)(
    const BrowserWindowInterface* browser);
extern bool g_ardia_auto_picture_in_picture_off;
extern int (*g_ardia_linux_tab_shown)(content::WebContents*);
extern void (*g_ardia_linux_auto_pip_requested)(content::WebContents*);
extern void (*g_ardia_linux_page_host_binder)(content::RenderFrameHost&, blink::AssociatedInterfaceRegistry&);
extern bool (*g_ardia_linux_target_url)(content::WebContents*, const GURL&);
extern bool (*g_ardia_linux_renderer_unresponsive)(content::WebContents*,
                                                   content::RenderWidgetHost*,
                                                   const base::RepeatingClosure&);
extern bool (*g_ardia_linux_renderer_responsive)(content::WebContents*,
                                                 content::RenderWidgetHost*);
extern bool (*g_ardia_linux_off_the_record_navigation)(content::WebContents*, const GURL&);
extern void (*g_ardia_linux_devtools_opened_tab)(content::WebContents*, content::WebContents*, const GURL&);
extern void (*g_ardia_linux_devtools_open_url)(Profile*, const GURL&);
extern void (*g_ardia_linux_drag_ended)(BrowserWindowInterface*);
extern void (*g_ardia_devtools_dock_changed)(BrowserWindowInterface* browser,
                                             content::WebContents* inspected,
                                             content::WebContents* devtools);
extern base::FilePath (*g_ardia_native_messaging_manifest)(const std::string& host_name);

namespace ardia {
namespace {

constexpr size_t kDocumentLimit = linux_policy::kDocumentLimit;
constexpr size_t kAssetLimit = 32 * 1024 * 1024;
constexpr char kSessionName[] = "linux-session.json";

base::FilePath NativeMessagingManifest(const std::string& host_name) {
  std::unique_ptr<base::Environment> environment = base::Environment::Create();
  linux_native_messaging::Environment paths;
  paths.home = environment->GetVar("HOME").value_or("");
  paths.xdg_config_home = environment->GetVar("XDG_CONFIG_HOME").value_or("");
  paths.chrome_config_home = environment->GetVar("CHROME_CONFIG_HOME").value_or("");
  return base::FilePath(
      linux_native_messaging::FindManifest(linux_native_messaging::ExtraUserDirectories(paths), host_name));
}

class ShellHostView;
class HostMessageHandler;

class ViewportTargeter : public aura::WindowTargeter {
 public:
  explicit ViewportTargeter(std::vector<gfx::Rect> shape)
      : shape_(std::move(shape)) {}

  std::unique_ptr<HitTestRects> GetExtraHitTestShapeRects(
      aura::Window* target) const override {
    if (target != window()) return nullptr;
    return std::make_unique<HitTestRects>(shape_);
  }

 private:
  const std::vector<gfx::Rect> shape_;
};

class ViewportView : public views::WebView,
                     public views::ViewTargeterDelegate {
 public:
  METADATA_HEADER(ViewportView, views::WebView)

 public:
  explicit ViewportView(Profile* profile) : views::WebView(profile) {
    SetEventTargeter(std::make_unique<views::ViewTargeter>(this));
  }

  ~ViewportView() override { SetWebContents(nullptr); }

  void SetShape(std::vector<gfx::Rect> paint_shape,
                std::vector<gfx::Rect> shape) {
    shape_ = std::move(shape);
    paint_shape_ = std::move(paint_shape);
    ApplyTargeter();
  }

  void SetWebContents(content::WebContents* contents) override {
    if (auto* previous = web_contents(); previous && previous != contents) {
      if (auto* native = previous->GetNativeView()) native->layer()->SetAlphaShape(nullptr);
    }
    views::WebView::SetWebContents(contents);
    ApplyTargeter();
  }

  bool DoesIntersectRect(const views::View* target,
                         const gfx::Rect& rect) const override {
    return target == this && std::ranges::any_of(
        shape_, [&](const gfx::Rect& part) { return part.Intersects(rect); });
  }

 private:
  void ApplyTargeter() {
    if (auto* contents = web_contents()) {
      aura::Window* native = contents->GetNativeView();
      if (!native) return;
      native->layer()->SetAlphaShape(
          std::make_unique<ui::Layer::ShapeRects>(paint_shape_));
      native->SetEventTargeter(
          std::make_unique<ViewportTargeter>(shape_));
    }
  }

  std::vector<gfx::Rect> shape_;
  std::vector<gfx::Rect> paint_shape_;
};

BEGIN_METADATA(ViewportView)
END_METADATA

struct RequestedWindow {
  std::string id;
  std::string kind;
  std::string title;
  base::DictValue utility;
  base::WeakPtr<BrowserWindowInterface> browser;
  std::string page_profile;
  base::WeakPtr<Profile> app_profile;
  base::DictValue private_window;
  int opener_host = 0;
  uint64_t opener_generation = 0;
};
std::map<int, RequestedWindow>& RequestedWindows();

namespace linux_window = ardia::linux_window;

bool MayActivateNativeWindows() {
  const auto* command = base::CommandLine::ForCurrentProcess();
  return !ardiacore::BackgroundInstance() && !command->HasSwitch("headless") &&
         command->GetSwitchValueASCII("ozone-platform") != "headless";
}

linux_window::FocusLedger& WindowFocus() {
  static base::NoDestructor<linux_window::FocusLedger> ledger(MayActivateNativeWindows());
  return *ledger;
}

linux_window::FullScreenRestore& FullScreenRestorer() {
  static base::NoDestructor<linux_window::FullScreenRestore> restore;
  return *restore;
}

uint64_t& FullScreenRestoreEpoch() {
  static uint64_t epoch = 0;
  return epoch;
}

base::OneShotTimer& FullScreenRestoreTimer() {
  static base::NoDestructor<base::OneShotTimer> timer;
  return *timer;
}

bool GlobalScreenCoordinates() {
  return !ui::OzonePlatform::IsInitialized() ||
         ui::OzonePlatform::GetInstance()->GetPlatformProperties().supports_global_screen_coordinates;
}

linux_window::Rect LifecycleRect(const gfx::Rect& rect) {
  return {rect.x(), rect.y(), rect.width(), rect.height()};
}

linux_window::Rect PrimaryScreenRect() {
  auto* screen = display::Screen::Get();
  return screen ? LifecycleRect(screen->GetPrimaryDisplay().bounds()) : linux_window::Rect();
}

base::Value SharedFrameValue(const gfx::Rect& bounds) {
  if (!GlobalScreenCoordinates()) return base::Value();
  base::ListValue frame;
  for (const int value : linux_window::SharedFrame(LifecycleRect(bounds), PrimaryScreenRect())) frame.Append(value);
  return base::Value(std::move(frame));
}

constexpr char kWindowOutputs[] = "ArdiaLinuxWindowOutputs";

void ShowNativeWindow(BrowserWindowInterface* browser, linux_window::Presentation presentation) {
  if (presentation == linux_window::Presentation::kInactive) return browser->GetWindow()->ShowInactive();
  browser->GetWindow()->Show();
  browser->GetWindow()->Activate();
}

void ActivateNativeWindow(BrowserWindowInterface* browser, linux_window::Activation activation) {
  if (!browser || activation == linux_window::Activation::kNone) return;
  if (activation == linux_window::Activation::kShowInactive) return browser->GetWindow()->ShowInactive();
  browser->GetWindow()->Show();
  browser->GetWindow()->Activate();
}

int64_t FocusClockMs() {
  return base::TimeTicks::Now().since_origin().InMilliseconds();
}

class WindowPointerHandler : public ui::EventHandler {
 public:
  void OnMouseEvent(ui::MouseEvent* event) override {
    if (event->type() == ui::EventType::kMousePressed) WindowFocus().PointerPressed();
  }
  void OnTouchEvent(ui::TouchEvent* event) override {
    if (event->type() == ui::EventType::kTouchPressed) WindowFocus().PointerPressed();
  }
};

std::map<int, ShellHostView*>& Hosts() {
  static base::NoDestructor<std::map<int, ShellHostView*>> hosts;
  return *hosts;
}

uint64_t& ActivationClock() {
  static uint64_t clock = 0;
  return clock;
}

int& Revision() {
  static int rev = 0;
  return rev;
}

std::optional<int>& DragEscapeOwner() {
  static std::optional<int> owner;
  return owner;
}

uint64_t NextPageBindingGeneration() {
  static uint64_t generation = 0;
  return ++generation;
}

int TabId(content::WebContents* contents) {
  return sessions::SessionTabHelper::IdForTab(contents).id();
}

void CloseDevToolsTab(content::WebContents* contents) {
  if (!contents) return;
  GlobalBrowserCollection::GetInstance()->ForEach([contents](BrowserWindowInterface* browser) {
    TabStripModel* strip = browser->GetTabStripModel();
    const int index = strip ? strip->GetIndexOfWebContents(contents) : TabStripModel::kNoTab;
    if (index == TabStripModel::kNoTab) return true;
    strip->CloseWebContentsAt(index, TabCloseTypes::CLOSE_NONE);
    return false;
  });
}

std::string String(const base::DictValue& value, std::string_view key) {
  const std::string* text = value.FindString(key);
  return text ? *text : std::string();
}

const base::ListValue& Arguments(const base::DictValue& value) {
  static const base::NoDestructor<base::ListValue> empty;
  const base::ListValue* args = value.FindList("args");
  return args ? *args : *empty;
}

std::string ArgumentString(const base::ListValue& args, size_t index) {
  return index < args.size() && args[index].is_string()
             ? args[index].GetString()
             : std::string();
}

base::Value ProfileFailure(ardiacore::linux_profiles::ProfileError error) {
  return base::Value(base::DictValue()
      .Set("code", ardiacore::linux_profiles::ProfileErrorCode(error))
      .Set("message", ardiacore::linux_profiles::ProfileErrorMessage(error)));
}

constexpr size_t kPrivateWindowLimit = 1024 * 1024;

bool ValidUtilityPlacement(const base::DictValue* placement) {
  if (!placement || !placement->FindBool("maximized")) return false;
  const auto left = placement->FindInt("left");
  const auto top = placement->FindInt("top");
  const auto right = placement->FindInt("right");
  const auto bottom = placement->FindInt("bottom");
  if (!left || !top || !right || !bottom ||
      *left < -1000000 || *left > 1000000 ||
      *top < -1000000 || *top > 1000000) return false;
  const int64_t width = static_cast<int64_t>(*right) - *left;
  const int64_t height = static_cast<int64_t>(*bottom) - *top;
  return width >= 720 && height >= 480 && width <= 16384 && height <= 16384;
}

base::FilePath DocumentDirectory(Profile* profile) {
  return profile->GetPath().AppendASCII("Ardia");
}

bool PrepareDocuments(const base::FilePath& directory) {
  if (base::IsLink(directory) || !base::CreateDirectory(directory)) {
    return false;
  }
  const auto parent = base::MakeAbsoluteFilePath(directory.DirName());
  const auto resolved = base::MakeAbsoluteFilePath(directory);
  return !parent.empty() && parent.IsParent(resolved);
}

std::optional<std::string> ReadDocument(const base::FilePath& directory,
                                      const std::string& name) {
  if (!linux_policy::ValidDocumentName(name) ||
      !PrepareDocuments(directory)) {
    return std::nullopt;
  }
  const base::FilePath file = directory.AppendASCII(name);
  if (base::IsLink(file)) {
    return std::nullopt;
  }
  std::string contents;
  return base::ReadFileToStringWithMaxSize(file, &contents, linux_policy::DocumentLimit(name))
             ? std::make_optional(std::move(contents))
             : std::nullopt;
}

std::string StorageDigest(std::string_view contents) {
  return base::HexEncode(crypto::SHA256HashString(contents));
}

struct StoredDocument {
  linux_policy::StoredRead outcome = linux_policy::StoredRead::kFailed;
  std::string contents;
};

StoredDocument ReadStoredDocument(const base::FilePath& directory,
                                  const std::string& name) {
  struct stat info;
  const int error =
      lstat(directory.AppendASCII(name).value().c_str(), &info) == 0 ? 0 : errno;
  std::optional<std::string> contents =
      error ? std::nullopt : ReadDocument(directory, name);
  return {linux_policy::ClassifyStoredRead(error, contents.has_value()),
          contents.value_or(std::string())};
}

bool WriteDocument(const base::FilePath& directory,
                   const std::string& name,
                   const std::optional<std::string>& contents) {
  if (!linux_policy::ValidDocumentName(name) ||
      (contents && contents->size() > linux_policy::DocumentLimit(name)) ||
      !PrepareDocuments(directory)) {
    return false;
  }
  const base::FilePath file = directory.AppendASCII(name);
  if (base::IsLink(file)) {
    return false;
  }
  return contents ? base::ImportantFileWriter::WriteFileAtomically(file, *contents)
                  : !base::PathExists(file) || base::DeleteFile(file);
}

std::optional<base::DictValue> ReadSession(const base::FilePath& directory) {
  const auto text = ReadDocument(directory, kSessionName);
  if (!text) return std::nullopt;
  auto value = base::JSONReader::Read(*text, base::JSON_PARSE_RFC,
                                     kLinuxSessionMaxDepth);
  if (!value || !value->is_dict()) return std::nullopt;
  return MergeLinuxSession(base::DictValue(), base::DictValue(), value->GetDict());
}

struct SessionWriteResult {
  bool ok = false;
  base::DictValue previous;
  base::DictValue session;
};

SessionWriteResult MergeAndWriteSession(const base::FilePath& directory,
                                       base::DictValue base,
                                       base::DictValue local) {
  SessionWriteResult result;
  auto previous = ReadSession(directory);
  if (previous) result.previous = std::move(*previous);
  auto merged = MergeLinuxSession(base, local, result.previous);
  if (!merged) return result;
  const auto json = base::WriteJsonWithOptions(
      *merged, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION,
      kLinuxSessionMaxDepth);
  if (!json || json->size() > kLinuxSessionMaxBytes ||
      !WriteDocument(directory, kSessionName, json)) return result;
  result.session = std::move(*merged);
  result.ok = true;
  return result;
}

base::DictValue ReadDocuments(const base::FilePath& directory) {
  base::DictValue documents;
  if (!PrepareDocuments(directory)) {
    return documents;
  }
  base::FileEnumerator files(directory, false, base::FileEnumerator::FILES);
  size_t bytes = 0;
  for (auto file = files.Next(); !file.empty(); file = files.Next()) {
    const std::string name = file.BaseName().value();
    if (name == kSessionName || LinuxDocuments::Reserved(name) ||
        linux_policy::DocumentLimit(name) > kDocumentLimit) continue;
    auto contents = ReadDocument(directory, name);
    if (contents && documents.size() < 128 &&
        bytes + contents->size() <= kDocumentLimit) {
      bytes += contents->size();
      documents.Set(name, std::move(*contents));
    }
  }
  return documents;
}

scoped_refptr<base::SequencedTaskRunner> FileRunner() {
  static const base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN}));
  return *runner;
}

LinuxDocumentRead ReadCanonicalDocument(const base::FilePath& directory,
                                        std::string_view name) {
  LinuxDocumentRead result;
  if (!LinuxDocuments::Reserved(name) || !PrepareDocuments(directory)) {
    result.state = LinuxDocumentRead::State::kError;
    return result;
  }
  const auto path = directory.AppendASCII(name);
  if (base::IsLink(path)) {
    result.state = LinuxDocumentRead::State::kError;
    return result;
  }
  base::File file(path, base::File::FLAG_OPEN | base::File::FLAG_READ);
  if (!file.IsValid()) {
    result.state = file.error_details() == base::File::FILE_ERROR_NOT_FOUND
                       ? LinuxDocumentRead::State::kMissing
                       : LinuxDocumentRead::State::kError;
    return result;
  }
  const auto contents = ReadDocument(directory, std::string(name));
  if (!contents) {
    result.state = LinuxDocumentRead::State::kError;
    return result;
  }
  result.state = LinuxDocumentRead::State::kFound;
  auto value = base::JSONReader::Read(*contents, base::JSON_PARSE_RFC, 48);
  if (value && value->is_dict()) result.value = std::move(value->GetDict());
  else result.value.Set("format", "invalid");
  return result;
}

struct DocumentAuthority {
  explicit DocumentAuthority(base::FilePath directory)
      : scope(base::Uuid::GenerateRandomV4().AsLowercaseString()),
        service(FileRunner(), scope,
                base::Uuid::GenerateRandomV4().AsLowercaseString(),
                LinuxDocuments::Read([directory](std::string_view name) {
                  return ReadCanonicalDocument(directory, name);
                }),
                LinuxDocuments::Write([directory](const base::DictValue& value) {
                  const auto json = base::WriteJsonWithOptions(
                      value, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION, 48);
                  return json && WriteDocument(directory, kLinuxLiveEnvelope, json);
                })) {}
  const std::string scope;
  base::SequenceBound<LinuxDocumentService> service;
};

std::shared_ptr<DocumentAuthority> DocumentsFor(Profile* profile) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!profile || !profile->IsRegularProfile() || profile->GetPath().empty())
    return {};
  static base::NoDestructor<
      std::map<base::FilePath, std::weak_ptr<DocumentAuthority>>> authorities;
  const auto directory = DocumentDirectory(profile);
  auto& slot = (*authorities)[directory];
  auto authority = slot.lock();
  if (!authority) {
    authority = std::make_shared<DocumentAuthority>(directory);
    slot = authority;
  }
  return authority;
}

std::string AssetPath(const GURL& url) {
  const std::string path(url.path());
  return path == "/" || path.empty() ? "index.html" : path.substr(1);
}

std::string MimeType(std::string_view path) {
  const auto dot = path.rfind('.');
  const auto ext = dot == std::string_view::npos ? "" : path.substr(dot);
  if (ext == ".html") return "text/html";
  if (ext == ".js" || ext == ".mjs") return "application/javascript";
  if (ext == ".css") return "text/css";
  if (ext == ".json") return "application/json";
  if (ext == ".svg") return "image/svg+xml";
  if (ext == ".png") return "image/png";
  if (ext == ".ico") return "image/x-icon";
  if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
  if (ext == ".webp") return "image/webp";
  if (ext == ".gif") return "image/gif";
  if (ext == ".avif") return "image/avif";
  if (ext == ".woff") return "font/woff";
  if (ext == ".woff2") return "font/woff2";
  if (ext == ".ttf") return "font/ttf";
  return {};
}

base::FilePath AssetDirectory() {
  const base::CommandLine* command = base::CommandLine::ForCurrentProcess();
  if (command->HasSwitch("ardia-ui-dir")) {
    return command->GetSwitchValuePath("ardia-ui-dir");
  }
  base::FilePath directory;
  base::PathService::Get(base::DIR_EXE, &directory);
  return directory.AppendASCII("ardia-ui");
}

std::optional<std::string> ReadAsset(base::FilePath directory,
                                   std::string path,
                                   base::FilePath documents,
                                   base::DictValue bootstrap) {
  if (!linux_policy::ValidAssetPath(path) || MimeType(path).empty()) {
    return std::nullopt;
  }
  if (path == "host-bootstrap.js") {
    base::DictValue saved = ReadDocuments(documents);
    if (auto session = ReadSession(documents)) {
      bootstrap.Set("session", std::move(*session));
    }
    bootstrap.Set("documents", std::move(saved));
    const auto json = base::WriteJson(bootstrap);
    if (!json) return std::nullopt;
    return "globalThis.__ardiaBootstrap=" + *json + ";\n" + kArdiaHostBootstrap;
  }
  const auto root = base::MakeAbsoluteFilePath(directory);
  const auto file = base::MakeAbsoluteFilePath(directory.AppendASCII(path));
  if (root.empty() || file.empty() || !root.IsParent(file)) {
    return std::nullopt;
  }
  std::string contents;
  if (!base::ReadFileToStringWithMaxSize(file, &contents, kAssetLimit)) {
    return std::nullopt;
  }
  if (path == "index.html") {
    const size_t head = contents.find("<head>");
    if (head == std::string::npos) return std::nullopt;
    contents.insert(head + 6, "<script src=\"/host-bootstrap.js\"></script>");
  }
  return contents;
}

class DevToolsFrontendWatch : public content::WebContentsObserver {
 public:
  DevToolsFrontendWatch(content::WebContents* frontend, base::OnceClosure destroyed)
      : content::WebContentsObserver(frontend), destroyed_(std::move(destroyed)) {}

 private:
  void WebContentsDestroyed() override {
    Observe(nullptr);
    if (destroyed_) std::move(destroyed_).Run();
  }
  base::OnceClosure destroyed_;
};

class TabBinding : public content::WebContentsObserver {
 public:
  TabBinding(ShellHostView* owner, content::WebContents* contents,
             std::string key);
  ~TabBinding() override;
  const std::string& key() const { return key_; }
  std::string claim;
  uint64_t renderer_generation = 0;
  bool transferable = false;
  bool temporary = false;
  content::WebContents* contents() const { return contents_; }
  views::WebView* viewport() const { return viewport_; }
  base::DictValue Navigation() const;
  void ReportNavigation();
  ardiacore::LinuxPageState* page() const { return page_.get(); }
  uint64_t contents_generation() const { return contents_generation_; }
  void AttachPage(std::unique_ptr<ardiacore::LinuxPageState> page);
  void AttachPageChannel();
  std::optional<gfx::PointF> ShellPoint(gfx::PointF page_point) const;
  void RetirePage();
  std::unique_ptr<ardiacore::LinuxPageState> TakePage();
  std::vector<int> replaced_ids;
  void ReportPresentation(std::string name, base::DictValue data);
  void ReportOpened(content::WebContents* opened, const GURL& url, std::string_view disposition);
  base::WeakPtr<TabBinding> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  void MoveTo(ShellHostView* owner);
  void Rebind(content::WebContents* contents);
  void SetViewport(views::WebView* view) { viewport_ = view; }
  views::WebView* devtools_viewport() const { return devtools_viewport_; }
  void SetDevToolsViewport(views::WebView* view) { devtools_viewport_ = view; }
  void RemoveViewports();
  void ResetPageCommands();
  void StartMedia();
  void Reveal();
  std::string_view Discard(const ardiacore::LinuxDiscardRequest& request);
  bool SetFrozen(bool value);
  std::vector<std::pair<std::string, base::Value>> SnapshotExtras();
  std::unique_ptr<ardiacore::LinuxPageMedia> media;
  bool frozen = false;
  bool discard_reported = false;
  std::unique_ptr<ardiacore::LinuxPageCommands> page_commands;
  std::optional<ardiacore::LinuxPageRequest> page_command_request;
  std::unique_ptr<DevToolsFrontendWatch> devtools_watch;
  bool devtools_had_focus = false;
  gfx::Rect pane_bounds;
  std::vector<gfx::Rect> pane_shape;
  std::vector<gfx::Rect> pane_input_shape;
  bool pane_visible = false;
  bool presented = false;
  void FocusFromHost();
  bool presentation_applied = false;
  bool presentation_attached = false;
  bool presentation_departed = false;
  base::TimeTicks cancelled_auto_pip_until;
  base::TimeTicks requested_auto_pip_until;
  void RememberPendingAutoPictureInPicture() {
    auto* helper = contents_ ? AutoPictureInPictureTabHelper::FromWebContents(contents_) : nullptr;
    if (base::TimeTicks::Now() < requested_auto_pip_until ||
        (helper && helper->AreAutoPictureInPicturePreconditionsMet())) {
      cancelled_auto_pip_until = base::TimeTicks::Now() + blink::kActivationLifespan;
    }
  }

 private:
  void PrimaryPageChanged(content::Page&) override {
    cancelled_auto_pip_until = {};
    requested_auto_pip_until = {};
  }
  void DidStartNavigation(content::NavigationHandle* handle) override;
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void WasDiscarded() override;
  void DidStartLoading() override;
  void OnWebContentsFocused(content::RenderWidgetHost*) override;
  void DidStopLoading() override;
  void LoadProgressChanged(double progress) override;
  void TitleWasSet(content::NavigationEntry*) override;
  void DidFailLoad(content::RenderFrameHost* frame, const GURL& url,
                   int error_code) override;
  void DidUpdateFaviconURL(
      content::RenderFrameHost*,
      const std::vector<blink::mojom::FaviconURLPtr>& candidates,
      blink::mojom::FaviconUpdateReason) override;
  void WebContentsDestroyed() override;

  void DidOpenRequestedURL(content::WebContents* new_contents,
                            content::RenderFrameHost*, const GURL& url,
                            const content::Referrer&, WindowOpenDisposition disposition,
                            ui::PageTransition, bool, bool) override;
  raw_ptr<ShellHostView> owner_;
  raw_ptr<content::WebContents> contents_;
  raw_ptr<views::WebView> viewport_ = nullptr;
  raw_ptr<views::WebView> devtools_viewport_ = nullptr;
  std::string key_;
  bool host_focusing_ = false;
  uint64_t contents_generation_ = 1;
  std::unique_ptr<ardiacore::LinuxPageState> page_;
  base::WeakPtrFactory<TabBinding> weak_factory_{this};
};

class WindowKeyboardHandler : public ui::EventHandler {
 public:
  explicit WindowKeyboardHandler(base::RepeatingCallback<void(ui::KeyEvent*)> handle)
      : handle_(std::move(handle)) {}
  void OnKeyEvent(ui::KeyEvent* event) override { handle_.Run(event); }

 private:
  base::RepeatingCallback<void(ui::KeyEvent*)> handle_;
};

class ShellHostView : public views::View,
                      public views::ViewObserver,
                      public views::WidgetObserver,
                      public aura::WindowObserver,
                      public ui::CompositorObserver,
                      public views::FocusChangeListener,
                      public TabStripModelObserver {
 public:
  METADATA_HEADER(ShellHostView, views::View)

 public:
  ShellHostView(BrowserWindowInterface* browser, BrowserView* parent, bool startup, Profile* app_profile);
  ~ShellHostView() override;
  void Initialize();
  void DetachBrowser();
  void DetachViewports();
  int id() const { return id_; }
  const std::string& window_id() const { return window_id_; }
  bool is_utility() const { return !kind_.empty(); }
  void ConfigureWindow(RequestedWindow request) {
    window_id_ = std::move(request.id);
    kind_ = std::move(request.kind);
    title_ = std::move(request.title);
    utility_ = std::move(request.utility);
    page_profile_ = std::move(request.page_profile);
    private_window_ = std::move(request.private_window);
    if (const auto name = ardiacore::linux_profiles::ParseProfileName(page_profile_);
        name && name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate) {
      std::vector<int> taken;
      for (const auto& [id, host] : Hosts()) {
        if (host != this && host->private_ordinal_) taken.push_back(host->private_ordinal_);
      }
      private_ordinal_ = ardiacore::linux_profiles::NextPrivateOrdinal(taken);
    }
    opener_host_ = request.opener_host;
    opener_generation_ = request.opener_generation;
  }
  void NavigateUtility(base::DictValue utility) {
    utility_ = std::move(utility);
    if (utility_ready_) {
      Event("ArdiaShell", "onUtilityNavigation", base::Value(utility_.Clone()));
    }
  }
  BrowserWindowInterface* browser() const { return browser_; }
  content::WebContents* shell() const { return shell_->GetWebContents(); }
  std::optional<gfx::PointF> ShellPoint(const TabBinding& binding, gfx::PointF page_point);
  Profile* profile() const { return browser_ ? app_profile_.get() : nullptr; }
  Profile* page_profile() const { return browser_ ? browser_->GetProfile() : nullptr; }
  const std::string& page_profile_id() const { return page_profile_; }
  ardiacore::linux_profiles::WindowAccess access() const {
    return {window_id_, page_profile_, id_, opener_host_, opener_generation_};
  }
  ardiacore::linux_profiles::WindowRequester requester() const { return {id_, renderer_generation_}; }
  bool Reaches(const ShellHostView* target) const {
    return target && ardiacore::linux_profiles::WindowReachableBy(target->access(), requester());
  }
  bool FocusReaches(const ShellHostView* target) const {
    return target && ardiacore::linux_profiles::WindowFocusableBy(target->access(), requester());
  }
  bool private_window() const {
    const auto name = ardiacore::linux_profiles::ParseProfileName(page_profile_);
    return name && name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate;
  }
  int opener_host() const { return opener_host_; }
  void ForgetOpener(int host) {
    if (opener_host_ != host) return;
    opener_host_ = 0;
    opener_generation_ = 0;
  }
  bool HostsProfile(std::string_view id) const { return ardiacore::LinuxProfileHosts(id, page_profile()); }
  bool Trusted(content::WebUI* ui) const;
  bool DeferChromeClose(const base::UnguessableToken& token, LinuxCloseStage stage,
                         base::OnceCallback<void(bool)> continuation);
  void ChromeCloseCancelled(const base::UnguessableToken& token);
  void DocumentCall(std::string verb, base::DictValue request,
                    base::OnceCallback<void(LinuxDocumentResult)> done);
  base::DictValue Bootstrap() const;
  base::DictValue Strip() const;
  base::DictValue Transaction(std::optional<int> command, bool advance);
  uint64_t SetHandler(HostMessageHandler* handler, content::WebUI* ui) {
    if (!Trusted(ui)) return 0;
    auto* frame = ui->GetRenderFrameHost();
    if (handler_ == handler && renderer_document_.AsRenderFrameHostIfValid() == frame) return renderer_generation_;
    auto document = frame->GetWeakDocumentPtr();
    handler_ = nullptr;
    auto weak = GetWeakPtr();
    RetireRenderer();
    auto* committed = document.AsRenderFrameHostIfValid();
    if (!weak || !committed || committed != weak->shell()->GetPrimaryMainFrame() || committed->GetWebUI() != ui) return 0;
    weak->handler_ = handler;
    weak->renderer_document_ = std::move(document);
    const uint64_t generation = weak->renderer_generation_;
    if (weak->dialogs_ && !weak->dialogs_->controller().ReplaceRenderer(base::NumberToString(generation))) {
      if (weak) weak->dialogs_.reset();
    }
    if (!weak || weak->handler_ != handler || weak->renderer_generation_ != generation) return 0;
    return generation;
  }
  bool OwnsHandler(HostMessageHandler* handler, uint64_t generation) const {
    auto* frame = renderer_document_.AsRenderFrameHostIfValid();
    return handler && handler_ == handler && renderer_generation_ == generation && frame && frame == shell()->GetPrimaryMainFrame();
  }
  bool ClearHandler(HostMessageHandler* handler) {
    if (!handler || handler_ != handler) return false;
    handler_ = nullptr;
    RetireRenderer();
    return true;
  }
  std::string LiveCaller() const {
    return base::NumberToString(id_) + "#" + base::NumberToString(renderer_generation_);
  }
  void RetireRenderer() {
    LinuxLiveCallerGone(LiveCaller());
    auto alive = GetWeakPtr();
    if (dialogs_ && renderer_generation_)
      dialogs_->controller().RetireRenderer(base::NumberToString(renderer_generation_));
    if (!alive || !RetireDocuments()) return;
    ++renderer_generation_;
    renderer_document_ = content::WeakDocumentPtr();
    std::vector<int> temporary;
    for (auto& [id, binding] : bindings_) {
      binding->RetirePage();
      binding->ResetPageCommands();
      binding->claim.clear();
      binding->renderer_generation = 0;
      binding->transferable = false;
      if (binding->temporary && binding->contents()) temporary.push_back(id);
    }
    utility_ready_ = false;
    switcher_capture_ = false;
    switcher_source_.reset();
    ReleaseDragEscape();
    if (focus_manager_ && shortcut_recording_) {
      focus_manager_->set_shortcut_handling_suspended(false);
      shortcut_recording_ = false;
    }
    DetachViewports();
    auto weak = GetWeakPtr();
    for (const int id : temporary) {
      if (!weak) return;
      auto* binding = weak->Binding(id);
      if (binding && binding->temporary && binding->contents()) weak->DisposeTemporary(binding);
    }
  }
  void Event(std::string_view module, std::string_view event,
             base::Value payload);
  void PresentDevTools(content::WebContents* inspected);
  void OnDevToolsDockChanged(content::WebContents* inspected, content::WebContents* devtools);
  void HideDevToolsViewport(TabBinding* binding);
  void LayoutPane(TabBinding* binding);
  void KeepPaneFocus(TabBinding* activating);
  void OnDidChangeFocus(views::View* before, views::View* now) override;
  void QueueTransaction(std::optional<int> command);
  void EngineEvent(std::string_view topic, const base::DictValue& payload);
  bool ReceivesPrivateDownload(const base::DictValue& download);
  bool ReceivesRemoval(bool private_removal, const std::string& profile_path);
  void Invoke(std::string method, const base::DictValue& args,
              base::OnceCallback<void(bool, base::Value)> done);
  void ReportPictureInPicture(content::WebContents* contents, base::DictValue state);
  LinuxExtensionWindow ExtensionWindow();
  LinuxExtensionSurfaces* ExtensionSurfaces();
  bool ExtensionEvent(std::string_view name, base::DictValue data);
  std::string ExtensionTabKey(content::WebContents* contents) const;
  bool ExtensionsListening() const { return browser_ && handler_ && !is_utility(); }
  void ReleaseExtensions() {
    extension_surfaces_.reset();
    LinuxExtensionsWindowClosing(id_);
  }
  void WatchSystemState();
  void WatchCalendar();
  void NoteInputActivity();
  void OfferTab(content::WebContents* contents) {
    if (contents && contents->GetBrowserContext() == page_profile()) offered_[TabId(contents)] = contents->GetWeakPtr();
  }
  int TabShown(content::WebContents* contents) const {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() == contents) {
        if (binding->presented) return 1;
        return binding->presentation_attached && binding->presentation_departed ? 0 : 2;
      }
    }
    return -1;
  }
  ardiacore::LinuxPageStatus* PageStatus(content::WebContents* contents) const {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() == contents && binding->page()) return binding->page()->status();
    }
    return nullptr;
  }
  bool DialogsPending() const { return dialogs_ && dialogs_->controller().pending() > 0; }
  bool HoldsTab(content::WebContents* contents) const {
    for (const auto& [id, binding] : bindings_) {
      if (contents && binding->contents() == contents) return true;
    }
    return contents && browser_ &&
           browser_->GetTabStripModel()->GetIndexOfWebContents(contents) != TabStripModel::kNoTab;
  }
  void FetchFavicon(const GURL& url, ardiacore::LinuxFaviconReply reply) {
    ardiacore::FetchLinuxFavicon(page_profile(), url, std::move(reply));
  }
  bool WindowFullScreen() const;
  PrefService* WindowOutputPrefs() const;
  void RememberWindowOutput();
  void ForgetWindowOutput();
  std::optional<std::pair<int64_t, std::string>> SavedWindowOutput() const;
  bool AutoPictureInPictureCancelled(content::WebContents* contents) const {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() == contents) {
        return base::TimeTicks::Now() < binding->cancelled_auto_pip_until;
      }
    }
    return false;
  }
  bool OpenPrivateLink(content::WebContents* contents, const GURL& url) {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() != contents || !binding->page()) continue;
      Profile* page = page_profile();
      const auto original = page ? ardiacore::LinuxProfileName(page->GetOriginalProfile()) : std::nullopt;
      if (!original) return false;
      binding->ReportPresentation("openWindow", base::DictValue()
          .Set("url", url.spec()).Set("disposition", "incognito").Set("profile", *original));
      return true;
    }
    return false;
  }
  bool ReportDevToolsOpenedTab(content::WebContents* inspected, content::WebContents* opened, const GURL& url) {
    for (const auto& [id, binding] : bindings_) {
      if (!inspected || binding->contents() != inspected) continue;
      binding->ReportOpened(opened, url, "foreground");
      return true;
    }
    return false;
  }
  bool ShowsDevToolsLinks(content::BrowserContext* profile) {
    return profile && profile == page_profile() && PrivateLinkBinding();
  }
  void AdoptDevToolsTab(content::WebContents* opened, const GURL& url) {
    PrivateLinkBinding()->ReportOpened(opened, url, "foreground");
    FocusWindow();
  }
  void OpenDevToolsLink(const GURL& url) {
    PrivateLinkBinding()->ReportPresentation("openWindow", base::DictValue()
        .Set("url", url.spec()).Set("disposition", "foreground").Set("userGesture", true));
    FocusWindow();
  }
  bool BindsTab(content::WebContents* contents) const {
    for (const auto& [id, binding] : bindings_) {
      if (contents && binding->contents() == contents) return true;
    }
    return false;
  }
  uint64_t activation() const { return activation_; }
  void FocusWindow() { ActivateNativeWindow(browser_, WindowFocus().Focus(id_)); }
  bool StripHolds(content::WebContents* contents) const {
    return browser_ && contents && browser_->GetTabStripModel()->GetIndexOfWebContents(contents) != TabStripModel::kNoTab;
  }
  TabBinding* PrivateLinkBinding() {
    TabBinding* fallback = nullptr;
    for (const auto& [id, binding] : bindings_) {
      if (!binding->contents() || !binding->page()) continue;
      if (binding->presented) return binding.get();
      if (!fallback) fallback = binding.get();
    }
    return fallback;
  }
  void NoteAutoPictureInPictureRequested(content::WebContents* contents) {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() != contents) continue;
      binding->requested_auto_pip_until = base::TimeTicks::Now() + blink::kActivationLifespan;
      binding->cancelled_auto_pip_until = {};
    }
  }
  void ConsumeAutoPictureInPictureCancellation(content::WebContents* contents) {
    for (const auto& [id, binding] : bindings_) {
      if (binding->contents() != contents) continue;
      binding->requested_auto_pip_until = {};
      binding->cancelled_auto_pip_until = {};
    }
  }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  void RendererReady();
  void SeedWindowActivation();
  void RestoreFullScreenNow();
  std::vector<base::DictValue> WindowState() const;

 private:
  std::map<int, base::WeakPtr<content::WebContents>> offered_;
  friend class HostMessageHandler;
  TabBinding* Binding(int id);
  TabBinding* ClaimedBinding(const base::DictValue& args);
  struct PageCommandAuthority {
    base::WeakPtr<ShellHostView> host;
    base::WeakPtr<HostMessageHandler> handler;
    content::WeakDocumentPtr document;
    base::WeakPtr<content::WebContents> contents;
    int id = 0;
    std::string claim;
    uint64_t generation = 0;
  };
  static TabBinding* PageCommandBinding(const PageCommandAuthority& authority);
  static void EmitPageCommandEvent(const PageCommandAuthority& authority,
                                   base::DictValue event);
  ardiacore::LinuxPageCommands* EnsurePageCommands(TabBinding* binding);
  void PageCommand(TabBinding* binding, const std::string& command,
                   const base::ListValue& values,
                   base::OnceCallback<void(bool, base::Value)> done);
  void AdoptDevTools(TabBinding* binding);
  bool CloseTab(TabBinding* binding);
  bool DisposeTemporary(TabBinding* binding);
  void ClaimLaunchTab(const base::ListValue& values, base::OnceCallback<void(bool, base::Value)> done);
  bool AdoptLaunchOffer(int tab, std::string_view key, std::string_view url);
  ardiacore::linux_contract::LaunchDecision launch_decision_;
  TabBinding* BindingForKey(std::string_view key);
  std::unique_ptr<ardiacore::LinuxPageState> MountPage(TabBinding* binding);
  void ReplaceTabContents(content::WebContents* old_contents, content::WebContents* contents);
  void CreateTab(const base::DictValue& args,
                 base::OnceCallback<void(bool, base::Value)> done);
  void TabCommand(const base::DictValue& args,
                  base::OnceCallback<void(bool, base::Value)> done);
  void SetViewport(const base::DictValue& args,
                   base::OnceCallback<void(bool, base::Value)> done);
  void SetPresentations(const base::DictValue& args,
                       base::OnceCallback<void(bool, base::Value)> done);
  void StripCommand(int command, const base::DictValue& args,
                    base::OnceCallback<void(bool, base::Value)> done);
  bool AcceleratorPressed(const ui::Accelerator& accelerator) override;
  bool CanHandleAccelerators() const override;
  void UnregisterAccelerators();
  void FocusShell();
  void FocusShellOnActivation();
  void OnKeyEvent(ui::KeyEvent* event) override;
  bool ForwardDragEscape(const ui::KeyEvent& event);
  void ReleaseDragEscape();
  void ReplayTypeahead(bool field);
  bool RunHeldShortcut(const ui::KeyEvent& event);
  bool SwitcherReleasedInHold(const std::vector<ui::KeyEvent>& held, size_t index) const;
  linux_window::ShortcutKind LiveShortcutKind(const ui::KeyEvent& event) const;
  static bool CommandFocusesShell(const std::string& command);
  aura::Window* KeyboardFocusTarget() const;
  static ui::Accelerator KeyAccelerator(const ui::KeyEvent& event);
  void DiscardTypeahead();
  bool ShellHoldsTextField();
  bool ExtensionShortcutPressed(const ui::KeyEvent& event, bool reserved_by_ardia);
  bool OwnsKeyboardEvent(const ui::KeyEvent& event) const;
  bool OwnsKeyboardTarget(aura::Window* event_target) const;
  void OnWindowDestroying(aura::Window* window) override;
  void ArmWindowClose();
  void CloseNativeWindow(LinuxClose::Identity identity);
  bool ReadyForChromeClose(const LinuxClose::Identity& identity) const;
  LinuxCloseAdmission AdmitChromeTeardown(LinuxClose::Identity identity,
                                          base::UnguessableToken token, LinuxCloseStage stage);
  void ReplyChromeClose(LinuxCloseStage stage, LinuxClose::Identity identity,
                        base::UnguessableToken token,
                        base::OnceCallback<void(bool)> continuation, bool ready);
  void FinishChromePreparations(bool ready);
  void CancelDocumentSeal(LinuxClose::Identity identity, bool chrome_aborted);
  void RequestUtilityClose();
  base::DictValue RequestWindowClose();
  bool RetireDocuments();
  struct StorageIntent {
    std::string name;
    base::DictValue operation;
    size_t bytes;
    size_t pending = 0;
    uint64_t failure = 0;
  };
  struct StorageTicket {
    std::shared_ptr<StorageIntent> intent;
    uint64_t sequence;
  };
  std::optional<StorageTicket> BeginStorageIntent(std::string name,
                                                 base::DictValue operation);
  void CompleteStorageIntent(const StorageTicket& ticket, bool durable,
                             bool failed);
  bool TrackStorageWrite(std::string name, base::DictValue operation,
                        base::OnceCallback<void(bool, base::Value)>& done);
  LinuxDocumentClient DocumentClient() const;
  bool EnsureDocumentClient();
  void CancelWindowClose(LinuxClose::Identity identity,
                         base::OnceCallback<void(bool, base::Value)> done);
  void BeginWindowCloseDrain(const base::DictValue& request,
                             base::OnceCallback<void(bool, base::Value)> done);
  std::optional<LinuxDialogClient> DialogClient() const;
  std::string DialogProfile() const;
  void DialogInvoke(const std::string& method, const base::ListValue& values,
                    base::OnceCallback<void(bool, base::Value)> done);
  void SuspendDialogsForClose(const std::string& close_generation);
  void CommitWindowDeparture(const std::string& close_generation);
  static void PersistWindowDeparture(Profile* profile, std::string source_window,
                                     base::DictValue departure);
  void ResumeDialogsForClose(const std::string& close_generation);
  bool AwaitingChromeHandoff() const;
  bool ClosingEndsSession() const;
  void AcknowledgeWindowClose(const base::DictValue& request,
                              base::OnceCallback<void(bool, base::Value)> done);
  void OnWidgetClosing(views::Widget* widget) override;
  void OnWidgetDestroying(views::Widget* widget) override;
  void OnWidgetActivationChanged(views::Widget* widget, bool active) override;
  void OnWidgetVisibilityChanged(views::Widget* widget, bool visible) override;
  void OnWidgetBoundsChanged(views::Widget* widget, const gfx::Rect& bounds) override;
  void OnWidgetShowStateChanged(views::Widget* widget) override;
  void OnWidgetThemeChanged(views::Widget* widget) override;
  void OnDidPresentCompositorFrame(ui::Compositor* compositor, uint32_t frame_token,
                                   const gfx::PresentationFeedback& feedback) override;
  void OnCompositingShuttingDown(ui::Compositor* compositor) override { presentation_observation_.Reset(); }
  void ReportWindowGeometry();
  void LayoutOverlay();
  void HideCaptionButtons();
  void ReattachViewports();
  void OnViewBoundsChanged(views::View*) override { LayoutOverlay(); }
  void OnViewIsDeleting(views::View*) override;
  void OnTabStripModelChanged(TabStripModel*, const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;

  raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<BrowserView> browser_view_;
  base::WeakPtr<Profile> app_profile_;
  std::string page_profile_;
  base::DictValue private_window_;
  int private_ordinal_ = 0;
  int opener_host_ = 0;
  uint64_t opener_generation_ = 0;
  raw_ptr<LinuxShellWebView> shell_ = nullptr;
  raw_ptr<HostMessageHandler> handler_ = nullptr;
  uint64_t renderer_generation_ = 0;
  std::optional<uint64_t> live_generation_;
  std::unique_ptr<LinuxWindowDialogs> dialogs_;
  std::unique_ptr<LinuxExtensionSurfaces> extension_surfaces_;
  std::unique_ptr<LinuxExtensionKeybindings> extension_keybindings_;
  std::map<std::string, LinuxDialogSuspension> close_dialogs_;
  std::optional<std::pair<std::string, base::DictValue>> close_departure_;
  content::WeakDocumentPtr renderer_document_;
  std::shared_ptr<DocumentAuthority> documents_;
  const std::string document_window_ = base::Uuid::GenerateRandomV4().AsLowercaseString();
  LinuxDocumentClient document_client_;
  uint64_t document_client_generation_ = 0;
  uint64_t document_subscription_ = 0;
  bool document_watched_ = false;
  bool document_used_ = false;
  size_t storage_pending_ = 0;
  std::set<std::string> storage_failures_;
  std::vector<std::shared_ptr<StorageIntent>> storage_intents_;
  size_t storage_bytes_ = 0;
  size_t storage_pending_bytes_ = 0;
  uint64_t storage_sequence_ = 0;
  LinuxClose close_;
  std::optional<base::UnguessableToken> chrome_close_token_;
  LinuxDocumentClient close_client_;
  base::WeakPtr<BrowserWindowInterface> close_browser_;
  base::WeakPtr<views::Widget> close_widget_;
  std::string close_window_;
  bool close_cancel_running_ = false;
  std::vector<std::pair<LinuxCloseStage, base::OnceCallback<void(bool)>>> close_preparations_;
  std::vector<base::OnceCallback<void(bool, base::Value)>> close_cancellations_;
  struct PendingDocumentWatch {
    uint64_t generation;
    uint64_t subscription;
    base::DictValue request;
    base::OnceCallback<void(LinuxDocumentResult)> done;
  };
  std::vector<PendingDocumentWatch> pending_document_watches_;
  std::optional<std::pair<std::string, std::string>> close_error_;
  std::vector<base::OnceCallback<void(bool, base::Value)>> close_replies_;
  raw_ptr<views::FocusManager> focus_manager_ = nullptr;
  std::unique_ptr<WindowKeyboardHandler> input_handler_;
  WindowPointerHandler pointer_handler_;
  std::map<ui::Accelerator, base::DictValue> shortcuts_;
  bool shortcut_recording_ = false;
  bool switcher_capture_ = false;
  base::WeakPtr<content::WebContents> switcher_source_;
  int id_;
  bool startup_;
  std::unique_ptr<ardia::linux_suggest::SuggestionClient> suggestions_ =
      std::make_unique<ardia::linux_suggest::SuggestionClient>();
  std::string window_id_;
  std::string kind_;
  std::string title_;
  base::DictValue utility_;
  bool utility_ready_ = false;
  bool utility_close_pending_ = false;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  bool app_operation_ = false;
  linux_window::GeometryLedger geometry_{GlobalScreenCoordinates()};
  base::OneShotTimer frame_timer_;
  std::unique_ptr<linux_window::TypeaheadInput> typeahead_;
  std::optional<std::string> output_target_;
  bool output_forgotten_ = false;
  base::RepeatingTimer output_watch_;
  bool presented_ = false;
  uint64_t activation_ = 0;
  base::OneShotTimer typeahead_timer_;
  base::ScopedObservation<views::View, views::ViewObserver> view_observation_{this};
  base::ScopedObservation<views::Widget, views::WidgetObserver> close_observation_{this};
  base::ScopedObservation<aura::Window, aura::WindowObserver> input_observation_{this};
  base::ScopedObservation<ui::Compositor, ui::CompositorObserver> presentation_observation_{this};
  base::ScopedObservation<views::FocusManager, views::FocusChangeListener> pane_focus_observation_{this};
  std::map<int, bool> devtools_had_focus_;
  base::CallbackListSubscription system_state_subscription_;
  base::CallbackListSubscription calendar_subscription_;
  base::WeakPtrFactory<ShellHostView> weak_factory_{this};
};

BEGIN_METADATA(ShellHostView)
END_METADATA

void ShellHostView::PersistWindowDeparture(Profile* profile, std::string source_window,
                                           base::DictValue departure) {
  const auto* base = departure.FindDict("base");
  const auto* session = departure.FindDict("session");
  if (!profile || !base || !session || !ValidLinuxSession(*base) || !ValidLinuxSession(*session)) return;
  const base::FilePath profile_path = profile->GetPath();
  FileRunner()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&MergeAndWriteSession, DocumentDirectory(profile),
                                base->Clone(), session->Clone()),
      base::BindOnce(
          [](base::FilePath departed_profile, std::string departed_window, SessionWriteResult result) {
            if (!result.ok || result.previous == result.session) return;
            for (const auto& [id, host] : Hosts()) {
              Profile* peer = host->profile();
              if (host->window_id() == departed_window || !peer || peer->IsOffTheRecord() ||
                  peer->GetPath() != departed_profile) continue;
              host->Event("ArdiaHost", "session", base::Value(base::DictValue()
                  .Set("base", result.previous.Clone())
                  .Set("session", result.session.Clone())
                  .Set("sourceWindowId", departed_window)));
            }
          }, profile_path, std::move(source_window)));
}

ShellHostView* HostFor(content::WebContents* contents) {
  for (const auto& [id, host] : Hosts()) {
    if (host->shell() == contents) return host;
  }
  return nullptr;
}

class HostMessageHandler : public content::WebUIMessageHandler,
                           public content::WebContentsObserver {
 public:
  explicit HostMessageHandler(base::WeakPtr<ShellHostView> host)
      : content::WebContentsObserver(host ? host->shell() : nullptr),
        host_(std::move(host)) {}
  ~HostMessageHandler() override {
    if (host_) host_->ClearHandler(this);
  }
  void SendEvent(std::string_view module, std::string_view event,
                 const base::Value& payload) {
    if (!IsJavascriptAllowed() || !host_ || !host_->OwnsHandler(this, generation_) || !host_->Trusted(web_ui())) return;
    CallJavascriptFunction("__ardiaEvent", base::Value(module),
                           base::Value(event), payload);
  }
  bool Authorized() {
    return host_ && host_->OwnsHandler(this, generation_) &&
           host_->Trusted(web_ui()) && IsJavascriptAllowed();
  }
  base::WeakPtr<HostMessageHandler> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

 private:
  struct EngineReply {
    std::string name;
    base::WeakPtr<HostMessageHandler> handler;
    std::string id;
    std::string profile_path;
  };
  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback(
        "ardiaRequest", base::BindRepeating(&HostMessageHandler::Request,
                                            base::Unretained(this)));
  }
  void ActivateCommittedRenderer() {
    if (!host_ || !host_->Trusted(web_ui())) return;
    auto weak = weak_factory_.GetWeakPtr();
    const uint64_t generation = host_->SetHandler(this, web_ui());
    if (weak) weak->generation_ = generation;
  }
  void PrimaryPageChanged(content::Page& page) override {
    if (&page.GetMainDocument() == web_ui()->GetRenderFrameHost()) ActivateCommittedRenderer();
  }
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) override {
    if (host_) host_->ClearHandler(this);
  }
  void OnJavascriptDisallowed() override {
    weak_factory_.InvalidateWeakPtrs();
    if (host_ && !host_->OwnsHandler(this, generation_)) host_->ClearHandler(this);
  }
  void Reply(std::string id, bool success, base::Value response) {
    if (!host_ || !host_->OwnsHandler(this, generation_) || !host_->Trusted(web_ui()) || !IsJavascriptAllowed()) return;
    CallJavascriptFunction("__ardiaReply", base::Value(id), base::Value(success),
                           response);
  }
  static void Replied(void* context, const char* json) {
    std::unique_ptr<EngineReply> reply(static_cast<EngineReply*>(context));
    if (!reply->handler) return;
    auto value = json ? base::JSONReader::Read(json, base::JSON_PARSE_RFC) : std::nullopt;
    if (!value) return reply->handler->Fail(reply->id, "ERR_BAD_REPLY", "The engine reply is not JSON");
    if (value->is_dict() && value->GetDict().Find("error")) {
      const auto& error = *value->GetDict().Find("error");
      const auto failure = ardiacore::linux_private_services::EngineFailure(error.is_string() ? error.GetString() : "");
      return reply->handler->Fail(reply->id, failure.code, failure.message);
    }
    if (ardiacore::IsLinuxZoomDomainRoute(reply->name)) {
      auto completed = value->is_dict()
          ? ardiacore::CompleteLinuxZoomDomain(reply->name, value->GetDict()) : std::nullopt;
      if (!completed) return reply->handler->Fail(reply->id, "ERR_BAD_REPLY", "Malformed site zoom reply");
      return reply->handler->Resolve(reply->id, std::move(*completed));
    }
    if (ardiacore::IsLinuxMemorySaverRoute(reply->name)) {
      auto completed = value->is_dict()
          ? ardiacore::CompleteLinuxMemorySaver(reply->name, value->GetDict()) : std::nullopt;
      if (!completed) return reply->handler->Fail(reply->id, "ERR_BAD_REPLY", "Malformed Memory Saver reply");
      return reply->handler->Resolve(reply->id, base::Value(std::move(*completed)));
    }
    const auto* route = ardiacore::linux_contract::FindRoute(reply->name);
    if (route && route->field == "null") value = base::Value();
    else if (route && !route->field.empty()) {
      const auto* field = value->is_dict() ? value->GetDict().Find(route->field) : nullptr;
      if (!field) return reply->handler->Fail(reply->id, "ERR_BAD_REPLY", "Missing engine response field");
      value = field->Clone();
    }
    if (reply->name == "engine.tasks" && value->is_list()) {
      for (auto& task : value->GetList()) {
        if (!task.is_dict()) continue;
        base::ListValue translated;
        if (const auto* ids = task.GetDict().FindList("tabIds")) {
          for (const auto& id : *ids) {
            if (!id.is_int()) continue;
            auto* binding = reply->handler->host_ ? reply->handler->host_->Binding(id.GetInt()) : nullptr;
            if (binding && binding->contents()) translated.Append(binding->key());
          }
        }
        task.GetDict().Set("tabIds", std::move(translated));
        task.GetDict().Remove("browserIds");
      }
    }
    if (const auto change = ardiacore::linux_contract::ChangeAnnouncedAfter(
            reply->name, value->is_dict() ? value->GetDict().FindInt("applied") : std::nullopt);
        !change.empty() && !reply->profile_path.empty()) {
      base::DictValue changed;
      changed.Set("profile", reply->profile_path);
      for (const auto& [host_id, host] : Hosts()) {
        if (host != reply->handler->host_.get()) host->EngineEvent(change, changed);
      }
    }
    reply->handler->Resolve(reply->id, std::move(*value));
  }
  void Resolve(const std::string& id, base::Value value) {
    const auto json = base::WriteJson(value);
    if (!json) return Fail(id, "ERR_BAD_REPLY", "The native reply is not JSON");
    Reply(id, true, base::Value(*json));
  }
  void Fail(const std::string& id, std::string_view code, std::string_view message) {
    Reply(id, false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
  }
  void ProfileFail(const std::string& id, ardiacore::linux_profiles::ProfileError error) {
    Fail(id, ardiacore::linux_profiles::ProfileErrorCode(error), ardiacore::linux_profiles::ProfileErrorMessage(error));
  }
  void Request(const base::ListValue& arguments) {
    CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
    if (!host_ || !host_->OwnsHandler(this, generation_) || !host_->Trusted(web_ui()) || arguments.size() != 3 ||
        !arguments[0].is_string() || !arguments[1].is_string() ||
        !arguments[2].is_dict()) return;
    const std::string id = arguments[0].GetString();
    if (id.empty() || id.size() > 256) return;
    AllowJavascript();
    const auto& args = arguments[2].GetDict();
    if (arguments[1].GetString() == "engine.call") {
      const std::string name = String(args, "name");
      if (!args.FindString("profile")) return Fail(id, "ERR_ENGINE", "Profile must be a string");
      const std::string profile = String(args, "profile");
      const auto profile_name = ardiacore::linux_profiles::ParseProfileName(profile);
      if (!profile_name || !host_->profile() || host_->profile()->IsOffTheRecord()) {
        return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kInvalid);
      }
      Profile* window_profile = host_->page_profile();
      const bool private_request = ardiacore::linux_private_services::PrivateRequest(
          host_->private_window() || (window_profile && window_profile->IsOffTheRecord()), profile_name->kind);
      if (host_->private_window() && !window_profile) {
        return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kPrivateEnding);
      }
      if (name == "profiles.release") {
        ardiacore::ReleaseLinuxProfile(profile);
        return Resolve(id, base::Value());
      }
      if (LinuxExtensionsHandles(name)) {
        return LinuxExtensionsCall(host_->ExtensionWindow(), profile, name, args.Find("args"),
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler, std::string id, bool ok, base::Value result) {
              if (!handler) return;
              if (ok) return handler->Resolve(id, std::move(result));
              const std::string* code = result.is_dict() ? result.GetDict().FindString("code") : nullptr;
              const std::string* message = result.is_dict() ? result.GetDict().FindString("message") : nullptr;
              handler->Fail(id, code ? *code : "ERR_ENGINE", message ? *message : "Extension request failed");
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (LinuxSiteControlsHandles(name)) {
        if (args.size() != 3) return Fail(id, "ERR_ENGINE", "Invalid engine transport request");
        return LinuxSiteControlsCall(host_->profile(), host_->page_profile(), name, profile, args.Find("args"),
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler, std::string id, bool ok, base::Value result) {
              if (!handler) return;
              if (ok) return handler->Resolve(id, std::move(result));
              const std::string* code = result.is_dict() ? result.GetDict().FindString("code") : nullptr;
              const std::string* message = result.is_dict() ? result.GetDict().FindString("message") : nullptr;
              handler->Fail(id, code ? *code : "ERR_ENGINE", message ? *message : "Site control request failed");
            }, weak_factory_.GetWeakPtr(), id));
      }
      const base::Value* value = args.Find("args");
      if (name.starts_with("documents.") && args.size() != 3)
        return Fail(id, "ERR_DOCUMENT_REQUEST", "Invalid document transport request");
      if (name.starts_with("documents.") && (!value || !value->is_string()))
        return Fail(id, "ERR_DOCUMENT_REQUEST", "Document arguments require JSON text");
      if (!value || (!value->is_none() && !value->is_string())) {
        return Reply(id, false, base::Value("Engine arguments must be JSON text or null"));
      }
      std::string json = value->is_string() ? value->GetString() : "{}";
      if (name.size() > 128 || name.find('\0') != std::string::npos ||
          json.size() > kDocumentLimit || json.find('\0') != std::string::npos) {
        return Reply(id, false, base::Value("Invalid or oversized engine request"));
      }
      auto parsed = name.starts_with("documents.")
          ? base::JSONReader::Read(json, base::JSON_PARSE_RFC, 48)
          : base::JSONReader::Read(json, base::JSON_PARSE_RFC);
      if (!parsed || !parsed->is_dict() || parsed->GetDict().contains("profile") ||
          parsed->GetDict().contains("offTheRecord") || parsed->GetDict().contains("incognito")) {
        return Fail(id, "ERR_ENGINE", "Engine arguments require a regular-profile JSON object");
      }
      const auto& input = parsed->GetDict();
      if (name.starts_with("documents.") && profile_name->kind != ardiacore::linux_profiles::ProfileKind::kDefault) {
        return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kInvalid);
      }
      if (name.starts_with("documents.")) {
        return host_->DocumentCall(name.substr(10), input.Clone(),
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler,
                              std::string id, LinuxDocumentResult result) {
              if (!handler) return;
              if (!result.ok()) return handler->Fail(id, result.code, result.message);
              handler->Resolve(id, base::Value(std::move(result.value)));
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (const auto* engine = input.FindString("engine"); engine && *engine != "chromium") {
        return Fail(id, "ERR_UNKNOWN_CALL", "This page engine is unavailable on Linux");
      }
      if (name == "tabs.devBrowserId" || name == "tabs.devWindowNumber" || name == "tabs.devFocusPage") {
        auto* binding = host_->BindingForKey(String(input, "tabId"));
        if (!binding || !binding->contents()) return Fail(id, "ERR_ENGINE", "The tab is not owned by this window");
        if (name == "tabs.devFocusPage") binding->contents()->Focus();
        base::Value value = name == "tabs.devFocusPage" ? base::Value(true) :
            base::Value(name == "tabs.devBrowserId" ? TabId(binding->contents()) : host_->id());
        return Resolve(id, std::move(value));
      }
      if (std::find(std::begin(ardiacore::kLinuxPageMessageRoutes), std::end(ardiacore::kLinuxPageMessageRoutes), name) !=
          std::end(ardiacore::kLinuxPageMessageRoutes)) {
        std::string error;
        if (!ardiacore::SetLinuxPageOption(name, input, &error)) return Fail(id, "ERR_ENGINE", error);
        return Resolve(id, base::Value());
      }
      if (name == "engine.info" || name == "tabs.strips" || name == "tabs.stripCommand" ||
          name == "windows.list" || name == "search.setEngineName" || name == "webView.setAutoPictureInPicture") {
        base::ListValue values;
        if (name == "search.setEngineName") values.Append(String(input, "name"));
        if (name == "tabs.stripCommand") {
          const auto* command = input.FindDict("command");
          const auto command_id = input.FindInt("id");
          if (!command || !command_id) return Fail(id, "ERR_ENGINE", "A strip command and id are required");
          values.Append(*command_id);
          values.Append(command->Clone());
        }
        if (name == "webView.setAutoPictureInPicture") {
          const auto enabled = input.FindBool("enabled");
          if (!enabled) return Fail(id, "ERR_ENGINE", "A boolean auto-PiP setting is required");
          values.Append(*enabled);
        }
        host_->Invoke(name, base::DictValue().Set("args", std::move(values)),
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler, std::string id,
                              bool success, base::Value result) {
              if (!handler) return;
              if (!success) return handler->Fail(id, "ERR_ENGINE", result.is_string() ? result.GetString() : "Native call failed");
              handler->Resolve(id, std::move(result));
            }, weak_factory_.GetWeakPtr(), id));
        return;
      }
      if (const auto invalid = linux_downloads::ValidateRequest(name, input); !invalid.empty())
        return Fail(id, "ERR_DOWNLOAD_REQUEST", invalid);
      if (LinuxDownloadsHandles(name) || linux_downloads::IsDownloadControl(name)) {
        Profile* page = host_->page_profile();
        if (!page) return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kUnavailable);
        const bool page_private = page->IsOffTheRecord();
        const auto access = linux_downloads::RouteDownloads(profile_name->kind, page_private,
            page_private && page->ShutdownStarted(), host_->HostsProfile(profile));
        if (access.error != ardiacore::linux_profiles::ProfileError::kNone) return ProfileFail(id, access.error);
        if (linux_downloads::IsDownloadControl(name)) {
          const std::string* download = input.FindString("id");
          if (!download) return Fail(id, "ERR_DOWNLOAD_REQUEST", "A valid download id is required");
          if (!LinuxDownloadOwned(page, *download)) return Fail(id, "ERR_ENGINE", "no such download");
          const auto command = base::WriteJson(base::DictValue()
              .Set("id", *download)
              .Set("command", linux_downloads::DownloadCommand(name)));
          if (!command) return Fail(id, "ERR_BAD_REPLY", "Download command arguments are not JSON");
          const std::string path = page->GetOriginalProfile()->GetPath().value();
          ac_engine_call(linux_downloads::kDownloadCommandService, path.c_str(), command->c_str(), Replied,
                         new EngineReply{name, weak_factory_.GetWeakPtr(), id});
          return;
        }
        return LinuxDownloadsCall(page, name, input,
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler, std::string id, bool ok, base::Value result) {
              if (!handler) return;
              if (ok) return handler->Resolve(id, std::move(result));
              const std::string* code = result.is_dict() ? result.GetDict().FindString("code") : nullptr;
              const std::string* message = result.is_dict() ? result.GetDict().FindString("message") : nullptr;
              handler->Fail(id, code ? *code : "ERR_ENGINE", message ? *message : "Download request failed");
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (name == "favicons.fetch") {
        Profile* page = host_->page_profile();
        if (!page || page->IsOffTheRecord()) return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kPrivateService);
        if (profile_name->kind != ardiacore::linux_profiles::ProfileKind::kDefault && !host_->HostsProfile(profile)) {
          return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kWindowMismatch);
        }
        const std::string* url = input.FindString("url");
        if (!url || input.size() != 1) return Fail(id, "ERR_ENGINE", "favicons.fetch requires one icon URL");
        return host_->FetchFavicon(GURL(*url), base::BindOnce(
            [](base::WeakPtr<HostMessageHandler> handler, std::string id, base::Value image) {
              if (handler) handler->Resolve(id, std::move(image));
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (name == "engine.systemState") {
        host_->WatchSystemState();
        return ardiacore::LinuxPowerMonitor::Get().Current(base::BindOnce(
            [](base::WeakPtr<HostMessageHandler> handler, std::string id, base::DictValue state) {
              if (handler) handler->Resolve(id, base::Value(std::move(state)));
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (ardiacore::IsLinuxZoomDomainRoute(name)) {
        Profile* page = host_->page_profile();
        const bool private_session = private_request;
        if (private_session) {
          const auto error = ardiacore::linux_private_services::RoutePrivateCall(name,
              {page && page->IsOffTheRecord(), page && page->ShutdownStarted(), page && host_->HostsProfile(profile)});
          if (error != ardiacore::linux_profiles::ProfileError::kNone) return ProfileFail(id, error);
        }
        auto prepared = ardiacore::PrepareLinuxZoomDomain(name, input);
        if (!prepared) return Fail(id, "ERR_ENGINE", "Invalid site zoom request");
        if (private_session) prepared->args.Set(ardiacore::linux_private_services::kOffTheRecordKey, true);
        const auto serialized = base::WriteJson(prepared->args);
        if (!serialized) return Fail(id, "ERR_BAD_REPLY", "Site zoom arguments are not JSON");
        if (private_session) {
          const std::string path = page->GetOriginalProfile()->GetPath().value();
          ac_engine_call(prepared->service.c_str(), path.c_str(), serialized->c_str(), Replied,
                         new EngineReply{name, weak_factory_.GetWeakPtr(), id});
          return;
        }
        ardiacore::ResolveLinuxProfile(profile, base::BindOnce(
            [](base::WeakPtr<HostMessageHandler> handler, std::string name, std::string id,
               std::string service, std::string json, Profile* resolved,
               ardiacore::linux_profiles::ProfileError error) {
              using ardiacore::linux_profiles::ProfileError;
              if (!handler) return;
              if (!resolved || resolved->IsOffTheRecord()) {
                return handler->ProfileFail(id, resolved ? ProfileError::kPrivateService
                                                : error == ProfileError::kNone ? ProfileError::kUnavailable : error);
              }
              const std::string path = resolved->GetPath().value();
              ac_engine_call(service.c_str(), path.c_str(), json.c_str(), Replied,
                             new EngineReply{name, handler, id});
            }, weak_factory_.GetWeakPtr(), name, id, prepared->service, *serialized));
        return;
      }
      if (LinuxCredentialsHandles(name)) {
        Profile* page = host_->page_profile();
        return LinuxCredentialsCall(profile, !page || page->IsOffTheRecord(), name, input,
            base::BindOnce([](base::WeakPtr<HostMessageHandler> handler, std::string id, bool ok, base::Value result) {
              if (!handler) return;
              if (ok) return handler->Resolve(id, std::move(result));
              const std::string* code = result.is_dict() ? result.GetDict().FindString("code") : nullptr;
              const std::string* message = result.is_dict() ? result.GetDict().FindString("message") : nullptr;
              handler->Fail(id, code ? *code : "ERR_ENGINE", message ? *message : "Credential request failed");
            }, weak_factory_.GetWeakPtr(), id));
      }
      if (ardiacore::IsLinuxMemorySaverRoute(name)) {
        if (private_request) {
          return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kPrivateService);
        }
        const auto prepared = ardiacore::PrepareLinuxMemorySaver(name, input);
        if (!prepared) return Fail(id, "ERR_ENGINE", "Invalid Memory Saver request");
        const auto serialized = base::WriteJson(*prepared);
        if (!serialized) return Fail(id, "ERR_BAD_REPLY", "Memory Saver arguments are not JSON");
        ardiacore::ResolveLinuxProfile(profile, base::BindOnce(
            [](base::WeakPtr<HostMessageHandler> handler, std::string name, std::string id,
               std::string json, Profile* resolved, ardiacore::linux_profiles::ProfileError error) {
              using ardiacore::linux_profiles::ProfileError;
              if (!handler) return;
              if (!resolved || resolved->IsOffTheRecord()) {
                return handler->ProfileFail(id, resolved ? ProfileError::kPrivateService
                                                : error == ProfileError::kNone ? ProfileError::kUnavailable : error);
              }
              const std::string path = resolved->GetPath().value();
              ac_engine_call(ardiacore::kLinuxMemorySaverService, path.c_str(), json.c_str(), Replied,
                             new EngineReply{name, handler, id, path});
            }, weak_factory_.GetWeakPtr(), name, id, *serialized));
        return;
      }
      const auto* route = ardiacore::linux_contract::FindRoute(name);
      if (!route) return Fail(id, "ERR_UNKNOWN_CALL", "This call is unavailable on Linux");
      if (private_request) {
        return ProfileFail(id, ardiacore::linux_profiles::ProfileError::kPrivateService);
      }
      const std::string service(route->service);
      ardiacore::ResolveLinuxProfile(profile, base::BindOnce(
          [](base::WeakPtr<HostMessageHandler> handler, std::string name, std::string id,
             std::string service, std::string json, Profile* resolved,
             ardiacore::linux_profiles::ProfileError error) {
            if (!handler) return;
            if (!resolved || resolved->IsOffTheRecord()) {
              return handler->ProfileFail(id, resolved ? ardiacore::linux_profiles::ProfileError::kPrivateService : error);
            }
            const std::string path = resolved->GetPath().value();
            ac_engine_call(service.c_str(), path.c_str(), json.c_str(), Replied,
                           new EngineReply{name, handler, id, path});
          }, weak_factory_.GetWeakPtr(), name, id, service, json));
      return;
    }
    if (arguments[1].GetString() != "host.invoke") {
      return Reply(id, false, base::Value("Unknown native transport operation"));
    }
    const base::DictValue* payload = args.FindDict("args");
    if (!payload) return Reply(id, false, base::Value("Host arguments must be an object"));
    host_->Invoke(String(args, "method"), *payload,
                  base::BindOnce(&HostMessageHandler::Reply,
                                  weak_factory_.GetWeakPtr(), id));
  }

  base::WeakPtr<ShellHostView> host_;
  uint64_t generation_ = 0;
  base::WeakPtrFactory<HostMessageHandler> weak_factory_{this};
};

class ShellDataSource : public content::URLDataSource {
 public:
  std::string GetSource() override { return "ardia"; }
  bool AllowCaching() override { return false; }
  bool ShouldServeMimeTypeAsContentTypeHeader() override { return true; }
  std::string GetMimeType(const GURL& url) override {
    return MimeType(AssetPath(url));
  }
  std::string GetContentSecurityPolicy(
      network::mojom::CSPDirectiveName directive) override {
    using Directive = network::mojom::CSPDirectiveName;
    switch (directive) {
      case Directive::DefaultSrc: return "default-src 'none';";
      case Directive::ScriptSrc: return "script-src 'self';";
      case Directive::TrustedTypes: return "trusted-types ardia-symbols;";
      case Directive::StyleSrc: return "style-src 'self' 'unsafe-inline';";
      case Directive::ImgSrc: return "img-src 'self' data: blob:;";
      case Directive::FontSrc: return "font-src 'self' data:;";
      case Directive::ConnectSrc: return "connect-src 'none';";
      case Directive::FrameSrc: return "frame-src 'none';";
      case Directive::ChildSrc: return "child-src 'none';";
      case Directive::ObjectSrc: return "object-src 'none';";
      case Directive::BaseURI: return "base-uri 'none';";
      case Directive::FormAction: return "form-action 'none';";
      default: return content::URLDataSource::GetContentSecurityPolicy(directive);
    }
  }
  void StartDataRequest(const GURL& url,
                        const content::WebContents::Getter& getter,
                        GotDataCallback callback) override {
    CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
    ShellHostView* host = HostFor(getter.Run());
    if (!host || !host->profile() || url.scheme() != "chrome" ||
        url.host() != "ardia") {
      return std::move(callback).Run(nullptr);
    }
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(&ReadAsset, AssetDirectory(), AssetPath(url),
                       DocumentDirectory(host->profile()), host->Bootstrap()),
        base::BindOnce(
            [](GotDataCallback callback, std::optional<std::string> contents) {
              std::move(callback).Run(
                  contents ? base::MakeRefCounted<base::RefCountedString>(
                                 std::move(*contents))
                           : nullptr);
            },
            std::move(callback)));
  }
};

class ShellController : public content::WebUIController {
 public:
  explicit ShellController(content::WebUI* ui) : WebUIController(ui) {
    ShellHostView* host = HostFor(ui->GetWebContents());
    if (!host || !host->profile()) return;
    content::URLDataSource::Add(host->profile(),
                                std::make_unique<ShellDataSource>());
    ui->AddMessageHandler(
        std::make_unique<HostMessageHandler>(host->GetWeakPtr()));
  }
};

class ShellConfig : public content::DefaultWebUIConfig<ShellController> {
 public:
  ShellConfig() : DefaultWebUIConfig("chrome", "ardia") {}
  bool IsWebUIEnabled(content::BrowserContext* context) override {
    return !Profile::FromBrowserContext(context)->IsOffTheRecord();
  }
};

ShellHostView::ShellHostView(BrowserWindowInterface* browser, BrowserView* parent,
                             bool startup, Profile* app_profile)
    : browser_(browser), browser_view_(parent), app_profile_(app_profile->GetWeakPtr()),
      id_(browser->GetSessionID().id()), startup_(startup),
      window_id_(Hosts().empty() ? "main" : "window-" + base::NumberToString(id_)) {
  Hosts()[id_] = this;
  shell_ = AddChildView(std::make_unique<LinuxShellWebView>(app_profile));
  view_observation_.Observe(parent);
  browser->GetTabStripModel()->AddObserver(this);
}

void ForgetOpenerHost(int host) {
  for (const auto& [id, other] : Hosts()) other->ForgetOpener(host);
  for (auto& [id, request] : RequestedWindows()) {
    if (request.opener_host != host) continue;
    request.opener_host = 0;
    request.opener_generation = 0;
  }
}

ShellHostView::~ShellHostView() {
  ReleaseDragEscape();
  ForgetOpenerHost(id_);
  LinuxImportWindowClosed(window_id_);
  WindowFocus().Forget(id_);
  weak_factory_.InvalidateWeakPtrs();
  LinuxLiveCallerGone(LiveCaller());
  handler_ = nullptr;
  renderer_document_ = content::WeakDocumentPtr();
  dialogs_.reset();
  extension_surfaces_.reset();
  RetireDocuments();
  UnregisterAccelerators();
  Hosts().erase(id_);
  LinuxExtensionsWindowClosing(id_);
  bindings_.clear();
  TabStripModelObserver::StopObservingAll(this);
  view_observation_.Reset();
}

void ShellHostView::Initialize() {
  documents_ = DocumentsFor(profile());
  dialogs_ = std::make_unique<LinuxWindowDialogs>(window_id_, DialogProfile(), GetWidget(),
                                                  ardiacore::BackgroundInstance());
  close_observation_.Observe(GetWidget());
  if (ui::Compositor* compositor = GetWidget()->GetCompositor()) {
    presentation_observation_.Observe(compositor);
  } else {
    presented_ = true;
  }
  SeedWindowActivation();
  RestoreFullScreenNow();
  ArmWindowClose();
  focus_manager_ = GetFocusManager();
  if (focus_manager_) pane_focus_observation_.Observe(focus_manager_);
  aura::Window* input_window = GetWidget()->GetNativeWindow()->GetRootWindow();
  input_observation_.Observe(input_window);
  input_handler_ = std::make_unique<WindowKeyboardHandler>(
      base::BindRepeating(&ShellHostView::OnKeyEvent, GetWeakPtr()));
  input_window->AddPreTargetHandler(input_handler_.get(), ui::EventTarget::Priority::kSystem);
  input_window->AddPreTargetHandler(&pointer_handler_, ui::EventTarget::Priority::kSystem);
  if (!is_utility()) {
    typeahead_ = std::make_unique<linux_window::TypeaheadInput>(
        input_window->GetHost(), GetWidget()->GetInputMethod(),
        base::BindRepeating(&ShellHostView::OwnsKeyboardTarget, base::Unretained(this)));
    typeahead_->Start();
    typeahead_timer_.Start(FROM_HERE, base::Seconds(10),
                           base::BindOnce(&ShellHostView::DiscardTypeahead, base::Unretained(this)));
  }
  if (is_utility()) {
    browser_view_->SetPreferredSize(kind_ == "settings" ? gfx::Size(720, 480)
                                                       : gfx::Size(640, 600));
    GetWidget()->OnSizeConstraintsChanged();
  }
  LayoutOverlay();
  StartLinuxContentBlocker(profile(), page_profile());
  if (!title_.empty()) {
    browser_->GetWindow()->GetNativeWindow()->SetTitle(base::UTF8ToUTF16(title_));
  }
  shell_->LoadInitialURL(GURL("chrome://ardia/"));
  ardiacore::WatchLinuxShellInput(shell());
}

void ShellHostView::DetachViewports() {
  if (extension_surfaces_) extension_surfaces_->RetireOlderThan(renderer_generation_);
  LinuxExtensionsWindowRetired(id_);
  for (auto& [id, binding] : bindings_) {
    binding->pane_visible = false;
    for (views::WebView* view : {binding->viewport(), binding->devtools_viewport()}) {
      if (!view) continue;
      view->SetVisible(false);
      view->SetWebContents(nullptr);
    }
  }
}

void ShellHostView::DetachBrowser() {
  RememberWindowOutput();
  if (!RetireDocuments()) return;
  weak_factory_.InvalidateWeakPtrs();
  handler_ = nullptr;
  renderer_document_ = content::WeakDocumentPtr();
  close_dialogs_.clear();
  dialogs_.reset();
  UnregisterAccelerators();
  TabStripModelObserver::StopObservingAll(this);
  view_observation_.Reset();
  bindings_.clear();
  browser_ = nullptr;
  browser_view_ = nullptr;
  Hosts().erase(id_);
  ForgetOpenerHost(id_);
}

bool ShellHostView::Trusted(content::WebUI* ui) const {
  if (!browser_ || !ui || ui->GetWebContents() != shell()) return false;
  auto* frame = shell()->GetPrimaryMainFrame();
  return frame && frame->IsRenderFrameLive() && ui->GetRenderFrameHost() == frame && frame->GetWebUI() == ui && frame->GetLastCommittedOrigin() ==
                      url::Origin::Create(GURL("chrome://ardia/")) &&
         shell()->GetLastCommittedURL().host() == "ardia";
}

base::DictValue ShellHostView::Bootstrap() const {
  base::DictValue info = base::DictValue().Set("appName", "Ardia")
      .Set("appVersion", version_info::GetVersionNumber())
      .Set("appBuild", "linux-host")
      .Set("bundleId", "dev.ardia.linux")
      .Set("configuration", "Release")
      .Set("osVersion", base::SysInfo::OperatingSystemVersion())
      .Set("osBuild", "Linux")
      .Set("arch", base::SysInfo::OperatingSystemArchitecture())
      .Set("model", "Linux")
      .Set("memoryGB", base::SysInfo::AmountOfTotalPhysicalMemory().InBytes() /
                           (1024.0 * 1024 * 1024))
      .Set("locale", "en-US")
      .Set("updates", false);
  base::FilePath user_data_directory;
  base::PathService::Get(chrome::DIR_USER_DATA, &user_data_directory);
  base::ListValue capabilities = base::ListValue().Append("ArdiaWebView.call").Append("ArdiaShell.pickFolder").Append("ArdiaShell.pickFiles")
      .Append("ArdiaShell.windowIdentity").Append("ArdiaShell.beginDialog")
      .Append("ArdiaShell.cancelDialog").Append("ArdiaShell.beginWindowCloseDrain")
      .Append("ArdiaSearch.suggest").Append("ArdiaSearch.cancelSuggest")
      .Append("ArdiaShell.launchSteps")
      .Append("ArdiaShell.completeLaunchStep")
      .Append("ArdiaShell.typeaheadReady")
      .Append("ArdiaShell.commandsReady")
      .Append("ArdiaShell.restoreFullScreen")
      .Append("ArdiaShell.downloadsInProgress")
      .Append("ArdiaShell.setDragEscapeCapture")
      .Append("ArdiaShell.quit")
      .Append("ArdiaShell.startWindowMove")
      .Append("ArdiaShell.captionDoubleClick");
  for (const char* capability : linux_downloads::kFileCapabilities) capabilities.Append(capability);
  for (const auto& route : ardiacore::linux_contract::kRoutes)
    capabilities.Append(route.name);
  for (const char* route : ardiacore::kLinuxZoomDomainRoutes)
    capabilities.Append(route);
  for (const char* route : ardiacore::kLinuxMemorySaverRoutes)
    capabilities.Append(route);
  for (const char* capability : linux_credentials::kCapabilities) capabilities.Append(capability);
  for (const char* capability : linux_extensions::kSurfaceCapabilities) capabilities.Append(capability);
  for (const char* route : ardiacore::kLinuxPageMessageRoutes)
    capabilities.Append(route);
  capabilities.Append("engine.systemState");
  AppendLinuxSyncCapabilities(capabilities);
  AppendLinuxLiveCapabilities(capabilities);
  AppendLinuxCalendarCapabilities(capabilities);
  AppendLinuxSiteControlsCapabilities(capabilities);
  for (const char* capability : linux_import::kImportCapabilities) capabilities.Append(capability);
  capabilities.Append("favicons.fetch");
  auto bootstrap = base::DictValue()
      .Set("windowId", window_id_)
      .Set("startup", startup_)
      .Set("profileId", "default")
      .Set("nativeModules", base::DictValue().Set(
                                "ArdiaApp", base::DictValue().Set(
                                                "systemInfo", std::move(info))))
      .Set("launchConfig", ardiacore::LinuxLaunchConfig(DocumentDirectory(profile()), user_data_directory))
      .Set("capabilities", std::move(capabilities));
  if (is_utility()) bootstrap.Set("utility", utility_.Clone());
  bootstrap.Set("pageProfile", page_profile_);
  if (!private_window_.empty()) bootstrap.Set("privateWindow", private_window_.Clone());
  if (typeahead_ && typeahead_->capturing() && typeahead_timer_.IsRunning()) {
    bootstrap.Set("typeaheadMs", static_cast<int>(std::max<int64_t>(
        0, (typeahead_timer_.desired_run_time() - base::TimeTicks::Now()).InMilliseconds())));
  }
  return bootstrap;
}

void ShellHostView::LayoutOverlay() {
  if (!browser_view_) return;
  SetBoundsRect(browser_view_->GetLocalBounds());
  shell_->SetBoundsRect(GetLocalBounds());
  browser_view_->GetActiveContentsWebView()->SetVisible(false);
  HideCaptionButtons();
}

void ShellHostView::HideCaptionButtons() {
  if (!browser_view_ || !browser_view_->browser_widget()) return;
  BrowserFrameView* frame = browser_view_->browser_widget()->GetFrameView();
  if (!frame) return;
  frame->SetCaptionButtonsOpacity(0.0f);
  for (int id : {VIEW_ID_MINIMIZE_BUTTON, VIEW_ID_MAXIMIZE_BUTTON, VIEW_ID_RESTORE_BUTTON, VIEW_ID_CLOSE_BUTTON}) {
    if (views::View* button = frame->GetViewByID(id)) button->GetViewAccessibility().SetIsIgnored(true);
  }
}

void ShellHostView::OnWidgetThemeChanged(views::Widget*) {
  HideCaptionButtons();
}

void ShellHostView::OnViewIsDeleting(views::View*) {
  UnregisterAccelerators();
  view_observation_.Reset();
  browser_view_ = nullptr;
}

void ShellHostView::UnregisterAccelerators() {
  if (input_observation_.IsObserving()) {
    input_observation_.GetSource()->RemovePreTargetHandler(input_handler_.get());
    input_observation_.GetSource()->RemovePreTargetHandler(&pointer_handler_);
    input_observation_.Reset();
  }
  input_handler_.reset();
  typeahead_timer_.Stop();
  typeahead_.reset();
  extension_keybindings_.reset();
  if (focus_manager_) {
    if (shortcut_recording_) focus_manager_->set_shortcut_handling_suspended(false);
  }
  shortcut_recording_ = false;
  shortcuts_.clear();
  focus_manager_ = nullptr;
}

void ShellHostView::FocusShell() {
  shell_->RequestFocus();
  if (shell()) shell()->Focus();
}

void ShellHostView::OnWindowDestroying(aura::Window*) {
  UnregisterAccelerators();
}

bool ShellHostView::OwnsKeyboardEvent(const ui::KeyEvent& event) const {
  return OwnsKeyboardTarget(static_cast<aura::Window*>(event.target()));
}

bool ShellHostView::OwnsKeyboardTarget(aura::Window* event_target) const {
  const views::Widget* widget = GetWidget();
  if (!widget) return false;
  for (auto* target = event_target; target; target = target->parent()) {
    if (const auto* owner = views::Widget::GetWidgetForNativeView(target)) {
      if (owner != widget) return false;
      break;
    }
  }
  if (wm::GetModalTransient(widget->GetNativeWindow())) return false;
  for (const auto& [id, tab] : bindings_) {
    if (tab->viewport() && tab->viewport()->GetVisible() && tab->contents() &&
        wm::GetModalTransient(tab->contents()->GetNativeView())) return false;
  }
  return true;
}

bool ShellHostView::ShellHoldsTextField() {
  views::Widget* widget = GetWidget();
  ui::InputMethod* input = widget ? widget->GetInputMethod() : nullptr;
  ui::TextInputClient* client = input ? input->GetTextInputClient() : nullptr;
  return shell_ && shell_->HasFocus() && client &&
         client->GetTextInputType() != ui::TEXT_INPUT_TYPE_NONE;
}

void ShellHostView::DiscardTypeahead() {
  typeahead_timer_.Stop();
  if (typeahead_) std::ignore = typeahead_->Release();
}

void ShellHostView::ReplayTypeahead(bool field) {
  typeahead_timer_.Stop();
  std::vector<ui::KeyEvent> held = typeahead_ ? typeahead_->Release() : std::vector<ui::KeyEvent>();
  const auto weak = GetWeakPtr();
  bool shortcut_ran = false;
  for (size_t index = 0; index < held.size(); ++index) {
    ui::KeyEvent& event = held[index];
    if (SwitcherReleasedInHold(held, index)) continue;
    if (RunHeldShortcut(event)) {
      if (!weak) return;
      shortcut_ran = true;
      continue;
    }
    if (shortcut_ran || !field || !ShellHoldsTextField()) continue;
    ui::Event::DispatcherApi(&event).set_target(GetWidget()->GetNativeWindow());
    std::ignore = GetWidget()->GetInputMethod()->DispatchKeyEvent(&event);
    if (!weak) return;
  }
}

bool ShellHostView::RunHeldShortcut(const ui::KeyEvent& event) {
  if (event.type() != ui::EventType::kKeyPressed || !CanHandleAccelerators() || !focus_manager_ ||
      shortcut_recording_ || focus_manager_->shortcut_handling_suspended() ||
      !OwnsKeyboardTarget(KeyboardFocusTarget())) return false;
  const ui::Accelerator accelerator = KeyAccelerator(event);
  return AcceleratorPressed(accelerator) || ExtensionShortcutPressed(event, shortcuts_.contains(accelerator));
}

bool ShellHostView::SwitcherReleasedInHold(const std::vector<ui::KeyEvent>& held, size_t index) const {
  const ui::KeyEvent& press = held[index];
  if (press.type() != ui::EventType::kKeyPressed) return false;
  const auto found = shortcuts_.find(KeyAccelerator(press));
  if (found == shortcuts_.end() || String(found->second, "command") != "tabSwitcher") return false;
  const int modifiers = press.flags() & (ui::EF_CONTROL_DOWN | ui::EF_ALT_DOWN | ui::EF_COMMAND_DOWN);
  for (size_t later = index + 1; later < held.size(); ++later) {
    if (held[later].type() == ui::EventType::kKeyReleased &&
        (linux_window::TypeaheadModifierFlag(held[later].key_code()) & modifiers)) return true;
  }
  return false;
}

linux_window::ShortcutKind ShellHostView::LiveShortcutKind(const ui::KeyEvent& event) const {
  if (live_generation_ != renderer_generation_ || !CanHandleAccelerators() || shortcut_recording_)
    return linux_window::ShortcutKind::kNone;
  const auto found = shortcuts_.find(KeyAccelerator(event));
  if (found == shortcuts_.end() || found->second.FindBool("notInText").value_or(false))
    return linux_window::ShortcutKind::kNone;
  if (found->second.FindBool("suppressed").value_or(false)) return linux_window::ShortcutKind::kShortcut;
  return CommandFocusesShell(String(found->second, "command")) ? linux_window::ShortcutKind::kFocusing
                                                              : linux_window::ShortcutKind::kShortcut;
}

bool ShellHostView::CommandFocusesShell(const std::string& command) {
  return command == "focusCommandBar" || command == "newTab" ||
         command == "newTabInGroup" || command == "findInPage" ||
         command == "findAndReplace" || command == "searchTabs" ||
         command == "tabSwitcher" || command == "openProfileMenu" ||
         command == "closeTab";
}

aura::Window* ShellHostView::KeyboardFocusTarget() const {
  const views::Widget* widget = GetWidget();
  aura::Window* root = widget ? widget->GetNativeWindow()->GetRootWindow() : nullptr;
  aura::client::FocusClient* focus = root ? aura::client::GetFocusClient(root) : nullptr;
  aura::Window* focused = focus ? focus->GetFocusedWindow() : nullptr;
  return focused ? focused : root;
}

ui::Accelerator ShellHostView::KeyAccelerator(const ui::KeyEvent& event) {
  const ui::KeyboardCode physical = ui::DomCodeToUsLayoutKeyboardCode(event.code());
  return ui::Accelerator(physical == ui::VKEY_UNKNOWN ? event.key_code() : physical, event.flags());
}

bool ShellHostView::ForwardDragEscape(const ui::KeyEvent& event) {
  constexpr int modifiers = ui::EF_SHIFT_DOWN | ui::EF_CONTROL_DOWN | ui::EF_ALT_DOWN | ui::EF_COMMAND_DOWN;
  if (!DragEscapeOwner() || event.type() != ui::EventType::kKeyPressed ||
      event.key_code() != ui::VKEY_ESCAPE || (event.flags() & modifiers) || !OwnsKeyboardEvent(event)) return false;
  const auto owner = Hosts().find(*DragEscapeOwner());
  if (owner == Hosts().end()) return false;
  owner->second->Event("ArdiaShell", "onAppEvent", base::Value(base::DictValue().Set("type", "dragEscape")));
  return true;
}

void ShellHostView::ReleaseDragEscape() {
  if (DragEscapeOwner() == id_) DragEscapeOwner().reset();
}

void ShellHostView::OnKeyEvent(ui::KeyEvent* event) {
  if (ForwardDragEscape(*event)) return event->StopPropagation();
  if (!CanHandleAccelerators() || !OwnsKeyboardEvent(*event) || !focus_manager_ || shortcut_recording_ ||
      focus_manager_->shortcut_handling_suspended() ||
      event->type() != ui::EventType::kKeyPressed) return;
  const ui::Accelerator accelerator = KeyAccelerator(*event);
  if (base::CommandLine::ForCurrentProcess()->HasSwitch("ardia-keyboard-diagnostics") &&
      (event->IsControlDown() || shortcuts_.contains(accelerator))) {
    LOG(INFO) << "Ardia key window=" << window_id_
              << " key=" << event->key_code() << " code=" << static_cast<int>(event->code())
              << " flags=" << event->flags()
              << " view=" << static_cast<bool>(focus_manager_->GetFocusedView())
              << " shell_view=" << shell_->HasFocus()
              << " binding=" << shortcuts_.contains(accelerator);
  }
  if (AcceleratorPressed(accelerator) || ExtensionShortcutPressed(*event, shortcuts_.contains(accelerator))) {
    event->StopPropagation();
  }
}

bool ShellHostView::ExtensionShortcutPressed(const ui::KeyEvent& event, bool reserved_by_ardia) {
  if (!ExtensionsListening() || !page_profile()) return false;
  if (!extension_keybindings_) {
    extension_keybindings_ = std::make_unique<LinuxExtensionKeybindings>(
        browser_.get(), base::BindRepeating(
            [](base::WeakPtr<ShellHostView> host, content::WebContents* contents, const extensions::ExtensionId& id) {
              if (!host) return false;
              const std::string key = host->ExtensionTabKey(contents);
              return !key.empty() && host->ExtensionEvent(linux_extension_shortcuts::kActionShortcutEvent,
                                                          base::DictValue().Set("tabId", key).Set("extensionId", id));
            },
            GetWeakPtr()));
  }
  return extension_keybindings_->Handle(ui::Accelerator(event.key_code(), event.flags()), reserved_by_ardia);
}

bool ShellHostView::CanHandleAccelerators() const {
  return browser_ && (is_utility() || handler_);
}

LinuxDocumentClient ShellHostView::DocumentClient() const {
  return document_client_;
}

bool ShellHostView::EnsureDocumentClient() {
  if (!documents_ || !handler_ || !handler_->Authorized() ||
      !profile() || !profile()->IsRegularProfile()) return false;
  if (document_client_.id.empty()) {
    document_client_ = {documents_->scope + ":" + document_window_ + ":" +
                            base::NumberToString(renderer_generation_),
                        documents_->scope, true, true};
    document_client_generation_ = renderer_generation_;
  }
  return document_client_generation_ == renderer_generation_ &&
         document_client_.scope == documents_->scope;
}

bool ShellHostView::RetireDocuments() {
  const auto weak = GetWeakPtr();
  const auto authority = documents_;
  const auto client = DocumentClient();
  const auto close_generation = close_.identity().close;
  const bool closing = close_.phase() != LinuxClose::Phase::kIdle;
  const bool coordinated = chrome_close_token_.has_value() || close_.HandedOff();
  std::vector<base::OnceCallback<void(bool, base::Value)>> retired_cancellations;
  ++document_subscription_;
  document_watched_ = false;
  document_client_ = {};
  document_client_generation_ = 0;
  if (authority && !client.id.empty()) {
    if (closing && !coordinated) {
      authority->service.AsyncCall(&LinuxDocumentService::CancelSeal)
          .WithArgs(client, close_generation)
          .Then(base::BindOnce([](base::WeakPtr<ShellHostView> host, std::string close_generation,
                                  LinuxDocumentResult result) {
            if (host && result.ok()) host->ResumeDialogsForClose(close_generation);
          }, weak, close_generation));
    }
    authority->service.AsyncCall(&LinuxDocumentService::Retire).WithArgs(client);
  }
  document_used_ = false;
  if (coordinated) {
    FinishChromePreparations(false);
    if (chrome_close_token_ && !close_.Irreversible()) {
      CancelLinuxCloseAttempt(browser_, *chrome_close_token_);
      if (!weak) return false;
    }
  } else {
    close_.Retire();
    close_departure_.reset();
    close_client_ = {};
    close_browser_.reset();
    close_widget_.reset();
    close_window_.clear();
    close_error_.reset();
    close_cancel_running_ = false;
    retired_cancellations = std::move(close_cancellations_);
  }
  auto watches = std::move(pending_document_watches_);

  auto replies = std::move(close_replies_);
  for (auto& reply : replies)
    std::move(reply).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_STALE").Set("message", "Renderer retired")));
  for (auto& watch : watches)
    std::move(watch.done).Run({"ERR_DOCUMENT_AUTH", "Renderer retired", {}});
  for (auto& done : retired_cancellations)
    std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_STALE").Set("message", "Renderer retired")));
  return !!weak;
}

void ShellHostView::DocumentCall(
    std::string verb, base::DictValue request,
    base::OnceCallback<void(LinuxDocumentResult)> done) {
  if (!EnsureDocumentClient())
    return std::move(done).Run({"ERR_DOCUMENT_AUTH", "Document access denied", {}});
  if (verb != "watch" && verb != "commit" && verb != "flush" && verb != "unwatch")
    return std::move(done).Run({"ERR_UNKNOWN_CALL", "Unknown document operation", {}});
  const auto* document = request.FindString("document");
  if ((verb == "watch" || verb == "unwatch") &&
      (request.size() != 1 || !document || *document != kLinuxLiveDocument))
    return std::move(done).Run({"ERR_DOCUMENT_REQUEST", "Invalid document subscription", {}});
  if (verb == "watch" || verb == "unwatch") {
    if (document_subscription_ == UINT64_MAX)
      return std::move(done).Run({"ERR_DOCUMENT_LIMIT", "Document subscription exhausted", {}});
    ++document_subscription_;
    document_watched_ = false;
    auto superseded = std::move(pending_document_watches_);
    for (auto& watch : superseded)
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(std::move(watch.done),
              LinuxDocumentResult{"ERR_DOCUMENT_SUBSCRIPTION", "Document subscription replaced", {}}));
  }
  if (verb == "watch" && chrome_close_token_ &&
      close_.identity().renderer != base::NumberToString(renderer_generation_)) {
    if (pending_document_watches_.size() >= 64)
      return std::move(done).Run({"ERR_DOCUMENT_LIMIT", "Too many pending subscriptions", {}});
    pending_document_watches_.push_back({renderer_generation_, document_subscription_,
                                         std::move(request), std::move(done)});
    return;
  }
  if ((close_.BlocksWrites() || (chrome_close_token_ &&
       close_.identity().renderer != base::NumberToString(renderer_generation_))) && (verb == "commit" || verb == "watch"))
    return std::move(done).Run({"ERR_DOCUMENT_CLOSING", "Window is closing", {}});
  if (verb == "watch" || verb == "unwatch") {
    document_watched_ = verb == "watch";
    if (document_watched_) document_used_ = true;
  }
  const auto client = DocumentClient();
  const auto ui = base::SingleThreadTaskRunner::GetCurrentDefault();
  auto changed = [ui, weak = GetWeakPtr(), client,
                  generation = renderer_generation_, subscription = document_subscription_]
                 (base::DictValue payload) {
    ui->PostTask(FROM_HERE, base::BindOnce(
        [](base::WeakPtr<ShellHostView> host, LinuxDocumentClient client,
           uint64_t generation, uint64_t subscription, base::DictValue payload) {
          if (!host || !host->handler_ || !host->documents_ ||
              !host->profile() || !host->profile()->IsRegularProfile() ||
              host->renderer_generation_ != generation ||
              host->document_subscription_ != subscription ||
              !host->document_watched_ || host->documents_->scope != client.scope) return;
          host->Event("ArdiaDocuments", "documents", base::Value(base::DictValue()
              .Set("name", "documents.changed").Set("data", std::move(payload))));
        }, weak, client, generation, subscription, std::move(payload)));
  };
  std::optional<StorageTicket> ticket;
  if (verb == "commit") {
    auto operation = request.Clone();
    operation.Remove("requestId");
    operation.Remove("observedRevision");
    operation.Set("authority", documents_->scope);
    ticket = BeginStorageIntent(kLinuxLiveEnvelope, std::move(operation));
    if (!ticket)
      return std::move(done).Run({"ERR_DOCUMENT_LIMIT", "Window storage ledger is full", {}});
  }
  documents_->service.AsyncCall(&LinuxDocumentService::DispatchTracked)
      .WithArgs(std::move(verb), client, std::move(request),
                LinuxDocuments::Changed(std::move(changed)))
      .Then(base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, std::optional<StorageTicket> ticket,
             base::OnceCallback<void(LinuxDocumentResult)> done,
             LinuxDocumentDispatchResult dispatched) {
            if (host && ticket)
              host->CompleteStorageIntent(*ticket,
                  dispatched.durability == LinuxDocumentDurability::kCommitted,
                  dispatched.durability == LinuxDocumentDurability::kFailed);
            std::move(done).Run(std::move(dispatched.result));
          }, GetWeakPtr(), std::move(ticket), std::move(done)));
}

std::optional<ShellHostView::StorageTicket> ShellHostView::BeginStorageIntent(
    std::string name, base::DictValue operation) {
  if (storage_pending_ >= 128 || storage_sequence_ == UINT64_MAX) return std::nullopt;
  std::shared_ptr<StorageIntent> intent;
  for (const auto& item : storage_intents_) {
    if (item->name == name && item->operation == operation) { intent = item; break; }
  }
  if (!intent) {
    auto encoded = base::WriteJsonWithOptions(
        operation, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION, 128);
    if (!encoded || encoded->size() > 2 * kLinuxLiveMaxBytes + 1024 ||
        storage_intents_.size() >= 128 ||
        storage_bytes_ > 4 * kLinuxLiveMaxBytes - encoded->size() ||
        storage_pending_bytes_ > 4 * kLinuxLiveMaxBytes - encoded->size()) return std::nullopt;
    intent = std::make_shared<StorageIntent>(StorageIntent{
        std::move(name), std::move(operation), encoded->size()});
    storage_bytes_ += intent->bytes;
    storage_intents_.push_back(intent);
  }
  if (storage_pending_bytes_ > 4 * kLinuxLiveMaxBytes - intent->bytes) return std::nullopt;
  ++intent->pending;
  storage_pending_bytes_ += intent->bytes;
  ++storage_pending_;
  return StorageTicket{std::move(intent), ++storage_sequence_};
}

void ShellHostView::CompleteStorageIntent(const StorageTicket& ticket,
                                         bool durable, bool failed) {
  const auto& intent = ticket.intent;
  --storage_pending_;
  storage_pending_bytes_ -= intent->bytes;
  --intent->pending;
  if (failed) intent->failure = std::max(intent->failure, ticket.sequence);
  else if (durable && intent->failure <= ticket.sequence) intent->failure = 0;
  if (durable && !failed) {
    std::erase_if(storage_intents_, [&](const auto& item) {
      if (item == intent || item->name != intent->name || item->operation != intent->operation ||
          item->pending || item->failure > ticket.sequence) return false;
      storage_bytes_ -= item->bytes;
      return true;
    });
  }
  if (!intent->pending && !intent->failure) {
    storage_bytes_ -= intent->bytes;
    std::erase(storage_intents_, intent);
  }
  if (std::ranges::any_of(storage_intents_, [&intent](const auto& item) {
        return item->name == intent->name && item->failure;
      })) storage_failures_.insert(intent->name);
  else storage_failures_.erase(intent->name);
}

bool ShellHostView::TrackStorageWrite(
    std::string name, base::DictValue operation,
    base::OnceCallback<void(bool, base::Value)>& done) {
  auto ticket = BeginStorageIntent(std::move(name), std::move(operation));
  if (!ticket) return false;
  done = base::BindOnce(
      [](base::WeakPtr<ShellHostView> host, StorageTicket ticket,
         base::OnceCallback<void(bool, base::Value)> done,
         bool ok, base::Value value) {
        if (host) host->CompleteStorageIntent(ticket, ok, !ok);
        std::move(done).Run(ok, std::move(value));
      }, GetWeakPtr(), std::move(*ticket), std::move(done));
  return true;
}

void ShellHostView::CloseNativeWindow(LinuxClose::Identity identity) {
  if (!browser_) return;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          [](base::WeakPtr<ShellHostView> host,
             base::WeakPtr<BrowserWindowInterface> browser, std::string window,
             LinuxClose::Identity identity) {
            if (!host || !browser || host->browser_ != browser.get() ||
                host->window_id_ != window ||
                host->chrome_close_token_ ||
                !CurrentLinuxCloseToken(browser.get()).is_empty() ||
                host->close_.phase() != LinuxClose::Phase::kSealed ||
                !host->close_.Matches(identity, host->renderer_generation_) ||
                !host->ReadyForChromeClose(identity) ||
                !host->close_.CanClose() || host->storage_pending_ ||
                !host->storage_failures_.empty() || !host->handler_ ||
                !host->handler_->Authorized() || !host->profile() ||
                !host->profile()->IsRegularProfile() || !host->GetWidget() ||
                host->GetWidget()->IsClosed()) return;
            const auto token = base::UnguessableToken::Create();
            if (!BindLinuxCloseAttempt(browser.get(), token)) {
              host->CancelWindowClose(identity, base::BindOnce([](bool, base::Value) {}));
              return;
            }
            host->chrome_close_token_ = token;
            if (!host->close_.HandOff(identity, host->renderer_generation_)) {
              host->CancelWindowClose(identity, base::BindOnce([](bool, base::Value) {}));
              return;
            }
            browser->GetWindow()->Close();
          }, GetWeakPtr(), browser_->GetWeakPtr(), window_id_, std::move(identity)));
}

void ShellHostView::ArmWindowClose() {
  if (!browser_ || !browser_view_ || !GetWidget() || GetWidget()->IsClosed()) return;
  GetWidget()->MakeCloseSynchronous(base::BindOnce(
      [](base::WeakPtr<ShellHostView> host, base::WeakPtr<views::Widget> widget,
         views::Widget::ClosedReason reason) {
        if (!host || !widget || widget->IsClosed()) return;
        host->ArmWindowClose();
        if (!host->ReadyForChromeClose(host->close_.identity())) {
          host->RequestWindowClose();
          return;
        }
        widget->MakeCloseSynchronous({});
        widget->CloseWithReason(reason);
        if (host && widget && !widget->IsClosed()) host->ArmWindowClose();
      }, GetWeakPtr(), GetWidget()->GetWeakPtr()));
}

base::DictValue ShellHostView::RequestWindowClose() {
  if (!browser_ || !browser_view_ || !handler_ || !handler_->Authorized() || !GetWidget() ||
      GetWidget()->IsClosed() || !EnsureDocumentClient()) return {};
  if (close_.phase() != LinuxClose::Phase::kIdle &&
      close_.phase() != LinuxClose::Phase::kCancelled &&
      close_.identity().renderer != base::NumberToString(renderer_generation_)) return {};
  const bool fresh = close_.phase() == LinuxClose::Phase::kIdle ||
                     close_.phase() == LinuxClose::Phase::kCancelled;
  const auto identity = close_.Request(renderer_generation_);
  if (!identity) return {};
  base::DictValue request;
  request.Set("windowId", window_id_);
  request.Set("rendererGeneration", identity->renderer);
  request.Set("closeGeneration", identity->close);
  if (fresh) {
    close_client_ = DocumentClient();
    close_browser_ = browser_->GetWeakPtr();
    close_widget_ = GetWidget()->GetWeakPtr();
    close_window_ = window_id_;
    close_error_.reset();
  }
  if (close_.phase() == LinuxClose::Phase::kRequested)
    Event("ArdiaShell", "shell", base::Value(base::DictValue()
        .Set("name", "shell.closeRequested").Set("data", request.Clone())
        .Set("quitting", base::Value(browser_shutdown::IsTryingToQuit()))));
  return request;
}

void ShellHostView::BeginWindowCloseDrain(
    const base::DictValue& request,
    base::OnceCallback<void(bool, base::Value)> done) {
  const LinuxClose::Identity identity{String(request, "rendererGeneration"),
                                      String(request, "closeGeneration")};
  const bool deciding = close_.phase() == LinuxClose::Phase::kRequested;
  if (!handler_ || !handler_->Authorized() || request.size() != 3 ||
      String(request, "windowId") != window_id_ || !documents_ ||
      !close_.BeginDrain(identity, renderer_generation_))
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_STALE").Set("message", "Invalid close drain")));
  if (deciding) {
    auto alive = GetWeakPtr();
    SuspendDialogsForClose(identity.close);
    if (!alive) return;
  }
  if (deciding)
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(
            [](base::WeakPtr<ShellHostView> host, LinuxClose::Identity identity) {
              if (!host || !host->close_.Matches(identity, host->renderer_generation_) ||
                  !host->AwaitingChromeHandoff()) return;
              host->CancelWindowClose(identity, base::BindOnce([](bool, base::Value) {}));
            }, GetWeakPtr(), identity), base::Seconds(30));
  std::move(done).Run(true, base::Value(base::DictValue()
      .Set("accepted", base::Value(true))
      .Set("endsSession", base::Value(ClosingEndsSession()))));
}

bool ShellHostView::AwaitingChromeHandoff() const {
  const auto phase = close_.phase();
  return phase == LinuxClose::Phase::kDraining || phase == LinuxClose::Phase::kSealing ||
         (phase == LinuxClose::Phase::kSealed && !chrome_close_token_);
}

bool ShellHostView::ClosingEndsSession() const {
  if (browser_shutdown::IsTryingToQuit()) return true;
  for (const auto& [id, host] : Hosts()) {
    if (host == this || host->is_utility() || !host->GetWidget() || host->GetWidget()->IsClosed()) continue;
    const auto phase = host->close_.phase();
    if (phase != LinuxClose::Phase::kIdle && phase != LinuxClose::Phase::kRequested &&
        phase != LinuxClose::Phase::kCancelling && phase != LinuxClose::Phase::kCancelled) continue;
    return false;
  }
  return true;
}

std::string ShellHostView::DialogProfile() const {
  return documents_ ? documents_->scope : std::string();
}

std::optional<LinuxDialogClient> ShellHostView::DialogClient() const {
  if (!handler_ || !handler_->Authorized() || !renderer_generation_ || !profile() || !documents_)
    return std::nullopt;
  return LinuxDialogClient{window_id_, DialogProfile(), base::NumberToString(renderer_generation_),
                           true, profile()->IsRegularProfile()};
}

void ShellHostView::DialogInvoke(const std::string& method, const base::ListValue& values,
                                 base::OnceCallback<void(bool, base::Value)> done) {
  const auto client = DialogClient();
  const auto refuse = [](base::OnceCallback<void(bool, base::Value)> done, std::string message) {
    std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_DIALOG").Set("message", message)));
  };
  if (!client || !dialogs_) return refuse(std::move(done), "Dialog requester is not current");
  if (method == "ArdiaShell.cancelDialog") {
    if (values.size() != 1 || !values[0].is_string() ||
        !dialogs_->controller().Cancel(*client, values[0].GetString()))
      return refuse(std::move(done), "Invalid dialog cancellation");
    return std::move(done).Run(true, base::Value());
  }
  if (values.size() != 1 || !values[0].is_dict()) return refuse(std::move(done), "Invalid dialog request");
  std::string error;
  auto completion = base::BindOnce(
      [](base::WeakPtr<ShellHostView> host, base::WeakPtr<HostMessageHandler> origin,
         uint64_t generation, base::DictValue envelope) {
        if (!host || !origin || !host->OwnsHandler(origin.get(), generation) ||
            !origin->Authorized()) return;
        origin->SendEvent("ArdiaShell", "shell", base::Value(std::move(envelope)));
      }, GetWeakPtr(), handler_->GetWeakPtr(), renderer_generation_);
  auto alive = GetWeakPtr();
  const bool begun = dialogs_->controller().Begin(*client, values[0].GetDict(), std::move(completion), &error);
  if (!alive) return;
  if (!begun) return refuse(std::move(done), error);
  std::move(done).Run(true, base::Value(base::DictValue().Set("accepted", base::Value(true))));
}

void ShellHostView::SuspendDialogsForClose(const std::string& close_generation) {
  if (!dialogs_ || close_dialogs_.contains(close_generation)) return;
  if (close_dialogs_.size() >= LinuxDialogController::kMaxSuspensions) {
    dialogs_->Suspend();
    return;
  }
  close_dialogs_.emplace(close_generation, LinuxDialogSuspension());
  auto alive = GetWeakPtr();
  auto token = dialogs_->Suspend();
  if (!alive) return;
  if (auto found = close_dialogs_.find(close_generation); found != close_dialogs_.end())
    found->second = token;
}

void ShellHostView::ResumeDialogsForClose(const std::string& close_generation) {
  const auto found = close_dialogs_.find(close_generation);
  if (found == close_dialogs_.end()) return;
  const auto token = found->second;
  close_dialogs_.erase(found);
  if (dialogs_ && token) dialogs_->Resume(token);
}

void ShellHostView::RequestUtilityClose() {
  utility_close_pending_ = true;
  if (!utility_ready_) return;
  RequestWindowClose();
}

bool ShellHostView::ReadyForChromeClose(const LinuxClose::Identity& identity) const {
  const auto* widget = GetWidget();
  if (!close_browser_ || !close_widget_ || close_browser_.get() != browser_ ||
      close_widget_.get() != widget || !browser_view_ || close_window_ != window_id_ ||
      !documents_ || close_client_.id.empty() || !close_client_.privileged ||
      !close_client_.regular || close_client_.scope != documents_->scope ||
      !close_.IsCurrent(identity) || !close_.CanClose() ||
      storage_pending_ || !storage_failures_.empty()) return false;
  if (close_.Irreversible()) return chrome_close_token_.has_value();
  return close_.Matches(identity, renderer_generation_) &&
         close_client_.id == document_client_.id && handler_ &&
         handler_->Authorized() && profile() && profile()->IsRegularProfile() &&
         !widget->IsClosed();
}

LinuxCloseAdmission ShellHostView::AdmitChromeTeardown(
    LinuxClose::Identity identity, base::UnguessableToken token, LinuxCloseStage stage) {
  if (!chrome_close_token_ || *chrome_close_token_ != token ||
      close_.Irreversible() || !ReadyForChromeClose(identity))
    return LinuxCloseAdmission::kRejected;
  const auto weak = GetWeakPtr();
  const auto close_generation = identity.close;
  const auto admission = CommitLinuxCloseTeardown(browser_, token, stage, base::BindOnce(
      [](base::WeakPtr<ShellHostView> host,
         base::WeakPtr<BrowserWindowInterface> browser,
         LinuxClose::Identity identity, base::UnguessableToken token) {
        if (!host || !browser || host->browser_ != browser.get() ||
            !host->chrome_close_token_ || *host->chrome_close_token_ != token ||
            host->close_.Irreversible() ||
            !host->close_.Matches(identity, host->renderer_generation_) ||
            !host->ReadyForChromeClose(identity)) return false;
        return host->close_.BeginTeardown(identity, host->renderer_generation_);
      }, GetWeakPtr(), close_browser_, std::move(identity), token));
  if (admission == LinuxCloseAdmission::kCommitted && weak && weak->close_.Irreversible())
    weak->CommitWindowDeparture(close_generation);
  return admission;
}

void ShellHostView::CommitWindowDeparture(const std::string& close_generation) {
  if (!close_departure_ || close_departure_->first != close_generation || !profile()) return;
  auto departure = std::move(close_departure_->second);
  close_departure_.reset();
  ForgetWindowOutput();
  PersistWindowDeparture(profile(), window_id_, std::move(departure));
}

void ShellHostView::ReplyChromeClose(
    LinuxCloseStage stage, LinuxClose::Identity identity,
    base::UnguessableToken token, base::OnceCallback<void(bool)> continuation,
    bool ready) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, LinuxCloseStage stage,
             LinuxClose::Identity identity, base::UnguessableToken token,
             base::OnceCallback<void(bool)> continuation, bool ready) {
            bool proceed = ready && host && host->chrome_close_token_ &&
                           *host->chrome_close_token_ == token &&
                           host->ReadyForChromeClose(identity);
            if (proceed && stage != LinuxCloseStage::kPrepare && !host->close_.Irreversible()) {
              const auto admission = host->AdmitChromeTeardown(identity, token, stage);
              if (admission == LinuxCloseAdmission::kRetryPreflight)
                return std::move(continuation).Run(true);
              proceed = admission == LinuxCloseAdmission::kCommitted && host &&
                        host->close_.Irreversible() && host->ReadyForChromeClose(identity);
            }
            if (proceed && stage == LinuxCloseStage::kDestroy)
              proceed = host->close_.Destroy(identity);
            std::move(continuation).Run(proceed);
          }, GetWeakPtr(), stage, std::move(identity), token,
          std::move(continuation), ready));
}

void ShellHostView::FinishChromePreparations(bool ready) {
  auto pending = std::move(close_preparations_);
  const auto identity = close_.identity();
  const auto token = chrome_close_token_.value_or(base::UnguessableToken());
  for (auto& [stage, continuation] : pending)
    ReplyChromeClose(stage, identity, token, std::move(continuation), ready);
}

bool ShellHostView::DeferChromeClose(
    const base::UnguessableToken& supplied, LinuxCloseStage stage,
    base::OnceCallback<void(bool)> continuation) {
  const auto weak = GetWeakPtr();
  if (!chrome_close_token_ && supplied.is_empty()) {
    const auto request = RequestWindowClose();
    if (!weak) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(std::move(continuation), false));
      return true;
    }
    if (!request.empty()) {
      const auto token = base::UnguessableToken::Create();
      if (BindLinuxCloseAttempt(browser_, token)) chrome_close_token_ = token;
      else CancelWindowClose(close_.identity(), base::BindOnce([](bool, base::Value) {}));
    }
  }
  if (!chrome_close_token_ || (!supplied.is_empty() && *chrome_close_token_ != supplied) ||
      (!close_.Matches(close_.identity(), renderer_generation_) && !close_.Irreversible()) ||
      close_.phase() == LinuxClose::Phase::kCancelling ||
      close_.phase() == LinuxClose::Phase::kCancelled) {
    ReplyChromeClose(stage, close_.identity(), supplied, std::move(continuation), false);
    return true;
  }
  const auto identity = close_.identity();
  if (ReadyForChromeClose(identity)) {
    const auto token = *chrome_close_token_;
    if (stage != LinuxCloseStage::kPrepare && !close_.Irreversible()) {
      const auto admission = AdmitChromeTeardown(identity, token, stage);
      if (admission != LinuxCloseAdmission::kCommitted) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(std::move(continuation),
                admission == LinuxCloseAdmission::kRetryPreflight));
        return true;
      }
      if (!weak || !weak->close_.Irreversible() || !weak->ReadyForChromeClose(identity)) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(std::move(continuation), false));
        return true;
      }
    }
    const bool accepted = stage != LinuxCloseStage::kDestroy || weak->close_.Destroy(identity);
    if (!accepted)
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(std::move(continuation), false));
    return !accepted;
  }
  if (close_preparations_.size() >= 64 || close_.HandedOff() || close_error_) {
    ReplyChromeClose(stage, identity, *chrome_close_token_, std::move(continuation), false);
    return true;
  }
  close_preparations_.emplace_back(stage, std::move(continuation));
  return true;
}

void ShellHostView::ChromeCloseCancelled(const base::UnguessableToken& token) {
  if (!chrome_close_token_ || *chrome_close_token_ != token || close_.Irreversible()) return;
  FinishChromePreparations(false);
  CancelDocumentSeal(close_.identity(), true);
}

void ShellHostView::CancelWindowClose(
    LinuxClose::Identity identity,
    base::OnceCallback<void(bool, base::Value)> done) {
  if (!documents_ || !close_.Matches(identity, renderer_generation_))
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_STALE").Set("message", "Close request is not current")));
  if (close_.phase() == LinuxClose::Phase::kCancelled)
    return std::move(done).Run(true, base::Value());
  if (close_cancellations_.size() >= 64)
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_LIMIT").Set("message", "Too many close cancellations")));
  if (close_.Irreversible() || (!chrome_close_token_ &&
      (close_.HandedOff() || (browser_ && !CurrentLinuxCloseToken(browser_).is_empty()))))
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_IN_PROGRESS").Set("message", "Chromium teardown is in progress")));
  close_cancellations_.push_back(std::move(done));
  if (chrome_close_token_) {
    const auto weak = GetWeakPtr();
    if (!CancelLinuxCloseAttempt(browser_, *chrome_close_token_) && weak) {
      auto rejected = std::move(close_cancellations_.back());
      close_cancellations_.pop_back();
      std::move(rejected).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_WINDOW_CLOSE_IN_PROGRESS").Set("message", "Chromium cancellation is not confirmed")));
    }
    return;
  }
  CancelDocumentSeal(identity, false);
}

void ShellHostView::CancelDocumentSeal(LinuxClose::Identity identity, bool chrome_aborted) {
  if (close_cancel_running_ || !documents_ || !close_.BeginCancel(identity, chrome_aborted)) return;
  close_cancel_running_ = true;
  documents_->service.AsyncCall(&LinuxDocumentService::CancelSeal)
      .WithArgs(close_client_, identity.close)
      .Then(base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, LinuxClose::Identity identity,
             LinuxDocumentResult result) {
            if (!host || !host->close_.IsCurrent(identity)) return;
            host->close_cancel_running_ = false;
            auto cancellations = std::move(host->close_cancellations_);
            if (!result.ok()) {
              for (auto& done : cancellations)
                std::move(done).Run(false, base::Value(base::DictValue()
                    .Set("code", result.code).Set("message", result.message)));
              return;
            }
            if (!host->close_.Cancelled(identity)) return;
            host->close_departure_.reset();
            host->ResumeDialogsForClose(identity.close);
            host->chrome_close_token_.reset();
            host->close_client_ = {};
            host->close_browser_.reset();
            host->close_widget_.reset();
            host->close_window_.clear();
            auto replies = std::move(host->close_replies_);
            auto watches = std::move(host->pending_document_watches_);
            host->utility_close_pending_ = false;
            const auto weak = host;
            host->Event("ArdiaShell", "shell", base::Value(base::DictValue()
                .Set("name", "shell.closeCancelled").Set("data", base::DictValue()
                    .Set("windowId", host->window_id_)
                    .Set("rendererGeneration", identity.renderer)
                    .Set("closeGeneration", identity.close))));
            for (auto& watch : watches) {
              if (!weak || watch.generation != weak->renderer_generation_)
                std::move(watch.done).Run({"ERR_DOCUMENT_AUTH", "Renderer changed", {}});
              else if (watch.subscription != weak->document_subscription_)
                std::move(watch.done).Run({"ERR_DOCUMENT_SUBSCRIPTION", "Document subscription replaced", {}});
              else
                weak->DocumentCall("watch", std::move(watch.request), std::move(watch.done));
            }
            for (auto& reply : replies)
              std::move(reply).Run(false, base::Value(base::DictValue()
                  .Set("code", "ERR_WINDOW_CLOSE_CANCELLED").Set("message", "Window close cancelled")));
            for (auto& done : cancellations) std::move(done).Run(true, base::Value());
          }, GetWeakPtr(), identity));
}

void ShellHostView::AcknowledgeWindowClose(
    const base::DictValue& request,
    base::OnceCallback<void(bool, base::Value)> done) {
  const LinuxClose::Identity identity{String(request, "rendererGeneration"),
                                      String(request, "closeGeneration")};
  const auto watermark = request.FindInt("watermark");
  const auto phase = close_.phase();
  const auto* departure = request.FindDict("departure");
  const bool departure_valid = !departure || (departure->size() == 2 &&
      departure->FindDict("base") && departure->FindDict("session"));
  if (!handler_ || !handler_->Authorized() || !departure_valid ||
      request.size() != (departure ? 5u : 4u) || String(request, "windowId") != window_id_ ||
      !watermark || !documents_ ||
      !close_.BeginSeal(identity, renderer_generation_, *watermark))
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_STALE").Set("message", "Invalid close acknowledgment")));
  if (close_error_)
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", close_error_->first).Set("message", close_error_->second)));
  if (close_replies_.size() >= 64)
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_WINDOW_CLOSE_LIMIT").Set("message", "Too many close acknowledgments")));
  close_replies_.push_back(std::move(done));
  if (phase == LinuxClose::Phase::kSealing || close_.CanClose()) return;
  if (departure) close_departure_.emplace(identity.close, departure->Clone());
  else close_departure_.reset();
  documents_->service.AsyncCall(&LinuxDocumentService::Seal)
      .WithArgs(DocumentClient(), identity.close, *watermark, document_used_)
      .Then(base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, LinuxClose::Identity identity,
             LinuxDocumentResult result) {
            if (!host || !host->close_.Matches(identity, host->renderer_generation_) ||
                host->close_.phase() != LinuxClose::Phase::kSealing) return;
            if (!result.ok()) {
              host->close_error_ = {result.code, result.message};
              host->FinishChromePreparations(false);
              auto replies = std::move(host->close_replies_);
              for (auto& reply : replies)
                std::move(reply).Run(false, base::Value(base::DictValue()
                    .Set("code", result.code).Set("message", result.message)));
              return;
            }
            if (host->storage_pending_ || !host->storage_failures_.empty()) {
              host->close_error_ = {"ERR_DOCUMENT_STORAGE", "Window storage has unresolved writes"};
              host->FinishChromePreparations(false);
              auto replies = std::move(host->close_replies_);
              for (auto& reply : replies)
                std::move(reply).Run(false, base::Value(base::DictValue()
                    .Set("code", "ERR_DOCUMENT_STORAGE")
                    .Set("message", "Window storage has unresolved writes")));
              return;
            }
            if (!host->browser_ || !host->browser_view_ || !host->GetWidget() ||
                host->GetWidget()->IsClosed() || !host->handler_ || !host->handler_->Authorized() ||
                !host->profile() || !host->profile()->IsRegularProfile()) return;
            if (!host->close_.Sealed(identity, host->renderer_generation_)) return;
            host->FinishChromePreparations(true);
            if (!host->chrome_close_token_) host->CloseNativeWindow(identity);
          }, GetWeakPtr(), identity));
}

void ShellHostView::OnWidgetClosing(views::Widget*) {
  RememberWindowOutput();
  auto replies = std::move(close_replies_);
  const bool sealed = close_.CanClose();
  for (auto& reply : replies)
    std::move(reply).Run(sealed, base::Value());
}

void ShellHostView::OnWidgetDestroying(views::Widget*) {
  close_observation_.Reset();
  pane_focus_observation_.Reset();
}

void BroadcastWindowEvent(const base::DictValue& event) {
  for (const auto& [id, host] : Hosts()) {
    if (!host->is_utility()) host->Event("ArdiaShell", "onWindowEvent", base::Value(event.Clone()));
  }
}

ShellHostView* DevToolsLinkWindow(content::BrowserContext* profile, content::WebContents* holding) {
  ShellHostView* chosen = nullptr;
  for (const auto& [id, host] : Hosts()) {
    if (!host->ShowsDevToolsLinks(profile)) continue;
    if (holding && host->StripHolds(holding)) return host;
    if (!chosen || host->activation() > chosen->activation()) chosen = host;
  }
  return chosen;
}

void ReturnUnrequestedActivation(int window) {
  const auto keep = WindowFocus().Unrequested(window, FocusClockMs());
  if (!keep) return;
  const auto found = Hosts().find(*keep);
  if (found != Hosts().end()) ActivateNativeWindow(found->second->browser(), WindowFocus().HandBack(*keep));
}

void ShellHostView::FocusShellOnActivation() {
  views::Widget* widget = GetWidget();
  views::FocusManager* focus = GetFocusManager();
  if (!widget || !focus || !shell_ || !browser_view_ || wm::GetModalTransient(widget->GetNativeWindow())) return;
  const views::View* focused = focus->GetFocusedView();
  if (focused && (Contains(focused) || !browser_view_->Contains(focused))) return;
  FocusShell();
}

void ShellHostView::OnDidPresentCompositorFrame(ui::Compositor*, uint32_t, const gfx::PresentationFeedback&) {
  WindowFocus().Presented(id_, FocusClockMs());
  presentation_observation_.Reset();
  presented_ = true;
  RestoreFullScreenNow();
}

void ShellHostView::OnWidgetActivationChanged(views::Widget*, bool active) {
  if (active) activation_ = ++ActivationClock();
  if (active) FocusShellOnActivation();
  const bool changed = WindowFocus().Observe(id_, active);
  if (active) ReturnUnrequestedActivation(id_);
  if (!changed || is_utility() || window_id_.empty()) return;
  BroadcastWindowEvent(base::DictValue().Set("type", "focus").Set("id", window_id_));
}

void ShellHostView::OnWidgetBoundsChanged(views::Widget*, const gfx::Rect&) {
  if (is_utility()) return;
  frame_timer_.Start(FROM_HERE, base::Milliseconds(250),
                     base::BindOnce(&ShellHostView::ReportWindowGeometry, base::Unretained(this)));
}

void FinishFullScreenRestore() {
  const auto focus = FullScreenRestorer().Finish();
  if (FullScreenRestorer().active()) return;
  FullScreenRestoreTimer().Stop();
  if (!focus || WindowFocus().active() == 0 || WindowFocus().epoch() != FullScreenRestoreEpoch()) return;
  for (const auto& [id, host] : Hosts()) {
    if (!host->is_utility() && host->window_id() == *focus) {
      ActivateNativeWindow(host->browser(), WindowFocus().HandBack(host->id()));
      return;
    }
  }
}

void ExpireFullScreenRestore() {
  for (const std::string& id : FullScreenRestorer().Expire()) {
    bool fullscreen = false;
    for (const auto& [native, host] : Hosts()) {
      if (host->window_id() == id && host->WindowFullScreen()) fullscreen = true;
    }
    if (!fullscreen) BroadcastWindowEvent(base::DictValue().Set("type", "fullScreen").Set("id", id).Set("on", false));
  }
  FinishFullScreenRestore();
}

void ShellHostView::RestoreFullScreenNow() {
  views::Widget* widget = GetWidget();
  if (is_utility() || window_id_.empty() || !browser_ || !widget || !widget->IsVisible() || !presented_ ||
      widget->IsMinimized() || !FullScreenRestorer().Wants(window_id_)) return;
  auto* manager = ExclusiveAccessManager::From(browser());
  if (!manager) return;
  FullscreenController* fullscreen = manager->fullscreen_controller();
  if (FullScreenRestorer().Enter(window_id_, fullscreen->IsFullscreenForBrowser())) {
    if (const auto output = SavedWindowOutput()) {
      output_target_ = output->second;
      widget->SetFullscreen(true, output->first);
    } else {
      fullscreen->ToggleBrowserFullscreenMode(false);
    }
  }
  FinishFullScreenRestore();
}

void ShellHostView::OnWidgetVisibilityChanged(views::Widget*, bool visible) {
  if (visible) RestoreFullScreenNow();
}

void ShellHostView::OnWidgetShowStateChanged(views::Widget* widget) {
  ReportWindowGeometry();
  if (widget && WindowFullScreen() && !window_id_.empty()) {
    FullScreenRestorer().Entered(window_id_);
    FinishFullScreenRestore();
  }
}

bool ShellHostView::WindowFullScreen() const {
  const views::Widget* widget = GetWidget();
  if (!widget || !browser_) return false;
  ExclusiveAccessManager* access = ExclusiveAccessManager::From(browser());
  const FullscreenController* controller = access ? access->fullscreen_controller() : nullptr;
  return ardiacore::LinuxWindowFullScreen(
      widget->IsFullscreen(), controller && controller->IsWindowFullscreenForTabOrPending(),
      controller && controller->IsFullscreenCausedByTab());
}

void ShellHostView::ReportWindowGeometry() {
  views::Widget* widget = GetWidget();
  if (is_utility() || window_id_.empty() || !widget || !browser_) return;
  const bool fullscreen = widget->IsFullscreen();
  if (const auto on = geometry_.FullScreen(WindowFullScreen())) {
    BroadcastWindowEvent(base::DictValue().Set("type", "fullScreen").Set("id", window_id_).Set("on", *on));
  }
  if (const auto frame = geometry_.Frame(LifecycleRect(widget->GetWindowBoundsInScreen()), PrimaryScreenRect(),
                                         fullscreen, widget->IsMinimized())) {
    base::ListValue values;
    for (const int value : *frame) values.Append(value);
    BroadcastWindowEvent(base::DictValue().Set("type", "frame").Set("id", window_id_).Set("frame", std::move(values)));
  }
  RememberWindowOutput();
}

PrefService* ShellHostView::WindowOutputPrefs() const {
  Profile* app = profile();
  if (GlobalScreenCoordinates() || is_utility() || window_id_.empty() || private_window() || !app) return nullptr;
  return app->GetPrefs();
}

void ShellHostView::RememberWindowOutput() {
  PrefService* prefs = WindowOutputPrefs();
  if (!prefs || !browser_ || output_forgotten_) return output_watch_.Stop();
  if (!WindowFullScreen()) {
    output_watch_.Stop();
    output_target_.reset();
    return;
  }
  if (!output_watch_.IsRunning()) {
    output_watch_.Start(FROM_HERE, base::Seconds(1),
                        base::BindRepeating(&ShellHostView::RememberWindowOutput, base::Unretained(this)));
  }
  const std::string label =
      display::Screen::Get()->GetDisplayNearestWindow(browser_->GetWindow()->GetNativeWindow()).label();
  if (output_target_) {
    if (label != *output_target_) return;
    output_target_.reset();
  }
  const base::DictValue* saved = chrome::GetWindowPlacementDictionaryReadOnly(kWindowOutputs, prefs);
  const std::string* known = saved ? saved->FindString(window_id_) : nullptr;
  if (label.empty() || (known && *known == label)) return;
  std::unique_ptr<ScopedDictPrefUpdate> update;
  chrome::GetWindowPlacementDictionaryReadWrite(kWindowOutputs, prefs, update).Set(window_id_, label);
}

void ShellHostView::ForgetWindowOutput() {
  output_forgotten_ = true;
  PrefService* prefs = WindowOutputPrefs();
  const base::DictValue* saved = prefs ? chrome::GetWindowPlacementDictionaryReadOnly(kWindowOutputs, prefs) : nullptr;
  if (!saved || !saved->FindString(window_id_)) return;
  std::unique_ptr<ScopedDictPrefUpdate> update;
  chrome::GetWindowPlacementDictionaryReadWrite(kWindowOutputs, prefs, update).Remove(window_id_);
}

std::optional<std::pair<int64_t, std::string>> ShellHostView::SavedWindowOutput() const {
  PrefService* prefs = WindowOutputPrefs();
  const base::DictValue* saved = prefs ? chrome::GetWindowPlacementDictionaryReadOnly(kWindowOutputs, prefs) : nullptr;
  const std::string* label = saved ? saved->FindString(window_id_) : nullptr;
  if (!label) return std::nullopt;
  std::vector<linux_window::Output> outputs;
  for (const display::Display& display : display::Screen::Get()->GetAllDisplays()) {
    outputs.push_back({display.id(), display.label()});
  }
  const auto id = linux_window::OutputLabelled(outputs, *label);
  if (!id) return std::nullopt;
  return std::make_pair(*id, *label);
}

std::vector<base::DictValue> ShellHostView::WindowState() const {
  std::vector<base::DictValue> state;
  const views::Widget* widget = GetWidget();
  if (is_utility() || window_id_.empty() || !widget || !browser_) return state;
  const bool fullscreen = widget->IsFullscreen();
  if (GlobalScreenCoordinates() && !fullscreen && !widget->IsMinimized()) {
    state.push_back(base::DictValue().Set("type", "frame").Set("id", window_id_)
        .Set("frame", SharedFrameValue(widget->GetWindowBoundsInScreen())));
  }
  if (WindowFullScreen()) state.push_back(base::DictValue().Set("type", "fullScreen").Set("id", window_id_).Set("on", true));
  if (WindowFocus().active() == id_) state.push_back(base::DictValue().Set("type", "focus").Set("id", window_id_));
  return state;
}

void ShellHostView::SeedWindowActivation() {
  views::Widget* widget = GetWidget();
  if (widget && widget->IsActive()) OnWidgetActivationChanged(widget, true);
}

void ShellHostView::RendererReady() {
  ActivateNativeWindow(browser_, WindowFocus().Ready(id_));
  if (is_utility()) return;
  RestoreFullScreenNow();
  const auto focus = [](const base::DictValue& event) { return *event.FindString("type") == "focus"; };
  const std::vector<base::DictValue> own = WindowState();
  for (const auto& event : own) {
    if (!focus(event)) BroadcastWindowEvent(event);
  }
  std::vector<base::DictValue> replay;
  for (const auto& [id, host] : Hosts()) {
    if (host == this) continue;
    for (auto& event : host->WindowState()) replay.push_back(std::move(event));
  }
  for (const bool focused : {false, true}) {
    for (const auto& event : replay) {
      if (focus(event) == focused) Event("ArdiaShell", "onWindowEvent", base::Value(event.Clone()));
    }
  }
  for (const auto& event : own) {
    if (focus(event)) BroadcastWindowEvent(event);
  }
}

bool ShellHostView::AcceleratorPressed(const ui::Accelerator& accelerator) {
  const auto found = shortcuts_.find(accelerator);
  if (found == shortcuts_.end()) return false;
  const base::DictValue& binding = found->second;
  const std::string command = String(binding, "command");
  if (switcher_capture_) {
    std::string key;
    if (accelerator.key_code() == ui::VKEY_ESCAPE) key = "escape";
    if (accelerator.key_code() == ui::VKEY_RIGHT) key = "next";
    if (accelerator.key_code() == ui::VKEY_LEFT) key = "previous";
    if (!key.empty()) {
      Event("ArdiaShell", "onAppEvent", base::Value(base::DictValue()
          .Set("type", "switcherKey").Set("key", key)));
      return true;
    }
    if (command != "tabSwitcher") return true;
  }
  if (binding.FindBool("suppressed").value_or(false)) return true;
  if (command == "tabSwitcher" && !switcher_capture_) {
    switcher_source_.reset();
    for (const auto& [id, tab] : bindings_) {
      if (tab->viewport() && tab->viewport()->HasFocus() && tab->contents()) {
        switcher_source_ = tab->contents()->GetWeakPtr();
        break;
      }
    }
  }
  if (binding.FindBool("notInText").value_or(false)) {
    ui::InputMethod* input = GetWidget()->GetInputMethod();
    ui::TextInputClient* client = input ? input->GetTextInputClient() : nullptr;
    if (client && client->GetTextInputType() != ui::TEXT_INPUT_TYPE_NONE) return false;
  }
  if (is_utility() && command == "closeTab") {
    RequestUtilityClose();
    return true;
  }
  if (CommandFocusesShell(command)) FocusShell();
  const base::Value* arg = binding.Find("arg");
  Event("ArdiaShell", "onCommand", base::Value(base::DictValue()
      .Set("command", command).Set("arg", arg ? arg->Clone() : base::Value())
      .Set("shortcutModifiers", accelerator.modifiers()).Set("windowId", window_id_)));
  return true;
}

TabBinding* ShellHostView::Binding(int id) {
  const auto found = bindings_.find(id);
  return found == bindings_.end() ? nullptr : found->second.get();
}

TabBinding* ShellHostView::ClaimedBinding(const base::DictValue& args) {
  const int id = args.FindInt("id").value_or(0);
  auto* binding = Binding(id);
  for (auto& [current, candidate] : bindings_) {
    if (binding || id <= 0) break;
    if (std::ranges::find(candidate->replaced_ids, id) != candidate->replaced_ids.end()) binding = candidate.get();
  }
  return handler_ && binding && binding->contents() && binding->renderer_generation == renderer_generation_ && ardiacore::linux_contract::OwnsClaim(binding->claim, String(args, "claim")) ? binding : nullptr;
}

bool ShellHostView::CloseTab(TabBinding* binding) {
  if (!browser_ || !binding || !binding->contents()) return false;
  const int index = browser_->GetTabStripModel()->GetIndexOfWebContents(binding->contents());
  if (index < 0) return false;
  app_operation_ = true;
  browser_->GetTabStripModel()->CloseWebContentsAt(
      index, TabCloseTypes::CLOSE_USER_GESTURE | TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  app_operation_ = false;
  QueueTransaction(-1);
  return true;
}

bool ShellHostView::DisposeTemporary(TabBinding* binding) {
  if (!binding || !binding->temporary || !binding->contents() || !browser_) return false;
  auto* model = browser_->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(binding->contents());
  if (index < 0) return false;
  auto weak = GetWeakPtr();
  app_operation_ = true;
  model->DetachAndDeleteWebContentsAt(index);
  if (weak) {
    weak->app_operation_ = false;
    weak->QueueTransaction(-1);
  }
  return true;
}

TabBinding* ShellHostView::BindingForKey(std::string_view key) {
  for (auto& [id, binding] : bindings_) {
    if (binding->key() == key && binding->contents()) return binding.get();
  }
  return nullptr;
}

void ShellHostView::Event(std::string_view module, std::string_view event,
                          base::Value payload) {
  if (handler_) handler_->SendEvent(module, event, payload);
}

void ShellHostView::ReportPictureInPicture(content::WebContents* contents,
                                           base::DictValue state) {
  std::vector<base::WeakPtr<TabBinding>> owners;
  for (auto& [id, binding] : bindings_) {
    if (contents && binding->contents() == contents) owners.push_back(binding->GetWeakPtr());
  }
  const bool active = state.FindBool("active").value_or(false);
  const std::string* kind = state.FindString("kind");
  for (const auto& binding : owners) {
    if (!binding) continue;
    if (binding->media) binding->media->NotePictureInPicture(active, kind ? *kind : "video");
    else binding->ReportPresentation("pictureInPicture", state.Clone());
  }
}

void ShellHostView::NoteInputActivity() {
  if (is_utility() || !handler_) return;
  Event("ArdiaEngine", "engine", base::Value(base::DictValue()
      .Set("name", "engine.inputActivity").Set("data", base::DictValue())));
}

void ShellHostView::WatchSystemState() {
  if (system_state_subscription_) return;
  system_state_subscription_ = ardiacore::LinuxPowerMonitor::Get().Subscribe(base::BindRepeating(
      [](base::WeakPtr<ShellHostView> host, const base::DictValue& state) {
        if (host) host->Event("ArdiaEngine", "engine", base::Value(base::DictValue()
            .Set("name", "engine.systemState").Set("data", state.Clone())));
      }, GetWeakPtr()));
}

void ShellHostView::WatchCalendar() {
  if (calendar_subscription_) return;
  calendar_subscription_ = WatchLinuxCalendar(base::BindRepeating(
      [](base::WeakPtr<ShellHostView> host, const base::DictValue& change) {
        if (host) host->Event("ArdiaCalendar", "onCalendarChanged", base::Value(change.Clone()));
      }, GetWeakPtr()));
}

std::unique_ptr<ardiacore::LinuxPageState> ShellHostView::MountPage(TabBinding* binding) {
  auto* contents = binding ? binding->contents() : nullptr;
  if (!browser_ || !handler_ || !contents || !GetWidget() || binding->claim.empty() ||
      !renderer_generation_ || binding->renderer_generation != renderer_generation_) return nullptr;
  ardiacore::LinuxPageIdentity identity{TabId(contents), binding->key(), binding->claim,
      renderer_generation_, NextPageBindingGeneration(), binding->contents_generation(),
      static_cast<uint64_t>(id_)};
  const void* handler = handler_.get();
  auto sink = base::BindRepeating(
      [](base::WeakPtr<ShellHostView> host, const void* handler, uint64_t generation,
         std::string module, std::string id, base::DictValue payload) {
        if (!host || !host->handler_ || host->handler_.get() != handler ||
            !host->OwnsHandler(host->handler_, generation)) return;
        host->Event(module, id, base::Value(std::move(payload)));
      }, GetWeakPtr(), handler, renderer_generation_);
  auto navigation = base::BindRepeating([](base::WeakPtr<TabBinding> binding) {
    return binding ? binding->Navigation() : base::DictValue();
  }, binding->GetWeakPtr());
  auto page = std::make_unique<ardiacore::LinuxPageState>(
      browser_, GetWidget()->GetWeakPtr(), contents, shell(), std::move(identity),
      std::move(sink), std::move(navigation));
  page->SetSnapshotProducer(base::BindRepeating([](base::WeakPtr<TabBinding> binding) {
    return binding ? binding->SnapshotExtras() : std::vector<std::pair<std::string, base::Value>>();
  }, binding->GetWeakPtr()));
  return page;
}

LinuxExtensionWindow ShellHostView::ExtensionWindow() {
  LinuxExtensionWindow window;
  window.profile = page_profile();
  window.window = id_;
  window.native_window = base::BindRepeating([](base::WeakPtr<ShellHostView> host) {
    return host && host->browser() && host->GetWidget() ? host->GetWidget()->GetNativeWindow() : gfx::NativeWindow();
  }, GetWeakPtr());
  window.tab = base::BindRepeating([](base::WeakPtr<ShellHostView> host, std::string_view key) -> content::WebContents* {
    TabBinding* binding = host ? host->BindingForKey(key) : nullptr;
    return binding ? binding->contents() : nullptr;
  }, GetWeakPtr());
  return window;
}

LinuxExtensionSurfaces* ShellHostView::ExtensionSurfaces() {
  if (!extension_surfaces_ && browser_) {
    extension_surfaces_ = std::make_unique<LinuxExtensionSurfaces>(browser_, this, base::BindRepeating(
        [](base::WeakPtr<ShellHostView> host, int id, base::DictValue event) {
          if (host) host->Event("ArdiaExtensionView", base::NumberToString(id), base::Value(std::move(event)));
        }, GetWeakPtr()));
  }
  return extension_surfaces_.get();
}

bool ShellHostView::ExtensionEvent(std::string_view name, base::DictValue data) {
  if (!browser_ || !handler_) return false;
  Event("ArdiaExtensions", "extensions", base::Value(base::DictValue().Set("name", name).Set("data", std::move(data))));
  return true;
}

std::string ShellHostView::ExtensionTabKey(content::WebContents* contents) const {
  for (const auto& [id, binding] : bindings_) {
    if (contents && binding->contents() == contents) return binding->key();
  }
  return std::string();
}

TabBinding* ShellHostView::PageCommandBinding(const PageCommandAuthority& authority) {
  ShellHostView* host = authority.host.get();
  HostMessageHandler* handler = authority.handler.get();
  content::WebContents* contents = authority.contents.get();
  if (!host || !handler || !contents || host->is_utility() || !host->browser_ ||
      authority.claim.empty() || !authority.generation) return nullptr;
  auto* document = authority.document.AsRenderFrameHostIfValid();
  if (!document || document != host->shell()->GetPrimaryMainFrame() ||
      !host->OwnsHandler(handler, authority.generation) || !handler->Authorized()) return nullptr;
  TabBinding* binding = host->Binding(authority.id);
  if (!binding || binding->contents() != contents || binding->claim != authority.claim ||
      binding->renderer_generation != authority.generation) return nullptr;
  if (host->browser_->GetTabStripModel()->GetIndexOfWebContents(contents) == TabStripModel::kNoTab)
    return nullptr;
  return binding;
}

void ShellHostView::EmitPageCommandEvent(const PageCommandAuthority& authority,
                                         base::DictValue event) {
  TabBinding* binding = PageCommandBinding(authority);
  const std::string* type = event.FindString("type");
  base::DictValue* value = event.FindDict("value");
  if (!binding || !binding->page_command_request || !type || *type != "findResult" || !value) return;
  const ardiacore::LinuxPageRequest request = *binding->page_command_request;
  ardiacore::EmitLinuxPageEvent(request, "find", base::Value(std::move(*value)));
}

ardiacore::LinuxPageCommands* ShellHostView::EnsurePageCommands(TabBinding* binding) {
  if (binding->page_commands) return binding->page_commands.get();
  if (!handler_ || !binding->contents()) return nullptr;
  PageCommandAuthority authority{GetWeakPtr(), handler_->GetWeakPtr(), renderer_document_,
                                 binding->contents()->GetWeakPtr(), TabId(binding->contents()),
                                 binding->claim, binding->renderer_generation};
  if (PageCommandBinding(authority) != binding) return nullptr;
  binding->page_commands = std::make_unique<ardiacore::LinuxPageCommands>(
      binding->contents(), page_profile(),
      base::BindRepeating([](const PageCommandAuthority& authority) -> BrowserWindowInterface* {
        return PageCommandBinding(authority) ? authority.host->browser() : nullptr;
      }, authority),
      base::BindRepeating(&ShellHostView::EmitPageCommandEvent, authority),
      !ardiacore::BackgroundInstance(),
      base::BindRepeating([](const PageCommandAuthority& authority) {
        if (PageCommandBinding(authority)) authority.host->PresentDevTools(authority.contents.get());
      }, authority));
  return binding->page_commands.get();
}

void ShellHostView::PageCommand(TabBinding* binding, const std::string& command,
                                const base::ListValue& values,
                                base::OnceCallback<void(bool, base::Value)> done) {
  ardiacore::LinuxPageCommands* commands = EnsurePageCommands(binding);
  if (!commands) {
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_PAGE_STALE_TARGET").Set("message", "Page claim is no longer current")));
  }
  if (command == "find") {
    auto request = binding->page() ? binding->page()->Capture() : std::nullopt;
    if (!request) {
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_PAGE_STALE_TARGET").Set("message", "The page has no current document")));
    }
    binding->page_command_request = std::move(request);
  }
  auto error = commands->Dispatch(command, values);
  if (error) return std::move(done).Run(false, base::Value(std::move(*error)));
  std::move(done).Run(true, base::Value());
}

void ShellHostView::AdoptDevTools(TabBinding* binding) {
  if (!binding->contents() || !DevToolsWindow::GetInstanceForInspectedWebContents(binding->contents()))
    return;
  if (ardiacore::LinuxPageCommands* commands = EnsurePageCommands(binding)) commands->AdoptDevTools();
}

void ShellHostView::PresentDevTools(content::WebContents* inspected) {
  if (!inspected) return;
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, base::WeakPtr<content::WebContents> contents) {
            if (!host || !contents) return;
            TabBinding* binding = host->Binding(TabId(contents.get()));
            if (binding && binding->contents() == contents.get()) host->LayoutPane(binding);
          }, GetWeakPtr(), inspected->GetWeakPtr()));
}

void ShellHostView::OnDevToolsDockChanged(content::WebContents* inspected, content::WebContents* devtools) {
  if (!inspected) return;
  TabBinding* binding = Binding(TabId(inspected));
  views::WebView* tools = binding && binding->contents() == inspected ? binding->devtools_viewport() : nullptr;
  if (tools && tools->web_contents() && tools->web_contents() != devtools) HideDevToolsViewport(binding);
  PresentDevTools(inspected);
}

void ShellHostView::HideDevToolsViewport(TabBinding* binding) {
  views::WebView* tools = binding->devtools_viewport();
  if (!tools) return;
  const bool visible = binding->pane_visible && binding->contents();
  views::FocusManager* focus = GetFocusManager();
  const bool focused = focus && tools->Contains(focus->GetFocusedView());
  if (tools->GetVisible()) binding->devtools_had_focus = focused && !visible;
  tools->SetVisible(false);
  tools->SetWebContents(nullptr);
  if (focused && visible) binding->FocusFromHost();
}

void ShellHostView::LayoutPane(TabBinding* binding) {
  views::WebView* page = binding->viewport();
  if (!browser_view_) return;
  content::WebContents* contents = binding->contents();
  const bool claimed = contents && handler_ && !binding->claim.empty() &&
                       binding->renderer_generation == renderer_generation_;
  if (!page) {
    DevToolsContentsResizingStrategy waiting_strategy;
    content::WebContents* waiting =
        claimed ? DevToolsWindow::GetInTabWebContents(contents, &waiting_strategy) : nullptr;
    auto* container = waiting ? browser_view_->GetContentsContainerViewFor(contents) : nullptr;
    if (container && container->devtools_web_view()->web_contents() == waiting) {
      container->devtools_web_view()->SetWebContents(nullptr);
      container->devtools_web_view()->SetVisible(false);
    }
    return;
  }
  const bool visible = binding->pane_visible && contents;
  DevToolsContentsResizingStrategy strategy;
  content::WebContents* devtools =
      visible && claimed ? DevToolsWindow::GetInTabWebContents(contents, &strategy) : nullptr;
  const gfx::Rect pane(binding->pane_bounds.size());
  gfx::Rect tools_bounds;
  gfx::Rect page_bounds = pane;
  if (devtools) ApplyDevToolsContentsResizingStrategy(strategy, pane, &tools_bounds, &page_bounds);
  const auto clip = [](const std::vector<gfx::Rect>& shape, const gfx::Rect& area) {
    std::vector<gfx::Rect> clipped;
    for (gfx::Rect part : shape) {
      part.Intersect(area);
      part.Offset(-area.x(), -area.y());
      if (!part.IsEmpty()) clipped.push_back(part);
    }
    return clipped;
  };
  const gfx::Vector2d origin = binding->pane_bounds.OffsetFromOrigin();
  page->SetBoundsRect(page_bounds + origin);
  static_cast<ViewportView*>(page)->SetShape(clip(binding->pane_shape, page_bounds),
                                             clip(binding->pane_input_shape, page_bounds));
  page->SetVisible(visible);
  if (visible) {
    browser_view_->GetActiveContentsWebView()->SetWebContents(nullptr);
    page->SetWebContents(contents);
    page->holder()->SetNativeViewCornerRadii(gfx::RoundedCornersF(12.0f));
  } else {
    page->SetWebContents(nullptr);
  }
  views::WebView* tools = binding->devtools_viewport();
  if (!devtools) return HideDevToolsViewport(binding);
  if (auto* container = browser_view_->GetContentsContainerViewFor(contents)) {
    if (container->devtools_web_view()->web_contents() == devtools) {
      container->devtools_web_view()->SetWebContents(nullptr);
      container->devtools_web_view()->SetVisible(false);
    }
  }
  if (!tools) {
    tools = AddChildView(std::make_unique<ViewportView>(page_profile()));
    binding->SetDevToolsViewport(tools);
  }
  const bool fresh = !binding->devtools_watch || binding->devtools_watch->web_contents() != devtools;
  const bool restore_focus = !fresh && !tools->GetVisible() && binding->devtools_had_focus;
  binding->devtools_had_focus = false;
  if (fresh) {
    binding->devtools_watch = std::make_unique<DevToolsFrontendWatch>(devtools, base::BindOnce(
        [](base::WeakPtr<content::WebContents> inspected) {
          if (!inspected) return;
          for (const auto& [id, host] : Hosts()) host->PresentDevTools(inspected.get());
        }, contents->GetWeakPtr()));
  }
  tools->SetBoundsRect(tools_bounds + origin);
  static_cast<ViewportView*>(tools)->SetShape(clip(binding->pane_shape, tools_bounds),
                                              clip(binding->pane_input_shape, tools_bounds));
  tools->SetVisible(true);
  tools->SetWebContents(devtools);
  if (auto* native = devtools->GetNativeView(); native && !native->IsVisible()) native->Show();
  tools->holder()->SetNativeViewCornerRadii(gfx::RoundedCornersF(12.0f));
  const size_t page_index = GetIndexOf(page).value();
  const size_t tools_index = GetIndexOf(tools).value();
  if (strategy.hide_inspected_contents() ? tools_index < page_index : tools_index > page_index)
    ReorderChildView(tools, page_index);
  if ((fresh && DevToolsWindow::AsDevToolsWindow(devtools)) || restore_focus) {
    tools->RequestFocus();
    devtools->Focus();
  }
}

void ShellHostView::KeepPaneFocus(TabBinding* activating) {
  for (const auto& [id, binding] : bindings_) {
    auto* helper = binding->contents()
        ? ChromeWebContentsViewFocusHelper::FromWebContents(binding->contents()) : nullptr;
    views::View* stored = helper ? helper->GetStoredFocus() : nullptr;
    if (!stored || stored == binding->viewport() || stored == binding->devtools_viewport()) continue;
    for (const auto& [other_id, other] : bindings_) {
      if (stored == other->viewport() || stored == other->devtools_viewport()) {
        const auto tools = devtools_had_focus_.find(id);
        const bool keep_tools = tools != devtools_had_focus_.end() && tools->second && binding->devtools_viewport();
        helper->SetStoredFocusView(keep_tools ? binding->devtools_viewport() : binding->viewport());
        break;
      }
    }
  }
  views::FocusManager* focus = GetFocusManager();
  views::View* focused = focus ? focus->GetFocusedView() : nullptr;
  if (!activating || !activating->contents() || !focused ||
      (focused != activating->viewport() && focused != activating->devtools_viewport())) return;
  if (auto* helper = ChromeWebContentsViewFocusHelper::FromWebContents(activating->contents())) {
    helper->SetStoredFocusView(focused);
  }
}

void ShellHostView::OnDidChangeFocus(views::View*, views::View* now) {
  if (!now) return;
  for (const auto& [id, binding] : bindings_) {
    if (now == binding->viewport() || now == binding->devtools_viewport()) {
      devtools_had_focus_[id] = now == binding->devtools_viewport();
      return;
    }
  }
}

base::DictValue ShellHostView::Strip() const {
  base::ListValue tabs;
  if (browser_) {
    TabStripModel* model = browser_->GetTabStripModel();
    for (int index = 0; index < model->count(); ++index) {
      content::WebContents* contents = model->GetWebContentsAt(index);
      const int id = TabId(contents);
      const auto found = bindings_.find(id);
      base::DictValue tab = base::DictValue().Set("key", found != bindings_.end()
                         ? base::Value(found->second->key()) : base::Value())
          .Set("browser", id)
          .Set("index", index)
          .Set("active", contents == model->GetActiveWebContents())
          .Set("pinned", model->IsTabPinned(index));
      tabs.Append(std::move(tab));
    }
  }
  return base::DictValue()
      .Set("strip", id_)
      .Set("window", id_)
      .Set("appWindow", window_id_)
      .Set("profile", page_profile_)
      .Set("tabs", std::move(tabs));
}

base::DictValue ShellHostView::Transaction(std::optional<int> command,
                                          bool advance) {
  base::ListValue strips;
  for (const auto& [id, host] : Hosts()) {
    if (!host->is_utility()) strips.Append(host->Strip());
  }
  if (advance) ++Revision();
  return base::DictValue()
      .Set("rev", Revision())
      .Set("cmd", command ? base::Value(*command) : base::Value())
      .Set("strips", std::move(strips));
}

void ShellHostView::QueueTransaction(std::optional<int> command) {
  if (app_operation_) return;
  base::DictValue transaction = Transaction(command, true);
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, base::DictValue transaction) {
            if (!host) return;
            for (const auto& [id, target] : Hosts()) {
              target->Event("ArdiaTabs", "tabs", base::Value(base::DictValue()
                  .Set("name", "tabs.strips").Set("data", transaction.Clone())));
            }
          },
          GetWeakPtr(), std::move(transaction)));
}

bool ShellHostView::ReceivesPrivateDownload(const base::DictValue& download) {
  Profile* page = page_profile();
  const std::string* id = download.FindString("id");
  return page && page->IsOffTheRecord() && !page->ShutdownStarted() && id && LinuxDownloadOwned(page, *id);
}

bool ShellHostView::ReceivesRemoval(bool private_removal, const std::string& profile_path) {
  Profile* page = page_profile();
  return linux_downloads::DeliversRemoval(private_removal, page && page->IsOffTheRecord(),
                                          page ? page->GetOriginalProfile()->GetPath().value() : std::string(),
                                          profile_path);
}

void ShellHostView::EngineEvent(std::string_view topic,
                                const base::DictValue& payload) {
  if (!profile()) return;
  base::DictValue translated = payload.Clone();
  const bool private_removal = topic == "downloads.removed" && translated.FindBool("offTheRecord").value_or(false);
  if (private_removal) translated.Remove("offTheRecord");
  if (translated.FindBool("offTheRecord").value_or(false)) return;
  if (!translated.FindString("profile")) return;
  if (!ReceivesRemoval(private_removal, String(translated, "profile"))) return;
  const auto engine_profile = ardiacore::LinuxProfileNameForPath(String(translated, "profile"));
  if (!engine_profile) return;
  translated.Set("profile", *engine_profile);
  if (topic == "downloads.changed") {
    const auto* download = translated.FindDict("download");
    if (!download) return;
    if (download->FindBool("offTheRecord").value_or(false) && !ReceivesPrivateDownload(*download)) return;
    translated = download->Clone();
    translated.Set("profile", *engine_profile);
  }
  const auto name = ardiacore::linux_contract::EventName(topic);
  if (name.empty()) return;
  for (const auto field : {"tabId", "browserId"}) {
    if (const auto* key = translated.FindString(field)) {
      if (!BindingForKey(*key)) return;
    }
    if (const auto id = translated.FindInt(field)) {
      auto* binding = Binding(*id);
      if (!binding || !binding->contents()) return;
      translated.Set("tabId", binding->key());
      if (std::string_view(field) != "tabId") translated.Remove(field);
    }
  }
  const std::string domain(name.substr(0, name.find('.')));
  std::string module = "Ardia" + domain;
  module[5] = base::ToUpperASCII(module[5]);
  Event(module, domain, base::Value(base::DictValue().Set("name", name).Set("data", std::move(translated))));
}

void ShellHostView::ReattachViewports() {
  if (!browser_view_) return;
  views::WebView* chrome_view = browser_view_->GetActiveContentsWebView();
  content::WebContents* taken = chrome_view->web_contents();
  chrome_view->SetWebContents(nullptr);
  chrome_view->SetVisible(false);
  views::FocusManager* focus = GetFocusManager();
  for (auto& [id, binding] : bindings_) {
    views::WebView* page = binding->viewport();
    content::WebContents* contents = binding->contents();
    if (!page || !page->GetVisible() || !contents) continue;
    if (contents == taken || page->web_contents() != contents) {
      const bool focused = focus && focus->GetFocusedView() == page;
      if (focused) focus->ClearFocus();
      page->SetWebContents(nullptr);
      page->SetWebContents(contents);
      if (focused) binding->FocusFromHost();
    }
    if (binding->devtools_viewport()) LayoutPane(binding.get());
  }
}

void ShellHostView::ReplaceTabContents(content::WebContents* old_contents,
                                       content::WebContents* contents) {
  TabBinding* binding = nullptr;
  int old_id = 0;
  for (auto& [id, candidate] : bindings_) {
    if (!old_contents || candidate->contents() != old_contents) continue;
    binding = candidate.get();
    old_id = id;
    break;
  }
  const int id = contents ? TabId(contents) : 0;
  if (!binding || id <= 0 || (id != old_id && bindings_.contains(id))) return;
  auto previous = binding->TakePage();
  binding->Rebind(contents);
  if (id != old_id) {
    auto owned = std::move(bindings_[old_id]);
    bindings_.erase(old_id);
    devtools_had_focus_.erase(old_id);
    owned->replaced_ids.push_back(old_id);
    if (owned->replaced_ids.size() > 4) owned->replaced_ids.erase(owned->replaced_ids.begin());
    bindings_[id] = std::move(owned);
  }
  if (!previous) return;
  binding->AttachPage(MountPage(binding));
  auto created = binding->page() ? binding->page()->CreationState() : std::nullopt;
  if (!created) {
    binding->RetirePage();
    binding->claim.clear();
    previous->EmitClosed();
    previous->Retire();
    return;
  }
  created->Set("browserId", id);
  created->Set("chromeTabId", id);
  created->Set("state", binding->Navigation());
  previous->EmitRebind(std::move(*created));
  previous->Retire();
}

void ShellHostView::OnTabStripModelChanged(
    TabStripModel*, const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (!browser_) return;
  if (selection.active_tab_changed()) KeepPaneFocus(nullptr);
  if (change.type() == TabStripModelChange::kReplaced) {
    const auto* replace = change.GetReplace();
    auto weak = GetWeakPtr();
    ReplaceTabContents(replace->old_contents, replace->new_contents);
    if (!weak) return;
  }
  TabStripModel* model = browser_->GetTabStripModel();
  for (auto& [id, binding] : bindings_) {
    if (binding->page_commands && (!binding->contents() ||
        model->GetIndexOfWebContents(binding->contents()) == TabStripModel::kNoTab)) {
      binding->ResetPageCommands();
      LayoutPane(binding.get());
    }
  }
  for (int index = 0; index < model->count(); ++index) {
    content::WebContents* contents = model->GetWebContentsAt(index);
    TabBinding* binding = Binding(TabId(contents));
    if (!binding || binding->contents() == contents) continue;
    if (!binding->contents()) {
      binding->Rebind(contents);
      continue;
    }
    auto weak = GetWeakPtr();
    ReplaceTabContents(binding->contents(), contents);
    if (!weak) return;
  }
  ReattachViewports();
  QueueTransaction(std::nullopt);
}

void ShellHostView::ClaimLaunchTab(
    const base::ListValue& values,
    base::OnceCallback<void(bool, base::Value)> done) {
  if (values.size() != 3 || !values[0].is_string() || !values[1].is_string() || !values[2].is_string()) {
    return std::move(done).Run(false, base::Value("A launch key, URL and profile are required"));
  }
  const auto tab = launch_decision_.Consume(values[0].GetString(), values[1].GetString(), values[2].GetString());
  if (!tab || !HostsProfile(values[2].GetString())) return std::move(done).Run(false, base::Value("No matching unconsumed native launch offer"));
  if (*tab == 0) return std::move(done).Run(true, base::Value());
  const bool adopted = AdoptLaunchOffer(*tab, values[0].GetString(), values[1].GetString());
  std::move(done).Run(adopted, adopted ? base::Value() : base::Value("The native launch offer is no longer available"));
}

bool ShellHostView::AdoptLaunchOffer(int tab, std::string_view key, std::string_view url) {
  if (!browser_ || BindingForKey(key) || Binding(tab)) return false;
  auto* model = browser_->GetTabStripModel();
  for (int index = 0; index < model->count(); ++index) {
    auto* contents = model->GetWebContentsAt(index);
    if (TabId(contents) != tab) continue;
    if (contents->GetBrowserContext() != page_profile() || contents->GetVisibleURL() != GURL(url)) return false;
    bindings_[tab] = std::make_unique<TabBinding>(this, contents, std::string(key));
    bindings_[tab]->renderer_generation = renderer_generation_;
    QueueTransaction(-1);
    return true;
  }
  return false;
}

void ShellHostView::CreateTab(
    const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  const std::string key = String(args, "key");
  const std::string claim = String(args, "claim");
  if (claim.empty() || claim.size() > 256) return std::move(done).Run(false, base::Value("A bounded tab claim is required"));
  if (!browser_ || key.empty() || key.size() > 256 || !args.FindString("profile")) {
    return std::move(done).Run(false, base::Value("A key and a profile are required"));
  }
  if (!HostsProfile(String(args, "profile"))) {
    const auto name = ardiacore::linux_profiles::ParseProfileName(String(args, "profile"));
    const auto error = !name ? ardiacore::linux_profiles::ProfileError::kInvalid
                             : ardiacore::linux_profiles::ProfileError::kWindowMismatch;
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", ardiacore::linux_profiles::ProfileErrorCode(error))
        .Set("message", ardiacore::linux_profiles::ProfileErrorMessage(error))));
  }
  TabStripModel* model = browser_->GetTabStripModel();
  std::string text = String(args, "url");
  if (text.starts_with("ardia://")) text.replace(0, 8, "chrome://");
  const GURL url(text.empty() ? "about:blank" : text);
  if (!url.is_valid() || url.SchemeIs("javascript") ||
      (url.SchemeIs("chrome") && url.host() == "ardia")) {
    return std::move(done).Run(false, base::Value("Invalid or reserved tab URL"));
  }
  TabBinding* binding = BindingForKey(key);
  if (binding && !ardiacore::linux_contract::CanReclaim(binding->claim, String(args, "previousClaim"))) {
    return std::move(done).Run(false, base::Value("This tab already has an active owner"));
  }
  if (!binding) {
    for (const auto& [window, source] : Hosts()) {
      if (source == this) continue;
      TabBinding* existing = source->BindingForKey(key);
      if (!existing || !existing->contents()) continue;
      if (!ardiacore::linux_contract::CanTransfer(existing->transferable, existing->temporary, source->page_profile() == page_profile())) return std::move(done).Run(false, base::Value("This tab has not been offered for transfer"));
      const int id = TabId(existing->contents());
      TabStripModel* source_model = source->browser()->GetTabStripModel();
      const int index = source_model->GetIndexOfWebContents(existing->contents());
      if (index < 0 || source->page_profile() != page_profile()) {
        return std::move(done).Run(false, base::Value("The transfer source is unavailable"));
      }
      source->app_operation_ = true;
      app_operation_ = true;
      auto moved = std::move(source->bindings_[id]);
      source->bindings_.erase(id);
      source->devtools_had_focus_.erase(id);
      moved->MoveTo(this);
      auto contents = source_model->DetachWebContentsAtForInsertion(index);
      model->InsertWebContentsAt(model->count(), std::move(contents), AddTabTypes::ADD_NONE);
      bindings_[id] = std::move(moved);
      binding = bindings_[id].get();
      source->app_operation_ = false;
      app_operation_ = false;
      break;
    }
  }
  if (!binding) {
    content::WebContents* contents = nullptr;
    BrowserWindowInterface* source_browser = browser_;
    const std::string adopt = String(args, "adoptId");
    bool navigate_initial = false;
    if (!adopt.empty()) {
      int wanted = 0;
      const size_t colon = adopt.find(':');
      if (colon == std::string::npos ||
          (adopt.substr(0, colon) != "tab" && adopt.substr(0, colon) != "ardiacore") ||
          !base::StringToInt(adopt.substr(colon + 1), &wanted)) {
        return std::move(done).Run(false, base::Value("Invalid tab adoption id"));
      }
      bool offered = false;
      for (auto& [window, source] : Hosts()) {
        const auto offer = source->offered_.find(wanted);
        if (source->page_profile() == page_profile() && offer != source->offered_.end() && offer->second &&
            offer->second->GetBrowserContext() == page_profile()) offered = true;
      }
      if (!offered) return std::move(done).Run(false, base::Value("This tab has not been offered for adoption"));
      GlobalBrowserCollection::GetInstance()->ForEach(
          [&](BrowserWindowInterface* candidate) {
            if (candidate->GetProfile() != page_profile()) return true;
            TabStripModel* strip = candidate->GetTabStripModel();
            for (int index = 0; index < strip->count(); ++index) {
              if (TabId(strip->GetWebContentsAt(index)) == wanted) {
                source_browser = candidate;
                contents = strip->GetWebContentsAt(index);
                return false;
              }
            }
            return true;
          });
      if (!contents) {
        return std::move(done).Run(false, base::Value("The offered tab is no longer available"));
      }
      for (const auto& [window, host] : Hosts()) {
        if (host->Binding(wanted) && host->Binding(wanted)->contents()) {
          return std::move(done).Run(false, base::Value("The offered tab is already claimed"));
        }
      }
    } else {
      for (int index = 0; index < model->count(); ++index) {
        content::WebContents* candidate = model->GetWebContentsAt(index);
        if (Binding(TabId(candidate)) && Binding(TabId(candidate))->contents()) continue;
        const GURL& initial = candidate->GetVisibleURL();
        const bool blank = initial.is_empty() || initial == GURL("about:blank") ||
            (initial.SchemeIs("chrome") && (initial.host() == "newtab" || initial.host() == "new-tab-page"));
        if (initial == url || (bindings_.empty() && blank)) {
          contents = candidate;
          navigate_initial = initial != url;
          break;
        }
      }
    }
    app_operation_ = true;
    if (contents && source_browser != browser_) {
      TabStripModel* source = source_browser->GetTabStripModel();
      ShellHostView* source_host = nullptr;
      const auto found = Hosts().find(source_browser->GetSessionID().id());
      if (found != Hosts().end()) {
        source_host = found->second;
        source_host->app_operation_ = true;
      }
      auto moving = source->DetachWebContentsAtForInsertion(source->GetIndexOfWebContents(contents));
      model->InsertWebContentsAt(model->count(), std::move(moving), AddTabTypes::ADD_NONE);
      if (source_host) source_host->app_operation_ = false;
    }
    if (!contents) {
      NavigateParams navigation(browser_, url, ui::PAGE_TRANSITION_TYPED);
      navigation.disposition = WindowOpenDisposition::NEW_BACKGROUND_TAB;
      navigation.window_action = NavigateParams::WindowAction::kNoAction;
      Navigate(&navigation);
      contents = navigation.navigated_or_inserted_contents;
    } else if (navigate_initial) {
      content::NavigationController::LoadURLParams params(url);
      params.transition_type = ui::PAGE_TRANSITION_TYPED;
      contents->GetController().LoadURLWithParams(params);
    }
    if (!contents || TabId(contents) <= 0) {
      app_operation_ = false;
      return std::move(done).Run(false, base::Value("Chrome could not create a tab with a valid id"));
    }
    const int id = TabId(contents);
    bindings_[id] = std::make_unique<TabBinding>(this, contents, key);
    for (auto& [window, source] : Hosts()) source->offered_.erase(id);
    binding = bindings_[id].get();
    app_operation_ = false;
  }
  binding->RetirePage();
  binding->ResetPageCommands();
  binding->temporary = args.FindBool("temporary").value_or(false);
  binding->claim = claim;
  binding->renderer_generation = renderer_generation_;
  binding->transferable = false;
  AdoptDevTools(binding);
  const int id = TabId(binding->contents());
  binding->AttachPage(MountPage(binding));
  auto created = binding->page() ? binding->page()->CreationState() : std::nullopt;
  if (!created) {
    binding->RetirePage();
    binding->claim.clear();
    QueueTransaction(-1);
    return std::move(done).Run(false, base::Value("The tab page state is unavailable"));
  }
  base::DictValue result = base::DictValue()
      .Set("browserId", id).Set("chromeTabId", id).Set("state", binding->Navigation());
  result.Merge(std::move(*created));
  std::move(done).Run(true, base::Value(std::move(result)));
  QueueTransaction(-1);
}

void ShellHostView::TabCommand(
    const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  TabBinding* binding = ClaimedBinding(args);
  const std::string command = String(args, "command");
  if (!browser_ || !binding) {
    if (ardiacore::LinuxPageCommands::Handles(command)) {
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_PAGE_STALE_TARGET").Set("message", "No such live tab")));
    }
    return std::move(done).Run(false, base::Value("No such live tab"));
  }
  const base::ListValue& values = Arguments(args);
  if (ardiacore::LinuxPageCommands::Handles(command)) {
    return PageCommand(binding, command, values, std::move(done));
  }
  content::WebContents* contents = binding->contents();
  auto& controller = contents->GetController();
  if (ardiacore::LinuxPageMedia::Handles(command)) {
    if (!binding->media) return std::move(done).Run(false, base::Value("Media is unavailable for this tab"));
    content::RenderFrameHost* shell_frame = shell() ? shell()->GetPrimaryMainFrame() : nullptr;
    const bool press = command == "requestPictureInPicture" || command == "takeControlPress";
    const bool activation = shell_frame && (press ? shell_frame->ConsumeTransientUserActivation()
                                                  : shell_frame->HasTransientUserActivation());
    return binding->media->Dispatch(command, values, activation, std::move(done));
  }
  if (command == "webStoreRequest") {
    if (!values.empty()) return std::move(done).Run(false, base::Value("webStoreRequest takes no arguments"));
    return ardiacore::LinuxWebStoreRequest(contents, std::move(done));
  }
  if (command == "captureViewport") {
    auto* view = contents->GetRenderWidgetHostView();
    if (!view || !view->IsSurfaceAvailableForCopy()) {
      return std::move(done).Run(true, base::Value());
    }
    view->CopyFromSurface(
        gfx::Rect(), gfx::Size(), base::Milliseconds(250),
        base::BindOnce([](base::OnceCallback<void(bool, base::Value)> reply,
                          const content::CopyFromSurfaceResult& result) {
          const auto png = result.has_value()
              ? gfx::PNGCodec::EncodeBGRASkBitmap(result->bitmap, false)
              : std::nullopt;
          std::move(reply).Run(true, png
              ? base::Value("data:image/png;base64," + base::Base64Encode(*png))
              : base::Value());
        }, std::move(done)));
    return;
  } else if (command == "loadUrl") {
    std::string text = ArgumentString(values, 0);
    if (text.starts_with("ardia://")) text.replace(0, 8, "chrome://");
    const GURL url(text);
    if (!url.is_valid() || url.SchemeIs("javascript") ||
        (url.SchemeIs("chrome") && url.host() == "ardia")) {
      return std::move(done).Run(false, base::Value("Invalid or reserved tab URL"));
    }
    content::NavigationController::LoadURLParams params(url);
    params.transition_type = ui::PAGE_TRANSITION_TYPED;
    controller.LoadURLWithParams(params);
  } else if (command == "goBack") {
    if (controller.CanGoBack()) controller.GoBack();
  } else if (command == "goForward") {
    if (controller.CanGoForward()) controller.GoForward();
  } else if (command == "reload" || command == "forceReload") {
    controller.Reload(command == "forceReload" ? content::ReloadType::BYPASSING_CACHE
                                                : content::ReloadType::NORMAL,
                       true);
  } else if (command == "stopLoading") {
    contents->Stop();
  } else if (command == "focus") {
    binding->FocusFromHost();
  } else if (command == "setMuted") {
    if (values.empty() || !values[0].is_bool()) {
      return std::move(done).Run(false, base::Value("setMuted requires a boolean"));
    }
    contents->SetAudioMuted(values[0].GetBool());
  } else if (command == "zoomStep") {
    if (!binding->page() || !binding->page()->ZoomStep(values)) {
      return std::move(done).Run(false, base::Value("zoomStep requires -1, 0 or 1 on a live page"));
    }
  } else if (command == "goToOffset") {
    if (!binding->page() || !binding->page()->GoToOffset(values)) {
      return std::move(done).Run(false, base::Value("goToOffset requires one integer offset on a live page"));
    }
  } else if (command == "evaluate") {
    if (values.size() != 1 || !values[0].is_string())
      return std::move(done).Run(false, base::Value("evaluate requires one script"));
    auto request = binding->page() ? binding->page()->Capture() : std::nullopt;
    if (!request) return std::move(done).Run(true, base::Value());
    return ardiacore::RunLinuxPageEvaluation(contents->GetPrimaryMainFrame(), values[0].GetString(),
        base::BindOnce([](ardiacore::LinuxPageRequest request, base::OnceCallback<void(bool, base::Value)> done,
                          bool refused, std::optional<std::string> result) {
          if (refused) {
            return std::move(done).Run(false, base::Value(base::DictValue()
                .Set("code", "ERR_PAGE_EVALUATION_REFUSED").Set("message", "Ardia runs only its own page operations")));
          }
          std::move(done).Run(true, result && request.Valid() ? base::Value(std::move(*result)) : base::Value());
        }, std::move(*request), std::move(done)));
  } else if (command == "resolveUnresponsive") {
    auto* status = binding->page() ? binding->page()->status() : nullptr;
    if (!status || !status->ResolveUnresponsive(values)) {
      return std::move(done).Run(false, base::Value("resolveUnresponsive requires one boolean on a live page"));
    }
  } else if (command == "openBlockedPopup") {
    auto* status = binding->page() ? binding->page()->status() : nullptr;
    if (!status) return std::move(done).Run(false, base::Value("No live page document"));
    std::set<content::WebContents*> before;
    TabStripModel* model = browser_->GetTabStripModel();
    for (int index = 0; index < model->count(); ++index) before.insert(model->GetWebContentsAt(index));
    const auto weak = GetWeakPtr();
    const auto opener = binding->GetWeakPtr();
    if (!status->OpenBlockedPopup(values)) {
      return std::move(done).Run(false, base::Value("The blocked pop-up is no longer available"));
    }
    if (!weak || !browser_ || !opener) return std::move(done).Run(true, base::Value());
    model = browser_->GetTabStripModel();
    for (int index = 0; index < model->count(); ++index) {
      content::WebContents* opened = model->GetWebContentsAt(index);
      if (before.contains(opened) || Binding(TabId(opened))) continue;
      opener->ReportOpened(opened, opened->GetVisibleURL(), "foreground");
      if (!weak || !opener) break;
    }
  } else if (command == "downloadFavicon") {
    if (values.empty() || !values[0].is_string()) {
      return std::move(done).Run(false, base::Value("downloadFavicon requires an icon URL"));
    }
    auto request = binding->page() ? binding->page()->Capture() : std::nullopt;
    if (!request) return std::move(done).Run(true, base::Value());
    ardiacore::DownloadLinuxFavicon(
        contents, GURL(values[0].GetString()),
        base::BindRepeating([](ardiacore::LinuxPageRequest request) { return request.Valid(); },
                            *request),
        base::BindOnce([](base::OnceCallback<void(bool, base::Value)> done, base::Value image) {
          std::move(done).Run(true, std::move(image));
        }, std::move(done)));
    return;
  } else if (command == "getSecurityInfo") {
    if (!values.empty()) return std::move(done).Run(false, base::Value("getSecurityInfo takes no arguments"));
    return std::move(done).Run(true, binding->page() ? binding->page()->SecurityInfo() : base::Value());
  } else if (command == "navigationEntries") {
    base::ListValue entries;
    for (int index = 0; index < controller.GetEntryCount(); ++index) {
      const auto* entry = controller.GetEntryAtIndex(index);
      entries.Append(base::DictValue()
                         .Set("url", entry->GetVirtualURL().spec())
                         .Set("title", entry->GetTitle())
                         .Set("current", index == controller.GetCurrentEntryIndex()));
    }
    return std::move(done).Run(true, base::Value(std::move(entries)));
  } else if (command == "discard") {
    const auto request = ardiacore::ParseLinuxDiscardRequest(values);
    if (!request) return std::move(done).Run(false, base::Value("discard takes an optional {unload} object"));
    return std::move(done).Run(true, base::Value(binding->Discard(*request)));
  } else if (command == "setFrozen") {
    const auto frozen = ardiacore::ParseLinuxFrozen(values);
    if (!frozen) return std::move(done).Run(false, base::Value("setFrozen requires a boolean"));
    return std::move(done).Run(true, base::Value(binding->SetFrozen(*frozen)));
  } else if (command == "unsavedInput") {
    if (!values.empty()) return std::move(done).Run(false, base::Value("unsavedInput takes no arguments"));
    const auto unsaved = binding->media ? binding->media->UnsavedInput() : std::nullopt;
    return std::move(done).Run(true, unsaved ? base::Value(*unsaved) : base::Value());
  } else if (command == "editedInput") {
    if (!values.empty()) return std::move(done).Run(false, base::Value("editedInput takes no arguments"));
    const auto edited = binding->media ? binding->media->EditedInput() : std::nullopt;
    return std::move(done).Run(true, edited ? base::Value(*edited) : base::Value());
  } else if (command == "downloadImage") {
    const GURL url(ArgumentString(values, 0));
    const int limit = values.size() == 2 && values[1].is_int() ? values[1].GetInt() : 0;
    if (values.size() != 2 || limit < 1 || limit > 512 || !url.is_valid() ||
        !(url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("data"))) {
      return std::move(done).Run(false, base::Value("downloadImage requires an http(s) or data URL and a pixel limit"));
    }
    contents->DownloadImage(url, false, gfx::Size(limit, limit), static_cast<uint32_t>(limit), false,
        base::BindOnce([](base::OnceCallback<void(bool, base::Value)> reply, int, int,
                          const GURL&, const std::vector<SkBitmap>& bitmaps,
                          const std::vector<gfx::Size>&) {
          for (const SkBitmap& bitmap : bitmaps) {
            if (bitmap.drawsNothing()) continue;
            const auto png = gfx::PNGCodec::EncodeBGRASkBitmap(bitmap, false);
            if (!png) continue;
            return std::move(reply).Run(true, base::Value(base::DictValue()
                .Set("uri", "data:image/png;base64," + base::Base64Encode(*png))
                .Set("width", bitmap.width()).Set("height", bitmap.height())));
          }
          std::move(reply).Run(true, base::Value());
        }, mojo::WrapCallbackWithDefaultInvokeIfNotRun(std::move(done), true, base::Value())));
    return;
  } else if (command == "close") {
    if (!CloseTab(binding)) return std::move(done).Run(false, base::Value("Tab is no longer in this window"));
  } else if (command == "executeExtensionAction") {
    const std::string shown = LinuxExecuteExtensionAction(contents, values);
    if (shown.empty()) return std::move(done).Run(false, base::Value("executeExtensionAction requires an extension id"));
    return std::move(done).Run(true, base::Value(shown));
  } else {
    return std::move(done).Run(false, base::Value("Unsupported tab command: " + command));
  }
  std::move(done).Run(true, base::Value());
}

void ShellHostView::SetViewport(
    const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  TabBinding* binding = ClaimedBinding(args);
  const base::DictValue* rect = args.FindDict("rect");
  if (!binding || !rect) {
    return std::move(done).Run(false, base::Value("A live tab and viewport rectangle are required"));
  }
  const double x = rect->FindDouble("x").value_or(NAN);
  const double y = rect->FindDouble("y").value_or(NAN);
  const double width = rect->FindDouble("width").value_or(NAN);
  const double height = rect->FindDouble("height").value_or(NAN);
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) ||
      !std::isfinite(height) || width < 0 || height < 0) {
    return std::move(done).Run(false, base::Value("Viewport coordinates must be finite and nonnegative in size"));
  }
  const double scale = blink::ZoomLevelToZoomFactor(
      zoom::ZoomController::GetZoomLevelForWebContents(shell()));
  const double left = std::clamp(x * scale, 0.0, static_cast<double>(this->width()));
  const double top = std::clamp(y * scale, 0.0, static_cast<double>(this->height()));
  const double right = std::clamp((x + width) * scale, left, static_cast<double>(this->width()));
  const double bottom = std::clamp((y + height) * scale, top, static_cast<double>(this->height()));
  const gfx::Rect bounds = gfx::ToEnclosingRect(gfx::RectF(left, top, right - left, bottom - top));
  std::vector<gfx::Rect> shape{gfx::Rect(bounds.size())};
  std::vector<gfx::Rect> input_shape = shape;
  const auto subtract = [](std::vector<gfx::Rect>& region, const gfx::Rect& cut) {
    std::vector<gfx::Rect> remaining;
    for (const auto& piece : region) {
      gfx::Rect overlap = piece;
      overlap.Intersect(cut);
      if (overlap.IsEmpty()) {
        remaining.push_back(piece);
        continue;
      }
      for (const auto& part : {
               gfx::Rect(piece.x(), piece.y(), piece.width(), overlap.y() - piece.y()),
               gfx::Rect(piece.x(), overlap.bottom(), piece.width(), piece.bottom() - overlap.bottom()),
               gfx::Rect(piece.x(), overlap.y(), overlap.x() - piece.x(), overlap.height()),
               gfx::Rect(overlap.right(), overlap.y(), piece.right() - overlap.right(), overlap.height())}) {
        if (!part.IsEmpty()) remaining.push_back(part);
      }
    }
    region = std::move(remaining);
  };
  const base::ListValue* occlusions = args.FindList("occlusions");
  if (occlusions && occlusions->size() > 16) {
    return std::move(done).Run(false, base::Value("Too many viewport occlusions"));
  }
  if (occlusions) {
    for (const auto& entry : *occlusions) {
      const auto* occlusion = entry.GetIfDict();
      if (!occlusion) return std::move(done).Run(false, base::Value("Invalid viewport occlusion"));
      const double ox = occlusion->FindDouble("x").value_or(NAN);
      const double oy = occlusion->FindDouble("y").value_or(NAN);
      const double ow = occlusion->FindDouble("width").value_or(NAN);
      const double oh = occlusion->FindDouble("height").value_or(NAN);
      const double outset = occlusion->FindDouble("paintOutset").value_or(0);
      if (!std::isfinite(ox) || !std::isfinite(oy) || !std::isfinite(ow) ||
          !std::isfinite(oh) || !std::isfinite(outset) || ow < 0 || oh < 0 || outset < 0 || outset > 64) {
        return std::move(done).Run(false, base::Value("Invalid viewport occlusion"));
      }
      const double ol = std::clamp(ox * scale, left, right);
      const double ot = std::clamp(oy * scale, top, bottom);
      const double oright = std::clamp((ox + ow) * scale, ol, right);
      const double obottom = std::clamp((oy + oh) * scale, ot, bottom);
      gfx::Rect cut = gfx::ToEnclosingRect(gfx::RectF(ol, ot, oright - ol, obottom - ot));
      cut.Offset(-bounds.x(), -bounds.y());
      if (cut.IsEmpty()) continue;
      subtract(input_shape, cut);
      cut.Outset(static_cast<int>(std::ceil(outset * scale)));
      subtract(shape, cut);
    }
  }
  if (!binding->viewport()) {
    binding->SetViewport(AddChildView(std::make_unique<ViewportView>(page_profile())));
  }
  binding->pane_bounds = bounds;
  binding->pane_shape = std::move(shape);
  binding->pane_input_shape = std::move(input_shape);
  binding->pane_visible = args.FindBool("visible").value_or(false) && !bounds.IsEmpty();
  LayoutPane(binding);
  std::move(done).Run(true, base::Value());
}

void ShellHostView::SetPresentations(
    const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  const base::ListValue* tabs = args.FindList("tabs");
  if (!tabs || tabs->size() > 1024) {
    return std::move(done).Run(false, base::Value("A tab presentation list is required"));
  }
  std::vector<std::pair<TabBinding*, bool>> updates;
  for (const auto& tab : *tabs) {
    const auto* item = tab.GetIfDict();
    TabBinding* binding = item ? ClaimedBinding(*item) : nullptr;
    const auto visible = item ? item->FindBool("visible") : std::nullopt;
    if (!binding || !visible) {
      return std::move(done).Run(false, base::Value("A claimed tab and boolean visibility are required"));
    }
    updates.emplace_back(binding, *visible);
  }
  for (const auto& [binding, visible] : updates) {
    if (visible && !binding->presented) binding->RememberPendingAutoPictureInPicture();
    binding->presentation_attached = true;
    binding->presented = visible;
  }
  std::vector<std::pair<base::WeakPtr<content::WebContents>, bool>> changes;
  std::vector<base::WeakPtr<TabBinding>> revealed;
  for (const bool visible : {true, false}) {
    for (const auto& [id, binding] : bindings_) {
      if (!binding->contents() || binding->presented != visible ||
          binding->presentation_applied == visible) continue;
      binding->presentation_applied = visible;
      binding->presentation_departed = !visible;
      if (!visible) binding->cancelled_auto_pip_until = {};
      if (visible) revealed.push_back(binding->GetWeakPtr());
      changes.emplace_back(binding->contents()->GetWeakPtr(), visible);
    }
  }
  for (const auto& [contents, visible] : changes) {
    if (!contents) continue;
    if (auto* helper = AutoPictureInPictureTabHelper::FromWebContents(contents.get())) {
      helper->OnTabActivatedChanged(visible);
    }
  }
  for (const auto& binding : revealed) {
    if (binding) binding->Reveal();
  }
  std::move(done).Run(true, base::Value());
}

void ShellHostView::StripCommand(
    int command, const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  if (!browser_ || args.FindInt("strip").value_or(0) != id_) {
    return std::move(done).Run(false, base::Value("No such tab strip in this window"));
  }
  TabStripModel* model = browser_->GetTabStripModel();
  const std::string op = String(args, "op");
  bool rejected = false;
  app_operation_ = true;
  if (op == "activate") {
    TabBinding* binding = BindingForKey(String(args, "key"));
    const int index = binding ? model->GetIndexOfWebContents(binding->contents()) : -1;
    if (index < 0) {
      rejected = true;
    } else {
      KeepPaneFocus(binding);
      model->ActivateTabAt(index);
    }
  } else if (op == "arrange") {
    const base::ListValue* keys = args.FindList("keys");
    if (!keys) {
      app_operation_ = false;
      return std::move(done).Run(false, base::Value("arrange requires a list of keys"));
    }
    const int pinned = std::max(0, args.FindInt("pinned").value_or(0));
    std::vector<content::WebContents*> listed;
    std::set<int> seen;
    for (const auto& key : *keys) {
      if (!key.is_string()) continue;
      TabBinding* binding = BindingForKey(key.GetString());
      if (!binding || !binding->contents()) continue;
      const int index = model->GetIndexOfWebContents(binding->contents());
      if (index >= 0 && seen.insert(TabId(binding->contents())).second) {
        listed.push_back(binding->contents());
      }
    }
    rejected = listed.empty() && !keys->empty();
    for (size_t index = 0; index < listed.size(); ++index) {
      const int at = model->GetIndexOfWebContents(listed[index]);
      model->SetTabPinned(at, static_cast<int>(index) < pinned);
    }
    for (size_t index = 0; index < listed.size(); ++index) {
      const int at = model->GetIndexOfWebContents(listed[index]);
      model->MoveWebContentsAt(at, static_cast<int>(index), false);
    }
  } else {
    app_operation_ = false;
    return std::move(done).Run(false, base::Value("Unsupported tab strip operation: " + op));
  }
  app_operation_ = false;
  base::DictValue transaction = Transaction(command, true);
  if (rejected) transaction.Set("rejected", true);
  std::move(done).Run(true, base::Value());
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          [](base::WeakPtr<ShellHostView> host, base::DictValue transaction) {
            if (!host) return;
            for (const auto& [id, target] : Hosts()) {
              target->Event("ArdiaTabs", "tabs", base::Value(base::DictValue().Set("name", "tabs.strips").Set("data", transaction.Clone())));
            }
          }, GetWeakPtr(), std::move(transaction)));
}

bool PrivateProfileId(std::string_view profile) {
  const auto name = ardiacore::linux_profiles::ParseProfileName(profile);
  return !name || name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate;
}

void PrivateWindowsChanged() {
  for (const auto& [id, host] : Hosts()) {
    host->Event("ArdiaShell", "privateWindows", base::Value(base::DictValue()));
  }
}

void NotifyOpener(int opener_host, const base::DictValue& event) {
  const auto found = Hosts().find(opener_host);
  if (found != Hosts().end()) found->second->Event("ArdiaShell", "onWindowEvent", base::Value(event.Clone()));
}

void NotifyWindowRefused(const RequestedWindow& request) {
  const auto event = base::DictValue().Set("type", "refused").Set("id", request.id);
  if (!PrivateProfileId(request.page_profile)) {
    for (const auto& [id, host] : Hosts()) host->Event("ArdiaShell", "onWindowEvent", base::Value(event.Clone()));
    return;
  }
  ardiacore::ReleaseLinuxProfile(request.page_profile);
  NotifyOpener(request.opener_host, event);
}

void RefuseRequestedWindow(BrowserWindowInterface* browser,
                           std::map<int, RequestedWindow>::iterator request) {
  RequestedWindow refused = std::move(request->second);
  RequestedWindows().erase(request);
  NotifyWindowRefused(refused);
  browser->GetWindow()->Close();
}

struct WindowOpening {
  std::string id;
  std::string kind;
  std::string title;
  std::string page_profile;
  int opener_host = 0;
  uint64_t opener_generation = 0;
  std::optional<linux_window::Requested> requested;
  linux_window::OpenIntent intent;
  std::optional<base::DictValue> utility;
  base::DictValue private_window;
  base::WeakPtr<Profile> app_profile;
};

using WindowReply = base::OnceCallback<void(bool, base::Value)>;
constexpr base::TimeDelta kWindowOpeningLimit = base::Seconds(30);

ardiacore::linux_profiles::OpeningLedger<WindowReply>& OpeningWindows() {
  static base::NoDestructor<ardiacore::linux_profiles::OpeningLedger<WindowReply>> ledger;
  return *ledger;
}

void FinishWindowOpening(const std::string& id, uint64_t generation, bool ok, base::Value result) {
  for (auto& reply : OpeningWindows().Finish(id, generation)) std::move(reply).Run(ok, result.Clone());
}

void ExpireWindowOpening(std::string id, uint64_t generation) {
  FinishWindowOpening(id, generation, false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
}

void OpenNativeWindow(WindowOpening opening, uint64_t generation, Profile* page,
                      ardiacore::linux_profiles::ProfileError error) {
  if (!OpeningWindows().Current(opening.id, generation)) return;
  const std::string id = opening.id;
  const auto fail = [&id, generation](base::Value reason) {
    FinishWindowOpening(id, generation, false, std::move(reason));
  };
  Profile* app = opening.app_profile.get();
  const bool utility = !opening.kind.empty();
  if (!page || !app) {
    return fail(ProfileFailure(
        error == ardiacore::linux_profiles::ProfileError::kNone
            ? ardiacore::linux_profiles::ProfileError::kUnavailable : error));
  }
  if (!utility && !ardiacore::LinuxProfileHosts(opening.page_profile, page)) {
    return fail(ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
  }
  for (const auto& [native_id, host] : Hosts()) {
    if (host->window_id() == id) return FinishWindowOpening(id, generation, true, base::Value());
  }
  if (browser_shutdown::IsTryingToQuit() ||
      GetBrowserWindowCreationStatusForProfile(*page) != BrowserWindowInterface::CreationStatus::kOk) {
    return fail(ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
  }
  BrowserWindowCreateParams params(page, true);
  if (opening.requested) {
    const auto& b = opening.requested->bounds;
    params.initial_bounds = opening.requested->positioned ? gfx::Rect(b.x, b.y, b.width, b.height)
                                                          : gfx::Rect(b.width, b.height);
  }
  if (!utility && page != app) {
    params.omit_from_session_restore = true;
    params.should_trigger_session_restore = false;
  }
  if (utility) {
    params.type = BrowserWindowInterface::TYPE_APP;
    params.app_name = opening.kind == "settings" ? "ArdiaSettings" : "ArdiaImport";
    params.is_trusted_source = true;
    params.omit_from_session_restore = true;
    params.should_trigger_session_restore = false;
    params.user_title = opening.title;
    params.can_resize = opening.kind == "settings";
    params.can_maximize = opening.kind == "settings";
    params.can_fullscreen = opening.kind == "settings";
    const base::DictValue* placement = chrome::GetWindowPlacementDictionaryReadOnly(
        params.app_name, app->GetPrefs());
    const bool saved = ValidUtilityPlacement(placement);
    if (opening.kind == "import" || !saved) {
      params.initial_bounds = gfx::Rect(opening.kind == "settings" ? 820 : 640,
                                        opening.kind == "settings" ? 640 : 600);
      params.initial_show_state = ui::mojom::WindowShowState::kNormal;
    }
  }
  BrowserWindowInterface* created = CreateBrowserWindow(std::move(params));
  if (!created) return fail(base::Value("Chrome could not create a window"));
  RequestedWindow request;
  request.id = id;
  request.kind = opening.kind;
  request.title = opening.title;
  if (opening.utility) request.utility = std::move(*opening.utility);
  request.browser = created->GetWeakPtr();
  request.page_profile = opening.page_profile;
  request.app_profile = opening.app_profile;
  request.private_window = std::move(opening.private_window);
  request.opener_host = opening.opener_host;
  request.opener_generation = opening.opener_generation;
  RequestedWindows()[created->GetSessionID().id()] = std::move(request);
  ShowNativeWindow(created, WindowFocus().Create(created->GetSessionID().id(), opening.intent, FocusClockMs()));
  FinishWindowOpening(id, generation, true, base::Value(base::DictValue().Set("pending", true)));
}

void BeginWindowOpening(WindowOpening opening, uint64_t generation, Profile* utility_profile) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce(&ExpireWindowOpening, opening.id, generation), kWindowOpeningLimit);
  if (utility_profile) {
    return OpenNativeWindow(std::move(opening), generation, utility_profile,
                            ardiacore::linux_profiles::ProfileError::kNone);
  }
  const std::string page_profile = opening.page_profile;
  ardiacore::ResolveLinuxProfile(page_profile, base::BindOnce(
      [](WindowOpening opening, uint64_t generation,
         Profile* page, ardiacore::linux_profiles::ProfileError error) {
        OpenNativeWindow(std::move(opening), generation, page, error);
      }, std::move(opening), generation));
}

void ShellHostView::Invoke(
    std::string method, const base::DictValue& args,
    base::OnceCallback<void(bool, base::Value)> done) {
  if (!browser_) return std::move(done).Run(false, base::Value("The native browser window has closed"));
  const base::ListValue& values = Arguments(args);
  if (method == "ArdiaShell.pickFolder") {
    return LinuxPickFolder(GetWidget() ? GetWidget()->GetNativeWindow() : gfx::NativeWindow(), values, std::move(done));
  }
  if (method == "ArdiaShell.pickFiles") {
    return LinuxPickFiles(GetWidget() ? GetWidget()->GetNativeWindow() : gfx::NativeWindow(), values, std::move(done));
  }
  if (LinuxFilesHandles(method)) {
    if (!page_profile() || page_profile()->ShutdownStarted()) {
      return std::move(done).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
    }
    return LinuxFilesInvoke(page_profile(), shell_, method, values, std::move(done));
  }
  if (LinuxCredentialsInvokes(method)) {
    return LinuxCredentialsInvoke(!page_profile() || page_profile()->IsOffTheRecord(), shell_, method, values, std::move(done));
  }
  if (LinuxCalendarInvokes(method)) {
    if (!profile() || profile()->ShutdownStarted()) {
      return std::move(done).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
    }
    WatchCalendar();
    return LinuxCalendarInvoke(DocumentDirectory(profile()), method, values, std::move(done));
  }
  if (LinuxSyncInvokes(method)) {
    return LinuxSyncInvoke({base::NumberToString(id_) + "#" + base::NumberToString(renderer_generation_),
                            !private_window_.empty(), is_utility()},
                           profile(), shell_, method, values, std::move(done));
  }
  if (LinuxLiveInvokes(method)) {
    return LinuxLiveInvoke({LiveCaller(), !private_window_.empty()},
                           profile(), method, values, std::move(done));
  }
  if (LinuxExtensionSurfaces::Handles(method)) {
    return ExtensionSurfaces()->Invoke(method, args, page_profile(), renderer_generation_,
        blink::ZoomLevelToZoomFactor(zoom::ZoomController::GetZoomLevelForWebContents(shell())), std::move(done));
  }
  if (LinuxImportHandles(method)) {
    return LinuxImportInvoke(
        LinuxImportRequester{window_id_, shell(),
                             base::BindRepeating(
                                 [](base::WeakPtr<ShellHostView> host, base::Value payload) {
                                   if (host) host->Event("ArdiaImport", "onImportEvent", std::move(payload));
                                 },
                                 GetWeakPtr())},
        method, values, std::move(done));
  }
  if (method == "ArdiaShell.windowIdentity") {
    const auto* supplied = args.Find("args");
    const auto client = DialogClient();
    base::DictValue identity;
    if (args.size() != 1 || !supplied || !supplied->is_list() || !values.empty() ||
        !client || !dialogs_ || !dialogs_->controller().Identify(*client, &identity))
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_WINDOW_IDENTITY").Set("message", "Committed window identity unavailable")));
    return std::move(done).Run(true, base::Value(std::move(identity)));
  }
  if (method == "ArdiaSearch.suggest") {
    if (values.size() != 2 || !values[0].is_string() || !values[1].is_string() ||
        !ardia::linux_suggest_policy::ValidRequestId(values[1].GetString()) ||
        !ardia::linux_suggest::CanFetchSuggestions(profile(), page_profile(), values[0].GetString()))
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_SUGGEST_REFUSED").Set("message", "Search suggestion request refused")));
    return suggestions_->Fetch(profile(), page_profile(), values[1].GetString(), values[0].GetString(), base::BindOnce(
        [](base::OnceCallback<void(bool, base::Value)> done, std::optional<std::string> body) {
          if (!body) return std::move(done).Run(false, base::Value(base::DictValue()
              .Set("code", "ERR_SUGGEST").Set("message", "Search suggestions are unavailable")));
          std::move(done).Run(true, base::Value(base::DictValue().Set("body", std::move(*body))));
        },
        std::move(done)));
  }
  if (method == "ArdiaSearch.cancelSuggest") {
    if (values.size() != 1 || !values[0].is_string())
      return std::move(done).Run(false, base::Value("A suggestion request id is required"));
    suggestions_->Cancel(values[0].GetString());
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.beginDialog" || method == "ArdiaShell.cancelDialog") {
    const auto* supplied = args.Find("args");
    if (args.size() != 1 || !supplied || !supplied->is_list())
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_DIALOG").Set("message", "Invalid dialog request")));
    return DialogInvoke(method, values, std::move(done));
  }
  if (method == "ArdiaShell.requestWindowClose") {
    if (values.size() != 1 || !values[0].is_string())
      return std::move(done).Run(false, base::Value("Window identity required"));
    for (const auto& [id, target] : Hosts()) {
      if (target->window_id() != values[0].GetString() || target->profile() != profile() ||
          !Reaches(target)) continue;
      auto request = target->RequestWindowClose();
      if (request.empty()) return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_WINDOW_CLOSE_UNAVAILABLE").Set("message", "Target renderer unavailable")));
      return std::move(done).Run(true, base::Value(std::move(request)));
    }
    return std::move(done).Run(false, base::Value("No such native window"));
  }
  if (method == "ArdiaShell.beginWindowCloseDrain") {
    if (values.size() != 1 || !values[0].is_dict())
      return std::move(done).Run(false, base::Value("Close identity required"));
    return BeginWindowCloseDrain(values[0].GetDict(), std::move(done));
  }
  if (method == "ArdiaShell.acknowledgeWindowClose" || method == "ArdiaShell.rejectWindowClose") {
    if (values.size() != 1 || !values[0].is_dict())
      return std::move(done).Run(false, base::Value("Close identity required"));
    const auto& request = values[0].GetDict();
    if (method == "ArdiaShell.acknowledgeWindowClose")
      return AcknowledgeWindowClose(request, std::move(done));
    if (request.size() != 3 || String(request, "windowId") != window_id_)
      return std::move(done).Run(false, base::Value("Invalid close rejection"));
    return CancelWindowClose({String(request, "rendererGeneration"),
                               String(request, "closeGeneration")}, std::move(done));
  }
  if ((close_.BlocksWrites() || (chrome_close_token_ &&
       close_.identity().renderer != base::NumberToString(renderer_generation_))) &&
      (method == "session.write" || method == "ArdiaShell.writeDocument" ||
       method == "ArdiaShell.saveDocument" || method == "ArdiaShell.removeDocument")) {
    return std::move(done).Run(false, base::Value(base::DictValue()
        .Set("code", "ERR_DOCUMENT_CLOSING").Set("message", "Window is closing")));
  }
  if (method == "ArdiaShell.restoreShortcutFocus") {
    if (switcher_source_ && browser_->GetTabStripModel()->GetActiveWebContents() == switcher_source_.get()) {
      switcher_source_->Focus();
    }
    switcher_source_.reset();
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.setKeyboardShortcuts") {
    if (!focus_manager_ || values.empty() || !values[0].is_list() ||
        values[0].GetList().size() > 256) {
      return std::move(done).Run(false, base::Value("Invalid keyboard shortcut table"));
    }
    std::map<ui::Accelerator, base::DictValue> shortcuts;
    constexpr int modifiers = ui::EF_SHIFT_DOWN | ui::EF_CONTROL_DOWN |
                              ui::EF_ALT_DOWN | ui::EF_COMMAND_DOWN;
    for (const auto& value : values[0].GetList()) {
      if (!value.is_dict()) return std::move(done).Run(false, base::Value("Invalid keyboard shortcut"));
      const auto& binding = value.GetDict();
      const int key = binding.FindInt("keyCode").value_or(0);
      const int flags = binding.FindInt("modifiers").value_or(-1);
      const std::string command = String(binding, "command");
      if (key < 1 || key > 255 || flags < 0 || (flags & ~modifiers) ||
          command.empty() || command.size() > 64) {
        return std::move(done).Run(false, base::Value("Invalid keyboard shortcut"));
      }
      shortcuts.emplace(ui::Accelerator(static_cast<ui::KeyboardCode>(key), flags), binding.Clone());
    }
    shortcuts_ = std::move(shortcuts);
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.setDragEscapeCapture") {
    if (values.size() != 1 || !values[0].is_bool()) {
      return std::move(done).Run(false, base::Value("A drag escape capture flag is required"));
    }
    if (values[0].GetBool()) DragEscapeOwner() = id_;
    else ReleaseDragEscape();
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.setShortcutRecording" || method == "ArdiaShell.setSwitcherCapture") {
    if (!focus_manager_ || values.empty() || !values[0].is_bool()) {
      return std::move(done).Run(false, base::Value("A keyboard capture flag is required"));
    }
    if (method == "ArdiaShell.setShortcutRecording") {
      shortcut_recording_ = values[0].GetBool();
      focus_manager_->set_shortcut_handling_suspended(shortcut_recording_);
    } else {
      switcher_capture_ = values[0].GetBool();
      if (!switcher_capture_) {
        if (switcher_source_ && browser_->GetTabStripModel()->GetActiveWebContents() == switcher_source_.get()) {
          switcher_source_->Focus();
        }
        switcher_source_.reset();
      }
    }
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaTabs.claimLaunchTab") return ClaimLaunchTab(values, std::move(done));
  if (method == "ArdiaTabs.prepareTransfer" || method == "ArdiaTabs.releaseTransfer") {
    auto* binding = BindingForKey(ArgumentString(values, 0));
    if (!binding) return std::move(done).Run(false, base::Value("No owned tab to transfer"));
    binding->transferable = method == "ArdiaTabs.prepareTransfer";
    return std::move(done).Run(true, base::Value());
  }
  if (method == "tab.create") return CreateTab(args, std::move(done));
  if (method == "tab.command") return TabCommand(args, std::move(done));
  if (method == "tab.viewport") return SetViewport(args, std::move(done));
  if (method == "tab.presentations") return SetPresentations(args, std::move(done));
  if (method == "webView.setAutoPictureInPicture") {
    if (values.size() != 1 || !values[0].is_bool()) {
      return std::move(done).Run(false, base::Value("A boolean auto-PiP setting is required"));
    }
    const bool enabled = values[0].GetBool();
    if (!enabled) {
      for (const auto& [window, host] : Hosts()) {
        for (const auto& [id, binding] : host->bindings_) {
          binding->RememberPendingAutoPictureInPicture();
        }
      }
    }
    g_ardia_auto_picture_in_picture_off = !enabled;
    ardiacore::SetLinuxAutoPictureInPicture(enabled);
    if (!enabled) {
      std::vector<base::WeakPtr<content::WebContents>> contents;
      for (const auto& [window, host] : Hosts()) {
        for (const auto& [id, binding] : host->bindings_) {
          if (binding->contents()) contents.push_back(binding->contents()->GetWeakPtr());
        }
      }
      for (const auto& tab : contents) {
        if (!tab) continue;
        if (auto* helper = AutoPictureInPictureTabHelper::FromWebContents(tab.get())) {
          helper->OnTabBecameActive();
        }
      }
    }
    return std::move(done).Run(true, base::Value());
  }
  if (method == "tab.close") {
    TabBinding* binding = BindingForKey(String(args, "key"));
    if (!binding || !binding->contents()) {
      return std::move(done).Run(true, base::Value());
    }
    const bool closed = CloseTab(binding);
    return std::move(done).Run(closed, closed ? base::Value() : base::Value("Tab is no longer in this window"));
  }
  if (method == "tab.release") {
    TabBinding* binding = ClaimedBinding(args);
    if (!binding) return std::move(done).Run(false, base::Value("No owned live tab"));
    binding->ResetPageCommands();
    if (binding->temporary) {
      const bool disposed = DisposeTemporary(binding);
      return std::move(done).Run(disposed, disposed ? base::Value() : base::Value("The temporary surface is no longer owned by this window"));
    }
    binding->RetirePage();
    binding->claim.clear();
    binding->RememberPendingAutoPictureInPicture();
    binding->presented = false;
    binding->presentation_applied = false;
    binding->presentation_attached = false;
    binding->presentation_departed = false;
    if (binding->contents()) {
      if (auto* helper = AutoPictureInPictureTabHelper::FromWebContents(binding->contents())) {
        helper->OnTabBecameActive();
      }
    }
    binding->pane_visible = false;
    for (views::WebView* view : {binding->viewport(), binding->devtools_viewport()}) {
      if (!view) continue;
      view->SetVisible(false);
      view->SetWebContents(nullptr);
    }
    return std::move(done).Run(true, base::Value());
  }
  if (method == "session.read") {
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&ReadSession, DocumentDirectory(profile())),
        base::BindOnce(
            [](base::OnceCallback<void(bool, base::Value)> done,
               std::optional<base::DictValue> session) {
              std::move(done).Run(true, session ? base::Value(std::move(*session))
                                                : base::Value());
            }, std::move(done)));
    return;
  }
  if (method == "session.write" && profile()) {
    done = ardia::linux_suggest::NoteSuggestionsOnWrite(profile()->GetOriginalProfile()->GetPath(), std::move(done));
  }
  if (method == "session.write") {
    const base::DictValue* base = args.FindDict("base");
    const base::DictValue* local = args.FindDict("session");
    if (!base || !local || !ValidLinuxSession(*base) || !ValidLinuxSession(*local)) {
      return std::move(done).Run(false, base::Value("session.write requires bounded base and session objects"));
    }
    const base::FilePath profile_path = profile()->GetPath();
    const std::string source_window = window_id_;
    if (!TrackStorageWrite(kSessionName, base::DictValue()
            .Set("base", base->Clone()).Set("session", local->Clone()), done))
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_DOCUMENT_LIMIT").Set("message", "Window storage ledger is full")));
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&MergeAndWriteSession,
                                  DocumentDirectory(profile()),
                                  base->Clone(), local->Clone()),
        base::BindOnce(
            [](base::FilePath profile_path, std::string source_window,
               base::DictValue source_session,
               base::OnceCallback<void(bool, base::Value)> done,
               SessionWriteResult result) {
              if (!result.ok) {
                return std::move(done).Run(false, base::Value("Could not merge and persist the session"));
              }
              std::move(done).Run(true, base::Value(result.session.Clone()));
              if (result.previous == result.session) return;
              base::DictValue event = base::DictValue()
                  .Set("base", std::move(result.previous))
                  .Set("session", std::move(result.session))
                  .Set("sourceWindowId", source_window);
              for (const auto& [id, host] : Hosts()) {
                Profile* profile = host->profile();
                if (profile && !profile->IsOffTheRecord() &&
                    profile->GetPath() == profile_path) {
                  base::DictValue update = event.Clone();
                  if (host->window_id() == source_window) {
                    update.Set("base", source_session.Clone());
                  }
                  host->Event("ArdiaHost", "session", base::Value(std::move(update)));
                }
              }
            }, profile_path, source_window, local->Clone(), std::move(done)));
    return;
  }
  if (method == "ArdiaShell.readDocument") {
    const std::string name = ArgumentString(values, 0);
    if (!linux_policy::ValidDocumentName(name) || name == kSessionName ||
        LinuxDocuments::Reserved(name)) {
      return std::move(done).Run(false, base::Value("Invalid or reserved document name"));
    }
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&ReadStoredDocument, DocumentDirectory(profile()), name),
        base::BindOnce(
            [](base::OnceCallback<void(bool, base::Value)> done,
               StoredDocument stored) {
              if (stored.outcome == linux_policy::StoredRead::kFailed) {
                return std::move(done).Run(false, base::Value(base::DictValue()
                    .Set("code", "ERR_DOCUMENT_READ").Set("message", "The document could not be read")));
              }
              std::move(done).Run(true, stored.outcome == linux_policy::StoredRead::kFound
                                            ? base::Value(std::move(stored.contents))
                                            : base::Value());
            }, std::move(done)));
    return;
  }
  if (method == "ArdiaShell.writeDocument" || method == "ArdiaShell.saveDocument" ||
      method == "ArdiaShell.removeDocument") {
    const std::string name = ArgumentString(values, 0);
    if (!linux_policy::ValidDocumentName(name) || name == kSessionName ||
        LinuxDocuments::Reserved(name)) {
      return std::move(done).Run(false, base::Value("Invalid or reserved document name"));
    }
    std::optional<std::string> contents;
    if (method != "ArdiaShell.removeDocument") {
      if (values.size() < 2 || !values[1].is_string()) {
        return std::move(done).Run(false, base::Value("Document text is required"));
      }
      contents = values[1].GetString();
      if (contents->size() > linux_policy::DocumentLimit(name))
        return std::move(done).Run(false, base::Value(base::DictValue()
            .Set("code", "ERR_DOCUMENT_LIMIT").Set("message", "Document storage limit exceeded")));
    }
    base::DictValue operation;
    operation.Set("kind", contents ? "write" : "remove");
    if (contents && contents->size() > kDocumentLimit) {
      if (std::ranges::any_of(storage_intents_, [](const auto& intent) {
            return intent->pending && intent->operation.Find("sha256");
          }))
        return std::move(done).Run(false, base::Value(base::DictValue()
            .Set("code", "ERR_DOCUMENT_BUSY").Set("message", "A large document is still being written")));
      operation.Set("sha256", "pending-" + std::to_string(storage_sequence_ + 1));
      auto ticket = BeginStorageIntent(name, std::move(operation));
      if (!ticket)
        return std::move(done).Run(false, base::Value(base::DictValue()
            .Set("code", "ERR_DOCUMENT_LIMIT").Set("message", "Window storage ledger is full")));
      using Directory = decltype(DocumentDirectory(profile()));
      FileRunner()->PostTaskAndReplyWithResult(
          FROM_HERE, base::BindOnce(
              [](Directory directory, std::string name, std::optional<std::string> contents) {
                std::pair<std::string, bool> written{StorageDigest(*contents), false};
                written.second = WriteDocument(directory, name, contents);
                return written;
              }, DocumentDirectory(profile()), name, std::move(contents)),
          base::BindOnce(
              [](base::WeakPtr<ShellHostView> host, StorageTicket ticket,
                 base::OnceCallback<void(bool, base::Value)> done, std::pair<std::string, bool> written) {
                ticket.intent->operation.Set("sha256", written.first);
                if (host) host->CompleteStorageIntent(ticket, written.second, !written.second);
                std::move(done).Run(written.second,
                    written.second ? base::Value() : base::Value("Could not persist the document"));
              }, GetWeakPtr(), std::move(*ticket), std::move(done)));
      return;
    } else if (contents) {
      operation.Set("contents", *contents);
    }
    if (!TrackStorageWrite(name, std::move(operation), done))
      return std::move(done).Run(false, base::Value(base::DictValue()
          .Set("code", "ERR_DOCUMENT_LIMIT").Set("message", "Window storage ledger is full")));
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&WriteDocument, DocumentDirectory(profile()), name, std::move(contents)),
        base::BindOnce(
            [](base::OnceCallback<void(bool, base::Value)> done, bool ok) {
              std::move(done).Run(ok, ok ? base::Value() : base::Value("Could not persist the document"));
            }, std::move(done)));
    return;
  }

  if (method == "tabs.strips") {
    return std::move(done).Run(true, base::Value(Transaction(std::nullopt, false)));
  }
  if (method == "tabs.stripCommand") {
    if (values.size() < 2 || !values[0].is_int() || !values[1].is_dict()) {
      return std::move(done).Run(false, base::Value("A command id and tab strip command are required"));
    }
    ShellHostView* target = this;
    const int strip = values[1].GetDict().FindInt("strip").value_or(0);
    const auto found = Hosts().find(strip);
    if (found == Hosts().end() || found->second != this) return std::move(done).Run(false, base::Value("The strip is not owned by this window"));
    return target->StripCommand(values[0].GetInt(), values[1].GetDict(), std::move(done));
  }
  if (method == "engine.info") {
    int tabs = 0;
    int windows = 0;
    int popups = 0;
    GlobalBrowserCollection::GetInstance()->ForEach(
        [&](BrowserWindowInterface* browser) {
          if (browser->GetProfile() != profile()) return true;
          tabs += browser->GetTabStripModel()->count();
          ++windows;
          if (browser->GetType() != BrowserWindowInterface::TYPE_NORMAL) ++popups;
          return true;
        });
    return std::move(done).Run(true, base::Value(base::DictValue()
        .Set("pid", static_cast<int>(base::GetCurrentProcId()))
        .Set("dataDirectory", profile()->GetPath().value())
        .Set("engine", "Chromium")
        .Set("chromiumVersion", version_info::GetVersionNumber())
        .Set("liveBrowsers", tabs).Set("popupWindows", popups)
        .Set("chromeWindows", windows)));
  }
  if (method == "windows.list") {
    base::ListValue windows;
    for (const auto& [id, host] : Hosts()) {
      const auto* window = host->browser()->GetWindow();
      TabStripModel* strip = host->browser()->GetTabStripModel();
      const int active_id = strip->GetActiveWebContents() ? TabId(strip->GetActiveWebContents()) : 0;
      const int first_id = strip->count() ? TabId(strip->GetWebContentsAt(0)) : 0;
      windows.Append(base::DictValue()
          .Set("profile", host->page_profile_id()).Set("window", id)
          .Set("frame", window->GetBounds().ToString())
          .Set("alpha", 1.0).Set("key", window->IsActive())
          .Set("canBecomeKey", true).Set("visible", window->IsVisible())
          .Set("parentWindow", 0).Set("chromeWindows", 1)
          .Set("anchorBrowserId", active_id).Set("anyTabBrowserId", first_id)
          .Set("ready", true).Set("active", window->IsActive())
          .Set("pageInsets", base::ListValue().Append(0).Append(0).Append(0).Append(0))
          .Set("hosting", true).Set("group", host->window_id())
          .Set("hasRoot", true).Set("translucent", false));
    }
    return std::move(done).Run(true, base::Value(std::move(windows)));
  }
  if (method == "ArdiaShell.launchSteps" || method == "ArdiaShell.completeLaunchStep") {
    static base::NoDestructor<std::map<base::FilePath, ardia::linux_launch::LaunchSteps>> records;
    if (!profile() || profile()->IsOffTheRecord())
      return std::move(done).Run(false, base::Value("Launch steps need the regular profile"));
    auto& steps = (*records)[profile()->GetPath()];
    if (method == "ArdiaShell.launchSteps") {
      base::ListValue list;
      for (const auto& step : steps.List()) list.Append(step);
      return std::move(done).Run(true, base::Value(std::move(list)));
    }
    if (values.size() != 1 || !values[0].is_string() ||
        !ardia::linux_launch::ValidStep(values[0].GetString()))
      return std::move(done).Run(false, base::Value("Unknown launch step"));
    return std::move(done).Run(true, base::Value(steps.Complete(values[0].GetString())));
  }
  if (method == "ArdiaShell.privateWindows") {
    base::ListValue windows;
    for (const auto& [id, host] : Hosts()) {
      if (!host->is_utility() && host->browser() &&
          ardiacore::linux_profiles::WindowListedAsPrivate(host->access(), requester())) {
        windows.Append(base::DictValue().Set("id", host->window_id()).Set("ordinal", host->private_ordinal_));
      }
    }
    return std::move(done).Run(true, base::Value(std::move(windows)));
  }
  if (method == "ArdiaShell.commandsReady") {
    if (is_utility()) return std::move(done).Run(false, base::Value("Typeahead is for browser windows"));
    if (!values.empty()) return std::move(done).Run(false, base::Value("commandsReady takes no arguments"));
    live_generation_ = renderer_generation_;
    if (typeahead_) typeahead_->SetLive(base::BindRepeating(&ShellHostView::LiveShortcutKind, base::Unretained(this)));
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.typeaheadReady") {
    if (is_utility()) return std::move(done).Run(false, base::Value("Typeahead is for browser windows"));
    if (values.size() != 1 || !values[0].is_bool())
      return std::move(done).Run(false, base::Value("typeaheadReady takes whether a text field holds focus"));
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ShellHostView::ReplayTypeahead, GetWeakPtr(), values[0].GetBool()));
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.restoreFullScreen") {
    if (values.empty() || !values[0].is_list() || values.size() > 2 ||
        (values.size() == 2 && !values[1].is_string() && !values[1].is_none()))
      return std::move(done).Run(false, base::Value("Invalid fullscreen restore"));
    if (is_utility() || !startup_) return std::move(done).Run(true, base::Value());
    std::vector<std::string> ids;
    for (const auto& id : values[0].GetList()) {
      if (id.is_string()) ids.push_back(id.GetString());
    }
    const std::string focus = values.size() == 2 && values[1].is_string() ? values[1].GetString() : std::string();
    if (FullScreenRestorer().Begin(ids, focus)) {
      FullScreenRestoreEpoch() = WindowFocus().epoch();
      FullScreenRestoreTimer().Start(FROM_HERE, base::Seconds(10), base::BindOnce(&ExpireFullScreenRestore));
      std::vector<base::WeakPtr<ShellHostView>> windows;
      for (const auto& [id, host] : Hosts()) windows.push_back(host->GetWeakPtr());
      for (const auto& host : windows) {
        if (host) host->RestoreFullScreenNow();
      }
    }
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.windowIds") {
    base::ListValue ids;
    for (const auto& [id, host] : Hosts()) {
      if (Reaches(host)) ids.Append(host->window_id());
    }
    return std::move(done).Run(true, base::Value(std::move(ids)));
  }
  if (method == "ArdiaShell.startWindowMove" || method == "ArdiaShell.captionDoubleClick") {
    const bool handled = method == "ArdiaShell.startWindowMove" ? linux_window::StartCaptionMove(GetWidget())
                                                                : linux_window::CaptionDoubleClick(GetWidget());
    return std::move(done).Run(true, base::Value(handled));
  }
  if (method == "ArdiaShell.windowFrame" || method == "ArdiaShell.closeWindow" ||
      method == "ArdiaShell.minimizeWindow" ||
      method == "ArdiaShell.toggleMaximizeWindow" ||
      method == "ArdiaShell.focusWindow" || method == "ArdiaShell.utilityReady" ||
      method == "ArdiaShell.setWindowTitle") {
    ShellHostView* target = nullptr;
    for (const auto& [id, host] : Hosts()) {
      if (host->window_id() == ArgumentString(values, 0) &&
          (method == "ArdiaShell.focusWindow" ? FocusReaches(host) : Reaches(host))) target = host;
    }
    if (!target) return std::move(done).Run(false, base::Value("No such native window"));
    if (method == "ArdiaShell.utilityReady") {
      if (target != this || !is_utility()) {
        return std::move(done).Run(false, base::Value("No such utility renderer"));
      }
      utility_ready_ = true;
      target->RendererReady();
      if (utility_close_pending_) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(&ShellHostView::RequestUtilityClose, GetWeakPtr()));
      }
      return std::move(done).Run(true, base::Value(utility_.Clone()));
    }
    if (method == "ArdiaShell.windowFrame") {
      return std::move(done).Run(true, base::Value(SharedFrameValue(target->browser()->GetWindow()->GetBounds())));
    }
    if (method == "ArdiaShell.setWindowTitle") {
      target->browser()->GetWindow()->GetNativeWindow()->SetTitle(
          base::UTF8ToUTF16(ArgumentString(values, 1)));
    } else if (method == "ArdiaShell.minimizeWindow") {
      target->browser()->GetWindow()->Minimize();
    } else if (method == "ArdiaShell.toggleMaximizeWindow") {
      if (target->kind_ == "import") {
        return std::move(done).Run(false, base::Value("The Import window has a fixed size"));
      }
      ui::BaseWindow* window = target->browser()->GetWindow();
      if (window->IsMaximized()) {
        window->Restore();
      } else {
        window->Maximize();
      }
    } else if (method == "ArdiaShell.focusWindow") {
      ActivateNativeWindow(target->browser(), WindowFocus().Focus(target->id()));
    } else {
      auto request = target->RequestWindowClose();
      if (request.empty()) return std::move(done).Run(false, base::Value("Target renderer unavailable"));
      return std::move(done).Run(true, base::Value(std::move(request)));
    }
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.openWindow") {
    const std::string id = ArgumentString(values, 0);
    const base::DictValue* options = values.size() > 1 && values[1].is_dict()
                                       ? &values[1].GetDict() : nullptr;
    const std::string kind = options ? String(*options, "kind") : "";
    const bool utility = kind == "settings" || kind == "import";
    const base::DictValue* navigation = options ? options->FindDict("settings") : nullptr;
    std::optional<base::DictValue> utility_navigation;
    if (navigation) utility_navigation = navigation->Clone();
    if (utility && options && options->FindString("importSource")) {
      if (!utility_navigation) utility_navigation.emplace();
      utility_navigation->Set("importSource", String(*options, "importSource"));
    }
    if (id.empty() || id.size() > 256 ||
        (utility && id != kind) ||
        (!utility && (id == "settings" || id == "import"))) {
      return std::move(done).Run(false, base::Value("Invalid native window request"));
    }
    const std::string requested_profile = options ? String(*options, "profile") : "";
    const auto profile_name = ardiacore::linux_profiles::ParseProfileName(requested_profile);
    const bool incognito = options && options->FindBool("incognito").value_or(false);
    const base::DictValue* private_window = options ? options->FindDict("privateWindow") : nullptr;
    const auto private_json = private_window ? base::WriteJson(*private_window) : std::nullopt;
    if (!profile_name || !ardiacore::linux_profiles::ProfileOpensWindow(*profile_name, incognito, utility) ||
        (profile_name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate && profile_name->window != id) ||
        (private_window && (!incognito || !private_json || private_json->size() > kPrivateWindowLimit))) {
      return std::move(done).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kInvalid));
    }
    const std::string* behind = options ? options->FindString("behind") : nullptr;
    int behind_window = 0;
    for (const auto& [native_id, host] : Hosts()) {
      if (behind && host->window_id() == *behind && !host->is_utility() && FocusReaches(host)) behind_window = native_id;
    }
    const linux_window::OpenIntent intent{
        .focus = options ? options->FindBool("focus").value_or(true) : true,
        .behind = behind && !behind->empty(),
        .utility = utility,
        .behind_window = behind_window,
        .hand_back = !GlobalScreenCoordinates()};
    std::optional<linux_window::Requested> requested;
    const base::ListValue* frame = options ? options->FindList("frame") : nullptr;
    if (!utility && frame &&
        std::ranges::all_of(*frame, [](const base::Value& value) { return value.is_int() || value.is_double(); })) {
      std::vector<double> numbers;
      for (const base::Value& value : *frame) numbers.push_back(value.GetDouble());
      requested = linux_window::RequestedFrame(numbers, PrimaryScreenRect(), GlobalScreenCoordinates());
    }
    for (const auto& [native_id, host] : Hosts()) {
      if (host->window_id() != id) continue;
      if (!Reaches(host)) return std::move(done).Run(false, base::Value("No such native window"));
      if (utility_navigation && host->is_utility()) host->NavigateUtility(utility_navigation->Clone());
      ActivateNativeWindow(host->browser(), WindowFocus().Reuse(native_id, intent, host == this));
      if (host == this) host->RendererReady();
      return std::move(done).Run(true, base::Value());
    }
    for (auto& [native_id, request] : RequestedWindows()) {
      if (request.id != id || !request.browser) continue;
      if (PrivateProfileId(request.page_profile) &&
          (request.opener_host != id_ || request.opener_generation != renderer_generation_)) {
        return std::move(done).Run(false, base::Value("No such native window"));
      }
      if (!utility && request.page_profile != profile_name->id) {
        return std::move(done).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kWindowMismatch));
      }
      if (utility_navigation) request.utility = utility_navigation->Clone();
      ActivateNativeWindow(request.browser.get(), WindowFocus().Reuse(native_id, intent, false));
      return std::move(done).Run(true, base::Value());
    }
    if (!profile()) return std::move(done).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kUnavailable));
    WindowReply reply = std::move(done);
    const auto ticket = OpeningWindows().Begin(id, profile_name->id, reply);
    if (ticket.admission == ardiacore::linux_profiles::OpeningAdmission::kMismatch) {
      return std::move(reply).Run(false, ProfileFailure(ardiacore::linux_profiles::ProfileError::kWindowMismatch));
    }
    if (ticket.admission == ardiacore::linux_profiles::OpeningAdmission::kJoined) return;
    WindowOpening opening;
    opening.id = id;
    opening.kind = utility ? kind : "";
    opening.title = options ? String(*options, "title") : "";
    opening.page_profile = profile_name->id;
    opening.requested = requested;
    opening.intent = intent;
    opening.utility = std::move(utility_navigation);
    if (private_window) opening.private_window = private_window->Clone();
    opening.app_profile = profile()->GetWeakPtr();
    opening.opener_host = id_;
    opening.opener_generation = renderer_generation_;
    return BeginWindowOpening(std::move(opening), ticket.generation, utility ? profile() : nullptr);
  }
  if (method == "ArdiaShell.isDarkAppearance") {
    return std::move(done).Run(true, base::Value(
        ui::NativeTheme::GetInstanceForNativeUi()->preferred_color_scheme() ==
        ui::NativeTheme::PreferredColorScheme::kDark));
  }
  if (method == "ArdiaShell.copyText") {
    ui::ScopedClipboardWriter writer(ui::ClipboardBuffer::kCopyPaste);
    writer.WriteText(base::UTF8ToUTF16(ArgumentString(values, 0)));
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.setMenuState" || method == "ArdiaShell.setMenuBookmarks") {
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.quit" || method == "ArdiaShell.downloadsInProgress") {
    if (values.size() != 0) return std::move(done).Run(false, base::Value(method + " takes no arguments"));
    if (method == "ArdiaShell.downloadsInProgress")
      return std::move(done).Run(true, base::Value(DownloadCoreService::BlockingShutdownCountAllProfiles()));
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, base::BindOnce(&chrome::AttemptExit));
    return std::move(done).Run(true, base::Value());
  }
  if (method == "search.setEngineName") {
    const std::string name = ArgumentString(values, 0);
    if (name.empty()) return std::move(done).Run(true, base::Value());
    TemplateURLService* service = TemplateURLServiceFactory::GetForProfile(profile());
    if (!service) return std::move(done).Run(false, base::Value("No search engine service"));
    service->Load();
    if (!service->loaded()) return std::move(done).Run(false, base::Value("Search engines have not loaded yet"));
    for (TemplateURL* engine : service->GetTemplateURLs()) {
      if (engine->type() == TemplateURL::NORMAL &&
          base::EqualsCaseInsensitiveASCII(base::UTF16ToUTF8(engine->short_name()), name)) {
        service->SetUserSelectedDefaultSearchProvider(engine);
        return std::move(done).Run(true, base::Value());
      }
    }
    return std::move(done).Run(false, base::Value("No installed search engine named " + name));
  }
  std::move(done).Run(false, base::Value("Unsupported Linux host method: " + method));
}

TabBinding::TabBinding(ShellHostView* owner, content::WebContents* contents,
                       std::string key)
    : WebContentsObserver(contents), owner_(owner), contents_(contents),
      key_(std::move(key)) {
  StartMedia();
}

TabBinding::~TabBinding() {
  media.reset();
  RetirePage();
  ResetPageCommands();
  RemoveViewports();
}

void TabBinding::RemoveViewports() {
  for (auto* slot : {&viewport_, &devtools_viewport_}) {
    if (!*slot) continue;
    views::WebView* view = slot->get();
    *slot = nullptr;
    view->SetWebContents(nullptr);
    owner_->RemoveChildViewT(view);
  }
}

void TabBinding::ResetPageCommands() {
  page_command_request.reset();
  auto commands = std::move(page_commands);
  if (!commands) return;
  commands->Reset();
  if (base::SequencedTaskRunner::HasCurrentDefault())
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(commands));
}

void TabBinding::AttachPage(std::unique_ptr<ardiacore::LinuxPageState> page) {
  RetirePage();
  page_ = std::move(page);
  AttachPageChannel();
}

void TabBinding::AttachPageChannel() {
  if (!page_ || !contents_) return;
  const auto weak = GetWeakPtr();
  ardiacore::LinuxPageChannel::GetOrCreate(contents_)->Attach({
      base::BindRepeating([](base::WeakPtr<TabBinding> binding) {
        return binding && binding->presented && binding->pane_visible;
      }, weak),
      base::BindRepeating([](base::WeakPtr<TabBinding> binding, std::string name, base::Value data) {
        return binding && binding->page() && binding->page()->EmitDocument(std::move(name), std::move(data));
      }, weak),
      base::BindRepeating([](base::WeakPtr<TabBinding> binding, std::optional<ardiacore::LinuxTheme::Sample> sample,
                             content::WeakDocumentPtr document) {
        return binding && binding->page() && binding->page()->SetSampledTheme(std::move(sample), std::move(document));
      }, weak),
      base::BindRepeating([](base::WeakPtr<TabBinding> binding, gfx::PointF point) -> std::optional<gfx::PointF> {
        return binding ? binding->ShellPoint(point) : std::nullopt;
      }, weak),
  });
  page_->SetMessageSnapshot(base::BindRepeating([](base::WeakPtr<content::WebContents> contents) {
    auto* channel = contents ? ardiacore::LinuxPageChannel::FromWebContents(contents.get()) : nullptr;
    return channel ? channel->SnapshotEvents() : base::ListValue();
  }, contents_->GetWeakPtr()));
}

std::optional<gfx::PointF> TabBinding::ShellPoint(gfx::PointF page_point) const {
  return owner_ ? owner_->ShellPoint(*this, page_point) : std::nullopt;
}

std::optional<gfx::PointF> ShellHostView::ShellPoint(const TabBinding& binding, gfx::PointF page_point) {
  if (!binding.pane_visible || binding.pane_bounds.IsEmpty() || !shell()) return std::nullopt;
  const double scale = blink::ZoomLevelToZoomFactor(zoom::ZoomController::GetZoomLevelForWebContents(shell()));
  if (!std::isfinite(scale) || scale <= 0) return std::nullopt;
  const gfx::Rect& pane = binding.pane_bounds;
  const double x = std::clamp<double>(page_point.x(), 0, pane.width());
  const double y = std::clamp<double>(page_point.y(), 0, pane.height());
  return gfx::PointF((pane.x() + x) / scale, (pane.y() + y) / scale);
}

std::unique_ptr<ardiacore::LinuxPageState> TabBinding::TakePage() {
  return std::move(page_);
}

void TabBinding::RetirePage() {
  if (!page_) return;
  if (auto* channel = contents_ ? ardiacore::LinuxPageChannel::FromWebContents(contents_) : nullptr) channel->Detach();
  auto page = std::move(page_);
  page->Retire();
}

void TabBinding::ReportPresentation(std::string name, base::DictValue data) {
  if (page_) page_->EmitPresentation(std::move(name), base::Value(std::move(data)));
}

void TabBinding::StartMedia() {
  media.reset();
  if (!contents_) return;
  media = std::make_unique<ardiacore::LinuxPageMedia>(contents_, base::BindRepeating(
      [](base::WeakPtr<TabBinding> binding, std::string name, base::DictValue data) {
        if (binding) binding->ReportPresentation(std::move(name), std::move(data));
      }, GetWeakPtr()));
}

void TabBinding::Reveal() {
  if (!contents_) return;
  if (frozen) {
    frozen = false;
    if (contents_->GetVisibility() != content::Visibility::VISIBLE) contents_->SetPageFrozen(false);
  }
  if (contents_->WasDiscarded() || contents_->GetController().NeedsReload())
    contents_->GetController().LoadIfNecessary();
}

std::string_view TabBinding::Discard(const ardiacore::LinuxDiscardRequest& request) {
  if (!contents_) return "refused";
  const auto protection = media ? media->Protection(presented || pane_visible) : ardiacore::LinuxTabProtection();
  const auto decision = ardiacore::DecideLinuxDiscard(true, contents_->WasDiscarded(), request, protection);
  bool discarded = false;
  if (decision == ardiacore::LinuxDiscardDecision::kDiscard) {
    const auto weak = GetWeakPtr();
    auto* unit = resource_coordinator::TabLifecycleUnitExternal::FromWebContents(contents_);
    const bool accepted = unit && unit->DiscardTab(::mojom::LifecycleUnitDiscardReason::EXTERNAL);
    discarded = accepted && weak && weak->contents() && weak->contents()->WasDiscarded();
  }
  return ardiacore::LinuxDiscardOutcome(decision, discarded);
}

bool TabBinding::SetFrozen(bool value) {
  if (!contents_) return false;
  if (value && (!media || !ardiacore::LinuxMayFreeze(media->Protection(presented || pane_visible)))) return false;
  frozen = value;
  if (value || contents_->GetVisibility() != content::Visibility::VISIBLE) contents_->SetPageFrozen(value);
  return true;
}

std::string DiscardedUrl(content::WebContents* contents) {
  const auto* entry = contents->GetController().GetLastCommittedEntry();
  return entry && entry->GetURL().is_valid() ? entry->GetURL().spec() : contents->GetVisibleURL().spec();
}

std::vector<std::pair<std::string, base::Value>> TabBinding::SnapshotExtras() {
  std::vector<std::pair<std::string, base::Value>> events;
  if (media) events = media->Snapshot();
  if (contents_ && contents_->WasDiscarded()) {
    discard_reported = true;
    events.emplace_back("discarded", base::Value(base::DictValue().Set("url", DiscardedUrl(contents_))));
  }
  return events;
}

void TabBinding::WasDiscarded() {
  if (!contents_ || discard_reported || !contents_->WasDiscarded()) return;
  discard_reported = true;
  ReportPresentation("discarded", base::DictValue().Set("url", DiscardedUrl(contents_)));
}

void TabBinding::DidStartNavigation(content::NavigationHandle* handle) {
  if (!contents_ || !discard_reported || !handle->IsInPrimaryMainFrame() || contents_->WasDiscarded()) return;
  discard_reported = false;
  ReportPresentation("ready", base::DictValue());
}

void TabBinding::Rebind(content::WebContents* contents) {
  if (auto* channel = contents_ ? ardiacore::LinuxPageChannel::FromWebContents(contents_) : nullptr) channel->Detach();
  RetirePage();
  if (contents_ != contents) ardiacore::ForgetDeferredLinuxHangs(contents_);
  ++contents_generation_;
  ResetPageCommands();
  devtools_watch.reset();
  devtools_had_focus = false;
  if (devtools_viewport_) {
    devtools_viewport_->SetVisible(false);
    devtools_viewport_->SetWebContents(nullptr);
  }
  cancelled_auto_pip_until = {};
  requested_auto_pip_until = {};
  Observe(contents);
  contents_ = contents;
  frozen = false;
  discard_reported = false;
  StartMedia();
  if (viewport_ && viewport_->GetVisible()) viewport_->SetWebContents(contents);
}

void TabBinding::MoveTo(ShellHostView* owner) {
  RetirePage();
  ResetPageCommands();
  RememberPendingAutoPictureInPicture();
  presented = false;
  presentation_applied = false;
  presentation_attached = false;
  presentation_departed = false;
  pane_visible = false;
  RemoveViewports();
  owner_ = owner;
}

void TabBinding::DidOpenRequestedURL(
    content::WebContents* opened, content::RenderFrameHost*, const GURL& url,
    const content::Referrer&, WindowOpenDisposition disposition,
    ui::PageTransition, bool, bool) {
  if (!contents_ || !opened) return;
  std::string_view target;
  switch (disposition) {
    case WindowOpenDisposition::NEW_FOREGROUND_TAB: target = "foreground"; break;
    case WindowOpenDisposition::NEW_BACKGROUND_TAB: target = "background"; break;
    case WindowOpenDisposition::NEW_POPUP: target = "popup"; break;
    case WindowOpenDisposition::NEW_WINDOW: target = "window"; break;
    default: return;
  }
  ReportOpened(opened, url, target);
}

void TabBinding::ReportOpened(content::WebContents* opened, const GURL& url,
                              std::string_view disposition) {
  if (!contents_ || !opened) return;
  const int id = TabId(opened);
  if (id <= 0 || opened->GetBrowserContext() != contents_->GetBrowserContext()) return;
  owner_->OfferTab(opened);
  ReportPresentation("openWindow", base::DictValue()
      .Set("url", url.spec()).Set("disposition", disposition)
      .Set("adoptId", "tab:" + base::NumberToString(id)).Set("profile", ""));
}

base::DictValue TabBinding::Navigation() const {
  if (!contents_) return {};
  auto& controller = contents_->GetController();
  auto state = base::DictValue()
      .Set("url", contents_->GetVisibleURL().spec())
      .Set("title", contents_->GetTitle())
      .Set("canGoBack", controller.CanGoBack())
      .Set("canGoForward", controller.CanGoForward())
      .Set("isLoading", contents_->IsLoading());
  const GURL& committed = contents_->GetLastCommittedURL();
  if (committed.is_valid()) state.Set("committedUrl", committed.spec());
  return state;
}

void TabBinding::ReportNavigation() {
  if (page_) page_->EmitNavigation();
}

void TabBinding::DidFinishNavigation(content::NavigationHandle* handle) {
  if (handle->IsInPrimaryMainFrame()) ReportNavigation();
}
void TabBinding::DidStartLoading() { ReportNavigation(); }

void TabBinding::FocusFromHost() {
  base::AutoReset<bool> focusing(&host_focusing_, true);
  if (viewport_) viewport_->RequestFocus();
  if (contents_) contents_->Focus();
}

void TabBinding::OnWebContentsFocused(content::RenderWidgetHost*) {
  if (host_focusing_ || !contents_ || !presented || !viewport_ || !viewport_->GetVisible()) return;
  ReportPresentation("focus", base::DictValue());
}
void TabBinding::DidStopLoading() { ReportNavigation(); }
void TabBinding::LoadProgressChanged(double progress) {
  ReportPresentation("progress", base::DictValue()
      .Set("progress", std::clamp(progress, 0.0, 1.0)));
}
void TabBinding::TitleWasSet(content::NavigationEntry*) { ReportNavigation(); }
void TabBinding::DidFailLoad(content::RenderFrameHost* frame, const GURL& url,
                            int error_code) {
  if (!contents_ || frame != contents_->GetPrimaryMainFrame()) return;
  ReportPresentation("loadError", base::DictValue()
      .Set("url", url.spec()).Set("code", error_code)
      .Set("text", net::ErrorToShortString(error_code)));
}
void TabBinding::DidUpdateFaviconURL(
    content::RenderFrameHost* frame,
    const std::vector<blink::mojom::FaviconURLPtr>& candidates,
    blink::mojom::FaviconUpdateReason) {
  if (!contents_ || frame != contents_->GetPrimaryMainFrame()) return;
  base::ListValue urls;
  for (const auto& candidate : candidates) urls.Append(candidate->icon_url.spec());
  if (page_) page_->EmitDocument("favicon", base::Value(base::DictValue()
      .Set("url", candidates.empty() ? "" : candidates.front()->icon_url.spec())
      .Set("urls", std::move(urls))));
}
void TabBinding::WebContentsDestroyed() {
  const auto weak = GetWeakPtr();
  if (page_) page_->EmitClosed();
  if (!weak) return;
  media.reset();
  RetirePage();
  ardiacore::ForgetDeferredLinuxHangs(contents_);
  ResetPageCommands();
  contents_ = nullptr;
  devtools_watch.reset();
  if (viewport_) viewport_->SetWebContents(nullptr);
  if (devtools_viewport_) {
    devtools_viewport_->SetVisible(false);
    devtools_viewport_->SetWebContents(nullptr);
  }
  owner_->LayoutPane(this);
}

std::map<int, RequestedWindow>& RequestedWindows() {
  static base::NoDestructor<std::map<int, RequestedWindow>> ids;
  return *ids;
}

class HostRegistry : public BrowserCollectionObserver,
                     public PictureInPictureWindowManager::Observer {
 public:
  void Start() {
    pip_observation_.Observe(PictureInPictureWindowManager::GetInstance());
    observation_.Observe(GlobalBrowserCollection::GetInstance());
    GlobalBrowserCollection::GetInstance()->ForEach(
        [this](BrowserWindowInterface* browser) {
          Attach(browser->GetWeakPtr(), true);
          return true;
        });
  }

 private:
  void ReportPictureInPicture(bool active) {
    if (!pip_opener_) return;
    for (const auto& [id, host] : Hosts()) {
      if (host->TabShown(pip_opener_.get()) < 0) continue;
      host->ReportPictureInPicture(pip_opener_.get(), base::DictValue()
          .Set("active", active).Set("kind", pip_kind_));
    }
  }
  void OnEnterPictureInPicture() override {
    ++pip_generation_;
    auto* manager = PictureInPictureWindowManager::GetInstance();
    auto* opener = manager->GetWebContents();
    if (pip_opener_ && pip_opener_.get() != opener) ReportPictureInPicture(false);
    pip_opener_ = opener ? opener->GetWeakPtr() : nullptr;
    pip_kind_ = manager->GetChildWebContents() ? "document" : "video";
    ReportPictureInPicture(true);
    auto* helper = opener ? AutoPictureInPictureTabHelper::FromWebContents(opener) : nullptr;
    bool cancelled = false;
    for (const auto& [id, host] : Hosts()) {
      cancelled |= host->AutoPictureInPictureCancelled(opener);
    }
    if (!cancelled) {
      for (const auto& [id, host] : Hosts()) host->ConsumeAutoPictureInPictureCancellation(opener);
    }
    if (cancelled || (helper && (helper->IsInAutoPictureInPicture() ||
                                helper->AreAutoPictureInPicturePreconditionsMet()))) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(&HostRegistry::CloseCancelledPictureInPicture,
                                    base::Unretained(this), pip_generation_, pip_opener_));
    }
  }
  void OnExitPictureInPicture() override {
    ++pip_generation_;
    ReportPictureInPicture(false);
    if (pip_opener_) {
      for (const auto& [id, host] : Hosts()) {
        host->ConsumeAutoPictureInPictureCancellation(pip_opener_.get());
      }
    }
    pip_opener_ = nullptr;
  }
  void CloseCancelledPictureInPicture(
      uint64_t generation, base::WeakPtr<content::WebContents> contents) {
    auto* manager = PictureInPictureWindowManager::GetInstance();
    if (generation != pip_generation_ || !contents ||
        manager->GetWebContents() != contents.get()) return;
    bool released = true;
    bool cancelled = false;
    for (const auto& [id, host] : Hosts()) {
      const int shown = host->TabShown(contents.get());
      if (shown >= 0 && shown < 2) released = false;
      cancelled |= host->AutoPictureInPictureCancelled(contents.get());
    }
    if (released || cancelled || g_ardia_auto_picture_in_picture_off) manager->ExitPictureInPicture();
  }

  void Attach(base::WeakPtr<BrowserWindowInterface> browser, bool startup) {
    if (!browser || Hosts().contains(browser->GetSessionID().id())) return;
    const auto requested = RequestedWindows().find(browser->GetSessionID().id());
    const bool utility = requested != RequestedWindows().end() &&
                         !requested->second.kind.empty();
    if (browser->GetType() != BrowserWindowInterface::TYPE_NORMAL &&
        !(utility && browser->GetType() == BrowserWindowInterface::TYPE_APP)) return;
    Profile* app_profile = browser->GetProfile();
    if (requested != RequestedWindows().end() && requested->second.browser.get() == browser.get()) {
      app_profile = requested->second.app_profile.get();
      if (!app_profile || app_profile->GetPath() != profile_path_ ||
          !(utility ? browser->GetProfile() == app_profile
                    : ardiacore::LinuxProfileHosts(requested->second.page_profile, browser->GetProfile()))) {
        LOG(WARNING) << "Ardia Linux host refused a window whose profile no longer matches its request";
        return RefuseRequestedWindow(browser.get(), requested);
      }
    } else {
      if (browser->GetProfile()->IsOffTheRecord()) return;
      if (profile_path_.empty()) {
        profile_path_ = browser->GetProfile()->GetPath();
        ardiacore::SetLinuxAppProfile(browser->GetProfile());
      }
      if (browser->GetProfile()->GetPath() != profile_path_) return;
    }
    BrowserView* view = BrowserView::GetBrowserViewForBrowser(browser.get());
    if (!view || !view->GetWidget()) {
      LOG(WARNING) << "Ardia Linux host could not attach to a Chrome BrowserView";
      return;
    }
    auto overlay = std::make_unique<ShellHostView>(browser.get(), view, startup, app_profile);
    auto* shell = overlay.get();
    std::optional<int> opener;
    if (const auto found = RequestedWindows().find(shell->id());
        found != RequestedWindows().end()) {
      opener = found->second.opener_host;
      shell->ConfigureWindow(std::move(found->second));
      RequestedWindows().erase(found);
    }
    view->AddChildView(std::move(overlay));
    shell->Initialize();
    if (opener) NotifyOpener(*opener, base::DictValue().Set("type", "attached").Set("id", shell->window_id()));
    if (shell->private_window()) PrivateWindowsChanged();
  }
  void OnBrowserCreated(BrowserWindowInterface* browser) override {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&HostRegistry::Attach, base::Unretained(this),
                                  browser->GetWeakPtr(), false));
  }
  void OnBrowserClosed(BrowserWindowInterface* browser) override {
    WindowFocus().Forget(browser->GetSessionID().id());
    RequestedWindows().erase(browser->GetSessionID().id());
    const auto found = Hosts().find(browser->GetSessionID().id());
    if (found == Hosts().end()) return;
    if (FullScreenRestorer().Forget(found->second->window_id())) FinishFullScreenRestore();
    found->second->ReleaseExtensions();
    if (found->second->is_utility()) {
      found->second->DetachBrowser();
      return;
    }
    base::DictValue strip = found->second->Strip();
    strip.Set("closed", true);
    strip.Set("tabs", base::ListValue());
    const std::string closed_window = found->second->window_id();
    const auto closed_profile = ardiacore::linux_profiles::ParseProfileName(found->second->page_profile_id());
    const bool private_window = closed_profile && closed_profile->kind == ardiacore::linux_profiles::ProfileKind::kPrivate;
    const int opener = found->second->opener_host();
    found->second->DetachBrowser();
    if (private_window) {
      ardiacore::ReleaseLinuxProfile(closed_profile->id);
      NotifyOpener(opener, base::DictValue().Set("type", "close").Set("id", closed_window));
      PrivateWindowsChanged();
    }
    base::DictValue tx = base::DictValue()
        .Set("rev", ++Revision()).Set("cmd", base::Value())
        .Set("strips", base::ListValue().Append(std::move(strip)));
    for (const auto& [id, host] : Hosts()) {
      host->Event("ArdiaTabs", "tabs", base::Value(base::DictValue().Set("name", "tabs.strips").Set("data", tx.Clone())));
    }
  }

  base::FilePath profile_path_;
  base::WeakPtr<content::WebContents> pip_opener_;
  std::string pip_kind_;
  uint64_t pip_generation_ = 0;
  base::ScopedObservation<PictureInPictureWindowManager,
                          PictureInPictureWindowManager::Observer> pip_observation_{this};
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver>
      observation_{this};
};

void EngineEvent(void*, const char* topic, const char* json) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!topic || !json) return;
  const auto payload = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  if (!payload || !payload->is_dict()) return;
  for (const auto& [id, host] : Hosts()) host->EngineEvent(topic, payload->GetDict());
}

}

void StartLinuxHost() {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  static bool started = false;
  if (std::exchange(started, true)) return;
  ardiacore::InitializeLinuxLaunchConfig();
  ardiacore::DecideTestGateAtStartup();
  ardiacore::InstallLinuxBackgroundFileDialogs();
  g_ardia_auto_picture_in_picture_off = true;
  g_ardia_linux_tab_shown = [](content::WebContents* contents) {
    for (const auto& [id, host] : Hosts()) {
      const int shown = host->TabShown(contents);
      if (shown >= 0) return shown;
    }
    return -1;
  };
  g_ardia_linux_page_host_binder = &ardiacore::RegisterLinuxPageHostBinder;
  g_ardia_linux_auto_pip_requested = [](content::WebContents* contents) {
    for (const auto& [id, host] : Hosts()) host->NoteAutoPictureInPictureRequested(contents);
  };
  g_ardia_linux_target_url = [](content::WebContents* contents, const GURL& url) {
    for (const auto& [id, host] : Hosts()) {
      if (auto* status = host->PageStatus(contents)) return status->TargetURL(url);
    }
    return false;
  };
  g_ardia_linux_renderer_unresponsive = [](content::WebContents* contents,
                                           content::RenderWidgetHost* widget,
                                           const base::RepeatingClosure& restarter) {
    if (!widget || (widget->GetView() && widget->GetView()->IsHTMLFormPopup())) return false;
    for (const auto& [id, host] : Hosts()) {
      if (auto* status = host->PageStatus(contents); status && status->Unresponsive(widget, restarter)) return true;
    }
    for (const auto& [id, host] : Hosts()) {
      if (host->HoldsTab(contents)) return ardiacore::DeferLinuxHang(contents, widget, restarter);
    }
    return false;
  };
  g_ardia_linux_renderer_responsive = [](content::WebContents* contents,
                                         content::RenderWidgetHost* widget) {
    for (const auto& [id, host] : Hosts()) {
      if (auto* status = host->PageStatus(contents); status && status->Responsive(widget)) return true;
    }
    return ardiacore::ResolveDeferredLinuxHang(contents, widget);
  };
  g_ardia_linux_off_the_record_navigation = [](content::WebContents* contents, const GURL& url) {
    if (!contents || !url.is_valid()) return false;
    for (const auto& [id, host] : Hosts()) {
      if (host->OpenPrivateLink(contents, url)) return true;
    }
    LOG(WARNING) << "[ardia] off-the-record link refused: the window's active tab has no live Ardia page";
    return true;
  };
  g_ardia_linux_devtools_opened_tab = [](content::WebContents* inspected, content::WebContents* opened, const GURL& url) {
    for (const auto& [id, host] : Hosts()) {
      if (host->ReportDevToolsOpenedTab(inspected, opened, url)) return;
    }
    if (!opened) return;
    for (const auto& [id, host] : Hosts()) {
      if (host->BindsTab(opened)) return;
    }
    if (ShellHostView* host = DevToolsLinkWindow(opened->GetBrowserContext(), opened)) return host->AdoptDevToolsTab(opened, url);
    LOG(WARNING) << "[ardia] DevTools link refused: no Ardia window of its profile can show it";
    CloseDevToolsTab(opened);
  };
  g_ardia_linux_devtools_open_url = [](Profile* profile, const GURL& url) {
    if (ShellHostView* host = DevToolsLinkWindow(profile, nullptr)) return host->OpenDevToolsLink(url);
    LOG(WARNING) << "[ardia] DevTools link refused: no Ardia window of its profile can show it";
  };
  ardiacore::InstallLinuxAutoplayPolicy();
  ardiacore::InstallLinuxWebStore(
      base::BindRepeating([](content::WebContents* contents) {
        for (const auto& [id, host] : Hosts()) {
          if (host->HoldsTab(contents)) return true;
        }
        return false;
      }),
      base::BindRepeating([](content::WebContents* contents) {
        for (const auto& [id, host] : Hosts()) {
          if (host->HoldsTab(contents)) return host->DialogsPending();
        }
        return false;
      }));
  g_ardia_linux_drag_ended = [](BrowserWindowInterface* browser) {
    if (!browser) return;
    const auto found = Hosts().find(browser->GetSessionID().id());
    if (found == Hosts().end() || found->second->browser() != browser) return;
    ShellHostView* host = found->second;
    ardiacore::NoteLinuxDragEnded([host](content::WebContents* contents) { return host->HoldsTab(contents); });
  };
  ardiacore::SetLinuxInputActivityListener(base::BindRepeating([] {
    for (const auto& [id, host] : Hosts()) host->NoteInputActivity();
  }));
  g_ardia_devtools_dock_changed = [](BrowserWindowInterface* browser, content::WebContents* inspected,
                                     content::WebContents* devtools) {
    if (!browser || !inspected) return;
    const auto found = Hosts().find(browser->GetSessionID().id());
    if (found == Hosts().end() || found->second->browser() != browser) return;
    found->second->OnDevToolsDockChanged(inspected, devtools);
  };
  DevToolsWindow::RegisterLinuxDevToolsLifecycle();
  content::WebUIConfigMap::GetInstance().AddWebUIConfig(std::make_unique<ShellConfig>());
  g_ardia_keeps_window_without_tabs = [](const BrowserWindowInterface* browser) {
    return browser && Hosts().contains(browser->GetSessionID().id());
  };
  g_ardia_linux_close_hooks = {
      [](BrowserWindowInterface* browser, const base::UnguessableToken& token,
         LinuxCloseStage stage, base::OnceCallback<void(bool)> continuation) {
        if (!browser) return false;
        const auto found = Hosts().find(browser->GetSessionID().id());
        if (found == Hosts().end() || found->second->browser() != browser) return false;
        return found->second->DeferChromeClose(token, stage, std::move(continuation));
      },
      [](BrowserWindowInterface* browser, const base::UnguessableToken& token) {
        if (!browser) return;
        const auto found = Hosts().find(browser->GetSessionID().id());
        if (found != Hosts().end() && found->second->browser() == browser)
          found->second->ChromeCloseCancelled(token);
      }};
  SetLinuxQuitAsksAboutDownloads(true);
  LinuxExtensionsDelegate extensions;
  extensions.deliver = base::BindRepeating([](int window, std::string_view name, base::DictValue data) {
    const auto found = Hosts().find(window);
    return found != Hosts().end() && found->second->ExtensionEvent(name, std::move(data));
  });
  extensions.window_for = base::BindRepeating([](Profile* profile, content::WebContents* contents, int excluded) {
    int chosen = 0;
    for (const auto& [id, host] : Hosts()) {
      if (id == excluded || host->page_profile() != profile || !host->ExtensionsListening()) continue;
      if (contents && !host->ExtensionTabKey(contents).empty()) return id;
      const bool active = host->GetWidget() && host->GetWidget()->IsActive();
      if (!chosen || active) chosen = id;
    }
    return chosen;
  });
  extensions.window_of_browser = base::BindRepeating([](const BrowserWindowInterface* browser) {
    if (!browser) return 0;
    const auto found = Hosts().find(browser->GetSessionID().id());
    return found != Hosts().end() && found->second->browser() == browser ? found->first : 0;
  });
  extensions.tab_key = base::BindRepeating([](int window, content::WebContents* contents) {
    const auto found = Hosts().find(window);
    return found != Hosts().end() ? found->second->ExtensionTabKey(contents) : std::string();
  });
  extensions.surfaces = base::BindRepeating([](int window) -> LinuxExtensionSurfaces* {
    const auto found = Hosts().find(window);
    return found != Hosts().end() && !found->second->is_utility() ? found->second->ExtensionSurfaces() : nullptr;
  });
  extensions.broadcast = base::BindRepeating([](Profile* profile, std::string_view name, base::DictValue data) {
    for (const auto& [id, host] : Hosts()) {
      Profile* page = host->page_profile();
      if (!page || page->ShutdownStarted()) continue;
      if (page->GetOriginalProfile() == profile || (host->is_utility() && !profile->IsOffTheRecord())) {
        host->ExtensionEvent(name, data.Clone());
      }
    }
  });
  g_ardia_native_messaging_manifest = &NativeMessagingManifest;
  StartLinuxExtensions(std::move(extensions));
  ac_engine_set_event_sink(EngineEvent, nullptr);
  StartLinuxSiteControls(base::BindRepeating([](Profile* profile, base::Value stats) {
    for (const auto& [id, host] : Hosts()) {
      if (!host->profile() || host->profile()->GetOriginalProfile() != profile) continue;
      host->Event("ArdiaContentBlocker", "contentBlocker", base::Value(base::DictValue()
          .Set("name", "contentBlocker.changed").Set("data", stats.Clone())));
    }
  }));
  static base::NoDestructor<HostRegistry> registry;
  registry->Start();
}

}
