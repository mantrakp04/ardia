#ifndef ARDIA_LINUX_AC_LINUX_PAGE_LEASE_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_LEASE_H_

#include <cstdint>
#include <optional>
#include <set>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents_observer.h"

class BrowserWindowInterface;
class Profile;
namespace ui { class BaseWindow; }
namespace views { class Widget; }

namespace ardiacore {

struct LinuxPageIdentity {
  int native_id = 0;
  std::string key;
  std::string claim;
  uint64_t renderer_generation = 0;
  uint64_t binding_generation = 0;
  uint64_t native_generation = 0;
  uint64_t handler_identity = 0;
};

class LinuxPageMountAuthority {
 public:
  LinuxPageMountAuthority(BrowserWindowInterface* browser,
                         base::WeakPtr<views::Widget> window,
                         content::WebContents* contents,
                         content::WebContents* shell,
                         LinuxPageIdentity identity);
  ~LinuxPageMountAuthority();
  bool Valid() const;
  void Invalidate();
  base::WeakPtr<LinuxPageMountAuthority> GetWeakPtr();
  content::WebContents* contents() const;
  const LinuxPageIdentity identity;

 private:
  base::WeakPtr<BrowserWindowInterface> browser_;
  base::WeakPtr<Profile> profile_;
  base::WeakPtr<Profile> shell_profile_;
  base::WeakPtr<content::WebContents> contents_;
  base::WeakPtr<content::WebContents> shell_;
  content::WeakDocumentPtr shell_document_;
  base::WeakPtr<views::Widget> window_;
  const ui::BaseWindow* browser_window_ = nullptr;
  mutable int strip_index_ = -1;
  bool active_ = true;
  base::WeakPtrFactory<LinuxPageMountAuthority> weak_factory_{this};
};

class LinuxPageLease;

struct LinuxPageRequest {
  base::WeakPtr<LinuxPageLease> lease;
  content::WeakDocumentPtr document;
  uint64_t document_epoch = 0;
  uint64_t request_generation = 0;
  bool Valid() const;
};

class LinuxPageLease : public content::WebContentsObserver {
 public:
  using Sink = base::RepeatingCallback<void(std::string, std::string, base::DictValue)>;
  using SnapshotRequest = base::RepeatingCallback<void(LinuxPageRequest, std::string)>;
  LinuxPageLease(base::WeakPtr<LinuxPageMountAuthority> authority, Sink sink,
                 SnapshotRequest request_snapshot);
  ~LinuxPageLease() override;
  base::WeakPtr<LinuxPageLease> GetWeakPtr();
  std::optional<LinuxPageRequest> Capture();
  std::optional<LinuxPageRequest> CapturePresentation();
  bool Valid(const LinuxPageRequest& request) const;
  content::WebContents* contents() const;
  content::WebContents* observed_contents() const;
  content::WebContents* presentation_contents() const;
  bool Emit(const LinuxPageRequest& request, std::string name, base::Value data);
  bool EmitPresentation(const LinuxPageRequest& request, std::string name, base::Value data);
  bool EmitClosed();
  bool EmitRebind(base::DictValue creation);
  bool EmitSnapshot(const LinuxPageRequest& request, base::ListValue events,
                    std::string reason);
  std::optional<base::DictValue> CreationState(const LinuxPageRequest& request,
                                             base::ListValue events);
  void CancelDocumentWork();
  void Reset();

 private:
  friend class LinuxPageLeaseTestPeer;
  bool Current() const;
  bool ValidPresentation(const LinuxPageRequest& request) const;
  bool Advance(uint64_t& value);
  std::optional<base::DictValue> Envelope(std::string type);
  std::optional<base::DictValue> Metadata(std::string type);
  bool SendEvent(std::string name, base::Value data);
  void Send(base::DictValue payload);
  void Control(std::string reason);
  void PrimaryPageChanged(content::Page& page) override;
  void DidStartNavigation(content::NavigationHandle* navigation) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void WebContentsDestroyed() override;
  base::WeakPtr<LinuxPageMountAuthority> authority_;
  content::WeakDocumentPtr document_;
  uint64_t document_epoch_ = 1;
  uint64_t request_generation_ = 1;
  uint64_t sequence_ = 0;
  bool Provisional() const;
  std::set<int64_t> provisional_navigations_;
  bool pending_at_mount_ = false;
  Sink sink_;
  SnapshotRequest request_snapshot_;
  base::WeakPtrFactory<LinuxPageLease> weak_factory_{this};
};

}

#endif
