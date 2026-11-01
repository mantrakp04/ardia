#include "ardia/linux/ac_linux_extension_views.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "ardia/linux/ac_linux_extension_service.h"
#include "ardia/linux/ac_linux_popup_geometry.h"
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
#include "ui/aura/window.h"
#include "ui/compositor/layer.h"
#include "ui/compositor/layer_animator.h"
#include "ui/compositor/scoped_layer_animation_settings.h"
#include "ui/gfx/animation/tween.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_conversions.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/geometry/vector2d_f.h"
#include "ui/views/controls/native/native_view_host.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/focus/focus_manager.h"
#include "ui/views/view_tracker.h"
#include "ui/views/widget/widget.h"
#include "ui/views/view.h"
#include "url/gurl.h"

namespace ardia {
namespace {

namespace ext = linux_extensions;

constexpr gfx::Size kPopupMin(ext::kPopupMinWidth, ext::kPopupMinHeight);
constexpr gfx::Size kPopupMax(ext::kPopupMaxWidth, ext::kPopupMaxHeight);
constexpr base::TimeDelta kRevealSettle = base::Milliseconds(100);
constexpr base::TimeDelta kRevealDeadline = base::Milliseconds(600);
constexpr base::TimeDelta kDecorationWait = base::Milliseconds(300);
constexpr int kMaxFadeMs = 1000;

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

gfx::Vector2dF OriginInRoot(const ui::Layer* layer) {
  gfx::Vector2dF origin;
  for (; layer; layer = layer->parent()) origin += layer->bounds().OffsetFromOrigin() + layer->GetSubpixelOffset();
  return origin;
}

double DeviceScale(const views::View* view) {
  const views::Widget* widget = view->GetWidget();
  const ui::Layer* layer = widget ? widget->GetLayer() : nullptr;
  return layer ? layer->device_scale_factor() : 1.0;
}

double Css(double dip, double zoom) {
  return std::round(dip / zoom * 1e4) / 1e4;
}

std::optional<gfx::RoundedCornersF> CornerRadii(const base::DictValue* radii, double zoom) {
  if (!radii) return std::nullopt;
  const auto corner = [&](std::string_view key) {
    const double value = radii->FindDouble(key).value_or(0);
    return std::isfinite(value) && value > 0 ? static_cast<float>(std::min(value, 64.0) * zoom) : 0.0f;
  };
  return gfx::RoundedCornersF(corner("upperLeft"), corner("upperRight"), corner("lowerRight"), corner("lowerLeft"));
}

}

class LinuxExtensionSurfaces::Surface : public extensions::ExtensionView,
                                        public content::WebContentsObserver,
                                        public extensions::ExtensionRegistryObserver,
                                        public extensions::ExtensionHostRegistry::Observer,
                                        public views::FocusChangeListener {
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
    WatchFocus();
  }
  Surface(const Surface&) = delete;
  Surface& operator=(const Surface&) = delete;
  ~Surface() override {
    Observe(nullptr);
    FailShown();
    ReturnFocus();
    focus_observation_.Reset();
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

  void Place(const gfx::Rect& bounds, bool visible, std::optional<gfx::RoundedCornersF> radii) {
    WatchFocus();
    if (!visible) ReturnFocus();
    if (radii) radii_ = *radii;
    view_->SetBoundsRect(bounds);
    view_->SetVisible(visible);
    ApplyRadii();
    parent_->ReorderChildView(view_, parent_->children().size());
    if (owner_->restack_) owner_->restack_.Run();
    SetShown(visible);
  }

  void Position(const ext::PopupPlacement& placement, double radius, int fade_ms, bool wanted,
                std::optional<int> decorated, std::optional<double> decorated_scale) {
    placement_ = placement;
    radius_ = radius;
    fade_ms_ = fade_ms;
    wanted_ = wanted;
    if (decorated && decorated_scale && std::abs(*decorated_scale - Scale() * Zoom()) < 1e-3)
      decorated_ = std::max(decorated_, *decorated);
    if (!wanted_) Conceal(false);
    Relayout();
  }

  void Relayout() {
    if (kind_ != ext::SurfaceKind::kPopup || !placement_) return;
    const double zoom = Zoom();
    const double scale = Scale();
    const std::optional<ext::PopupLimits> limits = ext::PopupLimitsFor(*placement_, zoom);
    if (!limits) {
      Conceal(true);
      return;
    }
    if (limits != limits_) {
      limits_ = limits;
      ApplyAutoResize();
    }
    gfx::Point origin;
    views::View::ConvertPointToWidget(parent_, &origin);
    const std::optional<ext::PopupBox> box =
        ext::PopupBoxFor(*placement_, zoom, preferred_.width(), preferred_.height(), origin.x() * scale,
                         origin.y() * scale, scale);
    if (!box) {
      Conceal(true);
      return;
    }
    const gfx::Rect bounds(box->x, box->y, box->width, box->height);
    if (view_->bounds() != bounds) view_->SetBoundsRect(bounds);
    radii_ = gfx::RoundedCornersF(static_cast<float>(std::max(0.0, radius_) * zoom));
    if (wanted_ && !view_->GetVisible()) Stage();
    ApplyRadii();
    EmitFrame(false);
    if (wanted_ && !settled_ && host_->has_loaded_once() && !preferred_.IsEmpty() && !settle_timer_.IsRunning())
      Unsettle();
    MaybeReveal();
  }

  void Raise() { parent_->ReorderChildView(view_, parent_->children().size()); }

  void Focus() {
    if (!native_shown_) return;
    WatchFocus();
    view_->RequestFocus();
    contents()->Focus();
  }

  void OnWillChangeFocus(views::View* before, views::View* now) override {
    if (now && before && Owns(now) && !Owns(before)) focus_before_.SetView(before);
  }

  void OnFocusManagerDestroying(views::FocusManager*) override { focus_observation_.Reset(); }

  gfx::NativeView GetNativeView() override { return contents()->GetNativeView(); }

  void ResizeDueToAutoResize(content::WebContents*, const gfx::Size& size) override {
    if (kind_ != ext::SurfaceKind::kPopup || size == preferred_) return;
    preferred_ = size;
    const double zoom = Zoom();
    owner_->SurfaceEvent(id_, base::DictValue()
        .Set("type", "preferredSize")
        .Set("value", base::DictValue().Set("width", Css(size.width(), zoom)).Set("height", Css(size.height(), zoom))));
    if (host_->has_loaded_once()) Unsettle();
    Relayout();
  }

  void RenderFrameCreated(content::RenderFrameHost* frame) override {
    if (frame == contents()->GetPrimaryMainFrame()) EnableAutoResize(frame);
  }

  bool HandleKeyboardEvent(content::WebContents*, const input::NativeWebKeyboardEvent&) override { return false; }

  void OnLoaded() override {
    ReportNavigation();
    if (kind_ == ext::SurfaceKind::kPopup && !preferred_.IsEmpty()) Unsettle();
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
    if (kind_ != ext::SurfaceKind::kPopup || !frame->GetView()) return;
    if (!limits_) return frame->GetView()->EnableAutoResize(kPopupMin, kPopupMax);
    frame->GetView()->EnableAutoResize(gfx::Size(limits_->min_width, limits_->min_height),
                                       gfx::Size(limits_->max_width, limits_->max_height));
  }

  void ApplyAutoResize() {
    content::RenderFrameHost* frame = contents()->GetPrimaryMainFrame();
    if (frame && frame->IsRenderFrameLive()) EnableAutoResize(frame);
  }

  double Zoom() const {
    const double zoom = owner_->zoom_ ? owner_->zoom_.Run() : 1.0;
    return std::isfinite(zoom) && zoom > 0 ? zoom : 1.0;
  }

  double Scale() const { return DeviceScale(parent_); }

  void ApplyRadii() { view_->holder()->SetNativeViewCornerRadii(radii_); }

  void WatchFocus() {
    if (focus_observation_.IsObserving()) return;
    if (views::FocusManager* focus = view_->GetFocusManager()) focus_observation_.Observe(focus);
  }

  void Unsettle() {
    if (native_shown_ || deadline_passed_) return;
    settled_ = false;
    settle_timer_.Start(FROM_HERE, kRevealSettle, this, &Surface::Settle);
    if (!deadline_timer_.IsRunning()) deadline_timer_.Start(FROM_HERE, kRevealDeadline, this, &Surface::PassDeadline);
  }

  void Settle() {
    settled_ = true;
    MaybeReveal();
  }

  void PassDeadline() {
    settle_timer_.Stop();
    deadline_passed_ = true;
    Settle();
  }

  void WaiveDecoration() {
    decoration_waived_ = true;
    MaybeReveal();
  }

  std::optional<gfx::RectF> FrameInShell() const {
    const gfx::Rect bounds = view_->bounds();
    gfx::Vector2dF offset(bounds.x(), bounds.y());
    aura::Window* page = contents()->GetNativeView();
    aura::Window* shell = owner_->shell_window_ ? owner_->shell_window_.Run() : nullptr;
    if (view_->GetVisible() && page && shell && page->IsVisible() && page->layer() && shell->layer() &&
        page->GetRootWindow() && page->GetRootWindow() == shell->GetRootWindow()) {
      offset = OriginInRoot(page->layer()) - OriginInRoot(shell->layer());
    }
    if (bounds.IsEmpty()) return std::nullopt;
    return gfx::RectF(offset.x(), offset.y(), bounds.width(), bounds.height());
  }

  void EmitFrame(bool force) {
    const std::optional<gfx::RectF> frame = FrameInShell();
    if (!frame) return;
    const double zoom = Zoom();
    base::DictValue rect = base::DictValue()
        .Set("x", Css(frame->x(), zoom))
        .Set("y", Css(frame->y(), zoom))
        .Set("width", Css(frame->width(), zoom))
        .Set("height", Css(frame->height(), zoom))
        .Set("radius", Css(radii_.upper_left(), zoom))
        .Set("scale", Scale() * zoom)
        .Set("reveal", revealing_ || native_shown_);
    if (!force && last_frame_ == rect) return;
    last_frame_ = rect.Clone();
    ++serial_;
    rect.Set("serial", serial_);
    owner_->SurfaceEvent(id_, base::DictValue().Set("type", "frame").Set("value", std::move(rect)));
  }

  void MaybeReveal() {
    if (kind_ != ext::SurfaceKind::kPopup || native_shown_ || !wanted_ || !limits_ || !settled_ ||
        !host_->has_loaded_once() || preferred_.IsEmpty() || view_->bounds().IsEmpty()) {
      return;
    }
    if (!revealing_) {
      revealing_ = true;
      EmitFrame(true);
      decoration_timer_.Start(FROM_HERE, kDecorationWait, this, &Surface::WaiveDecoration);
      return;
    }
    if (decorated_ >= serial_ || decoration_waived_) Reveal();
  }

  void Stage() {
    SetContentHidden(true);
    view_->SetVisible(true);
    Raise();
    if (owner_->restack_) owner_->restack_.Run();
  }

  void SetContentHidden(bool hidden) {
    aura::Window* window = contents()->GetNativeView();
    if (!window) return;
    window->layer()->GetAnimator()->StopAnimating();
    window->layer()->SetOpacity(hidden ? 0.0f : 1.0f);
    window->SetEventTargetingPolicy(hidden ? aura::EventTargetingPolicy::kNone
                                           : aura::EventTargetingPolicy::kTargetAndDescendants);
  }

  void Reveal() {
    if (!revealing_ || !wanted_ || !settled_ || !limits_ || view_->bounds().IsEmpty()) return;
    decoration_timer_.Stop();
    settle_timer_.Stop();
    deadline_timer_.Stop();
    revealing_ = false;
    if (!view_->GetVisible()) Stage();
    ApplyRadii();
    if (aura::Window* window = contents()->GetNativeView()) {
      window->SetEventTargetingPolicy(aura::EventTargetingPolicy::kTargetAndDescendants);
      ui::Layer* layer = window->layer();
      layer->GetAnimator()->StopAnimating();
      if (fade_ms_ > 0) {
        layer->SetOpacity(0.0f);
        ui::ScopedLayerAnimationSettings fade(layer->GetAnimator());
        fade.SetTransitionDuration(base::Milliseconds(fade_ms_));
        fade.SetTweenType(gfx::Tween::EASE_OUT_3);
        fade.SetPreemptionStrategy(ui::LayerAnimator::IMMEDIATELY_SET_NEW_TARGET);
        layer->SetOpacity(1.0f);
      } else {
        layer->SetOpacity(1.0f);
      }
    }
    SetShown(true);
    EmitFrame(false);
  }

  void Conceal(bool room_lost) {
    ReturnFocus();
    settle_timer_.Stop();
    deadline_timer_.Stop();
    decoration_timer_.Stop();
    settled_ = false;
    deadline_passed_ = false;
    decoration_waived_ = false;
    revealing_ = false;
    SetContentHidden(false);
    view_->SetVisible(false);
    SetShown(false);
    EmitFrame(false);
    if (!room_lost) return;
    limits_.reset();
    last_frame_.reset();
    view_->SetBoundsRect(gfx::Rect());
  }

  bool Owns(const views::View* view) const { return view_ && view && (view == view_ || view_->Contains(view)); }

  void ReturnFocus() {
    views::FocusManager* focus = view_ ? view_->GetFocusManager() : nullptr;
    views::View* before = focus_before_.view();
    focus_before_.SetView(nullptr);
    if (!focus || !before || !Owns(focus->GetFocusedView())) return;
    if (before->IsDrawn() && before->IsFocusable()) before->RequestFocus();
  }

  void SetShown(bool shown) {
    if (native_shown_ == shown) return;
    native_shown_ = shown;
    owner_->SurfaceEvent(id_, base::DictValue().Set("type", "shown").Set("value", shown));
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
  std::optional<ext::PopupPlacement> placement_;
  std::optional<ext::PopupLimits> limits_;
  gfx::RoundedCornersF radii_;
  double radius_ = 0;
  int fade_ms_ = 0;
  bool wanted_ = false;
  bool settled_ = false;
  bool revealing_ = false;
  bool native_shown_ = false;
  bool deadline_passed_ = false;
  bool decoration_waived_ = false;
  int serial_ = 0;
  int decorated_ = 0;
  std::optional<base::DictValue> last_frame_;
  views::ViewTracker focus_before_;
  base::ScopedObservation<views::FocusManager, views::FocusChangeListener> focus_observation_{this};
  base::OneShotTimer settle_timer_;
  base::OneShotTimer deadline_timer_;
  base::OneShotTimer decoration_timer_;
  ShowPopupCallback shown_;
  bool closing_ = false;
  base::ScopedObservation<extensions::ExtensionRegistry, extensions::ExtensionRegistryObserver> registry_observation_{this};
  base::ScopedObservation<extensions::ExtensionHostRegistry, extensions::ExtensionHostRegistry::Observer>
      hosts_observation_{this};
  base::WeakPtrFactory<Surface> weak_factory_{this};
};

LinuxExtensionSurfaces::LinuxExtensionSurfaces(BrowserWindowInterface* browser, views::View* parent, Emit emit,
                                               ShellZoom zoom, ShellWindow shell_window)
    : browser_(browser),
      parent_(parent),
      emit_(std::move(emit)),
      zoom_(std::move(zoom)),
      shell_window_(std::move(shell_window)) {}

LinuxExtensionSurfaces::~LinuxExtensionSurfaces() {
  weak_factory_.InvalidateWeakPtrs();
  FailPending();
  CloseAll();
}

bool LinuxExtensionSurfaces::Handles(std::string_view method) {
  return method == "extensionView.create" || method == "extensionView.viewport" ||
         method == "extensionView.place" || method == "extensionView.command" || method == "extensionView.release";
}

void LinuxExtensionSurfaces::Invoke(const std::string& method, const base::DictValue& args, Profile* profile,
                                    uint64_t generation, double scale, Done done) {
  if (method == "extensionView.create") return Create(args, profile, generation, std::move(done));
  if (method == "extensionView.viewport") return Viewport(args, generation, scale, std::move(done));
  if (method == "extensionView.place") return Place(args, generation, std::move(done));
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
  const gfx::Rect bounds = gfx::ToEnclosedRect(gfx::RectF(left, top, right - left, bottom - top));
  surface->Place(bounds, args.FindBool("visible").value_or(false) && !bounds.IsEmpty(),
                 CornerRadii(args.FindDict("radii"), scale));
  std::move(done).Run(true, base::Value());
}

void LinuxExtensionSurfaces::Place(const base::DictValue& args, uint64_t generation, Done done) {
  Surface* surface = Owned(args, generation);
  if (!surface || surface->kind() != ext::SurfaceKind::kPopup) {
    return Fail(std::move(done), "ERR_EXTENSION_VIEW_STALE", "No such extension popup");
  }
  const base::DictValue* anchor = args.FindDict("anchor");
  const base::DictValue* room = args.FindDict("room");
  if (!anchor || !room) return Fail(std::move(done), "ERR_EXTENSION_VIEW_REQUEST", "A popup needs an anchor and a room");
  const ext::PopupPlacement placement{
      .anchor_right = anchor->FindDouble("right").value_or(NAN),
      .anchor_top = anchor->FindDouble("top").value_or(NAN),
      .room_left = room->FindDouble("left").value_or(NAN),
      .room_right = room->FindDouble("right").value_or(NAN),
      .room_bottom = room->FindDouble("bottom").value_or(NAN),
  };
  const double radius = args.FindDouble("radius").value_or(0);
  const int fade_ms = args.FindInt("fadeMs").value_or(0);
  if (!ext::PlacementIsFinite(placement) || !std::isfinite(radius) || radius < 0 || fade_ms < 0 || fade_ms > kMaxFadeMs) {
    return Fail(std::move(done), "ERR_EXTENSION_VIEW_REQUEST", "Popup placement must be finite");
  }
  const std::optional<int> decorated = args.FindInt("decorated");
  const std::optional<double> decorated_scale = args.FindDouble("decoratedScale");
  surface->Position(placement, std::min(radius, 64.0), fade_ms, args.FindBool("visible").value_or(false), decorated,
                    decorated_scale);
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

void LinuxExtensionSurfaces::Relayout() {
  for (const auto& [id, surface] : surfaces_) surface->Relayout();
}

void LinuxExtensionSurfaces::RaisePopups() {
  for (const auto& [id, surface] : surfaces_) {
    if (surface->kind() == ext::SurfaceKind::kPopup) surface->Raise();
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
