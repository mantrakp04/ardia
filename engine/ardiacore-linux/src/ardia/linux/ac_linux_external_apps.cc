#include <map>
#include <optional>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_page_prompt_policy.h"
#include "ardia/linux/ac_linux_page_prompts_internal.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/process/launch.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/external_protocol/external_protocol_handler.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "extensions/common/constants.h"
#include "url/gurl.h"
#include "url/origin.h"

extern bool (*g_ardia_external_protocol_dialog)(const GURL& url,
                                                content::WebContents* web_contents,
                                                const std::optional<url::Origin>& initiating_origin,
                                                content::WeakDocumentPtr initiator_document,
                                                const std::u16string& program_name);

namespace ardiacore::linux_page_prompts {
namespace {

struct Ask {
  GURL url;
  base::WeakPtr<content::WebContents> contents;
  std::optional<url::Origin> origin;
  content::WeakDocumentPtr initiator;
};

struct Pending {
  Ask ask;
  bool can_remember = false;
  uint64_t order = 0;
  base::DictValue request;
};

std::map<std::string, Pending>& PendingRequests() {
  static base::NoDestructor<std::map<std::string, Pending>> pending;
  return *pending;
}

bool InitiatorActive(const Ask& ask) {
  content::WebContents* contents = ask.contents.get();
  if (!contents) return false;
  if (!ask.origin || ask.origin->scheme() == extensions::kExtensionScheme) return true;
  content::RenderFrameHost* frame = ask.initiator.AsRenderFrameHostIfValid();
  return frame && frame->IsActive() && content::WebContents::FromRenderFrameHost(frame) == contents;
}

class ExternalAppWatch : public content::WebContentsObserver,
                         public content::WebContentsUserData<ExternalAppWatch> {
 public:
  ~ExternalAppWatch() override = default;

  void PrimaryPageChanged(content::Page&) override {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ExternalAppWatch::DropInactive, web_contents()->GetWeakPtr()));
  }

  static void DropInactive(base::WeakPtr<content::WebContents> contents) {
    if (!contents) return;
    bool dropped = false;
    auto& pending = PendingRequests();
    for (auto it = pending.begin(); it != pending.end();) {
      const bool mine = it->second.ask.contents.get() == contents.get();
      const bool drop = mine && !InitiatorActive(it->second.ask);
      dropped |= drop;
      it = drop ? pending.erase(it) : std::next(it);
    }
    if (dropped) PageEvent(contents.get(), "externalApp", base::Value());
  }

 private:
  friend class content::WebContentsUserData<ExternalAppWatch>;
  explicit ExternalAppWatch(content::WebContents* contents)
      : content::WebContentsObserver(contents), content::WebContentsUserData<ExternalAppWatch>(*contents) {}
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(ExternalAppWatch);

void DropStale(content::WebContents* contents) {
  auto& pending = PendingRequests();
  for (auto it = pending.begin(); it != pending.end();) {
    const bool stale = it->second.ask.contents.get() == contents || !InitiatorActive(it->second.ask);
    it = stale ? pending.erase(it) : std::next(it);
  }
  while (pending.size() >= kMaxPendingExternalApps) {
    auto oldest = pending.begin();
    for (auto it = pending.begin(); it != pending.end(); ++it) {
      if (it->second.order < oldest->second.order) oldest = it;
    }
    pending.erase(oldest);
  }
}

std::string DefaultHandlerName(const std::string& scheme) {
  std::string output;
  if (!base::GetAppOutput({"xdg-mime", "query", "default", "x-scheme-handler/" + scheme}, &output)) {
    return std::string();
  }
  std::string id(base::TrimWhitespaceASCII(output, base::TRIM_ALL));
  if (id.find('\n') != std::string::npos || id.size() > 255) return std::string();
  if (base::EndsWith(id, ".desktop")) id.resize(id.size() - 8);
  for (char c : id) {
    if (!base::IsAsciiAlphaNumeric(c) && c != '.' && c != '-' && c != '_') return std::string();
  }
  return id;
}

void Present(Ask ask, std::string app) {
  content::WebContents* contents = ask.contents.get();
  if (!contents || !TabFor(contents).window || !InitiatorActive(ask)) return;
  const bool has_origin = ask.origin && !ask.origin->opaque();
  const std::string origin = has_origin ? ask.origin->Serialize() : std::string();
  const std::string scheme(ask.url.scheme());
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  const bool can_remember =
      !app.empty() && has_origin && !profile->IsOffTheRecord() &&
      profile->GetPrefs()->GetBoolean(prefs::kExternalProtocolDialogShowAlwaysOpenCheckbox) &&
      ExternalProtocolHandler::MayRememberAllowDecisionsForThisOrigin(&*ask.origin);
  static int last_id = 0;
  static uint64_t order = 0;
  const std::string id = "x" + std::to_string(++last_id);
  const ExternalAppText text = DescribeExternalApp(app, origin, scheme, can_remember);
  base::DictValue request = base::DictValue()
      .Set("id", id)
      .Set("url", ask.url.spec())
      .Set("scheme", scheme)
      .Set("origin", has_origin ? base::Value(origin) : base::Value())
      .Set("app", app.empty() ? base::Value() : base::Value(app))
      .Set("appPath", base::Value())
      .Set("icon", base::Value())
      .Set("title", text.title)
      .Set("message", text.message)
      .Set("remember", text.remember.empty() ? base::Value() : base::Value(text.remember));
  DropStale(contents);
  if (!app.empty()) {
    ExternalAppWatch::CreateForWebContents(contents);
    PendingRequests()[id] = Pending{ask, can_remember, ++order, request.Clone()};
  }
  PageEvent(contents, "externalApp", base::Value(std::move(request)));
}

bool AskHost(const GURL& url, content::WebContents* contents, const std::optional<url::Origin>& initiating_origin,
             content::WeakDocumentPtr initiator_document, const std::u16string& program_name) {
  if (!contents || !TabFor(contents).window) return false;
  Ask ask{url, contents->GetWeakPtr(), initiating_origin, initiator_document};
  if (!InitiatorActive(ask)) return true;
  const std::string name = base::UTF16ToUTF8(program_name);
  if (KnownExternalApp(name)) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
                                                                base::BindOnce(&Present, std::move(ask), name));
    return true;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&DefaultHandlerName, std::string(url.scheme())),
      base::BindOnce(&Present, std::move(ask)));
  return true;
}

}

void InstallExternalAppPrompts() {
  g_ardia_external_protocol_dialog = &AskHost;
}

std::optional<base::DictValue> OpenExternalApp(content::WebContents* contents) {
  const Pending* latest = nullptr;
  for (const auto& [id, pending] : PendingRequests()) {
    if (pending.ask.contents.get() != contents || !InitiatorActive(pending.ask)) continue;
    if (!latest || pending.order > latest->order) latest = &pending;
  }
  if (!latest) return std::nullopt;
  return latest->request.Clone();
}

std::string ResolveExternalApp(int window, const base::DictValue& input) {
  const std::string* id = input.FindString("id");
  const std::optional<bool> open = input.FindBool("open");
  const std::optional<bool> remember = input.FindBool("remember");
  if (!id || !open || !remember || input.size() != 3 || !ValidPromptId(*id, 'x')) {
    return "permissions.resolveExternalApp requires {id, open, remember}";
  }
  auto it = PendingRequests().find(*id);
  if (it == PendingRequests().end()) return std::string();
  content::WebContents* contents = it->second.ask.contents.get();
  if (contents && TabFor(contents).window != window) return "The request belongs to another window";
  Pending pending = std::move(it->second);
  PendingRequests().erase(it);
  if (!*open || !contents || !InitiatorActive(pending.ask)) return std::string();
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  if (*remember && pending.can_remember && pending.ask.origin) {
    ExternalProtocolHandler::SetBlockState(std::string(pending.ask.url.scheme()), *pending.ask.origin,
                                           ExternalProtocolHandler::DONT_BLOCK, profile);
  }
  ExternalProtocolHandler::LaunchUrlWithoutSecurityCheck(pending.ask.url, contents, pending.ask.initiator);
  return std::string();
}

}
