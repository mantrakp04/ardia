#include "ardia/linux/ac_linux_favicons.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_favicon_policy.h"
#include "base/base64.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/image_fetcher/image_decoder_impl.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/storage_partition.h"
#include "content/public/browser/web_contents.h"
#include "net/base/ip_address.h"
#include "net/base/net_errors.h"
#include "net/base/url_util.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "net/url_request/redirect_info.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/client_security_state.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "skia/ext/image_operations.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/image/image.h"
#include "url/gurl.h"

namespace ardiacore {
namespace {

namespace policy = linux_favicons;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("ardia_linux_favicon_fetch", R"(
      semantics {
        sender: "Ardia favicons"
        description:
          "Downloads the favicon of a page Ardia shows without a live tab "
          "(a restored or unloaded tab, an essential or a pinned row) when "
          "its icon is not in the favicon cache."
        trigger: "The sidebar, essentials or tab strip list a page whose icon is missing."
        data: "None: no cookies or credentials are sent."
        destination: WEBSITE
        internal {
          contacts { owners: "//ardia/linux/OWNERS" }
        }
        user_data {
          type: NONE
        }
        last_reviewed: "2026-10-27"
      }
      policy {
        cookies_allowed: NO
        setting: "None."
        policy_exception_justification: "Not implemented."
      })");

class PendingReplies {
 public:
  uint64_t Add(LinuxFaviconReply reply) {
    const uint64_t key = ++next_;
    replies_[key] = std::move(reply);
    return key;
  }
  void Finish(uint64_t key, base::Value value) {
    auto found = replies_.find(key);
    if (found == replies_.end()) return;
    auto reply = std::move(found->second);
    replies_.erase(found);
    std::move(reply).Run(std::move(value));
  }

 private:
  uint64_t next_ = 0;
  std::map<uint64_t, LinuxFaviconReply> replies_;
};

PendingReplies& PageDownloads() {
  static base::NoDestructor<PendingReplies> replies;
  return *replies;
}

void ExpireAfter(uint64_t key) {
  if (!base::SequencedTaskRunner::HasCurrentDefault()) return;
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce([](uint64_t key) { PageDownloads().Finish(key, base::Value()); }, key),
      base::Seconds(policy::kTimeoutSeconds));
}

void FinishWithImage(uint64_t key, SkBitmap bitmap, base::OnceClosure done = base::OnceClosure()) {
  if (bitmap.drawsNothing()) {
    PageDownloads().Finish(key, base::Value());
    if (done) std::move(done).Run();
    return;
  }
  bitmap.setImmutable();
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
      base::BindOnce(&LinuxFaviconImage, std::move(bitmap)),
      base::BindOnce([](uint64_t key, base::OnceClosure done, base::Value image) {
        PageDownloads().Finish(key, std::move(image));
        if (done) std::move(done).Run();
      }, key, std::move(done)));
}

class NetworkFavicon {
 public:
  static void Start(scoped_refptr<network::SharedURLLoaderFactory> factory, const GURL& url,
                    uint64_t key) {
    auto* fetch = new NetworkFavicon(key);
    fetch->Load(std::move(factory), url);
  }
  NetworkFavicon(const NetworkFavicon&) = delete;
  NetworkFavicon& operator=(const NetworkFavicon&) = delete;

 private:
  explicit NetworkFavicon(uint64_t key) : key_(key) {}
  ~NetworkFavicon() = default;

  void Load(scoped_refptr<network::SharedURLLoaderFactory> factory, const GURL& url) {
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = url;
    request->method = "GET";
    request->credentials_mode = network::mojom::CredentialsMode::kOmit;
    request->destination = network::mojom::RequestDestination::kImage;
    auto security = network::mojom::ClientSecurityState::New();
    security->ip_address_space = network::mojom::IPAddressSpace::kPublic;
    security->is_web_secure_context = false;
    security->local_network_access_request_policy =
        network::mojom::LocalNetworkAccessRequestPolicy::kBlock;
    request->trusted_params = network::ResourceRequest::TrustedParams();
    request->trusted_params->client_security_state = std::move(security);
    loader_ = network::SimpleURLLoader::Create(std::move(request), kTrafficAnnotation);
    loader_->SetTimeoutDuration(base::Seconds(policy::kTimeoutSeconds));
    loader_->SetOnRedirectCallback(base::BindRepeating(&NetworkFavicon::Redirected, base::Unretained(this)));
    loader_->DownloadToString(factory.get(),
                              base::BindOnce(&NetworkFavicon::Loaded, base::Unretained(this)),
                              policy::kMaxBytes);
  }

  void Redirected(const GURL&, const net::RedirectInfo& redirect, const network::mojom::URLResponseHead&,
                  std::vector<std::string>*) {
    if (LinuxFaviconPublicURL(redirect.new_url)) return;
    loader_.reset();
    Finish(base::Value());
  }

  void Loaded(std::optional<std::string> body) {
    const auto* head = loader_ ? loader_->ResponseInfo() : nullptr;
    const bool ok = loader_ && loader_->NetError() == net::OK && body && !body->empty() && head &&
                    head->headers && head->headers->response_code() == 200;
    loader_.reset();
    if (!ok) return Finish(base::Value());
    decoder_.DecodeImage(*body, gfx::Size(policy::kPixels, policy::kPixels), nullptr,
                         base::BindOnce(&NetworkFavicon::Decoded, base::Unretained(this)));
  }

  void Decoded(const gfx::Image& image) {
    const uint64_t key = key_;
    SkBitmap bitmap = image.IsEmpty() ? SkBitmap() : image.AsBitmap();
    base::OnceClosure release = base::BindOnce([](NetworkFavicon* fetch) { delete fetch; }, base::Unretained(this));
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&FinishWithImage, key, std::move(bitmap), std::move(release)));
  }

  void Finish(base::Value value) {
    PageDownloads().Finish(key_, std::move(value));
    delete this;
  }

  const uint64_t key_;
  std::unique_ptr<network::SimpleURLLoader> loader_;
  ImageDecoderImpl decoder_;
};

}

base::Value LinuxFaviconImage(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing()) return base::Value();
  const auto [width, height] = policy::Fit(bitmap.width(), bitmap.height());
  if (width <= 0 || height <= 0) return base::Value();
  const SkBitmap scaled = width == bitmap.width() && height == bitmap.height()
      ? bitmap
      : skia::ImageOperations::Resize(bitmap, skia::ImageOperations::RESIZE_BEST, width, height);
  if (scaled.drawsNothing()) return base::Value();
  const auto png = gfx::PNGCodec::EncodeBGRASkBitmap(scaled, false);
  if (!png || png->empty()) return base::Value();
  return base::Value(base::DictValue()
      .Set("uri", "data:image/png;base64," + base::Base64Encode(*png))
      .Set("width", scaled.width()).Set("height", scaled.height()));
}

bool LinuxFaviconPublicURL(const GURL& url) {
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS() || !policy::PublicHost(url.host())) return false;
  if (net::HostStringIsLocalhost(url.HostNoBracketsPiece())) return false;
  net::IPAddress address;
  return !address.AssignFromIPLiteral(url.HostNoBracketsPiece()) || address.IsPubliclyRoutable();
}

void DownloadLinuxFavicon(content::WebContents* contents, const GURL& url,
                          base::RepeatingCallback<bool()> current, LinuxFaviconReply reply) {
  if (!contents || !url.is_valid() || !policy::Allowed(url.spec(), policy::Source::kPage)) {
    return std::move(reply).Run(base::Value());
  }
  const uint64_t key = PageDownloads().Add(std::move(reply));
  ExpireAfter(key);
  contents->DownloadImage(
      url, true, gfx::Size(policy::kPixels, policy::kPixels), policy::kPixels, false,
      base::BindOnce([](uint64_t key, base::RepeatingCallback<bool()> current, int, int,
                        const GURL&, const std::vector<SkBitmap>& bitmaps,
                        const std::vector<gfx::Size>&) {
        if (!current || !current.Run()) return PageDownloads().Finish(key, base::Value());
        std::vector<std::pair<int, int>> sizes;
        for (const auto& bitmap : bitmaps) sizes.emplace_back(bitmap.width(), bitmap.height());
        const int best = policy::Pick(sizes);
        FinishWithImage(key, best < 0 ? SkBitmap() : bitmaps[best]);
      }, key, std::move(current)));
}

void FetchLinuxFavicon(Profile* profile, const GURL& url, LinuxFaviconReply reply) {
  if (!profile || profile->IsOffTheRecord() || !policy::Allowed(url.spec(), policy::Source::kNetwork) ||
      !LinuxFaviconPublicURL(url)) {
    return std::move(reply).Run(base::Value());
  }
  const uint64_t key = PageDownloads().Add(std::move(reply));
  ExpireAfter(key);
  NetworkFavicon::Start(profile->GetDefaultStoragePartition()->GetURLLoaderFactoryForBrowserProcess(),
                        url, key);
}

}
