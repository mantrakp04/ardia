#pragma once

#include "NativeModules.h"

#include <map>
#include <string>

#include "Events.h"
#include "Host.h"
#include "MaterialEffects.h"
#include "MaterialSupport.h"
#include "WindowManager.h"

namespace Ardia {

REACT_STRUCT(MaterialCapabilities)
struct MaterialCapabilities {
  REACT_FIELD(build)
  double build{0};
  REACT_FIELD(systemBackdrop)
  bool systemBackdrop{false};
  REACT_FIELD(systemBackdropSupported)
  bool systemBackdropSupported{false};
  REACT_FIELD(inWindowBlur)
  bool inWindowBlur{false};
  REACT_FIELD(gradient)
  bool gradient{false};
  REACT_FIELD(background)
  bool background{false};
};

REACT_STRUCT(MaterialPath)
struct MaterialPath {
  REACT_FIELD(path)
  std::string path;
  REACT_FIELD(reason)
  std::string reason;
  REACT_FIELD(step)
  std::string step;
};

REACT_MODULE(MaterialsModule, L"ArdiaMaterials")
struct MaterialsModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    Materials::NoteOnce(L"capabilities", Summary());
  }

  REACT_SYNC_METHOD(capabilities)
  MaterialCapabilities capabilities() noexcept {
    MaterialCapabilities answer;
    answer.build = static_cast<double>(Materials::BuildNumber());
    answer.systemBackdrop = Materials::SystemBackdropAvailable();
    answer.systemBackdropSupported = Materials::SystemBackdropSupported();
    answer.inWindowBlur = Materials::BlurAvailable();
    answer.gradient = Materials::GradientAvailable();
    answer.background = Materials::Background();
    return answer;
  }

  REACT_METHOD(applyWindowMaterial)
  void applyWindowMaterial(std::string windowId, std::string material, winrt::Microsoft::ReactNative::ReactPromise<MaterialPath> promise) noexcept {
    RunOnUI(m_context, [windowId = std::move(windowId), material = std::move(material), promise]() noexcept {
      MaterialPath answer;
      try {
        HWND hwnd = WindowOf(windowId);
        const DWORD type = Materials::BackdropType(material);
        const Materials::HoldResult result = Materials::Hold(hwnd, type);
        answer.path = result.held ? Paths::Utf8(Materials::BackdropName(type)) : std::string{"flat"};
        answer.reason = Paths::Utf8(result.reason);
        if (result.held) Held()[hwnd]++;
      } catch (...) {
        answer.path = "flat";
        answer.reason = "error";
      }
      promise.Resolve(answer);
    });
  }

  REACT_METHOD(clearWindowMaterial)
  void clearWindowMaterial(std::string windowId, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    RunOnUI(m_context, [windowId = std::move(windowId), promise]() noexcept {
      bool cleared = false;
      try {
        HWND hwnd = WindowOf(windowId);
        auto found = Held().find(hwnd);
        if (found != Held().end() && found->second > 0) {
          found->second--;
          if (found->second == 0) Held().erase(found);
          Materials::Release(hwnd);
          cleared = true;
        }
      } catch (...) {
      }
      promise.Resolve(cleared);
    });
  }

  REACT_METHOD(probeBlur)
  void probeBlur(winrt::Microsoft::ReactNative::ReactPromise<MaterialPath> promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept {
      MaterialPath answer;
      answer.path = "flat";
      answer.step = "flat";
      try {
        auto *host = Host::Current();
        if (!host || !host->compositor) {
          answer.reason = "no compositor";
        } else if (Materials::BuildNumber() < Materials::FirstBackdropBrushBuild) {
          answer.reason = "Windows build too old";
        } else {
          std::wstring report;
          for (MaterialEffects::BlurStep step : MaterialEffects::BlurSteps) {
            MaterialEffects::BlurAttempt attempt =
                MaterialEffects::TryBlurStep(host->compositor, step, 1.5f, 20.0f, winrt::Windows::UI::Color{128, 255, 255, 255});
            if (!report.empty()) report.append(L"; ");
            report.append(Paths::Wide(MaterialEffects::BlurStepKey(step))).append(L" ");
            if (attempt.brush) {
              report.append(L"ok");
              auto sprite = host->compositor.CreateSpriteVisual();
              sprite.Brush(attempt.brush);
              if (answer.path == "flat") {
                answer.path = "blur";
                answer.step = MaterialEffects::BlurStepKey(step);
              }
            } else {
              report.append(attempt.error);
            }
          }
          answer.reason = Paths::Utf8(report);
          Materials::NoteOnce(L"blur-probe", std::wstring{L"in-window blur probe: "}.append(report));
        }
      } catch (winrt::hresult_error const &error) {
        answer.reason = Paths::Utf8(Materials::Described(error));
      } catch (...) {
        answer.reason = "error";
      }
      promise.Resolve(answer);
    });
  }

  REACT_METHOD(probeGradient)
  void probeGradient(winrt::Microsoft::ReactNative::ReactPromise<MaterialPath> promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept {
      MaterialPath answer;
      answer.path = "flat";
      try {
        auto *host = Host::Current();
        if (!host || !host->compositor) {
          answer.reason = "no compositor";
        } else {
          auto gradient = host->compositor.CreateLinearGradientBrush();
          gradient.MappingMode(winrt::Microsoft::UI::Composition::CompositionMappingMode::Absolute);
          gradient.ColorStops().Append(host->compositor.CreateColorGradientStop(0.0f, winrt::Windows::UI::Color{255, 3, 88, 247}));
          gradient.ColorStops().Append(host->compositor.CreateColorGradientStop(1.0f, winrt::Windows::UI::Color{255, 253, 2, 245}));
          gradient.StartPoint({0.0f, 0.0f});
          gradient.EndPoint({0.0f, 100.0f});
          auto sprite = host->compositor.CreateSpriteVisual();
          sprite.Brush(gradient);
          answer.path = "gradient";
        }
      } catch (winrt::hresult_error const &error) {
        answer.reason = Paths::Utf8(Materials::Described(error));
      } catch (...) {
        answer.reason = "error";
      }
      promise.Resolve(answer);
    });
  }

 private:
  static std::wstring Summary() noexcept {
    std::wstring line{L"build "};
    line.append(std::to_wstring(Materials::BuildNumber()));
    line.append(L", system backdrop ").append(Materials::SystemBackdropAvailable() ? L"available" : (Materials::SystemBackdropSupported() ? L"off in a background instance" : L"unsupported"));
    line.append(L", in-window blur ").append(Materials::BlurAvailable() ? L"available" : L"unsupported");
    return line;
  }

  static HWND WindowOf(std::string const &windowId) noexcept {
    auto &windows = WindowManager::Shared();
    if (!windowId.empty()) return windows.Hwnd(windowId);
    return windows.ActiveHwnd();
  }

  static std::map<HWND, int> &Held() noexcept {
    static std::map<HWND, int> held;
    return held;
  }

  winrt::Microsoft::ReactNative::ReactContext m_context;
};

}
