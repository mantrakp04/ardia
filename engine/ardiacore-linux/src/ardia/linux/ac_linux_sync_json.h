#ifndef ARDIA_LINUX_AC_LINUX_SYNC_JSON_H_
#define ARDIA_LINUX_AC_LINUX_SYNC_JSON_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ardia::linux_sync {

class SyncKeys;

struct JsonValue {
  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };

  static JsonValue Null() { return JsonValue(); }
  static JsonValue Bool(bool flag);
  static JsonValue Number(double number);
  static JsonValue String(std::string text);
  static JsonValue Array(std::vector<JsonValue> items = {});
  static JsonValue Object(std::vector<std::pair<std::string, JsonValue>> members = {});

  bool is_string() const { return type == Type::kString; }
  bool is_object() const { return type == Type::kObject; }
  bool is_array() const { return type == Type::kArray; }
  const JsonValue* Find(std::string_view key) const;
  JsonValue* Find(std::string_view key);
  void Set(std::string key, JsonValue value);
  void Remove(std::string_view key);
  JsonValue& Append(JsonValue value);

  Type type = Type::kNull;
  bool flag = false;
  std::string text;
  std::vector<JsonValue> items;
  std::vector<std::pair<std::string, JsonValue>> members;
};

inline constexpr int kMaxJsonDepth = 200;

std::optional<JsonValue> ParseJson(std::string_view text);
std::string WriteJson(const JsonValue& value);
void WipeJson(JsonValue& value);

bool HasLegacyPasswords(std::string_view json);
std::optional<std::string> HideLegacyPasswords(std::string_view json, const SyncKeys& keys);
std::optional<std::string> RestoreLegacyPasswords(std::string_view json, const SyncKeys& keys);

}

#endif
