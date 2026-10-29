#include "ardia/linux/ac_linux_live_service.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/core/ac_launch_switches.h"
#include "ardia/linux/ac_linux_live.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/chrome_paths.h"
#include "chrome/common/chrome_paths_internal.h"
#include "chrome/common/chrome_switches.h"
#include "content/public/browser/browser_thread.h"
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

namespace ardia {
namespace {

namespace live = linux_live;
using Done = base::OnceCallback<void(bool, base::Value)>;

constexpr base::TaskTraits kKeyTasks = {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
                                        base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN};
constexpr size_t kMaxArgumentBytes = 64 * 1024;
constexpr size_t kMaxRendererIdBytes = 64;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("ardia_linux_live_folders", R"(
      semantics {
        sender: "Ardia Live Folders"
        description:
          "Connects a Live Folder to GitHub, Bitbucket, Notion, Confluence or "
          "Google Drive and refreshes its pull requests or documents."
        trigger:
          "Connecting a service in Settings > Live Folders, and refreshing a "
          "Live Folder on its schedule, on window focus or on request."
        user_data {
          type: ACCESS_TOKEN
          type: USERNAME
        }
        data:
          "The service token the user supplied or granted, sent only to that "
          "service's fixed API host. No cookies are sent."
        destination: OTHER
        destination_other: "The service the user connected."
        internal {
          contacts { owners: "//ardia/linux/OWNERS" }
        }
        last_reviewed: "2026-10-28"
      }
      policy {
        cookies_allowed: NO
        setting: "Settings > Live Folders > Disconnect."
        policy_exception_justification: "Not implemented."
      })");

scoped_refptr<base::SequencedTaskRunner> KeyRunner() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(kKeyTasks));
  return *runner;
}

std::string KeyDirectory() {
  const auto& command = *base::CommandLine::ForCurrentProcess();
  base::FilePath user_data;
  base::FilePath default_user_data;
  base::PathService::Get(chrome::DIR_USER_DATA, &user_data);
  chrome::GetDefaultUserDataDirectory(&default_user_data);
  if (linux_sync::UseFileKeyStore(ardiacore::BackgroundInstance(), command.HasSwitch(switches::kUserDataDir),
                                  user_data.value(), default_user_data.value())) {
    return user_data.Append(live::kKeyDirectory).value();
  }
  return std::string();
}

linux_sync::KeyStore& Keys(const std::string& directory) {
  static base::NoDestructor<std::unique_ptr<linux_sync::KeyStore>> keys(
      directory.empty() ? linux_sync::MakeSecretServiceKeyStore(linux_sync::kSecretLibrary, live::LiveKeySchema())
                        : linux_sync::MakeFileKeyStore(directory, live::LiveKeySchema()));
  return **keys;
}

class KeyCredentials final : public live::CredentialStore {
 public:
  void Load(live::Source source, Loaded done) override {
    KeyRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(
            [](std::string directory, live::Source source) {
              std::optional<live::Credential> credential;
              const auto status = live::LoadCredential(Keys(directory), source, &credential);
              return std::make_pair(status, std::move(credential));
            },
            Directory(), source),
        base::BindOnce(
            [](Loaded done, std::pair<linux_sync::KeyStatus, std::optional<live::Credential>> result) {
              done(result.first, std::move(result.second));
            },
            std::move(done)));
  }

  void Save(live::Credential credential, Stored done) override {
    KeyRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(
            [](std::string directory, live::Credential credential) {
              return live::SaveCredential(Keys(directory), credential);
            },
            Directory(), std::move(credential)),
        base::BindOnce([](Stored done, linux_sync::KeyStatus status) { done(status); }, std::move(done)));
  }

  void Delete(live::Source source, Stored done) override {
    KeyRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce([](std::string directory, live::Source source) {
          return live::DeleteCredential(Keys(directory), source);
        }, Directory(), source),
        base::BindOnce([](Stored done, linux_sync::KeyStatus status) { done(status); }, std::move(done)));
  }

 private:
  const std::string& Directory() {
    if (!directory_) directory_ = KeyDirectory();
    return *directory_;
  }

  std::optional<std::string> directory_;
};

class LoaderTransport final : public live::Transport {
 public:
  void UseProfile(Profile* profile) { profile_ = profile->GetWeakPtr(); }

  void Send(live::HttpRequest request, Done done) override {
    const GURL url(request.url);
    if (!profile_ || profile_->ShutdownStarted() || !url.is_valid() || !url.SchemeIs(url::kHttpsScheme) ||
        (request.method != "GET" && request.method != "POST")) {
      base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce([](Done done) { done(live::HttpResponse{}); }, std::move(done)));
      return;
    }
    auto resource = std::make_unique<network::ResourceRequest>();
    resource->url = url;
    resource->method = request.method;
    resource->credentials_mode = network::mojom::CredentialsMode::kOmit;
    resource->redirect_mode = network::mojom::RedirectMode::kError;
    resource->load_flags = net::LOAD_DISABLE_CACHE;
    for (auto& [name, value] : request.headers) {
      resource->headers.SetHeader(name, value);
      linux_sync::Wipe(value);
    }
    auto loader = network::SimpleURLLoader::Create(std::move(resource), kTrafficAnnotation);
    if (request.method == "POST") loader->AttachStringForUpload(std::move(request.body), request.content_type);
    loader->SetTimeoutDuration(base::Seconds(live::kTimeoutSeconds));
    loader->SetAllowHttpErrorResults(true);
    network::SimpleURLLoader* started = loader.get();
    loads_[request.id] = Load{std::move(loader), std::move(done)};
    started->DownloadToString(
        profile_->GetDefaultStoragePartition()->GetURLLoaderFactoryForBrowserProcess().get(),
        base::BindOnce(&LoaderTransport::Loaded, weak_factory_.GetWeakPtr(), request.id), live::kMaxReplyBytes);
  }

  void Cancel(const std::string& id) override { loads_.erase(id); }

 private:
  struct Load {
    std::unique_ptr<network::SimpleURLLoader> loader;
    Done done;
  };

  void Loaded(std::string id, std::optional<std::string> body) {
    auto node = loads_.extract(id);
    if (node.empty()) return;
    network::SimpleURLLoader& loader = *node.mapped().loader;
    live::HttpResponse response;
    const network::mojom::URLResponseHead* head = loader.ResponseInfo();
    if (loader.NetError() == net::ERR_INSUFFICIENT_RESOURCES && head) {
      response.reached = true;
      response.too_large = true;
    } else if (body && head && head->headers) {
      response.reached = true;
      response.status = head->headers->response_code();
      for (const char* name : live::kResponseHeaders) {
        if (auto value = head->headers->GetNormalizedHeader(name)) response.headers[name] = std::move(*value);
      }
      if (base::IsStringUTF8(*body)) response.body = std::move(*body);
    }
    Done done = std::move(node.mapped().done);
    node.mapped().loader.reset();
    done(std::move(response));
  }

  base::WeakPtr<Profile> profile_;
  std::map<std::string, Load> loads_;
  base::WeakPtrFactory<LoaderTransport> weak_factory_{this};
};

int64_t NowMs() {
  return base::Time::Now().InMillisecondsSinceUnixEpoch();
}

struct Runtime {
  LoaderTransport transport;
  KeyCredentials credentials;
  live::LiveCore core{transport, credentials, &NowMs};
};

Runtime& Live() {
  static base::NoDestructor<Runtime> runtime;
  return *runtime;
}

void Fail(Done done, std::string_view code, std::string_view message) {
  std::move(done).Run(false, base::Value(base::DictValue().Set("code", code).Set("message", message)));
}

bool ValidRendererId(std::string_view id) {
  if (id.empty() || id.size() > kMaxRendererIdBytes) return false;
  for (const char c : id) {
    if (!base::IsAsciiAlphaNumeric(c) && c != '-' && c != '_') return false;
  }
  return true;
}

std::optional<size_t> RequestIdIndex(std::string_view method) {
  if (method == "ArdiaLive.request") return 3;
  if (method == "ArdiaLive.connect") return 2;
  if (method == "ArdiaLive.cancel") return 0;
  return std::nullopt;
}

}

bool LinuxLiveInvokes(std::string_view method) {
  return live::IsLiveMethod(method);
}

void AppendLinuxLiveCapabilities(base::ListValue& capabilities) {
  for (const char* method : live::kMethods) capabilities.Append(method);
}

void LinuxLiveCallerGone(const std::string& key) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  Live().core.CancelCaller(key);
}

void LinuxLiveInvoke(const LinuxLiveCaller& caller, Profile* app_profile, const std::string& method,
                     const base::ListValue& values, Done done) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!live::IsLiveMethod(method)) return Fail(std::move(done), live::kErrUnknownCall, "Unknown Live operation");
  if (caller.private_window || !app_profile || app_profile->IsOffTheRecord() || app_profile->ShutdownStarted())
    return Fail(std::move(done), "ERR_PRIVATE_SERVICE", "Live Folders aren't available in private windows");
  if (values.size() > 4) return Fail(std::move(done), live::kErrArgument, "Too many Live arguments");
  const auto text = base::WriteJson(base::Value(values.Clone()));
  if (!text || text->size() > kMaxArgumentBytes)
    return Fail(std::move(done), live::kErrArgument, "Unsupported Live arguments");
  auto parsed = linux_sync::ParseJson(*text);
  if (!parsed || !parsed->is_array()) return Fail(std::move(done), live::kErrArgument, "Unsupported Live arguments");
  std::vector<live::JsonValue> args = std::move(parsed->items);
  if (const auto index = RequestIdIndex(method); index && *index < args.size()) {
    live::JsonValue& id = args[*index];
    if (!id.is_string() || !ValidRendererId(id.text))
      return Fail(std::move(done), live::kErrArgument, "A valid request id is required");
    id.text = caller.key + ":" + id.text;
  }
  Runtime& runtime = Live();
  runtime.transport.UseProfile(app_profile);
  auto pending = std::make_shared<Done>(std::move(done));
  runtime.core.Invoke(method, args, [pending](live::Outcome outcome) {
    Done reply = std::move(*pending);
    if (!reply) return;
    if (!outcome.ok) return Fail(std::move(reply), outcome.code, outcome.message);
    std::string json = linux_sync::WriteJson(outcome.value);
    auto value = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
    linux_sync::WipeJson(outcome.value);
    if (!value) return Fail(std::move(reply), live::kErrService, "The service sent an unreadable reply");
    std::move(reply).Run(true, std::move(*value));
  });
}

}
