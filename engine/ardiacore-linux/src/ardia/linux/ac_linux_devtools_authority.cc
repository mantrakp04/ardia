#include "ardia/linux/ac_linux_devtools_authority.h"

#include <utility>

#include "content/public/browser/web_contents.h"

namespace ardiacore {
namespace {
ScopedLinuxDevToolsOperation* operation = nullptr;
LinuxDevToolsDispatcher dispatcher = nullptr;
}

LinuxDevToolsLease::LinuxDevToolsLease(
    content::WebContents* contents,
    base::RepeatingCallback<bool()> is_current)
    : contents_(contents->GetWeakPtr()), is_current_(std::move(is_current)) {}

LinuxDevToolsLease::~LinuxDevToolsLease() = default;

bool LinuxDevToolsLease::IsCurrent() const {
  auto contents = contents_;
  auto is_current = is_current_;
  return !revoked_ && contents && is_current && is_current.Run();
}

bool LinuxDevToolsLease::Matches(content::WebContents* contents) const {
  return contents_.get() == contents && IsCurrent();
}

void LinuxDevToolsLease::OnRevoke(base::OnceClosure callback) {
  if (!revoked_)
    on_revoke_ = std::move(callback);
}

void LinuxDevToolsLease::Revoke() {
  if (revoked_)
    return;
  revoked_ = true;
  is_current_.Reset();
  auto callback = std::move(on_revoke_);
  if (callback)
    std::move(callback).Run();
}

void LinuxDevToolsState::Begin(std::shared_ptr<LinuxDevToolsLease> lease,
                               bool created) {
  if (!lease && !managed_)
    return;
  managed_ = true;
  ++current_.epoch;
  current_.lease = std::move(lease);
  owns_frontend_ = current_.lease && (owns_frontend_ || created);
}

LinuxDevToolsTicket LinuxDevToolsState::Capture() const {
  return current_;
}

bool LinuxDevToolsState::IsCurrent() const {
  return !current_.lease || current_.lease->IsCurrent();
}

bool LinuxDevToolsState::IsCurrent(const LinuxDevToolsTicket& ticket) const {
  return ticket.epoch == current_.epoch && ticket.lease == current_.lease &&
         IsCurrent();
}

bool LinuxDevToolsState::OwnsFrontend(uint64_t epoch) const {
  return owns_frontend_ && current_.epoch == epoch;
}

bool LinuxDevToolsState::Quarantined() const {
  return owns_frontend_ && !IsCurrent();
}

bool LinuxDevToolsState::BeginClose() {
  if (!owns_frontend_ && !IsCurrent())
    Begin(nullptr, false);
  if (close_) {
    retry_ = Capture();
    return false;
  }
  close_ = Capture();
  return true;
}

LinuxDevToolsCloseDecision LinuxDevToolsState::FinishClose(bool proceed) {
  if (!close_)
    return {false, proceed, std::nullopt};
  auto closing = std::exchange(close_, std::nullopt);
  auto retry = std::exchange(retry_, std::nullopt);
  if (IsCurrent(*closing))
    return {managed_, proceed, std::nullopt};
  return {true, false, retry && IsCurrent(*retry) ? retry : std::nullopt};
}

ScopedLinuxDevToolsOperation::ScopedLinuxDevToolsOperation(
    content::WebContents* contents,
    std::shared_ptr<LinuxDevToolsLease> lease)
    : contents_(contents), lease_(std::move(lease)), previous_(operation) {
  operation = this;
}

ScopedLinuxDevToolsOperation::~ScopedLinuxDevToolsOperation() {
  operation = previous_;
}

std::shared_ptr<LinuxDevToolsLease> ScopedLinuxDevToolsOperation::Capture(
    content::WebContents* contents) {
  if (!operation || operation->contents_ != contents || operation->captured_)
    return nullptr;
  operation->captured_ = true;
  return operation->lease_;
}

void InstallLinuxDevToolsDispatcher(LinuxDevToolsDispatcher callback) {
  dispatcher = callback;
}

bool HasLinuxDevToolsDispatcher() {
  return dispatcher != nullptr;
}

bool DispatchLinuxDevTools(content::WebContents* contents,
                           LinuxDevToolsAction action,
                           std::shared_ptr<LinuxDevToolsLease> lease,
                           base::OnceClosure ready) {
  if (!dispatcher || !lease || !lease->Matches(contents))
    return false;
  return dispatcher(contents, action, std::move(lease), std::move(ready));
}

}
