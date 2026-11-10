#pragma once

#include <NativeModules.h>
#include <JSValueComposition.h>
#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.Foundation.Numerics.h>
#include <winrt/Windows.UI.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

#include "MaterialEffects.h"
#include "MaterialSupport.h"
#include "VectorGeometry.h"

namespace Ardia {

namespace MaterialView {

using ComponentView = winrt::Microsoft::ReactNative::ComponentView;
using CompositionComponentView = winrt::Microsoft::ReactNative::Composition::ComponentView;
using ViewComponentView = winrt::Microsoft::ReactNative::Composition::ViewComponentView;
using LayoutMetrics = winrt::Microsoft::ReactNative::LayoutMetrics;
using Visual = winrt::Microsoft::UI::Composition::Visual;
using float2 = winrt::Windows::Foundation::Numerics::float2;

constexpr winrt::Windows::UI::Color Transparent{0, 0, 0, 0};

inline winrt::Windows::UI::Color Resolved(ComponentView const &view, winrt::Microsoft::ReactNative::Color const &color, winrt::Windows::UI::Color fallback) noexcept {
  if (!color) return fallback;
  try {
    return color.AsWindowsColor(view.as<CompositionComponentView>().Theme());
  } catch (...) {
    return fallback;
  }
}

inline float Finite(float value, float fallback) noexcept {
  return std::isfinite(value) ? value : fallback;
}

inline float ScaleOf(LayoutMetrics const &metrics) noexcept {
  return metrics.PointScaleFactor > 0 ? metrics.PointScaleFactor : 1.0f;
}

inline Visual PlainVisual(ComponentView const &view) noexcept {
  try {
    return view.as<CompositionComponentView>().Compositor().CreateSpriteVisual();
  } catch (...) {
    return nullptr;
  }
}

template <class TView>
inline winrt::com_ptr<TView> Of(ComponentView const &view) noexcept {
  try {
    auto data = view.UserData();
    if (!data) return nullptr;
    return data.as<TView>();
  } catch (...) {
    return nullptr;
  }
}

inline std::pair<float2, float2> GradientLine(float width, float height, float angle, std::string const &span, float reach) noexcept {
  constexpr float degrees = 3.14159265358979f / 180.0f;
  const float radians = Finite(angle, 180.0f) * degrees;
  const float dx = std::sin(radians);
  const float dy = -std::cos(radians);
  const float centerX = width / 2.0f;
  const float centerY = height / 2.0f;
  if (span == "base" || span == "corner") {
    float half = 0;
    if (span == "base") {
      half = std::hypot(width * dx, height * dy) * std::hypot(width, height) / (2.0f * (std::max)(width, height));
    } else {
      half = (width * std::fabs(dx) + height * std::fabs(dy)) / 2.0f;
    }
    const float length = 2.0f * half * Finite(reach, 1.0f);
    const float2 start{centerX - half * dx, centerY - half * dy};
    return {start, float2{start.x + dx * length, start.y + dy * length}};
  }
  const float ex = dx / width;
  const float ey = dy / height;
  const float lengthSquared = ex * ex + ey * ey;
  if (!(lengthSquared > 0)) return {float2{centerX, 0}, float2{centerX, height}};
  const float2 along{ex / lengthSquared / 2.0f, ey / lengthSquared / 2.0f};
  return {float2{centerX - along.x, centerY - along.y}, float2{centerX + along.x, centerY + along.y}};
}

}

REACT_STRUCT(WindowMaterialProps)
struct WindowMaterialProps : winrt::implements<WindowMaterialProps, winrt::Microsoft::ReactNative::IComponentProps> {
  WindowMaterialProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom)
      : ViewProps(props) {
    if (cloneFrom) {
      auto source = cloneFrom.as<WindowMaterialProps>();
      material = source->material;
      fallbackColor = source->fallbackColor;
      tintColor = source->tintColor;
    }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, winrt::Microsoft::ReactNative::IJSValueReader value) noexcept {
    winrt::Microsoft::ReactNative::ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(material)
  std::string material;

  REACT_FIELD(fallbackColor)
  winrt::Microsoft::ReactNative::Color fallbackColor{nullptr};

  REACT_FIELD(tintColor)
  winrt::Microsoft::ReactNative::Color tintColor{nullptr};

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

struct WindowMaterialView : winrt::implements<WindowMaterialView, winrt::Windows::Foundation::IInspectable> {
  void Initialize(MaterialView::ViewComponentView const &view) noexcept {
    try {
      m_mounted = view.Mounted([](winrt::Windows::Foundation::IInspectable const &, MaterialView::ComponentView const &mounted) noexcept {
        if (auto material = MaterialView::Of<WindowMaterialView>(mounted)) material->Attach(mounted);
      });
      m_unmounted = view.Unmounted([](winrt::Windows::Foundation::IInspectable const &, MaterialView::ComponentView const &unmounted) noexcept {
        if (auto material = MaterialView::Of<WindowMaterialView>(unmounted)) material->Detach();
      });
      m_destroying = view.Destroying([](winrt::Windows::Foundation::IInspectable const &, MaterialView::ComponentView const &destroyed) noexcept {
        if (auto material = MaterialView::Of<WindowMaterialView>(destroyed)) material->Detach();
      });
    } catch (...) {
    }
  }

  MaterialView::Visual CreateVisual(MaterialView::ComponentView const &view) noexcept {
    try {
      m_compositor = view.as<MaterialView::CompositionComponentView>().Compositor();
      m_brush = m_compositor.CreateColorBrush(Shown());
      m_sprite = m_compositor.CreateSpriteVisual();
      m_sprite.Brush(m_brush);
      return m_sprite;
    } catch (...) {
    }
    return MaterialView::PlainVisual(view);
  }

  void UpdateProps(MaterialView::ComponentView const &view, winrt::com_ptr<WindowMaterialProps> const &props) noexcept {
    m_fallback = props ? MaterialView::Resolved(view, props->fallbackColor, MaterialView::Transparent) : MaterialView::Transparent;
    m_tint = props ? MaterialView::Resolved(view, props->tintColor, MaterialView::Transparent) : MaterialView::Transparent;
    m_type = Materials::BackdropType(props ? std::string_view{props->material} : std::string_view{});
    Refresh(view);
  }

  void UpdateLayoutMetrics(MaterialView::ComponentView const &view, MaterialView::LayoutMetrics const &) noexcept {
    Refresh(view);
  }

  void Attach(MaterialView::ComponentView const &view) noexcept {
    m_detached = false;
    Refresh(view);
  }

  void Detach() noexcept {
    m_detached = true;
    LetGo();
    Recolor();
  }

 private:
  winrt::Windows::UI::Color Shown() const noexcept {
    return m_hwnd ? m_tint : m_fallback;
  }

  void Recolor() noexcept {
    if (!m_brush) return;
    try {
      m_brush.Color(Shown());
    } catch (...) {
    }
  }

  void LetGo() noexcept {
    if (!m_hwnd) return;
    Materials::Release(m_hwnd);
    m_hwnd = nullptr;
  }

  void Refresh(MaterialView::ComponentView const &view) noexcept {
    if (m_detached || !Materials::CoversRoot(view)) {
      LetGo();
      Recolor();
      return;
    }
    if (m_hwnd && m_heldType == m_type) {
      Recolor();
      return;
    }
    LetGo();
    if (m_refused) {
      Recolor();
      return;
    }
    const Materials::FoundWindow found = Materials::WindowOfView(view);
    if (!found.hwnd) {
      Materials::NoteOnce(L"window-unresolved", L"window backdrop: flat until the view's window is found");
      Recolor();
      return;
    }
    const Materials::HoldResult result = Materials::Hold(found.hwnd, m_type);
    if (result.held) {
      m_hwnd = found.hwnd;
      m_heldType = m_type;
      std::wstring message{L"window backdrop: system "};
      message.append(Materials::BackdropName(m_type)).append(L" on build ").append(std::to_wstring(Materials::BuildNumber())).append(L", window found by ").append(found.route);
      if (!result.reason.empty()) message.append(L"; ").append(result.reason);
      Materials::NoteOnce(L"window-system", message);
    } else {
      m_refused = true;
      Materials::NoteOnce(L"window-flat", std::wstring{L"window backdrop: flat ("}.append(result.reason).append(L")"));
    }
    Recolor();
  }

  winrt::Microsoft::UI::Composition::Compositor m_compositor{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_sprite{nullptr};
  winrt::Microsoft::UI::Composition::CompositionColorBrush m_brush{nullptr};
  winrt::Windows::UI::Color m_fallback{MaterialView::Transparent};
  winrt::Windows::UI::Color m_tint{MaterialView::Transparent};
  DWORD m_type{Materials::BackdropMicaAlt};
  DWORD m_heldType{Materials::BackdropNone};
  HWND m_hwnd{nullptr};
  winrt::event_token m_mounted{};
  winrt::event_token m_unmounted{};
  winrt::event_token m_destroying{};
  bool m_detached{true};
  bool m_refused{false};
};

REACT_STRUCT(MaterialBlurProps)
struct MaterialBlurProps : winrt::implements<MaterialBlurProps, winrt::Microsoft::ReactNative::IComponentProps> {
  MaterialBlurProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom)
      : ViewProps(props) {
    if (cloneFrom) {
      auto source = cloneFrom.as<MaterialBlurProps>();
      fallbackColor = source->fallbackColor;
      tintColor = source->tintColor;
      blurRadius = source->blurRadius;
      saturation = source->saturation;
      cornerRadius = source->cornerRadius;
      shape = source->shape;
    }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, winrt::Microsoft::ReactNative::IJSValueReader value) noexcept {
    winrt::Microsoft::ReactNative::ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(fallbackColor)
  winrt::Microsoft::ReactNative::Color fallbackColor{nullptr};

  REACT_FIELD(tintColor)
  winrt::Microsoft::ReactNative::Color tintColor{nullptr};

  REACT_FIELD(blurRadius)
  float blurRadius{20};

  REACT_FIELD(saturation)
  float saturation{1};

  REACT_FIELD(cornerRadius)
  float cornerRadius{0};

  REACT_FIELD(shape)
  std::string shape;

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

struct MaterialBlurView : winrt::implements<MaterialBlurView, winrt::Windows::Foundation::IInspectable> {
  void Initialize(MaterialView::ViewComponentView const &) noexcept {}

  MaterialView::Visual CreateVisual(MaterialView::ComponentView const &view) noexcept {
    try {
      m_compositor = view.as<MaterialView::CompositionComponentView>().Compositor();
      m_root = m_compositor.CreateContainerVisual();
      m_blur = m_compositor.CreateSpriteVisual();
      m_blur.RelativeSizeAdjustment(MaterialView::float2{1.0f, 1.0f});
      m_tintBrush = m_compositor.CreateColorBrush(m_tint);
      m_tintLayer = m_compositor.CreateSpriteVisual();
      m_tintLayer.RelativeSizeAdjustment(MaterialView::float2{1.0f, 1.0f});
      m_tintLayer.Brush(m_tintBrush);
      m_tintLayer.IsVisible(false);
      m_root.Children().InsertAtTop(m_blur);
      m_root.Children().InsertAtTop(m_tintLayer);
      Place();
      return m_root;
    } catch (...) {
    }
    return MaterialView::PlainVisual(view);
  }

  void UpdateProps(MaterialView::ComponentView const &view, winrt::com_ptr<MaterialBlurProps> const &props) noexcept {
    m_fallback = props ? MaterialView::Resolved(view, props->fallbackColor, MaterialView::Transparent) : MaterialView::Transparent;
    m_tint = props ? MaterialView::Resolved(view, props->tintColor, MaterialView::Transparent) : MaterialView::Transparent;
    const float saturation = props ? MaterialView::Finite(props->saturation, 1.0f) : 1.0f;
    if (MaterialEffects::SaturationKey(saturation) != MaterialEffects::SaturationKey(m_saturation)) m_effect = nullptr;
    m_saturation = saturation;
    m_blurRadius = props ? (std::max)(0.0f, MaterialView::Finite(props->blurRadius, 20.0f)) : 20.0f;
    m_cornerRadius = props ? (std::max)(0.0f, MaterialView::Finite(props->cornerRadius, 0.0f)) : 0.0f;
    m_shape = props ? props->shape : std::string{};
    Place();
  }

  void UpdateLayoutMetrics(MaterialView::ComponentView const &, MaterialView::LayoutMetrics const &metrics) noexcept {
    m_metrics = metrics;
    m_measured = true;
    Place();
  }

 private:
  void Place() noexcept {
    if (!m_root || !m_compositor || !m_measured) return;
    const float scale = MaterialView::ScaleOf(m_metrics);
    const float width = m_metrics.Frame.Width * scale;
    const float height = m_metrics.Frame.Height * scale;
    try {
      if (!(width > 0 && height > 0)) {
        m_blur.Brush(nullptr);
        m_tintLayer.IsVisible(false);
        m_root.Clip(nullptr);
        m_effect = nullptr;
        m_solid = nullptr;
        m_clipKey.clear();
        return;
      }
    } catch (...) {
      return;
    }
    Paint(scale);
    Clip(width, height, scale);
  }

  void Paint(float scale) noexcept {
    const float deviation = m_blurRadius * scale;
    if (m_effect) {
      std::wstring stage;
      try {
        MaterialEffects::SetBlurValues(m_effect, m_step, deviation, m_tint, stage);
      } catch (winrt::hresult_error const &error) {
        Abandon(stage, Materials::Described(error));
      } catch (...) {
        Abandon(stage, L"unknown error");
      }
    }
    if (!m_effect && Materials::BlurAvailable()) {
      const MaterialEffects::BlurChoice choice = MaterialEffects::BestBlurBrush(m_compositor, m_saturation, deviation, m_tint);
      m_effect = choice.brush;
      m_step = choice.step;
    }
    try {
      m_tintBrush.Color(m_tint);
      if (m_effect) {
        m_blur.Brush(m_effect);
        m_tintLayer.IsVisible(!MaterialEffects::TintsInGraph(m_step));
        return;
      }
      if (!Materials::BlurFailed()) Materials::NoteOnce(L"blur-old", L"in-window blur: flat (Windows build too old for backdrop brushes)");
      if (!m_solid) m_solid = m_compositor.CreateColorBrush(m_fallback);
      else m_solid.Color(m_fallback);
      m_blur.Brush(m_solid);
      m_tintLayer.IsVisible(false);
    } catch (...) {
    }
  }

  void Abandon(std::wstring const &stage, std::wstring const &reason) noexcept {
    MaterialEffects::StepFailed(m_step) = true;
    Materials::NoteOnce(
        std::wstring{L"blur-update-"}.append(Paths::Wide(MaterialEffects::BlurStepKey(m_step))),
        std::wstring{L"in-window blur: "}.append(MaterialEffects::BlurStepName(m_step)).append(L" failed while ").append(stage).append(L": ").append(reason));
    m_effect = nullptr;
    m_step = MaterialEffects::BlurStep::Flat;
  }

  void Clip(float width, float height, float scale) noexcept {
    std::string key = m_shape;
    key.append("|").append(std::to_string(m_cornerRadius)).append("|").append(std::to_string(width)).append("x").append(std::to_string(height));
    if (key == m_clipKey) return;
    m_clipKey = std::move(key);
    winrt::com_ptr<ID2D1Geometry> geometry;
    if (!m_shape.empty()) {
      if (auto parsed = Vector::ParsedPath(m_shape, false)) geometry = Vector::Transformed(parsed.get(), D2D1_MATRIX_3X2_F{scale, 0, 0, scale, 0, 0});
    } else if (m_cornerRadius > 0) {
      if (auto *factory = Vector::Factory()) {
        const float radius = (std::min)({m_cornerRadius * scale, width / 2.0f, height / 2.0f});
        const D2D1_ROUNDED_RECT rounded{D2D1_RECT_F{0, 0, width, height}, radius, radius};
        winrt::com_ptr<ID2D1RoundedRectangleGeometry> made;
        if (SUCCEEDED(factory->CreateRoundedRectangleGeometry(&rounded, made.put()))) geometry = Vector::AsGeometry(made);
      }
    }
    try {
      if (!geometry) {
        m_root.Clip(nullptr);
        return;
      }
      winrt::Microsoft::UI::Composition::CompositionPath path{winrt::make<Vector::GeometrySource>(geometry.get())};
      m_root.Clip(m_compositor.CreateGeometricClip(m_compositor.CreatePathGeometry(path)));
    } catch (...) {
      m_clipKey.clear();
    }
  }

  winrt::Microsoft::UI::Composition::Compositor m_compositor{nullptr};
  winrt::Microsoft::UI::Composition::ContainerVisual m_root{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_blur{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_tintLayer{nullptr};
  winrt::Microsoft::UI::Composition::CompositionColorBrush m_tintBrush{nullptr};
  winrt::Microsoft::UI::Composition::CompositionEffectBrush m_effect{nullptr};
  winrt::Microsoft::UI::Composition::CompositionColorBrush m_solid{nullptr};
  winrt::Microsoft::ReactNative::LayoutMetrics m_metrics{};
  winrt::Windows::UI::Color m_fallback{MaterialView::Transparent};
  winrt::Windows::UI::Color m_tint{MaterialView::Transparent};
  MaterialEffects::BlurStep m_step{MaterialEffects::BlurStep::Flat};
  float m_saturation{1};
  float m_blurRadius{20};
  float m_cornerRadius{0};
  std::string m_shape;
  std::string m_clipKey;
  bool m_measured{false};
};

REACT_STRUCT(MaterialGradientProps)
struct MaterialGradientProps : winrt::implements<MaterialGradientProps, winrt::Microsoft::ReactNative::IComponentProps> {
  MaterialGradientProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom)
      : ViewProps(props) {
    if (cloneFrom) {
      auto source = cloneFrom.as<MaterialGradientProps>();
      colors = source->colors;
      angle = source->angle;
      span = source->span;
      reach = source->reach;
    }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, winrt::Microsoft::ReactNative::IJSValueReader value) noexcept {
    if (propName == L"colors") colors.clear();
    winrt::Microsoft::ReactNative::ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(colors)
  std::vector<float> colors;

  REACT_FIELD(angle)
  float angle{180};

  REACT_FIELD(span)
  std::string span;

  REACT_FIELD(reach)
  float reach{1};

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

struct MaterialGradientView : winrt::implements<MaterialGradientView, winrt::Windows::Foundation::IInspectable> {
  void Initialize(MaterialView::ViewComponentView const &) noexcept {}

  MaterialView::Visual CreateVisual(MaterialView::ComponentView const &view) noexcept {
    try {
      m_compositor = view.as<MaterialView::CompositionComponentView>().Compositor();
      m_sprite = m_compositor.CreateSpriteVisual();
    } catch (...) {
      return MaterialView::PlainVisual(view);
    }
    try {
      m_gradient = m_compositor.CreateLinearGradientBrush();
      m_gradient.MappingMode(winrt::Microsoft::UI::Composition::CompositionMappingMode::Absolute);
      m_sprite.Brush(m_gradient);
      Materials::NoteOnce(L"gradient", L"gradients: composition linear gradient brush");
    } catch (winrt::hresult_error const &error) {
      Fail(Materials::Described(error));
    } catch (...) {
      Fail(L"unknown error");
    }
    Restop();
    Place();
    return m_sprite;
  }

  void UpdateProps(MaterialView::ComponentView const &, winrt::com_ptr<MaterialGradientProps> const &props) noexcept {
    std::vector<float> colors = props ? props->colors : std::vector<float>{};
    const bool restop = colors != m_colors;
    m_colors = std::move(colors);
    m_angle = props ? MaterialView::Finite(props->angle, 180.0f) : 180.0f;
    m_span = props ? props->span : std::string{};
    m_reach = props ? MaterialView::Finite(props->reach, 1.0f) : 1.0f;
    if (restop) Restop();
    Place();
  }

  void UpdateLayoutMetrics(MaterialView::ComponentView const &, MaterialView::LayoutMetrics const &metrics) noexcept {
    m_metrics = metrics;
    m_measured = true;
    Place();
  }

 private:
  void Fail(std::wstring const &reason) noexcept {
    Materials::GradientFailed() = true;
    m_gradient = nullptr;
    Materials::NoteOnce(L"gradient-flat", std::wstring{L"gradients: none drawn ("}.append(reason).append(L")"));
  }

  void Restop() noexcept {
    if (!m_gradient || !m_compositor) return;
    try {
      auto stops = m_gradient.ColorStops();
      stops.Clear();
      const size_t count = m_colors.size() / 4;
      for (size_t i = 0; i < count; i++) {
        const float offset = count == 1 ? 0.0f : static_cast<float>(i) / static_cast<float>(count - 1);
        const float *rgba = m_colors.data() + i * 4;
        stops.Append(m_compositor.CreateColorGradientStop(offset, Materials::ColorFromUnit(rgba[0], rgba[1], rgba[2], rgba[3])));
      }
      if (count == 1) stops.Append(m_compositor.CreateColorGradientStop(1.0f, Materials::ColorFromUnit(m_colors[0], m_colors[1], m_colors[2], m_colors[3])));
    } catch (winrt::hresult_error const &error) {
      Fail(Materials::Described(error));
      if (m_sprite) m_sprite.Brush(nullptr);
    } catch (...) {
      Fail(L"unknown error");
      if (m_sprite) m_sprite.Brush(nullptr);
    }
  }

  void Place() noexcept {
    if (!m_gradient || !m_measured) return;
    const float scale = MaterialView::ScaleOf(m_metrics);
    const float width = m_metrics.Frame.Width * scale;
    const float height = m_metrics.Frame.Height * scale;
    if (!(width > 0 && height > 0)) return;
    try {
      const auto [start, end] = MaterialView::GradientLine(width, height, m_angle, m_span, m_reach);
      m_gradient.StartPoint(start);
      m_gradient.EndPoint(end);
    } catch (...) {
    }
  }

  winrt::Microsoft::UI::Composition::Compositor m_compositor{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_sprite{nullptr};
  winrt::Microsoft::UI::Composition::CompositionLinearGradientBrush m_gradient{nullptr};
  winrt::Microsoft::ReactNative::LayoutMetrics m_metrics{};
  std::vector<float> m_colors;
  float m_angle{180};
  std::string m_span;
  float m_reach{1};
  bool m_measured{false};
};

template <class TView, class TProps>
inline void RegisterMaterialView(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder, wchar_t const *name) noexcept {
  try {
    packageBuilder.as<winrt::Microsoft::ReactNative::IReactPackageBuilderFabric>().AddViewComponent(
        name, [](winrt::Microsoft::ReactNative::IReactViewComponentBuilder const &builder) noexcept {
          builder.SetCreateProps([](winrt::Microsoft::ReactNative::ViewProps props,
                                    const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom) noexcept {
            return winrt::make<TProps>(props, cloneFrom);
          });

          builder.SetUpdatePropsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                           const winrt::Microsoft::ReactNative::IComponentProps &newProps,
                                           const winrt::Microsoft::ReactNative::IComponentProps &) noexcept {
            auto material = MaterialView::Of<TView>(view);
            if (!material) return;
            winrt::com_ptr<TProps> props;
            try {
              if (newProps) props = newProps.as<TProps>();
            } catch (...) {
            }
            material->UpdateProps(view, props);
          });

          auto compositionBuilder = builder.as<winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder>();

          compositionBuilder.SetViewComponentViewInitializer(
              [](const winrt::Microsoft::ReactNative::Composition::ViewComponentView &view) noexcept {
                auto material = winrt::make_self<TView>();
                view.UserData(*material);
                material->Initialize(view);
              });

          compositionBuilder.SetCreateVisualHandler([](const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
            if (auto material = MaterialView::Of<TView>(view)) return material->CreateVisual(view);
            return MaterialView::PlainVisual(view);
          });

          compositionBuilder.SetUpdateLayoutMetricsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                                              const winrt::Microsoft::ReactNative::LayoutMetrics &newLayoutMetrics,
                                                              const winrt::Microsoft::ReactNative::LayoutMetrics &) noexcept {
            if (auto material = MaterialView::Of<TView>(view)) material->UpdateLayoutMetrics(view, newLayoutMetrics);
          });
        });
  } catch (...) {
  }
}

inline void RegisterMaterialViews(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  RegisterMaterialView<WindowMaterialView, WindowMaterialProps>(packageBuilder, L"ArdiaWindowMaterial");
  RegisterMaterialView<MaterialBlurView, MaterialBlurProps>(packageBuilder, L"ArdiaMaterialBlur");
  RegisterMaterialView<MaterialGradientView, MaterialGradientProps>(packageBuilder, L"ArdiaMaterialGradient");
}

}
