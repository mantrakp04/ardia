#include "ardia/linux/ac_linux_page_state.h"

#include <utility>

#include "base/functional/bind.h"
#include "third_party/blink/public/mojom/favicon/favicon_url.mojom.h"

namespace ardiacore {
namespace {

base::DictValue PageEvent(std::string name, base::Value data) {
  return base::DictValue().Set("name", std::move(name)).Set("data", std::move(data));
}

}

bool EmitLinuxPageEvent(const LinuxPageRequest& request, std::string name, base::Value data) {
  return request.lease && request.lease->Emit(request, std::move(name), std::move(data));
}

LinuxPageState::LinuxPageState(BrowserWindowInterface* browser,
                               base::WeakPtr<views::Widget> window,
                               content::WebContents* contents, content::WebContents* shell,
                               LinuxPageIdentity identity, LinuxPageLease::Sink sink,
                               Navigation navigation)
    : navigation_(std::move(navigation)),
      authority_(std::make_unique<LinuxPageMountAuthority>(browser, std::move(window), contents,
                                                           shell, std::move(identity))) {
  const auto weak = weak_factory_.GetWeakPtr();
  lease_ = std::make_unique<LinuxPageLease>(
      authority_->GetWeakPtr(), std::move(sink),
      base::BindRepeating([](base::WeakPtr<LinuxPageState> state, LinuxPageRequest request,
                             std::string reason) {
        if (state) state->Snapshot(std::move(request), std::move(reason));
      }, weak));
  security_ = std::make_unique<LinuxSecurity>(lease_->GetWeakPtr());
  history_zoom_ = std::make_unique<LinuxHistoryZoom>(lease_->GetWeakPtr());
  theme_ = std::make_unique<LinuxTheme>(
      lease_->GetWeakPtr(),
      base::BindRepeating([](base::WeakPtr<LinuxPageState> state) {
        return state && state->navigation_ ? state->navigation_.Run() : base::DictValue();
      }, weak));
  status_ = std::make_unique<LinuxPageStatus>(lease_->GetWeakPtr());
}

LinuxPageState::~LinuxPageState() { Retire(); }

void LinuxPageState::Retire() {
  if (retired_) return;
  retired_ = true;
  weak_factory_.InvalidateWeakPtrs();
  lease_->Reset();
  authority_->Invalidate();
  status_->Reset();
  theme_->Reset();
  history_zoom_->Reset();
  security_->Reset();
  navigation_.Reset();
  message_snapshot_.Reset();
  producer_.Reset();
}

void LinuxPageState::SetSnapshotProducer(SnapshotProducer producer) {
  if (!retired_) producer_ = std::move(producer);
}

std::optional<LinuxPageRequest> LinuxPageState::Capture() {
  return retired_ ? std::nullopt : lease_->Capture();
}

std::optional<base::DictValue> LinuxPageState::NavigationState() {
  if (retired_ || !navigation_) return std::nullopt;
  const auto weak = weak_factory_.GetWeakPtr();
  auto callback = navigation_;
  auto state = callback.Run();
  if (!weak || retired_) return std::nullopt;
  state.Merge(theme_->Snapshot());
  return state;
}

std::optional<base::ListValue> LinuxPageState::SnapshotEvents() {
  const auto weak = weak_factory_.GetWeakPtr();
  auto navigation = NavigationState();
  if (!navigation || !weak) return std::nullopt;
  auto events = base::ListValue()
      .Append(PageEvent("navigation", base::Value(std::move(*navigation))))
      .Append(PageEvent("security", base::Value(security_->Snapshot())));
  if (auto zoom = history_zoom_->Snapshot())
    events.Append(PageEvent("zoom", base::Value(std::move(*zoom))));
  if (auto* contents = lease_->contents(); contents && !contents->GetFaviconURLs().empty()) {
    const auto& candidates = contents->GetFaviconURLs();
    base::ListValue urls;
    for (const auto& candidate : candidates) urls.Append(candidate->icon_url.spec());
    events.Append(PageEvent("favicon", base::Value(base::DictValue()
        .Set("url", candidates.front()->icon_url.spec()).Set("urls", std::move(urls)))));
  }
  status_->AppendSnapshot(events);
  if (message_snapshot_) {
    auto callback = message_snapshot_;
    auto messages = callback.Run();
    if (!weak || retired_) return std::nullopt;
    size_t appended = 0;
    for (const auto& message : messages) {
      if (appended++ == kMessageSnapshotMax) break;
      events.Append(message.Clone());
    }
  }
  if (producer_) {
    auto producer = producer_;
    auto produced = producer.Run();
    if (!weak || retired_) return std::nullopt;
    for (auto& [name, data] : produced) {
      if (name.empty() || name.size() > 64 || events.size() >= 128) continue;
      events.Append(PageEvent(std::move(name), std::move(data)));
    }
  }
  return events;
}

void LinuxPageState::Snapshot(LinuxPageRequest request, std::string reason) {
  const auto weak = weak_factory_.GetWeakPtr();
  auto events = SnapshotEvents();
  if (!events || !weak || !request.lease) return;
  request.lease->EmitSnapshot(request, std::move(*events), std::move(reason));
}

std::optional<base::DictValue> LinuxPageState::CreationState() {
  if (retired_) return std::nullopt;
  const auto weak = weak_factory_.GetWeakPtr();
  auto request = lease_->CapturePresentation();
  if (!request) return std::nullopt;
  auto events = SnapshotEvents();
  if (!events || !weak || !request->lease) return std::nullopt;
  return request->lease->CreationState(*request, std::move(*events));
}

bool LinuxPageState::EmitDocument(std::string name, base::Value data) {
  auto request = Capture();
  return request && EmitLinuxPageEvent(*request, std::move(name), std::move(data));
}

bool LinuxPageState::EmitPresentation(std::string name, base::Value data) {
  if (retired_) return false;
  auto request = lease_->CapturePresentation();
  return request && request->lease &&
         request->lease->EmitPresentation(*request, std::move(name), std::move(data));
}

bool LinuxPageState::EmitNavigation() {
  if (retired_) return false;
  const auto weak = weak_factory_.GetWeakPtr();
  auto request = lease_->CapturePresentation();
  if (!request) return false;
  auto state = NavigationState();
  if (!state || !weak || !request->lease) return false;
  return request->lease->EmitPresentation(*request, "navigation", base::Value(std::move(*state)));
}

bool LinuxPageState::EmitClosed() {
  return !retired_ && lease_->EmitClosed();
}

bool LinuxPageState::EmitRebind(base::DictValue creation) {
  return !retired_ && lease_->EmitRebind(std::move(creation));
}

base::Value LinuxPageState::SecurityInfo() {
  auto request = Capture();
  if (!request) return base::Value();
  auto snapshot = security_->Snapshot();
  if (!request->Valid()) return base::Value();
  return base::Value(std::move(snapshot));
}

bool LinuxPageState::GoToOffset(const base::ListValue& args) {
  return !retired_ && history_zoom_->GoToOffset(args);
}

bool LinuxPageState::ZoomStep(const base::ListValue& args) {
  return !retired_ && history_zoom_->ZoomStep(args);
}

void LinuxPageState::SetMessageSnapshot(MessageSnapshot snapshot) {
  if (!retired_) message_snapshot_ = std::move(snapshot);
}

bool LinuxPageState::SetSampledTheme(std::optional<LinuxTheme::Sample> sample, content::WeakDocumentPtr document) {
  return !retired_ && theme_->SetSampled(std::move(sample), std::move(document));
}

}
