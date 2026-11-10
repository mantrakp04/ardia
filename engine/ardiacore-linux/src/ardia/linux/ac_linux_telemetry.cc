#include "ardia/linux/ac_linux_telemetry.h"

#include <algorithm>
#include <memory>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_telemetry_policy.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/net/system_network_context_manager.h"
#include "net/base/load_flags.h"
#include "net/base/net_errors.h"
#include "net/http/http_request_headers.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/fetch_api.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"

namespace ardia::linux_telemetry {
namespace {

namespace policy = ardia::linux_telemetry_policy;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("ardia_linux_usage_telemetry", R"(
      semantics {
        sender: "Ardia usage telemetry"
        description:
          "Sends anonymous usage telemetry from this Ardia build to the "
          "Ardia project: feature use counts, timings, enums and flags, "
          "batched as OpenTelemetry logs."
        trigger:
          "The browser's telemetry client flushing its queue of usage "
          "events, at most a few requests at a time."
        user_data {
          type: NONE
        }
        data:
          "Counts, timings, enums and flags tagged with an anonymous install "
          "id and the app version. No URLs, page content, titles or free "
          "text, and no cookies or credentials."
        destination: OTHER
        destination_other: "The Ardia telemetry collector at ardia.dev."
        last_reviewed: "2026-11-10"
      }
      policy {
        cookies_allowed: NO
        setting: "Settings > Privacy > Share anonymous crash reports and usage stats."
        policy_exception_justification: "Not implemented."
      })");

int& InFlight() {
  static int in_flight = 0;
  return in_flight;
}

void PostStatus(PostReply reply, int status) {
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(reply), status));
}

scoped_refptr<network::SharedURLLoaderFactory> SystemLoaderFactory() {
  if (!g_browser_process || g_browser_process->IsShuttingDown()) {
    return nullptr;
  }
  SystemNetworkContextManager* manager =
      g_browser_process->system_network_context_manager();
  return manager ? manager->GetSharedURLLoaderFactory() : nullptr;
}

}

class TelemetryPost {
 public:
  TelemetryPost(TelemetryClient* owner, PostReply reply)
      : owner_(owner), reply_(std::move(reply)) {
    ++InFlight();
  }
  TelemetryPost(const TelemetryPost&) = delete;
  TelemetryPost& operator=(const TelemetryPost&) = delete;
  ~TelemetryPost() { --InFlight(); }

  void Load(network::mojom::URLLoaderFactory* factory, std::string body,
            const std::string& ingest_key) {
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = GURL(policy::kEndpoint);
    request->method = "POST";
    request->credentials_mode = network::mojom::CredentialsMode::kOmit;
    request->redirect_mode = network::mojom::RedirectMode::kError;
    request->load_flags = net::LOAD_DISABLE_CACHE;
    request->headers.SetHeader(net::HttpRequestHeaders::kContentType,
                               "application/json");
    request->headers.SetHeader("X-Ardia-Key", ingest_key);
    loader_ = network::SimpleURLLoader::Create(std::move(request),
                                               kTrafficAnnotation);
    loader_->SetTimeoutDuration(base::Seconds(policy::kTimeoutSeconds));
    loader_->SetAllowHttpErrorResults(true);
    loader_->AttachStringForUpload(std::move(body), "application/json");
    loader_->DownloadHeadersOnly(
        factory,
        base::BindOnce(&TelemetryPost::OnLoaded, base::Unretained(this)));
  }

  PostReply TakeReply() { return std::move(reply_); }

 private:
  void OnLoaded(scoped_refptr<net::HttpResponseHeaders> headers) {
    const int status = headers ? headers->response_code() : 0;
    owner_->Finish(this, policy::ReportedStatus(
                             loader_->NetError() == net::OK, status));
  }

  raw_ptr<TelemetryClient> owner_;
  PostReply reply_;
  std::unique_ptr<network::SimpleURLLoader> loader_;
};

TelemetryClient::TelemetryClient() = default;

TelemetryClient::~TelemetryClient() = default;

void TelemetryClient::Post(std::string body, const std::string& ingest_key,
                           PostReply reply) {
  if (!policy::PostAcceptable(body, ingest_key) ||
      !policy::AdmitPost(InFlight())) {
    return PostStatus(std::move(reply), 0);
  }
  scoped_refptr<network::SharedURLLoaderFactory> factory =
      SystemLoaderFactory();
  if (!factory) {
    return PostStatus(std::move(reply), 0);
  }
  auto post = std::make_unique<TelemetryPost>(this, std::move(reply));
  TelemetryPost* started = post.get();
  posts_.push_back(std::move(post));
  started->Load(factory.get(), std::move(body), ingest_key);
}

void TelemetryClient::Finish(TelemetryPost* post, int status) {
  const auto found = std::find_if(
      posts_.begin(), posts_.end(),
      [post](const std::unique_ptr<TelemetryPost>& owned) {
        return owned.get() == post;
      });
  if (found == posts_.end()) {
    return;
  }
  std::unique_ptr<TelemetryPost> finished = std::move(*found);
  posts_.erase(found);
  PostStatus(finished->TakeReply(), status);
}

}
