#include "ardia/linux/ac_linux_suggest.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_suggest_policy.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/load_flags.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/fetch_api.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace ardia::linux_suggest {
namespace {

namespace policy = ardia::linux_suggest_policy;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("ardia_linux_search_suggestions", R"(
      semantics {
        sender: "Ardia command bar"
        description:
          "Asks the default search engine for query completions while the "
          "user types in the Ardia command bar."
        trigger: "Typing a search in the command bar with search suggestions on."
        user_data {
          type: USER_CONTENT
        }
        data: "The typed text. No cookies or credentials are sent."
        destination: OTHER
        destination_other: "The built-in search engine the user chose."
        internal {
          contacts { owners: "//ardia/linux/OWNERS" }
        }
        last_reviewed: "2026-10-27"
      }
      policy {
        cookies_allowed: NO
        setting: "Settings > Search Engine > Search suggestions."
        policy_exception_justification: "Not implemented."
      })");

std::map<base::FilePath, policy::SuggestionsSetting>& Settings() {
  static base::NoDestructor<std::map<base::FilePath, policy::SuggestionsSetting>> settings;
  return *settings;
}

void PostReply(SuggestionReply reply, std::optional<std::string> body) {
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(reply), std::move(body)));
}

}

class SuggestionFetch : public ProfileObserver {
 public:
  SuggestionFetch(SuggestionClient* owner, std::string id, Profile* profile,
                  SuggestionReply reply)
      : owner_(owner), id_(std::move(id)), reply_(std::move(reply)) {
    observation_.Observe(profile);
  }
  SuggestionFetch(const SuggestionFetch&) = delete;
  SuggestionFetch& operator=(const SuggestionFetch&) = delete;
  ~SuggestionFetch() override = default;

  void Load(Profile* profile, const GURL& url) {
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = url;
    request->method = "GET";
    request->credentials_mode = network::mojom::CredentialsMode::kOmit;
    request->redirect_mode = network::mojom::RedirectMode::kError;
    request->load_flags = net::LOAD_DISABLE_CACHE;
    loader_ = network::SimpleURLLoader::Create(std::move(request),
                                               kTrafficAnnotation);
    loader_->SetTimeoutDuration(base::Seconds(policy::kTimeoutSeconds));
    loader_->DownloadToString(
        profile->GetDefaultStoragePartition()
            ->GetURLLoaderFactoryForBrowserProcess()
            .get(),
        base::BindOnce(&SuggestionFetch::OnLoaded, base::Unretained(this)),
        policy::kMaxReplyBytes);
  }

  SuggestionReply TakeReply() { return std::move(reply_); }

 private:
  void OnLoaded(std::optional<std::string> body) {
    const network::mojom::URLResponseHead* head = loader_->ResponseInfo();
    const int status =
        head && head->headers ? head->headers->response_code() : 0;
    const bool ok = loader_->NetError() == net::OK && body &&
                    policy::ReplyAcceptable(status, *body);
    owner_->Finish(id_, ok ? std::move(body) : std::nullopt);
  }

  void OnProfileWillBeDestroyed(Profile* profile) override {
    owner_->Finish(id_, std::nullopt);
  }

  raw_ptr<SuggestionClient> owner_;
  const std::string id_;
  SuggestionReply reply_;
  std::unique_ptr<network::SimpleURLLoader> loader_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

void NoteSuggestionsSetting(const base::FilePath& profile_path,
                            const base::DictValue& session) {
  const base::DictValue* settings = session.FindDict("settings");
  Settings()[profile_path] = policy::SettingFrom(
      settings ? settings->FindBool("searchSuggestions") : std::nullopt);
}

base::OnceCallback<void(bool, base::Value)> NoteSuggestionsOnWrite(
    base::FilePath profile_path, base::OnceCallback<void(bool, base::Value)> done) {
  return base::BindOnce(
      [](base::FilePath path, base::OnceCallback<void(bool, base::Value)> done,
         bool ok, base::Value reply) {
        if (ok && reply.is_dict()) NoteSuggestionsSetting(path, reply.GetDict());
        std::move(done).Run(ok, std::move(reply));
      },
      std::move(profile_path), std::move(done));
}

bool CanFetchSuggestions(Profile* setting_profile, Profile* network_profile, const std::string& url) {
  if (!setting_profile || !network_profile || network_profile->ShutdownStarted() || !policy::RequestAllowed(url)) {
    return false;
  }
  const auto setting = Settings().find(setting_profile->GetOriginalProfile()->GetPath());
  if (setting == Settings().end() || !policy::Allowed(setting->second)) {
    return false;
  }
  const GURL target(url);
  return target.is_valid() && target.SchemeIs(url::kHttpsScheme) &&
         policy::RequestAllowed(target.spec());
}

SuggestionClient::SuggestionClient() = default;

SuggestionClient::~SuggestionClient() = default;

void SuggestionClient::Fetch(Profile* setting_profile, Profile* network_profile, const std::string& id,
                             const std::string& url, SuggestionReply reply) {
  if (!policy::ValidRequestId(id) || !CanFetchSuggestions(setting_profile, network_profile, url)) {
    return PostReply(std::move(reply), std::nullopt);
  }
  for (const auto& evicted : slots_.Admit(id)) {
    auto node = fetches_.extract(evicted);
    if (!node.empty()) PostReply(node.mapped()->TakeReply(), std::nullopt);
  }
  auto fetch = std::make_unique<SuggestionFetch>(this, id, network_profile, std::move(reply));
  SuggestionFetch* started = fetch.get();
  fetches_[id] = std::move(fetch);
  started->Load(network_profile, GURL(url));
}

void SuggestionClient::Cancel(const std::string& id) {
  slots_.Remove(id);
  auto node = fetches_.extract(id);
  if (!node.empty()) PostReply(node.mapped()->TakeReply(), std::nullopt);
}

void SuggestionClient::Finish(const std::string& id,
                              std::optional<std::string> body) {
  slots_.Remove(id);
  auto node = fetches_.extract(id);
  if (!node.empty()) PostReply(node.mapped()->TakeReply(), std::move(body));
}

}
