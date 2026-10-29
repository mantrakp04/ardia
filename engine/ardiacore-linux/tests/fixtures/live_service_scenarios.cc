#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iostream>
#include <iterator>
#include <random>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_live_service.h"
#include "live_service_support.h"

namespace {

std::string FixtureToken(std::string_view prefix) {
  static std::mt19937_64 engine(std::random_device{}());
  std::string token(prefix);
  for (int i = 0; i < 24; ++i) token.push_back("0123456789abcdef"[engine() % 16]);
  return token;
}

#define EXPECT(condition)                                                              \
  do {                                                                                 \
    if (!(condition)) {                                                                \
      std::cerr << "live service scenario failed: " #condition " at line " << __LINE__ << "\n"; \
      std::exit(1);                                                                    \
    }                                                                                  \
  } while (false)

struct Reply {
  bool done = false;
  bool ok = false;
  base::Value value;
};

std::shared_ptr<Reply> Invoke(const ardia::LinuxLiveCaller& caller, Profile* profile, const std::string& method,
                              base::ListValue args) {
  auto reply = std::make_shared<Reply>();
  ardia::LinuxLiveInvoke(caller, profile, method, args, [reply](bool ok, base::Value value) {
    reply->done = true;
    reply->ok = ok;
    reply->value = std::move(value);
  });
  return reply;
}

std::string Code(const Reply& reply) {
  if (!reply.done || reply.ok || !reply.value.is_dict()) return "";
  const std::string* code = reply.value.GetDict().FindString("code");
  return code ? *code : "";
}

std::string Message(const Reply& reply) {
  const std::string* message = reply.value.is_dict() ? reply.value.GetDict().FindString("message") : nullptr;
  return message ? *message : "";
}

base::ListValue Args(std::initializer_list<const char*> strings) {
  base::ListValue list;
  for (const char* text : strings) list.Append(base::Value(text));
  return list;
}

base::ListValue RequestArgs(const char* source, const char* operation, const char* id) {
  base::ListValue list;
  list.Append(base::Value(source));
  list.Append(base::Value(operation));
  list.Append(base::Value(base::DictValue()));
  list.Append(base::Value(id));
  return list;
}

network::SimpleURLLoader& Only() {
  EXPECT(network::Loaders().size() == 1);
  return *network::Loaders().front();
}

std::string Header(network::SimpleURLLoader& loader, const std::string& name) {
  auto& values = loader.request->headers.values;
  auto found = values.find(name);
  return found == values.end() ? "" : found->second;
}

std::string Contents(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), {});
}

}

int main(int argc, char** argv) {
  EXPECT(argc == 2);
  const std::filesystem::path root(argv[1]);
  base::StubPaths().user_data = (root / "user").string();
  base::StubPaths().default_user_data = (root / "default").string();
  std::filesystem::create_directories(root / "user");
  const auto tokens = root / "user" / "Ardia Live Tokens";

  base::ListValue capabilities;
  ardia::AppendLinuxLiveCapabilities(capabilities);
  EXPECT(capabilities.size() == 4);
  EXPECT(ardia::LinuxLiveInvokes("ArdiaLive.request") && !ardia::LinuxLiveInvokes("ArdiaSync.status"));

  Profile regular;
  Profile off_the_record;
  off_the_record.off_the_record = true;
  Profile closing;
  closing.shutting_down = true;
  const ardia::LinuxLiveCaller window{"1#1", false};
  const ardia::LinuxLiveCaller other{"2#1", false};

  EXPECT(Code(*Invoke({"9#1", true}, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "p1"))) ==
         "ERR_PRIVATE_SERVICE");
  EXPECT(Code(*Invoke(window, &off_the_record, "ArdiaLive.connect", Args({"notion"}))) == "ERR_PRIVATE_SERVICE");
  EXPECT(Code(*Invoke(window, &closing, "ArdiaLive.request", RequestArgs("notion", "users", "p2"))) ==
         "ERR_PRIVATE_SERVICE");
  EXPECT(Code(*Invoke(window, nullptr, "ArdiaLive.request", RequestArgs("notion", "users", "p3"))) ==
         "ERR_PRIVATE_SERVICE");
  EXPECT(network::Loaders().empty());
  EXPECT(base::RunAllTasks() == 0);

  EXPECT(Code(*Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "bad id!"))) ==
         "ERR_LIVE_ARGUMENT");
  EXPECT(Code(*Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "a:b"))) ==
         "ERR_LIVE_ARGUMENT");
  EXPECT(Code(*Invoke(window, &regular, "ArdiaLive.fetch", Args({"https://example.com"}))) == "ERR_UNKNOWN_CALL");
  EXPECT(Code(*Invoke(window, &regular, "ArdiaLive.cancel", Args({"a", "b", "c", "d", "e"}))) == "ERR_LIVE_ARGUMENT");

  const std::string notion_token = FixtureToken("secret_");
  base::ListValue connect;
  connect.Append(base::Value("notion"));
  connect.Append(base::Value(base::DictValue().Set("token", notion_token)));
  connect.Append(base::Value("c1"));
  auto connected = Invoke(window, &regular, "ArdiaLive.connect", std::move(connect));
  {
    auto& loader = Only();
    EXPECT(loader.request->url.spec() == "https://api.notion.com/v1/users/me");
    EXPECT(loader.request->method == "GET");
    EXPECT(loader.request->credentials_mode == network::mojom::CredentialsMode::kOmit);
    EXPECT(loader.request->redirect_mode == network::mojom::RedirectMode::kError);
    EXPECT(loader.request->load_flags & net::LOAD_DISABLE_CACHE);
    EXPECT(Header(loader, "Authorization") == "Bearer " + notion_token);
    EXPECT(Header(loader, "Notion-Version") == "2022-06-28");
    EXPECT(Header(loader, "Accept") == "application/json");
    EXPECT(loader.timeout_seconds == 20 && loader.allow_http_errors);
    EXPECT(loader.max_bytes == 8u * 1024 * 1024);
    EXPECT(loader.traffic == "ardia_linux_live_folders");
    EXPECT(loader.upload.empty());
    loader.Complete(200, "{\"name\":\"Glue Bot\"}");
  }
  EXPECT(!connected->done);
  base::RunAllTasks();
  EXPECT(connected->done && connected->ok);
  EXPECT(*connected->value.GetDict().FindString("name") == "Glue Bot");
  struct stat info {};
  EXPECT(stat((tokens / "live-token-notion").c_str(), &info) == 0 && (info.st_mode & 0777) == 0600);
  EXPECT(Contents(tokens / "live-token-notion").find(notion_token) == std::string::npos);

  auto search = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "search", "r1"));
  {
    auto& loader = Only();
    EXPECT(loader.request->method == "POST" && loader.upload_type == "application/json");
    EXPECT(loader.upload.find("\"page_size\":30") != std::string::npos);
  }
  auto foreign = Invoke(other, &regular, "ArdiaLive.cancel", Args({"r1"}));
  EXPECT(foreign->done && foreign->ok && foreign->value.is_bool() && !foreign->value.GetBool());
  EXPECT(network::Loaders().size() == 1 && !search->done);
  ardia::LinuxLiveCallerGone("2#1");
  EXPECT(network::Loaders().size() == 1 && !search->done);
  ardia::LinuxLiveCallerGone("1#1");
  EXPECT(Code(*search) == "ERR_LIVE_CANCELLED");
  EXPECT(network::Loaders().empty());

  auto own = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r2"));
  auto mine = Invoke(window, &regular, "ArdiaLive.cancel", Args({"r2"}));
  EXPECT(mine->ok && mine->value.GetBool() && Code(*own) == "ERR_LIVE_CANCELLED" && network::Loaders().empty());

  auto unreadable = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r3"));
  Only().Complete(200, "{\"name\":\"\xff\xfe\"}");
  EXPECT(Code(*unreadable) == "ERR_LIVE_SERVICE" && Message(*unreadable).find("unreadable") != std::string::npos);

  auto large = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r4"));
  Only().Fail(net::ERR_INSUFFICIENT_RESOURCES, true);
  EXPECT(Code(*large) == "ERR_LIVE_SERVICE" && Message(*large).find("too much") != std::string::npos);

  auto limited = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r5"));
  Only().Complete(403, "{}", {{"x-ratelimit-remaining", "0"}, {"set-cookie", "a=b"}});
  EXPECT(Code(*limited) == "ERR_LIVE_RATE_LIMITED");

  auto offline = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r6"));
  Only().Fail(-105, false);
  EXPECT(Code(*offline) == "ERR_LIVE_NETWORK");

  auto users = Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r7"));
  Only().Complete(200, "{\"results\":[]}");
  EXPECT(users->done && users->ok && *users->value.GetDict().FindString("body") == "{\"results\":[]}");

  auto gone = Invoke(window, &regular, "ArdiaLive.disconnect", Args({"notion"}));
  base::RunAllTasks();
  EXPECT(gone->done && gone->ok && gone->value.GetBool());
  EXPECT(!std::filesystem::exists(tokens / "live-token-notion"));
  EXPECT(Code(*Invoke(window, &regular, "ArdiaLive.request", RequestArgs("notion", "users", "r8"))) == "ERR_LIVE_NOT_CONNECTED");
  base::RunAllTasks();
  std::cout << "live service scenarios passed" << std::endl;
  return 0;
}
