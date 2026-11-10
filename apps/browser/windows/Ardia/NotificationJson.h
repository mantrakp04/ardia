#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>

#include "NativeModules.h"

namespace Ardia::NotificationParts {

inline void AppendJsonString(std::string &out, std::string_view text) noexcept {
  static constexpr char digits[] = "0123456789abcdef";
  out.push_back('"');
  for (char raw : text) {
    auto byte = static_cast<unsigned char>(raw);
    switch (raw) {
      case '"': out.append("\\\""); break;
      case '\\': out.append("\\\\"); break;
      case '\n': out.append("\\n"); break;
      case '\r': out.append("\\r"); break;
      case '\t': out.append("\\t"); break;
      default:
        if (byte < 0x20) {
          out.append("\\u00");
          out.push_back(digits[byte >> 4]);
          out.push_back(digits[byte & 0xF]);
        } else {
          out.push_back(raw);
        }
    }
  }
  out.push_back('"');
}

inline void AppendJson(std::string &out, winrt::Microsoft::ReactNative::JSValue const &value, int depth) noexcept {
  if (depth > 32) {
    out.append("null");
    return;
  }
  if (auto object = value.TryGetObject()) {
    out.push_back('{');
    bool first = true;
    for (auto const &[key, item] : *object) {
      if (!first) out.push_back(',');
      first = false;
      AppendJsonString(out, key);
      out.push_back(':');
      AppendJson(out, item, depth + 1);
    }
    out.push_back('}');
  } else if (auto array = value.TryGetArray()) {
    out.push_back('[');
    for (size_t i = 0; i < array->size(); i++) {
      if (i) out.push_back(',');
      AppendJson(out, (*array)[i], depth + 1);
    }
    out.push_back(']');
  } else if (auto text = value.TryGetString()) {
    AppendJsonString(out, *text);
  } else if (auto flag = value.TryGetBoolean()) {
    out.append(*flag ? "true" : "false");
  } else if (auto whole = value.TryGetInt64()) {
    out.append(std::to_string(*whole));
  } else if (auto number = value.TryGetDouble()) {
    if (!std::isfinite(*number)) {
      out.append("null");
    } else {
      char buffer[40]{};
      snprintf(buffer, sizeof(buffer), "%.17g", *number);
      out.append(buffer);
    }
  } else {
    out.append("null");
  }
}

inline std::string ToJson(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  std::string out;
  AppendJson(out, value, 0);
  return out;
}

struct JsonReader {
  std::string_view text;
  size_t at{0};
  bool failed{false};

  void SkipSpace() noexcept {
    while (at < text.size() && (text[at] == ' ' || text[at] == '\n' || text[at] == '\r' || text[at] == '\t')) at++;
  }

  bool Take(char expected) noexcept {
    SkipSpace();
    if (at < text.size() && text[at] == expected) {
      at++;
      return true;
    }
    return false;
  }

  bool TakeWord(std::string_view word) noexcept {
    if (text.substr(at).starts_with(word)) {
      at += word.size();
      return true;
    }
    return false;
  }

  static void AppendUtf8(std::string &out, uint32_t code) noexcept {
    if (code < 0x80) {
      out.push_back(static_cast<char>(code));
    } else if (code < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (code >> 6)));
      out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else if (code < 0x10000) {
      out.push_back(static_cast<char>(0xE0 | (code >> 12)));
      out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xF0 | (code >> 18)));
      out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    }
  }

  std::optional<uint32_t> Hex4() noexcept {
    if (at + 4 > text.size()) return std::nullopt;
    uint32_t code = 0;
    for (int i = 0; i < 4; i++) {
      char c = text[at++];
      code <<= 4;
      if (c >= '0' && c <= '9') code |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') code |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') code |= static_cast<uint32_t>(c - 'A' + 10);
      else return std::nullopt;
    }
    return code;
  }

  std::optional<std::string> String() noexcept {
    if (!Take('"')) return std::nullopt;
    std::string out;
    while (at < text.size()) {
      char c = text[at++];
      if (c == '"') return out;
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (at >= text.size()) return std::nullopt;
      char escape = text[at++];
      switch (escape) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          std::optional<uint32_t> code = Hex4();
          if (!code) return std::nullopt;
          if (*code >= 0xD800 && *code < 0xDC00 && TakeWord("\\u")) {
            std::optional<uint32_t> low = Hex4();
            if (!low) return std::nullopt;
            *code = 0x10000 + ((*code - 0xD800) << 10) + (*low - 0xDC00);
          }
          AppendUtf8(out, *code);
          break;
        }
        default: return std::nullopt;
      }
    }
    return std::nullopt;
  }

  winrt::Microsoft::ReactNative::JSValue Value(int depth) noexcept {
    SkipSpace();
    if (depth > 32 || at >= text.size()) {
      failed = true;
      return nullptr;
    }
    char c = text[at];
    if (c == '{') {
      at++;
      winrt::Microsoft::ReactNative::JSValueObject object;
      if (Take('}')) return winrt::Microsoft::ReactNative::JSValue{std::move(object)};
      do {
        std::optional<std::string> key = String();
        if (!key || !Take(':')) {
          failed = true;
          return nullptr;
        }
        object[*key] = Value(depth + 1);
      } while (!failed && Take(','));
      if (!Take('}')) failed = true;
      return winrt::Microsoft::ReactNative::JSValue{std::move(object)};
    }
    if (c == '[') {
      at++;
      winrt::Microsoft::ReactNative::JSValueArray array;
      if (Take(']')) return winrt::Microsoft::ReactNative::JSValue{std::move(array)};
      do {
        array.push_back(Value(depth + 1));
      } while (!failed && Take(','));
      if (!Take(']')) failed = true;
      return winrt::Microsoft::ReactNative::JSValue{std::move(array)};
    }
    if (c == '"') {
      std::optional<std::string> string = String();
      if (!string) {
        failed = true;
        return nullptr;
      }
      return winrt::Microsoft::ReactNative::JSValue{std::move(*string)};
    }
    if (TakeWord("true")) return winrt::Microsoft::ReactNative::JSValue{true};
    if (TakeWord("false")) return winrt::Microsoft::ReactNative::JSValue{false};
    if (TakeWord("null")) return nullptr;
    size_t start = at;
    while (at < text.size() && (text[at] == '-' || text[at] == '+' || text[at] == '.' || text[at] == 'e' || text[at] == 'E' || (text[at] >= '0' && text[at] <= '9'))) at++;
    if (start == at) {
      failed = true;
      return nullptr;
    }
    std::string number{text.substr(start, at - start)};
    char *end = nullptr;
    double parsed = strtod(number.c_str(), &end);
    if (!end || *end != '\0') {
      failed = true;
      return nullptr;
    }
    return winrt::Microsoft::ReactNative::JSValue{parsed};
  }
};

inline winrt::Microsoft::ReactNative::JSValue FromJson(std::string_view text) noexcept {
  JsonReader reader{text};
  winrt::Microsoft::ReactNative::JSValue value = reader.Value(0);
  reader.SkipSpace();
  if (reader.failed || reader.at != text.size()) return nullptr;
  return value;
}

}
