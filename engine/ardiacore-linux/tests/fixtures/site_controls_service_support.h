#pragma once
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#include "base/values.h"

#define FROM_HERE 0
#define CHECK(condition) assert(condition)
#define LOG(severity) std::cerr

class Profile;

namespace base {

template <class T> using raw_ptr = T*;

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
  explicit WeakPtrFactory(T* value) : value_(value), alive_(std::make_shared<bool>(true)) {}
  ~WeakPtrFactory() { *alive_ = false; }
  WeakPtr<T> GetWeakPtr() { return WeakPtr<T>(value_, alive_); }

 private:
  T* value_;
  std::shared_ptr<bool> alive_;
};

template <class T> struct UnretainedWrapper { T* value; };
template <class T> UnretainedWrapper<T> Unretained(T* value) { return {value}; }

template <class> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
 public:
  OnceCallback() = default;
  template <class F, class = std::enable_if_t<!std::is_same_v<std::decay_t<F>, OnceCallback>>>
  OnceCallback(F fn) : fn_(std::make_shared<std::decay_t<F>>(std::move(fn))),
                       call_([](void* target, A... args) -> R {
                         return (*static_cast<std::decay_t<F>*>(target))(std::forward<A>(args)...);
                       }) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  explicit operator bool() const { return !!fn_; }
  R Run(A... args) && {
    auto fn = std::move(fn_);
    assert(fn);
    return call_(fn.get(), std::forward<A>(args)...);
  }

 private:
  std::shared_ptr<void> fn_;
  R (*call_)(void*, A...) = nullptr;
};
using OnceClosure = OnceCallback<void()>;

template <class> class RepeatingCallback;
template <class R, class... A> class RepeatingCallback<R(A...)> {
 public:
  RepeatingCallback() = default;
  template <class F, class = std::enable_if_t<!std::is_same_v<std::decay_t<F>, RepeatingCallback>>>
  RepeatingCallback(F fn) : fn_(std::make_shared<std::function<R(A...)>>(
      [shared = std::make_shared<std::decay_t<F>>(std::move(fn))](A... args) -> R {
        return (*shared)(std::forward<A>(args)...);
      })) {}
  explicit operator bool() const { return !!fn_; }
  R Run(A... args) const { return (*fn_)(std::forward<A>(args)...); }

 private:
  std::shared_ptr<std::function<R(A...)>> fn_;
};
using RepeatingClosure = RepeatingCallback<void()>;

template <class T> struct IsWeak : std::false_type {};
template <class T> struct IsWeak<WeakPtr<T>> : std::true_type {};
template <class T> struct IsUnretained : std::false_type {};
template <class T> struct IsUnretained<UnretainedWrapper<T>> : std::true_type {};

template <class F, class... Bound> struct BoundCall {
  F fn;
  std::tuple<Bound...> bound;
  template <class... A> void operator()(A&&... args) {
    if constexpr (std::is_member_function_pointer_v<F>) {
      auto& target = std::get<0>(bound);
      using Target = std::decay_t<decltype(target)>;
      auto* object = [&] {
        if constexpr (IsWeak<Target>::value) return target.get();
        else if constexpr (IsUnretained<Target>::value) return target.value;
        else return target;
      }();
      if (!object) return;
      std::apply([&](auto&, auto&... rest) { (object->*fn)(std::move(rest)..., std::forward<A>(args)...); }, bound);
    } else {
      std::apply([&](auto&... values) { fn(std::move(values)..., std::forward<A>(args)...); }, bound);
    }
  }
};

template <class R, class F, class... Bound> struct BoundResult {
  F fn;
  std::tuple<Bound...> bound;
  R operator()() { return std::apply([&](auto&... values) { return fn(std::move(values)...); }, bound); }
};

template <class F, class... Bound> auto BindOnce(F fn, Bound... bound) {
  return BoundCall<F, Bound...>{fn, std::make_tuple(std::move(bound)...)};
}

template <class R, class P, class... Bound> auto BindOnce(R (*fn)(P), Bound... bound) {
  if constexpr (std::is_void_v<R>) return BoundCall<R (*)(P), Bound...>{fn, std::make_tuple(std::move(bound)...)};
  else return BoundResult<R, R (*)(P), Bound...>{fn, std::make_tuple(std::move(bound)...)};
}

template <class F, class... Bound> auto BindRepeating(F fn, Bound... bound) {
  return BoundCall<F, Bound...>{fn, std::make_tuple(std::move(bound)...)};
}

class TimeDelta {
 public:
  constexpr explicit TimeDelta(int64_t ms = 0) : ms_(ms) {}
  constexpr int64_t InMilliseconds() const { return ms_; }

 private:
  int64_t ms_;
};
constexpr TimeDelta Milliseconds(int64_t ms) { return TimeDelta(ms); }

inline int64_t& FakeNowMs() {
  static int64_t now = 1000000;
  return now;
}

class TimeTicks {
 public:
  TimeTicks() = default;
  static TimeTicks Now() {
    TimeTicks ticks;
    ticks.ms_ = FakeNowMs();
    return ticks;
  }
  friend TimeDelta operator-(TimeTicks a, TimeTicks b) { return TimeDelta(a.ms_ - b.ms_); }

 private:
  int64_t ms_ = 0;
};

inline std::vector<OnceClosure>& Tasks() {
  static std::vector<OnceClosure> tasks;
  return tasks;
}

inline void PostTask(OnceClosure task) { Tasks().push_back(std::move(task)); }

inline std::vector<std::pair<int64_t, OnceClosure>>& DelayedTasks() {
  static std::vector<std::pair<int64_t, OnceClosure>> tasks;
  return tasks;
}

class SequencedTaskRunner {
 public:
  static SequencedTaskRunner* GetCurrentDefault() {
    static SequencedTaskRunner runner;
    return &runner;
  }
  template <class F> void PostTask(int, F task) { base::PostTask(OnceClosure(std::move(task))); }
  template <class F> void PostDelayedTask(int, F task, TimeDelta delay) {
    DelayedTasks().emplace_back(FakeNowMs() + delay.InMilliseconds(), OnceClosure(std::move(task)));
  }
};

inline void PromoteDueTasks() {
  auto& delayed = DelayedTasks();
  for (size_t i = 0; i < delayed.size();) {
    if (delayed[i].first > FakeNowMs()) {
      ++i;
      continue;
    }
    PostTask(std::move(delayed[i].second));
    delayed.erase(delayed.begin() + static_cast<std::ptrdiff_t>(i));
  }
}

inline void RunTasks() {
  PromoteDueTasks();
  for (int round = 0; round < 64 && !Tasks().empty(); ++round) {
    auto tasks = std::move(Tasks());
    Tasks().clear();
    for (auto& task : tasks) std::move(task).Run();
  }
}

class RepeatingTimer;
inline std::vector<RepeatingTimer*>& Timers() {
  static std::vector<RepeatingTimer*> timers;
  return timers;
}

class RepeatingTimer {
 public:
  RepeatingTimer() { Timers().push_back(this); }
  ~RepeatingTimer() { std::erase(Timers(), this); }
  template <class F> void Start(int, TimeDelta delay, F task) {
    delay_ = delay;
    task_ = RepeatingClosure(std::move(task));
    running_ = true;
  }
  void Stop() { running_ = false; }
  bool IsRunning() const { return running_; }
  void Fire() {
    if (running_) task_.Run();
  }

 private:
  TimeDelta delay_;
  RepeatingClosure task_;
  bool running_ = false;
};

class OneShotTimer;
inline std::vector<OneShotTimer*>& OneShotTimers() {
  static std::vector<OneShotTimer*> timers;
  return timers;
}

class OneShotTimer {
 public:
  OneShotTimer() { OneShotTimers().push_back(this); }
  ~OneShotTimer() { std::erase(OneShotTimers(), this); }
  template <class F> void Start(int, TimeDelta delay, F task) {
    due_ms_ = FakeNowMs() + delay.InMilliseconds();
    task_ = OnceClosure(std::move(task));
    running_ = true;
  }
  void Stop() { running_ = false; }
  bool IsRunning() const { return running_; }
  void FireIfDue() {
    if (!running_ || FakeNowMs() < due_ms_) return;
    running_ = false;
    OnceClosure task = std::move(task_);
    std::move(task).Run();
  }

 private:
  int64_t due_ms_ = 0;
  OnceClosure task_;
  bool running_ = false;
};

inline void FireTimers() {
  for (auto* timer : std::vector<RepeatingTimer*>(Timers())) {
    if (std::find(Timers().begin(), Timers().end(), timer) != Timers().end()) timer->Fire();
  }
  for (auto* timer : std::vector<OneShotTimer*>(OneShotTimers())) {
    if (std::find(OneShotTimers().begin(), OneShotTimers().end(), timer) != OneShotTimers().end()) timer->FireIfDue();
  }
}

class FilePath {
 public:
  FilePath() = default;
  explicit FilePath(std::string value) : value_(std::move(value)) {}
  const std::string& value() const { return value_; }
  bool empty() const { return value_.empty(); }
  FilePath AppendASCII(std::string_view part) const { return FilePath(value_ + "/" + std::string(part)); }
  friend bool operator==(const FilePath& a, const FilePath& b) { return a.value_ == b.value_; }

 private:
  std::string value_;
};

inline bool PathExists(const FilePath& path) { return std::filesystem::exists(path.value()); }
inline FilePath MakeAbsoluteFilePath(const FilePath& path) {
  std::error_code error;
  auto absolute = std::filesystem::canonical(path.value(), error);
  return error ? FilePath() : FilePath(absolute.string());
}
inline bool ReadFileToStringWithMaxSize(const FilePath& path, std::string* contents, size_t max) {
  std::ifstream in(path.value());
  if (!in) return false;
  std::stringstream buffer;
  buffer << in.rdbuf();
  *contents = buffer.str();
  return contents->size() <= max;
}

enum BasePathKey { DIR_EXE };
inline FilePath& FakeExeDir() {
  static FilePath dir;
  return dir;
}
struct PathService {
  static bool Get(BasePathKey, FilePath* path) {
    *path = FakeExeDir();
    return true;
  }
};

class CommandLine {
 public:
  static CommandLine* ForCurrentProcess() {
    static CommandLine line;
    return &line;
  }
  bool HasSwitch(std::string_view name) const { return switches.contains(std::string(name)); }
  FilePath GetSwitchValuePath(std::string_view name) const { return FilePath(switches.at(std::string(name))); }
  std::map<std::string, std::string> switches;
};

struct MayBlock {};
enum class TaskPriority { USER_VISIBLE };
enum class TaskShutdownBehavior { SKIP_ON_SHUTDOWN };
struct TaskTraits {
  template <class... A> TaskTraits(A...) {}
};
struct ThreadPool {
  template <class Task, class Reply> static void PostTaskAndReplyWithResult(int, TaskTraits, Task task, Reply reply) {
    PostTask(OnceClosure([task = std::move(task), reply = std::move(reply)]() mutable {
      auto result = task();
      PostTask(OnceClosure([reply = std::move(reply), result = std::move(result)]() mutable { reply(std::move(result)); }));
    }));
  }
};

class OneShotEvent {
 public:
  template <class F> void Post(int, F task) const {
    if (signaled_) return PostTask(OnceClosure(std::move(task)));
    waiting_.push_back(OnceClosure(std::move(task)));
  }
  void Signal() {
    signaled_ = true;
    for (auto& task : waiting_) PostTask(std::move(task));
    waiting_.clear();
  }

 private:
  bool signaled_ = false;
  mutable std::vector<OnceClosure> waiting_;
};

template <class Source, class Observer> class ScopedObservation {
 public:
  explicit ScopedObservation(Observer* observer) : observer_(observer) {}
  ~ScopedObservation() { Reset(); }
  void Observe(Source* source) {
    source_ = source;
    source_->AddObserver(observer_);
  }
  void Reset() {
    if (source_) source_->RemoveObserver(observer_);
    source_ = nullptr;
  }

 private:
  Observer* observer_;
  Source* source_ = nullptr;
};

inline std::u16string UTF8ToUTF16(std::string_view text) { return std::u16string(text.begin(), text.end()); }
inline std::string UTF16ToUTF8(std::u16string_view text) { return std::string(text.begin(), text.end()); }

enum class TerminationStatus { TERMINATION_STATUS_PROCESS_CRASHED };

enum JSONParserOptions { JSON_PARSE_RFC = 0 };

class JsonParser {
 public:
  explicit JsonParser(std::string_view text) : text_(text) {}
  std::optional<Value> Parse() {
    auto value = ParseValue(0);
    Space();
    if (!value || at_ != text_.size()) return std::nullopt;
    return value;
  }

 private:
  void Space() {
    while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\n' || text_[at_] == '\t' || text_[at_] == '\r')) ++at_;
  }
  bool Eat(char c) {
    Space();
    if (at_ < text_.size() && text_[at_] == c) {
      ++at_;
      return true;
    }
    return false;
  }
  std::optional<std::string> String() {
    if (!Eat('"')) return std::nullopt;
    std::string out;
    while (at_ < text_.size() && text_[at_] != '"') {
      char c = text_[at_++];
      if (c == '\\') {
        if (at_ >= text_.size()) return std::nullopt;
        char e = text_[at_++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': {
            if (at_ + 4 > text_.size()) return std::nullopt;
            const int code = std::stoi(std::string(text_.substr(at_, 4)), nullptr, 16);
            at_ += 4;
            if (code < 0x80) out += static_cast<char>(code);
            else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
            else { out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F)); }
            break;
          }
          default: out += e;
        }
      } else {
        out += c;
      }
    }
    if (at_ >= text_.size()) return std::nullopt;
    ++at_;
    return out;
  }
  std::optional<Value> ParseValue(int depth) {
    if (depth > 32) return std::nullopt;
    Space();
    if (at_ >= text_.size()) return std::nullopt;
    const char c = text_[at_];
    if (c == '"') {
      auto s = String();
      if (!s) return std::nullopt;
      return Value(std::move(*s));
    }
    if (c == '{') {
      ++at_;
      DictValue dict;
      if (Eat('}')) return Value(std::move(dict));
      do {
        auto key = String();
        if (!key || !Eat(':')) return std::nullopt;
        auto value = ParseValue(depth + 1);
        if (!value) return std::nullopt;
        dict.Set(*key, std::move(*value));
      } while (Eat(','));
      if (!Eat('}')) return std::nullopt;
      return Value(std::move(dict));
    }
    if (c == '[') {
      ++at_;
      ListValue list;
      if (Eat(']')) return Value(std::move(list));
      do {
        auto value = ParseValue(depth + 1);
        if (!value) return std::nullopt;
        list.Append(std::move(*value));
      } while (Eat(','));
      if (!Eat(']')) return std::nullopt;
      return Value(std::move(list));
    }
    for (auto [word, value] : {std::pair{"true", 1}, std::pair{"false", 0}, std::pair{"null", 2}}) {
      if (text_.substr(at_).starts_with(word)) {
        at_ += std::string_view(word).size();
        return value == 2 ? Value() : Value(value == 1);
      }
    }
    size_t end = at_;
    while (end < text_.size() && std::string_view("+-0123456789.eE").find(text_[end]) != std::string_view::npos) ++end;
    if (end == at_) return std::nullopt;
    const std::string number(text_.substr(at_, end - at_));
    at_ = end;
    if (number.find_first_of(".eE") == std::string::npos && number.size() < 10) return Value(std::stoi(number));
    return Value(std::stod(number));
  }

  std::string_view text_;
  size_t at_ = 0;
};

struct JSONReader {
  static std::optional<Value> Read(std::string_view text, int, size_t = 64) { return JsonParser(text).Parse(); }
};

inline void WriteString(std::string& out, const std::string& text) {
  out += '"';
  for (unsigned char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      default:
        if (c < 0x20) {
          char buffer[8];
          std::snprintf(buffer, sizeof buffer, "\\u%04x", c);
          out += buffer;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  out += '"';
}

inline void Write(std::string& out, const Value& value) {
  switch (value.type()) {
    case Value::Type::NONE: out += "null"; break;
    case Value::Type::BOOLEAN: out += value.GetBool() ? "true" : "false"; break;
    case Value::Type::INT: out += std::to_string(value.GetInt()); break;
    case Value::Type::DOUBLE: {
      std::ostringstream number;
      number.precision(17);
      number << value.GetDouble();
      out += number.str();
      break;
    }
    case Value::Type::STRING: WriteString(out, value.GetString()); break;
    case Value::Type::BINARY: out += "null"; break;
    case Value::Type::DICT: {
      out += '{';
      bool first = true;
      for (const auto& [key, item] : value.GetDict()) {
        if (!first) out += ',';
        first = false;
        WriteString(out, key);
        out += ':';
        Write(out, item);
      }
      out += '}';
      break;
    }
    case Value::Type::LIST: {
      out += '[';
      bool first = true;
      for (const auto& item : value.GetList()) {
        if (!first) out += ',';
        first = false;
        Write(out, item);
      }
      out += ']';
      break;
    }
  }
}

inline std::optional<std::string> WriteJson(const Value& value) {
  std::string out;
  Write(out, value);
  return out;
}
inline std::optional<std::string> WriteJson(const DictValue& value) {
  return WriteJson(Value(value.Clone()));
}

}

using base::raw_ptr;

class GURL {
 public:
  GURL() = default;
  explicit GURL(std::string spec) : spec_(std::move(spec)) {}
  const std::string& spec() const { return spec_; }
  bool is_empty() const { return spec_.empty(); }
  bool IsAboutBlank() const { return spec_ == "about:blank"; }
  std::string scheme() const {
    const size_t colon = spec_.find(':');
    return colon == std::string::npos ? std::string() : spec_.substr(0, colon);
  }
  GURL DeprecatedGetOriginAsURL() const {
    const size_t scheme = spec_.find("://");
    if (scheme == std::string::npos) return GURL();
    const size_t slash = spec_.find('/', scheme + 3);
    return GURL(spec_.substr(0, slash == std::string::npos ? spec_.size() : slash) + "/");
  }
  friend bool operator==(const GURL& a, const GURL& b) { return a.spec_ == b.spec_; }

 private:
  std::string spec_;
};

namespace url {
class Origin {
 public:
  explicit Origin(GURL url) : url_(url.DeprecatedGetOriginAsURL()) {}
  GURL GetURL() const { return url_; }

 private:
  GURL url_;
};
}

namespace net {
inline constexpr int ERR_ABORTED = -3;
}

namespace ui {
enum PageTransition { PAGE_TRANSITION_LINK, PAGE_TRANSITION_AUTO_TOPLEVEL };
}

inline constexpr int ISOLATED_WORLD_ID_CHROME_INTERNAL = 13;

class ProfileObserver {
 public:
  virtual ~ProfileObserver() = default;
  virtual void OnProfileWillBeDestroyed(Profile*) {}
};

namespace content {

class BrowserContext {};

struct BrowserThread {
  enum ID { UI };
  static bool CurrentlyOn(ID) { return true; }
};

class WebContents;
class WebContentsObserver;

class RenderFrameHost {
 public:
  using JavaScriptResultCallback = base::OnceCallback<void(base::Value)>;
  bool IsRenderFrameLive() const { return live; }
  const GURL& GetLastCommittedURL() const { return url; }
  url::Origin GetLastCommittedOrigin() const { return url::Origin(url); }
  void ExecuteJavaScriptInIsolatedWorld(const std::u16string& script, JavaScriptResultCallback callback, int world);
  WebContents* contents = nullptr;
  GURL url;
  bool live = false;
};

class Page {
 public:
  explicit Page(RenderFrameHost& frame) : frame_(frame) {}
  RenderFrameHost& GetMainDocument() { return frame_; }

 private:
  RenderFrameHost& frame_;
};

class NavigationController {
 public:
  struct LoadURLParams {
    explicit LoadURLParams(const GURL& value) : url(value) {}
    GURL url;
    ui::PageTransition transition_type = ui::PAGE_TRANSITION_LINK;
  };
  void LoadURLWithParams(const LoadURLParams& params);
  WebContents* contents = nullptr;
};

class WebContentsObserver {
 public:
  virtual ~WebContentsObserver();
  void Observe(WebContents* contents);
  virtual void DidFinishLoad(RenderFrameHost*, const GURL&) {}
  virtual void DidFailLoad(RenderFrameHost*, const GURL&, int) {}
  virtual void PrimaryPageChanged(Page&) {}
  virtual void PrimaryMainFrameRenderProcessGone(base::TerminationStatus) {}
  WebContents* observed = nullptr;
};

class WebContents {
 public:
  struct CreateParams {
    explicit CreateParams(Profile* value) : profile(value) {}
    Profile* profile;
    bool initially_hidden = false;
  };
  static std::unique_ptr<WebContents> Create(const CreateParams& params);
  explicit WebContents(const CreateParams& params);
  ~WebContents();
  struct Notifying {
    explicit Notifying(WebContents* contents) : contents(contents), alive(contents->alive) { ++contents->notifying; }
    ~Notifying() {
      if (*alive) --contents->notifying;
    }
    WebContents* contents;
    std::shared_ptr<bool> alive;
  };
  int notifying = 0;
  NavigationController& GetController() { return controller_; }
  RenderFrameHost* GetPrimaryMainFrame() { return &frame_; }
  BrowserContext* GetBrowserContext();
  void Commit(const GURL& url) {
    frame_.url = url;
    frame_.live = true;
    Page page(frame_);
    Notifying scope(this);
    if (observer) observer->PrimaryPageChanged(page);
  }
  void FinishLoad() {
    Notifying scope(this);
    if (observer) observer->DidFinishLoad(&frame_, frame_.url);
  }
  void FailLoad(int code) {
    Notifying scope(this);
    if (observer) observer->DidFailLoad(&frame_, frame_.url, code);
  }
  void Crash() {
    frame_.live = false;
    Notifying scope(this);
    if (observer) observer->PrimaryMainFrameRenderProcessGone(base::TerminationStatus::TERMINATION_STATUS_PROCESS_CRASHED);
  }
  Profile* profile;
  bool hidden;
  int view_type = -1;
  bool extension_observer = false;
  WebContentsObserver* observer = nullptr;
  GURL requested;
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);

 private:
  NavigationController controller_;
  RenderFrameHost frame_;
};

class NavigationHandle {
 public:
  WebContents* GetWebContents() { return contents; }
  const GURL& GetURL() const { return url; }
  WebContents* contents = nullptr;
  GURL url;
};

class NavigationThrottle;

class NavigationThrottleRegistry {
 public:
  NavigationHandle& GetNavigationHandle() { return handle; }
  void AddThrottle(std::unique_ptr<NavigationThrottle> throttle) { throttles.push_back(std::move(throttle)); }
  NavigationHandle handle;
  std::vector<std::unique_ptr<NavigationThrottle>> throttles;
};

class NavigationThrottle {
 public:
  enum ThrottleCheckResult { PROCEED, DEFER };
  explicit NavigationThrottle(NavigationThrottleRegistry& registry) : registry_(registry) {}
  virtual ~NavigationThrottle() = default;
  virtual ThrottleCheckResult WillStartRequest() { return PROCEED; }
  virtual const char* GetNameForLogging() = 0;
  NavigationHandle* navigation_handle() const { return &registry_.handle; }
  virtual void Resume() { ++resumed; }
  int resumed = 0;

 private:
  NavigationThrottleRegistry& registry_;
};

}

namespace extensions {

using ExtensionId = std::string;

namespace mojom {
enum class ViewType { kInvalid, kTabContents = 9 };
}

inline void SetViewType(content::WebContents* contents, mojom::ViewType type) { contents->view_type = static_cast<int>(type); }

class Extension {
 public:
  Extension(std::string id, base::FilePath path) : id_(std::move(id)), path_(std::move(path)) {}
  const std::string& id() const { return id_; }
  const base::FilePath& path() const { return path_; }

 private:
  std::string id_;
  base::FilePath path_;
};

class ExtensionSet {
 public:
  const Extension* GetByID(const ExtensionId& id) const {
    for (const auto& extension : extensions) {
      if (extension->id() == id) return extension.get();
    }
    return nullptr;
  }
  std::vector<std::unique_ptr<Extension>> extensions;
};

class ExtensionRegistry {
 public:
  static ExtensionRegistry* Get(Profile* profile);
  const ExtensionSet& enabled_extensions() const { return enabled; }
  ExtensionSet enabled;
};

class ComponentLoader {
 public:
  static ComponentLoader* Get(Profile* profile);
  ExtensionId AddOrReplace(const base::FilePath& path);
  void Remove(const ExtensionId& id) { removed.push_back(id); }
  std::vector<std::string> added;
  std::vector<std::string> removed;
  std::string id_for_path = "fajbdaomknpkicfjcpipdmcpoamdmilh";
  bool enables = true;
  Profile* profile = nullptr;
};

class ExtensionSystem {
 public:
  static ExtensionSystem* Get(Profile* profile);
  const base::OneShotEvent& ready() const { return ready_event; }
  base::OneShotEvent ready_event;
};

class ExtensionsBrowserClient {
 public:
  static ExtensionsBrowserClient* Get() {
    static ExtensionsBrowserClient client;
    return &client;
  }
  void CreateExtensionWebContentsObserver(content::WebContents* contents) { contents->extension_observer = true; }
};

}

class Profile : public content::BrowserContext {
 public:
  static Profile* FromBrowserContext(content::BrowserContext* context) { return static_cast<Profile*>(context); }
  explicit Profile(std::string path, bool off_the_record = false, Profile* original = nullptr)
      : path_(std::move(path)), off_the_record_(off_the_record), original_(original ? original : this) {}
  ~Profile() {
    for (auto* observer : std::vector<ProfileObserver*>(observers_)) {
      if (std::find(observers_.begin(), observers_.end(), observer) != observers_.end()) observer->OnProfileWillBeDestroyed(this);
    }
  }
  bool IsOffTheRecord() const { return off_the_record_; }
  bool IsNewProfile() const { return new_profile; }
  bool new_profile = false;
  bool ShutdownStarted() const { return shutdown_started; }
  bool shutdown_started = false;
  Profile* GetOriginalProfile() { return original_; }
  const base::FilePath& GetPath() const { return path_; }
  void AddObserver(ProfileObserver* observer) { observers_.push_back(observer); }
  void RemoveObserver(ProfileObserver* observer) { std::erase(observers_, observer); }
  size_t observer_count() const { return observers_.size(); }
  extensions::ExtensionRegistry registry;
  extensions::ComponentLoader loader;
  extensions::ExtensionSystem system;

 private:
  base::FilePath path_;
  bool off_the_record_;
  Profile* original_;
  std::vector<ProfileObserver*> observers_;
};

inline extensions::ExtensionRegistry* extensions::ExtensionRegistry::Get(Profile* profile) { return &profile->registry; }
inline content::BrowserContext* content::WebContents::GetBrowserContext() { return profile; }
inline extensions::ComponentLoader* extensions::ComponentLoader::Get(Profile* profile) {
  profile->loader.profile = profile;
  return &profile->loader;
}
inline extensions::ExtensionSystem* extensions::ExtensionSystem::Get(Profile* profile) { return &profile->system; }
inline extensions::ExtensionId extensions::ComponentLoader::AddOrReplace(const base::FilePath& path) {
  added.push_back(path.value());
  if (!id_for_path.empty() && enables) profile->registry.enabled.extensions.push_back(std::make_unique<Extension>(id_for_path, path));
  return id_for_path;
}

struct FakeBridge {
  enum class Mode { kAnswer, kSilent, kNotReady, kCrashOnSend, kDropFirstReply };
  Mode mode = Mode::kAnswer;
  std::vector<std::string> whitelist{"chrome-extension-scheme"};
  std::map<std::string, bool> lists{{"easylist", true}, {"easyprivacy", true}, {"fanboy-cookiemonster", false}};
  bool auto_update = true;
  int fail_follows = 0;
  int requests = 0;
  int polls = 0;
  int sends_answered = 0;
  std::optional<std::string> reply;
  std::vector<std::string> ops;
  std::function<void()> on_send;

  static bool Covers(const std::string& directive, const std::string& host) {
    return directive.find('/') == std::string::npos &&
           (host == directive || (host.size() > directive.size() && host.ends_with("." + directive)));
  }

  std::string Handle(const base::DictValue& request) {
    ++requests;
    const int ticket = request.Find("ticket")->GetInt();
    const std::string op = *request.FindString("op");
    ops.push_back(op);
    const base::DictValue& args = *request.FindDict("args");
    auto answer = [&](base::Value value) {
      return *base::WriteJson(base::Value(base::DictValue().Set("ticket", base::Value(ticket)).Set("value", std::move(value))));
    };
    auto error = [&](std::string text) {
      return *base::WriteJson(base::Value(base::DictValue().Set("ticket", base::Value(ticket)).Set("error", text)));
    };
    const base::Value* fail = request.Find("failNext");
    if (fail && fail->GetBool()) return error("getWhitelist: failed (dev)");
    const std::string off = "/^(?:ardia-blocking-off|)/";
    if (op == "state") {
      base::ListValue out;
      for (const auto& [id, on] : lists) {
        out.Append(base::Value(base::DictValue().Set("id", id).Set("title", id).Set("group", id == "easyprivacy" ? "privacy" : "ads")
            .Set("enabled", base::Value(on)).Set("defaultOn", base::Value(id != "fanboy-cookiemonster")).Set("filters", base::Value(100))));
      }
      base::ListValue hosts;
      for (const auto& d : whitelist) {
        if (d.find('/') == std::string::npos && d != "chrome-extension-scheme") hosts.Append(base::Value(d));
      }
      const bool on = std::find(whitelist.begin(), whitelist.end(), off) == whitelist.end();
      return answer(base::Value(base::DictValue().Set("lists", base::Value(std::move(out))).Set("allowedHosts", base::Value(std::move(hosts)))
          .Set("enabled", base::Value(on)).Set("networkFilters", base::Value(300)).Set("cosmeticFilters", base::Value(20))));
    }
    if (op == "settings") {
      base::ListValue selected;
      for (const auto& [id, on] : lists) {
        if (on) selected.Append(base::Value(id));
      }
      std::vector<std::string> sorted = whitelist;
      std::sort(sorted.begin(), sorted.end());
      base::ListValue directives;
      for (const auto& d : sorted) directives.Append(base::Value(d));
      return answer(base::Value(base::DictValue().Set("lists", base::Value(std::move(selected)))
          .Set("whitelist", base::Value(std::move(directives))).Set("autoUpdate", base::Value(auto_update))));
    }
    if (op == "follow") {
      if (fail_follows > 0) {
        --fail_follows;
        return error("setWhitelist: failed");
      }
      std::set<std::string> want;
      for (const auto& id : args.Find("lists")->GetList()) want.insert(id.GetString());
      for (auto& [id, on] : lists) on = want.contains(id);
      whitelist.clear();
      for (const auto& d : args.Find("whitelist")->GetList()) whitelist.push_back(d.GetString());
      auto_update = args.Find("autoUpdate")->GetBool();
      return answer(base::Value());
    }
    if (op == "setEnabled") {
      const bool on = args.Find("enabled")->GetBool();
      std::erase(whitelist, off);
      if (!on) whitelist.push_back(off);
      auto_update = on;
      return answer(base::Value());
    }
    if (op == "setList") {
      const std::string id = *args.FindString("id");
      if (!lists.contains(id)) return error("no list " + id);
      lists[id] = args.Find("enabled")->GetBool();
      return answer(base::Value());
    }
    if (op == "isAllowed") {
      const std::string host = *args.FindString("host");
      return answer(base::Value(std::any_of(whitelist.begin(), whitelist.end(), [&](const auto& d) { return Covers(d, host); })));
    }
    if (op == "setAllowed") {
      const std::string host = *args.FindString("host");
      const bool allowed = args.Find("allowed")->GetBool();
      std::erase_if(whitelist, [&](const auto& d) { return allowed ? d == host : Covers(d, host); });
      if (allowed) whitelist.push_back(host);
      return answer(base::Value());
    }
    return error("unknown operation " + op);
  }
};

inline FakeBridge& Bridge() {
  static FakeBridge bridge;
  return bridge;
}

inline std::map<Profile*, FakeBridge>& Bridges() {
  static std::map<Profile*, FakeBridge> bridges;
  return bridges;
}

inline FakeBridge& BridgeFor(Profile* profile) {
  auto found = Bridges().find(profile);
  return found == Bridges().end() ? Bridge() : found->second;
}

struct LoadBehavior {
  bool auto_load = true;
  std::string commit_instead;
  int fail_code = 0;
  int pages_created = 0;
  int pages_destroyed = 0;
  std::vector<content::WebContents*> live;
};

inline LoadBehavior& Loads() {
  static LoadBehavior loads;
  return loads;
}

inline content::WebContentsObserver::~WebContentsObserver() { Observe(nullptr); }
inline void content::WebContentsObserver::Observe(WebContents* contents) {
  if (observed) observed->observer = nullptr;
  observed = contents;
  if (contents) contents->observer = this;
}

inline std::unique_ptr<content::WebContents> content::WebContents::Create(const CreateParams& params) {
  return std::make_unique<WebContents>(params);
}

inline content::WebContents::WebContents(const CreateParams& params) : profile(params.profile), hidden(params.initially_hidden) {
  controller_.contents = this;
  frame_.contents = this;
  ++Loads().pages_created;
  Loads().live.push_back(this);
}

inline content::WebContents::~WebContents() {
  if (notifying) {
    std::fprintf(stderr, "CHECK failed: !observers_.is_notifying_observers()\n");
    std::abort();
  }
  *alive = false;
  if (observer) observer->observed = nullptr;
  ++Loads().pages_destroyed;
  std::erase(Loads().live, this);
}

inline void content::NavigationController::LoadURLWithParams(const LoadURLParams& params) {
  assert(params.transition_type == ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  contents->requested = params.url;
  if (!Loads().auto_load) return;
  WebContents* target = contents;
  std::shared_ptr<bool> alive = target->alive;
  base::PostTask(base::OnceClosure([target, alive, url = params.url]() {
    if (!*alive) return;
    if (Loads().fail_code) return target->FailLoad(Loads().fail_code);
    target->Commit(Loads().commit_instead.empty() ? url : GURL(Loads().commit_instead));
    if (*alive) target->FinishLoad();
  }));
}

inline void content::RenderFrameHost::ExecuteJavaScriptInIsolatedWorld(const std::u16string& script16,
                                                                     JavaScriptResultCallback callback, int world) {
  assert(world == ISOLATED_WORLD_ID_CHROME_INTERNAL);
  assert(live);
  const std::string script = base::UTF16ToUTF8(script16);
  std::shared_ptr<bool> alive = contents->alive;
  WebContents* owner = contents;
  FakeBridge& bridge = BridgeFor(owner->profile);
  base::Value result;
  if (script.find("data-ardia-request") != std::string::npos && script.find("setAttribute") != std::string::npos) {
    const std::string marker = "root.setAttribute('data-ardia-request', ";
    const size_t start = script.find(marker) + marker.size();
    const size_t end = script.rfind(");return 'sent';");
    auto literal = base::JSONReader::Read(script.substr(start, end - start), 0);
    assert(literal && literal->is_string());
    auto request = base::JSONReader::Read(literal->GetString(), 0);
    assert(request && request->is_dict());
    if (bridge.mode == FakeBridge::Mode::kNotReady) {
      result = base::Value("bridge not ready");
    } else if (bridge.mode == FakeBridge::Mode::kCrashOnSend) {
      bridge.mode = FakeBridge::Mode::kAnswer;
      base::PostTask(base::OnceClosure([owner, alive]() {
        if (*alive) owner->Crash();
      }));
      result = base::Value("sent");
    } else {
      bridge.reply.reset();
      if (bridge.mode == FakeBridge::Mode::kAnswer) bridge.reply = bridge.Handle(request->GetDict());
      else if (bridge.mode == FakeBridge::Mode::kDropFirstReply) {
        bridge.Handle(request->GetDict());
        bridge.mode = FakeBridge::Mode::kAnswer;
      } else {
        ++bridge.requests;
      }
      result = base::Value("sent");
      if (bridge.on_send) bridge.on_send();
    }
    ++bridge.sends_answered;
  } else {
    assert(script.find("getAttribute('data-ardia-reply')") != std::string::npos);
    ++bridge.polls;
    if (bridge.reply) result = base::Value(*bridge.reply);
  }
  base::PostTask(base::OnceClosure([callback = std::move(callback), result = std::move(result), alive]() mutable {
    std::move(callback).Run(std::move(result));
  }));
}

using ac_engine_reply_t = void (*)(void* context, const char* json);
void ac_engine_call(const char* name, const char* profile_dir, const char* args_json, ac_engine_reply_t reply, void* context);
