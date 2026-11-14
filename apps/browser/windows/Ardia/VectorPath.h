#pragma once

#include <d2d1.h>

#include <charconv>
#include <cmath>
#include <string_view>

namespace Ardia::Vector {

class PathDataReader {
 public:
  explicit PathDataReader(std::string_view text) noexcept : m_text(text) {}

  bool AtEnd() noexcept {
    SkipSeparators();
    return m_index >= m_text.size();
  }

  bool NextIsCommand() noexcept {
    SkipSeparators();
    return m_index < m_text.size() && IsCommandLetter(m_text[m_index]);
  }

  char TakeCommand() noexcept {
    return m_text[m_index++];
  }

  bool Number(float &value) noexcept {
    SkipSeparators();
    const size_t size = m_text.size();
    size_t cursor = m_index;
    if (cursor < size && (m_text[cursor] == '+' || m_text[cursor] == '-')) ++cursor;
    bool sawDigit = false;
    while (cursor < size && IsDigit(m_text[cursor])) {
      ++cursor;
      sawDigit = true;
    }
    if (cursor < size && m_text[cursor] == '.') {
      ++cursor;
      while (cursor < size && IsDigit(m_text[cursor])) {
        ++cursor;
        sawDigit = true;
      }
    }
    if (!sawDigit) return false;
    if (cursor < size && (m_text[cursor] == 'e' || m_text[cursor] == 'E')) {
      size_t exponent = cursor + 1;
      if (exponent < size && (m_text[exponent] == '+' || m_text[exponent] == '-')) ++exponent;
      if (exponent < size && IsDigit(m_text[exponent])) {
        while (exponent < size && IsDigit(m_text[exponent])) ++exponent;
        cursor = exponent;
      }
    }
    size_t begin = m_index;
    if (m_text[begin] == '+') ++begin;
    float parsed = 0;
    const auto result = std::from_chars(m_text.data() + begin, m_text.data() + cursor, parsed, std::chars_format::general);
    if (result.ec != std::errc{} || !std::isfinite(parsed)) return false;
    value = parsed;
    m_index = cursor;
    return true;
  }

  bool Flag(bool &value) noexcept {
    SkipSeparators();
    if (m_index >= m_text.size()) return false;
    const char flag = m_text[m_index];
    if (flag != '0' && flag != '1') return false;
    value = flag == '1';
    ++m_index;
    return true;
  }

 private:
  static bool IsDigit(char c) noexcept {
    return c >= '0' && c <= '9';
  }

  static bool IsCommandLetter(char c) noexcept {
    switch (c) {
      case 'M': case 'm': case 'L': case 'l': case 'H': case 'h': case 'V': case 'v': case 'C': case 'c':
      case 'S': case 's': case 'Q': case 'q': case 'T': case 't': case 'A': case 'a': case 'Z': case 'z':
        return true;
      default:
        return false;
    }
  }

  void SkipSeparators() noexcept {
    while (m_index < m_text.size()) {
      const char c = m_text[m_index];
      if (c == ' ' || c == ',' || c == '\t' || c == '\n' || c == '\r' || c == '\f') {
        ++m_index;
      } else {
        break;
      }
    }
  }

  std::string_view m_text;
  size_t m_index{0};
};

class PathSinkWriter {
 public:
  explicit PathSinkWriter(ID2D1GeometrySink *sink) noexcept : m_sink(sink) {}

  D2D1_POINT_2F Current() const noexcept {
    return m_current;
  }

  void MoveTo(D2D1_POINT_2F point) noexcept {
    EndOpenFigure();
    m_start = point;
    m_current = point;
  }

  void LineTo(D2D1_POINT_2F point) noexcept {
    EnsureFigure();
    m_sink->AddLine(point);
    m_current = point;
  }

  void CubicTo(D2D1_POINT_2F control1, D2D1_POINT_2F control2, D2D1_POINT_2F point) noexcept {
    EnsureFigure();
    D2D1_BEZIER_SEGMENT segment{control1, control2, point};
    m_sink->AddBezier(&segment);
    m_current = point;
  }

  void QuadTo(D2D1_POINT_2F control, D2D1_POINT_2F point) noexcept {
    EnsureFigure();
    D2D1_QUADRATIC_BEZIER_SEGMENT segment{control, point};
    m_sink->AddQuadraticBezier(&segment);
    m_current = point;
  }

  void ArcTo(float radiusX, float radiusY, float rotationDegrees, bool largeArc, bool sweep, D2D1_POINT_2F point) noexcept {
    if (point.x == m_current.x && point.y == m_current.y) return;
    radiusX = std::fabs(radiusX);
    radiusY = std::fabs(radiusY);
    if (radiusX == 0 || radiusY == 0) {
      LineTo(point);
      return;
    }
    const double radians = rotationDegrees * 3.14159265358979323846 / 180.0;
    const double cosine = std::cos(radians);
    const double sine = std::sin(radians);
    const double halfDx = (m_current.x - point.x) / 2.0;
    const double halfDy = (m_current.y - point.y) / 2.0;
    const double primeX = cosine * halfDx + sine * halfDy;
    const double primeY = -sine * halfDx + cosine * halfDy;
    const double lambda = (primeX * primeX) / (double(radiusX) * radiusX) + (primeY * primeY) / (double(radiusY) * radiusY);
    if (lambda > 1) {
      const double grow = std::sqrt(lambda) * 1.00001;
      radiusX = static_cast<float>(radiusX * grow);
      radiusY = static_cast<float>(radiusY * grow);
    }
    EnsureFigure();
    D2D1_ARC_SEGMENT segment{
        point,
        D2D1_SIZE_F{radiusX, radiusY},
        rotationDegrees,
        sweep ? D2D1_SWEEP_DIRECTION_CLOCKWISE : D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
        largeArc ? D2D1_ARC_SIZE_LARGE : D2D1_ARC_SIZE_SMALL};
    m_sink->AddArc(&segment);
    m_current = point;
  }

  void Close() noexcept {
    if (m_figureOpen) {
      m_sink->EndFigure(D2D1_FIGURE_END_CLOSED);
      m_figureOpen = false;
    }
    m_current = m_start;
  }

  void Finish() noexcept {
    EndOpenFigure();
  }

 private:
  void EnsureFigure() noexcept {
    if (m_figureOpen) return;
    m_sink->BeginFigure(m_start, D2D1_FIGURE_BEGIN_FILLED);
    m_figureOpen = true;
  }

  void EndOpenFigure() noexcept {
    if (!m_figureOpen) return;
    m_sink->EndFigure(D2D1_FIGURE_END_OPEN);
    m_figureOpen = false;
  }

  ID2D1GeometrySink *m_sink;
  D2D1_POINT_2F m_start{0, 0};
  D2D1_POINT_2F m_current{0, 0};
  bool m_figureOpen{false};
};

inline D2D1_POINT_2F Reflected(D2D1_POINT_2F control, D2D1_POINT_2F around) noexcept {
  return D2D1_POINT_2F{2 * around.x - control.x, 2 * around.y - control.y};
}

inline void WriteSvgPath(std::string_view pathData, ID2D1GeometrySink *sink) noexcept {
  PathDataReader reader(pathData);
  PathSinkWriter writer(sink);
  char command = 0;
  D2D1_POINT_2F lastCubicControl{0, 0};
  D2D1_POINT_2F lastQuadControl{0, 0};
  bool hasCubicControl = false;
  bool hasQuadControl = false;

  while (!reader.AtEnd()) {
    if (reader.NextIsCommand()) {
      command = reader.TakeCommand();
    } else if (command == 'M') {
      command = 'L';
    } else if (command == 'm') {
      command = 'l';
    } else if (command == 0 || command == 'Z' || command == 'z') {
      break;
    }

    const bool relative = command >= 'a' && command <= 'z';
    const D2D1_POINT_2F origin = relative ? writer.Current() : D2D1_POINT_2F{0, 0};
    const auto at = [&origin](float x, float y) noexcept { return D2D1_POINT_2F{origin.x + x, origin.y + y}; };
    bool cubicNow = false;
    bool quadNow = false;
    bool ok = true;

    switch (command) {
      case 'M':
      case 'm': {
        float x = 0, y = 0;
        ok = reader.Number(x) && reader.Number(y);
        if (ok) writer.MoveTo(at(x, y));
        break;
      }
      case 'L':
      case 'l': {
        float x = 0, y = 0;
        ok = reader.Number(x) && reader.Number(y);
        if (ok) writer.LineTo(at(x, y));
        break;
      }
      case 'H':
      case 'h': {
        float x = 0;
        ok = reader.Number(x);
        if (ok) writer.LineTo(D2D1_POINT_2F{origin.x + x, writer.Current().y});
        break;
      }
      case 'V':
      case 'v': {
        float y = 0;
        ok = reader.Number(y);
        if (ok) writer.LineTo(D2D1_POINT_2F{writer.Current().x, origin.y + y});
        break;
      }
      case 'C':
      case 'c': {
        float x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0;
        ok = reader.Number(x1) && reader.Number(y1) && reader.Number(x2) && reader.Number(y2) && reader.Number(x) && reader.Number(y);
        if (ok) {
          lastCubicControl = at(x2, y2);
          writer.CubicTo(at(x1, y1), lastCubicControl, at(x, y));
          cubicNow = true;
        }
        break;
      }
      case 'S':
      case 's': {
        float x2 = 0, y2 = 0, x = 0, y = 0;
        ok = reader.Number(x2) && reader.Number(y2) && reader.Number(x) && reader.Number(y);
        if (ok) {
          const D2D1_POINT_2F current = writer.Current();
          const D2D1_POINT_2F first = hasCubicControl ? Reflected(lastCubicControl, current) : current;
          lastCubicControl = at(x2, y2);
          writer.CubicTo(first, lastCubicControl, at(x, y));
          cubicNow = true;
        }
        break;
      }
      case 'Q':
      case 'q': {
        float x1 = 0, y1 = 0, x = 0, y = 0;
        ok = reader.Number(x1) && reader.Number(y1) && reader.Number(x) && reader.Number(y);
        if (ok) {
          lastQuadControl = at(x1, y1);
          writer.QuadTo(lastQuadControl, at(x, y));
          quadNow = true;
        }
        break;
      }
      case 'T':
      case 't': {
        float x = 0, y = 0;
        ok = reader.Number(x) && reader.Number(y);
        if (ok) {
          const D2D1_POINT_2F current = writer.Current();
          lastQuadControl = hasQuadControl ? Reflected(lastQuadControl, current) : current;
          writer.QuadTo(lastQuadControl, at(x, y));
          quadNow = true;
        }
        break;
      }
      case 'A':
      case 'a': {
        float radiusX = 0, radiusY = 0, rotation = 0, x = 0, y = 0;
        bool largeArc = false, sweep = false;
        ok = reader.Number(radiusX) && reader.Number(radiusY) && reader.Number(rotation) && reader.Flag(largeArc) && reader.Flag(sweep) &&
            reader.Number(x) && reader.Number(y);
        if (ok) writer.ArcTo(radiusX, radiusY, rotation, largeArc, sweep, at(x, y));
        break;
      }
      case 'Z':
      case 'z':
        writer.Close();
        break;
      default:
        ok = false;
        break;
    }

    if (!ok) break;
    hasCubicControl = cubicNow;
    hasQuadControl = quadNow;
  }

  writer.Finish();
}

}
