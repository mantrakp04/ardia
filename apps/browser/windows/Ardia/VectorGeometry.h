#pragma once

#include <d2d1.h>
#include <Windows.Graphics.Interop.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.Graphics.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "LaunchLog.h"
#include "VectorPath.h"

#pragma comment(lib, "d2d1.lib")

namespace Ardia::Vector {

constexpr float PointTolerance = 0.02f;
constexpr size_t CacheLimit = 2048;

struct GeometrySource : winrt::implements<GeometrySource, winrt::Windows::Graphics::IGeometrySource2D, ABI::Windows::Graphics::IGeometrySource2DInterop> {
  explicit GeometrySource(ID2D1Geometry *geometry) noexcept {
    m_geometry.copy_from(geometry);
  }

  IFACEMETHODIMP GetGeometry(ID2D1Geometry **value) noexcept override {
    if (!value) return E_POINTER;
    m_geometry.copy_to(value);
    return S_OK;
  }

  IFACEMETHODIMP TryGetGeometryUsingFactory(ID2D1Factory *, ID2D1Geometry **value) noexcept override {
    if (value) *value = nullptr;
    return E_NOTIMPL;
  }

 private:
  winrt::com_ptr<ID2D1Geometry> m_geometry;
};

inline ID2D1Factory *Factory() noexcept {
  static const winrt::com_ptr<ID2D1Factory> factory = []() noexcept {
    winrt::com_ptr<ID2D1Factory> made;
    D2D1_FACTORY_OPTIONS options{};
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, __uuidof(ID2D1Factory), &options, made.put_void()))) return winrt::com_ptr<ID2D1Factory>{};
    return made;
  }();
  return factory.get();
}

inline D2D1_MATRIX_3X2_F Identity() noexcept {
  return D2D1_MATRIX_3X2_F{1, 0, 0, 1, 0, 0};
}

inline bool IsIdentity(D2D1_MATRIX_3X2_F const &m) noexcept {
  return m._11 == 1 && m._12 == 0 && m._21 == 0 && m._22 == 1 && m._31 == 0 && m._32 == 0;
}

inline D2D1_MATRIX_3X2_F Multiply(D2D1_MATRIX_3X2_F const &first, D2D1_MATRIX_3X2_F const &then) noexcept {
  return D2D1_MATRIX_3X2_F{
      first._11 * then._11 + first._12 * then._21,
      first._11 * then._12 + first._12 * then._22,
      first._21 * then._11 + first._22 * then._21,
      first._21 * then._12 + first._22 * then._22,
      first._31 * then._11 + first._32 * then._21 + then._31,
      first._31 * then._12 + first._32 * then._22 + then._32};
}

inline D2D1_MATRIX_3X2_F MatrixFrom(std::vector<float> const &values) noexcept {
  if (values.size() != 6) return Identity();
  for (float value : values) {
    if (!std::isfinite(value)) return Identity();
  }
  return D2D1_MATRIX_3X2_F{values[0], values[1], values[2], values[3], values[4], values[5]};
}

inline float MatrixScale(D2D1_MATRIX_3X2_F const &m) noexcept {
  return std::sqrt(std::fabs(m._11 * m._22 - m._12 * m._21));
}

struct StrokeSpec {
  float width{0};
  std::string_view cap;
  std::string_view join;
  std::vector<float> const *dashes{nullptr};
  float dashOffset{0};
};

inline D2D1_CAP_STYLE CapStyle(std::string_view cap) noexcept {
  if (cap == "butt") return D2D1_CAP_STYLE_FLAT;
  if (cap == "square") return D2D1_CAP_STYLE_SQUARE;
  return D2D1_CAP_STYLE_ROUND;
}

inline D2D1_LINE_JOIN LineJoin(std::string_view join) noexcept {
  if (join == "miter") return D2D1_LINE_JOIN_MITER_OR_BEVEL;
  if (join == "bevel") return D2D1_LINE_JOIN_BEVEL;
  return D2D1_LINE_JOIN_ROUND;
}

template <typename Interface>
inline winrt::com_ptr<ID2D1Geometry> AsGeometry(winrt::com_ptr<Interface> const &source) noexcept {
  winrt::com_ptr<ID2D1Geometry> geometry;
  geometry.copy_from(source.get());
  return geometry;
}

inline winrt::com_ptr<ID2D1PathGeometry> OpenPath(winrt::com_ptr<ID2D1GeometrySink> &sink) noexcept {
  auto *factory = Factory();
  if (!factory) return nullptr;
  winrt::com_ptr<ID2D1PathGeometry> path;
  if (FAILED(factory->CreatePathGeometry(path.put()))) return nullptr;
  if (FAILED(path->Open(sink.put()))) return nullptr;
  return path;
}

inline winrt::com_ptr<ID2D1Geometry> ParsedPath(std::string_view pathData, bool evenOdd) noexcept {
  winrt::com_ptr<ID2D1GeometrySink> sink;
  auto path = OpenPath(sink);
  if (!path) return nullptr;
  sink->SetFillMode(evenOdd ? D2D1_FILL_MODE_ALTERNATE : D2D1_FILL_MODE_WINDING);
  WriteSvgPath(pathData, sink.get());
  if (FAILED(sink->Close())) return nullptr;
  return AsGeometry(path);
}

inline std::mutex &CacheMutex() noexcept {
  static std::mutex mutex;
  return mutex;
}

inline winrt::com_ptr<ID2D1Geometry> CachedPath(std::string const &pathData, bool evenOdd) noexcept {
  static std::unordered_map<std::string, winrt::com_ptr<ID2D1Geometry>> paths;
  std::string key;
  key.reserve(pathData.size() + 1);
  key.push_back(evenOdd ? 'e' : 'n');
  key.append(pathData);
  {
    std::lock_guard lock(CacheMutex());
    auto found = paths.find(key);
    if (found != paths.end()) return found->second;
  }
  auto parsed = ParsedPath(pathData, evenOdd);
  if (!parsed) return nullptr;
  std::lock_guard lock(CacheMutex());
  if (paths.size() >= CacheLimit) paths.clear();
  paths.emplace(std::move(key), parsed);
  return parsed;
}

inline winrt::com_ptr<ID2D1Geometry> Widened(ID2D1Geometry *source, StrokeSpec const &stroke, float tolerance) noexcept {
  auto *factory = Factory();
  if (!factory || !source || !(stroke.width > 0)) return nullptr;
  std::vector<float> dashes;
  if (stroke.dashes) {
    for (float dash : *stroke.dashes) dashes.push_back(std::max(0.0f, dash) / stroke.width);
    if (dashes.size() % 2 == 1) {
      const size_t count = dashes.size();
      for (size_t i = 0; i < count; ++i) dashes.push_back(dashes[i]);
    }
    float total = 0;
    for (float dash : dashes) total += dash;
    if (!(total > 0)) dashes.clear();
  }
  const D2D1_CAP_STYLE cap = CapStyle(stroke.cap);
  D2D1_STROKE_STYLE_PROPERTIES properties{
      cap,
      cap,
      cap,
      LineJoin(stroke.join),
      4.0f,
      dashes.empty() ? D2D1_DASH_STYLE_SOLID : D2D1_DASH_STYLE_CUSTOM,
      dashes.empty() ? 0.0f : stroke.dashOffset / stroke.width};
  winrt::com_ptr<ID2D1StrokeStyle> style;
  if (FAILED(factory->CreateStrokeStyle(&properties, dashes.empty() ? nullptr : dashes.data(), static_cast<UINT32>(dashes.size()), style.put()))) return nullptr;
  winrt::com_ptr<ID2D1GeometrySink> sink;
  auto path = OpenPath(sink);
  if (!path) return nullptr;
  sink->SetFillMode(D2D1_FILL_MODE_WINDING);
  if (FAILED(source->Widen(stroke.width, style.get(), nullptr, tolerance, sink.get()))) {
    sink->Close();
    return nullptr;
  }
  if (FAILED(sink->Close())) return nullptr;
  return AsGeometry(path);
}

inline winrt::com_ptr<ID2D1Geometry> Transformed(ID2D1Geometry *source, D2D1_MATRIX_3X2_F const &matrix) noexcept {
  if (!source) return nullptr;
  winrt::com_ptr<ID2D1Geometry> result;
  if (IsIdentity(matrix)) {
    result.copy_from(source);
    return result;
  }
  auto *factory = Factory();
  if (!factory) return nullptr;
  winrt::com_ptr<ID2D1TransformedGeometry> transformed;
  if (FAILED(factory->CreateTransformedGeometry(source, &matrix, transformed.put()))) return nullptr;
  return AsGeometry(transformed);
}

inline winrt::com_ptr<ID2D1Geometry> Combined(ID2D1Geometry *first, ID2D1Geometry *second, D2D1_COMBINE_MODE mode) noexcept {
  if (!first || !second) return nullptr;
  winrt::com_ptr<ID2D1GeometrySink> sink;
  auto path = OpenPath(sink);
  if (!path) return nullptr;
  if (FAILED(first->CombineWithGeometry(second, mode, nullptr, PointTolerance, sink.get()))) {
    sink->Close();
    return nullptr;
  }
  if (FAILED(sink->Close())) return nullptr;
  return AsGeometry(path);
}

struct ElementSpec {
  std::string const *pathData{nullptr};
  D2D1_MATRIX_3X2_F matrix{};
  bool evenOdd{false};
  float fill{0};
  float stroke{0};
  StrokeSpec strokeSpec;
  bool maskFill{false};
  bool maskStroke{false};
  float maskWidth{0};
};

struct LayerSpec {
  bool draw{true};
  bool cut{false};
  std::vector<ElementSpec> elements;
};

struct Shape {
  winrt::com_ptr<ID2D1Geometry> geometry;
  D2D1_MATRIX_3X2_F toPoints{};
  float alpha{1};
  winrt::Microsoft::UI::Composition::CompositionPath path{nullptr};
};

struct Symbol {
  std::vector<Shape> shapes;
  float reach{0};
};

inline float BodyTolerance(D2D1_MATRIX_3X2_F const &matrix) noexcept {
  const float scale = MatrixScale(matrix);
  return scale > 1e-4f ? PointTolerance / scale : PointTolerance;
}

inline winrt::com_ptr<ID2D1Geometry> InPoints(Shape const &shape) noexcept {
  return Transformed(shape.geometry.get(), shape.toPoints);
}

inline winrt::com_ptr<ID2D1Geometry> Union(std::vector<winrt::com_ptr<ID2D1Geometry>> const &parts) noexcept {
  winrt::com_ptr<ID2D1Geometry> result;
  for (auto const &part : parts) {
    if (!part) continue;
    if (!result) {
      result = part;
      continue;
    }
    auto merged = Combined(result.get(), part.get(), D2D1_COMBINE_MODE_UNION);
    if (merged) result = merged;
  }
  return result;
}

inline winrt::com_ptr<ID2D1Geometry> MaskOf(LayerSpec const &layer) noexcept {
  std::vector<winrt::com_ptr<ID2D1Geometry>> parts;
  for (auto const &element : layer.elements) {
    if (!element.pathData) continue;
    auto path = CachedPath(*element.pathData, element.evenOdd);
    if (!path) continue;
    if (element.maskFill) parts.push_back(Transformed(path.get(), element.matrix));
    if (element.maskStroke && element.maskWidth > 0) {
      StrokeSpec spec = element.strokeSpec;
      spec.width = element.maskWidth;
      auto outline = Widened(path.get(), spec, BodyTolerance(element.matrix));
      if (outline) parts.push_back(Transformed(outline.get(), element.matrix));
    }
  }
  return Union(parts);
}

inline std::vector<Shape> DrawnShapes(LayerSpec const &layer) noexcept {
  std::vector<Shape> drawn;
  for (auto const &element : layer.elements) {
    if (!element.pathData) continue;
    auto path = CachedPath(*element.pathData, element.evenOdd);
    if (!path) continue;
    if (element.fill > 0) drawn.push_back(Shape{path, element.matrix, std::min(1.0f, element.fill)});
    if (element.stroke > 0 && element.strokeSpec.width > 0) {
      auto outline = Widened(path.get(), element.strokeSpec, BodyTolerance(element.matrix));
      if (outline) drawn.push_back(Shape{outline, element.matrix, std::min(1.0f, element.stroke)});
    }
  }
  std::vector<Shape> merged;
  std::vector<bool> used(drawn.size(), false);
  for (size_t i = 0; i < drawn.size(); ++i) {
    if (used[i]) continue;
    used[i] = true;
    if (drawn[i].alpha >= 1) {
      merged.push_back(drawn[i]);
      continue;
    }
    std::vector<winrt::com_ptr<ID2D1Geometry>> sameAlpha{InPoints(drawn[i])};
    for (size_t j = i + 1; j < drawn.size(); ++j) {
      if (used[j] || drawn[j].alpha != drawn[i].alpha) continue;
      used[j] = true;
      sameAlpha.push_back(InPoints(drawn[j]));
    }
    if (sameAlpha.size() == 1) {
      merged.push_back(drawn[i]);
      continue;
    }
    auto united = Union(sameAlpha);
    if (united) merged.push_back(Shape{united, Identity(), drawn[i].alpha});
  }
  return merged;
}

inline float ReachOf(std::vector<Shape> const &shapes) noexcept {
  float reach = 0;
  for (auto const &shape : shapes) {
    if (!shape.geometry) continue;
    D2D1_RECT_F bounds{};
    if (FAILED(shape.geometry->GetBounds(&shape.toPoints, &bounds))) continue;
    if (!std::isfinite(bounds.left) || !std::isfinite(bounds.right) || !std::isfinite(bounds.top) || !std::isfinite(bounds.bottom)) continue;
    if (bounds.left > bounds.right || bounds.top > bounds.bottom) continue;
    reach = std::max({reach, std::fabs(bounds.left), std::fabs(bounds.right), std::fabs(bounds.top), std::fabs(bounds.bottom)});
  }
  return reach;
}

inline std::shared_ptr<Symbol> BuildSymbol(std::vector<LayerSpec> const &layers) noexcept {
  auto symbol = std::make_shared<Symbol>();
  for (auto const &layer : layers) {
    if (layer.cut && !symbol->shapes.empty()) {
      auto mask = MaskOf(layer);
      if (mask) {
        std::vector<Shape> kept;
        for (auto const &shape : symbol->shapes) {
          auto placed = InPoints(shape);
          winrt::com_ptr<ID2D1Geometry> cut;
          if (placed) cut = Combined(placed.get(), mask.get(), D2D1_COMBINE_MODE_EXCLUDE);
          if (cut) {
            kept.push_back(Shape{cut, Identity(), shape.alpha});
          } else {
            kept.push_back(shape);
          }
        }
        symbol->shapes = std::move(kept);
      }
    }
    if (!layer.draw) continue;
    for (auto &shape : DrawnShapes(layer)) symbol->shapes.push_back(std::move(shape));
  }
  symbol->reach = ReachOf(symbol->shapes);
  std::vector<Shape> drawable;
  for (auto &shape : symbol->shapes) {
    if (!shape.geometry) continue;
    try {
      shape.path = winrt::Microsoft::UI::Composition::CompositionPath(winrt::make<GeometrySource>(shape.geometry.get()));
      drawable.push_back(std::move(shape));
    } catch (...) {
      LaunchLog::Write(L"warning", L"an icon shape could not be built and was left out");
    }
  }
  symbol->shapes = std::move(drawable);
  return symbol;
}

inline std::unordered_map<std::string, std::shared_ptr<Symbol>> &SymbolCache() noexcept {
  static std::unordered_map<std::string, std::shared_ptr<Symbol>> symbols;
  return symbols;
}

template <typename MakeLayers>
inline std::shared_ptr<Symbol> CachedSymbol(std::string const &key, MakeLayers &&makeLayers) noexcept {
  auto &symbols = SymbolCache();
  if (!key.empty()) {
    std::lock_guard lock(CacheMutex());
    auto found = symbols.find(key);
    if (found != symbols.end()) return found->second;
  }
  auto built = BuildSymbol(makeLayers());
  if (!key.empty()) {
    std::lock_guard lock(CacheMutex());
    if (symbols.size() >= CacheLimit) symbols.clear();
    symbols.emplace(key, built);
  }
  return built;
}

}
