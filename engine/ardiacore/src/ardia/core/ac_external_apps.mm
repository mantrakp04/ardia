#include "ardia/core/ac_external_apps.h"

#import <AppKit/AppKit.h>

#include <map>
#include <optional>
#include <string>

#include "base/memory/weak_ptr.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/ardia/ac_external_apps.h"
#include "chrome/browser/external_protocol/external_protocol_handler.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/constants.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_launch_switches.h"
#import "ardia/core/ardiacore_internal.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "services/network/public/cpp/is_potentially_trustworthy.h"
#include "content/public/browser/render_frame_host.h"

namespace ardiacore {

namespace {

struct Pending {
  GURL url;
  base::WeakPtr<content::WebContents> contents;
  std::optional<url::Origin> origin;
  content::WeakDocumentPtr initiator;
  bool can_remember = false;
};

std::map<std::string, Pending>& PendingRequests() {
  static base::NoDestructor<std::map<std::string, Pending>> pending;
  return *pending;
}

NSURL* StandInAppForTests() {
  const std::optional<std::string> path = TestValue("externalProtocolApp");
  if (!path || !TestFlag("externalProtocolNoLaunch")) {
    return nil;
  }
  return [NSURL fileURLWithPath:base::SysUTF8ToNSString(*path)];
}

bool AskHost(const GURL& url,
             content::WebContents* contents,
             const std::optional<url::Origin>& initiating_origin,
             content::WeakDocumentPtr initiator_document,
             const std::u16string& program_name) {
  if (!WindowHost::ForContents(contents)) {
    return false;
  }
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if (![delegate respondsToSelector:@selector(tab:externalAppRequest:)]) {
    return false;
  }
  NSURL* ns_url = [NSURL URLWithString:base::SysUTF8ToNSString(url.spec())];
  NSURL* app = ns_url ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:ns_url]
                      : nil;
  if (!app) {
    app = StandInAppForTests();
  }
  const std::optional<ardia::ExternalApp> described =
      app ? std::optional<ardia::ExternalApp>(ardia::DescribeExternalApp(app))
          : std::nullopt;
  NSString* name = described ? described->name : nil;
  if (!name.length && !program_name.empty()) {
    name = base::SysUTF16ToNSString(program_name);
  }
  const bool has_origin = initiating_origin && !initiating_origin->opaque();
  NSString* origin =
      has_origin ? base::SysUTF8ToNSString(initiating_origin->Serialize()) : nil;
  NSString* scheme = base::SysUTF8ToNSString(std::string(url.scheme()));
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  const bool can_remember = app && has_origin && !profile->IsOffTheRecord() &&
                            network::IsOriginPotentiallyTrustworthy(*initiating_origin);

  static int last_id = 0;
  const std::string request_id = "x" + std::to_string(++last_id);
  if (app) {
    PendingRequests()[request_id] = {url, contents->GetWeakPtr(), initiating_origin,
                             initiator_document, can_remember};
  }
  NSString* title = app ? [NSString stringWithFormat:@"Open “%@”?", name]
                        : @"No application is set to open this link";
  NSString* message =
      app ? (origin ? [NSString stringWithFormat:@"%@ wants to open this application.",
                                                 origin]
                    : @"This page wants to open this application.")
          : [NSString stringWithFormat:@"Your Mac doesn’t have an app for “%@:” links.",
                                       scheme];
  NSString* remember =
      can_remember
          ? [NSString stringWithFormat:@"Always allow %@ to open links of this type in %@",
                                       origin, name]
          : nil;
  NSDictionary* request = @{
        @"id" : base::SysUTF8ToNSString(request_id),
        @"url" : base::SysUTF8ToNSString(url.spec()),
        @"scheme" : scheme,
        @"origin" : origin ?: NSNull.null,
        @"app" : app ? name : NSNull.null,
        @"appPath" : app.path ?: NSNull.null,
        @"icon" : (described ? described->icon : nil) ?: NSNull.null,
        @"title" : title,
        @"message" : message ?: NSNull.null,
        @"remember" : remember ?: NSNull.null,
  };
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents,
                        NSDictionary* request) {
                       if (!contents) {
                         return;
                       }
                       ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents.get())->tab();
                       id<ArdiaCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector(tab:externalAppRequest:)]) {
                         [delegate tab:tab externalAppRequest:request];
                       }
                     },
                     contents->GetWeakPtr(), request));
  return true;
}

}

namespace {

NSMutableArray<NSDictionary*>* TestLaunches() {
  static NSMutableArray<NSDictionary*>* launches = [NSMutableArray array];
  return launches;
}

}

void InstallExternalAppPrompts() {
  g_ardia_external_protocol_dialog = &AskHost;
}

void ResolveExternalApp(const std::string& request_id, bool open, bool remember) {
  auto it = PendingRequests().find(request_id);
  if (it == PendingRequests().end()) {
    return;
  }
  Pending pending = std::move(it->second);
  PendingRequests().erase(it);
  content::WebContents* contents = pending.contents.get();
  const bool asked_by_browser_or_extension =
      !pending.origin || pending.origin->scheme() == extensions::kExtensionScheme;
  const bool asking_page_gone =
      !asked_by_browser_or_extension && !pending.initiator.AsRenderFrameHostIfValid();
  if (!open || !contents || asking_page_gone) {
    return;
  }
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  const std::string scheme(pending.url.scheme());
  if (remember && pending.can_remember && pending.origin) {
    ExternalProtocolHandler::SetBlockState(scheme, *pending.origin,
                                           ExternalProtocolHandler::DONT_BLOCK, profile);
  }
  if (TestFlag("externalProtocolNoLaunch")) {
    const base::DictValue* allowed =
        pending.origin ? profile->GetPrefs()
                             ->GetDict(prefs::kProtocolHandlerPerOriginAllowedProtocols)
                             .FindDict(pending.origin->Serialize())
                       : nullptr;
    const bool remembered = allowed && allowed->FindBool(scheme).value_or(false);
    [TestLaunches() addObject:@{
      @"url" : base::SysUTF8ToNSString(pending.url.spec()),
      @"remembered" : @(remembered),
    }];
    return;
  }
  ExternalProtocolHandler::LaunchUrlWithoutSecurityCheck(pending.url, contents,
                                                         pending.initiator);
}

NSArray<NSDictionary*>* TestExternalLaunches() {
  return [TestLaunches() copy];
}

bool TestNoLaunch() {
  return TestFlag("externalProtocolNoLaunch");
}

void RecordTestLaunch(NSDictionary* launch) {
  [TestLaunches() addObject:launch];
}

}
