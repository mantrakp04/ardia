#include "ardia/linux/ac_linux_page_channel.h"

#include <utility>

#include "ardia/linux/ac_linux_autoplay.h"
#include "ardia/linux/ac_linux_page_evaluation.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "crypto/sha2.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/input/web_mouse_event.h"
#include "ui/aura/client/drag_drop_client.h"
#include "ui/aura/client/drag_drop_delegate.h"
#include "ui/aura/window.h"
#include "ui/aura/window_observer.h"
#include "ui/base/dragdrop/drop_target_event.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace ardiacore {

namespace {

LinuxPageOptions& Options() {
  static base::NoDestructor<LinuxPageOptions> options;
  return *options;
}

}

class LinuxPageDropTrack : public aura::client::DragDropDelegate, public aura::WindowObserver {
 public:
  static base::WeakPtr<LinuxPageDropTrack> Install(aura::Window* window) {
    aura::client::DragDropDelegate* inner = window ? aura::client::GetDragDropDelegate(window) : nullptr;
    if (!inner) return nullptr;
    auto* track = new LinuxPageDropTrack(window, inner);
    aura::client::SetDragDropDelegate(window, track);
    return track->weak_factory_.GetWeakPtr();
  }
  LinuxPageDropTrack(const LinuxPageDropTrack&) = delete;
  LinuxPageDropTrack& operator=(const LinuxPageDropTrack&) = delete;
  aura::Window* window() const { return window_; }
  bool Over() const { return over_.Over(); }
  void ResetOver() { over_.Reset(); }
  void Remove() {
    if (aura::client::GetDragDropDelegate(window_) == this) aura::client::SetDragDropDelegate(window_, inner_);
    delete this;
  }

 private:
  LinuxPageDropTrack(aura::Window* window, aura::client::DragDropDelegate* inner) : window_(window), inner_(inner) {
    observation_.Observe(window);
  }
  ~LinuxPageDropTrack() override = default;
  void OnDragEntered(const ui::DropTargetEvent& event) override {
    over_.Entered();
    inner_->OnDragEntered(event);
  }
  aura::client::DragUpdateInfo OnDragUpdated(const ui::DropTargetEvent& event) override {
    over_.Entered();
    return inner_->OnDragUpdated(event);
  }
  void OnDragExited() override {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&LinuxPageDropTrack::Settle, weak_factory_.GetWeakPtr(), over_.Exited()));
    inner_->OnDragExited();
  }
  DropCallback GetDropCallback(const ui::DropTargetEvent& event) override { return inner_->GetDropCallback(event); }
  void OnWindowDestroying(aura::Window*) override { Remove(); }
  void Settle(uint64_t exit) { over_.Settle(exit); }

  raw_ptr<aura::Window> window_;
  raw_ptr<aura::client::DragDropDelegate> inner_;
  LinuxDragOver over_;
  base::ScopedObservation<aura::Window, aura::WindowObserver> observation_{this};
  base::WeakPtrFactory<LinuxPageDropTrack> weak_factory_{this};
};

namespace {

aura::client::DragDropClient* DragClientOf(content::WebContents& contents, aura::Window** root_out = nullptr) {
  aura::Window* view = contents.GetNativeView();
  aura::Window* root = view ? view->GetRootWindow() : nullptr;
  if (root_out) *root_out = root;
  return root ? aura::client::GetDragDropClient(root) : nullptr;
}

bool DragInProgress(content::WebContents& contents) {
  aura::client::DragDropClient* client = DragClientOf(contents);
  return client && client->IsDragDropInProgress();
}

LinuxLinkGestureGate& Gate() {
  static LinuxLinkGestureGate gate;
  return gate;
}

LinuxInputActivity& Activity() {
  static LinuxInputActivity activity;
  return activity;
}

base::RepeatingClosure& ActivityListener() {
  static base::NoDestructor<base::RepeatingClosure> listener;
  return *listener;
}

bool UserActivity(blink::WebInputEvent::Type type) {
  return blink::WebInputEvent::IsKeyboardEventType(type) || blink::WebInputEvent::IsMouseEventType(type) ||
         blink::WebInputEvent::IsTouchEventType(type) || type == blink::WebInputEvent::Type::kMouseWheel;
}

std::set<LinuxPageChannel*>& Channels() {
  static base::NoDestructor<std::set<LinuxPageChannel*>> channels;
  return *channels;
}

double Now() {
  return (base::TimeTicks::Now() - base::TimeTicks()).InSecondsF();
}

int LinkFlags(int modifiers) {
  int flags = 0;
  if (modifiers & blink::WebInputEvent::kAltKey) flags |= kLinuxLinkAlt;
  if (modifiers & blink::WebInputEvent::kShiftKey) flags |= kLinuxLinkShift;
  if (modifiers & blink::WebInputEvent::kControlKey) flags |= kLinuxLinkControl;
  if (modifiers & blink::WebInputEvent::kMetaKey) flags |= kLinuxLinkMeta;
  return flags;
}

bool Scriptable(content::RenderFrameHost* frame) {
  const GURL& url = frame->GetLastCommittedURL();
  return url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile();
}

std::string Json(const base::Value& value) {
  std::string json;
  base::JSONWriter::Write(value, &json);
  return json;
}

std::string Sha256(std::string_view text) {
  return base::HexEncodeLower(crypto::SHA256HashString(text));
}

std::optional<base::Value> ParseList(std::string_view json) {
  auto value = base::JSONReader::Read(json, base::JSON_PARSE_RFC, 4);
  if (!value || !value->is_list()) return std::nullopt;
  return value;
}

const char* Disposition(LinuxLinkOutcome outcome) {
  switch (outcome) {
    case LinuxLinkOutcome::kPeek: return "peek";
    case LinuxLinkOutcome::kSplit: return "split";
    case LinuxLinkOutcome::kWindow: return "window";
    case LinuxLinkOutcome::kBackground: return "background";
    case LinuxLinkOutcome::kNone:
    case LinuxLinkOutcome::kDownload: return nullptr;
  }
  return nullptr;
}

}

LinuxPageDocumentBudget::LinuxPageDocumentBudget(content::RenderFrameHost* frame)
    : content::DocumentUserData<LinuxPageDocumentBudget>(frame) {}

LinuxPageDocumentBudget::~LinuxPageDocumentBudget() = default;

DOCUMENT_USER_DATA_KEY_IMPL(LinuxPageDocumentBudget);

LinuxPageDocumentVideo::LinuxPageDocumentVideo(content::RenderFrameHost* frame)
    : content::DocumentUserData<LinuxPageDocumentVideo>(frame) {}

LinuxPageDocumentVideo::~LinuxPageDocumentVideo() = default;

DOCUMENT_USER_DATA_KEY_IMPL(LinuxPageDocumentVideo);

LinuxPageChannel::LinuxPageChannel(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<LinuxPageChannel>(*contents),
      receivers_(contents, this),
      surface_(reinterpret_cast<uintptr_t>(contents)) {
  Channels().insert(this);
  contents->ForEachRenderFrameHost([this](content::RenderFrameHost* frame) { Watch(frame->GetRenderWidgetHost()); });
}

LinuxPageChannel::~LinuxPageChannel() {
  Channels().erase(this);
  Gate().Forget(surface_);
  for (content::RenderWidgetHost* widget : widgets_) {
    widget->RemoveInputEventObserver(this);
    widget->RemoveObserver(this);
  }
}

LinuxPageChannel* LinuxPageChannel::GetOrCreate(content::WebContents* contents) {
  CreateForWebContents(contents);
  return FromWebContents(contents);
}

void LinuxPageChannel::Bind(content::RenderFrameHost* frame,
                            mojo::PendingAssociatedReceiver<ardia::linux_page::mojom::PageHost> receiver) {
  receivers_.Bind(frame, std::move(receiver));
}

void LinuxPageChannel::Attach(LinuxPageChannelHooks hooks) {
  hooks_ = std::move(hooks);
  ForgetDocument();
  PushOptions();
  FollowLinuxAutoplay(&GetWebContents(), base::BindRepeating(&LinuxPageChannel::RefreshPageConfig,
                                                             weak_factory_.GetWeakPtr()));
}

void LinuxPageChannel::RefreshPageConfig() {
  if (!hooks_) return;
  GetWebContents().ForEachRenderFrameHost([&](content::RenderFrameHost* frame) {
    if (frame->GetPage().IsPrimary()) Greet(*frame);
  });
}

void LinuxPageChannel::Detach() {
  hooks_.reset();
  ForgetDocument();
}

void LinuxPageChannel::ForgetDocument() {
  scroll_.reset();
  selection_ = base::Value();
  message_document_ = content::WeakDocumentPtr();
}

bool LinuxPageChannel::CurrentMainDocument(const content::WeakDocumentPtr& document) {
  content::RenderFrameHost* frame = document.AsRenderFrameHostIfValid();
  return frame && frame == GetWebContents().GetPrimaryMainFrame();
}

base::ListValue LinuxPageChannel::SnapshotEvents() {
  base::ListValue events;
  if (!hooks_ || !CurrentMainDocument(message_document_)) return events;
  auto event = [](const char* kind, base::Value data) {
    return base::DictValue().Set("name", "pageMessage").Set("data", base::DictValue().Set("kind", kind).Set("data", std::move(data)));
  };
  if (scroll_) events.Append(event("scroll", base::Value(base::DictValue().Set("state", *scroll_))));
  if (selection_.is_dict()) events.Append(event("selection", selection_.Clone()));
  return events;
}

void LinuxPageChannel::Call(content::RenderFrameHost* frame, const std::string& kind, const std::string& json) {
  if (!frame || !frame->IsRenderFrameLive() || !frame->IsActive() || !Scriptable(frame)) return;
  mojo::AssociatedRemote<ardia::linux_page::mojom::PageAgent> agent;
  frame->GetRemoteAssociatedInterfaces()->GetInterface(&agent);
  agent->Call(kind, json);
}

void LinuxPageChannel::Greet(content::RenderFrameHost& frame) {
  const bool block_autoplay =
      LinuxAutoplayBlocked(frame.GetOutermostMainFrame()->GetLastCommittedURL(), frame.GetBrowserContext());
  Call(&frame, "peekConfig", Json(base::Value(Options().PeekConfig())));
  Call(&frame, "config", Json(base::Value(Options().PageConfig(frame.IsInPrimaryMainFrame(), block_autoplay))));
}

void LinuxPageChannel::PushOptions() {
  if (!hooks_) return;
  const std::string peek = Json(base::Value(Options().PeekConfig()));
  const std::string popover = Options().selection_popover ? "true" : "false";
  GetWebContents().ForEachRenderFrameHost([&](content::RenderFrameHost* frame) {
    if (!frame->GetPage().IsPrimary()) return;
    Call(frame, "peekConfig", peek);
    if (frame->IsInPrimaryMainFrame()) Call(frame, "selectionPopover", popover);
  });
}

void LinuxPageChannel::Post(const std::string& kind, const std::string& json) {
  content::RenderFrameHost& frame = receivers_.CurrentTargetFrame();
  if (!LinuxPageMessageEnvelopeFits(kind, json)) return;
  const auto type = LinuxPageMessageKindOf(kind);
  if (!type || (!hooks_ && *type != LinuxPageMessageKind::kNowPlaying)) return;
  const LinuxPageSender sender{frame.IsInPrimaryMainFrame(), frame.GetPage().IsPrimary(),
                               frame.IsActive() && frame.IsRenderFrameLive() && Scriptable(&frame)};
  if (!LinuxPageSenderAccepted(*type, sender)) return;
  auto* budget = LinuxPageDocumentBudget::GetOrCreateForCurrentDocument(&frame);
  if (!(*type == LinuxPageMessageKind::kNowPlaying ? budget->now_playing : budget->budget).Admit(Now(), kind.size() + json.size()))
    return;
  std::optional<base::Value> value = json == "null"
      ? std::optional<base::Value>(base::Value())
      : base::JSONReader::Read(json, base::JSON_PARSE_RFC, kLinuxPageMessageDepthMax + 1);
  if (!value) return;
  auto message = NormalizeLinuxPageMessage(*type, *value);
  if (message) Accept(frame, std::move(*message));
}

void LinuxPageChannel::Accept(content::RenderFrameHost& frame, LinuxPageMessage message) {
  switch (message.kind) {
    case LinuxPageMessageKind::kHello:
    case LinuxPageMessageKind::kPeekHello:
      return Greet(frame);
    case LinuxPageMessageKind::kPeekGone:
      return;
    case LinuxPageMessageKind::kPeek:
      return Peek(frame, message.data.GetDict());
    case LinuxPageMessageKind::kScroll:
    case LinuxPageMessageKind::kSelection: {
      const bool scroll = message.kind == LinuxPageMessageKind::kScroll;
      if (!CurrentMainDocument(message_document_)) {
        scroll_.reset();
        selection_ = base::Value();
      }
      message_document_ = frame.GetWeakDocumentPtr();
      if (scroll) scroll_ = *message.data.GetDict().FindString("state");
      else selection_ = message.data.Clone();
      auto emit = hooks_->emit;
      emit.Run("pageMessage", base::Value(base::DictValue()
          .Set("kind", scroll ? "scroll" : "selection").Set("data", std::move(message.data))));
      return;
    }
    case LinuxPageMessageKind::kLinkDrop:
      return LinkDrop(*message.data.GetDict().FindString("url"));
    case LinuxPageMessageKind::kNowPlaying:
      return NoteVideo(frame, message.data);
    case LinuxPageMessageKind::kTheme: {
      std::optional<LinuxTheme::Sample> sample;
      if (const base::DictValue* dict = message.data.GetIfDict())
        sample = LinuxTheme::Sample(*dict->FindString("color"), *dict->FindString("source"));
      auto theme = hooks_->theme;
      theme.Run(std::move(sample), frame.GetWeakDocumentPtr());
      return;
    }
  }
}

void LinuxPageChannel::Peek(content::RenderFrameHost& frame, const base::DictValue& data) {
  const GURL url(*data.FindString("url"));
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS()) return;
  LinuxLinkRequest request;
  request.surface = surface_;
  request.key = *data.FindString("key");
  request.http = true;
  request.visible = hooks_->visible && hooks_->visible.Run();
  request.same_origin = url::Origin::Create(url).IsSameOriginWith(frame.GetLastCommittedOrigin());
  request.now = Now();
  if (!hooks_) return;
  const LinuxLinkDecision decision = Gate().Decide(request, Options());
  if (decision.outcome == LinuxLinkOutcome::kDownload) {
    return Call(&frame, "peekRefused", Json(base::Value(base::DictValue()
        .Set("url", url.spec()).Set("reason", decision.refused).Set("download", true))));
  }
  const char* disposition = Disposition(decision.outcome);
  if (!disposition) return;
  base::DictValue open = base::DictValue().Set("url", url.spec()).Set("disposition", disposition).Set("userGesture", true);
  if (decision.point && hooks_->shell_point) {
    if (auto point = hooks_->shell_point.Run(gfx::PointF(decision.point->x, decision.point->y)))
      open.Set("point", base::DictValue().Set("x", point->x()).Set("y", point->y()));
  }
  if (!hooks_) return;
  auto emit = hooks_->emit;
  emit.Run("openWindow", base::Value(std::move(open)));
}

base::CallbackListSubscription LinuxPageChannel::AddPageVideoListener(base::RepeatingClosure listener) {
  return page_video_listeners_.Add(std::move(listener));
}

void LinuxPageChannel::NoteVideo(content::RenderFrameHost& frame, const base::Value& data) {
  const base::DictValue* dict = data.GetIfDict();
  const bool has_video = dict && dict->FindBool("hasVideo").value_or(false);
  const bool playing = has_video && dict->FindBool("playing").value_or(false);
  auto* video = LinuxPageDocumentVideo::GetOrCreateForCurrentDocument(&frame);
  if (video->has_video == has_video && video->playing == playing) return;
  video->has_video = has_video;
  video->playing = playing;
  page_video_listeners_.Notify();
}

void LinuxPageChannel::LinkDrop(const std::string& spec) {
  const GURL url(spec);
  if (!hooks_ || !url.is_valid() || !url.SchemeIsHTTPOrHTTPS()) return;
  const bool visible = hooks_->visible && hooks_->visible.Run();
  if (!hooks_ || !Gate().AcceptLinkDrop(surface_, visible, Now()).empty()) return;
  auto emit = hooks_->emit;
  emit.Run("openWindow", base::Value(base::DictValue()
      .Set("url", url.spec()).Set("disposition", "foreground").Set("userGesture", true)));
}

void LinuxPageChannel::Watch(content::RenderWidgetHost* widget) {
  if (!widget || !widgets_.insert(widget).second) return;
  widget->AddInputEventObserver(this);
  widget->AddObserver(this);
}

void LinuxPageChannel::RenderFrameCreated(content::RenderFrameHost* frame) {
  Watch(frame->GetRenderWidgetHost());
}

void LinuxPageChannel::RenderFrameHostChanged(content::RenderFrameHost* old_host, content::RenderFrameHost* new_host) {
  if (new_host) Watch(new_host->GetRenderWidgetHost());
}

void LinuxPageChannel::PrimaryPageChanged(content::Page& page) {
  ForgetDocument();
  Watch(page.GetMainDocument().GetRenderWidgetHost());
  if (!hooks_) return;
  const auto weak = weak_factory_.GetWeakPtr();
  page.GetMainDocument().ForEachRenderFrameHost([&](content::RenderFrameHost* frame) {
    if (weak && hooks_ && frame->GetPage().IsPrimary()) Greet(*frame);
  });
}

void LinuxPageChannel::WebContentsDestroyed() {
  if (drop_track_) drop_track_->Remove();
  hooks_.reset();
  ForgetDocument();
  Gate().Forget(surface_);
}

void LinuxPageChannel::OnInputEvent(const content::RenderWidgetHost& widget, const blink::WebInputEvent& event,
                                    input::InputEventSource source) {
  const auto type = event.GetType();
  if (UserActivity(type) && Activity().Note(Now()) && ActivityListener())
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, ActivityListener());
  if (type != blink::WebInputEvent::Type::kMouseDown && type != blink::WebInputEvent::Type::kMouseUp) return;
  const auto& mouse = static_cast<const blink::WebMouseEvent&>(event);
  if (mouse.button != blink::WebPointerProperties::Button::kLeft) return;
  if (type == blink::WebInputEvent::Type::kMouseDown) {
    TrackDrops();
    return Gate().NotePress(surface_);
  }
  std::optional<LinuxLinkPoint> point;
  content::RenderFrameHost* main = GetWebContents().GetPrimaryMainFrame();
  if (main && main->GetRenderWidgetHost() == &widget)
    point = LinuxLinkPoint{mouse.PositionInWidget().x(), mouse.PositionInWidget().y()};
  Gate().NoteRelease(surface_, LinkFlags(mouse.GetModifiers()), Now(), point, DragInProgress(GetWebContents()));
}

void LinuxPageChannel::TrackDrops() {
  content::RenderWidgetHostView* view = GetWebContents().GetRenderWidgetHostView();
  aura::Window* window = view ? view->GetNativeView() : nullptr;
  if (!window) return;
  if (drop_track_ && drop_track_->window() == window) return drop_track_->ResetOver();
  drop_track_ = LinuxPageDropTrack::Install(window);
}

bool LinuxPageChannel::DropOver() const {
  return drop_track_ && drop_track_->Over();
}

void LinuxPageChannel::RenderWidgetHostDestroyed(content::RenderWidgetHost* widget) {
  widget->RemoveInputEventObserver(this);
  widget->RemoveObserver(this);
  widgets_.erase(widget);
}

void BindLinuxPageHost(content::RenderFrameHost* frame,
                       mojo::PendingAssociatedReceiver<ardia::linux_page::mojom::PageHost> receiver) {
  content::WebContents* contents = content::WebContents::FromRenderFrameHost(frame);
  if (contents) LinuxPageChannel::GetOrCreate(contents)->Bind(frame, std::move(receiver));
}

void RegisterLinuxPageHostBinder(content::RenderFrameHost& frame, blink::AssociatedInterfaceRegistry& registry) {
  registry.AddInterface<ardia::linux_page::mojom::PageHost>(base::BindRepeating(&BindLinuxPageHost, &frame));
}

void WatchLinuxShellInput(content::WebContents* shell) {
  if (shell) LinuxPageChannel::GetOrCreate(shell);
}

void SetLinuxInputActivityListener(base::RepeatingClosure listener) {
  ActivityListener() = std::move(listener);
}

void NoteLinuxDragEnded(base::FunctionRef<bool(content::WebContents*)> in_window) {
  const uintptr_t source = Gate().DragSource();
  if (!source) return;
  for (LinuxPageChannel* channel : Channels()) {
    if (channel->surface_ != source) continue;
    if (!in_window(&channel->GetWebContents())) return;
    Gate().NoteDrop(channel->DropOver() ? source : 0);
    return Gate().NoteDragEnded(source, Now());
  }
}

bool SetLinuxPageOption(const std::string& route, const base::DictValue& input, std::string* error) {
  bool changed = false;
  if (route == "webView.setSelectionPopover") {
    const auto enabled = input.FindBool("enabled");
    if (!enabled) return *error = "A boolean selection popover setting is required", false;
    changed = Options().selection_popover != *enabled;
    Options().selection_popover = *enabled;
  } else {
    const std::string* modifier = input.FindString("modifier");
    if (!modifier || modifier->size() > 16) return *error = "A link modifier is required", false;
    if (route == "webView.setPeekModifier") changed = Options().SetPeek(*modifier);
    else if (route == "webView.setSplitLinkModifier") changed = Options().SetSplit(*modifier);
    else return *error = "Unknown page option", false;
  }
  if (changed) {
    for (LinuxPageChannel* channel : std::set<LinuxPageChannel*>(Channels())) {
      if (Channels().contains(channel)) channel->PushOptions();
    }
  }
  return true;
}

void RunLinuxPageEvaluation(content::RenderFrameHost* frame, const std::string& code,
                            base::OnceCallback<void(bool refused, std::optional<std::string> result)> done) {
  auto script = LinuxPageEvaluationScript(code, &Sha256, &ParseList);
  if (!script) return std::move(done).Run(true, std::nullopt);
  if (!frame || !frame->IsRenderFrameLive() || !frame->IsActive() || !Scriptable(frame))
    return std::move(done).Run(false, std::nullopt);
  frame->ExecuteJavaScriptInIsolatedWorld(
      base::UTF8ToUTF16(*script),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          base::BindOnce([](base::OnceCallback<void(bool, std::optional<std::string>)> done, base::Value value) {
            std::move(done).Run(false, LinuxPageEvaluationResult(value));
          }, std::move(done)),
          base::Value()),
      ISOLATED_WORLD_ID_ARDIA_PAGE);
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(LinuxPageChannel);

}
