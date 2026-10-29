#include "ardia/linux/ac_linux_sync_json.h"

#include <cmath>
#include <cstdio>
#include <string_view>
#include <unordered_map>

#include "ardia/linux/ac_linux_sync_crypto.h"

namespace ardia::linux_sync {
namespace {

constexpr std::string_view kLegacyPrefix = "pw:";
constexpr std::string_view kLegacyMarker = "\"pw:";

class Parser {
 public:
  explicit Parser(std::string_view text) : text_(text) {}

  std::optional<JsonValue> Document() {
    auto value = Value(0);
    Space();
    if (!value || at_ != text_.size()) return std::nullopt;
    return value;
  }

 private:
  void Space() {
    while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\t' || text_[at_] == '\n' || text_[at_] == '\r'))
      ++at_;
  }

  bool Literal(std::string_view word) {
    if (text_.substr(at_, word.size()) != word) return false;
    at_ += word.size();
    return true;
  }

  std::optional<JsonValue> Value(int depth) {
    if (depth > kMaxJsonDepth) return std::nullopt;
    Space();
    if (at_ >= text_.size()) return std::nullopt;
    const char c = text_[at_];
    if (c == '{') return ObjectValue(depth);
    if (c == '[') return ArrayValue(depth);
    if (c == '"') {
      auto text = StringText();
      if (!text) return std::nullopt;
      return JsonValue::String(std::move(*text));
    }
    if (Literal("true")) return JsonValue::Bool(true);
    if (Literal("false")) return JsonValue::Bool(false);
    if (Literal("null")) return JsonValue::Null();
    return NumberValue();
  }

  std::optional<JsonValue> NumberValue() {
    const size_t start = at_;
    auto digits = [&] {
      const size_t from = at_;
      while (at_ < text_.size() && text_[at_] >= '0' && text_[at_] <= '9') ++at_;
      return at_ > from;
    };
    if (at_ < text_.size() && text_[at_] == '-') ++at_;
    if (at_ < text_.size() && text_[at_] == '0') {
      ++at_;
    } else if (!digits()) {
      return std::nullopt;
    }
    if (at_ < text_.size() && text_[at_] == '.') {
      ++at_;
      if (!digits()) return std::nullopt;
    }
    if (at_ < text_.size() && (text_[at_] == 'e' || text_[at_] == 'E')) {
      ++at_;
      if (at_ < text_.size() && (text_[at_] == '+' || text_[at_] == '-')) ++at_;
      if (!digits()) return std::nullopt;
    }
    JsonValue number;
    number.type = JsonValue::Type::kNumber;
    number.text = std::string(text_.substr(start, at_ - start));
    return number;
  }

  std::optional<uint32_t> Hex4() {
    if (at_ + 4 > text_.size()) return std::nullopt;
    uint32_t value = 0;
    for (int i = 0; i < 4; ++i) {
      const char c = text_[at_++];
      value <<= 4;
      if (c >= '0' && c <= '9') value |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') value |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') value |= static_cast<uint32_t>(c - 'A' + 10);
      else return std::nullopt;
    }
    return value;
  }

  static void Encode(uint32_t point, std::string& out) {
    if (point < 0x80) {
      out.push_back(static_cast<char>(point));
    } else if (point < 0x800) {
      out.push_back(static_cast<char>(0xc0 | (point >> 6)));
      out.push_back(static_cast<char>(0x80 | (point & 0x3f)));
    } else if (point < 0x10000) {
      out.push_back(static_cast<char>(0xe0 | (point >> 12)));
      out.push_back(static_cast<char>(0x80 | ((point >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (point & 0x3f)));
    } else {
      out.push_back(static_cast<char>(0xf0 | (point >> 18)));
      out.push_back(static_cast<char>(0x80 | ((point >> 12) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | ((point >> 6) & 0x3f)));
      out.push_back(static_cast<char>(0x80 | (point & 0x3f)));
    }
  }

  bool RawUtf8(std::string& out) {
    const uint8_t lead = static_cast<uint8_t>(text_[at_]);
    size_t length = (lead & 0xe0) == 0xc0 ? 2 : (lead & 0xf0) == 0xe0 ? 3 : (lead & 0xf8) == 0xf0 ? 4 : 0;
    if (!length || at_ + length > text_.size()) return false;
    uint32_t point = lead & (0x7f >> length);
    for (size_t k = 1; k < length; ++k) {
      const uint8_t next = static_cast<uint8_t>(text_[at_ + k]);
      if ((next & 0xc0) != 0x80) return false;
      point = (point << 6) | (next & 0x3f);
    }
    if ((length == 2 && point < 0x80) || (length == 3 && point < 0x800) || (length == 4 && point < 0x10000) ||
        point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
      return false;
    out.append(text_.substr(at_, length));
    at_ += length;
    return true;
  }

  std::optional<std::string> StringText() {
    ++at_;
    std::string out;
    while (at_ < text_.size()) {
      const char c = text_[at_];
      if (c == '"') {
        ++at_;
        return out;
      }
      if (static_cast<uint8_t>(c) < 0x20) return std::nullopt;
      if (static_cast<uint8_t>(c) >= 0x80) {
        if (!RawUtf8(out)) return std::nullopt;
        continue;
      }
      if (c != '\\') {
        out.push_back(c);
        ++at_;
        continue;
      }
      if (++at_ >= text_.size()) return std::nullopt;
      const char escape = text_[at_++];
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
          auto unit = Hex4();
          if (!unit) return std::nullopt;
          uint32_t point = *unit;
          if (point >= 0xd800 && point <= 0xdbff) {
            const size_t mark = at_;
            std::optional<uint32_t> low;
            if (at_ + 1 < text_.size() && text_[at_] == '\\' && text_[at_ + 1] == 'u') {
              at_ += 2;
              low = Hex4();
            }
            if (low && *low >= 0xdc00 && *low <= 0xdfff) {
              point = 0x10000 + ((point - 0xd800) << 10) + (*low - 0xdc00);
            } else {
              at_ = mark;
              point = 0xfffd;
            }
          } else if (point >= 0xdc00 && point <= 0xdfff) {
            point = 0xfffd;
          }
          Encode(point, out);
          break;
        }
        default:
          return std::nullopt;
      }
    }
    return std::nullopt;
  }

  std::optional<JsonValue> ArrayValue(int depth) {
    ++at_;
    JsonValue array = JsonValue::Array();
    Space();
    if (at_ < text_.size() && text_[at_] == ']') {
      ++at_;
      return array;
    }
    while (true) {
      auto item = Value(depth + 1);
      if (!item) return std::nullopt;
      array.items.push_back(std::move(*item));
      Space();
      if (at_ >= text_.size()) return std::nullopt;
      if (text_[at_] == ',') {
        ++at_;
        continue;
      }
      if (text_[at_] == ']') {
        ++at_;
        return array;
      }
      return std::nullopt;
    }
  }

  std::optional<JsonValue> ObjectValue(int depth) {
    ++at_;
    JsonValue object = JsonValue::Object();
    Space();
    if (at_ < text_.size() && text_[at_] == '}') {
      ++at_;
      return object;
    }
    while (true) {
      Space();
      if (at_ >= text_.size() || text_[at_] != '"') return std::nullopt;
      auto key = StringText();
      if (!key) return std::nullopt;
      Space();
      if (at_ >= text_.size() || text_[at_] != ':') return std::nullopt;
      ++at_;
      auto value = Value(depth + 1);
      if (!value) return std::nullopt;
      object.members.emplace_back(std::move(*key), std::move(*value));
      Space();
      if (at_ >= text_.size()) return std::nullopt;
      if (text_[at_] == ',') {
        ++at_;
        continue;
      }
      if (text_[at_] == '}') {
        ++at_;
        KeepLastOfEachKey(object);
        return object;
      }
      return std::nullopt;
    }
  }

  static void KeepLastOfEachKey(JsonValue& object) {
    auto& members = object.members;
    if (members.size() < 2) return;
    std::vector<bool> keep(members.size(), false);
    {
      std::unordered_map<std::string_view, size_t> last;
      last.reserve(members.size());
      for (size_t i = 0; i < members.size(); ++i) last[members[i].first] = i;
      if (last.size() == members.size()) return;
      for (const auto& [key, index] : last) keep[index] = true;
    }
    std::vector<std::pair<std::string, JsonValue>> kept;
    kept.reserve(members.size());
    for (size_t i = 0; i < members.size(); ++i) {
      if (keep[i]) kept.push_back(std::move(members[i]));
      else WipeJson(members[i].second);
    }
    members = std::move(kept);
  }

  std::string_view text_;
  size_t at_ = 0;
};

void WriteString(const std::string& text, std::string& out) {
  static constexpr char kHex[] = "0123456789abcdef";
  out.push_back('"');
  for (const char c : text) {
    const uint8_t byte = static_cast<uint8_t>(c);
    switch (c) {
      case '"': out.append("\\\""); break;
      case '\\': out.append("\\\\"); break;
      case '\n': out.append("\\n"); break;
      case '\r': out.append("\\r"); break;
      case '\t': out.append("\\t"); break;
      case '\b': out.append("\\b"); break;
      case '\f': out.append("\\f"); break;
      default:
        if (byte < 0x20) {
          out.append("\\u00");
          out.push_back(kHex[byte >> 4]);
          out.push_back(kHex[byte & 15]);
        } else {
          out.push_back(c);
        }
    }
  }
  out.push_back('"');
}

void Write(const JsonValue& value, std::string& out) {
  switch (value.type) {
    case JsonValue::Type::kNull: out.append("null"); break;
    case JsonValue::Type::kBool: out.append(value.flag ? "true" : "false"); break;
    case JsonValue::Type::kNumber: out.append(value.text); break;
    case JsonValue::Type::kString: WriteString(value.text, out); break;
    case JsonValue::Type::kArray:
      out.push_back('[');
      for (size_t i = 0; i < value.items.size(); ++i) {
        if (i) out.push_back(',');
        Write(value.items[i], out);
      }
      out.push_back(']');
      break;
    case JsonValue::Type::kObject:
      out.push_back('{');
      for (size_t i = 0; i < value.members.size(); ++i) {
        if (i) out.push_back(',');
        WriteString(value.members[i].first, out);
        out.push_back(':');
        Write(value.members[i].second, out);
      }
      out.push_back('}');
      break;
  }
}

bool StartsWith(std::string_view text, std::string_view prefix) {
  return text.substr(0, prefix.size()) == prefix;
}

bool Login(JsonValue& value, const SyncKeys& keys, bool hiding) {
  if (!value.is_object()) return true;
  const JsonValue* origin = value.Find("o");
  const JsonValue* username = value.Find("u");
  if (!origin || !origin->is_string() || !username || !username->is_string()) return true;
  const std::string o = origin->text;
  const std::string u = username->text;
  if (hiding) {
    JsonValue* plain = value.Find("p");
    if (!plain || !plain->is_string()) return true;
    auto sealed = keys.SealPassword(plain->text, o, u);
    Wipe(plain->text);
    value.Remove("p");
    if (!sealed) return false;
    value.Set("s", JsonValue::String(std::move(*sealed)));
    return true;
  }
  JsonValue* sealed = value.Find("s");
  if (!sealed || !sealed->is_string()) return true;
  std::string password;
  if (keys.OpenPassword(sealed->text, o, u, &password) != OpenError::kNone) return false;
  value.Remove("s");
  value.Set("p", JsonValue::String(std::move(password)));
  return true;
}

bool Walk(JsonValue& node, const SyncKeys& keys, bool hiding) {
  if (node.is_array()) {
    for (auto& item : node.items) {
      if (!Walk(item, keys, hiding)) return false;
    }
    return true;
  }
  if (!node.is_object()) return true;
  const JsonValue* key = node.Find("k");
  JsonValue* op_value = node.Find("v");
  if (key && key->is_string() && StartsWith(key->text, kLegacyPrefix) && op_value) {
    return Login(*op_value, keys, hiding);
  }
  std::vector<std::pair<std::string, JsonValue>> kept;
  kept.reserve(node.members.size());
  for (auto& [name, value] : node.members) {
    if (!StartsWith(name, kLegacyPrefix)) {
      if (!Walk(value, keys, hiding)) return false;
    } else if (value.is_string()) {
      WipeJson(value);
      continue;
    } else if (value.is_object()) {
      if (JsonValue* inner = value.Find("v"); inner && !Login(*inner, keys, hiding)) return false;
    }
    kept.emplace_back(std::move(name), std::move(value));
  }
  node.members = std::move(kept);
  return true;
}

std::optional<std::string> Transform(std::string_view json, const SyncKeys& keys, bool hiding) {
  if (!HasLegacyPasswords(json)) return std::string(json);
  auto tree = ParseJson(json);
  if (!tree) return std::nullopt;
  const bool ok = Walk(*tree, keys, hiding);
  std::optional<std::string> out;
  if (ok) out = WriteJson(*tree);
  WipeJson(*tree);
  return out;
}

}

JsonValue JsonValue::Bool(bool flag) {
  JsonValue value;
  value.type = Type::kBool;
  value.flag = flag;
  return value;
}

JsonValue JsonValue::Number(double number) {
  JsonValue value;
  value.type = Type::kNumber;
  char buffer[32];
  if (!std::isfinite(number)) {
    value.type = Type::kNull;
    return value;
  }
  if (std::fabs(number) < 9007199254740992.0 && std::floor(number) == number) {
    std::snprintf(buffer, sizeof(buffer), "%.0f", number);
  } else {
    std::snprintf(buffer, sizeof(buffer), "%.17g", number);
  }
  value.text = buffer;
  return value;
}

JsonValue JsonValue::String(std::string text) {
  JsonValue value;
  value.type = Type::kString;
  value.text = std::move(text);
  return value;
}

JsonValue JsonValue::Array(std::vector<JsonValue> items) {
  JsonValue value;
  value.type = Type::kArray;
  value.items = std::move(items);
  return value;
}

JsonValue JsonValue::Object(std::vector<std::pair<std::string, JsonValue>> members) {
  JsonValue value;
  value.type = Type::kObject;
  value.members = std::move(members);
  return value;
}

const JsonValue* JsonValue::Find(std::string_view key) const {
  for (auto it = members.rbegin(); it != members.rend(); ++it) {
    if (it->first == key) return &it->second;
  }
  return nullptr;
}

JsonValue* JsonValue::Find(std::string_view key) {
  for (auto it = members.rbegin(); it != members.rend(); ++it) {
    if (it->first == key) return &it->second;
  }
  return nullptr;
}

void JsonValue::Set(std::string key, JsonValue value) {
  Remove(key);
  members.emplace_back(std::move(key), std::move(value));
}

void JsonValue::Remove(std::string_view key) {
  std::erase_if(members, [&](const auto& member) { return member.first == key; });
}

JsonValue& JsonValue::Append(JsonValue value) {
  items.push_back(std::move(value));
  return items.back();
}

std::optional<JsonValue> ParseJson(std::string_view text) {
  return Parser(text).Document();
}

std::string WriteJson(const JsonValue& value) {
  std::string out;
  Write(value, out);
  return out;
}

void WipeJson(JsonValue& value) {
  Wipe(value.text);
  for (auto& item : value.items) WipeJson(item);
  for (auto& [key, member] : value.members) {
    Wipe(key);
    WipeJson(member);
  }
}

bool HasLegacyPasswords(std::string_view json) {
  return json.find(kLegacyMarker) != std::string_view::npos;
}

std::optional<std::string> HideLegacyPasswords(std::string_view json, const SyncKeys& keys) {
  return Transform(json, keys, true);
}

std::optional<std::string> RestoreLegacyPasswords(std::string_view json, const SyncKeys& keys) {
  return Transform(json, keys, false);
}

}
