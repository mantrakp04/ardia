#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "ardia/linux/ac_linux_live.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"

namespace live = ardia::linux_live;
namespace keys = ardia::linux_sync;

namespace {

std::string FixtureSecret(std::string_view prefix) {
  static std::mt19937_64 engine(std::random_device{}());
  std::string secret(prefix);
  for (int i = 0; i < 24; ++i) secret.push_back("0123456789abcdefghijklmnopqrstuvwxyz"[engine() % 36]);
  return secret;
}

class Loop {
 public:
  void Post(std::function<void()> task) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      tasks_.push_back(std::move(task));
    }
    ready_.notify_one();
  }

  bool Empty() {
    std::lock_guard<std::mutex> lock(mutex_);
    return tasks_.empty();
  }

  std::function<void()> Next() {
    std::unique_lock<std::mutex> lock(mutex_);
    ready_.wait(lock, [this] { return !tasks_.empty(); });
    auto task = std::move(tasks_.front());
    tasks_.pop_front();
    return task;
  }

 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<std::function<void()>> tasks_;
};

std::string Lower(std::string text) {
  for (char& c : text) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return text;
}

live::HttpResponse Exchange(const live::HttpRequest& request, int port, std::shared_ptr<int> socket_slot) {
  live::HttpResponse response;
  constexpr std::string_view kScheme = "https://";
  if (!request.url.starts_with(kScheme)) return response;
  const std::string rest = request.url.substr(kScheme.size());
  const size_t slash = rest.find('/');
  const std::string host = slash == std::string::npos ? rest : rest.substr(0, slash);
  const std::string path = slash == std::string::npos ? "/" : rest.substr(slash);
  const int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return response;
  *socket_slot = fd;
  timeval timeout{5, 0};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(static_cast<uint16_t>(port));
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
    close(fd);
    return response;
  }
  std::string wire = request.method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n";
  for (const auto& [name, value] : request.headers) wire += name + ": " + value + "\r\n";
  if (!request.content_type.empty()) wire += "Content-Type: " + request.content_type + "\r\n";
  if (request.method != "GET") wire += "Content-Length: " + std::to_string(request.body.size()) + "\r\n";
  wire += "\r\n" + request.body;
  size_t sent = 0;
  while (sent < wire.size()) {
    const ssize_t n = send(fd, wire.data() + sent, wire.size() - sent, MSG_NOSIGNAL);
    if (n <= 0) {
      close(fd);
      return response;
    }
    sent += static_cast<size_t>(n);
  }
  std::string raw;
  char buffer[65536];
  bool overflow = false;
  while (true) {
    const ssize_t n = recv(fd, buffer, sizeof(buffer), 0);
    if (n < 0) {
      close(fd);
      return response;
    }
    if (n == 0) break;
    raw.append(buffer, static_cast<size_t>(n));
    if (raw.size() > live::kMaxReplyBytes + 65536) {
      overflow = true;
      break;
    }
  }
  close(fd);
  const size_t head_end = raw.find("\r\n\r\n");
  if (head_end == std::string::npos || !raw.starts_with("HTTP/1.1 ")) return response;
  response.reached = true;
  response.status = std::atoi(raw.c_str() + 9);
  size_t at = raw.find("\r\n") + 2;
  while (at < head_end) {
    const size_t end = raw.find("\r\n", at);
    const std::string line = raw.substr(at, end - at);
    at = end + 2;
    const size_t colon = line.find(':');
    if (colon == std::string::npos) continue;
    const std::string name = Lower(line.substr(0, colon));
    std::string value = line.substr(colon + 1);
    while (!value.empty() && value.front() == ' ') value.erase(value.begin());
    for (const char* wanted : live::kResponseHeaders) {
      if (name == wanted) response.headers[name] = value;
    }
  }
  response.body = raw.substr(head_end + 4);
  if (overflow || response.body.size() > live::kMaxReplyBytes) {
    response.too_large = true;
    response.body.clear();
  }
  return response;
}

class SocketTransport final : public live::Transport {
 public:
  SocketTransport(Loop& loop, int port) : loop_(loop), port_(port) {}

  void Send(live::HttpRequest request, Done done) override {
    ++sent_;
    if (offline_) {
      loop_.Post([done = std::move(done)] { done(live::HttpResponse{}); });
      return;
    }
    auto slot = std::make_shared<int>(-1);
    {
      std::lock_guard<std::mutex> lock(mutex_);
      sockets_[request.id] = slot;
    }
    const std::string id = request.id;
    ++inflight_;
    std::thread([this, request = std::move(request), done = std::move(done), slot, id]() mutable {
      live::HttpResponse response = Exchange(request, port_, slot);
      loop_.Post([this, id, done = std::move(done), response = std::move(response)]() mutable {
        --inflight_;
        {
          std::lock_guard<std::mutex> lock(mutex_);
          sockets_.erase(id);
          if (cancelled_.erase(id)) return;
        }
        done(std::move(response));
      });
    }).detach();
  }

  void Cancel(const std::string& id) override {
    std::lock_guard<std::mutex> lock(mutex_);
    cancelled_.insert(id);
    ++cancels_;
    auto found = sockets_.find(id);
    if (found != sockets_.end() && *found->second >= 0) shutdown(*found->second, SHUT_RDWR);
  }

  void set_offline(bool offline) { offline_ = offline; }
  int sent() const { return sent_; }
  int inflight() const { return inflight_; }
  int cancels() const { return cancels_; }

 private:
  Loop& loop_;
  int port_;
  bool offline_ = false;
  int sent_ = 0;
  int cancels_ = 0;
  int inflight_ = 0;
  std::mutex mutex_;
  std::map<std::string, std::shared_ptr<int>> sockets_;
  std::set<std::string> cancelled_;
};

class LoopStore final : public live::CredentialStore {
 public:
  LoopStore(Loop& loop, std::unique_ptr<keys::KeyStore> store) : loop_(loop), store_(std::move(store)) {}

  void Load(live::Source source, Loaded done) override {
    ++loads_;
    loop_.Post([this, source, done = std::move(done)] {
      if (locked_) return done(keys::KeyStatus::kLocked, std::nullopt);
      std::optional<live::Credential> credential;
      const auto status = live::LoadCredential(*store_, source, &credential);
      done(status, std::move(credential));
    });
  }

  void Save(live::Credential credential, Stored done) override {
    Write([this, credential = std::move(credential), done = std::move(done)] {
      if (locked_) return done(keys::KeyStatus::kLocked);
      done(live::SaveCredential(*store_, credential));
    });
  }

  void Delete(live::Source source, Stored done) override {
    Write([this, source, done = std::move(done)] {
      if (locked_) return done(keys::KeyStatus::kLocked);
      done(live::DeleteCredential(*store_, source));
    });
  }

  void set_locked(bool locked) { locked_ = locked; }
  void set_holding(bool holding) {
    holding_ = holding;
    if (holding) return;
    for (auto& write : held_) loop_.Post(std::move(write));
    held_.clear();
  }
  size_t held() const { return held_.size(); }
  int loads() const { return loads_; }

 private:
  void Write(std::function<void()> write) {
    if (holding_) return held_.push_back(std::move(write));
    loop_.Post(std::move(write));
  }

  Loop& loop_;
  std::unique_ptr<keys::KeyStore> store_;
  bool holding_ = false;
  std::vector<std::function<void()>> held_;
  bool locked_ = false;
  int loads_ = 0;
};

int64_t WallMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
      .count();
}

void Emit(double id, const live::Outcome& outcome) {
  keys::JsonValue line = keys::JsonValue::Object();
  line.Set("id", keys::JsonValue::Number(id));
  line.Set("ok", keys::JsonValue::Bool(outcome.ok));
  if (outcome.ok) {
    line.Set("value", outcome.value);
  } else {
    line.Set("code", keys::JsonValue::String(outcome.code));
    line.Set("message", keys::JsonValue::String(outcome.message));
  }
  std::cout << keys::WriteJson(line) << std::endl;
}

#define EXPECT(condition)                                              \
  do {                                                                 \
    if (!(condition)) {                                                \
      std::cerr << "live self-test failed: " #condition " at line " << __LINE__ << "\n"; \
      return 1;                                                        \
    }                                                                  \
  } while (false)

int SelfTest() {
  EXPECT(live::ReadOnlyGraphql("query LiveFolder($a: String!) { viewer { login } }"));
  EXPECT(!live::ReadOnlyGraphql("mutation { addStar(input: {}) { clientMutationId } }"));
  EXPECT(!live::ReadOnlyGraphql("query A { viewer { login } } subscription B { x }"));
  EXPECT(live::ReadOnlyGraphql("query { search(query: \"mutation\") { issueCount } }"));
  EXPECT(!live::ReadOnlyGraphql("query { a(b: \"unterminated) }"));
  EXPECT(!live::ReadOnlyGraphql("#x\rmutation{a}"));
  EXPECT(!live::ReadOnlyGraphql("query { a(b: \"x\rmutation\") }"));
  EXPECT(!live::ReadOnlyGraphql("#x\r\nmutation{a}"));
  EXPECT(!live::ReadOnlyGraphql("query { a } #x\rsubscription { b }"));
  EXPECT(!live::ReadOnlyGraphql("\xef\xbb\xbfmutation { a }"));
  EXPECT(!live::ReadOnlyGraphql("query{a},mutation{b}"));
  EXPECT(live::ReadOnlyGraphql("# mutation here\nquery { a }"));
  EXPECT(live::ReadOnlyGraphql("query { a(b: \"\"\"mutation\rsubscription\"\"\") }"));
  EXPECT(live::ReadOnlyGraphql("query { a(b: \"say \\\"mutation\\\"\") }"));
  EXPECT(!live::ReadOnlyGraphql(std::string(live::kMaxQueryBytes + 1, 'a')));
  EXPECT(live::NormalizeSite("https://Acme.Atlassian.net") == "https://acme.atlassian.net");
  EXPECT(live::NormalizeSite("https://wiki.example.com:8443") == "https://wiki.example.com:8443");
  EXPECT(!live::NormalizeSite("http://acme.atlassian.net"));
  EXPECT(!live::NormalizeSite("https://acme.atlassian.net/wiki"));
  EXPECT(!live::NormalizeSite("https://user@acme.atlassian.net"));
  EXPECT(!live::NormalizeSite("https://localhost"));
  EXPECT(!live::NormalizeSite("https://acme.atlassian.net:0"));
  EXPECT(live::PercentEncode("557058:a{b} c") == "557058%3Aa%7Bb%7D%20c");
  EXPECT(live::Base64("alice:token") == "YWxpY2U6dG9rZW4=");
  EXPECT(live::ErrorText(500, std::string(300, 'x')).size() == 4 + live::kMaxErrorTextBytes);
  live::Credential drive;
  drive.source = live::Source::kGdrive;
  drive.client_id = "client";
  drive.client_secret = FixtureSecret("client-");
  drive.refresh_token = FixtureSecret("refresh-");
  drive.token = FixtureSecret("access-");
  drive.expires_at_ms = 1234;
  const std::string text = live::SerializeCredential(drive);
  EXPECT(text.find(drive.client_secret) == std::string::npos);
  EXPECT(text.find(drive.refresh_token) == std::string::npos);
  const auto parsed = live::ParseCredential(live::Source::kGdrive, text);
  EXPECT(parsed && parsed->refresh_token == drive.refresh_token && parsed->expires_at_ms == 1234);
  EXPECT(!live::ParseCredential(live::Source::kGithub, text));
  std::string tampered = text;
  tampered.insert(tampered.find("token="), "extra=00\n");
  EXPECT(!live::ParseCredential(live::Source::kGdrive, tampered));
  live::Credential confluence;
  confluence.source = live::Source::kConfluence;
  confluence.site = "https://evil.test/path";
  confluence.user = "a@b.c";
  confluence.token = "t";
  EXPECT(!live::ValidCredential(confluence));
  confluence.site = "https://acme.atlassian.net";
  EXPECT(live::ValidCredential(confluence));
  confluence.user = "a:b";
  EXPECT(!live::ValidCredential(confluence));
  EXPECT(live::ValidLiveAccount("gdrive") && !live::ValidLiveAccount("../gdrive"));
  EXPECT(live::LiveKeySchema().name == std::string("dev.ardia.linux.LiveToken"));
  EXPECT(keys::SyncKeySchema().name == std::string("dev.ardia.linux.SyncKey"));
  std::string error;
  EXPECT(!live::BuildRequest(live::Source::kGithub, "graphql", keys::JsonValue::Object(), &confluence, &error));
  std::cout << "live self-test passed" << std::endl;
  return 0;
}

}

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--self-test") return SelfTest();
  if (argc == 2 && std::string(argv[1]) == "--contract") {
    const auto contract = live::Contract();
    keys::JsonValue out = keys::JsonValue::Object();
    out.Set("viewerQuery", keys::JsonValue::String(contract.viewer_query));
    out.Set("githubScope", keys::JsonValue::String(contract.github_scope));
    out.Set("notionSearchBody", keys::JsonValue::String(contract.notion_search_body));
    out.Set("notionVersion", keys::JsonValue::String(contract.notion_version));
    out.Set("confluenceCql", keys::JsonValue::String(contract.confluence_cql));
    keys::JsonValue drive = keys::JsonValue::Object();
    for (const auto& [key, value] : contract.drive_query) drive.Set(key, keys::JsonValue::String(value));
    out.Set("driveQuery", std::move(drive));
    out.Set("googleRedirect", keys::JsonValue::String(contract.google_redirect));
    keys::JsonValue methods = keys::JsonValue::Array();
    for (const char* method : live::kMethods) methods.Append(keys::JsonValue::String(method));
    out.Set("methods", std::move(methods));
    std::cout << keys::WriteJson(out) << std::endl;
    return 0;
  }
  if (argc == 3 && std::string(argv[1]) == "--secret-service") {
    auto store = keys::MakeSecretServiceKeyStore(argv[2], live::LiveKeySchema());
    std::optional<live::Credential> credential;
    std::cout << "secret service without a bus: "
              << keys::KeyStatusName(live::LoadCredential(*store, live::Source::kGithub, &credential)) << std::endl;
    return 0;
  }
  if (argc != 3) {
    std::cerr << "usage: live_host_tool <token-dir> <fake-port>\n";
    return 64;
  }
  Loop loop;
  SocketTransport transport(loop, std::atoi(argv[2]));
  const std::string token_store = argv[1];
  const std::string secret_service = "secret-service:";
  LoopStore store(loop, token_store.starts_with(secret_service)
                            ? keys::MakeSecretServiceKeyStore(token_store.substr(secret_service.size()), live::LiveKeySchema())
                            : keys::MakeFileKeyStore(token_store, live::LiveKeySchema()));
  int64_t offset = 0;
  bool eof = false;
  std::vector<std::unique_ptr<live::LiveCore>> retired;
  auto core = std::make_unique<live::LiveCore>(transport, store, [&offset] { return WallMs() + offset; });
  std::thread reader([&] {
    std::string line;
    while (std::getline(std::cin, line)) {
      loop.Post([&, line] {
        auto message = keys::ParseJson(line);
        if (!message || !message->is_object()) return;
        const auto* id_value = message->Find("id");
        const double id = id_value ? std::strtod(id_value->text.c_str(), nullptr) : 0;
        const auto* method = message->Find("method");
        const auto* args = message->Find("args");
        if (!method || !method->is_string() || !args || !args->is_array())
          return Emit(id, live::Outcome::Error("ERR_TOOL", "bad message"));
        if (method->text == "Tool.advance") {
          offset += static_cast<int64_t>(std::strtod(args->items.at(0).text.c_str(), nullptr));
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.offline") {
          transport.set_offline(args->items.at(0).flag);
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.holdWrites") {
          store.set_holding(args->items.at(0).flag);
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.callerGone") {
          core->CancelCaller(args->items.at(0).text);
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.locked") {
          store.set_locked(args->items.at(0).flag);
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.restart") {
          retired.push_back(std::move(core));
          core = std::make_unique<live::LiveCore>(transport, store, [&offset] { return WallMs() + offset; });
          return Emit(id, live::Outcome::Value(keys::JsonValue::Bool(true)));
        }
        if (method->text == "Tool.stats") {
          keys::JsonValue stats = keys::JsonValue::Object();
          stats.Set("active", keys::JsonValue::Number(static_cast<double>(core->active())));
          stats.Set("queued", keys::JsonValue::Number(static_cast<double>(core->queued())));
          stats.Set("calls", keys::JsonValue::Number(static_cast<double>(core->calls())));
          stats.Set("sent", keys::JsonValue::Number(transport.sent()));
          stats.Set("cancels", keys::JsonValue::Number(transport.cancels()));
          stats.Set("loads", keys::JsonValue::Number(store.loads()));
          stats.Set("heldWrites", keys::JsonValue::Number(static_cast<double>(store.held())));
          return Emit(id, live::Outcome::Value(std::move(stats)));
        }
        core->Invoke(method->text, args->items, [id](live::Outcome outcome) { Emit(id, outcome); });
      });
    }
    loop.Post([&eof] { eof = true; });
  });
  while (!eof || transport.inflight() > 0 || !loop.Empty()) loop.Next()();
  reader.join();
  return 0;
}
