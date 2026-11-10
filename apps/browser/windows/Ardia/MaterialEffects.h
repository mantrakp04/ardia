#pragma once

#include <d2d1_1.h>
#include <d2d1effects.h>
#include <windows.graphics.effects.interop.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Effects.h>
#include <winrt/Windows.UI.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <vector>

#pragma comment(lib, "dxguid.lib")

namespace Ardia::MaterialEffects {

namespace AbiEffects = ABI::Windows::Graphics::Effects;
namespace AbiFoundation = ABI::Windows::Foundation;

using EffectSource = winrt::Windows::Graphics::Effects::IGraphicsEffectSource;
using PropertyMapping = AbiEffects::GRAPHICS_EFFECT_PROPERTY_MAPPING;

inline EffectSource &AsSource(AbiEffects::IGraphicsEffectSource *&instance) noexcept {
  return reinterpret_cast<EffectSource &>(instance);
}

inline winrt::Windows::Foundation::IPropertyValue &AsPropertyValue(AbiFoundation::IPropertyValue *&instance) noexcept {
  return reinterpret_cast<winrt::Windows::Foundation::IPropertyValue &>(instance);
}

inline HRESULT WriteProperty(AbiFoundation::IPropertyValue **value, winrt::Windows::Foundation::IInspectable const &made) noexcept {
  if (!value) return E_POINTER;
  *value = nullptr;
  try {
    AsPropertyValue(*value) = made.as<winrt::Windows::Foundation::IPropertyValue>();
    return S_OK;
  } catch (...) {
    return winrt::to_hresult();
  }
}

struct NamedProperty {
  const wchar_t *name;
  UINT index;
  PropertyMapping mapping;
};

template <class Derived>
struct Effect : winrt::implements<
                    Derived,
                    winrt::Windows::Graphics::Effects::IGraphicsEffect,
                    winrt::Windows::Graphics::Effects::IGraphicsEffectSource,
                    AbiEffects::IGraphicsEffectD2D1Interop> {
  winrt::hstring Name() const noexcept {
    return m_name;
  }

  void Name(winrt::hstring const &value) noexcept {
    m_name = value;
  }

  IFACEMETHODIMP GetSourceCount(UINT *count) noexcept override {
    if (!count) return E_POINTER;
    *count = static_cast<UINT>(m_sources.size());
    return S_OK;
  }

  IFACEMETHODIMP GetSource(UINT index, AbiEffects::IGraphicsEffectSource **source) noexcept override {
    if (!source) return E_POINTER;
    *source = nullptr;
    if (index >= m_sources.size()) return E_INVALIDARG;
    try {
      AsSource(*source) = m_sources[index];
      return S_OK;
    } catch (...) {
      return winrt::to_hresult();
    }
  }

  IFACEMETHODIMP GetNamedPropertyMapping(LPCWSTR name, UINT *index, PropertyMapping *mapping) noexcept override {
    if (!name || !index || !mapping) return E_POINTER;
    for (auto const &property : static_cast<Derived *>(this)->NamedProperties()) {
      if (_wcsicmp(name, property.name) == 0) {
        *index = property.index;
        *mapping = property.mapping;
        return S_OK;
      }
    }
    return E_INVALIDARG;
  }

  std::vector<EffectSource> m_sources;

 private:
  winrt::hstring m_name;
};

struct GaussianBlur : Effect<GaussianBlur> {
  float standardDeviation{20.0f};

  IFACEMETHODIMP GetEffectId(GUID *id) noexcept override {
    if (!id) return E_POINTER;
    *id = CLSID_D2D1GaussianBlur;
    return S_OK;
  }

  IFACEMETHODIMP GetPropertyCount(UINT *count) noexcept override {
    if (!count) return E_POINTER;
    *count = 3;
    return S_OK;
  }

  IFACEMETHODIMP GetProperty(UINT index, AbiFoundation::IPropertyValue **value) noexcept override {
    switch (index) {
      case D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION:
        return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateSingle(standardDeviation));
      case D2D1_GAUSSIANBLUR_PROP_OPTIMIZATION:
        return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateUInt32(static_cast<uint32_t>(D2D1_GAUSSIANBLUR_OPTIMIZATION_BALANCED)));
      case D2D1_GAUSSIANBLUR_PROP_BORDER_MODE:
        return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateUInt32(static_cast<uint32_t>(D2D1_BORDER_MODE_HARD)));
      default:
        return E_INVALIDARG;
    }
  }

  std::array<NamedProperty, 1> NamedProperties() const noexcept {
    return {NamedProperty{L"BlurAmount", D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, PropertyMapping::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT}};
  }
};

struct ColorSource : Effect<ColorSource> {
  winrt::Windows::UI::Color color{0, 0, 0, 0};

  IFACEMETHODIMP GetEffectId(GUID *id) noexcept override {
    if (!id) return E_POINTER;
    *id = CLSID_D2D1Flood;
    return S_OK;
  }

  IFACEMETHODIMP GetPropertyCount(UINT *count) noexcept override {
    if (!count) return E_POINTER;
    *count = 1;
    return S_OK;
  }

  IFACEMETHODIMP GetProperty(UINT index, AbiFoundation::IPropertyValue **value) noexcept override {
    if (index != D2D1_FLOOD_PROP_COLOR) return E_INVALIDARG;
    std::array<float, 4> channels{color.R / 255.0f, color.G / 255.0f, color.B / 255.0f, color.A / 255.0f};
    return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateSingleArray(channels));
  }

  std::array<NamedProperty, 1> NamedProperties() const noexcept {
    return {NamedProperty{L"Color", D2D1_FLOOD_PROP_COLOR, PropertyMapping::GRAPHICS_EFFECT_PROPERTY_MAPPING_COLOR_TO_VECTOR4}};
  }
};

struct SourceOver : Effect<SourceOver> {
  IFACEMETHODIMP GetEffectId(GUID *id) noexcept override {
    if (!id) return E_POINTER;
    *id = CLSID_D2D1Composite;
    return S_OK;
  }

  IFACEMETHODIMP GetPropertyCount(UINT *count) noexcept override {
    if (!count) return E_POINTER;
    *count = 1;
    return S_OK;
  }

  IFACEMETHODIMP GetProperty(UINT index, AbiFoundation::IPropertyValue **value) noexcept override {
    if (index != D2D1_COMPOSITE_PROP_MODE) return E_INVALIDARG;
    return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateUInt32(static_cast<uint32_t>(D2D1_COMPOSITE_MODE_SOURCE_OVER)));
  }

  std::array<NamedProperty, 1> NamedProperties() const noexcept {
    return {NamedProperty{L"Mode", D2D1_COMPOSITE_PROP_MODE, PropertyMapping::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT}};
  }
};

struct ColorMatrix : Effect<ColorMatrix> {
  std::array<float, 20> matrix{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0};

  void Saturate(float saturation) noexcept {
    constexpr float red = 0.2126f;
    constexpr float green = 0.7152f;
    constexpr float blue = 0.0722f;
    const float rest = 1.0f - saturation;
    matrix = {
        red * rest + saturation, red * rest, red * rest, 0,
        green * rest, green * rest + saturation, green * rest, 0,
        blue * rest, blue * rest, blue * rest + saturation, 0,
        0, 0, 0, 1,
        0, 0, 0, 0,
    };
  }

  IFACEMETHODIMP GetEffectId(GUID *id) noexcept override {
    if (!id) return E_POINTER;
    *id = CLSID_D2D1ColorMatrix;
    return S_OK;
  }

  IFACEMETHODIMP GetPropertyCount(UINT *count) noexcept override {
    if (!count) return E_POINTER;
    *count = 1;
    return S_OK;
  }

  IFACEMETHODIMP GetProperty(UINT index, AbiFoundation::IPropertyValue **value) noexcept override {
    if (index != D2D1_COLORMATRIX_PROP_COLOR_MATRIX) return E_INVALIDARG;
    return WriteProperty(value, winrt::Windows::Foundation::PropertyValue::CreateSingleArray(matrix));
  }

  std::array<NamedProperty, 1> NamedProperties() const noexcept {
    return {NamedProperty{L"ColorMatrix", D2D1_COLORMATRIX_PROP_COLOR_MATRIX, PropertyMapping::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT}};
  }
};

inline constexpr wchar_t BackdropSource[] = L"Backdrop";
inline constexpr wchar_t BlurAmountProperty[] = L"Blur.BlurAmount";
inline constexpr wchar_t TintColorProperty[] = L"Tint.Color";

inline int SaturationKey(float saturation) noexcept {
  if (!std::isfinite(saturation)) return 100;
  return static_cast<int>(std::lround(std::clamp(saturation, 0.0f, 3.0f) * 20.0f)) * 5;
}

inline winrt::Windows::Graphics::Effects::IGraphicsEffect BlurGraph(int saturationKey) {
  auto blur = winrt::make_self<GaussianBlur>();
  blur->Name(L"Blur");
  blur->m_sources.push_back(winrt::Microsoft::UI::Composition::CompositionEffectSourceParameter(BackdropSource));

  EffectSource blurred = blur.as<EffectSource>();
  if (saturationKey != 100) {
    auto saturate = winrt::make_self<ColorMatrix>();
    saturate->Name(L"Saturation");
    saturate->Saturate(static_cast<float>(saturationKey) / 100.0f);
    saturate->m_sources.push_back(blurred);
    blurred = saturate.as<EffectSource>();
  }

  auto tint = winrt::make_self<ColorSource>();
  tint->Name(L"Tint");

  auto over = winrt::make_self<SourceOver>();
  over->Name(L"Over");
  over->m_sources.push_back(blurred);
  over->m_sources.push_back(tint.as<EffectSource>());
  return over.as<winrt::Windows::Graphics::Effects::IGraphicsEffect>();
}

struct BlurFactories {
  winrt::Microsoft::UI::Composition::Compositor compositor{nullptr};
  std::map<int, winrt::Microsoft::UI::Composition::CompositionEffectFactory> bySaturation;
};

inline BlurFactories &Factories() noexcept {
  static BlurFactories factories;
  return factories;
}

inline winrt::Microsoft::UI::Composition::CompositionEffectFactory BlurFactory(
    winrt::Microsoft::UI::Composition::Compositor const &compositor,
    float saturation) {
  auto &factories = Factories();
  if (factories.compositor != compositor) {
    factories.compositor = compositor;
    factories.bySaturation.clear();
  }
  const int key = SaturationKey(saturation);
  auto found = factories.bySaturation.find(key);
  if (found != factories.bySaturation.end()) return found->second;
  auto factory = compositor.CreateEffectFactory(
      BlurGraph(key), std::vector<winrt::hstring>{winrt::hstring{BlurAmountProperty}, winrt::hstring{TintColorProperty}});
  factories.bySaturation.emplace(key, factory);
  return factory;
}

inline winrt::Microsoft::UI::Composition::CompositionEffectBrush BlurBrush(
    winrt::Microsoft::UI::Composition::Compositor const &compositor,
    float saturation) {
  auto brush = BlurFactory(compositor, saturation).CreateBrush();
  brush.SetSourceParameter(BackdropSource, compositor.CreateBackdropBrush());
  return brush;
}

inline void SetBlurValues(
    winrt::Microsoft::UI::Composition::CompositionEffectBrush const &brush,
    float standardDeviation,
    winrt::Windows::UI::Color tint) {
  auto properties = brush.Properties();
  properties.InsertScalar(BlurAmountProperty, std::clamp(standardDeviation, 0.0f, 250.0f));
  properties.InsertColor(TintColorProperty, tint);
}

}
