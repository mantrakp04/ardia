#ifndef ARDIA_LINUX_AC_LINUX_PAGE_CHANNEL_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_CHANNEL_H_

#include <optional>
#include <set>
#include <string>

#include "ardia/linux/ac_linux_link_gesture.h"
#include "ardia/linux/ac_linux_page_messages.h"
#include "ardia/linux/ac_linux_theme.h"
#include "ardia/linux/mojom/page.mojom.h"
#include "base/callback_list.h"
#include "base/functional/callback.h"
#include "base/functional/function_ref.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "content/public/browser/render_frame_host_receiver_set.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_observer.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/document_user_data.h"
#include "content/public/browser/web_contents_user_data.h"
#include "content/public/browser/weak_document_ptr.h"
#include "ui/gfx/geometry/point_f.h"

namespace blink {
class AssociatedInterfaceRegistry;
}

namespace ardiacore {

class LinuxPageDropTrack;

class LinuxPageDocumentBudget : public content::DocumentUserData<LinuxPageDocumentBudget> {
 public:
  ~LinuxPageDocumentBudget() override;
  LinuxPageMessageBudget budget;
  LinuxPageMessageBudget now_playing;

 private:
  explicit LinuxPageDocumentBudget(content::RenderFrameHost* frame);
  friend class content::DocumentUserData<LinuxPageDocumentBudget>;
  DOCUMENT_USER_DATA_KEY_DECL();
};

class LinuxPageDocumentVideo : public content::DocumentUserData<LinuxPageDocumentVideo> {
 public:
  ~LinuxPageDocumentVideo() override;
  bool has_video = false;
  bool playing = false;

 private:
  explicit LinuxPageDocumentVideo(content::RenderFrameHost* frame);
  friend class content::DocumentUserData<LinuxPageDocumentVideo>;
  DOCUMENT_USER_DATA_KEY_DECL();
};

struct LinuxPageChannelHooks {
  base::RepeatingCallback<bool()> visible;
  base::RepeatingCallback<bool(std::string name, base::Value data)> emit;
  base::RepeatingCallback<bool(std::optional<LinuxTheme::Sample> sample, content::WeakDocumentPtr document)> theme;
  base::RepeatingCallback<std::optional<gfx::PointF>(gfx::PointF page_point)> shell_point;
};

class LinuxPageChannel : public content::WebContentsObserver,
                         public content::WebContentsUserData<LinuxPageChannel>,
                         public content::RenderWidgetHost::InputEventObserver,
                         public content::RenderWidgetHostObserver,
                         public ardia::linux_page::mojom::PageHost {
 public:
  ~LinuxPageChannel() override;
  static LinuxPageChannel* GetOrCreate(content::WebContents* contents);
  void Attach(LinuxPageChannelHooks hooks);
  void Detach();
  base::ListValue SnapshotEvents();
  void PushOptions();
  void RefreshPageConfig();
  void Post(const std::string& kind, const std::string& json) override;
  base::CallbackListSubscription AddPageVideoListener(base::RepeatingClosure listener);
  void Bind(content::RenderFrameHost* frame,
            mojo::PendingAssociatedReceiver<ardia::linux_page::mojom::PageHost> receiver);

 private:
  friend class content::WebContentsUserData<LinuxPageChannel>;
  explicit LinuxPageChannel(content::WebContents* contents);
  void Accept(content::RenderFrameHost& frame, LinuxPageMessage message);
  void Peek(content::RenderFrameHost& frame, const base::DictValue& data);
  void LinkDrop(const std::string& spec);
  void NoteVideo(content::RenderFrameHost& frame, const base::Value& data);
  friend void NoteLinuxDragEnded(base::FunctionRef<bool(content::WebContents*)> in_window);
  void Call(content::RenderFrameHost* frame, const std::string& kind, const std::string& json);
  void Greet(content::RenderFrameHost& frame);
  void Watch(content::RenderWidgetHost* widget);
  void TrackDrops();
  bool DropOver() const;
  void ForgetDocument();
  bool CurrentMainDocument(const content::WeakDocumentPtr& document);
  void RenderFrameCreated(content::RenderFrameHost* frame) override;
  void RenderFrameHostChanged(content::RenderFrameHost* old_host, content::RenderFrameHost* new_host) override;
  void PrimaryPageChanged(content::Page& page) override;
  void WebContentsDestroyed() override;
  void OnInputEvent(const content::RenderWidgetHost& widget, const blink::WebInputEvent& event,
                    input::InputEventSource source) override;
  void RenderWidgetHostDestroyed(content::RenderWidgetHost* widget) override;

  content::RenderFrameHostReceiverSet<ardia::linux_page::mojom::PageHost> receivers_;
  std::optional<LinuxPageChannelHooks> hooks_;
  const uintptr_t surface_;
  std::set<content::RenderWidgetHost*> widgets_;
  std::optional<std::string> scroll_;
  base::Value selection_;
  content::WeakDocumentPtr message_document_;
  base::WeakPtr<LinuxPageDropTrack> drop_track_;
  base::RepeatingClosureList page_video_listeners_;
  base::WeakPtrFactory<LinuxPageChannel> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

void BindLinuxPageHost(content::RenderFrameHost* frame,
                       mojo::PendingAssociatedReceiver<ardia::linux_page::mojom::PageHost> receiver);
void RegisterLinuxPageHostBinder(content::RenderFrameHost& frame, blink::AssociatedInterfaceRegistry& registry);
void WatchLinuxShellInput(content::WebContents* shell);
void SetLinuxInputActivityListener(base::RepeatingClosure listener);
void NoteLinuxDragEnded(base::FunctionRef<bool(content::WebContents*)> in_window);
bool SetLinuxPageOption(const std::string& route, const base::DictValue& input, std::string* error);
void RunLinuxPageEvaluation(content::RenderFrameHost* frame, const std::string& code,
                            base::OnceCallback<void(bool refused, std::optional<std::string> result)> done);

}

#endif
