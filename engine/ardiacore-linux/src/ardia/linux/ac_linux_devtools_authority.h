#ifndef ARDIA_LINUX_AC_LINUX_DEVTOOLS_AUTHORITY_H_
#define ARDIA_LINUX_AC_LINUX_DEVTOOLS_AUTHORITY_H_

#include <cstdint>
#include <memory>
#include <optional>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"

namespace content {
class WebContents;
}

namespace ardiacore {

enum class LinuxDevToolsAction { kShow, kToggle, kInspect, kConsole, kAdopt };

class LinuxDevToolsLease {
 public:
  LinuxDevToolsLease(content::WebContents* contents,
                     base::RepeatingCallback<bool()> is_current);
  ~LinuxDevToolsLease();
  bool IsCurrent() const;
  bool Matches(content::WebContents* contents) const;
  void OnRevoke(base::OnceClosure callback);
  void Revoke();

 private:
  base::WeakPtr<content::WebContents> contents_;
  base::RepeatingCallback<bool()> is_current_;
  base::OnceClosure on_revoke_;
  bool revoked_ = false;
};

struct LinuxDevToolsTicket {
  uint64_t epoch = 0;
  std::shared_ptr<LinuxDevToolsLease> lease;
};

struct LinuxDevToolsCloseDecision {
  bool handled;
  bool proceed;
  std::optional<LinuxDevToolsTicket> retry;
};

class LinuxDevToolsState {
 public:
  void Begin(std::shared_ptr<LinuxDevToolsLease> lease, bool created);
  LinuxDevToolsTicket Capture() const;
  bool IsCurrent() const;
  bool IsCurrent(const LinuxDevToolsTicket& ticket) const;
  bool OwnsFrontend(uint64_t epoch) const;
  bool Quarantined() const;
  bool BeginClose();
  LinuxDevToolsCloseDecision FinishClose(bool proceed);
  bool managed() const { return managed_; }
  bool has_pending_close() const { return close_.has_value(); }

 private:
  LinuxDevToolsTicket current_;
  bool managed_ = false;
  bool owns_frontend_ = false;
  std::optional<LinuxDevToolsTicket> close_;
  std::optional<LinuxDevToolsTicket> retry_;
};

class ScopedLinuxDevToolsOperation {
 public:
  ScopedLinuxDevToolsOperation(content::WebContents* contents,
                               std::shared_ptr<LinuxDevToolsLease> lease);
  ~ScopedLinuxDevToolsOperation();
  ScopedLinuxDevToolsOperation(const ScopedLinuxDevToolsOperation&) = delete;
  ScopedLinuxDevToolsOperation& operator=(const ScopedLinuxDevToolsOperation&) =
      delete;
  static std::shared_ptr<LinuxDevToolsLease> Capture(
      content::WebContents* contents);

 private:
  content::WebContents* contents_;
  std::shared_ptr<LinuxDevToolsLease> lease_;
  ScopedLinuxDevToolsOperation* previous_;
  bool captured_ = false;
};

using LinuxDevToolsDispatcher = bool (*)(content::WebContents*,
                                         LinuxDevToolsAction,
                                         std::shared_ptr<LinuxDevToolsLease>,
                                         base::OnceClosure);
void InstallLinuxDevToolsDispatcher(LinuxDevToolsDispatcher dispatcher);
bool HasLinuxDevToolsDispatcher();
bool DispatchLinuxDevTools(content::WebContents* contents,
                           LinuxDevToolsAction action,
                           std::shared_ptr<LinuxDevToolsLease> lease,
                           base::OnceClosure ready);

}

#endif
