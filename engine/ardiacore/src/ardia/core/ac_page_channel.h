#ifndef ARDIA_CORE_AC_PAGE_CHANNEL_H_
#define ARDIA_CORE_AC_PAGE_CHANNEL_H_

#include <memory>
#include <map>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "content/public/browser/render_frame_host_receiver_set.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "content/public/browser/global_routing_id.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_receiver.h"
#include "content/public/browser/frame_tree_node_id.h"
#include "url/gurl.h"
#include "ardia/core/mojom/ardiacore.mojom.h"

namespace blink {
class AssociatedInterfaceRegistry;
}

namespace content {
class NavigationThrottleRegistry;
class RenderFrameHost;
class RenderProcessHost;
class WebContents;
}

namespace ardiacore {

void SetPageScript(const std::string& script);
const std::string& GetPageScript();
void SendPageScript(content::RenderProcessHost* host);

void RegisterPageChannelBinders(content::RenderFrameHost& render_frame_host,
                                blink::AssociatedInterfaceRegistry& registry);
void AddAppSchemeThrottle(content::NavigationThrottleRegistry& registry);
bool IsAppURL(const GURL& url);
bool IsWebUIURL(const GURL& url);
void ReportAppURLRequest(content::WebContents* contents,
                         const GURL& url,
                         bool user_gesture);

enum class PictureInPictureRoute { kNone, kMediaSession, kElement };

class PageChannel : public content::WebContentsObserver,
                    public content::WebContentsUserData<PageChannel>,
                    public mojom::ACPageHost {
 public:
  ~PageChannel() override;

  static PageChannel* GetOrCreate(content::WebContents* contents);

  void Bind(content::RenderFrameHost* frame,
            mojo::PendingAssociatedReceiver<mojom::ACPageHost> receiver);

  void CallPage(const std::string& kind, const std::string& json);
  void CallFrame(const std::string& frame_id,
                 const std::string& kind,
                 const std::string& json);
  void Execute(const std::string& code);
  void ExecuteInFrame(const std::string& frame_id, const std::string& code);
  void Evaluate(const std::string& code,
                base::OnceCallback<void(const std::optional<std::string>&)> callback);
  bool HasFrame(const std::string& frame_id);
  void GrantUserActivation(const std::string& frame_id);
  PictureInPictureRoute EnterPictureInPictureForClick(
      std::optional<base::TimeTicks> click,
      base::OnceCallback<void(bool)> element_opened);

  static std::string FrameId(content::RenderFrameHost* frame);

  void SetPageColor(const std::string& color);
  const std::string& page_color() const { return page_color_; }

  void Post(const std::string& kind, const std::string& json) override;

  void DeliverHeld();

  void PrimaryPageChanged(content::Page& page) override;
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override;
  void RenderFrameCreated(content::RenderFrameHost* frame) override;
  void RenderFrameDeleted(content::RenderFrameHost* frame) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void PrimaryMainFrameRenderProcessGone(
      base::TerminationStatus status) override;

 private:
  friend class content::WebContentsUserData<PageChannel>;
  explicit PageChannel(content::WebContents* contents);

  mojom::ACPage* MainPage();
  content::RenderFrameHost* FindFrame(const std::string& frame_id);
  bool Deliver(content::RenderFrameHost& frame,
               const std::string& kind,
               const std::string& json);
  void Hold(content::RenderFrameHost& frame,
            const std::string& kind,
            const std::string& json);
  void ForgetHeld(const std::string& frame_id);
  void MainDocumentChanged();
  void FrameDocumentChanged(content::RenderFrameHost* frame);
  bool MainDocumentUnchangedSince(base::TimeTicks click);
  bool FrameDocumentUnchangedSince(content::RenderFrameHost* frame,
                                   base::TimeTicks click);
  void EnterPictureInPictureInDocument(
      content::GlobalRenderFrameHostId frame,
      base::TimeTicks click,
      base::OnceCallback<void(bool)> opened,
      const std::optional<std::string>& document);

  struct Held {
    std::string frame_id;
    std::string kind;
    std::string json;
  };
  std::map<std::string, Held> held_;
  size_t held_bytes_ = 0;

  content::RenderFrameHostReceiverSet<mojom::ACPageHost> receivers_;
  mojo::AssociatedRemote<mojom::ACPage> main_page_;
  content::GlobalRenderFrameHostId main_page_frame_;
  std::string page_color_;
  base::TimeTicks main_document_at_;
  std::map<content::GlobalRenderFrameHostId, base::TimeTicks> document_at_;
  std::map<int64_t, content::FrameTreeNodeId> commits_pending_;
  base::WeakPtrFactory<PageChannel> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}

#endif
