#ifndef ARDIA_LINUX_AC_LINUX_PAGE_STATE_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_STATE_H_

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_history_zoom.h"
#include "ardia/linux/ac_linux_page_lease.h"
#include "ardia/linux/ac_linux_page_status.h"
#include "ardia/linux/ac_linux_security.h"
#include "ardia/linux/ac_linux_theme.h"

namespace ardiacore {

bool EmitLinuxPageEvent(const LinuxPageRequest& request, std::string name, base::Value data);

class LinuxPageState {
 public:
  using Navigation = base::RepeatingCallback<base::DictValue()>;
  using MessageSnapshot = base::RepeatingCallback<base::ListValue()>;
  static constexpr size_t kMessageSnapshotMax = 8;
  using SnapshotProducer =
      base::RepeatingCallback<std::vector<std::pair<std::string, base::Value>>()>;
  LinuxPageState(BrowserWindowInterface* browser, base::WeakPtr<views::Widget> window,
                 content::WebContents* contents, content::WebContents* shell,
                 LinuxPageIdentity identity, LinuxPageLease::Sink sink, Navigation navigation);
  ~LinuxPageState();
  LinuxPageState(const LinuxPageState&) = delete;
  LinuxPageState& operator=(const LinuxPageState&) = delete;
  const LinuxPageIdentity& identity() const { return authority_->identity; }
  std::optional<LinuxPageRequest> Capture();
  std::optional<base::DictValue> CreationState();
  bool EmitDocument(std::string name, base::Value data);
  bool EmitPresentation(std::string name, base::Value data);
  bool EmitNavigation();
  bool EmitClosed();
  bool EmitRebind(base::DictValue creation);
  base::Value SecurityInfo();
  bool GoToOffset(const base::ListValue& args);
  bool ZoomStep(const base::ListValue& args);
  void SetMessageSnapshot(MessageSnapshot snapshot);
  bool SetSampledTheme(std::optional<LinuxTheme::Sample> sample, content::WeakDocumentPtr document);
  LinuxPageStatus* status() const { return retired_ ? nullptr : status_.get(); }
  void SetSnapshotProducer(SnapshotProducer producer);
  void Retire();

 private:
  std::optional<base::DictValue> NavigationState();
  std::optional<base::ListValue> SnapshotEvents();
  void Snapshot(LinuxPageRequest request, std::string reason);
  Navigation navigation_;
  MessageSnapshot message_snapshot_;
  SnapshotProducer producer_;
  std::unique_ptr<LinuxPageMountAuthority> authority_;
  std::unique_ptr<LinuxPageLease> lease_;
  std::unique_ptr<LinuxSecurity> security_;
  std::unique_ptr<LinuxHistoryZoom> history_zoom_;
  std::unique_ptr<LinuxTheme> theme_;
  std::unique_ptr<LinuxPageStatus> status_;
  bool retired_ = false;
  base::WeakPtrFactory<LinuxPageState> weak_factory_{this};
};

}

#endif
