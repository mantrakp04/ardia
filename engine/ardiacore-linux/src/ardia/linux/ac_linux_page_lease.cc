#include "ardia/linux/ac_linux_page_lease.h"

#include <limits>
#include <utility>

#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"

namespace ardiacore {

LinuxPageMountAuthority::LinuxPageMountAuthority(
    BrowserWindowInterface* browser, base::WeakPtr<views::Widget> window,
    content::WebContents* contents,
    content::WebContents* shell, LinuxPageIdentity captured)
    : identity(std::move(captured)),
      browser_(browser ? browser->GetWeakPtr() : nullptr),
      profile_(browser ? browser->GetProfile()->GetWeakPtr() : nullptr),
      shell_profile_(shell ? Profile::FromBrowserContext(shell->GetBrowserContext())->GetWeakPtr()
                           : nullptr),
      contents_(contents ? contents->GetWeakPtr() : nullptr),
      shell_(shell ? shell->GetWeakPtr() : nullptr),
      shell_document_(shell && shell->GetPrimaryMainFrame()
                          ? shell->GetPrimaryMainFrame()->GetWeakDocumentPtr()
                          : content::WeakDocumentPtr()),
      window_(window), browser_window_(browser ? browser->GetWindow() : nullptr) {}

LinuxPageMountAuthority::~LinuxPageMountAuthority() { Invalidate(); }

bool LinuxPageMountAuthority::Valid() const {
  if (!active_ || !browser_ || !profile_ || !shell_profile_ || !contents_ || !shell_ || !window_ ||
      identity.native_id <= 0 || identity.key.empty() || identity.claim.empty() ||
      !identity.renderer_generation || !identity.binding_generation ||
      !identity.native_generation || !identity.handler_identity) return false;
  auto* shell_frame = shell_document_.AsRenderFrameHostIfValid();
  if (!shell_frame || shell_->GetPrimaryMainFrame() != shell_frame ||
      !shell_frame->IsRenderFrameLive()) return false;
  if (browser_->GetProfile() != profile_.get() ||
      browser_->GetWindow() != browser_window_ ||
      contents_->GetBrowserContext() != profile_.get() ||
      shell_->GetBrowserContext() != shell_profile_.get()) return false;
  auto* strip = browser_->GetTabStripModel();
  if (!strip) return false;
  if (strip->ContainsIndex(strip_index_) && strip->GetWebContentsAt(strip_index_) == contents_.get())
    return true;
  strip_index_ = strip->GetIndexOfWebContents(contents_.get());
  return strip_index_ >= 0;
}

void LinuxPageMountAuthority::Invalidate() {
  active_ = false;
  weak_factory_.InvalidateWeakPtrs();
}

base::WeakPtr<LinuxPageMountAuthority> LinuxPageMountAuthority::GetWeakPtr() {
  return weak_factory_.GetWeakPtr();
}

content::WebContents* LinuxPageMountAuthority::contents() const {
  return Valid() ? contents_.get() : nullptr;
}

bool LinuxPageLease::Provisional() const {
  return pending_at_mount_ || !provisional_navigations_.empty();
}

bool LinuxPageRequest::Valid() const { return lease && lease->Valid(*this); }

LinuxPageLease::LinuxPageLease(base::WeakPtr<LinuxPageMountAuthority> authority,
                             Sink sink, SnapshotRequest request_snapshot)
    : content::WebContentsObserver(authority ? authority->contents() : nullptr),
      authority_(authority), sink_(std::move(sink)),
      request_snapshot_(std::move(request_snapshot)) {
  if (web_contents() && web_contents()->GetPrimaryMainFrame())
    document_ = web_contents()->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  if (web_contents() && web_contents()->GetController().GetPendingEntry())
    pending_at_mount_ = true;
}

LinuxPageLease::~LinuxPageLease() { Reset(); }

base::WeakPtr<LinuxPageLease> LinuxPageLease::GetWeakPtr() {
  return weak_factory_.GetWeakPtr();
}

bool LinuxPageLease::Current() const {
  if (!sink_ || !authority_ || !authority_->Valid() || !web_contents()) return false;
  auto* frame = document_.AsRenderFrameHostIfValid();
  return frame &&
         authority_->contents() == web_contents() &&
         web_contents()->GetPrimaryMainFrame() == frame;
}

std::optional<LinuxPageRequest> LinuxPageLease::Capture() {
  if (Provisional()) return std::nullopt;
  return CapturePresentation();
}

std::optional<LinuxPageRequest> LinuxPageLease::CapturePresentation() {
  if (!Current()) return std::nullopt;
  return LinuxPageRequest{GetWeakPtr(), document_, document_epoch_, request_generation_};
}

bool LinuxPageLease::Valid(const LinuxPageRequest& request) const {
  return !Provisional() && ValidPresentation(request);
}

bool LinuxPageLease::ValidPresentation(const LinuxPageRequest& request) const {
  return Current() && request.lease.get() == this &&
         request.document_epoch == document_epoch_ &&
         request.request_generation == request_generation_ &&
         request.document.AsRenderFrameHostIfValid() ==
             document_.AsRenderFrameHostIfValid();
}

content::WebContents* LinuxPageLease::contents() const {
  return Current() && !Provisional() ? web_contents() : nullptr;
}

content::WebContents* LinuxPageLease::observed_contents() const {
  return authority_ ? authority_->contents() : nullptr;
}

content::WebContents* LinuxPageLease::presentation_contents() const {
  return Current() ? web_contents() : nullptr;
}

bool LinuxPageLease::Advance(uint64_t& value) {
  if (value == std::numeric_limits<uint64_t>::max()) { Reset(); return false; }
  ++value;
  return true;
}

std::optional<base::DictValue> LinuxPageLease::Envelope(std::string type) {
  if (!Current()) return std::nullopt;
  return Metadata(std::move(type));
}

std::optional<base::DictValue> LinuxPageLease::Metadata(std::string type) {
  if (!sink_ || !authority_) return std::nullopt;
  if (sequence_ >= 9007199254740991ULL) { Reset(); return std::nullopt; }
  const auto& identity = authority_->identity;
  return base::DictValue().Set("type", std::move(type))
      .Set("claim", identity.claim)
      .Set("rendererGeneration", std::to_string(identity.renderer_generation))
      .Set("bindingGeneration", std::to_string(identity.binding_generation))
      .Set("documentEpoch", std::to_string(document_epoch_))
      .Set("sequence", static_cast<double>(++sequence_));
}

void LinuxPageLease::Send(base::DictValue payload) {
  auto sink = sink_;
  auto id = std::to_string(authority_->identity.native_id);
  sink.Run("ArdiaWebView", std::move(id), std::move(payload));
}

bool LinuxPageLease::SendEvent(std::string name, base::Value data) {
  auto envelope = Envelope("pageEvent");
  if (!envelope) return false;
  envelope->Set("event", base::DictValue().Set("name", std::move(name)).Set("data", std::move(data)));
  Send(std::move(*envelope));
  return true;
}

bool LinuxPageLease::Emit(const LinuxPageRequest& request, std::string name,
                          base::Value data) {
  return Valid(request) && SendEvent(std::move(name), std::move(data));
}

bool LinuxPageLease::EmitPresentation(const LinuxPageRequest& request, std::string name,
                                      base::Value data) {
  return ValidPresentation(request) && SendEvent(std::move(name), std::move(data));
}

bool LinuxPageLease::EmitClosed() {
  auto envelope = Metadata("pageEvent");
  if (!envelope) return false;
  envelope->Set("event", base::DictValue().Set("name", "windowClose").Set("data", base::DictValue()));
  auto weak = GetWeakPtr();
  Send(std::move(*envelope));
  if (weak) Reset();
  return true;
}

bool LinuxPageLease::EmitSnapshot(const LinuxPageRequest& request, base::ListValue events,
                                  std::string reason) {
  if (!ValidPresentation(request)) return false;
  auto envelope = Envelope("pageLifecycle");
  if (!envelope) return false;
  envelope->Set("action", "snapshot");
  envelope->Set("reason", std::move(reason));
  envelope->Set("events", std::move(events));
  Send(std::move(*envelope));
  return true;
}

std::optional<base::DictValue> LinuxPageLease::CreationState(const LinuxPageRequest& request,
                                                         base::ListValue events) {
  if (!ValidPresentation(request)) return std::nullopt;
  auto lease = Envelope("pageLease");
  if (!lease) return std::nullopt;
  return base::DictValue().Set("lease", std::move(*lease))
      .Set("snapshot", base::DictValue().Set("watermark", static_cast<double>(sequence_))
           .Set("events", std::move(events)));
}

bool LinuxPageLease::EmitRebind(base::DictValue creation) {
  auto envelope = Metadata("pageLifecycle");
  if (!envelope) return false;
  envelope->Set("action", "rebind");
  envelope->Set("creation", std::move(creation));
  auto weak = GetWeakPtr();
  Send(std::move(*envelope));
  if (weak) Reset();
  return true;
}

void LinuxPageLease::Control(std::string reason) {
  auto envelope = Envelope("pageLifecycle");
  if (!envelope) return;
  envelope->Set("action", "reset");
  envelope->Set("reason", std::move(reason));
  Send(std::move(*envelope));
}

void LinuxPageLease::CancelDocumentWork() { Advance(request_generation_); }

void LinuxPageLease::Reset() {
  sink_.Reset();
  request_snapshot_.Reset();
  weak_factory_.InvalidateWeakPtrs();
  authority_.reset();
  Observe(nullptr);
}

void LinuxPageLease::PrimaryPageChanged(content::Page&) {
  if (!authority_ || !authority_->Valid() || !web_contents()) { Reset(); return; }
  if (!Advance(document_epoch_) || !Advance(request_generation_)) return;
  document_ = web_contents()->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  provisional_navigations_.clear();
  pending_at_mount_ = false;
  auto weak = GetWeakPtr();
  Control("document");
  if (!weak || !Current()) return;
  auto callback = request_snapshot_;
  auto request = Capture();
  if (callback && request) callback.Run(*request, "document");
}

void LinuxPageLease::DidStartNavigation(content::NavigationHandle* navigation) {
  if (!navigation->IsInPrimaryMainFrame() || navigation->IsSameDocument()) return;
  if (!Current() || !Advance(request_generation_)) return;
  provisional_navigations_.insert(navigation->GetNavigationId());
  Control("provisional");
}

void LinuxPageLease::DidFinishNavigation(content::NavigationHandle* navigation) {
  if (!navigation->IsInPrimaryMainFrame() || !Provisional() ||
      (navigation->HasCommitted() && !navigation->IsSameDocument())) return;
  if (!provisional_navigations_.erase(navigation->GetNavigationId())) {
    if (!pending_at_mount_) return;
    pending_at_mount_ = false;
  }
  if (Provisional()) return;
  if (!Advance(request_generation_) || !Current()) return;
  auto callback = request_snapshot_;
  auto request = Capture();
  if (callback && request) callback.Run(*request, "restore");
}

void LinuxPageLease::WebContentsDestroyed() { Reset(); }

}
