#pragma once
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_sync_json.h"
#include "base/values.h"

#define FROM_HERE 0
#define CHECK(condition) assert(condition)

template <class T> using scoped_refptr = std::shared_ptr<T>;

namespace base {

template <class T> class NoDestructor {
 public:
  template <class... A> explicit NoDestructor(A&&... args) : value_(new T(std::forward<A>(args)...)) {}
  T& operator*() { return *value_; }
  T* operator->() { return value_; }

 private:
  T* value_;
};

template <class T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(T* value, std::shared_ptr<bool> alive) : value_(value), alive_(std::move(alive)) {}
  explicit operator bool() const { return alive_ && *alive_; }
  T* get() const { return *this ? value_ : nullptr; }
  T* operator->() const {
    assert(*this);
    return value_;
  }

 private:
  T* value_ = nullptr;
  std::shared_ptr<bool> alive_;
};

template <class T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* owner) : owner_(owner) {}
  ~WeakPtrFactory() { *alive_ = false; }
  WeakPtr<T> GetWeakPtr() { return WeakPtr<T>(owner_, alive_); }

 private:
  T* owner_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};

template <class Sig> class OnceCallback;

template <class R, class... A> class OnceCallback<R(A...)> {
 public:
  OnceCallback() = default;
  template <class F, class = std::enable_if_t<!std::is_same_v<std::decay_t<F>, OnceCallback>>>
  OnceCallback(F&& f) {
    auto shared = std::make_shared<std::decay_t<F>>(std::forward<F>(f));
    run_ = [shared](A... args) -> R { return (*shared)(std::forward<A>(args)...); };
  }
  explicit operator bool() const { return static_cast<bool>(run_); }
  R Run(A... args) && {
    auto run = std::move(run_);
    run_ = nullptr;
    return run(std::forward<A>(args)...);
  }

 private:
  std::function<R(A...)> run_;
};

template <class C, class R, class... P, class T, class... A> void Invoke(R (C::*method)(P...), WeakPtr<T> receiver, A&&... args) {
  if (receiver) (receiver.get()->*method)(std::forward<A>(args)...);
}

template <class F, class... Bound> auto BindOnce(F&& f, Bound&&... bound) {
  auto state = std::make_shared<std::tuple<std::decay_t<F>, std::decay_t<Bound>...>>(std::forward<F>(f),
                                                                                       std::forward<Bound>(bound)...);
  return [state](auto&&... rest) mutable -> decltype(auto) {
    return std::apply(
        [&](auto& fn, auto&... values) -> decltype(auto) {
          if constexpr (std::is_member_function_pointer_v<std::decay_t<F>>) {
            return Invoke(fn, std::move(values)..., std::forward<decltype(rest)>(rest)...);
          } else {
            return fn(std::move(values)..., std::forward<decltype(rest)>(rest)...);
          }
        },
        *state);
  };
}

class SequencedTaskRunner {
 public:
  static scoped_refptr<SequencedTaskRunner> GetCurrentDefault();
  void PostTask(int, std::function<void()> task) { Tasks().push_back(std::move(task)); }
  template <class Task, class Reply> void PostTaskAndReplyWithResult(int, Task task, Reply reply) {
    auto state = std::make_shared<std::pair<Task, Reply>>(std::move(task), std::move(reply));
    Tasks().push_back([state] { std::move(state->second)(std::move(state->first)()); });
  }
  static std::deque<std::function<void()>>& Tasks() {
    static std::deque<std::function<void()>> tasks;
    return tasks;
  }
};

inline scoped_refptr<SequencedTaskRunner> SequencedTaskRunner::GetCurrentDefault() {
  static auto runner = std::make_shared<SequencedTaskRunner>();
  return runner;
}

inline size_t RunAllTasks() {
  size_t ran = 0;
  auto& tasks = SequencedTaskRunner::Tasks();
  while (!tasks.empty()) {
    auto task = std::move(tasks.front());
    tasks.pop_front();
    task();
    ++ran;
  }
  return ran;
}

struct MayBlock {};
enum class TaskPriority { USER_VISIBLE };
enum class TaskShutdownBehavior { CONTINUE_ON_SHUTDOWN };
struct TaskTraits {
  template <class... A> constexpr TaskTraits(A...) {}
};

struct ThreadPool {
  static scoped_refptr<SequencedTaskRunner> CreateSequencedTaskRunner(const TaskTraits&) {
    return SequencedTaskRunner::GetCurrentDefault();
  }
};

class FilePath {
 public:
  FilePath() = default;
  explicit FilePath(std::string value) : value_(std::move(value)) {}
  FilePath Append(std::string_view name) const { return FilePath(value_ + "/" + std::string(name)); }
  const std::string& value() const { return value_; }

 private:
  std::string value_;
};

struct LiveStubPaths {
  std::string user_data;
  std::string default_user_data;
  bool explicit_user_data = true;
  bool background = true;
};

inline LiveStubPaths& StubPaths() {
  static LiveStubPaths paths;
  return paths;
}

class CommandLine {
 public:
  static CommandLine* ForCurrentProcess() {
    static CommandLine line;
    return &line;
  }
  bool HasSwitch(std::string_view) const { return StubPaths().explicit_user_data; }
};

struct PathService {
  static bool Get(int, FilePath* path) {
    *path = FilePath(StubPaths().user_data);
    return true;
  }
};

class TimeDelta {
 public:
  constexpr explicit TimeDelta(int64_t seconds) : seconds_(seconds) {}
  int64_t InSeconds() const { return seconds_; }

 private:
  int64_t seconds_;
};
inline TimeDelta Seconds(int64_t seconds) { return TimeDelta(seconds); }

class Time {
 public:
  static Time Now() { return Time(); }
  int64_t InMillisecondsSinceUnixEpoch() const { return 1'800'000'000'000; }
};

inline bool IsAsciiAlphaNumeric(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

inline bool IsStringUTF8(std::string_view text) {
  size_t at = 0;
  while (at < text.size()) {
    const auto lead = static_cast<unsigned char>(text[at]);
    size_t extra = lead < 0x80 ? 0 : (lead >> 5) == 6 ? 1 : (lead >> 4) == 14 ? 2 : (lead >> 3) == 30 ? 3 : 9;
    if (extra == 9 || at + extra >= text.size() + (extra ? 0 : 1)) return false;
    for (size_t i = 1; i <= extra; ++i) {
      if ((static_cast<unsigned char>(text[at + i]) & 0xc0) != 0x80) return false;
    }
    at += extra + 1;
  }
  return true;
}

inline ardia::linux_sync::JsonValue ToJson(const Value& value) {
  using J = ardia::linux_sync::JsonValue;
  switch (value.type()) {
    case Value::Type::BOOLEAN: return J::Bool(value.GetBool());
    case Value::Type::INT:
    case Value::Type::DOUBLE: return J::Number(value.GetDouble());
    case Value::Type::STRING: return J::String(value.GetString());
    case Value::Type::LIST: {
      J list = J::Array();
      for (const auto& item : value.GetList()) list.Append(ToJson(item));
      return list;
    }
    case Value::Type::DICT: {
      J object = J::Object();
      for (const auto [key, member] : value.GetDict()) object.Set(key, ToJson(member));
      return object;
    }
    default: return J::Null();
  }
}

inline Value FromJson(const ardia::linux_sync::JsonValue& json) {
  using T = ardia::linux_sync::JsonValue::Type;
  switch (json.type) {
    case T::kNull: return Value();
    case T::kBool: return Value(json.flag);
    case T::kNumber: return Value(std::strtod(json.text.c_str(), nullptr));
    case T::kString: return Value(std::string(json.text));
    case T::kArray: {
      ListValue list;
      for (const auto& item : json.items) list.Append(FromJson(item));
      return Value(std::move(list));
    }
    case T::kObject: {
      DictValue dict;
      for (const auto& [key, member] : json.members) dict.Set(key, FromJson(member));
      return Value(std::move(dict));
    }
  }
  return Value();
}

inline std::optional<std::string> WriteJson(const Value& value) {
  return ardia::linux_sync::WriteJson(ToJson(value));
}

inline constexpr int JSON_PARSE_RFC = 0;

struct JSONReader {
  static std::optional<Value> Read(std::string_view text, int) {
    auto parsed = ardia::linux_sync::ParseJson(text);
    if (!parsed) return std::nullopt;
    return FromJson(*parsed);
  }
};

}

namespace ardiacore {
inline bool BackgroundInstance() { return base::StubPaths().background; }
}

namespace chrome {
inline constexpr int DIR_USER_DATA = 1;
inline bool GetDefaultUserDataDirectory(base::FilePath* path) {
  *path = base::FilePath(base::StubPaths().default_user_data);
  return true;
}
}

namespace switches {
inline constexpr char kUserDataDir[] = "user-data-dir";
}

namespace content {
struct BrowserThread {
  enum ID { UI };
  static bool CurrentlyOn(ID) { return true; }
};
}

namespace net {
inline constexpr int OK = 0;
inline constexpr int ERR_FAILED = -2;
inline constexpr int ERR_INSUFFICIENT_RESOURCES = -12;
inline constexpr int LOAD_DISABLE_CACHE = 1 << 5;

struct NetworkTrafficAnnotationTag {
  const char* name;
};
constexpr NetworkTrafficAnnotationTag DefineNetworkTrafficAnnotation(const char* name, const char*) { return {name}; }

class HttpResponseHeaders {
 public:
  int status = 200;
  std::map<std::string, std::string> values;
  int response_code() const { return status; }
  std::optional<std::string> GetNormalizedHeader(std::string_view name) const {
    auto found = values.find(std::string(name));
    if (found == values.end()) return std::nullopt;
    return found->second;
  }
};

class HttpRequestHeaders {
 public:
  void SetHeader(std::string_view name, std::string_view value) { values[std::string(name)] = std::string(value); }
  std::map<std::string, std::string> values;
};
}

class GURL {
 public:
  explicit GURL(std::string spec) : spec_(std::move(spec)) {}
  bool is_valid() const { return spec_.find("://") != std::string::npos; }
  bool SchemeIs(std::string_view scheme) const { return spec_.starts_with(std::string(scheme) + "://"); }
  const std::string& spec() const { return spec_; }

 private:
  std::string spec_;
};

namespace url {
inline constexpr char kHttpsScheme[] = "https";
}

namespace network {
namespace mojom {
enum class CredentialsMode { kInclude, kOmit };
enum class RedirectMode { kFollow, kError };
struct URLLoaderFactory {};
struct URLResponseHead {
  scoped_refptr<net::HttpResponseHeaders> headers;
};
}

struct SharedURLLoaderFactory : mojom::URLLoaderFactory {};

struct ResourceRequest {
  GURL url{""};
  std::string method = "GET";
  mojom::CredentialsMode credentials_mode = mojom::CredentialsMode::kInclude;
  mojom::RedirectMode redirect_mode = mojom::RedirectMode::kFollow;
  int load_flags = 0;
  net::HttpRequestHeaders headers;
};

class SimpleURLLoader;

inline std::vector<SimpleURLLoader*>& Loaders() {
  static std::vector<SimpleURLLoader*> loaders;
  return loaders;
}

class SimpleURLLoader {
 public:
  using BodyAsStringCallback = base::OnceCallback<void(std::optional<std::string>)>;

  static std::unique_ptr<SimpleURLLoader> Create(std::unique_ptr<ResourceRequest> request,
                                                 const net::NetworkTrafficAnnotationTag& tag) {
    return std::unique_ptr<SimpleURLLoader>(new SimpleURLLoader(std::move(request), tag));
  }
  ~SimpleURLLoader() { std::erase(Loaders(), this); }

  void AttachStringForUpload(std::string&& body, std::string_view content_type) {
    upload = std::move(body);
    upload_type = std::string(content_type);
  }
  void SetTimeoutDuration(base::TimeDelta timeout) { timeout_seconds = timeout.InSeconds(); }
  void SetAllowHttpErrorResults(bool allow) { allow_http_errors = allow; }
  void DownloadToString(mojom::URLLoaderFactory* factory, BodyAsStringCallback callback, size_t max) {
    assert(factory);
    max_bytes = max;
    done = std::move(callback);
  }
  const mojom::URLResponseHead* ResponseInfo() const { return head ? &*head : nullptr; }
  int NetError() const { return net_error; }

  void Complete(int status, std::string body, std::map<std::string, std::string> headers = {}) {
    head.emplace();
    head->headers = std::make_shared<net::HttpResponseHeaders>();
    head->headers->status = status;
    head->headers->values = std::move(headers);
    net_error = net::OK;
    std::move(done).Run(std::move(body));
  }
  void Fail(int error, bool with_head) {
    if (with_head) {
      head.emplace();
      head->headers = std::make_shared<net::HttpResponseHeaders>();
    }
    net_error = error;
    std::move(done).Run(std::nullopt);
  }

  std::unique_ptr<ResourceRequest> request;
  std::string traffic;
  std::string upload;
  std::string upload_type;
  int64_t timeout_seconds = 0;
  bool allow_http_errors = false;
  size_t max_bytes = 0;
  BodyAsStringCallback done;
  std::optional<mojom::URLResponseHead> head;
  int net_error = net::ERR_FAILED;

 private:
  SimpleURLLoader(std::unique_ptr<ResourceRequest> resource, const net::NetworkTrafficAnnotationTag& tag)
      : request(std::move(resource)), traffic(tag.name) {
    Loaders().push_back(this);
  }
};
}

class StoragePartition {
 public:
  scoped_refptr<network::SharedURLLoaderFactory> GetURLLoaderFactoryForBrowserProcess() { return factory_; }

 private:
  scoped_refptr<network::SharedURLLoaderFactory> factory_ = std::make_shared<network::SharedURLLoaderFactory>();
};

namespace content {
using ::StoragePartition;
}

class Profile {
 public:
  bool IsOffTheRecord() const { return off_the_record; }
  bool ShutdownStarted() const { return shutting_down; }
  base::WeakPtr<Profile> GetWeakPtr() { return weak_.GetWeakPtr(); }
  StoragePartition* GetDefaultStoragePartition() { return &partition_; }

  bool off_the_record = false;
  bool shutting_down = false;

 private:
  StoragePartition partition_;
  base::WeakPtrFactory<Profile> weak_{this};
};
