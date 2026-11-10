#pragma once

#include <powrprof.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "NativeModules.h"

#include "AppModule.h"
#include "Events.h"

#pragma comment(lib, "powrprof.lib")
#pragma comment(lib, "user32.lib")

namespace Ardia {

namespace SystemSignalsParts {

constexpr wchar_t ModuleName[] = L"ArdiaSystemSignals";
constexpr wchar_t SignalEvent[] = L"onSystemSignal";

inline std::atomic<bool> &HoldsIncomingLinks() noexcept {
  static std::atomic<bool> holds{false};
  return holds;
}

inline double IdleSeconds() noexcept {
  LASTINPUTINFO input{};
  input.cbSize = sizeof(input);
  if (!GetLastInputInfo(&input)) return 0;
  return static_cast<double>(GetTickCount() - input.dwTime) / 1000.0;
}

class SignalState {
 public:
  void Attach(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  void SetAsleep(bool asleep) noexcept {
    {
      std::scoped_lock lock{m_mutex};
      if (asleep == m_asleep) return;
      m_asleep = asleep;
    }
    Send(asleep ? "sleep" : "wake", 0, false, false);
  }

  void WatchIdle(std::vector<double> const &thresholds) noexcept {
    std::scoped_lock lock{m_mutex};
    if (m_stopping) return;
    std::map<double, bool> next;
    for (double threshold : thresholds) {
      if (!std::isfinite(threshold) || threshold <= 0) continue;
      auto previous = m_idleByThreshold.find(threshold);
      next[threshold] = previous != m_idleByThreshold.end() && previous->second;
    }
    m_idleByThreshold = std::move(next);
    if (!m_idleByThreshold.empty() && !m_idleThread.joinable()) {
      try {
        m_idleThread = std::thread([this]() noexcept { IdleLoop(); });
      } catch (...) {
      }
    }
    m_wake.notify_all();
  }

  void Stop() noexcept {
    {
      std::scoped_lock lock{m_mutex};
      m_stopping = true;
      m_idleByThreshold.clear();
    }
    m_wake.notify_all();
    if (m_idleThread.joinable()) {
      try {
        m_idleThread.join();
      } catch (...) {
      }
    }
  }

 private:
  void IdleLoop() noexcept {
    try {
      std::unique_lock lock{m_mutex};
      while (!m_stopping) {
        if (m_idleByThreshold.empty()) {
          m_wake.wait(lock);
          continue;
        }
        double idle = IdleSeconds();
        for (auto &[threshold, was] : m_idleByThreshold) {
          if ((idle >= threshold) == was) continue;
          was = !was;
          Send("idle", threshold, was, true);
        }
        m_wake.wait_for(lock, std::chrono::duration<double>(NextCheck(idle)));
      }
    } catch (...) {
    }
  }

  double NextCheck(double idle) const noexcept {
    double delay = std::numeric_limits<double>::infinity();
    bool anyIdle = false;
    for (auto const &[threshold, isIdle] : m_idleByThreshold) {
      if (isIdle) anyIdle = true;
      else delay = std::min(delay, threshold - idle);
    }
    if (anyIdle) delay = std::min(delay, std::min(std::max(m_idleByThreshold.begin()->first / 4, 0.5), 2.0));
    return std::min(std::max(delay, 0.25), 60.0);
  }

  void Send(char const *type, double threshold, bool idle, bool withIdle) noexcept {
    winrt::Microsoft::ReactNative::ReactContext context = m_context;
    if (!context) return;
    winrt::Microsoft::ReactNative::JSValueObject payload;
    payload["type"] = winrt::Microsoft::ReactNative::JSValue{std::string{type}};
    if (withIdle) {
      payload["threshold"] = winrt::Microsoft::ReactNative::JSValue{threshold};
      payload["idle"] = winrt::Microsoft::ReactNative::JSValue{idle};
    }
    EmitEvent(context, ModuleName, SignalEvent, std::move(payload));
  }

  std::mutex m_mutex;
  std::condition_variable m_wake;
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  std::map<double, bool> m_idleByThreshold;
  bool m_stopping = false;
  bool m_asleep = false;
  std::thread m_idleThread;
};

struct PowerSubscription {
  std::weak_ptr<SignalState> state;
  DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS parameters{};
};

inline ULONG CALLBACK OnPowerChange(PVOID context, ULONG type, PVOID) noexcept {
  auto *subscription = static_cast<PowerSubscription *>(context);
  if (!subscription) return ERROR_SUCCESS;
  std::shared_ptr<SignalState> state = subscription->state.lock();
  if (!state) return ERROR_SUCCESS;
  if (type == PBT_APMSUSPEND) state->SetAsleep(true);
  else if (type == PBT_APMRESUMEAUTOMATIC || type == PBT_APMRESUMESUSPEND) state->SetAsleep(false);
  return ERROR_SUCCESS;
}

}

REACT_MODULE(SystemSignalsModule, L"ArdiaSystemSignals")
struct SystemSignalsModule {
  SystemSignalsModule() noexcept = default;
  SystemSignalsModule(SystemSignalsModule const &) = delete;
  SystemSignalsModule &operator=(SystemSignalsModule const &) = delete;

  ~SystemSignalsModule() noexcept {
    if (m_power) PowerUnregisterSuspendResumeNotification(m_power);
    if (m_state) m_state->Stop();
  }

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    try {
      if (!m_state) m_state = std::make_shared<SystemSignalsParts::SignalState>();
    } catch (...) {
      return;
    }
    m_state->Attach(context);
    if (m_power) return;
    auto *subscription = new (std::nothrow) SystemSignalsParts::PowerSubscription{};
    if (!subscription) return;
    subscription->state = m_state;
    subscription->parameters.Callback = SystemSignalsParts::OnPowerChange;
    subscription->parameters.Context = subscription;
    if (PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK, &subscription->parameters, &m_power) != ERROR_SUCCESS) {
      m_power = nullptr;
      delete subscription;
    }
  }

  REACT_METHOD(watchIdle)
  void watchIdle(std::vector<double> thresholds) noexcept {
    if (m_state) m_state->WatchIdle(thresholds);
  }

  REACT_SYNC_METHOD(holdsIncomingLinks)
  bool holdsIncomingLinks() noexcept {
    return SystemSignalsParts::HoldsIncomingLinks().load();
  }

  REACT_METHOD(setHoldIncomingLinks)
  void setHoldIncomingLinks(bool hold, winrt::Microsoft::ReactNative::JSValue) noexcept {
    SystemSignalsParts::HoldsIncomingLinks().store(hold);
  }

  REACT_METHOD(setApprovedDownloadFolders)
  void setApprovedDownloadFolders(std::vector<std::string> folders) noexcept {
    m_approvedDownloadFolders = std::move(folders);
  }

  REACT_METHOD(moveCompletedDownload)
  void moveCompletedDownload(std::string, std::string, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    winrt::Microsoft::ReactNative::JSValueObject result;
    result["ok"] = winrt::Microsoft::ReactNative::JSValue{false};
    result["reason"] = winrt::Microsoft::ReactNative::JSValue{std::string{"engineUnavailable"}};
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue{std::move(result)});
  }

  REACT_METHOD(devPost)
  void devPost(std::string name, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (!AppLaunch::Shared().isolated || !m_state) return promise.Resolve(false);
    if (name == "willSleep") m_state->SetAsleep(true);
    else if (name == "didWake") m_state->SetAsleep(false);
    else return promise.Resolve(false);
    promise.Resolve(true);
  }

 private:
  std::shared_ptr<SystemSignalsParts::SignalState> m_state;
  HPOWERNOTIFY m_power = nullptr;
  std::vector<std::string> m_approvedDownloadFolders;
};

}
