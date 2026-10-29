#pragma once
#include <algorithm>
#include <cassert>
#include <memory>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#define FROM_HERE 0

namespace base {

template <class> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
  struct Target {
    virtual ~Target() = default;
    virtual R Run(A... args) = 0;
  };
  template <class F> struct Callable : Target {
    F fn;
    explicit Callable(F value) : fn(std::move(value)) {}
    R Run(A... args) override { return fn(std::forward<A>(args)...); }
  };
  std::unique_ptr<Target> fn_;

 public:
  OnceCallback() = default;
  template <class F> OnceCallback(F fn) : fn_(std::make_unique<Callable<F>>(std::move(fn))) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  explicit operator bool() const { return !!fn_; }
  R Run(A... args) && {
    auto fn = std::move(fn_);
    assert(fn);
    return fn->Run(std::forward<A>(args)...);
  }
};
using OnceClosure = OnceCallback<void()>;

template <class T> struct UnretainedWrapper { T* value; };
template <class T> UnretainedWrapper<T> Unretained(T* value) { return {value}; }

template <class C, class... A, class... B>
OnceClosure BindOnce(void (C::*fn)(A...), UnretainedWrapper<C> target, B... bound) {
  return OnceClosure([fn, target, bound = std::make_tuple(std::move(bound)...)]() mutable {
    std::apply([&](auto&&... values) { (target.value->*fn)(std::move(values)...); }, std::move(bound));
  });
}

class TimeDelta {
 public:
  constexpr explicit TimeDelta(long long ms = 0) : ms_(ms) {}
  constexpr long long InMilliseconds() const { return ms_; }

 private:
  long long ms_;
};
constexpr TimeDelta Seconds(long long seconds) { return TimeDelta(seconds * 1000); }

class Time {
 public:
  constexpr explicit Time(double ms = 0) : ms_(ms) {}
  constexpr double InMillisecondsFSinceUnixEpoch() const { return ms_; }

 private:
  double ms_;
};

class OneShotTimer;
inline std::vector<OneShotTimer*>& LiveTimers() {
  static std::vector<OneShotTimer*> timers;
  return timers;
}

class OneShotTimer {
 public:
  OneShotTimer() { LiveTimers().push_back(this); }
  ~OneShotTimer() { std::erase(LiveTimers(), this); }
  void Start(int, TimeDelta delay, OnceClosure task) {
    delay_ = delay;
    task_ = std::move(task);
  }
  bool IsRunning() const { return !!task_; }
  TimeDelta delay() const { return delay_; }
  void Fire() {
    auto task = std::move(task_);
    if (task) std::move(task).Run();
  }

 private:
  TimeDelta delay_;
  OnceClosure task_;
};

class FilePath {
 public:
  FilePath() = default;
  explicit FilePath(std::string value) : value_(std::move(value)) {}
  const std::string& value() const { return value_; }

 private:
  std::string value_;
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

}

namespace download {

class DownloadItem {
 public:
  enum DownloadState { IN_PROGRESS, COMPLETE, CANCELLED, INTERRUPTED };
  struct Spec {
    std::string guid;
    DownloadState state = COMPLETE;
    std::string target;
    double start_ms = 0;
    bool dangerous = false;
    bool insecure = false;
    bool listed = true;
  };
  DownloadItem(Spec spec, std::vector<std::unique_ptr<DownloadItem>>* owner)
      : spec_(std::move(spec)), target_(spec_.target), owner_(owner) {}
  DownloadState GetState() const { return spec_.state; }
  const std::string& GetGuid() const { return spec_.guid; }
  const base::FilePath& GetTargetFilePath() const { return target_; }
  bool IsDangerous() const { return spec_.dangerous; }
  bool IsInsecure() const { return spec_.insecure; }
  base::Time GetStartTime() const { return base::Time(spec_.start_ms); }
  bool listed() const { return spec_.listed; }
  void Remove() {
    auto* owner = owner_;
    std::erase_if(*owner, [this](const auto& item) { return item.get() == this; });
  }

 private:
  Spec spec_;
  base::FilePath target_;
  std::vector<std::unique_ptr<DownloadItem>>* owner_;
};

}

namespace content {

class DownloadManager {
 public:
  using DownloadVector = std::vector<download::DownloadItem*>;
  class Observer {
   public:
    virtual ~Observer() = default;
    virtual void OnManagerInitialized() {}
    virtual void ManagerGoingDown(DownloadManager*) {}
  };
  bool IsManagerInitialized() { return initialized; }
  void AddObserver(Observer* observer) { observers.push_back(observer); }
  void RemoveObserver(Observer* observer) { std::erase(observers, observer); }
  void GetAllDownloads(DownloadVector* downloads) {
    for (const auto& item : items) downloads->push_back(item.get());
  }
  download::DownloadItem* GetDownloadByGuid(const std::string& guid) {
    for (const auto& item : items) {
      if (item->GetGuid() == guid) return item.get();
    }
    return nullptr;
  }
  void Add(download::DownloadItem::Spec spec) { items.push_back(std::make_unique<download::DownloadItem>(std::move(spec), &items)); }
  void Initialize() {
    initialized = true;
    for (auto* observer : std::vector<Observer*>(observers)) observer->OnManagerInitialized();
  }
  void GoDown() {
    for (auto* observer : std::vector<Observer*>(observers)) observer->ManagerGoingDown(this);
  }
  bool initialized = false;
  std::vector<Observer*> observers;
  std::vector<std::unique_ptr<download::DownloadItem>> items;
};

}
