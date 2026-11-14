#pragma once

#include <NativeModules.h>
#include <JSValueComposition.h>
#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.Foundation.Numerics.h>
#include <winrt/Windows.UI.h>

#include <cmath>
#include <memory>
#include <string>
#include <vector>

#include "VectorGeometry.h"

namespace Ardia {

REACT_STRUCT(VectorIconElement)
struct VectorIconElement {
  REACT_FIELD(d)
  std::string d;

  REACT_FIELD(matrix)
  std::vector<float> matrix;

  REACT_FIELD(evenOdd)
  bool evenOdd{false};

  REACT_FIELD(fill)
  float fill{0};

  REACT_FIELD(stroke)
  float stroke{0};

  REACT_FIELD(width)
  float width{0};

  REACT_FIELD(cap)
  std::string cap;

  REACT_FIELD(join)
  std::string join;

  REACT_FIELD(dashes)
  std::vector<float> dashes;

  REACT_FIELD(dashOffset)
  float dashOffset{0};

  REACT_FIELD(maskFill)
  bool maskFill{false};

  REACT_FIELD(maskStroke)
  bool maskStroke{false};

  REACT_FIELD(maskWidth)
  float maskWidth{0};
};

REACT_STRUCT(VectorIconLayer)
struct VectorIconLayer {
  REACT_FIELD(draw)
  bool draw{true};

  REACT_FIELD(cut)
  bool cut{false};

  REACT_FIELD(elements)
  std::vector<VectorIconElement> elements;
};

REACT_STRUCT(VectorIconProps)
struct VectorIconProps : winrt::implements<VectorIconProps, winrt::Microsoft::ReactNative::IComponentProps> {
  VectorIconProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom)
      : ViewProps(props) {
    if (cloneFrom) {
      auto source = cloneFrom.as<VectorIconProps>();
      symbolKey = source->symbolKey;
      layers = source->layers;
      color = source->color;
    }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, winrt::Microsoft::ReactNative::IJSValueReader value) noexcept {
    if (propName == L"layers") layers.clear();
    winrt::Microsoft::ReactNative::ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(symbolKey)
  std::string symbolKey;

  REACT_FIELD(layers)
  std::vector<VectorIconLayer> layers;

  REACT_FIELD(color)
  winrt::Microsoft::ReactNative::Color color{nullptr};

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

inline std::vector<Vector::LayerSpec> VectorLayerSpecs(std::vector<VectorIconLayer> const &layers) noexcept {
  std::vector<Vector::LayerSpec> specs;
  specs.reserve(layers.size());
  for (auto const &layer : layers) {
    Vector::LayerSpec spec;
    spec.draw = layer.draw;
    spec.cut = layer.cut;
    spec.elements.reserve(layer.elements.size());
    for (auto const &element : layer.elements) {
      Vector::ElementSpec item;
      item.pathData = &element.d;
      item.matrix = Vector::MatrixFrom(element.matrix);
      item.evenOdd = element.evenOdd;
      item.fill = std::isfinite(element.fill) ? element.fill : 0;
      item.stroke = std::isfinite(element.stroke) ? element.stroke : 0;
      item.strokeSpec.width = std::isfinite(element.width) ? element.width : 0;
      item.strokeSpec.cap = element.cap;
      item.strokeSpec.join = element.join;
      item.strokeSpec.dashes = &element.dashes;
      item.strokeSpec.dashOffset = std::isfinite(element.dashOffset) ? element.dashOffset : 0;
      item.maskFill = element.maskFill;
      item.maskStroke = element.maskStroke;
      item.maskWidth = std::isfinite(element.maskWidth) ? element.maskWidth : 0;
      spec.elements.push_back(std::move(item));
    }
    specs.push_back(std::move(spec));
  }
  return specs;
}

struct VectorIconSprite {
  winrt::Microsoft::UI::Composition::CompositionSpriteShape shape{nullptr};
  winrt::Microsoft::UI::Composition::CompositionColorBrush brush{nullptr};
  D2D1_MATRIX_3X2_F toPoints{};
  float alpha{1};
};

struct VectorIconView : winrt::implements<VectorIconView, winrt::Windows::Foundation::IInspectable> {
  winrt::Microsoft::UI::Composition::Visual CreateVisual(winrt::Microsoft::ReactNative::ComponentView const &view) noexcept {
    try {
      m_compositor = view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Compositor();
      m_root = m_compositor.CreateContainerVisual();
      m_canvas = m_compositor.CreateShapeVisual();
      m_root.Children().InsertAtTop(m_canvas);
      m_metrics = view.LayoutMetrics();
      Rebuild();
      return m_root;
    } catch (...) {
    }
    try {
      return view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Compositor().CreateSpriteVisual();
    } catch (...) {
      return nullptr;
    }
  }

  void UpdateProps(winrt::Microsoft::ReactNative::ComponentView const &view, winrt::com_ptr<VectorIconProps> const &props) noexcept {
    m_color = ResolvedColor(view, props);
    std::shared_ptr<Vector::Symbol> symbol;
    if (props) {
      if (!props->symbolKey.empty() && props->symbolKey == m_symbolKey && m_symbol) {
        symbol = m_symbol;
      } else {
        auto const &layers = props->layers;
        symbol = Vector::CachedSymbol(props->symbolKey, [&layers]() noexcept { return VectorLayerSpecs(layers); });
      }
      m_symbolKey = props->symbolKey;
    } else {
      m_symbolKey.clear();
    }
    if (symbol != m_symbol) {
      m_symbol = std::move(symbol);
      Rebuild();
    } else {
      Recolor();
    }
  }

  void UpdateLayoutMetrics(winrt::Microsoft::ReactNative::LayoutMetrics const &metrics) noexcept {
    m_metrics = metrics;
    Place();
  }

 private:
  static winrt::Windows::UI::Color ResolvedColor(
      winrt::Microsoft::ReactNative::ComponentView const &view,
      winrt::com_ptr<VectorIconProps> const &props) noexcept {
    winrt::Windows::UI::Color fallback{255, 0, 0, 0};
    if (!props || !props->color) return fallback;
    try {
      return props->color.AsWindowsColor(view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Theme());
    } catch (...) {
      return fallback;
    }
  }

  winrt::Windows::UI::Color ColorAt(float alpha) const noexcept {
    winrt::Windows::UI::Color color = m_color;
    const float scaled = std::round(static_cast<float>(color.A) * std::clamp(alpha, 0.0f, 1.0f));
    color.A = static_cast<uint8_t>(std::clamp(scaled, 0.0f, 255.0f));
    return color;
  }

  void Rebuild() noexcept {
    if (!m_canvas || !m_compositor) return;
    try {
      auto shapes = m_canvas.Shapes();
      shapes.Clear();
      m_sprites.clear();
      if (m_symbol) {
        for (auto const &shape : m_symbol->shapes) {
          if (!shape.path) continue;
          auto geometry = m_compositor.CreatePathGeometry(shape.path);
          auto sprite = m_compositor.CreateSpriteShape(geometry);
          auto brush = m_compositor.CreateColorBrush(ColorAt(shape.alpha));
          sprite.FillBrush(brush);
          shapes.Append(sprite);
          m_sprites.push_back(VectorIconSprite{sprite, brush, shape.toPoints, shape.alpha});
        }
      }
    } catch (...) {
    }
    Place();
  }

  void Recolor() noexcept {
    try {
      for (auto const &sprite : m_sprites) sprite.brush.Color(ColorAt(sprite.alpha));
    } catch (...) {
    }
  }

  void Place() noexcept {
    if (!m_canvas) return;
    try {
      const float scale = m_metrics.PointScaleFactor > 0 ? m_metrics.PointScaleFactor : 1.0f;
      const float reach = m_symbol ? m_symbol->reach : 0.0f;
      const float extent = std::ceil(2.0f * (reach + 2.0f) * scale);
      const float centerX = m_metrics.Frame.Width * scale / 2.0f;
      const float centerY = m_metrics.Frame.Height * scale / 2.0f;
      m_canvas.Size(winrt::Windows::Foundation::Numerics::float2{extent, extent});
      m_canvas.Offset(winrt::Windows::Foundation::Numerics::float3{centerX - extent / 2.0f, centerY - extent / 2.0f, 0.0f});
      const D2D1_MATRIX_3X2_F toPixels{scale, 0, 0, scale, extent / 2.0f, extent / 2.0f};
      for (auto const &sprite : m_sprites) {
        const D2D1_MATRIX_3X2_F m = Vector::Multiply(sprite.toPoints, toPixels);
        sprite.shape.TransformMatrix(winrt::Windows::Foundation::Numerics::float3x2{m._11, m._12, m._21, m._22, m._31, m._32});
      }
    } catch (...) {
    }
  }

  winrt::Microsoft::UI::Composition::Compositor m_compositor{nullptr};
  winrt::Microsoft::UI::Composition::ContainerVisual m_root{nullptr};
  winrt::Microsoft::UI::Composition::ShapeVisual m_canvas{nullptr};
  std::vector<VectorIconSprite> m_sprites;
  std::shared_ptr<Vector::Symbol> m_symbol;
  std::string m_symbolKey;
  winrt::Windows::UI::Color m_color{255, 0, 0, 0};
  winrt::Microsoft::ReactNative::LayoutMetrics m_metrics{};
};

inline winrt::com_ptr<VectorIconView> VectorIconOf(winrt::Microsoft::ReactNative::ComponentView const &view) noexcept {
  try {
    auto data = view.UserData();
    if (!data) return nullptr;
    return data.as<VectorIconView>();
  } catch (...) {
    return nullptr;
  }
}

inline void RegisterVectorIconView(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  try {
    packageBuilder.as<winrt::Microsoft::ReactNative::IReactPackageBuilderFabric>().AddViewComponent(
        L"ArdiaVectorIcon", [](winrt::Microsoft::ReactNative::IReactViewComponentBuilder const &builder) noexcept {
          builder.SetCreateProps([](winrt::Microsoft::ReactNative::ViewProps props,
                                    const winrt::Microsoft::ReactNative::IComponentProps &cloneFrom) noexcept {
            return winrt::make<VectorIconProps>(props, cloneFrom);
          });

          builder.SetUpdatePropsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                           const winrt::Microsoft::ReactNative::IComponentProps &newProps,
                                           const winrt::Microsoft::ReactNative::IComponentProps &) noexcept {
            auto icon = VectorIconOf(view);
            if (!icon) return;
            winrt::com_ptr<VectorIconProps> props;
            try {
              if (newProps) props = newProps.as<VectorIconProps>();
            } catch (...) {
            }
            icon->UpdateProps(view, props);
          });

          auto compositionBuilder = builder.as<winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder>();

          compositionBuilder.SetViewComponentViewInitializer(
              [](const winrt::Microsoft::ReactNative::Composition::ViewComponentView &view) noexcept {
                auto icon = winrt::make_self<VectorIconView>();
                view.UserData(*icon);
              });

          compositionBuilder.SetCreateVisualHandler([](const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
            auto icon = VectorIconOf(view);
            if (icon) return icon->CreateVisual(view);
            winrt::Microsoft::UI::Composition::Visual fallback{nullptr};
            try {
              fallback = view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Compositor().CreateSpriteVisual();
            } catch (...) {
            }
            return fallback;
          });

          compositionBuilder.SetUpdateLayoutMetricsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                                              const winrt::Microsoft::ReactNative::LayoutMetrics &newLayoutMetrics,
                                                              const winrt::Microsoft::ReactNative::LayoutMetrics &) noexcept {
            if (auto icon = VectorIconOf(view)) icon->UpdateLayoutMetrics(newLayoutMetrics);
          });
        });
  } catch (...) {
  }
}

}
