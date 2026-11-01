#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

#define FROM_HERE 0

namespace base {
template <typename Signature> class OnceCallback;
template <typename R, typename... Args> class OnceCallback<R(Args...)> {
 public:
  OnceCallback() = default;
  template <typename F> OnceCallback(F fn) : fn_(std::move(fn)) {}
  explicit operator bool() const { return static_cast<bool>(fn_); }
  R Run(Args... args) {
    auto fn = std::move(fn_);
    fn_ = nullptr;
    return fn(std::forward<Args>(args)...);
  }
 private:
  std::function<R(Args...)> fn_;
};
using OnceClosure = OnceCallback<void()>;
template <typename T> T* Unretained(T* value) { return value; }
template <typename C, typename... Args, typename... Bound>
auto BindOnce(void (C::*fn)(Args...), C* object, Bound... bound) {
  return [fn, object, bound...]() mutable { (object->*fn)(std::move(bound)...); };
}
struct TimeDelta {
  int64_t seconds;
};
constexpr TimeDelta Seconds(int64_t seconds) { return TimeDelta{seconds}; }
class Time {
 public:
  double InMillisecondsFSinceUnixEpoch() const { return ms; }
  double ms = 0;
};
class FilePath {
 public:
  const std::string& value() const { return path; }
  std::string path;
};
class OneShotTimer;
inline OneShotTimer* g_started_timer = nullptr;
class OneShotTimer {
 public:
  ~OneShotTimer() { if (g_started_timer == this) g_started_timer = nullptr; }
  void Start(int, TimeDelta, OnceClosure task) {
    task_ = std::move(task);
    g_started_timer = this;
  }
  bool IsRunning() const { return static_cast<bool>(task_); }
  void Fire() {
    auto task = std::move(task_);
    task_ = OnceClosure();
    task.Run();
  }
 private:
  OnceClosure task_;
};
template <typename Source, typename Observer> class ScopedObservation {
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
}

namespace download {
class DownloadItem {
 public:
  enum DownloadState { IN_PROGRESS, COMPLETE };
  DownloadState GetState() const { return state; }
  bool IsDangerous() const { return false; }
  bool IsInsecure() const { return false; }
  const base::FilePath& GetTargetFilePath() const { return target; }
  base::Time GetStartTime() const { return start; }
  const std::string& GetGuid() const { return guid; }
  void Remove() { removed = true; }
  DownloadState state = COMPLETE;
  base::FilePath target;
  base::Time start;
  std::string guid;
  bool removed = false;
};
}

namespace content {
class DownloadManager {
 public:
  class Observer {
   public:
    virtual ~Observer() = default;
    virtual void OnManagerInitialized() {}
    virtual void ManagerGoingDown(DownloadManager*) {}
  };
  using DownloadVector = std::vector<download::DownloadItem*>;
  void GetAllDownloads(DownloadVector* items) { *items = downloads; }
  download::DownloadItem* GetDownloadByGuid(const std::string& id) {
    for (auto* item : downloads) if (item->GetGuid() == id) return item;
    return nullptr;
  }
  bool IsManagerInitialized() const { return initialized; }
  void AddObserver(Observer* observer) { observers.push_back(observer); }
  void RemoveObserver(Observer* observer) { observers.erase(std::remove(observers.begin(), observers.end(), observer), observers.end()); }
  void Initialize() {
    initialized = true;
    for (auto* observer : std::vector<Observer*>(observers)) observer->OnManagerInitialized();
  }
  void GoDown() {
    for (auto* observer : std::vector<Observer*>(observers)) observer->ManagerGoingDown(this);
  }
  bool initialized = false;
  DownloadVector downloads;
  std::vector<Observer*> observers;
};
}
