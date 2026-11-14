#pragma once

#include <objbase.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <map>
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

constexpr int StopWaitMs = 2000;

inline void StopAllModals() noexcept {
  ModalRegistry &registry = ModalRegistry::Shared();
  registry.stopping = true;
  registry.freed.notify_all();
  for (int waited = 0; registry.threads.load() > 0 && waited < StopWaitMs; waited += 50) Sleep(50);
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
  std::function<void()> tick;
};

inline ModalWatchState &WatchState() noexcept {
  thread_local ModalWatchState state;
  return state;
}

inline void CALLBACK WatchOwner(HWND, UINT, UINT_PTR, DWORD) noexcept {
  ModalWatchState &state = WatchState();
  bool ownerGone = state.owner && !IsWindow(state.owner);
  bool released = ModalRegistry::Shared().releases.load() != state.release;
  if (!ownerGone && !released && !Stopping()) {
    if (state.tick) state.tick();
    return;
  }
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
    state.tick = nullptr;
  }
  ModalWatch(ModalWatch const &) = delete;
  ModalWatch &operator=(ModalWatch const &) = delete;

  static void OnAbandon(std::function<void()> abandon) noexcept { WatchState().abandon = std::move(abandon); }
  static void OnTick(std::function<void()> tick) noexcept { WatchState().tick = std::move(tick); }

 private:
  UINT_PTR m_timer = 0;
};

struct ModalDialogs {
  std::mutex lock;
  std::map<HWND, HWND> byOwner;

  static ModalDialogs &Shared() noexcept {
    static ModalDialogs *dialogs = new ModalDialogs();
    return *dialogs;
  }
};

inline void NoteModalDialog(HWND owner, HWND dialog) noexcept {
  if (!owner) return;
  ModalDialogs &dialogs = ModalDialogs::Shared();
  std::lock_guard<std::mutex> guard(dialogs.lock);
  if (dialog) dialogs.byOwner[owner] = dialog;
  else dialogs.byOwner.erase(owner);
}

inline HWND ModalDialogOf(HWND owner) noexcept {
  ModalDialogs &dialogs = ModalDialogs::Shared();
  std::lock_guard<std::mutex> guard(dialogs.lock);
  auto found = dialogs.byOwner.find(owner);
  return found == dialogs.byOwner.end() ? nullptr : found->second;
}

inline bool BringModalForward(HWND owner) noexcept {
  HWND dialog = ModalDialogOf(owner);
  if (!dialog || !IsWindow(dialog) || !IsWindowVisible(dialog)) return false;
  SetWindowPos(dialog, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
  SetForegroundWindow(dialog);
  return true;
}

constexpr wchar_t ModalParentClass[] = L"ArdiaModalParent";

inline bool RegisterModalParent() noexcept {
  static bool const registered = [] {
    WNDCLASSEXW type{};
    type.cbSize = sizeof(type);
    type.lpfnWndProc = DefWindowProcW;
    type.hInstance = GetModuleHandleW(nullptr);
    type.lpszClassName = ModalParentClass;
    return RegisterClassExW(&type) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  }();
  return registered;
}

struct ModalParent {
  ModalParent(HWND owner, bool givesFocusBack) noexcept : m_owner(owner), m_givesFocusBack(givesFocusBack) {
    if (!owner || !RegisterModalParent()) return;
    RECT area{};
    if (!GetWindowRect(owner, &area)) return;
    m_window = CreateWindowExW(WS_EX_TOOLWINDOW, ModalParentClass, L"", WS_POPUP, area.left, area.top, area.right - area.left, area.bottom - area.top, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    m_ownerWasEnabled = IsWindowEnabled(owner) != FALSE;
    if (m_ownerWasEnabled) EnableWindow(owner, FALSE);
  }
  ~ModalParent() noexcept {
    Release();
    if (m_window) DestroyWindow(m_window);
  }
  ModalParent(ModalParent const &) = delete;
  ModalParent &operator=(ModalParent const &) = delete;

  HWND Handle() const noexcept { return m_window; }

  void KeepDialogAboveOwner() noexcept {
    HWND dialog = Dialog();
    if (!dialog || !m_owner || !IsWindow(m_owner)) return;
    NoteModalDialog(m_owner, dialog);
    bool above = false;
    for (HWND higher = GetWindow(m_owner, GW_HWNDPREV); higher && !above; higher = GetWindow(higher, GW_HWNDPREV)) above = higher == dialog;
    if (!above) {
      HWND justAbove = GetWindow(m_owner, GW_HWNDPREV);
      SetWindowPos(dialog, justAbove ? justAbove : HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    if (GetForegroundWindow() == m_owner) SetForegroundWindow(dialog);
  }

  void Release() noexcept {
    if (m_released) return;
    m_released = true;
    NoteModalDialog(m_owner, nullptr);
    if (!m_owner || !IsWindow(m_owner) || !m_ownerWasEnabled) return;
    bool hadFocus = m_givesFocusBack && OursInFront();
    EnableWindow(m_owner, TRUE);
    if (hadFocus) SetForegroundWindow(m_owner);
  }

  HWND Dialog() const noexcept {
    if (!m_window) return nullptr;
    HWND found = nullptr;
    auto visit = [](HWND window, LPARAM data) noexcept -> BOOL {
      auto *self = reinterpret_cast<std::pair<HWND, HWND> *>(data);
      if (GetWindow(window, GW_OWNER) != self->first || !IsWindowVisible(window)) return TRUE;
      self->second = window;
      return FALSE;
    };
    std::pair<HWND, HWND> search{m_window, nullptr};
    EnumThreadWindows(GetCurrentThreadId(), visit, reinterpret_cast<LPARAM>(&search));
    found = search.second;
    return found;
  }

 private:
  bool OursInFront() const noexcept {
    HWND front = GetForegroundWindow();
    if (!front || front == m_window) return true;
    DWORD process = 0;
    GetWindowThreadProcessId(front, &process);
    return process == GetCurrentProcessId();
  }

  HWND m_owner;
  bool m_givesFocusBack;
  HWND m_window = nullptr;
  bool m_ownerWasEnabled = false;
  bool m_released = false;
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
      SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
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
