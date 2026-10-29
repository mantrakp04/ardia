#include "ardia/linux/ac_linux_extension_views.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "ardia/linux/ac_linux_extension_service.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/extensions/extension_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/extension_host_registry.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/common/extension.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_conversions.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/view.h"
#include "url/gurl.h"

namespace ardia {
namespace {

namespace ext = linux_extensions;

constexpr gfx::Size kPopupMin(25, 25);
constexpr gfx::Size kPopupMax(800, 600);

void Fail(LinuxExtensionSurfaces::Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

double Now() {
  return (base::TimeTicks::Now() - base::TimeTicks()).InSecondsF();
}

std::optional<int> SurfaceId(const base::DictValue& args) {
  const base::Value* id = args.Find("id");
  return id && id->is_int() && id->GetInt() > 0 ? std::optional<int>(id->GetInt()) : std::nullopt;
}

}

class LinuxExtensionSurfaces::Surface : public extensions::ExtensionView,
                                        public content::WebContentsObserver,
                                        public extensions::ExtensionRegistryObserver,
                                        public extensions::ExtensionHostRegistry::Observer {
 public:
  Surface(LinuxExtensionSurfaces* owner, int id, ext::SurfaceKind kind,
          std::unique_ptr<extensions::ExtensionViewHost> host, views::View* parent)
      : owner_(owner), id_(id), kind_(kind), host_(std::move(host)), parent_(parent) {
    host_->set_view(this);
    Observe(host_->host_contents());
    host_->SetCloseHandler(base::BindOnce(&Surface::ClosedByChrome, weak_factory_.GetWeakPtr()));
    content::BrowserContext* context = host_->browser_context();
    registry_observation_.Observe(extensions::ExtensionRegistry::Get(context));
    hosts_observation_.Observe(extensions::ExtensionHostRegistry::Get(context));
    view_ = parent_->AddChildView(std::make_unique<views::WebView>(context));
    view_->SetVisible(false);
    view_->SetWebContents(contents());
  }
  Surface(const Surface&) = delete;
  Surface& operator=(const Surface&) = delete;
  ~Surface() override {
    Observe(nullptr);
    FailShown();
    if (view_) {
      view_->SetWebContents(nullptr);
      parent_->RemoveChildViewT(view_.ExtractAsDangling());
    }
    host_->set_view(nullptr);
  }

  content::WebContents* contents() const { return host_->host_contents(); }
  const std::string& extension_id() const { return host_->extension_id(); }
  ext::SurfaceKind kind() const { return kind_; }

  void Start() {
    owner_->SurfaceEvent(id_, base::DictValue().Set("type", "ready"));
    host_->CreateRendererSoon();
  }

  void SetShownCallback(ShowPopupCallback callback) {
    FailShown();
    shown_ = std::move(callback);
    if (host_->has_loaded_once()) OnLoaded();
  }

  void Place(const gfx::Rect& bounds, bool visible) {
    view_->SetBoundsRect(bounds);
    view_->SetVisible(visible);
    parent_->ReorderChildView(view_, parent_->children().size());
  }

  void Focus() {
    if (!view_->GetVisible()) return;
    view_->RequestFocus();
    contents()->Focus();
  }

  gfx::NativeView GetNativeView() override { return contents()->GetNativeView(); }

  void ResizeDueToAutoResize(content::WebContents*, const gfx::Size& size) override {
    if (kind_ != ext::SurfaceKind::kPopup || size == preferred_) return;
    preferred_ = size;
    owner_->SurfaceEvent(id_, base::DictValue()
        .Set("type", "preferredSize")
        .Set("value", base::DictValue().Set("width", size.width()).Set("height", size.height())));
  }

  void RenderFrameCreated(content::RenderFrameHost* frame) override {
    if (frame == contents()->GetPrimaryMainFrame()) EnableAutoResize(frame);
  }

  bool HandleKeyboardEvent(content::WebContents*, const input::NativeWebKeyboardEvent&) override { return false; }

  void OnLoaded() override {
    ReportNavigation();
    if (!shown_) return;
    const bool shown = host_->document_element_available();
    LOG_IF(WARNING, !shown) << "[ardia] action.openPopup for " << extension_id()
                            << ": its page stopped loading without a document";
    std::move(shown_).Run(shown ? host_.get() : nullptr);
  }

  void DidStartLoading() override { ReportNavigation(); }
  void DidStopLoading() override { ReportNavigation(); }
  void TitleWasSet(content::NavigationEntry*) override { ReportNavigation(); }

  void RenderFrameHostChanged(content::RenderFrameHost* old_host, content::RenderFrameHost* new_host) override {
    if (old_host && new_host == contents()->GetPrimaryMainFrame() && new_host->IsRenderFrameLive())
      EnableAutoResize(new_host);
  }

  void OnExtensionUnloaded(content::BrowserContext*, const extensions::Extension* extension,
                           extensions::UnloadedExtensionReason) override {
    if (extension->id() == extension_id()) PostClosed();
  }

  void OnShutdown(extensions::ExtensionRegistry*) override { registry_observation_.Reset(); }

  void OnExtensionHostRenderProcessGone(content::BrowserContext*, extensions::ExtensionHost* host) override {
    if (host == host_.get()) PostClosed();
  }

  void OnExtensionHostRegistryShutdown(extensions::ExtensionHostRegistry*) override { hosts_observation_.Reset(); }

 private:
  void EnableAutoResize(content::RenderFrameHost* frame) {
    if (kind_ == ext::SurfaceKind::kPopup && frame->GetView()) frame->GetView()->EnableAutoResize(kPopupMin, kPopupMax);
  }

  void ReportNavigation() {
    content::WebContents* page = contents();
    owner_->SurfaceEvent(id_, base::DictValue()
        .Set("type", "navigation")
        .Set("state", base::DictValue()
            .Set("url", page->GetVisibleURL().spec())
            .Set("title", page->GetTitle())
            .Set("canGoBack", false)
            .Set("canGoForward", false)
            .Set("isLoading", page->IsLoading())));
  }

  void FailShown() {
    if (!shown_) return;
    LOG(WARNING) << "[ardia] action.openPopup for " << extension_id() << ": the popup closed before its page loaded";
    std::move(shown_).Run(nullptr);
  }

  void ClosedByChrome(extensions::ExtensionHost*) { PostClosed(); }

  void PostClosed() {
    if (std::exchange(closing_, true)) return;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxExtensionSurfaces::SurfaceClosed, owner_->weak_factory_.GetWeakPtr(), id_, true));
  }

  raw_ptr<LinuxExtensionSurfaces> owner_;
  const int id_;
  const ext::SurfaceKind kind_;
  std::unique_ptr<extensions::ExtensionViewHost> host_;
  raw_ptr<views::View> parent_;
  raw_ptr<views::WebView> view_ = nullptr;
  gfx::Size preferred_;
  ShowPopupCallback shown_;
  bool closing_ = false;
  base::ScopedObservation<extensions::ExtensionRegistry, extensions::ExtensionRegistryObserver> registry_observation_{this};
  base::ScopedObservation<extensions::ExtensionHostRegistry, extensions::ExtensionHostRegistry::Observer>
      hosts_observation_{this};
  base::WeakPtrFactory<Surface> weak_factory_{this};
};

LinuxExtensionSurfaces::LinuxExtensionSurfaces(BrowserWindowInterface* browser, views::View* parent, Emit emit)
    : browser_(browser), parent_(parent), emit_(std::move(emit)) {}

LinuxExtensionSurfaces::~LinuxExtensionSurfaces() {
  weak_factory_.InvalidateWeakPtrs();
  FailPending();
  CloseAll();
}

bool LinuxExtensionSurfaces::Handles(std::string_view method) {
  return method == "extensionView.create" || method == "extensionView.viewport" ||
         method == "extensionView.command" || method == "extensionView.release";
}

void LinuxExtensionSurfaces::Invoke(const std::string& method, const base::DictValue& args, Profile* profile,
                                    uint64_t generation, double scale, Done done) {
  if (method == "extensionView.create") return Create(args, profile, generation, std::move(done));
  if (method == "extensionView.viewport") return Viewport(args, generation, scale, std::move(done));
  if (method == "extensionView.command") return Command(args, generation, std::move(done));
  if (method == "extensionView.release") return Release(args, generation, std::move(done));
  Fail(std::move(done), "ERR_UNKNOWN_CALL", "Unknown extension view operation");
}

void LinuxExtensionSurfaces::Create(const base::DictValue& args, Profile* profile, uint64_t generation, Done done) {
  ext::SurfaceRequest request;
  if (const auto invalid = ext::ValidateSurfaceRequest(args, &request); !invalid.empty())
    return Fail(std::move(done), "ERR_EXTENSION_VIEW_REQUEST", invalid);
  std::string code;
  Profile* owner = browser_ ? LinuxExtensionViewProfile(profile, *args.FindString("profile"), &code) : nullptr;
  if (!owner) {
    return Fail(std::move(done), code.empty() ? "ERR_WINDOW_CLOSED" : code,
                code == "ERR_PROFILE_ENDING" ? "This private session is closing"
                                             : "Extension views need this window's own profile");
  }
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(owner)->enabled_extensions().GetByID(request.extension_id);
  if (!extension) return Fail(std::move(done), "ERR_EXTENSION_UNAVAILABLE", "The extension is not enabled");
  if (owner->IsOffTheRecord() && !extensions::util::IsIncognitoEnabled(extension->id(), owner)) {
    return Fail(std::move(done), "ERR_EXTENSION_PRIVATE", "This extension is not allowed in private windows");
  }
  const GURL url(request.url);
  if (!url.is_valid()) return Fail(std::move(done), "ERR_EXTENSION_VIEW_REQUEST", "Invalid extension view URL");
  const auto id = book_.Open(request.kind, request.extension_id, generation);
  if (!id) return Fail(std::move(done), "ERR_EXTENSION_VIEW_LIMIT", "Too many extension views in this window");
  std::unique_ptr<extensions::ExtensionViewHost> host =
      request.kind == ext::SurfaceKind::kPopup
          ? extensions::ExtensionViewHostFactory::CreatePopupHost(*extension, url, browser_)
          : extensions::ExtensionViewHostFactory::CreateSidePanelHost(*extension, url, browser_, nullptr);
  if (!host) {
    book_.Close(*id);
    return Fail(std::move(done), "ERR_EXTENSION_UNAVAILABLE", "Chrome could not host the extension page");
  }
  auto surface = std::make_unique<Surface>(this, *id, request.kind, std::move(host), parent_);
  Surface* raw = surface.get();
  surfaces_[*id] = std::move(surface);
  if (request.kind == ext::SurfaceKind::kPopup) {
    if (auto callback = pending_.Match(request.extension_id, Now())) {
      pending_timer_.Stop();
      raw->SetShownCallback(std::move(*callback));
    }
  }
  std::move(done).Run(true, base::Value(base::DictValue().Set("id", *id)));
  if (surfaces_.contains(*id)) raw->Start();
}

LinuxExtensionSurfaces::Surface* LinuxExtensionSurfaces::Owned(const base::DictValue& args, uint64_t generation) {
  const auto id = SurfaceId(args);
  if (!id || !book_.Owns(*id, generation)) return nullptr;
  auto found = surfaces_.find(*id);
  return found == surfaces_.end() ? nullptr : found->second.get();
}

void LinuxExtensionSurfaces::Viewport(const base::DictValue& args, uint64_t generation, double scale, Done done) {
  Surface* surface = Owned(args, generation);
  const base::DictValue* rect = args.FindDict("rect");
  if (!surface || !rect) return Fail(std::move(done), "ERR_EXTENSION_VIEW_STALE", "No such extension view");
  const double x = rect->FindDouble("x").value_or(NAN);
  const double y = rect->FindDouble("y").value_or(NAN);
  const double width = rect->FindDouble("width").value_or(NAN);
  const double height = rect->FindDouble("height").value_or(NAN);
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) || !std::isfinite(height) || width < 0 ||
      height < 0 || !std::isfinite(scale) || scale <= 0) {
    return Fail(std::move(done), "ERR_EXTENSION_VIEW_REQUEST", "Viewport coordinates must be finite");
  }
  const double room_width = parent_->width();
  const double room_height = parent_->height();
  const double left = std::clamp(x * scale, 0.0, room_width);
  const double top = std::clamp(y * scale, 0.0, room_height);
  const double right = std::clamp((x + width) * scale, left, room_width);
  const double bottom = std::clamp((y + height) * scale, top, room_height);
  const gfx::Rect bounds = gfx::ToEnclosingRect(gfx::RectF(left, top, right - left, bottom - top));
  surface->Place(bounds, args.FindBool("visible").value_or(false) && !bounds.IsEmpty());
  std::move(done).Run(true, base::Value());
}

void LinuxExtensionSurfaces::Command(const base::DictValue& args, uint64_t generation, Done done) {
  Surface* surface = Owned(args, generation);
  const std::string* command = args.FindString("command");
  if (!surface || !command) return Fail(std::move(done), "ERR_EXTENSION_VIEW_STALE", "No such extension view");
  if (*command == "focus") {
    surface->Focus();
    return std::move(done).Run(true, base::Value());
  }
  if (*command == "captureViewport") return std::move(done).Run(true, base::Value());
  if (*command == "evaluate") {
    return Fail(std::move(done), "ERR_PAGE_EVALUATION_REFUSED", "Extension views run no page script on Linux");
  }
  Fail(std::move(done), "ERR_UNKNOWN_COMMAND", "Extension views do not support this command");
}

void LinuxExtensionSurfaces::Release(const base::DictValue& args, uint64_t generation, Done done) {
  const auto id = SurfaceId(args);
  if (id && book_.Owns(*id, generation)) Destroy(*id);
  std::move(done).Run(true, base::Value());
}

void LinuxExtensionSurfaces::Destroy(int id) {
  book_.Close(id);
  auto found = surfaces_.find(id);
  if (found == surfaces_.end()) return;
  std::unique_ptr<Surface> surface = std::move(found->second);
  surfaces_.erase(found);
}

void LinuxExtensionSurfaces::SurfaceClosed(int id, bool report) {
  if (!surfaces_.contains(id)) return;
  if (report) emit_.Run(id, base::DictValue().Set("type", "windowClose"));
  Destroy(id);
}

void LinuxExtensionSurfaces::SurfaceEvent(int id, base::DictValue event) {
  emit_.Run(id, std::move(event));
}

void LinuxExtensionSurfaces::RetireOlderThan(uint64_t generation) {
  for (const int id : book_.CloseOlderThan(generation)) {
    auto found = surfaces_.find(id);
    if (found == surfaces_.end()) continue;
    std::unique_ptr<Surface> surface = std::move(found->second);
    surfaces_.erase(found);
  }
}

void LinuxExtensionSurfaces::CloseAll() {
  book_.CloseAll();
  auto surfaces = std::move(surfaces_);
  surfaces_.clear();
  surfaces.clear();
}

void LinuxExtensionSurfaces::ExpectPopup(std::string extension_id, ShowPopupCallback callback) {
  if (auto previous = pending_.Expect(std::move(extension_id), Now(), std::move(callback)); previous && *previous) {
    LOG(WARNING) << "[ardia] action.openPopup: another openPopup came first";
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
                                                                base::BindOnce(std::move(*previous), nullptr));
  }
  pending_timer_.Start(FROM_HERE, base::Seconds(ext::kPopupWaitSeconds + 0.5),
                       base::BindOnce(&LinuxExtensionSurfaces::ExpirePending, weak_factory_.GetWeakPtr()));
}

std::optional<ShowPopupCallback> LinuxExtensionSurfaces::TakePendingPopup() {
  pending_timer_.Stop();
  return pending_.Fail();
}

void LinuxExtensionSurfaces::ExpirePending() {
  if (auto expired = pending_.Expire(Now()); expired && *expired) {
    LOG(WARNING) << "[ardia] action.openPopup: no popup of the extension opened in its window within 10 s";
    std::move(*expired).Run(nullptr);
  }
}

void LinuxExtensionSurfaces::FailPending() {
  pending_timer_.Stop();
  if (auto pending = pending_.Fail(); pending && *pending) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
                                                                base::BindOnce(std::move(*pending), nullptr));
  }
}

}
