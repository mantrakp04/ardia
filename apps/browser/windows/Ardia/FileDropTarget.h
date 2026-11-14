#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <iterator>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <commctrl.h>
#include <ole2.h>

#include "Events.h"
#include "FileDropItems.h"
#include "LaunchLog.h"
#include "LaunchConfig.h"
#include "Paths.h"
#include "WindowManager.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "ole32.lib")

namespace Ardia::FileDropParts {

struct DropArea {
  std::string key;
  double depth{0};
  uint64_t order{0};
  double x{0};
  double y{0};
  double width{0};
  double height{0};
  AcceptMode mode{AcceptMode::Links};
  bool enabled{true};

  bool Contains(double pointX, double pointY) const noexcept {
    return pointX >= x && pointY >= y && pointX < x + width && pointY < y + height;
  }
};

struct DropSession {
  bool active{false};
  bool dev{false};
  DropPayload payload;
  DWORD allowed{DROPEFFECT_NONE};
  std::string area;
  size_t count{0};
  std::map<int, size_t> counts;
  std::optional<std::array<double, 2>> lastMove;
};

struct WindowDrops {
  std::string id;
  HWND hwnd{nullptr};
  winrt::com_ptr<::IDropTarget> target;
  std::vector<HWND> registered;
  std::vector<std::wstring> childClasses;
  int replaced{0};
  bool logged{false};
  std::map<std::string, DropArea, std::less<>> areas;
  DropSession session;
};

struct DropTarget : winrt::implements<DropTarget, ::IDropTarget> {
  explicit DropTarget(std::string windowId) noexcept : m_windowId(std::move(windowId)) {}

  HRESULT __stdcall DragEnter(IDataObject *data, DWORD, POINTL point, DWORD *effect) noexcept override;
  HRESULT __stdcall DragOver(DWORD, POINTL point, DWORD *effect) noexcept override;
  HRESULT __stdcall DragLeave() noexcept override;
  HRESULT __stdcall Drop(IDataObject *data, DWORD, POINTL point, DWORD *effect) noexcept override;

 private:
  std::string m_windowId;
};

struct DropHub {
  static DropHub &Shared() noexcept {
    static DropHub *shared = new DropHub();
    return *shared;
  }

  static bool DevAvailable() noexcept {
#if _DEBUG
    return true;
#else
    static const bool available = Paths::HasSwitch(L"--self-check") && AppLaunch::Shared().testInstance;
    return available;
#endif
  }

  void Attach(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  void SetArea(std::string const &windowId, DropArea area) noexcept {
    WindowDrops *window = Window(windowId);
    if (!window) return;
    auto existing = window->areas.find(area.key);
    area.order = existing == window->areas.end() ? ++m_order : existing->second.order;
    std::string key = area.key;
    window->areas.insert_or_assign(std::move(key), std::move(area));
    EnsureRegistered(*window);
  }

  void RemoveArea(std::string const &windowId, std::string const &key) noexcept {
    for (auto &[id, window] : m_windows) {
      if (!windowId.empty() && id != windowId) continue;
      window.areas.erase(key);
      if (window.session.area == key) {
        window.session.area.clear();
        window.session.count = 0;
      }
    }
  }

  DWORD Enter(std::string const &windowId, DropPayload payload, DWORD allowed, POINTL screen, bool dev) noexcept {
    WindowDrops *window = Window(windowId);
    if (!window || !window->hwnd) return DROPEFFECT_NONE;
    auto [x, y] = Dips(window->hwnd, screen);
    return EnterAt(*window, std::move(payload), allowed, x, y, dev);
  }

  DWORD Over(std::string const &windowId, POINTL screen) noexcept {
    WindowDrops *window = Find(windowId);
    if (!window || !window->hwnd || !window->session.active) return DROPEFFECT_NONE;
    auto [x, y] = Dips(window->hwnd, screen);
    return Track(*window, x, y, true);
  }

  void Leave(std::string const &windowId) noexcept {
    if (WindowDrops *window = Find(windowId)) LeaveSession(*window);
  }

  DWORD Dropped(std::string const &windowId, DropPayload payload, POINTL screen) noexcept {
    WindowDrops *window = Find(windowId);
    if (!window || !window->hwnd || !window->session.active) return DROPEFFECT_NONE;
    auto [x, y] = Dips(window->hwnd, screen);
    if (!payload.Empty()) window->session.payload = std::move(payload);
    return DropAt(*window, x, y);
  }

  std::string DevDrag(std::string const &windowId, std::string const &action, double x, double y, std::optional<DropPayload> payload) noexcept {
    if (!DevAvailable()) return "debug builds only";
    WindowDrops *window = Window(windowId);
    if (!window || !window->hwnd) return "no window";
    DropSession &session = window->session;
    if (action == "cancel" || action == "end") {
      if (action == "cancel") LeaveSession(*window);
      else session = DropSession{};
      return action == "cancel" ? "cancelled" : "ended";
    }
    bool fresh = payload && !payload->Empty();
    if (!session.active && !fresh) return payload ? "nothing to drag" : "no drag";
    DWORD effect = DROPEFFECT_NONE;
    if (fresh) {
      if (session.active) LeaveSession(*window);
      effect = EnterAt(*window, std::move(*payload), DROPEFFECT_COPY | DROPEFFECT_LINK | DROPEFFECT_MOVE, x, y, true);
    } else {
      effect = Track(*window, x, y, true);
    }
    std::string target = session.area.empty() ? std::string{"none"} : "area:" + session.area;
    if (action != "drop") return target + " " + EffectName(effect);
    if (effect == DROPEFFECT_NONE) {
      LeaveSession(*window);
      return target + " refused";
    }
    DWORD dropped = DropAt(*window, x, y);
    return target + (dropped == DROPEFFECT_NONE ? " declined" : " performed");
  }

  std::optional<winrt::Microsoft::ReactNative::JSValueObject> DevTarget(std::string const &windowId) noexcept {
    WindowDrops *window = Window(windowId);
    if (!window) return std::nullopt;
    EnsureRegistered(*window);
    winrt::Microsoft::ReactNative::JSValueObject report;
    report["ole"] = OleReady();
    report["registered"] = window->hwnd && std::find(window->registered.begin(), window->registered.end(), window->hwnd) != window->registered.end();
    report["windows"] = static_cast<int64_t>(window->registered.size());
    report["replaced"] = static_cast<int64_t>(window->replaced);
    report["areas"] = static_cast<int64_t>(window->areas.size());
    winrt::Microsoft::ReactNative::JSValueArray classes;
    for (std::wstring const &name : window->childClasses) classes.push_back(Paths::Utf8(name));
    report["childClasses"] = std::move(classes);
    return report;
  }

  void Forget(HWND hwnd) noexcept {
    for (auto it = m_windows.begin(); it != m_windows.end(); ++it) {
      if (it->second.hwnd != hwnd) continue;
      Revoke(it->second);
      m_windows.erase(it);
      return;
    }
  }

 private:
  static constexpr UINT_PTR kDropSubclassId = 0xA2D1D;

  static bool OleReady() noexcept {
    static const bool ready = [] {
      HRESULT result = OleInitialize(nullptr);
      if (FAILED(result)) LaunchLog::Write(L"error", std::wstring(L"file drops: OleInitialize failed, 0x").append(Hex(result)).append(L"; drops are off"));
      return SUCCEEDED(result);
    }();
    return ready;
  }

  static std::wstring Hex(HRESULT result) noexcept {
    wchar_t buffer[16]{};
    swprintf_s(buffer, L"%08X", static_cast<unsigned int>(result));
    return buffer;
  }

  static std::string EffectName(DWORD effect) noexcept {
    if (effect & DROPEFFECT_COPY) return "copy";
    if (effect & DROPEFFECT_LINK) return "link";
    return "none";
  }

  static std::array<double, 2> Dips(HWND hwnd, POINTL screen) noexcept {
    POINT point{screen.x, screen.y};
    ScreenToClient(hwnd, &point);
    double scale = WindowManager::Scale(hwnd);
    return {point.x / scale, point.y / scale};
  }

  static DWORD EffectFor(size_t count, DWORD allowed) noexcept {
    if (count == 0) return DROPEFFECT_NONE;
    if (allowed & DROPEFFECT_COPY) return DROPEFFECT_COPY;
    if (allowed & DROPEFFECT_LINK) return DROPEFFECT_LINK;
    return DROPEFFECT_NONE;
  }

  WindowDrops *Find(std::string_view windowId) noexcept {
    auto found = m_windows.find(std::string{windowId});
    return found == m_windows.end() ? nullptr : &found->second;
  }

  std::string ResolvedId(std::string const &windowId) const noexcept {
    if (!windowId.empty()) return windowId;
    std::vector<std::string> ids = WindowManager::Shared().Ids();
    return ids.size() == 1 ? ids.front() : std::string{};
  }

  WindowDrops *Window(std::string const &requested) noexcept {
    std::string windowId = ResolvedId(requested);
    if (windowId.empty()) return nullptr;
    HWND hwnd = WindowManager::Shared().Hwnd(windowId);
    WindowDrops *window = Find(windowId);
    if (!hwnd) {
      if (window) {
        Revoke(*window);
        m_windows.erase(windowId);
      }
      return nullptr;
    }
    if (!window) {
      WindowDrops made;
      made.id = windowId;
      window = &m_windows.emplace(windowId, std::move(made)).first->second;
    }
    if (window->hwnd != hwnd) {
      Revoke(*window);
      window->hwnd = hwnd;
    }
    return window;
  }

  static BOOL CALLBACK CollectChild(HWND child, LPARAM collected) noexcept {
    if (GetWindowThreadProcessId(child, nullptr) == GetCurrentThreadId()) reinterpret_cast<std::vector<HWND> *>(collected)->push_back(child);
    return TRUE;
  }

  static std::wstring ClassOf(HWND hwnd) noexcept {
    wchar_t name[128]{};
    int length = GetClassNameW(hwnd, name, static_cast<int>(std::size(name)));
    return std::wstring(name, length > 0 ? static_cast<size_t>(length) : 0);
  }

  bool RegisterOn(WindowDrops &window, HWND hwnd) noexcept {
    if (std::find(window.registered.begin(), window.registered.end(), hwnd) != window.registered.end()) return true;
    HRESULT result = RegisterDragDrop(hwnd, window.target.get());
    if (result == DRAGDROP_E_ALREADYREGISTERED) {
      window.replaced++;
      RevokeDragDrop(hwnd);
      result = RegisterDragDrop(hwnd, window.target.get());
    }
    if (FAILED(result)) {
      LaunchLog::Write(L"warning", std::wstring(L"file drops: RegisterDragDrop failed on a ").append(ClassOf(hwnd)).append(L" window of ").append(Paths::Wide(window.id)).append(L", 0x").append(Hex(result)));
      return false;
    }
    window.registered.push_back(hwnd);
    return true;
  }

  void EnsureRegistered(WindowDrops &window) noexcept {
    if (!window.hwnd || !OleReady()) return;
    try {
      if (!window.target) window.target = winrt::make_self<DropTarget>(window.id).as<::IDropTarget>();
    } catch (...) {
      return;
    }
    bool topLevel = RegisterOn(window, window.hwnd);
    if (topLevel && window.registered.size() == 1) SetWindowSubclass(window.hwnd, &DropHub::WindowProc, kDropSubclassId, 0);
    std::vector<HWND> children;
    EnumChildWindows(window.hwnd, &DropHub::CollectChild, reinterpret_cast<LPARAM>(&children));
    for (HWND child : children) {
      bool known = std::find(window.registered.begin(), window.registered.end(), child) != window.registered.end();
      if (known) continue;
      if (RegisterOn(window, child)) window.childClasses.push_back(ClassOf(child));
    }
    if (window.logged || !topLevel) return;
    window.logged = true;
    std::wstring classes;
    for (std::wstring const &name : window.childClasses) classes.append(classes.empty() ? L"" : L", ").append(name);
    LaunchLog::Write(L"info", std::wstring(L"file drops: window ").append(Paths::Wide(window.id)).append(L" takes OLE drops on its top-level window and ")
        .append(std::to_wstring(window.childClasses.size())).append(L" child windows (").append(classes.empty() ? L"none" : classes)
        .append(L"); ").append(std::to_wstring(window.replaced)).append(L" had a drop target that was replaced"));
  }

  void Revoke(WindowDrops &window) noexcept {
    for (HWND hwnd : window.registered) {
      if (IsWindow(hwnd)) RevokeDragDrop(hwnd);
    }
    if (window.hwnd && IsWindow(window.hwnd)) RemoveWindowSubclass(window.hwnd, &DropHub::WindowProc, kDropSubclassId);
    window.registered.clear();
    window.childClasses.clear();
    window.replaced = 0;
    window.logged = false;
    window.session = DropSession{};
  }

  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) noexcept {
    if (message == WM_DESTROY) DropHub::Shared().Forget(hwnd);
    return DefSubclassProc(hwnd, message, wParam, lParam);
  }

  DropArea const *AreaAt(WindowDrops const &window, double x, double y) const noexcept {
    DropArea const *best = nullptr;
    for (auto const &[key, area] : window.areas) {
      if (!area.enabled || !area.Contains(x, y)) continue;
      if (!best || area.depth > best->depth || (area.depth == best->depth && area.order > best->order)) best = &area;
    }
    return best;
  }

  size_t CountFor(DropSession &session, AcceptMode mode) noexcept {
    int index = static_cast<int>(mode);
    auto cached = session.counts.find(index);
    if (cached != session.counts.end()) return cached->second;
    size_t count = ItemsFor(session.payload, mode).size();
    session.counts.emplace(index, count);
    return count;
  }

  void EmitArea(WindowDrops const &window, DropArea const *area, std::string const &key, const char *phase, double x, double y, size_t count,
      std::vector<DroppedItem> const &items) noexcept {
    if (!m_context) return;
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["windowId"] = window.id;
    event["area"] = key;
    event["phase"] = phase;
    event["x"] = area ? x - area->x : 0.0;
    event["y"] = area ? y - area->y : 0.0;
    event["windowX"] = x;
    event["windowY"] = y;
    event["count"] = static_cast<int64_t>(count);
    event["items"] = ItemsJson(items);
    EmitEvent(m_context, L"ArdiaFileDrop", L"onWindowDrop", std::move(event));
  }

  void EmitWindow(WindowDrops const &window, const char *phase) noexcept {
    if (!m_context) return;
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["windowId"] = window.id;
    event["phase"] = phase;
    EmitEvent(m_context, L"ArdiaFileDrop", L"onWindowDrag", std::move(event));
  }

  DropArea const *AreaNamed(WindowDrops const &window, std::string const &key) const noexcept {
    auto found = window.areas.find(key);
    return found == window.areas.end() ? nullptr : &found->second;
  }

  DWORD EnterAt(WindowDrops &window, DropPayload payload, DWORD allowed, double x, double y, bool dev) noexcept {
    if (window.session.active) LeaveSession(window);
    window.session = DropSession{};
    window.session.active = true;
    window.session.dev = dev;
    window.session.payload = std::move(payload);
    window.session.allowed = allowed;
    if (!dev && !m_notedSystemDrag) {
      m_notedSystemDrag = true;
      LaunchLog::Write(L"info", std::wstring(L"file drops: a system drag reached window ").append(Paths::Wide(window.id)).append(L" through OLE"));
    }
    EmitWindow(window, "enter");
    return Track(window, x, y, true);
  }

  DWORD Track(WindowDrops &window, double x, double y, bool emitMove) noexcept {
    DropSession &session = window.session;
    DropArea const *area = AreaAt(window, x, y);
    std::string key = area ? area->key : std::string{};
    if (key != session.area) {
      if (!session.area.empty() && session.count > 0) EmitArea(window, AreaNamed(window, session.area), session.area, "exit", x, y, session.count, {});
      session.area = key;
      session.count = area ? CountFor(session, area->mode) : 0;
      session.lastMove = std::array<double, 2>{x, y};
      if (area && session.count > 0) EmitArea(window, area, key, "enter", x, y, session.count, {});
    } else if (area && session.count > 0 && emitMove) {
      bool moved = !session.lastMove || (*session.lastMove)[0] != x || (*session.lastMove)[1] != y;
      session.lastMove = std::array<double, 2>{x, y};
      if (moved) EmitArea(window, area, key, "move", x, y, session.count, {});
    }
    return EffectFor(session.count, session.allowed);
  }

  void LeaveSession(WindowDrops &window) noexcept {
    DropSession &session = window.session;
    if (!session.active) return;
    if (!session.area.empty() && session.count > 0) {
      auto last = session.lastMove.value_or(std::array<double, 2>{0, 0});
      EmitArea(window, AreaNamed(window, session.area), session.area, "exit", last[0], last[1], session.count, {});
    }
    EmitWindow(window, "exit");
    session = DropSession{};
  }

  DWORD DropAt(WindowDrops &window, double x, double y) noexcept {
    DWORD effect = Track(window, x, y, false);
    DropSession &session = window.session;
    DropArea const *area = AreaNamed(window, session.area);
    if (effect == DROPEFFECT_NONE || !area || !area->enabled) {
      LeaveSession(window);
      return DROPEFFECT_NONE;
    }
    std::vector<DroppedItem> items = ItemsFor(session.payload, area->mode);
    EmitArea(window, area, session.area, "drop", x, y, session.count, items);
    size_t files = static_cast<size_t>(std::count_if(items.begin(), items.end(), [](DroppedItem const &item) noexcept { return item.kind == "file"; }));
    size_t links = static_cast<size_t>(std::count_if(items.begin(), items.end(), [](DroppedItem const &item) noexcept { return item.kind == "url"; }));
    LaunchLog::Write(L"info", std::wstring(L"file drops: ").append(session.dev ? L"a dev drop" : L"a drop").append(L" on window ").append(Paths::Wide(window.id))
        .append(L" gave ").append(std::to_wstring(files)).append(L" files, ").append(std::to_wstring(links)).append(L" links, ")
        .append(std::to_wstring(items.size() - files - links)).append(L" texts"));
    EmitWindow(window, "exit");
    session = DropSession{};
    return items.empty() ? DROPEFFECT_NONE : effect;
  }

  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  std::map<std::string, WindowDrops, std::less<>> m_windows;
  uint64_t m_order{0};
  bool m_notedSystemDrag{false};
};

inline HRESULT __stdcall DropTarget::DragEnter(IDataObject *data, DWORD, POINTL point, DWORD *effect) noexcept {
  if (!effect) return E_INVALIDARG;
  *effect = DropHub::Shared().Enter(m_windowId, PayloadFrom(data), *effect, point, false);
  return S_OK;
}

inline HRESULT __stdcall DropTarget::DragOver(DWORD, POINTL point, DWORD *effect) noexcept {
  if (!effect) return E_INVALIDARG;
  DWORD chosen = DropHub::Shared().Over(m_windowId, point);
  *effect = chosen & *effect;
  return S_OK;
}

inline HRESULT __stdcall DropTarget::DragLeave() noexcept {
  DropHub::Shared().Leave(m_windowId);
  return S_OK;
}

inline HRESULT __stdcall DropTarget::Drop(IDataObject *data, DWORD, POINTL point, DWORD *effect) noexcept {
  if (!effect) return E_INVALIDARG;
  DWORD chosen = DropHub::Shared().Dropped(m_windowId, PayloadFrom(data), point);
  *effect = chosen & *effect;
  return S_OK;
}

}
