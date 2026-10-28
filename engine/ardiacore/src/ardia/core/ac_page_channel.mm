#include "ardia/core/ac_page_channel.h"

#import <Foundation/Foundation.h>

#include <algorithm>
#include <map>
#include <string_view>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/task/bind_post_task.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/media_session.h"
#include "content/public/browser/page.h"
#include "content/public/browser/permission_controller.h"
#include "content/public/browser/permission_descriptor_util.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/web_contents.h"
#include "ipc/ipc_channel_proxy.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "third_party/blink/public/mojom/frame/user_activation_notification_type.mojom.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_page_limits.h"
#import "ardia/core/ardiacore_internal.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/common/permissions/permission_utils.h"
#include "third_party/blink/public/mojom/permissions/permission_status.mojom.h"
#include "services/network/public/mojom/permissions_policy/permissions_policy_feature.mojom.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace ardiacore {

namespace {

std::string& Script() {
  static base::NoDestructor<std::string> script;
  return *script;
}

bool MayShowNotification(content::RenderFrameHost& frame) {
  return frame.GetBrowserContext()
             ->GetPermissionController()
             ->GetPermissionStatusForCurrentDocument(
                 content::PermissionDescriptorUtil::
                     CreatePermissionDescriptorForPermissionType(
                         blink::PermissionType::NOTIFICATIONS),
                 &frame) == blink::mojom::PermissionStatus::GRANTED;
}

bool MayRequestDisplayMedia(content::RenderFrameHost& frame) {
  return frame.IsFeatureEnabled(
             network::mojom::PermissionsPolicyFeature::kDisplayCapture) &&
         frame.HasTransientUserActivation();
}

mojo::AssociatedRemote<mojom::ACPage> PageOf(content::RenderFrameHost* frame) {
  mojo::AssociatedRemote<mojom::ACPage> page;
  if (frame && frame->IsRenderFrameLive()) {
    frame->GetRemoteAssociatedInterfaces()->GetInterface(&page);
  }
  return page;
}

class AppSchemeThrottle : public content::NavigationThrottle {
 public:
  explicit AppSchemeThrottle(content::NavigationThrottleRegistry& registry)
      : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillStartRequest() override { return Check(); }
  ThrottleCheckResult WillRedirectRequest() override { return Check(); }
  const char* GetNameForLogging() override { return "ACAppSchemeThrottle"; }

 private:
  ThrottleCheckResult Check() {
    content::NavigationHandle* navigation = navigation_handle();
    if (!IsAppURL(navigation->GetURL())) {
      return PROCEED;
    }
    content::WebContents* contents = navigation->GetWebContents();
    const std::optional<url::Origin>& initiator =
        navigation->GetInitiatorOrigin();
    content::NavigationEntry* committed =
        contents->GetController().GetLastCommittedEntry();
    const bool popup_start = !committed || committed->IsInitialEntry();
    if (navigation->IsInPrimaryMainFrame() && !popup_start &&
        !navigation->WasServerRedirect() && initiator &&
        IsWebUIURL(initiator->GetURL()) &&
        IsWebUIURL(contents->GetPrimaryMainFrame()->GetLastCommittedURL())) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(
                         [](base::WeakPtr<content::WebContents> contents, GURL url,
                            bool user_gesture) {
                           if (contents) {
                             ReportAppURLRequest(contents.get(), url, user_gesture);
                           }
                         },
                         contents->GetWeakPtr(), navigation->GetURL(),
                         navigation->HasUserGesture()));
    }
    return CANCEL_AND_IGNORE;
  }
};

}

bool IsAppURL(const GURL& url) {
  return url.SchemeIs("ardia");
}

bool IsWebUIURL(const GURL& url) {
  return url.SchemeIs("chrome") || url.SchemeIs("devtools");
}

void ReportAppURLRequest(content::WebContents* contents,
                         const GURL& url,
                         bool user_gesture) {
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didRequestAppURL:userGesture:)]) {
    [delegate tab:tab
        didRequestAppURL:base::SysUTF8ToNSString(url.spec())
             userGesture:user_gesture];
  }
}

void SetPageScript(const std::string& script) {
  Script() = script;
  for (auto it = content::RenderProcessHost::AllHostsIterator(); !it.IsAtEnd();
       it.Advance()) {
    content::RenderProcessHost* host = it.GetCurrentValue();
    if (host->IsInitializedAndNotDead()) {
      SendPageScript(host);
    }
  }
}

const std::string& GetPageScript() {
  return Script();
}

void SendPageScript(content::RenderProcessHost* host) {
  IPC::ChannelProxy* channel = host->GetChannel();
  if (!channel) {
    return;
  }
  mojo::AssociatedRemote<mojom::ACRendererConfig> config;
  channel->GetRemoteAssociatedInterface(&config);
  config->SetPageScript(Script());
}

void RegisterPageChannelBinders(content::RenderFrameHost& render_frame_host,
                                blink::AssociatedInterfaceRegistry& registry) {
  registry.AddInterface<mojom::ACPageHost>(base::BindRepeating(
      [](content::RenderFrameHost* frame,
         mojo::PendingAssociatedReceiver<mojom::ACPageHost> receiver) {
        content::WebContents* contents =
            content::WebContents::FromRenderFrameHost(frame);
        if (contents) {
          PageChannel::GetOrCreate(contents)->Bind(frame, std::move(receiver));
        }
      },
      &render_frame_host));
}

void AddAppSchemeThrottle(content::NavigationThrottleRegistry& registry) {
  registry.AddThrottle(std::make_unique<AppSchemeThrottle>(registry));
}

PageChannel::PageChannel(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<PageChannel>(*contents),
      receivers_(contents, this),
      main_document_at_(base::TimeTicks::Now()) {
  contents->ForEachRenderFrameHost(
      [&](content::RenderFrameHost* frame) { FrameDocumentChanged(frame); });
}

void PageChannel::MainDocumentChanged() {
  main_document_at_ = base::TimeTicks::Now();
}

void PageChannel::FrameDocumentChanged(content::RenderFrameHost* frame) {
  document_at_[frame->GetGlobalId()] = base::TimeTicks::Now();
}

bool PageChannel::FrameDocumentUnchangedSince(content::RenderFrameHost* frame,
                                              base::TimeTicks click) {
  if (!frame || !frame->IsRenderFrameLive() || !frame->GetPage().IsPrimary()) {
    return false;
  }
  auto it = document_at_.find(frame->GetGlobalId());
  if (it == document_at_.end() || it->second >= click) {
    return false;
  }
  const content::FrameTreeNodeId node = frame->GetFrameTreeNodeId();
  return std::ranges::none_of(commits_pending_, [&](const auto& pending) {
    return pending.second == node;
  });
}

bool PageChannel::MainDocumentUnchangedSince(base::TimeTicks click) {
  return main_document_at_ < click &&
         FrameDocumentUnchangedSince(GetWebContents().GetPrimaryMainFrame(),
                                     click);
}

void PageChannel::PrimaryMainFrameRenderProcessGone(
    base::TerminationStatus status) {
  MainDocumentChanged();
  main_page_.reset();
  held_.clear();
  held_bytes_ = 0;
}

void PageChannel::PrimaryPageChanged(content::Page& page) {
  MainDocumentChanged();
  main_page_.reset();
  held_.clear();
  held_bytes_ = 0;
  if (auto remote = PageOf(&page.GetMainDocument())) {
    remote->SetPageColor(page_color_);
  }
}

void PageChannel::ReadyToCommitNavigation(
    content::NavigationHandle* navigation) {
  content::RenderFrameHost* frame = navigation->GetRenderFrameHost();
  if (!navigation->IsSameDocument()) {
    commits_pending_[navigation->GetNavigationId()] =
        navigation->GetFrameTreeNodeId();
    if (frame) {
      FrameDocumentChanged(frame);
    }
    if (navigation->IsInPrimaryMainFrame()) {
      MainDocumentChanged();
    }
  }
  if (frame && !frame->GetParentOrOuterDocument()) {
    if (auto remote = PageOf(frame)) {
      remote->SetPageColor(page_color_);
    }
  }
}

void PageChannel::RenderFrameCreated(content::RenderFrameHost* frame) {
  FrameDocumentChanged(frame);
  if (frame->IsInPrimaryMainFrame()) {
    MainDocumentChanged();
  }
  if (!page_color_.empty() && !frame->GetParentOrOuterDocument()) {
    if (auto remote = PageOf(frame)) {
      remote->SetPageColor(page_color_);
    }
  }
}

void PageChannel::SetPageColor(const std::string& color) {
  const bool valid = !color.empty() && color.size() <= 16 &&
                     std::all_of(color.begin(), color.end(), [](char c) {
                       return c >= 'a' && c <= 'z';
                     });
  const std::string next = valid ? color : std::string();
  if (next == page_color_) {
    return;
  }
  page_color_ = next;
  GetWebContents().ForEachRenderFrameHost([&](content::RenderFrameHost* frame) {
    if (!frame->GetParentOrOuterDocument()) {
      if (auto remote = PageOf(frame)) {
        remote->SetPageColor(page_color_);
      }
    }
  });
}

PageChannel::~PageChannel() = default;

PageChannel* PageChannel::GetOrCreate(content::WebContents* contents) {
  CreateForWebContents(contents);
  return FromWebContents(contents);
}

std::string PageChannel::FrameId(content::RenderFrameHost* frame) {
  const content::GlobalRenderFrameHostId id = frame->GetGlobalId();
  return base::StrCat({base::NumberToString(id.child_id.GetUnsafeValue()), ":",
                       base::NumberToString(id.frame_routing_id)});
}

void PageChannel::Bind(content::RenderFrameHost* frame,
                       mojo::PendingAssociatedReceiver<mojom::ACPageHost> receiver) {
  receivers_.Bind(frame, std::move(receiver));
}

void PageChannel::Post(const std::string& kind, const std::string& json) {
  content::RenderFrameHost& frame = receivers_.CurrentTargetFrame();
  if (kind.size() > kMaxPageMessageKind ||
      json.size() > MaxPageMessageBytes(kind)) {
    return;
  }
  if (kind == "notification" && !MayShowNotification(frame)) {
    return;
  }
  if (kind == "displayMedia" && !MayRequestDisplayMedia(frame)) {
    return;
  }
  if (!Deliver(frame, kind, json)) {
    Hold(frame, kind, json);
  }
}

bool PageChannel::Deliver(content::RenderFrameHost& frame,
                          const std::string& kind,
                          const std::string& json) {
  const bool main = frame.IsInPrimaryMainFrame();
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(&GetWebContents())->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  NSString* ns_kind = base::SysUTF8ToNSString(kind);
  NSString* ns_json = base::SysUTF8ToNSString(json);
  if ([delegate respondsToSelector:@selector
                (tab:didReceivePageMessage:json:frame:main:origin:)]) {
    [delegate tab:tab
        didReceivePageMessage:ns_kind
                         json:ns_json
                        frame:base::SysUTF8ToNSString(FrameId(&frame))
                         main:main
                       origin:base::SysUTF8ToNSString(
                                  frame.GetLastCommittedOrigin().Serialize())];
    return true;
  }
  return false;
}

void PageChannel::RenderFrameDeleted(content::RenderFrameHost* frame) {
  document_at_.erase(frame->GetGlobalId());
  if (frame->IsInPrimaryMainFrame()) {
    MainDocumentChanged();
  }
  ForgetHeld(FrameId(frame));
}

void PageChannel::DidFinishNavigation(content::NavigationHandle* navigation) {
  commits_pending_.erase(navigation->GetNavigationId());
  if (!navigation->IsSameDocument() && navigation->HasCommitted()) {
    if (navigation->GetRenderFrameHost()) {
      FrameDocumentChanged(navigation->GetRenderFrameHost());
    }
    if (navigation->IsInPrimaryMainFrame()) {
      MainDocumentChanged();
    }
  }
  if (navigation->HasCommitted() && !navigation->IsSameDocument() &&
      navigation->GetRenderFrameHost()) {
    ForgetHeld(FrameId(navigation->GetRenderFrameHost()));
  }
}

mojom::ACPage* PageChannel::MainPage() {
  content::RenderFrameHost* frame = GetWebContents().GetPrimaryMainFrame();
  if (!frame->IsRenderFrameLive()) {
    return nullptr;
  }
  if (!main_page_.is_bound() || !main_page_.is_connected() ||
      main_page_frame_ != frame->GetGlobalId()) {
    main_page_.reset();
    frame->GetRemoteAssociatedInterfaces()->GetInterface(&main_page_);
    main_page_frame_ = frame->GetGlobalId();
  }
  return main_page_.get();
}

void PageChannel::CallPage(const std::string& kind, const std::string& json) {
  if (mojom::ACPage* page = MainPage()) {
    page->CallPage(kind, json);
  }
}

content::RenderFrameHost* PageChannel::FindFrame(const std::string& frame_id) {
  content::RenderFrameHost* target = nullptr;
  GetWebContents().GetPrimaryMainFrame()->ForEachRenderFrameHost(
      [&](content::RenderFrameHost* frame) {
        if (!target && FrameId(frame) == frame_id) {
          target = frame;
        }
      });
  return target;
}

void PageChannel::ExecuteInFrame(const std::string& frame_id,
                                 const std::string& code) {
  content::RenderFrameHost* target = FindFrame(frame_id);
  if (!target) {
    return;
  }
  if (target->IsInPrimaryMainFrame()) {
    Execute(code);
  } else if (auto page = PageOf(target)) {
    page->Execute(code);
  }
}

void PageChannel::GrantUserActivation(const std::string& frame_id) {
  content::RenderFrameHost* target =
      frame_id.empty() ? GetWebContents().GetPrimaryMainFrame()
                       : FindFrame(frame_id);
  if (target && target->IsRenderFrameLive()) {
    target->NotifyUserActivation(
        blink::mojom::UserActivationNotificationType::kInteraction);
  }
}

void PageChannel::CallFrame(const std::string& frame_id,
                            const std::string& kind,
                            const std::string& json) {
  content::RenderFrameHost* target = FindFrame(frame_id);
  if (!target) {
    return;
  }
  if (target->IsInPrimaryMainFrame()) {
    CallPage(kind, json);
  } else if (auto page = PageOf(target)) {
    page->CallPage(kind, json);
  }
}

void PageChannel::Execute(const std::string& code) {
  if (mojom::ACPage* page = MainPage()) {
    page->Execute(code);
  }
}

bool PageChannel::HasFrame(const std::string& frame_id) {
  content::RenderFrameHost* frame = FindFrame(frame_id);
  return frame && frame->IsRenderFrameLive();
}

PictureInPictureRoute PageChannel::EnterPictureInPictureForClick(
    std::optional<base::TimeTicks> click,
    base::OnceCallback<void(bool)> element_opened) {
  if (!click || !MainDocumentUnchangedSince(*click)) {
    return PictureInPictureRoute::kNone;
  }
  if (content::ArdiaMainFrameHandlesEnterPictureInPicture(&GetWebContents())) {
    content::MediaSession::Get(&GetWebContents())->EnterPictureInPicture();
    return PictureInPictureRoute::kMediaSession;
  }
  mojom::ACPage* page = MainPage();
  if (!page) {
    return PictureInPictureRoute::kNone;
  }
  auto opened = mojo::WrapCallbackWithDefaultInvokeIfNotRun(
      base::BindPostTaskToCurrentDefault(std::move(element_opened)), false);
  page->PictureInPictureDocument(base::BindOnce(
      &PageChannel::EnterPictureInPictureInDocument, weak_factory_.GetWeakPtr(),
      GetWebContents().GetPrimaryMainFrame()->GetGlobalId(), *click,
      std::move(opened)));
  return PictureInPictureRoute::kElement;
}

void PageChannel::EnterPictureInPictureInDocument(
    content::GlobalRenderFrameHostId frame,
    base::TimeTicks click,
    base::OnceCallback<void(bool)> opened,
    const std::optional<std::string>& document) {
  content::RenderFrameHost* main = GetWebContents().GetPrimaryMainFrame();
  mojom::ACPage* page = nullptr;
  if (document && main->GetGlobalId() == frame &&
      MainDocumentUnchangedSince(click)) {
    page = MainPage();
  }
  if (!page) {
    std::move(opened).Run(false);
    return;
  }
  page->EnterPictureInPictureForUser(*document, std::move(opened));
}

void PageChannel::Evaluate(
    const std::string& code,
    base::OnceCallback<void(const std::optional<std::string>&)> callback) {
  auto answer = mojo::WrapCallbackWithDefaultInvokeIfNotRun(
      base::BindPostTaskToCurrentDefault(std::move(callback)), std::nullopt);
  mojom::ACPage* page = MainPage();
  if (!page) {
    std::move(answer).Run(std::nullopt);
    return;
  }
  page->Evaluate(code, std::move(answer));
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PageChannel);

}
