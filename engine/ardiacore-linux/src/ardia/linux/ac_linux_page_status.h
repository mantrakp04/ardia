#ifndef ARDIA_LINUX_AC_LINUX_PAGE_STATUS_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_STATUS_H_

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_page_lease.h"
#include "base/process/kill.h"
#include "components/blocked_content/url_list_manager.h"
#include "url/gurl.h"

namespace blocked_content { class PopupBlockerTabHelper; }
namespace content { class RenderWidgetHost; }

namespace ardiacore {

std::string LinuxCrashReason(base::TerminationStatus status);
bool LinuxRendererGone(base::TerminationStatus status);

inline bool LinuxWindowFullScreen(bool widget, bool tab_fullscreen, bool caused_by_tab) {
  return widget && !(tab_fullscreen && caused_by_tab);
}

bool DeferLinuxHang(content::WebContents* contents, content::RenderWidgetHost* host,
                    base::RepeatingClosure restarter);
bool ResolveDeferredLinuxHang(content::WebContents* contents, content::RenderWidgetHost* host);
void ForgetDeferredLinuxHangs(content::WebContents* contents);
size_t DeferredLinuxHangs(content::WebContents* contents);

class LinuxPageStatus : public content::WebContentsObserver,
                        public blocked_content::UrlListManager::Observer {
 public:
  explicit LinuxPageStatus(base::WeakPtr<LinuxPageLease> lease);
  ~LinuxPageStatus() override;
  LinuxPageStatus(const LinuxPageStatus&) = delete;
  LinuxPageStatus& operator=(const LinuxPageStatus&) = delete;
  void AppendSnapshot(base::ListValue& events);
  bool TargetURL(const GURL& url);
  bool Unresponsive(content::RenderWidgetHost* host, base::RepeatingClosure restarter);
  bool Responsive(content::RenderWidgetHost* host);
  bool ResolveUnresponsive(const base::ListValue& args);
  bool OpenBlockedPopup(const base::ListValue& args);
  void Reset();

 private:
  struct BlockedPopup {
    GURL url;
    std::string origin;
    content::WeakDocumentPtr document;
  };
  void DidToggleFullscreenModeForTab(bool entered, bool will_cause_resize) override;
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus status) override;
  void WebContentsDestroyed() override;
  void BlockedUrlAdded(int32_t id, const GURL& url) override;
  content::WebContents* Live() const;
  bool CurrentDocument(const content::WeakDocumentPtr& document) const;
  bool Hung() const;
  bool Present(std::string name, base::Value data);
  void ReleaseHang(bool restart);
  void AdoptDeferredHangs();
  void DeferHangs();
  blocked_content::PopupBlockerTabHelper* Popups() const;
  const BlockedPopup* RememberBlocked(int32_t id, const GURL& url);
  void StopObservingPopups();
  base::WeakPtr<LinuxPageLease> lease_;
  bool observing_popups_ = false;
  std::map<int32_t, BlockedPopup> blocked_;
  std::string status_;
  content::WeakDocumentPtr status_document_;
  std::map<std::pair<int, int>, base::RepeatingClosure> hung_;
  base::WeakPtrFactory<LinuxPageStatus> weak_factory_{this};
};

}

#endif
