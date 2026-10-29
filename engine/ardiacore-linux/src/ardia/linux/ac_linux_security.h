#ifndef ARDIA_LINUX_AC_LINUX_SECURITY_H_
#define ARDIA_LINUX_AC_LINUX_SECURITY_H_

#include "ardia/linux/ac_linux_page_lease.h"

namespace ardiacore {

class LinuxSecurity : public content::WebContentsObserver {
 public:
  explicit LinuxSecurity(base::WeakPtr<LinuxPageLease> lease);
  ~LinuxSecurity() override;
  base::DictValue Snapshot() const;
  bool Emit();
  void Reset();

 private:
  void DidChangeVisibleSecurityState() override;
  void WebContentsDestroyed() override;
  base::WeakPtr<LinuxPageLease> lease_;
};

}

#endif
