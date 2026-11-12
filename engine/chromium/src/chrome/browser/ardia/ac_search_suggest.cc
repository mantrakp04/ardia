// Copyright 2026 Ardia. Apache-2.0.

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/load_flags.h"
#include "net/base/net_errors.h"
#include "net/cookies/site_for_cookies.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"

namespace ardia {
namespace {

constexpr size_t kMaxSuggestBytes = 256 * 1024;
constexpr size_t kMaxSuggestsInFlight = 8;
constexpr base::TimeDelta kSuggestTimeout = base::Seconds(10);

constexpr net::NetworkTrafficAnnotationTag kSuggestAnnotation =
    net::DefineNetworkTrafficAnnotation("ardia_search_suggest", R"(
      semantics {
        sender: "Ardia address bar"
        description:
          "Asks the user's search engine for query completions while the user "
          "types in the address bar or command bar, as Chrome's omnibox does."
        trigger: "The user types a query with search suggestions turned on."
        data: "The text typed so far, and the search engine's own cookies."
        destination: WEBSITE
      }
      policy {
        cookies_allowed: YES
        cookies_store: "user"
        setting: "Settings > Search > Search suggestions."
        policy_exception_justification: "Not implemented."
      })");

class SuggestState : public ProfileState {
 public:
  explicit SuggestState(Profile* profile) : ProfileState(profile) {}

  void Fetch(int id, const GURL& url, Reply reply) {
    Stop(id);
    while (pending_.size() >= kMaxSuggestsInFlight) {
      Stop(pending_.begin()->first);
    }
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = url;
    request->method = "GET";
    request->load_flags = net::LOAD_DO_NOT_SAVE_COOKIES;
    request->site_for_cookies = net::SiteForCookies::FromUrl(url);
    Pending& pending = pending_[id];
    pending.reply.emplace(std::move(reply));
    pending.loader =
        network::SimpleURLLoader::Create(std::move(request), kSuggestAnnotation);
    pending.loader->SetTimeoutDuration(kSuggestTimeout);
    pending.loader->DownloadToString(
        profile()
            ->GetDefaultStoragePartition()
            ->GetURLLoaderFactoryForBrowserProcess()
            .get(),
        base::BindOnce(&SuggestState::Loaded, base::Unretained(this), id),
        kMaxSuggestBytes);
  }

  void Stop(int id) {
    auto it = pending_.find(id);
    if (it == pending_.end()) {
      return;
    }
    Pending stopped = std::move(it->second);
    pending_.erase(it);
    stopped.loader.reset();
    stopped.reply->Send(base::DictValue().Set("stopped", true));
  }

 private:
  struct Pending {
    std::unique_ptr<network::SimpleURLLoader> loader;
    std::optional<Reply> reply;
  };

  void Release() override { pending_.clear(); }

  void Loaded(int id, std::optional<std::string> body) {
    auto it = pending_.find(id);
    if (it == pending_.end()) {
      return;
    }
    Pending done = std::move(it->second);
    pending_.erase(it);
    const network::mojom::URLResponseHead* head = done.loader->ResponseInfo();
    const int status =
        head && head->headers ? head->headers->response_code() : 0;
    const int net_error = done.loader->NetError();
    base::DictValue result;
    result.Set("status", status);
    if (net_error != net::OK) {
      result.Set("netError", net_error);
    }
    if (body && status == 200) {
      result.Set("body", std::move(*body));
    }
    done.reply->Send(std::move(result));
  }

  std::map<int, Pending> pending_;
};

}
}

AC_PROFILE_CALL(ac_search_suggest, ardia::OffTheRecord::kAllow) {
  const GURL url(call.String("url"));
  const int id = static_cast<int>(call.Double("id", -1));
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS()) {
    return call.TakeReply().Error("a suggestion URL must be http or https");
  }
  if (id < 0) {
    return call.TakeReply().Error("a suggestion request needs an id");
  }
  ardia::StateFor<ardia::SuggestState>(call.profile())
      .Fetch(id, url, call.TakeReply());
}

AC_PROFILE_CALL(ac_search_suggest_stop, ardia::OffTheRecord::kAllow) {
  ardia::StateFor<ardia::SuggestState>(call.profile())
      .Stop(static_cast<int>(call.Double("id", -1)));
  call.TakeReply().Ok();
}
