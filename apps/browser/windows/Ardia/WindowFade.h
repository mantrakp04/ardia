#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>

#include <winrt/Microsoft.UI.Dispatching.h>

namespace Ardia {

struct WindowMotion {
  static constexpr std::chrono::milliseconds kMainEntrance{250};
  static constexpr std::chrono::milliseconds kSmallEntrance{200};
  static constexpr std::chrono::milliseconds kMainExit{180};
  static constexpr std::chrono::milliseconds kSmallExit{150};
  static constexpr std::chrono::milliseconds kRevealTimeout{600};
  static constexpr std::chrono::milliseconds kReplacementSettle{200};
  static constexpr std::chrono::milliseconds kLingerLimit{2000};
  static constexpr std::chrono::milliseconds kStep{8};

  static bool SystemAnimates() noexcept {
    BOOL on = TRUE;
    if (!SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &on, 0)) return true;
    return on != FALSE;
  }

  static double Eased(double progress) noexcept {
    if (!(progress > 0)) return 0;
    if (progress >= 1) return 1;
    constexpr double x1 = 0.23, y1 = 1.0, x2 = 0.32, y2 = 1.0;
    auto bezier = [](double first, double second, double at) noexcept {
      double rest = 1 - at;
      return 3 * rest * rest * at * first + 3 * rest * at * at * second + at * at * at;
    };
    double low = 0;
    double high = 1;
    double at = progress;
    for (int i = 0; i < 32; i++) {
      at = (low + high) / 2;
      double x = bezier(x1, x2, at);
      if (std::abs(x - progress) < 1e-7) break;
      if (x < progress) low = at;
      else high = at;
    }
    return std::clamp(bezier(y1, y2, at), 0.0, 1.0);
  }

  static BYTE Alpha(double opacity) noexcept {
    return static_cast<BYTE>(std::lround(std::clamp(opacity, 0.0, 1.0) * 255.0));
  }
};

struct LayeredWindows {
  LayeredWindows() noexcept = default;
  LayeredWindows(LayeredWindows const &) = delete;
  LayeredWindows &operator=(LayeredWindows const &) = delete;

  ~LayeredWindows() noexcept {
    ReleaseAll();
  }

  void Hold(HWND window, BYTE alpha, bool clickThrough) noexcept {
    if (!window || !IsWindow(window)) return;
    Kept *kept = Track(window);
    if (!kept) return;
    if (clickThrough && !(kept->original & WS_EX_TRANSPARENT) && !(kept->added & WS_EX_TRANSPARENT)) {
      LONG_PTR extended = GetWindowLongPtrW(window, GWL_EXSTYLE);
      SetWindowLongPtrW(window, GWL_EXSTYLE, extended | WS_EX_TRANSPARENT);
      kept->added |= WS_EX_TRANSPARENT;
    }
    SetLayeredWindowAttributes(window, kept->key, Within(*kept, alpha), kept->flags | LWA_ALPHA);
  }

  void Release(HWND window) noexcept {
    auto found = std::find_if(m_kept.begin(), m_kept.end(), [window](Kept const &kept) noexcept { return kept.window == window; });
    if (found == m_kept.end()) return;
    Kept kept = *found;
    m_kept.erase(found);
    Restore(kept);
  }

  void ReleaseAll() noexcept {
    std::vector<Kept> kept = std::move(m_kept);
    m_kept.clear();
    for (auto const &one : kept) Restore(one);
  }

  void ReleaseDeparted(HWND owner) noexcept {
    std::vector<HWND> departed;
    for (auto const &kept : m_kept) {
      if (kept.window == owner) continue;
      if (!IsWindow(kept.window) || GetWindow(kept.window, GW_OWNER) != owner || !IsWindowVisible(kept.window)) departed.push_back(kept.window);
    }
    for (HWND window : departed) Release(window);
  }

  size_t OwnedCount(HWND owner) const noexcept {
    return static_cast<size_t>(std::count_if(m_kept.begin(), m_kept.end(), [owner](Kept const &kept) noexcept { return kept.window != owner; }));
  }

  static std::vector<HWND> VisibleOwnedBy(HWND owner) noexcept {
    OwnedSearch search{owner, GetCurrentProcessId(), {}};
    if (owner) EnumWindows(&LayeredWindows::CollectOwned, reinterpret_cast<LPARAM>(&search));
    return std::move(search.found);
  }

 private:
  struct OwnedSearch {
    HWND owner;
    DWORD process;
    std::vector<HWND> found;
  };

  static BOOL CALLBACK CollectOwned(HWND window, LPARAM reference) noexcept {
    auto *search = reinterpret_cast<OwnedSearch *>(reference);
    if (window == search->owner || GetWindow(window, GW_OWNER) != search->owner || !IsWindowVisible(window)) return TRUE;
    DWORD process = 0;
    GetWindowThreadProcessId(window, &process);
    if (process == search->process) search->found.push_back(window);
    return TRUE;
  }

  struct Kept {
    HWND window{nullptr};
    LONG_PTR original{0};
    LONG_PTR added{0};
    COLORREF key{0};
    BYTE alpha{255};
    DWORD flags{0};
  };

  Kept *Track(HWND window) noexcept {
    for (auto &kept : m_kept) {
      if (kept.window == window) return &kept;
    }
    Kept kept;
    kept.window = window;
    LONG_PTR extended = GetWindowLongPtrW(window, GWL_EXSTYLE);
    kept.original = extended & (WS_EX_LAYERED | WS_EX_TRANSPARENT);
    if (extended & WS_EX_LAYERED) {
      if (!GetLayeredWindowAttributes(window, &kept.key, &kept.alpha, &kept.flags)) return nullptr;
    } else {
      SetWindowLongPtrW(window, GWL_EXSTYLE, extended | WS_EX_LAYERED);
      kept.added = WS_EX_LAYERED;
    }
    m_kept.push_back(kept);
    return &m_kept.back();
  }

  static BYTE Within(Kept const &kept, BYTE alpha) noexcept {
    if (!(kept.flags & LWA_ALPHA)) return alpha;
    return static_cast<BYTE>((static_cast<unsigned>(kept.alpha) * alpha + 127) / 255);
  }

  static void Restore(Kept const &kept) noexcept {
    if (!IsWindow(kept.window)) return;
    if (kept.added & WS_EX_LAYERED) {
      SetLayeredWindowAttributes(kept.window, 0, 255, LWA_ALPHA);
    } else {
      SetLayeredWindowAttributes(kept.window, kept.key, kept.alpha, kept.flags);
    }
    if (kept.added) {
      LONG_PTR extended = GetWindowLongPtrW(kept.window, GWL_EXSTYLE);
      SetWindowLongPtrW(kept.window, GWL_EXSTYLE, extended & ~kept.added);
    }
    if (kept.added & WS_EX_LAYERED) RedrawWindow(kept.window, nullptr, nullptr, RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN);
  }

  std::vector<Kept> m_kept;
};

struct WindowFade {
  enum class Phase { Revealing, Entering, Leaving, Lingering };

  WindowFade() noexcept = default;
  WindowFade(WindowFade const &) = delete;
  WindowFade &operator=(WindowFade const &) = delete;

  ~WindowFade() noexcept {
    StopTimer();
  }

  double Progress(std::chrono::steady_clock::time_point now) const noexcept {
    if (duration.count() <= 0) return 1;
    double elapsed = std::chrono::duration<double, std::milli>(now - started).count();
    return std::clamp(elapsed / static_cast<double>(duration.count()), 0.0, 1.0);
  }

  std::chrono::milliseconds Elapsed(std::chrono::steady_clock::time_point now) const noexcept {
    return std::chrono::duration_cast<std::chrono::milliseconds>(now - started);
  }

  void StopTimer() noexcept {
    if (!timer) return;
    auto stopping = timer;
    timer = nullptr;
    try {
      stopping.Stop();
      stopping.Tick(tick);
    } catch (...) {
    }
  }

  Phase phase{Phase::Revealing};
  HWND hwnd{nullptr};
  double from{0};
  double opacity{0};
  std::chrono::milliseconds duration{0};
  std::chrono::steady_clock::time_point started{};
  LayeredWindows layered;
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer timer{nullptr};
  winrt::event_token tick{};
};

}
