#include "ardia/win/external_apps.h"

#include <map>
#include <optional>
#include <string>
#include <utility>

#include "ardia/win/hooks.h"
#include "ardia/win/tab_state.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/values.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace ardia_win {

namespace {

constexpr size_t kMostAsksPerPage = 8;

struct Pending {
  base::WeakPtr<content::WebContents> contents;
  content::WeakDocumentPtr initiator;
  bool asked_by_page = false;
  int sequence = 0;
};

std::map<std::string, Pending>& PendingAsks() {
  static base::NoDestructor<std::map<std::string, Pending>> pending;
  return *pending;
}

void SendAsk(base::WeakPtr<content::WebContents> contents,
             base::DictValue data) {
  TabState* state =
      contents ? TabState::FromWebContents(contents.get()) : nullptr;
  if (state) {
    state->Send("externalApp", std::move(data));
  }
}

bool AskApp(const GURL& url,
            content::WebContents* web_contents,
            bool has_user_gesture,
            const std::optional<url::Origin>& initiating_origin,
            content::WeakDocumentPtr initiator_document) {
  TabState* state =
      web_contents ? TabState::FromWebContents(web_contents) : nullptr;
  if (!state || state->key().empty()) {
    return false;
  }
  std::erase_if(PendingAsks(),
                [](const auto& entry) { return !entry.second.contents; });
  for (;;) {
    auto oldest = PendingAsks().end();
    size_t asks = 0;
    for (auto entry = PendingAsks().begin(); entry != PendingAsks().end();
         ++entry) {
      if (entry->second.contents.get() != web_contents) {
        continue;
      }
      ++asks;
      if (oldest == PendingAsks().end() ||
          entry->second.sequence < oldest->second.sequence) {
        oldest = entry;
      }
    }
    if (asks < kMostAsksPerPage) {
      break;
    }
    PendingAsks().erase(oldest);
  }
  static int last_id = 0;
  const int sequence = ++last_id;
  const std::string id = "x" + base::NumberToString(sequence);
  const bool has_origin = initiating_origin && !initiating_origin->opaque();
  PendingAsks()[id] = {
      web_contents->GetWeakPtr(), initiator_document,
      has_origin && initiating_origin->scheme() != "chrome-extension",
      sequence};
  base::DictValue data;
  data.Set("id", id);
  data.Set("url", url.spec());
  if (has_origin) {
    data.Set("origin", initiating_origin->Serialize());
  } else {
    data.Set("origin", base::Value());
  }
  data.Set("userGesture", has_user_gesture);
  data.Set("offTheRecord", web_contents->GetBrowserContext()->IsOffTheRecord());
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&SendAsk, web_contents->GetWeakPtr(), std::move(data)));
  return true;
}

}

void InstallExternalAppAsks() {
  g_ardia_win_external_protocol_dialog = &AskApp;
}

bool ExternalAppAlive(content::WebContents* contents, const std::string& id) {
  auto found = PendingAsks().find(id);
  if (found == PendingAsks().end()) {
    return false;
  }
  const Pending& pending = found->second;
  const bool alive =
      pending.contents && pending.contents.get() == contents &&
      (!pending.asked_by_page || pending.initiator.AsRenderFrameHostIfValid());
  if (alive || !pending.contents) {
    PendingAsks().erase(found);
  }
  return alive;
}

void ForgetExternalApp(content::WebContents* contents, const std::string& id) {
  auto found = PendingAsks().find(id);
  if (found != PendingAsks().end() &&
      (!found->second.contents || found->second.contents.get() == contents)) {
    PendingAsks().erase(found);
  }
}

}
