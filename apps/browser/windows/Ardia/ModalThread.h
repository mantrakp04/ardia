#pragma once

#include <objbase.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <set>
#include <thread>
#include <utility>

namespace Ardia::DialogParts {

constexpr UINT OwnerWatchMs = 250;

struct ModalRegistry {
  std::mutex lock;
  std::condition_variable freed;
  std::set<HWND> busy;
  std::atomic<uint64_t> releases{0};
  std::atomic<bool> stopping{false};
  std::atomic<int> threads{0};

  static ModalRegistry &Shared() noexcept {
    static ModalRegistry *registry = new ModalRegistry();
    return *registry;
  }
};

inline bool Stopping() noexcept {
  return ModalRegistry::Shared().stopping.load();
}

inline void StopAllModals() noexcept {
  ModalRegistry &registry = ModalRegistry::Shared();
  registry.stopping = true;
  registry.freed.notify_all();
}

inline void ReleaseAllModals() noexcept {
  ModalRegistry::Shared().releases++;
}

struct OwnerSlot {
  explicit OwnerSlot(HWND owner) noexcept : m_owner(owner) {
    if (!owner) return;
    ModalRegistry &registry = ModalRegistry::Shared();
    std::unique_lock<std::mutex> guard(registry.lock);
    while (!registry.stopping.load() && IsWindow(owner) && registry.busy.contains(owner)) registry.freed.wait_for(guard, std::chrono::milliseconds(OwnerWatchMs));
    m_held = !registry.stopping.load() && IsWindow(owner) && registry.busy.insert(owner).second;
  }
  ~OwnerSlot() noexcept {
    if (!m_held) return;
    ModalRegistry &registry = ModalRegistry::Shared();
    {
      std::lock_guard<std::mutex> guard(registry.lock);
      registry.busy.erase(m_owner);
    }
    registry.freed.notify_all();
  }
  OwnerSlot(OwnerSlot const &) = delete;
  OwnerSlot &operator=(OwnerSlot const &) = delete;

  bool Usable() const noexcept { return !m_owner || m_held; }

 private:
  HWND m_owner;
  bool m_held = false;
};

struct ModalWatchState {
  HWND owner = nullptr;
  uint64_t release = 0;
  std::function<void()> abandon;
};

inline ModalWatchState &WatchState() noexcept {
  thread_local ModalWatchState state;
  return state;
}

inline void CALLBACK WatchOwner(HWND, UINT, UINT_PTR, DWORD) noexcept {
  ModalWatchState &state = WatchState();
  bool ownerGone = state.owner && !IsWindow(state.owner);
  bool released = ModalRegistry::Shared().releases.load() != state.release;
  if (!ownerGone && !released && !Stopping()) return;
  std::function<void()> abandon = std::move(state.abandon);
  state.abandon = nullptr;
  if (abandon) abandon();
}

struct ModalWatch {
  explicit ModalWatch(HWND owner) noexcept {
    ModalWatchState &state = WatchState();
    state.owner = owner;
    state.release = ModalRegistry::Shared().releases.load();
    state.abandon = nullptr;
    m_timer = SetTimer(nullptr, 0, OwnerWatchMs, &WatchOwner);
  }
  ~ModalWatch() noexcept {
    if (m_timer) KillTimer(nullptr, m_timer);
    ModalWatchState &state = WatchState();
    state.owner = nullptr;
    state.abandon = nullptr;
  }
  ModalWatch(ModalWatch const &) = delete;
  ModalWatch &operator=(ModalWatch const &) = delete;

  static void OnAbandon(std::function<void()> abandon) noexcept { WatchState().abandon = std::move(abandon); }

 private:
  UINT_PTR m_timer = 0;
};

struct ComApartment {
  bool owned = false;
  ComApartment() noexcept {
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    owned = SUCCEEDED(result);
  }
  ~ComApartment() noexcept {
    if (owned) CoUninitialize();
  }
  ComApartment(ComApartment const &) = delete;
  ComApartment &operator=(ComApartment const &) = delete;
};

template <class TShow>
bool RunModal(HWND owner, TShow &&show) noexcept {
  if (Stopping()) return false;
  try {
    ModalRegistry::Shared().threads++;
    std::thread([owner, show = std::forward<TShow>(show)]() mutable noexcept {
      {
        ComApartment apartment;
        OwnerSlot slot(owner);
        show(slot.Usable() && !Stopping());
      }
      ModalRegistry::Shared().threads--;
    }).detach();
    return true;
  } catch (...) {
    ModalRegistry::Shared().threads--;
    return false;
  }
}

}
