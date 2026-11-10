#pragma once

#include "NativeModules.h"

#include "Events.h"
#include "WindowManager.h"

namespace Ardia {

REACT_MODULE(WindowsModule, L"ArdiaAppWindows")
struct WindowsModule {
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<void>;
  using JSValue = winrt::Microsoft::ReactNative::JSValue;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    RunOnUI(context, [context]() noexcept { WindowManager::Shared().Attach(context); });
  }

  REACT_METHOD(openWindow)
  void openWindow(std::string id, JSValue options, Promise promise) noexcept {
    OpenWindowRequest request;
    request.id = std::move(id);
    if (auto kind = options["kind"].TryGetString()) request.kind = *kind;
    if (auto title = options["title"].TryGetString()) request.title = *title;
    if (auto focus = options["focus"].TryGetBoolean()) request.focus = *focus;
    request.frame = Numbers<4>(options["frame"]);
    request.size = Numbers<2>(options["size"]);
    OnUI(promise, [request]() noexcept { WindowManager::Shared().Open(request); });
  }

  REACT_METHOD(closeWindow)
  void closeWindow(std::string id, Promise promise) noexcept {
    OnUI(promise, [id]() noexcept { WindowManager::Shared().Close(id); });
  }

  REACT_METHOD(animateWindowClose)
  void animateWindowClose(std::string id, JSValue, Promise promise) noexcept {
    OnUI(promise, [id]() noexcept { WindowManager::Shared().Hide(id); });
  }

  REACT_METHOD(focusWindow)
  void focusWindow(std::string id, Promise promise) noexcept {
    OnUI(promise, [id]() noexcept { WindowManager::Shared().Focus(id); });
  }

  REACT_METHOD(restoreFullScreen)
  void restoreFullScreen(std::vector<std::string> ids, JSValue focus, Promise promise) noexcept {
    std::optional<std::string> focused;
    if (auto id = focus.TryGetString()) focused = *id;
    OnUI(promise, [ids, focused]() noexcept { WindowManager::Shared().RestoreFullScreen(ids, focused); });
  }

  REACT_METHOD(setTrafficLightsCenter)
  void setTrafficLightsCenter(std::string, JSValue, bool, Promise promise) noexcept {
    promise.Resolve();
  }

  REACT_METHOD(setWindowTitle)
  void setWindowTitle(std::string id, std::string title, Promise promise) noexcept {
    OnUI(promise, [id, title]() noexcept { WindowManager::Shared().SetTitle(id, title); });
  }

  REACT_METHOD(windowFrame)
  void windowFrame(std::string id, winrt::Microsoft::ReactNative::ReactPromise<JSValue> promise) noexcept {
    RunOnUI(m_context, [id, promise]() noexcept {
      auto frame = WindowManager::Shared().Frame(id);
      if (!frame) return promise.Resolve(JSValue{nullptr});
      winrt::Microsoft::ReactNative::JSValueArray values;
      for (double value : *frame) values.push_back(value);
      promise.Resolve(JSValue{std::move(values)});
    });
  }

  REACT_METHOD(windowIds)
  void windowIds(winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept { promise.Resolve(WindowManager::Shared().Ids()); });
  }

  REACT_METHOD(replyToTerminate)
  void replyToTerminate(bool ok, Promise promise) noexcept {
    OnUI(promise, [ok]() noexcept { WindowManager::Shared().ReplyToTerminate(ok); });
  }

  REACT_METHOD(beginWindowDrag)
  void beginWindowDrag(double rootTag, Promise promise) noexcept {
    OnUI(promise, [rootTag]() noexcept { WindowManager::Shared().BeginDrag(static_cast<int64_t>(rootTag)); });
  }

  REACT_METHOD(pressDragArea)
  void pressDragArea(double rootTag, Promise promise) noexcept {
    OnUI(promise, [rootTag]() noexcept { WindowManager::Shared().PressDragArea(static_cast<int64_t>(rootTag)); });
  }

  REACT_METHOD(setTitleBand)
  void setTitleBand(std::string id, std::string mode, Promise promise) noexcept {
    bool caption = mode == "caption";
    OnUI(promise, [id, caption]() noexcept { WindowManager::Shared().SetTitleBand(id, caption); });
  }

  REACT_METHOD(debugDragRegions)
  void debugDragRegions(std::string id, winrt::Microsoft::ReactNative::ReactPromise<JSValue> promise) noexcept {
    RunOnUI(m_context, [id, promise]() noexcept {
      auto report = WindowManager::Shared().DebugRegions(id);
      if (!report) return promise.Resolve(JSValue{nullptr});
      promise.Resolve(JSValue{std::move(*report)});
    });
  }

  REACT_METHOD(watchSidebarEdge)
  void watchSidebarEdge(std::string id, bool on, double, bool, bool, Promise promise) noexcept {
    std::wstring message = std::wstring(L"sidebar edge watch ").append(on ? L"on " : L"off ").append(Paths::Wide(id));
    LaunchLog::Write(L"window", message.append(L"; edge events are not sent on Windows yet"));
    promise.Resolve();
  }

  REACT_METHOD(toggleMaximize)
  void toggleMaximize(double rootTag, Promise promise) noexcept {
    OnUI(promise, [rootTag]() noexcept { WindowManager::Shared().ToggleMaximize(static_cast<int64_t>(rootTag)); });
  }

  REACT_METHOD(quit)
  void quit(Promise promise) noexcept {
    OnUI(promise, []() noexcept { WindowManager::Shared().Quit(); });
  }

 private:
  template <size_t Count>
  static std::optional<std::array<double, Count>> Numbers(JSValue const &value) noexcept {
    auto items = value.TryGetArray();
    if (!items || items->size() < Count) return std::nullopt;
    std::array<double, Count> numbers{};
    for (size_t i = 0; i < Count; i++) numbers[i] = (*items)[i].AsDouble();
    return numbers;
  }

  template <class TWork>
  void OnUI(Promise const &promise, TWork &&work) noexcept {
    RunOnUI(m_context, [promise, work = std::forward<TWork>(work)]() mutable noexcept {
      work();
      promise.Resolve();
    });
  }

  winrt::Microsoft::ReactNative::ReactContext m_context;
};

}
